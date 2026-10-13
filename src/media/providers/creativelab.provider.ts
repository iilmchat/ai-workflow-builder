import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toMediaModelInfo } from '../dto/media-model.mapper.js';
import {
  MediaModelsResponseSchema,
  type MediaModelsResponseDto,
} from '../dto/media-model.dto.js';
import {
  MediaProviderException,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaType,
} from '../media-provider.interface.js';

/** Таймаут HTTP-запроса к upstream (RULES 4.19). */
const REQUEST_TIMEOUT_MS = 30_000;
/** Дефолтный адрес media API GPTunnel (совпадает с дефолтом env-схемы). */
const DEFAULT_BASE_URL = 'https://gptunnel.ru/api/v2/media';
/** Дефолтный TTL кэша моделей (совпадает с дефолтом env-схемы). */
const DEFAULT_CACHE_TTL_MS = 900_000;

/** Ключ кэша: конкретный тип модели либо все типы сразу. */
type CacheKey = MediaType | 'ALL';

/** Запись кэша моделей. */
interface CacheEntry {
  /** Разобранные модели. */
  data: readonly MediaModelInfo[];
  /** Момент (мс, `Date.now()`), после которого запись считается устаревшей. */
  expiresAt: number;
}

/**
 * Провайдер media-моделей GPTunnel CreativeLab (v0.6.0b.2.1).
 *
 * У GPTunnel это **отдельный API** от chat (`/api/v2/media`), со своей
 * авторизацией: заголовок `Authorization: <key>` (с `Bearer` и без — upstream
 * принимает оба варианта).
 *
 * Провайдер умеет только читать каталог моделей: список большой (~200 КБ),
 * содержит dynamic schema параметров и входов, и из него UI строит форму
 * узла. Создание задач (`POST /media/tasks`) и опрос статуса — v0.6.0b.2.2.
 *
 * ### Кэш
 *
 * Список моделей меняется редко, а `GET /media/models` дергается из UI часто,
 * поэтому ответы кэшируются **в памяти процесса** (RULES 1.18):
 * - ключ кэша — тип модели (`IMAGE`, `VIDEO`, ...) либо `ALL`;
 * - у каждого ключа свой TTL (`GPTUNNEL_MEDIA_CACHE_TTL_MS`, дефолт 15 минут);
 * - истёкшая запись удаляется при следующем обращении;
 * - ошибка upstream не кэшируется — следующий запрос снова идёт в сеть.
 *
 * Отдельный сервис кэша не нужен: состояние привязано к одному провайдеру, а
 * при появлении второго media-провайдера у каждого будет свой экземпляр.
 * Redis-кэш был бы оправдан для нескольких инстансов приложения — это
 * отдельное решение (см. KI в отчёте).
 *
 * ### Авторизация и ошибки
 *
 * Без ключа провайдер не падает на старте (`isConfigured === false`), а
 * бросает {@link MediaProviderException} при вызове — так же, как LLM-провайдеры.
 */
@Injectable()
export class CreativeLabProvider implements IMediaProvider {
  readonly name = 'creativelab';

  private readonly logger = new Logger(CreativeLabProvider.name);
  /** Ключ API либо `null`, если он не задан. */
  private readonly apiKey: string | null;
  /** Базовый URL media API без завершающего слэша. */
  private readonly baseUrl: string;
  /** TTL кэша моделей в миллисекундах. */
  private readonly cacheTtlMs: number;
  /** Кэш моделей по типу. */
  private readonly cache = new Map<CacheKey, CacheEntry>();

  /**
   * @param config - доступ к переменным окружения media API (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const apiKey = config.get<string>('GPTUNNEL_MEDIA_API_KEY') ?? '';
    this.apiKey = apiKey.length > 0 ? apiKey : null;
    this.baseUrl = (
      config.get<string>('GPTUNNEL_MEDIA_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.cacheTtlMs =
      config.get<number>('GPTUNNEL_MEDIA_CACHE_TTL_MS') ?? DEFAULT_CACHE_TTL_MS;

    if (!this.apiKey) {
      this.logger.warn(
        'GPTUNNEL_MEDIA_API_KEY не задан — media-модели CreativeLab недоступны',
      );
    }
  }

  /** Готов ли провайдер к вызовам (задан ли `GPTUNNEL_MEDIA_API_KEY`). */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Возвращает модели CreativeLab указанного типа.
   *
   * @param type - тип модели, либо `undefined` — модели всех типов
   * @returns описания моделей в camelCase
   * @throws MediaProviderException если ключ не задан, upstream недоступен,
   *   ответил ошибкой или вернул JSON не по схеме
   */
  async listModelsAsync(
    type?: MediaType,
  ): Promise<readonly MediaModelInfo[]> {
    if (!this.apiKey) {
      throw new MediaProviderException(
        this.name,
        'GPTUNNEL_MEDIA_API_KEY не задан',
      );
    }

    const cacheKey: CacheKey = type ?? 'ALL';
    const cached = this.readCache(cacheKey);

    if (cached) {
      this.logger.debug(`Модели media (${cacheKey}): из кэша`);
      return cached;
    }

    const response = await this.fetchModelsAsync(type);
    const models = response.models.map(toMediaModelInfo);

    this.writeCache(cacheKey, models);
    this.logger.debug(
      `Модели media (${cacheKey}): получено ${models.length} из upstream`,
    );

    return models;
  }

  /**
   * Сбрасывает кэш моделей.
   *
   * Нужен там, где каталог мог измениться (например, после ручной правки env)
   * и в тестах, чтобы не зависеть от порядка вызовов.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Читает кэш, удаляя устаревшую запись.
   *
   * @param key - ключ кэша (тип модели или `ALL`)
   * @returns модели, если запись свежая; иначе `null`
   */
  private readCache(key: CacheKey): readonly MediaModelInfo[] | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);

      return null;
    }

    return entry.data;
  }

  /**
   * Кладёт модели в кэш с текущим TTL.
   *
   * @param key - ключ кэша (тип модели или `ALL`)
   * @param data - модели для кэширования
   */
  private writeCache(key: CacheKey, data: readonly MediaModelInfo[]): void {
    this.cache.set(key, { data, expiresAt: Date.now() + this.cacheTtlMs });
  }

  /**
   * Запрашивает модели у upstream и валидирует ответ.
   *
   * @param type - тип модели, либо `undefined` — все типы
   * @returns разобранный ответ upstream
   * @throws MediaProviderException при сетевой ошибке, не-2xx статусе,
   *   невалидном JSON или ответе не по схеме
   */
  private async fetchModelsAsync(
    type?: MediaType,
  ): Promise<MediaModelsResponseDto> {
    const url = new URL(`${this.baseUrl}/models`);

    if (type) {
      url.searchParams.set('type', type);
    }

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          // Upstream принимает и «сырой» ключ, и Bearer; отправляем как есть.
          Authorization: this.apiKey ?? '',
          Accept: 'application/json',
        },
        signal,
      });
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        signal.aborted
          ? 'запрос к media API истёк по таймауту'
          : 'не удалось обратиться к media API',
        { cause: error, retryable: true },
      );
    }

    if (!response.ok) {
      throw new MediaProviderException(
        this.name,
        `media API ответил ${response.status}`,
        { retryable: isRetryableStatus(response.status) },
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        'media API вернул ответ не в формате JSON',
        { cause: error },
      );
    }

    const parsed = MediaModelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new MediaProviderException(
        this.name,
        `неожиданный формат ответа media API: ${parsed.error.issues.length} ошибок схемы`,
        { cause: parsed.error },
      );
    }

    return parsed.data;
  }
}

/**
 * Определяет, стоит ли повторять запрос при таком HTTP-статусе.
 *
 * @param status - HTTP-статус ответа upstream
 * @returns `true` для «временных» статусов (429 и 5xx)
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
