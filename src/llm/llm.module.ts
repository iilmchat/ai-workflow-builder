import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LlmController } from './llm.controller.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmNodeExecutor } from './llm-node-executor.service.js';
import { LlmProviderFactory } from './llm-provider.factory.js';
import { LLM_PROVIDERS, LlmRegistryService } from './llm-registry.service.js';
import { LlmRouterService } from './llm-router.service.js';
import { LlmService } from './llm.service.js';

/**
 * Модуль LLM-провайдеров (R3; мультипровайдерная схема — v0.5.0,
 * HTTP-ручка моделей — R4.1b).
 *
 * Состав провайдеров собирается фабрикой из окружения и передаётся реестру
 * одним массивом через токен {@link LLM_PROVIDERS}. Прямых зависимостей на
 * конкретные классы провайдеров у модуля больше нет: чтобы добавить нового
 * OpenAI-совместимого провайдера, достаточно правки фабрики и env-схемы.
 *
 * Импортируется в AppModule и RunsModule. Обратных импортов нет:
 * `RunsModule` → `LlmModule` (ради `LlmNodeExecutor`), а не наоборот, поэтому
 * цикла в графе модулей не возникает. `ConfigService` приходит из глобального
 * `ConfigModule`.
 *
 * `AuthModule` импортируется ради `JwtAuthGuard` на `GET /llm/health`
 * (v1.3.0 S2, KI-626): guard инжектит `JwtService`/`ConfigService`, которые
 * экспортирует этот модуль. Цикла нет: `AuthModule` не зависит от `LlmModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [LlmController],
  providers: [
    LlmProviderFactory,
    {
      provide: LLM_PROVIDERS,
      inject: [LlmProviderFactory],
      // Асинхронная фабрика: каталог LM Studio запрашивается у сервера (KI-088),
      // поэтому Nest дождётся списка моделей до инициализации провайдеров.
      useFactory: (factory: LlmProviderFactory) => factory.createProvidersAsync(),
    },
    LlmRegistryService,
    // v1.2 S1: healthcheck локального LM Studio (пинг раз в 30 с) и роутер
    // «локальный GPU → облачный fallback». Healthcheck не зависит от флага
    // LLM_ROUTER_ENABLED: статус нужен и будущему UI-индикатору (DESIGN § 3.4).
    LlmHealthService,
    LlmRouterService,
    LlmService,
    LlmNodeExecutor,
  ],
  // R7.4a: реестр нужен ExecutionEngineService, чтобы выбрать провайдера
  // эмбеддингов для узлов vector_upsert/vector_query.
  exports: [LlmService, LlmNodeExecutor, LlmRegistryService],
})
export class LlmModule {}
