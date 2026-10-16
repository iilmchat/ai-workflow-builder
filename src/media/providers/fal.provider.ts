/**
 * FAL — прямой провайдер image-моделей (R7.3, DESIGN v0.9 § 3.3, KI-363).
 *
 * FAL (fal.ai) — быстрый inference чужих моделей (Flux, SDXL, Recraft, Kling).
 * Вызов синхронный: `POST {FAL_BASE_URL}/{modelId}` с телом `{ prompt, ... }`,
 * ответ содержит готовые файлы. Авторизация — заголовок
 * `Authorization: Key <FAL_KEY>` (не `Bearer`: у FAL собственная схема).
 *
 * ### Синхронный вызов против очереди
 *
 * `https://fal.run/<model>` отвечает **результатом** (или ждёт, пока модель
 * отработает), `https://queue.fal.run/<model>` — только принимает задачу и
 * отдаёт `request_id` + `status_url`. Мы поддерживаем оба варианта, потому что
 * выбор задаётся одной переменной `FAL_BASE_URL`:
 * - ответ с `status: 'IN_QUEUE'` (или без готовых файлов) превращается в задачу
 *   `queued`/`running`, а `getTaskAsync` опрашивает `status_url`;
 * - ответ с готовыми файлами сразу отдаёт `done` и `resultUrls`.
 *
 * ### Модель данных и идемпотентность
 *
 * Как и у Replicate, каталог объявлен в коде ({@link FAL_MODELS}): у FAL нет
 * эндпоинта «список моделей» — схема запрашивается отдельно на каждую модель
 * (`GET /<modelId>` отдаёт OpenAPI-схему). Серверного ключа идемпотентности у
 * FAL нет, поэтому защита от дублей — в памяти процесса по ключу
 * идемпотентности (см. комментарий у `idempotency`).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaTaskResult } from '../dto/media-task.mapper.js';
import {
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
import {
  ASPECT_RATIO_PARAM,
  DEFAULT_USD_RUB_RATE,
  IMAGE_INPUT,
  SEED_PARAM,
  filterByType,
  toDirectModelInfo,
  type DirectModelSpec,
} from './provider-catalog.js';
import {
  buildHttpErrorAsync,
  isJsonObject,
  readHttpUrl,
  readNumber,
  readString,
} from './provider-http.js';

/** Дефолтный адрес FAL (совпадает с дефолтом env-схемы). */
const DEFAULT_BASE_URL = 'https://fal.run';
/**
 * Таймаут синхронного вызова модели.
 *
 * `fal.run` держит соединение до конца генерации, а Flux Pro на высоких
 * разрешениях и Kling (video) работают дольше минуты. Лимит с запасом, иначе
 * клиент оборвал бы соединение раньше, чем upstream успевал ответить (то же
 * решение, что у CreativeLab: 45 с на создание задачи).
 */
const CREATE_TASK_TIMEOUT_MS = 180_000;
/** Таймаут опроса статуса в очереди. */
const GET_TASK_TIMEOUT_MS = 15_000;
/** Дефолтный TTL кэша каталога и записей идемпотентности (15 минут). */
const DEFAULT_CACHE_TTL_MS = 900_000;

/**
 * Каталог поддерживаемых моделей FAL.
 *
 * id — путь модели в FAL (`fal-ai/flux/schnell`). Цены — публичные ставки FAL
 * в долларах за генерацию (оценочные: бюджет KI-048 использует их как
 * предохранитель, а не как биллинг).
 */
export const FAL_MODELS: readonly DirectModelSpec[] = [
  {
    id: 'fal-ai/flux/schnell',
    code: 'flux-schnell',
    priceUsd: 0.003,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'fal-ai/flux/dev',
    code: 'flux-dev',
    priceUsd: 0.025,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'fal-ai/flux-pro/v1.1',
    code: 'flux-pro-1.1',
    priceUsd: 0.04,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'fal-ai/flux-pro/v1.1-ultra',
    code: 'flux-pro-1.1-ultra',
    priceUsd: 0.06,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'fal-ai/stable-diffusion-v35-large',
    code: 'sd-3.5-large',
    priceUsd: 0.03,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'fal-ai/recraft-v3',
    code: 'recraft-v3',
    priceUsd: 0.04,
    params: [ASPECT_RATIO_PARAM],
  },
  {
    // Модель-инструмент: удаление фона (image-to-image).
    id: 'fal-ai/imageutils/rembg',
    code: 'rembg',
    type: 'TOOL',
    priceUsd: 0.002,
    inputs: [IMAGE_INPUT],
    params: [],
  },
  {
    // Модель-инструмент: апскейл.
    id: 'fal-ai/clarity-upscaler',
    code: 'clarity-upscaler',
    type: 'TOOL',
    priceUsd: 0.01,
    inputs: [IMAGE_INPUT],
    params: [SEED_PARAM],
  },
];

/**
 * Модель-инструмент по умолчанию для операции.
 *
 * Заполнены `upscale` и `bg_removal`. У `chromakey`/`trim`/`lipsync` дефолта нет
 * намеренно (как в KI-367): у FAL нет одной каноничной модели на эти операции, а
 * подстановка «похожей» отправила бы платный запрос с неверной семантикой.
 */
const TOOL_MODEL_BY_OPERATION: Partial<Record<ImageToolOperation, string>> = {
  upscale: 'fal-ai/clarity-upscaler',
  bg_removal: 'fal-ai/imageutils/rembg',
};

/**
 * Переименование роли входного слота в имя поля FAL.
 *
 * Операция инструмента даёт основной файл одним значением, но у моделей FAL
 * поле называется по-разному: апскейлер и удаление фона ждут `image_url`, а
 * липсинк — `video_url` (у него вход именно видео, KI-369).
 */
const FAL_INPUT_FIELD_BY_OPERATION: Record<ImageToolOperation, string> = {
  upscale: 'image_url',
  bg_removal: 'image_url',
  chromakey: 'image_url',
  trim: 'video_url',
  lipsync: 'video_url',
};

/**
 * Прямой провайдер FAL.
 *
 * Без `FAL_KEY` провайдер не падает на старте (`isConfigured === false`), а
 * бросает {@link MediaProviderException} при вызове.
 */
@Injectable()
export class FalProvider implements IMediaProvider {
  readonly name = 'fal';

  private readonly logger = new Logger(FalProvider.name);
  /** Ключ API либо `null`, если он не задан (R7.3: «client === null»). */
  private readonly apiKey: string | null;
  /** Базовый URL без завершающего слэша (`https://fal.run` или queue-хост). */
  private readonly baseUrl: string;
  /** Курс USD→RUB для пересчёта цен каталога в рубли (бюджет R7.1). */
  private readonly usdRubRate: number;
  /** TTL кэша каталога и записей идемпотентности (мс). */
  private readonly cacheTtlMs: number;
  /** Кэш каталога по типу модели. */
  private readonly cache = new Map<
    MediaType | 'ALL',
    { data: readonly MediaModelInfo[]; expiresAt: number }
  >();
  /** Записи идемпотентности: ключ → id запроса (см. комментарий у поля). */
  private readonly idempotency = new Map<
    string,
    { taskId: string; expiresAt: number }
  >();
  /**
   * URL-ы задачи в очереди FAL: id запроса → `{ statusUrl, responseUrl }`.
   *
   * Нужны, когда `FAL_BASE_URL` указывает на `queue.fal.run`: ответ на
   * постановку задачи содержит готовые `status_url`/`response_url`, и
   * собирать их из id вручную не нужно.
   */
  private readonly queueUrls = new Map<
    string,
    { statusUrl: string | null; responseUrl: string | null }
  >();

  /**
   * @param config - доступ к переменным окружения FAL (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const apiKey = config.get<string>('FAL_KEY') ?? '';
    this.apiKey = apiKey.length > 0 ? apiKey : null;
    this.baseUrl = (
      config.get<string>('FAL_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.usdRubRate =
      config.get<number>('MEDIA_USD_RUB_RATE') ?? DEFAULT_USD_RUB_RATE;
    this.cacheTtlMs = DEFAULT_CACHE_TTL_MS;

    if (!this.apiKey) {
      this.logger.warn('FAL_KEY не задан — модели FAL недоступны');
    }
  }

  /** Готов ли провайдер к вызовам (задан ли клиент, т.е. ключ). */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Возвращает модели FAL указанного типа.
   *
   * Каталог берётся из {@link FAL_MODELS} и кэшируется на 15 минут по типу
   * модели: у FAL нет эндпоинта «список моделей», а схема запрашивается на
   * каждую модель отдельно — ходить в сеть за каждой из них из UI нельзя
   * (RULES 1.18).
   *
   * @param type - тип модели, либо `undefined` — все типы
   * @returns описания моделей в camelCase
   * @throws MediaProviderException если ключ не задан
   */
  async listModelsAsync(
    type?: MediaType,
  ): Promise<readonly MediaModelInfo[]> {
    if (!this.apiKey) {
      throw new MediaProviderException(this.name, 'FAL_KEY не задан');
    }

    const cacheKey: MediaType | 'ALL' = type ?? 'ALL';
    const cached = this.readCache(cacheKey);

    if (cached) {
      return cached;
    }

    const models = filterByType(this.catalog(), type);

    this.cache.set(cacheKey, {
      data: models,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    this.logger.debug(`Модели FAL (${cacheKey}): ${models.length} из каталога`);

    return models;
  }

  /**
   * Сбрасывает кэш каталога, записи идемпотентности и URL-ы очереди.
   *
   * Нужен тестам (не зависеть от порядка вызовов).
   */
  clearCache(): void {
    this.cache.clear();
    this.idempotency.clear();
    this.queueUrls.clear();
  }

  /**
   * Создаёт задачу генерации в FAL.
   *
   * Тело — `params` плюс `prompt` (плоский объект, как ждёт FAL). Ответ
   * разбирается по двум формам:
   * - готовые файлы (`data.images[].url` / `data.image.url`) → `done`;
   * - `request_id` + `status: 'IN_QUEUE'` → `queued`, опрос через
   *   {@link getTaskAsync}.
   *
   * @param input - модель, промпт, параметры и ключ идемпотентности
   * @returns задача с `taskId`; при готовом ответе — с `resultUrls`
   * @throws MediaProviderException если ключ не задан, upstream недоступен или
   *   ответил ошибкой
   */
  async createTaskAsync(input: CreateMediaTaskInput): Promise<MediaTaskResult> {
    this.assertKey();

    const cached = this.readIdempotency(input.idempotencyKey);

    if (cached) {
      this.logger.log(
        `Повтор с ключом идемпотентности ${input.idempotencyKey}: используется запрос FAL ${cached} (новой генерации нет)`,
      );

      return this.getTaskAsync(cached);
    }

    const modelId = normalizeFalId(input.model);
    const body = buildRequestBody(input);
    const response = await this.sendAsync(
      `${this.baseUrl}/${modelId}`,
      { method: 'POST', body: JSON.stringify(body) },
      CREATE_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        `не удалось создать задачу ${modelId}`,
        response,
      );
    }

    const payload = await this.parseJsonAsync(response, 'создание задачи');
    const task = this.toTaskResult(payload, modelId, response.headers);

    this.writeIdempotency(input.idempotencyKey, task.taskId);
    this.logger.log(
      `Запрос FAL создан: ${task.taskId} (model=${modelId}, status=${task.status})`,
    );

    return task;
  }

  /**
   * Возвращает состояние задачи FAL.
   *
   * Для синхронного `fal.run` результат приходит целиком на создании, и опрос
   * обычно не нужен. Для `queue.fal.run` состояние берётся из `status_url`
   * (или собирается из id), а при `COMPLETED` — из `response_url`: только там
   * лежат файлы результата.
   *
   * @param taskId - id запроса из {@link createTaskAsync}
   * @returns состояние задачи; при `done` — с URL-ами результата
   * @throws MediaProviderException если ключ не задан, задача не найдена или
   *   upstream ответил ошибкой
   */
  async getTaskAsync(taskId: string): Promise<MediaTaskResult> {
    this.assertKey();

    const urls = this.queueUrls.get(taskId);
    const statusUrl =
      urls?.statusUrl ?? `${this.baseUrl}/requests/${encodeURIComponent(taskId)}/status`;
    const response = await this.sendAsync(
      statusUrl,
      { method: 'GET' },
      GET_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        `не удалось получить задачу ${taskId}`,
        response,
      );
    }

    const payload = await this.parseJsonAsync(response, 'опрос задачи');
    const status = readString(payload.status) ?? '';
    const mapped = mapQueueStatus(status);

    if (mapped !== 'done') {
      return {
        taskId,
        model: readString(payload.model) ?? taskId,
        status: mapped,
        resultUrls: [],
        costRub: null,
        error: mapped === 'failed' ? readQueueError(payload) : null,
      };
    }

    const responseUrl =
      urls?.responseUrl ?? `${this.baseUrl}/requests/${encodeURIComponent(taskId)}`;
    const result = await this.fetchResultAsync(responseUrl);

    return {
      taskId,
      model: readString(result.model) ?? taskId,
      status: 'done',
      resultUrls: readResultUrls(result),
      costRub: readCostRub(result.billing, this.usdRubRate),
      error: null,
    };
  }

  /**
   * Применяет media-инструмент к готовому файлу (KI-371, R7.1).
   *
   * `fal.run(model, input)` принимает входные файлы ссылками, поэтому вызов
   * сводится к тому же `POST /<modelId>`, но тело собирается из операции:
   * - поле основного входа зависит от операции
   *   ({@link FAL_INPUT_FIELD_BY_OPERATION}: `image_url` / `video_url`);
   * - `audio_url` — из `params.audioUrl` (липсинк);
   * - `prompt` — из `params.prompt`, иначе дефолт операции;
   * - остальные скаляры из `params` — как есть (имена полей принадлежат модели).
   *
   * @param input - публично доступный URL входного файла (`http`/`https`)
   * @param tool - операция инструмента (`upscale`, `bg_removal`, ...)
   * @param params - служебные ключи (`model`, `prompt`, `idempotencyKey`,
   *   `inputs`, `audioUrl`) и параметры модели
   * @returns задача инструмента: сразу `done` с URL-ами или `queued`/`running`
   * @throws MediaProviderException если ключ не задан, ссылка на вход не
   *   `http(s)`, у операции нет модели и она не задана в `params.model`
   */
  async applyToolAsync(
    input: string,
    tool: ImageToolOperation,
    params: ImageToolParams = {},
  ): Promise<MediaTaskResult> {
    this.assertKey();

    const inputUrl = readHttpUrl(input, this.name, tool);
    const requestedModel =
      typeof params.model === 'string' && params.model.length > 0
        ? params.model
        : TOOL_MODEL_BY_OPERATION[tool];

    if (!requestedModel) {
      throw new MediaProviderException(
        this.name,
        `для операции ${tool} не выбрана модель: укажите id модели из каталога FAL (дефолта у операции нет)`,
      );
    }

    const modelId = normalizeFalId(requestedModel);
    const toolParams: Record<string, string | number | boolean> = {
      ...readToolModelParams(params),
      [FAL_INPUT_FIELD_BY_OPERATION[tool]]: inputUrl,
    };
    const prompt = readToolPrompt(tool, params.prompt);

    if (prompt !== null) {
      toolParams.prompt = prompt;
    }

    const audioUrl =
      typeof params.audioUrl === 'string' ? params.audioUrl.trim() : '';

    if (audioUrl.startsWith('https://') || audioUrl.startsWith('http://')) {
      toolParams.audio_url = audioUrl;
    }

    this.logger.log(
      `Инструмент FAL ${tool}: model=${modelId}, inputLen=${inputUrl.length}, prompt=${prompt === null ? 'нет' : 'есть'}`,
    );

    return this.createTaskAsync({
      model: modelId,
      params: toolParams,
      idempotencyKey: readToolIdempotencyKey(params, tool, inputUrl),
    });
  }

  /**
   * Строит каталог моделей FAL с ценами в рублях.
   *
   * @returns описания моделей провайдера
   */
  private catalog(): readonly MediaModelInfo[] {
    return FAL_MODELS.map((spec) =>
      toDirectModelInfo(this.name, spec, this.usdRubRate),
    );
  }

  /**
   * Запрашивает результат завершённой задачи из очереди.
   *
   * @param responseUrl - URL результата (`response_url` или собранный из id)
   * @returns разобранный ответ с файлами и биллингом
   * @throws MediaProviderException если upstream недоступен, ответил ошибкой
   *   или вернул не словарь
   */
  private async fetchResultAsync(
    responseUrl: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.sendAsync(
      responseUrl,
      { method: 'GET' },
      GET_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        'не удалось получить результат задачи FAL',
        response,
      );
    }

    return this.parseJsonAsync(response, 'результат задачи');
  }

  /**
   * Отправляет запрос в FAL с авторизацией и таймаутом.
   *
   * @param url - полный URL запроса
   * @param init - метод и (для POST) тело
   * @param timeoutMs - таймаут запроса (RULES 4.19)
   * @returns HTTP-ответ
   * @throws MediaProviderException при сетевой ошибке или таймауте (retryable)
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
          // FAL использует свою схему авторизации: `Key <ключ>`, не Bearer.
          Authorization: `Key ${this.apiKey ?? ''}`,
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
          ? 'запрос к API FAL истёк по таймауту'
          : 'не удалось обратиться к API FAL',
        { cause: error, retryable: true },
      );
    }
  }

  /**
   * Читает JSON-тело ответа, проверяя, что это словарь (RULES 1.17).
   *
   * @param response - успешный HTTP-ответ
   * @param action - что делали (для текста ошибки)
   * @returns разобранный объект
   * @throws MediaProviderException если тело не JSON или не словарь
   */
  private async parseJsonAsync(
    response: Response,
    action: string,
  ): Promise<Record<string, unknown>> {
    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        `FAL вернул ответ не в формате JSON (${action})`,
        { cause: error },
      );
    }

    if (!isJsonObject(payload)) {
      throw new MediaProviderException(
        this.name,
        `неожиданный формат ответа FAL (${action})`,
      );
    }

    return payload;
  }

  /**
   * Приводит ответ FAL к внутреннему виду задачи.
   *
   * @param payload - разобранный ответ upstream
   * @param modelId - id модели (FAL не всегда возвращает его в ответе)
   * @param headers - заголовки ответа: `x-fal-request-id` несёт id запроса
   * @returns результат задачи в camelCase
   */
  private toTaskResult(
    payload: Record<string, unknown>,
    modelId: string,
    headers: Headers,
  ): MediaTaskResult {
    const requestId =
      readString(payload.request_id) ??
      readString(headers.get('x-fal-request-id')) ??
      '';
    const status = readString(payload.status);
    const urls = readResultUrls(payload);

    // Запоминаем URL-ы очереди: у `queue.fal.run` статус и результат живут на
    // отдельных адресах, и без них опрос пришлось бы собирать вручную.
    if (requestId.length > 0) {
      this.queueUrls.set(requestId, {
        statusUrl: readString(payload.status_url),
        responseUrl: readString(payload.response_url),
      });
    }

    if (urls.length > 0) {
      return {
        taskId: requestId,
        model: readString(payload.model) ?? modelId,
        status: 'done',
        resultUrls: urls,
        costRub: readCostRub(payload.billing, this.usdRubRate),
        error: null,
      };
    }

    const mapped = status === null ? 'running' : mapQueueStatus(status);

    return {
      taskId: requestId,
      model: readString(payload.model) ?? modelId,
      status: mapped === 'done' ? 'running' : mapped,
      resultUrls: [],
      costRub: null,
      error: mapped === 'failed' ? readQueueError(payload) : null,
    };
  }

  /**
   * Читает кэш каталога, удаляя устаревшую запись.
   *
   * @param key - ключ кэша (тип модели или `ALL`)
   * @returns модели, если запись свежая; иначе `null`
   */
  private readCache(key: MediaType | 'ALL'): readonly MediaModelInfo[] | null {
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
   * Читает запись идемпотентности, удаляя устаревшую.
   *
   * @param key - ключ идемпотентности
   * @returns id запроса либо `null`
   */
  private readIdempotency(key: string): string | null {
    const entry = this.idempotency.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.idempotency.delete(key);

      return null;
    }

    return entry.taskId;
  }

  /**
   * Запоминает созданный запрос под ключом идемпотентности.
   *
   * @param key - ключ идемпотентности
   * @param taskId - id запроса в FAL
   */
  private writeIdempotency(key: string, taskId: string): void {
    // Пустой id означает, что результат уже пришёл целиком (синхронный
    // `fal.run` без request_id) — запоминать нечего, повтор перезапросит модель.
    if (taskId.length === 0) {
      return;
    }

    this.idempotency.set(key, {
      taskId,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Бросает ошибку, если ключ не задан.
   *
   * @throws MediaProviderException если `FAL_KEY` пуст
   */
  private assertKey(): void {
    if (!this.apiKey) {
      throw new MediaProviderException(this.name, 'FAL_KEY не задан');
    }
  }
}

/**
 * Убирает префикс провайдера из id модели.
 *
 * Реестр отдаёт id в пространстве имён (`fal:fal-ai/flux/schnell`), а в FAL
 * уходит только `fal-ai/flux/schnell`.
 *
 * @param modelId - id модели из каталога или из `data.model` узла
 * @returns id модели в формате FAL
 */
export function normalizeFalId(modelId: string): string {
  const prefix = 'fal:';

  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

/**
 * Собирает тело запроса к модели FAL.
 *
 * @param input - вход создания задачи
 * @returns плоский объект `{ prompt?, ...params }`
 */
function buildRequestBody(
  input: CreateMediaTaskInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...input.params };

  if (input.prompt !== undefined && input.prompt.length > 0) {
    payload.prompt = input.prompt;
  }

  // KI-196: входные файлы по ролям. FAL ждёт конкретные поля модели
  // (`image_url`, `video_url`), поэтому роль уходит как есть, а первый файл —
  // скаляром: массив FAL принимает только для многофайловых полей.
  for (const [role, urls] of Object.entries(input.inputs ?? {})) {
    const first = urls[0];

    if (first === undefined) {
      continue;
    }

    payload[role] = urls.length > 1 ? urls : first;
  }

  return payload;
}

/**
 * Приводит статус задачи FAL к внутреннему статусу.
 *
 * @param status - статус upstream (`IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, ...)
 * @returns `queued` | `running` | `done` | `failed`
 */
function mapQueueStatus(status: string): MediaTaskResult['status'] {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
    case 'OK':
    case 'DONE':
      return 'done';
    case 'FAILED':
    case 'ERROR':
    case 'CANCELLED':
      return 'failed';
    case 'IN_PROGRESS':
    case 'RUNNING':
      return 'running';
    default:
      return 'queued';
  }
}

/**
 * Извлекает URL-ы результата из ответа FAL.
 *
 * Поддерживаются формы: `data.images[].url`, `data.image.url`, `data.video.url`,
 * `images[].url` (без обёртки `data`) и `image.url`.
 *
 * @param payload - разобранный ответ upstream
 * @returns список `http(s)`-ссылок (пустой, если результата нет)
 */
function readResultUrls(payload: Record<string, unknown>): string[] {
  const scopes = [payload, isJsonObject(payload.data) ? payload.data : null];

  for (const scope of scopes) {
    if (scope === null) {
      continue;
    }

    for (const key of ['images', 'video', 'image'] as const) {
      const urls = readMediaEntries(scope[key]);

      if (urls.length > 0) {
        return urls;
      }
    }
  }

  return [];
}

/**
 * Читает ссылки из поля результата FAL.
 *
 * Поле бывает объектом (`{ url }`), массивом объектов и массивом строк.
 *
 * @param value - значение поля (`image`, `images`, `video`)
 * @returns список `http(s)`-ссылок
 */
function readMediaEntries(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => readMediaEntries(item));
  }

  if (typeof value === 'string') {
    return isHttpUrl(value) ? [value] : [];
  }

  if (isJsonObject(value)) {
    const url = readString(value.url);

    return url !== null && isHttpUrl(url) ? [url] : [];
  }

  return [];
}

/**
 * Проверяет, что строка — `http(s)`-ссылка.
 *
 * @param value - значение из ответа upstream
 * @returns `true`, если это `http`/`https`-URL
 */
function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

/**
 * Читает стоимость задачи в рублях из поля `billing` FAL.
 *
 * @param billing - поле `billing` ответа (`{ cost: <USD> }`)
 * @param usdRubRate - курс USD→RUB
 * @returns стоимость в рублях либо `null`, если upstream её не отдал
 */
function readCostRub(billing: unknown, usdRubRate: number): number | null {
  if (!isJsonObject(billing)) {
    return null;
  }

  const cost = readNumber(billing.cost);

  return cost === null ? null : cost * usdRubRate;
}

/**
 * Читает причину падения задачи FAL.
 *
 * @param payload - разобранный ответ upstream
 * @returns текст причины (никогда не `null`)
 */
function readQueueError(payload: Record<string, unknown>): string {
  const direct = readString(payload.error);

  if (direct !== null) {
    return direct;
  }

  if (isJsonObject(payload.error)) {
    const message = readString(payload.error.message);

    if (message !== null) {
      return message;
    }
  }

  return readString(payload.detail) ?? 'задача FAL завершилась с ошибкой';
}

/**
 * Читает скалярные параметры модели из параметров вызова инструмента.
 *
 * @param params - параметры вызова инструмента
 * @returns скалярные параметры для тела запроса
 */
function readToolModelParams(
  params: ImageToolParams,
): Record<string, string | number | boolean> {
  const collected: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(params)) {
    if (IMAGE_TOOL_RESERVED_PARAM_KEYS.has(key)) {
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
 * Выбирает промпт для запроса инструмента.
 *
 * @param tool - операция инструмента
 * @param requested - промпт, заданный вызывающим кодом
 * @returns промпт либо `null` — «поле не передавать» (у апскейлера и удаления
 *   фона промпта нет в схеме, лишнее поле FAL отклоняет как `422`)
 */
function readToolPrompt(
  tool: ImageToolOperation,
  requested: unknown,
): string | null {
  if (typeof requested === 'string' && requested.trim().length > 0) {
    return requested.trim();
  }

  // Дефолтный промпт подставляем только операциям, у которых он содержателен:
  // `upscale`/`bg_removal` у FAL промпт не принимают.
  return tool === 'chromakey' || tool === 'trim' || tool === 'lipsync'
    ? (DEFAULT_IMAGE_TOOL_PROMPTS[tool] ?? null)
    : null;
}

/**
 * Строит ключ идемпотентности для инструмента, если его не передали.
 *
 * @param params - параметры вызова (нужен `idempotencyKey`)
 * @param tool - операция инструмента
 * @param inputUrl - ссылка на входной файл
 * @returns ключ вызывающего кода либо `tool-<операция>:<ссылка>`
 */
function readToolIdempotencyKey(
  params: ImageToolParams,
  tool: ImageToolOperation,
  inputUrl: string,
): string {
  const key = params.idempotencyKey;

  return typeof key === 'string' && key.length >= 8
    ? key
    : `tool-${tool}:${inputUrl}`;
}
