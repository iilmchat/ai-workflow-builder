import 'dotenv/config';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { resolveCorsOrigin } from './config/cors.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // KI-419: за nginx/Caddy Express видит IP прокси, и ThrottlerGuard считает
  // один общий лимит на всех клиентов. `trust proxy` заставляет `req.ip` брать
  // адрес из `X-Forwarded-For`. По умолчанию выключено: снаружи заголовок
  // подделывается, и включённый без прокси `trust proxy` открыл бы обход
  // rate limiting. Включать только при реальном reverse proxy.
  //
  // `set` — API Express, а не Nest (`INestApplication` его не объявляет),
  // поэтому берём нативный инстанс адаптера и сужаем тип до нужного метода.
  const httpAdapter = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: unknown) => void;
  };
  httpAdapter.set('trust proxy', configService.get<boolean>('TRUST_PROXY') ?? false);

  // Capacitor: WebView грузится с https://localhost, CORS должен принимать этот origin.
  //
  // В браузере запросы идут на тот же origin (dev — через Vite-proxy), поэтому
  // CORS не участвует. В native-сборке origin — `https://localhost` (Android)
  // или `capacitor://localhost` (iOS), и без заголовков
  // `Access-Control-Allow-Origin` браузерный `fetch` внутри WebView блокирует
  // ответ ещё до чтения тела (KI-658).
  //
  // v1.6.0 S6-A: в production `origin: true` слишком широк — он принимает любой
  // сайт. Там используется allowlist из `CORS_ALLOWED_ORIGINS` (массив origin'ов,
  // сравнение точное), а пустой allowlist — ошибка старта: лучше не подняться,
  // чем открыть API всему интернету. В dev/staging поведение прежнее
  // (`origin: true`), чтобы не ломать Vite-прокси, CDP-смоук и Capacitor.
  const nodeEnv = configService.get<string>('NODE_ENV');

  try {
    app.enableCors({
      origin: resolveCorsOrigin(
        nodeEnv,
        configService.get<string>('CORS_ALLOWED_ORIGINS'),
      ),
    });
  } catch (error: unknown) {
    // Fail-fast по конфигурации: `console.error`, потому что Nest-логгер на этом
    // этапе ещё не гарантирует вывод при отказе bootstrap, а сообщение должно
    // попасть в `docker logs` в любом случае (RULES 4.6 — значение из ConfigService).
    console.error(
      `[bootstrap] ${error instanceof Error ? error.message : String(error)}`,
    );
    await app.close();
    process.exit(1);
  }

  // Refresh-токен приходит httpOnly-cookie (R6.1b): без парсера
  // `req.cookies` пуст, и POST /auth/refresh всегда отвечал бы 401.
  app.use(cookieParser());

  // Грейсфул-шатдаун: OnApplicationShutdown закрывает пул pg (DbModule) и
  // соединения BullMQ с Redis (RULES 4.12).
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
