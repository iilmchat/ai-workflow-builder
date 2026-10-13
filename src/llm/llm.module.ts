import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmNodeExecutor } from './llm-node-executor.service.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { LlmService } from './llm.service.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { OpenAiProvider } from './providers/openai.provider.js';

/**
 * Модуль LLM-провайдеров (R3, HTTP-ручка моделей — R4.1b).
 *
 * Импортируется в AppModule и RunsModule. Обратных импортов нет:
 * `RunsModule` → `LlmModule` (ради `LlmNodeExecutor`), а не наоборот, поэтому
 * цикла в графе модулей не возникает. `ConfigService` приходит из глобального
 * `ConfigModule`.
 */
@Module({
  controllers: [LlmController],
  providers: [
    AnthropicProvider,
    OpenAiProvider,
    LlmRegistryService,
    LlmService,
    LlmNodeExecutor,
  ],
  exports: [LlmService, LlmNodeExecutor],
})
export class LlmModule {}
