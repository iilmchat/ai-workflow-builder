import {
  BadGatewayException,
  Controller,
  Get,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  MediaModelsQuerySchema,
  type MediaModelsQueryDto,
} from './dto/media-model.dto.js';
import { MediaRegistryService } from './media-registry.service.js';
import {
  MediaProviderException,
  type MediaModelInfo,
} from './media-provider.interface.js';

/** Ответ `GET /media/models`. */
export interface MediaModelsResponse {
  /** Модели всех сконфигурированных провайдеров. */
  models: MediaModelInfo[];
}

/**
 * HTTP-контроллер media-моделей (v0.6.0b.2.1).
 *
 * Отдаёт каталог моделей для UI: из него строится выбор модели и форма
 * параметров media-узла. Создание задач (`POST /media/tasks`) — v0.6.0b.2.2.
 */
@Controller('media')
export class MediaController {
  /**
   * @param registry - реестр media-провайдеров (источник списка моделей)
   */
  constructor(private readonly registry: MediaRegistryService) {}

  /**
   * `GET /media/models?type=IMAGE` — media-модели для UI.
   *
   * Без `type` возвращаются модели всех типов: удобно для отладки, но UI так
   * делать не должен — каталог большой (сотни моделей). Неизвестный `type`
   * отклоняет Zod-пайп (400), поэтому в сервис попадает только валидное
   * значение.
   *
   * Ошибки upstream транслируются в понятные статусы, иначе клиент получал бы
   * «500 Internal server error» и не мог отличить неверный ключ от падения
   * GPTunnel:
   * - `retryable` (429/5xx, таймаут, сеть) → **503**;
   * - остальные (401/403/404, неожиданный формат) → **502**.
   *
   * @param query - query-параметры; `type` необязателен
   * @returns модели в camelCase; пустой массив, если ни один media-провайдер
   *   не сконфигурирован
   * @throws ServiceUnavailableException если upstream временно недоступен
   * @throws BadGatewayException если upstream ответил ошибкой или неверным форматом
   */
  @Get('models')
  async listModelsAsync(
    @Query(new ZodValidationPipe(MediaModelsQuerySchema))
    query: MediaModelsQueryDto,
  ): Promise<MediaModelsResponse> {
    try {
      const models = await this.registry.listModelsAsync(query.type);

      return { models: [...models] };
    } catch (error: unknown) {
      if (!(error instanceof MediaProviderException)) {
        // Программная ошибка: пусть её обработает глобальный фильтр (500).
        throw error;
      }

      const payload = {
        statusCode: error.retryable ? 503 : 502,
        error: error.retryable ? 'Service Unavailable' : 'Bad Gateway',
        message: error.message,
      };

      throw error.retryable
        ? new ServiceUnavailableException(payload)
        : new BadGatewayException(payload);
    }
  }
}
