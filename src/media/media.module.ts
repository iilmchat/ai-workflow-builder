import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MEDIA_PROVIDERS, MediaRegistryService } from './media-registry.service.js';
import { CreativeLabProvider } from './providers/creativelab.provider.js';

/**
 * Модуль media-провайдеров (v0.6.0b.2.1).
 *
 * Отдельный от `LlmModule`, потому что у GPTunnel CreativeLab **другой API**
 * (`/api/v2/media`), другая авторизация и другая модель данных (задачи вместо
 * текстового ответа). Общего кода с LLM-провайдерами нет, поэтому смешивать
 * их в одном модуле не стоит.
 *
 * Провайдеры собираются в массив через токен {@link MEDIA_PROVIDERS} — так же,
 * как LLM-провайдеры в `LlmModule`: реестр не знает о конкретных классах, а
 * подключение второго media-провайдера сводится к правке этого массива.
 *
 * `MediaRegistryService` экспортируется: исполнитель media-узлов
 * (v0.6.0b.2.2) будет брать модели и создавать задачи через него.
 * `ConfigService` приходит из глобального `ConfigModule`.
 */
@Module({
  controllers: [MediaController],
  providers: [
    CreativeLabProvider,
    {
      provide: MEDIA_PROVIDERS,
      inject: [CreativeLabProvider],
      useFactory: (creativelab: CreativeLabProvider) => [creativelab],
    },
    MediaRegistryService,
  ],
  exports: [MediaRegistryService],
})
export class MediaModule {}
