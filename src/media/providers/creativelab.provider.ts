import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { toMediaModelInfo } from '../dto/media-model.mapper.js';
import {
  MediaModelsResponseSchema,
  type MediaModelsResponseDto,
} from '../dto/media-model.dto.js';
import {
  CreateMediaTaskSchema,
  MediaTaskResponseSchema,
} from '../dto/media-task.dto.js';
import { toMediaTaskResult, type MediaTaskResult } from '../dto/media-task.mapper.js';
import {
  CREATIVELAB_IMAGE_TOOL_MODELS,
  DEFAULT_IMAGE_TOOL_PROMPTS,
  IMAGE_TOOL_RESERVED_PARAM_KEYS,
  type ImageToolOperation,
  type ImageToolParams,
} from '../image-tool.js';
import {
  MediaProviderException,
  type CreateMediaTaskInput,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaType,
} from '../media-provider.interface.js';

/** Таймаут запроса каталога моделей (RULES 4.19). */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Таймаут создания задачи.
 *
 * Upstream при `wait: true` держит соединение до 30 секунд, поэтому лимит
 * выше — 45 секунд с запасом; иначе клиент обрывал бы соединение раньше, чем
 * задача успевала завершиться.
 */
const CREATE_TASK_TIMEOUT_MS = 45_000;
/** Таймаут опроса статуса задачи. */
const GET_TASK_TIMEOUT_MS = 15_000;
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
   * Создаёт задачу генерации.
   *
   * Тело собирается через `CreateMediaTaskSchema` — валидация на выходе:
   * неверный вход отсекается до платного запроса, а не после него.
   *
   * Обработка ответов upstream:
   * - `200` — задача создана (при `wait: true` может быть сразу `done`);
   * - `401`/`403` — ключ не принят, повтор бессмыслен;
   * - `402` — закончился баланс, повтор бессмыслен;
   * - `409` + `code: 23` — сработала идемпотентность: upstream вернул **ту же**
   *   задачу, что и в прошлый раз с этим ключом (новой генерации не было);
   * - `400` + `code: 25` — невалидный вход;
   * - `410` + `code: 21` — модель снята без аналога;
   * - `429`/`5xx` — временная ошибка, повтор имеет смысл.
   *
   * Если upstream ответил заголовком `Deprecation: true`, модель снята с
   * обслуживания, но запрос перенаправлен на аналог (`x-model-served`): задача
   * выполняется, поэтому пишем предупреждение и продолжаем.
   *
   * @param input - модель, промпт, параметры и ключ идемпотентности
   * @returns задача с `taskId`; при `done` — с `resultUrls` и `costRub`
   * @throws MediaProviderException если ключ не задан, вход отклонён, upstream
   *   недоступен или ответил ошибкой
   */
  async createTaskAsync(input: CreateMediaTaskInput): Promise<MediaTaskResult> {
    if (!this.apiKey) {
      throw new MediaProviderException(
        this.name,
        'GPTUNNEL_MEDIA_API_KEY не задан',
      );
    }

    const body = CreateMediaTaskSchema.parse({
      model: input.model,
      prompt: input.prompt,
      params: input.params,
      // R7.1 (KI-196): входные файлы по ролям — без них инструменты
      // (image-to-image) получают запрос без исходного изображения.
      inputs: input.inputs,
      idempotency_key: input.idempotencyKey,
    });

    const response = await this.sendAsync(
      `${this.baseUrl}/tasks`,
      {
        method: 'POST',
        body: JSON.stringify(input.wait ? { ...body, wait: true } : body),
      },
      CREATE_TASK_TIMEOUT_MS,
    );

    this.logDeprecation(response);

    if (!response.ok) {
      // 409 + code:23 — идемпотентный конфликт: upstream вернул ту же задачу,
      // что создавалась с этим ключом ранее. Тело читается один раз, поэтому
      // сначала пробуем разобрать его как задачу, и только потом — как ошибку.
      if (response.status === 409) {
        const existing = await this.tryParseTaskAsync(response);

        if (existing) {
          this.logger.log(
            `Задача с ключом идемпотентности уже существует: ${existing.id} (новой генерации не было)`,
          );

          return toMediaTaskResult(existing);
        }
      }

      throw await this.taskErrorAsync(response, 'не удалось создать задачу');
    }

    const parsed = await this.parseTaskAsync(response);

    return toMediaTaskResult(parsed);
  }

  /**
   * Возвращает актуальное состояние задачи.
   *
   * @param taskId - id, полученный из {@link createTaskAsync}
   * @returns состояние задачи; при `done` — с URL-ами и стоимостью
   * @throws MediaProviderException если ключ не задан, задача не найдена или
   *   upstream ответил ошибкой
   */
  async getTaskAsync(taskId: string): Promise<MediaTaskResult> {
    if (!this.apiKey) {
      throw new MediaProviderException(
        this.name,
        'GPTUNNEL_MEDIA_API_KEY не задан',
      );
    }

    const response = await this.sendAsync(
      `${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`,
      { method: 'GET' },
      GET_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await this.taskErrorAsync(
        response,
        `не удалось получить задачу ${taskId}`,
      );
    }

    const parsed = await this.parseTaskAsync(response);

    return toMediaTaskResult(parsed);
  }

  /**
   * Применяет media-инструмент к готовому файлу (R7.1, KI-196).
   *
   * Upstream-механика: инструмент — это обычная media-модель каталога с
   * обязательным входным слотом, поэтому запрос собирается как
   * {@link createTaskAsync} (`POST /media/tasks` с `wait: true`), но:
   * - `inputs` заполняются по ролям из схемы модели (картинка — из `input`,
   *   аудио для липсинка — из `params.audioUrl`);
   * - промпт не отправляется моделям с `prompt: 'none'` (иначе upstream
   *   отвергает запрос), а для остальных берётся `params.prompt` либо дефолт
   *   операции;
   * - опроса внутри нет: функция возвращает то, что успел отдать upstream.
   *
   * @param input - публично доступный URL входного файла (`http`/`https`)
   * @param tool - операция инструмента (`upscale`, `bg_removal`, ...)
   * @param params - служебные ключи (`model`, `prompt`, `idempotencyKey`,
   *   `inputs`, `audioUrl`) и параметры модели (см. `ImageToolParams`)
   * @returns задача инструмента: сразу `done` с URL-ами или `queued`/`running`
   * @throws MediaProviderException если ключ не задан, ссылка на вход не
   *   `http(s)`, модель не найдена в каталоге, не заполнен обязательный слот
   *   либо upstream ответил ошибкой
   */
  async applyToolAsync(
    input: string,
    tool: ImageToolOperation,
    params: ImageToolParams = {},
  ): Promise<MediaTaskResult> {
    if (!this.apiKey) {
      throw new MediaProviderException(
        this.name,
        'GPTUNNEL_MEDIA_API_KEY не задан',
      );
    }

    const inputUrl = readHttpUrl(input, tool);

    const requestedModel =
      typeof params.model === 'string' && params.model.length > 0
        ? params.model
        : CREATIVELAB_IMAGE_TOOL_MODELS[tool];

    if (!requestedModel) {
      throw new MediaProviderException(
        this.name,
        `для операции ${tool} не выбрана модель: укажите id модели из каталога (дефолта у операции нет)`,
      );
    }

    // Каталог кэшируется (15 минут), поэтому поиск модели не бьёт в upstream.
    const model = (await this.listModelsAsync()).find(
      (candidate) => candidate.id === requestedModel,
    );

    if (!model) {
      throw new MediaProviderException(
        this.name,
        `модель-инструмент не найдена в каталоге media: ${requestedModel}`,
      );
    }

    const inputs = buildToolInputs(model, tool, inputUrl, params);
    const prompt = readToolPrompt(model, tool, params.prompt);
    const idempotencyKey =
      typeof params.idempotencyKey === 'string' &&
      params.idempotencyKey.length >= 8
        ? params.idempotencyKey
        : toolIdempotencyKey(tool, inputUrl);

    this.logger.log(
      `Инструмент ${tool}: model=${model.id}, inputLen=${inputUrl.length}, slots=${Object.keys(inputs).join(',')}, prompt=${prompt === undefined ? 'нет' : 'есть'}`,
    );

    return this.createTaskAsync({
      model: model.id,
      prompt,
      params: collectToolModelParams(model, params),
      inputs,
      idempotencyKey,
      wait: true,
    });
  }

  /**
   * Отправляет запрос в upstream с авторизацией и таймаутом.
   *
   * @param url - полный URL запроса
   * @param init - метод и (для POST) тело
   * @param timeoutMs - таймаут запроса
   * @returns HTTP-ответ
   * @throws MediaProviderException при сетевой ошибке или таймауте
   */
  private async sendAsync(
    url: string,
    init: { method: string; body?: string },
    timeoutMs: number,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      return await fetch(url, {
        method: init.method,
        headers: {
          // Upstream принимает и «сырой» ключ, и Bearer; отправляем как есть.
          Authorization: this.apiKey ?? '',
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body,
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
  }

  /**
   * Разбирает ответ upstream по задаче.
   *
   * @param response - успешный HTTP-ответ
   * @returns разобранная задача
   * @throws MediaProviderException если тело не JSON или не по схеме
   */
  private async parseTaskAsync(
    response: Response,
  ): Promise<ReturnType<typeof MediaTaskResponseSchema.parse>> {
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

    const parsed = MediaTaskResponseSchema.safeParse(payload);

    if (!parsed.success) {
      // KI-111: схема tasks могла разойтись с upstream. Логируем точный path
      // и обрезанный raw — иначе по «1 ошибка схемы» не найти поле.
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');

      this.logger.error(
        `media API task response schema mismatch: ${details}; raw=${JSON.stringify(payload).slice(0, 800)}`,
      );

      throw new MediaProviderException(
        this.name,
        `неожиданный формат ответа media API: ${details}`,
        { cause: parsed.error },
      );
    }

    return parsed.data;
  }

  /**
   * Пытается разобрать ответ как задачу, не бросая исключение.
   *
   * Нужен для идемпотентного конфликта (409): тело может содержать как
   * исходную задачу, так и ошибку, и решать это должен вызывающий код.
   *
   * @param response - ещё не прочитанный ответ upstream
   * @returns задача либо `null`, если тело не является задачей
   */
  private async tryParseTaskAsync(
    response: Response,
  ): Promise<ReturnType<typeof MediaTaskResponseSchema.parse> | null> {
    try {
      const payload: unknown = await response.json();
      const parsed = MediaTaskResponseSchema.safeParse(payload);

      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Превращает неуспешный ответ upstream в ошибку провайдера.
   *
   * Разбирает тело (`code`, `error`), чтобы отличить причины друг от друга, и
   * выставляет `retryable` по статусу.
   *
   * @param response - ответ с не-2xx статусом
   * @param fallback - текст ошибки, если upstream не объяснил причину
   * @returns ошибка провайдера
   */
  private async taskErrorAsync(
    response: Response,
    fallback: string,
  ): Promise<MediaProviderException> {
    const status = response.status;
    const { upstreamCode, upstreamError } = await readErrorBody(response);

    switch (status) {
      case 401:
      case 403:
        return new MediaProviderException(this.name, 'ключ media API не принят');
      case 402:
        return new MediaProviderException(
          this.name,
          'на балансе GPTunnel закончились средства',
        );
      case 409:
        return new MediaProviderException(
          this.name,
          upstreamCode === IDEMPOTENCY_CONFLICT_CODE
            ? 'идемпотентный конфликт: задача с этим ключом уже создана'
            : (upstreamError ?? 'конфликт при создании задачи'),
        );
      case 400:
        return new MediaProviderException(
          this.name,
          upstreamCode === INVALID_INPUT_CODE
            ? `невалидный вход media API: ${upstreamError ?? 'проверьте параметры модели'}`
            : (upstreamError ?? 'media API отклонил запрос'),
        );
      case 410:
        return new MediaProviderException(
          this.name,
          upstreamCode === MODEL_RETIRED_CODE
            ? 'модель снята с обслуживания и аналога нет'
            : (upstreamError ?? 'модель недоступна'),
        );
      default:
        return new MediaProviderException(
          this.name,
          upstreamError ?? `${fallback}: media API ответил ${status}`,
          { retryable: isRetryableStatus(status) },
        );
    }
  }

  /**
   * Логирует предупреждение, если upstream пометил модель снятой.
   *
   * Запрос при этом выполняется: upstream перенаправляет его на аналог
   * (заголовок `x-model-served`), поэтому это именно предупреждение.
   *
   * @param response - ответ upstream
   */
  private logDeprecation(response: Response): void {
    if (response.headers.get('deprecation') !== 'true') {
      return;
    }

    const served = response.headers.get('x-model-served') ?? 'аналог';
    this.logger.warn(
      `Модель снята с обслуживания, запрос обслужен моделью ${served} (upstream вернул Deprecation: true)`,
    );
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
      // KI-112: как и в parseTaskAsync — печатаем точный path и обрезанный raw.
      const details = parsed.error.issues
        .slice(0, 10)
        .map(
          (issue) =>
            `${issue.path.join('.') || '<root>'}: ${issue.message}`,
        )
        .join('; ');

      this.logger.error(
        `media API models schema mismatch: ${details}; raw=${JSON.stringify(payload).slice(0, 1500)}`,
      );

      throw new MediaProviderException(
        this.name,
        `неожиданный формат ответа media API: ${details}`,
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

/**
 * Проверяет, что ссылка на входной файл — `http(s)`.
 *
 * Upstream скачивает файл сам, поэтому `data:`-URL и локальные пути он не
 * примет; проверка на нашей стороне даёт понятную ошибку до платного запроса
 * (RULES 1.9).
 *
 * @param input - значение, пришедшее как входной файл
 * @param tool - операция инструмента (для текста ошибки)
 * @returns проверенную ссылку
 * @throws MediaProviderException если ссылка пуста или не `http(s)`
 */
function readHttpUrl(input: string, tool: ImageToolOperation): string {
  const value = input.trim();
  const isHttp = value.startsWith('https://') || value.startsWith('http://');

  if (!isHttp) {
    throw new MediaProviderException(
      'creativelab',
      `операции ${tool} нужна публичная http(s)-ссылка на входной файл, получено: ${value.length > 0 ? `${value.slice(0, 120)}…` : 'пустое значение'}`,
    );
  }

  return value;
}

/**
 * Собирает `inputs` запроса инструмента по схеме модели.
 *
 * Слоты обязательных входов заполняются по типу файла: аудио — из
 * `params.audioUrl` (липсинк), остальные — из основного `inputUrl`. Явно
 * заданные `params.inputs` имеют приоритет: пользователь/исполнитель может
 * знать раскладку ролей лучше каталога.
 *
 * @param model - модель-инструмент из каталога
 * @param tool - операция инструмента (для текста ошибки)
 * @param inputUrl - ссылка на основной входной файл
 * @param params - параметры вызова (нужны `inputs` и `audioUrl`)
 * @returns словарь «роль слота → список ссылок»
 * @throws MediaProviderException если обязательный аудио-слот не заполнен
 */
function buildToolInputs(
  model: MediaModelInfo,
  tool: ImageToolOperation,
  inputUrl: string,
  params: ImageToolParams,
): Record<string, string[]> {
  if (params.inputs !== undefined) {
    return params.inputs;
  }

  const inputs: Record<string, string[]> = {};
  const required = model.inputs.filter((slot) => slot.required);

  if (required.length === 0) {
    // Модель не объявила обязательных слотов — кладём файл в первый слот
    // (или в `image`, если слотов нет вовсе): иначе запрос уйдёт без входа.
    const key = model.inputs[0]?.key ?? 'image';

    return { [key]: [inputUrl] };
  }

  for (const slot of required) {
    if (slot.kind === 'audio') {
      const audioUrl =
        typeof params.audioUrl === 'string' ? params.audioUrl.trim() : '';

      if (!audioUrl.startsWith('https://') && !audioUrl.startsWith('http://')) {
        throw new MediaProviderException(
          'creativelab',
          `операции ${tool} нужен аудио-файл (модель ${model.id} требует слот «${slot.key}»): передайте audioUrl`,
        );
      }

      inputs[slot.key] = [audioUrl];
      continue;
    }

    inputs[slot.key] = [inputUrl];
  }

  return inputs;
}

/**
 * Выбирает промпт для запроса инструмента.
 *
 * Модели с `prompt: 'none'` (например `kling-lipsync`) промпт не принимают —
 * поле не отправляем вовсе. Остальным нужен непустой промпт: берём
 * пользовательский либо дефолт операции.
 *
 * @param model - модель-инструмент из каталога
 * @param tool - операция инструмента
 * @param requested - промпт, заданный вызывающим кодом
 * @returns промпт либо `undefined` — «поле не передавать»
 */
function readToolPrompt(
  model: MediaModelInfo,
  tool: ImageToolOperation,
  requested: unknown,
): string | undefined {
  if (model.prompt === 'none') {
    return undefined;
  }

  if (typeof requested === 'string' && requested.trim().length > 0) {
    return requested.trim();
  }

  return DEFAULT_IMAGE_TOOL_PROMPTS[tool];
}

/**
 * Отбирает скалярные параметры модели из параметров вызова.
 *
 * Набор параметров у моделей разный, а unknown-ключи upstream перечисляет в
 * `ignored_params`: отправляем только объявленные моделью ключи — так запрос
 * остаётся предсказуемым (та же логика, что в `MediaNodeExecutor.readParamsAsync`,
 * KI-181).
 *
 * @param model - модель-инструмент из каталога
 * @param params - параметры вызова инструмента
 * @returns параметры, объявленные моделью
 */
function collectToolModelParams(
  model: MediaModelInfo,
  params: ImageToolParams,
): Record<string, string | number | boolean> {
  const declared = new Set(model.params.map((param) => param.key));
  const collected: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(params)) {
    if (IMAGE_TOOL_RESERVED_PARAM_KEYS.has(key) || !declared.has(key)) {
      continue;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      collected[key] = value;
    }
  }

  return collected;
}

/**
 * Строит ключ идемпотентности, когда исполнитель его не передал.
 *
 * Ключ детерминирован парой «операция + входной файл»: повторный вызов с тем
 * же изображением не создаст вторую платную задачу (KI-040).
 *
 * @param tool - операция инструмента
 * @param inputUrl - ссылка на входной файл
 * @returns ключ вида `tool-bg_removal-<sha1:16>`
 */
function toolIdempotencyKey(
  tool: ImageToolOperation,
  inputUrl: string,
): string {
  const digest = createHash('sha1').update(inputUrl).digest('hex').slice(0, 16);

  return `tool-${tool}-${digest}`;
}

/** Код upstream: идемпотентный конфликт (задача с этим ключом уже создана). */
const IDEMPOTENCY_CONFLICT_CODE = 23;
/** Код upstream: невалидный вход (параметры модели). */
const INVALID_INPUT_CODE = 25;
/** Код upstream: модель снята с обслуживания и аналога нет. */
const MODEL_RETIRED_CODE = 21;

/**
 * Читает тело ошибки upstream.
 *
 * Тело может быть не JSON или отсутствовать, поэтому любые проблемы разбора
 * приводятся к «нет данных», а не роняют обработку статуса.
 *
 * @param response - ответ upstream с ошибкой
 * @returns код и текст ошибки, если upstream их отдал
 */
async function readErrorBody(
  response: Response,
): Promise<{ upstreamCode: number | null; upstreamError: string | null }> {
  try {
    const payload: unknown = await response.json();

    if (typeof payload !== 'object' || payload === null) {
      return { upstreamCode: null, upstreamError: null };
    }

    const candidate = payload as { code?: unknown; error?: unknown; message?: unknown };
    const code = typeof candidate.code === 'number' ? candidate.code : null;
    const text =
      typeof candidate.error === 'string'
        ? candidate.error
        : typeof candidate.message === 'string'
          ? candidate.message
          : null;

    return { upstreamCode: code, upstreamError: text };
  } catch {
    return { upstreamCode: null, upstreamError: null };
  }
}
