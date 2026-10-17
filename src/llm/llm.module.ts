import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmNodeExecutor } from './llm-node-executor.service.js';
import { LlmProviderFactory } from './llm-provider.factory.js';
import { LLM_PROVIDERS, LlmRegistryService } from './llm-registry.service.js';
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
 */
@Module({
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
    LlmService,
    LlmNodeExecutor,
  ],
  // R7.4a: реестр нужен ExecutionEngineService, чтобы выбрать провайдера
  // эмбеддингов для узлов vector_upsert/vector_query.
  exports: [LlmService, LlmNodeExecutor, LlmRegistryService],
})
export class LlmModule {}
