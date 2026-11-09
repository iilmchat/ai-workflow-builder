import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
// v1.0.0 S3: журнал аудита — AuditModule отдаёт AuditService и GET /admin/audit.
import { AuditModule } from './audit/audit.module.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuthModule } from './auth/auth.module.js';
import {
  HTTP_THROTTLE_DEFAULT_LIMIT,
  HTTP_THROTTLE_TTL_MS,
} from './common/http-throttle.constants.js';
// v0.10.2 (KI-472): единый источник HTTP-префиксов API — общий `api-prefixes.json`
// с frontend/Vite. Локального списка здесь больше нет.
import { API_ROUTE_PATTERN } from './common/api-prefixes.js';
// v0.11 S15 (KI-420): общие счётчики rate limit между инстансами.
import { RedisThrottlerModule } from './common/throttler/redis-throttler.module.js';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage.js';
import { validateEnv } from './config/env.schema.js';
import { DbModule } from './db/db.module.js';
// v0.10 S6: генерация документов (DocumentService).
import { DocumentsModule } from './documents/documents.module.js';
// v0.10 S7: безопасный файловый workspace (FilesystemService).
import { FilesystemModule } from './filesystem/filesystem.module.js';
import { LlmModule } from './llm/llm.module.js';
// v0.11 S8: MCP-модуль также отдаёт HTTP-ручку каталога `GET /mcp/servers`.
import { McpModule } from './mcp/mcp.module.js';
import { MediaModule } from './media/media.module.js';
// v1.0.0 S4: метрики Prometheus — @Global-модуль с ручкой GET /metrics.
import { MetricsModule } from './metrics/metrics.module.js';
import { MetricsInterceptor } from './metrics/metrics.interceptor.js';
// v1.0.0 S5: команда организации — GET /admin/members, POST /admin/members/invite.
import { OrgMembersModule } from './organizations/org-members.module.js';
// v1.5.0 S3 (DESIGN V150 § 3 S3): push-уведомления — POST /notifications/register.
import { NotificationsModule } from './notifications/notifications.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
import { EngineModule } from './engine/engine.module.js';
import { NodesModule } from './nodes/nodes.module.js';
// R7.7 (KI-365): OTel-трейсы — @Global(), SDK стартует только при
// OTEL_ENABLED=true.
import { ObservabilityModule } from './observability/observability.module.js';
import { RedisModule } from './redis/redis.module.js';
// R7.1 (KI-048): бюджет запуска — @Global(), нужен исполнителям узлов
// (LlmModule/MediaModule) и HTTP-ручке в RunsModule.
import { CostBudgetModule } from './runs/cost-budget.module.js';
import { RunsModule } from './runs/runs.module.js';
import { TemplatesModule } from './templates/templates.module.js';
// v0.10 S1 / v0.15 S3: web-search-провайдеры (Tavily/Bing/Brave) и ручка
// GET /web-search/providers для UI узла web_search.
import { WebSearchModule } from './web-search/web-search.module.js';

/**
 * Каталог собранного фронтенда (`web/dist`).
 *
 * Проект — ESM (`"type": "module"` в package.json), поэтому `__dirname`
 * в рантайме отсутствует: путь считаем от `import.meta.url`.
 * В Docker-образе скомпилированный `dist/app.module.js` лежит в `/app/dist`,
 * и `../web/dist` указывает на `/app/web/dist` — туда runner-стадия копирует
 * сборку Vite. Локально после `pnpm build` путь тот же: `<repo>/web/dist`.
 */
const WEB_DIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'web',
  'dist',
);

/**
 * HTTP-префиксы API, которые SPA-fallback не должен перехватывать.
 *
 * Список больше не живёт здесь (v0.10.2, KI-472): единственный источник —
 * `api-prefixes.json` в корне репозитория, из которого `common/api-prefixes.ts`
 * строит {@link API_ROUTE_PATTERN}. Раньше список дублировался с
 * `web/src/lib/api-prefixes.ts` (KI-299), и при добавлении контроллера его
 * забывали. Почему RegExp, а не строка: `@nestjs/serve-static@12` использует
 * `path-to-regexp@8`, где `'/api*'` — синтаксическая ошибка (KI-467).
 */

@Module({
  imports: [
    // ConfigModule обязателен первым: на него завязан BullModule.forRootAsync.
    // validateEnv() — fail-fast проверка .env через Zod (RULES 4.5).
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // Отдача собранного React (web/dist) тем же процессом, что и API:
    // в production отдельный nginx не нужен. `exclude` не даёт SPA-fallback'у
    // перехватывать API-запросы.
    ServeStaticModule.forRoot({
      rootPath: WEB_DIST_PATH,
      exclude: API_ROUTE_PATTERN,
    }),
    // KI-206/KI-234: HTTP rate limiting. Общий лимит — предохранитель от флуда;
    // строгие лимиты на login/share заданы декораторами `@Throttle` в
    // контроллерах. v0.11 S15 (KI-420): по умолчанию счётчики — в Redis, поэтому
    // несколько backend-инстансов делят один лимит. `THROTTLER_STORAGE=memory` —
    // аварийный/тестовый режим (прежнее поведение).
    ThrottlerModule.forRootAsync({
      imports: [RedisModule, RedisThrottlerModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (
        config: ConfigService,
        storage: RedisThrottlerStorage,
      ) => ({
        throttlers: [
          {
            name: 'default',
            ttl: HTTP_THROTTLE_TTL_MS,
            limit: HTTP_THROTTLE_DEFAULT_LIMIT,
          },
        ],
        // undefined → `@nestjs/throttler` создаст in-memory ThrottlerStorageService.
        ...(config.get<string>('THROTTLER_STORAGE') === 'memory'
          ? {}
          : { storage }),
      }),
    }),
    // BullMQ — корневая конфигурация подключения к Redis через ConfigService,
    // без хардкода URL (RULES 4.9). Очереди регистрируют фича-модули.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    DbModule,
    RedisModule,
    ObservabilityModule,
    // v1.0.0 S4 (DESIGN V100 § 3.3): подсистема метрик Prometheus. @Global:
    // EngineModule/AgentModule получают MetricsService без правок их imports.
    MetricsModule,
    AuthModule,
    // v1.0.0 S3 (DESIGN V100 § 3.2): подсистема аудита. Импорт нужен и ради
    // контроллера GET /admin/audit, и потому что AuditService экспортируется
    // в контекст AppModule для глобального AuditInterceptor (ниже).
    AuditModule,
    // v1.0.0 S5 (DESIGN V100 § 3.4): команда организации. Контроллер под
    // префиксом /admin/members, OrgOwnerGuard берётся из AuditModule.
    OrgMembersModule,
    // v1.5.0 S3 (DESIGN V150 § 3 S3): push-токены устройств мобильного клиента.
    // Контроллер под префиксом /notifications (реестр api-prefixes.json).
    NotificationsModule,
    LlmModule,
    WebSearchModule,
    DocumentsModule,
    FilesystemModule,
    MediaModule,
    // v0.11 S8 (DESIGN § 3.2.6): контроллер `GET /mcp/servers` для UI
    // agent-узла. Сам MCP-адаптер (S6/S7) уже импортируется RunsModule'ом;
    // здесь модуль нужен ради HTTP-ручки, а Nest дедуплицирует модуль.
    McpModule,
    WorkflowModule,
    EngineModule,
    NodesModule,
    CostBudgetModule,
    RunsModule,
    // R6.6.1: шаблоны (GET /templates, POST /templates/:id/instantiate).
    // Импортирует WorkflowModule ради WorkflowService.importAsync.
    TemplatesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // KI-206/KI-234: guard глобальный — новые маршруты получают общий лимит
    // автоматически; чувствительные ручки ужесточают его через `@Throttle`.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // v1.0.0 S4 (DESIGN V100 § 3.3): глобальные HTTP-метрики. Регистрируется
    // ПЕРЕД AuditInterceptor: это самый внешний слой, и замер длительности
    // должен включать всю обработку запроса, в том числе запись аудита.
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    // v1.0.0 S3 (DESIGN V100 § 3.2): глобальный журнал аудита. Регистрация
    // через APP_INTERCEPTOR (а не декоратор на каждом контроллере) — новые
    // ручки пишутся в аудит автоматически; интерсептор сам решает, что
    // журналировать (POST/PATCH/DELETE, кроме /auth/* и запросов без user).
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * SPA-fallback только для реальных HTML-маршрутов React.
   *
   * ServeStaticModule регистрирует Express-маршруты в `onModuleInit` — уже
   * ПОСЛЕ контроллеров. Поэтому `GET /` перехватывает `AppController`, а
   * `GET /workflow/share/:token` — WorkflowShareController: браузер получал бы
   * "Hello World!"/JSON вместо `index.html`. В dev это решает Vite
   * (`htmlFallback` по Accept), в production — эта middleware: Nest применяет
   * её ДО роутера.
   *
   * Список ограничен маршрутами из `web/src/App.tsx` (`/`, `/login` и
   * `/workflow/share/:token`), чтобы не перехватывать HTML-навигацией
   * API-ручки, отдающие файлы напрямую (`/media/file/...`,
   * `/workflow/:id/export`). `/login` обрабатывает обычный ServeStatic-fallback,
   * а `/` и share-ссылку перехватывают контроллеры — только они и нужны здесь.
   *
   * Условие `Accept: text/html` обязательно: fetch API шлёт
   * `application/json`/wildcard-Accept и должен попадать в контроллеры.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: Request, res: Response, next: NextFunction) => {
        const wantsHtml = req.headers.accept?.includes('text/html') ?? false;
        // `req.path` внутри Nest-middleware обрезан до пути монтирования
        // (для `forRoutes('*')` это `/`), поэтому маршрут берём из
        // `originalUrl` — иначе fallback перехватывал бы все HTML-запросы.
        const pathname = req.originalUrl.split('?')[0];
        const isSpaRoute =
          pathname === '/' || pathname.startsWith('/workflow/share/');

        if (req.method !== 'GET' || !wantsHtml || !isSpaRoute) {
          next();
          return;
        }

        res.sendFile(join(WEB_DIST_PATH, 'index.html'), (error?: Error) => {
          if (error) {
            next(error);
          }
        });
      })
      .forRoutes('*');
  }
}
