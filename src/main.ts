import 'dotenv/config';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

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

  // Refresh-токен приходит httpOnly-cookie (R6.1b): без парсера
  // `req.cookies` пуст, и POST /auth/refresh всегда отвечал бы 401.
  app.use(cookieParser());

  // Грейсфул-шатдаун: OnApplicationShutdown закрывает пул pg (DbModule) и
  // соединения BullMQ с Redis (RULES 4.12).
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
