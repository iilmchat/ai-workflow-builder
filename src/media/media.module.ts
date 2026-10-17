import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaController } from './media.controller.js';
import { MediaNodeExecutor } from './media-node-executor.service.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import { MediaStorageController } from './media-storage.controller.js';
import { mediaStorageProvider } from './media-storage.service.js';
import {
  orderMediaProviders,
  parseMediaProviderPriority,
} from './media-provider-priority.js';
import type { IMediaProvider } from './media-provider.interface.js';
import { CreativeLabProvider } from './providers/creativelab.provider.js';
import { FalProvider } from './providers/fal.provider.js';
import { OpenAiImagesProvider } from './providers/openai-images.provider.js';
import { ReplicateProvider } from './providers/replicate.provider.js';

/**
 * Модуль media-провайдеров (v0.6.0b.2.1; прямые провайдеры — R7.3).
 *
 * Отдельный от `LlmModule`, потому что у media-провайдеров **другие API**
 * (GPTunnel CreativeLab `/api/v2/media`, Replicate `/v1/predictions`, FAL
 * `/{modelId}`, OpenAI `/v1/images/generations`), другая авторизация и другая
 * модель данных (задачи вместо текстового ответа). Общего кода с LLM-провайдерами
 * нет, поэтому смешивать их в одном модуле не стоит.
 *
 * Провайдеры собираются в массив через токен {@link MEDIA_PROVIDERS} — так же,
 * как LLM-провайдеры в `LlmModule`: реестр не знает о конкретных классах, а
 * подключение очередного media-провайдера сводится к правке этого массива.
 *
 * **Порядок массива = приоритет** (DESIGN § 3.3): он задаётся env
 * `MEDIA_PROVIDER_PRIORITY` (дефолт `creativelab,replicate,fal,openai_images`) и
 * применяется фабрикой через {@link orderMediaProviders}. Приоритет живёт здесь,
 * а не в реестре, потому что env читает код, собирающий DI (RULES 4.6) — у
 * реестра нет доступа к `ConfigService`, да он ему и не нужен: порядок и так
 * приходит готовым.
 *
 * `MediaRegistryService` и `MediaNodeExecutor` экспортируются: исполнитель
 * графа (`ExecutionEngineService` в `RunsModule`) выполняет media-узлы через
 * них. `ConfigService` приходит из глобального `ConfigModule`.
 */
@Module({
  controllers: [MediaController, MediaStorageController],
  providers: [
    CreativeLabProvider,
    ReplicateProvider,
    FalProvider,
    OpenAiImagesProvider,
    // R7.8 (KI-362): хранилище media-результатов (local/s3/none) по env.
    mediaStorageProvider,
    {
      provide: MEDIA_PROVIDERS,
      inject: [
        ConfigService,
        CreativeLabProvider,
        ReplicateProvider,
        FalProvider,
        OpenAiImagesProvider,
      ],
      useFactory: (
        config: ConfigService,
        creativelab: CreativeLabProvider,
        replicate: ReplicateProvider,
        fal: FalProvider,
        openaiImages: OpenAiImagesProvider,
      ): readonly IMediaProvider[] => {
        const priority = parseMediaProviderPriority(
          config.get<string>('MEDIA_PROVIDER_PRIORITY'),
        );

        return orderMediaProviders(
          [creativelab, replicate, fal, openaiImages],
          priority,
        );
      },
    },
    MediaRegistryService,
    MediaNodeExecutor,
  ],
  exports: [MediaRegistryService, MediaNodeExecutor],
})
export class MediaModule {}
