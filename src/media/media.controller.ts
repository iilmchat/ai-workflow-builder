import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  SafeHttpClient,
  SafeHttpDnsException,
  SafeHttpResponseTooLargeException,
} from '../common/http/safe-http.client.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  SsrfBlockedException,
  TooManyRedirectsException,
} from '../common/utils/network-safety.js';
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

/** Максимальный размер файла для прокси-скачивания (25 МБ). */
const DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Таймаут скачивания с учётом редиректов (30 с). */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Zod-схема query-параметров `GET /media/download`. */
const MediaDownloadQuerySchema = z.object({
  /**
   * Presigned URL провайдера.
   *
   * Схема строго `http(s)`: `file:`/`data:`/`javascript:` не должны попасть
   * даже в SSRF-проверку. Реальная проверка адреса — в `SafeHttpClient`
   * (DNS + pinning IP + редиректы).
   */
  url: z.url({ protocol: /^https?$/ }).max(4096),
});

/** Валидированные query-параметры скачивания. */
type MediaDownloadQueryDto = z.infer<typeof MediaDownloadQuerySchema>;

/**
 * Достаёт безопасное имя файла из URL.
 *
 * Имя подставляется в `Content-Disposition`, поэтому кавычки, переводы строк
 * и управляющие символы запрещены: иначе можно сломать заголовок/ответ.
 *
 * @param rawUrl - исходный URL (уже проверенный Zod)
 * @param fallback - имя, если путь пуст/непригоден
 * @returns безопасное имя файла
 */
function filenameFromUrl(rawUrl: string, fallback = 'download'): string {
  try {
    const pathname = new URL(rawUrl).pathname;
    const last = pathname.split('/').pop() ?? '';
    const decoded = decodeURIComponent(last);
    // Управляющие символы/кавычки/слэши запрещены в `Content-Disposition`:
    // собираем посимвольно, чтобы не ловить lint за control-regex.
    const safe = Array.from(decoded)
      .map((char) => {
        const code = char.charCodeAt(0);

        return code < 0x20 ||
          code === 0x7f ||
          char === '"' ||
          char === '\\' ||
          char === '/'
          ? '_'
          : char;
      })
      .join('')
      .trim();

    return safe.length > 0 ? safe : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Собирает `Content-Disposition` с ASCII-fallback и RFC 5987 для Unicode.
 *
 * Заголовки Node требуют latin1: кириллическое имя в `filename="..."` может
 * сломать ответ. ASCII-вариант подставляется всегда, точное Unicode-имя — в
 * `filename*`.
 *
 * @param filename - безопасное имя файла
 * @returns значение заголовка
 */
function contentDispositionOf(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');

  if (ascii === filename) {
    return `attachment; filename="${ascii}"`;
  }

  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * HTTP-контроллер media-моделей (v0.6.0b.2.1).
 *
 * Отдаёт каталог моделей для UI: из него строится выбор модели и форма
 * параметров media-узла. Создание задач (`POST /media/tasks`) — v0.6.0b.2.2.
 *
 * **Прокси-скачивание (v1.6.0 S8.2, KI-466).** Браузер игнорирует атрибут
 * `download` у `<a>`, если файл лежит на другом домене (S3/Selectel): вместо
 * скачивания он открывает картинку. Ручка `GET /media/download` качает файл
 * на backend и отдаёт его same-origin с `Content-Disposition: attachment`.
 * URL проходит через `SafeHttpClient` (SSRF: DNS + pinning + редиректы), а не
 * через сырой `fetch`.
 */
@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  /**
   * @param registry - реестр media-провайдеров (источник списка моделей)
   * @param safeHttp - безопасный HTTP-клиент (SSRF-защита прокси-скачивания)
   */
  constructor(
    private readonly registry: MediaRegistryService,
    private readonly safeHttp: SafeHttpClient,
  ) {}

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

  /**
   * `GET /media/download?url=<presigned>` — скачивание файла через backend.
   *
   * Зачем прокси: `download` у `<a>` не работает для cross-origin URL, а S3
   * (Selectel) отдаёт presigned-ссылки с другого домена. Backend получает файл
   * и отдаёт его с `Content-Disposition: attachment`, поэтому браузер сохраняет
   * файл, а не открывает вкладку.
   *
   * **SSRF.** URL проходит через `SafeHttpClient.fetchBufferAsync`: DNS
   * резолвится один раз, все адреса проверяются, соединение пиннится на IP,
   * редиректы проверяются пошагово. `127.0.0.1`, `10/8`, metadata-адреса и
   * прочие внутренние цели блокируются до сетевого вызова.
   *
   * **Размер.** Тело ограничено {@link DOWNLOAD_MAX_BYTES}; больше — 502
   * (`SafeHttpResponseTooLargeException`), а не OOM.
   *
   * @param query - `url` (http/https, обязателен)
   * @param response - Express-ответ: заголовки и тело файла
   * @returns промис без значения
   * @throws BadRequestException если URL ведёт на внутренний адрес
   * @throws BadGatewayException если upstream ответил ошибкой/слишком большим телом
   */
  @Get('download')
  async downloadAsync(
    @Query(new ZodValidationPipe(MediaDownloadQuerySchema))
    query: MediaDownloadQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    let result;

    try {
      result = await this.safeHttp.fetchBufferAsync({
        url: query.url,
        method: 'GET',
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        maxResponseBytes: DOWNLOAD_MAX_BYTES,
      });
    } catch (error: unknown) {
      throw this.mapDownloadError(error);
    }

    if (!result.ok) {
      this.logger.warn(
        `Прокси-скачивание: upstream ответил ${result.status} (${new URL(query.url).hostname})`,
      );

      throw new BadGatewayException('Не удалось скачать файл у провайдера');
    }

    const filename = filenameFromUrl(query.url);
    const contentType =
      result.contentType.length > 0
        ? result.contentType
        : 'application/octet-stream';

    response.setHeader('Content-Type', contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      contentDispositionOf(filename),
    );
    response.setHeader('Content-Length', result.buffer.length);
    response.end(result.buffer);
  }

  /**
   * Переводит ошибки безопасного HTTP-клиента в HTTP-статусы.
   *
   * SSRF и невалидный URL — 400 (вина запроса), сбои upstream/лимиты — 502.
   * Текст ошибки клиенту не раскрывает внутренние адреса/стек.
   *
   * @param error - значение из `catch`
   * @returns Nest-исключение для глобального фильтра
   */
  private mapDownloadError(error: unknown): Error {
    if (error instanceof SsrfBlockedException) {
      return new BadRequestException('URL запрещён: внутренний адрес');
    }

    if (error instanceof SafeHttpResponseTooLargeException) {
      return new BadGatewayException('Файл слишком большой для скачивания');
    }

    if (
      error instanceof SafeHttpDnsException ||
      error instanceof TooManyRedirectsException
    ) {
      return new BadGatewayException('Не удалось скачать файл у провайдера');
    }

    // Невалидный URL/схема/учётные данные — ошибка запроса, а не 500.
    if (error instanceof Error) {
      return new BadRequestException('Некорректный URL для скачивания');
    }

    return new BadGatewayException('Не удалось скачать файл у провайдера');
  }
}
