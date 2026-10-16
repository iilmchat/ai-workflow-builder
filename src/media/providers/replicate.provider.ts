/**
 * Replicate — прямой провайдер image-моделей (R7.3, DESIGN v0.9 § 3.3, KI-363).
 *
 * Replicate — хостинг чужих моделей (Flux, SDXL, Kling и др.) со своим REST
 * API: создание предсказания `POST /v1/predictions`, опрос `GET
 * /v1/predictions/:id`. Задача авторизации — заголовок
 * `Authorization: Bearer <REPLICATE_API_TOKEN>`.
 *
 * ### Что именно вызывается вместо SDK
 *
 * DESIGN § 3.3 говорит `replicate.run(modelId, input)`. Официальный SDK —
 * тонкая обёртка над теми же двумя эндпоинтами, но как новая runtime-зависимость
 * он не нужен: у нас нет `pnpm install` в этом срезе, а поведение `run()`
 * (создать → дождаться → вернуть output) воспроизводится двумя `fetch`-вызовами
 * с теми же параметрами. Итоговый запрос к Replicate **идентичен** вызову
 * `replicate.run()` (`POST /predictions` с `version`/`input`), а в логе виден
 * реальный URL — это упрощает диагностику, чем непрозрачный вызов SDK.
 *
 * ### Модель данных
 *
 * Replicate не отдаёт «каталог как у GPTunnel»: `GET /v1/models` — это десятки
 * тысяч публичных моделей без единой схемы параметров. Поэтому каталог объявлен
 * в коде ({@link REPLICATE_MODELS}), а `GET /v1/models` используется только как
 * проверка доступности: если upstream отвечает, состав каталога остаётся
 * нашим — с типами, ценами и слотами входа, которые понимает UI.
 *
 * ### Идемпотентность (KI-040)
 *
 * У Replicate **нет** поля `idempotency_key` (в отличие от CreativeLab, где это
 * `code: 23`). Защита от дублей сделана на нашей стороне: результат создания
 * запоминается в памяти процесса по ключу идемпотентности, и повтор с тем же
 * ключом не уходит в upstream вовсе. Память сбрасывается по TTL (как кэш
 * моделей) — этого достаточно для job-retry внутри одного запуска, но
 * **не заменяет** серверный ключ: перезапуск процесса или второй инстанс
 * приложения дубль не поймает (KI в отчёте R7.3).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MediaTaskResult } from '../dto/media-task.mapper.js';
import {
  DEFAULT_IMAGE_TOOL_PROMPTS,
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
import { z } from 'zod';
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
  DEFAULT_REQUEST_TIMEOUT_MS,
  buildHttpErrorAsync,
  isJsonObject,
  readHttpUrl,
  readNumber,
  readString,
} from './provider-http.js';

/** Дефолтный адрес API Replicate (совпадает с дефолтом env-схемы). */
const DEFAULT_BASE_URL = 'https://api.replicate.com/v1';
/** Таймаут создания предсказания: при `wait` upstream держит соединение до 60 с. */
const CREATE_TASK_TIMEOUT_MS = 65_000;
/** Таймаут опроса предсказания. */
const GET_TASK_TIMEOUT_MS = 15_000;
/** Дефолтный TTL кэша каталога и записей идемпотентности (15 минут). */
const DEFAULT_CACHE_TTL_MS = 900_000;

/**
 * Каталог поддерживаемых моделей Replicate.
 *
 * id — путь модели в Replicate (`owner/name`). Версия (`:hash`) не
 * фиксируется: Replicate подставляет последнюю для этой модели, иначе
 * обновление модели у провайдера ломало бы наши id. Если нужна конкретная
 * версия — она указывается в `data.model` как `replicate:owner/name:hash` и
 * уходит в поле `version`.
 *
 * Цены — публичные ставки Replicate на момент R7.3, в долларах за генерацию
 * (пересчёт в рубли — {@link toDirectModelInfo}). Они оценочные: бюджет (KI-048)
 * использует их как предохранитель, а не как биллинг.
 */
export const REPLICATE_MODELS: readonly DirectModelSpec[] = [
  {
    id: 'black-forest-labs/flux-schnell',
    code: 'flux-schnell',
    priceUsd: 0.003,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'black-forest-labs/flux-dev',
    code: 'flux-dev',
    priceUsd: 0.025,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'black-forest-labs/flux-pro',
    code: 'flux-pro',
    priceUsd: 0.05,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'black-forest-labs/flux-1.1-pro',
    code: 'flux-1.1-pro',
    priceUsd: 0.04,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'black-forest-labs/flux-1.1-pro-ultra',
    code: 'flux-pro-1.1-ultra',
    priceUsd: 0.06,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    id: 'stability-ai/sdxl',
    code: 'sdxl',
    priceUsd: 0.002,
    params: [ASPECT_RATIO_PARAM, SEED_PARAM],
  },
  {
    // Модель-инструмент: обязательный входной файл (image-to-image).
    id: 'nightmareai/real-esrgan',
    code: 'real-esrgan',
    type: 'TOOL',
    priceUsd: 0.002,
    inputs: [IMAGE_INPUT],
    params: [SEED_PARAM],
  },
  {
    // Модель-инструмент: удаление фона.
    id: 'cjwbw/rembg',
    code: 'rembg',
    type: 'TOOL',
    priceUsd: 0.002,
    inputs: [IMAGE_INPUT],
    params: [],
  },
];

/**
 * Модель-инструмент по умолчанию для операции (R7.1 → R7.3).
 *
 * Заполнены только операции с известной моделью в каталоге Replicate. У
 * `chromakey`/`trim`/`lipsync` дефолта нет намеренно (как у CreativeLab в
 * KI-367): подставить «похожую» модель — значит отправить платный запрос с
 * неверной семантикой. Пользователь выбирает модель в селекте — id приходит в
 * `params.model`.
 */
const TOOL_MODEL_BY_OPERATION: Partial<Record<ImageToolOperation, string>> = {
  upscale: 'nightmareai/real-esrgan',
  bg_removal: 'cjwbw/rembg',
};

/** Схема ответа `GET /v1/models` (проверка доступности upstream). */
const ModelsResponseSchema = z
  .object({
    results: z
      .array(z.object({ owner: z.string(), name: z.string() }).passthrough())
      .default([]),
  })
  .passthrough();

/**
 * Прямой провайдер Replicate.
 *
 * Без `REPLICATE_API_TOKEN` провайдер не падает на старте
 * (`isConfigured === false`), а бросает {@link MediaProviderException} при
 * вызове — так же, как LLM-провайдеры и CreativeLab.
 */
@Injectable()
export class ReplicateProvider implements IMediaProvider {
  readonly name = 'replicate';

  private readonly logger = new Logger(ReplicateProvider.name);
  /** Токен API либо `null`, если он не задан (R7.3: «client === null»). */
  private readonly token: string | null;
  /** Базовый URL API без завершающего слэша. */
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
  /**
   * Записи идемпотентности: ключ → id предсказания.
   *
   * У Replicate нет серверного ключа идемпотентности, поэтому повтор с тем же
   * ключом (job-level retry, KI-040) не должен создавать второе предсказание.
   */
  private readonly idempotency = new Map<
    string,
    { taskId: string; expiresAt: number }
  >();

  /**
   * @param config - доступ к переменным окружения Replicate (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const token = config.get<string>('REPLICATE_API_TOKEN') ?? '';
    this.token = token.length > 0 ? token : null;
    this.baseUrl = (
      config.get<string>('REPLICATE_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    this.usdRubRate =
      config.get<number>('MEDIA_USD_RUB_RATE') ?? DEFAULT_USD_RUB_RATE;
    this.cacheTtlMs = DEFAULT_CACHE_TTL_MS;

    if (!this.token) {
      this.logger.warn(
        'REPLICATE_API_TOKEN не задан — модели Replicate недоступны',
      );
    }
  }

  /** Готов ли провайдер к вызовам (задан ли клиент, т.е. токен). */
  get isConfigured(): boolean {
    return this.token !== null;
  }

  /**
   * Возвращает модели Replicate указанного типа.
   *
   * Список берётся из {@link REPLICATE_MODELS} и кэшируется на 15 минут по
   * типу модели. Первый вызов дополнительно проверяет доступность upstream
   * (`GET /v1/models`): без этого опечатка в `REPLICATE_BASE_URL` или
   * недействительный токен проявились бы только на платном запросе генерации,
   * причём с невнятной ошибкой схемы ответа.
   *
   * @param type - тип модели, либо `undefined` — все типы
   * @returns описания моделей в camelCase
   * @throws MediaProviderException если токен не задан, upstream недоступен или
   *   ответил ошибкой
   */
  async listModelsAsync(
    type?: MediaType,
  ): Promise<readonly MediaModelInfo[]> {
    if (!this.token) {
      throw new MediaProviderException(
        this.name,
        'REPLICATE_API_TOKEN не задан',
      );
    }

    const cacheKey: MediaType | 'ALL' = type ?? 'ALL';
    const cached = this.readCache(cacheKey);

    if (cached) {
      return cached;
    }

    await this.assertReachableAsync();

    const models = filterByType(this.catalog(), type);

    this.cache.set(cacheKey, {
      data: models,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    this.logger.debug(
      `Модели Replicate (${cacheKey}): ${models.length} из каталога`,
    );

    return models;
  }

  /**
   * Сбрасывает кэш каталога и записи идемпотентности.
   *
   * Нужен тестам (не зависеть от порядка вызовов) и ручной перезагрузке
   * каталога.
   */
  clearCache(): void {
    this.cache.clear();
    this.idempotency.clear();
  }

  /**
   * Создаёт предсказание Replicate.
   *
   * Тело: `{ version?: '<hash>', input: {...} }`. Промпт и скалярные параметры
   * сливаются в один объект `input` — так работает Replicate: имена полей
   * принадлежат модели, а не транспорту.
   *
   * При `wait: true` добавляется `wait: 60` (Replicate держит соединение и
   * возвращает уже завершённое предсказание). Ответ на `POST /predictions` —
   * это `201` с предсказанием; финальный output может быть уже заполнен.
   *
   * @param input - модель, промпт, параметры и ключ идемпотентности
   * @returns задача с `taskId`; при `done` — с `resultUrls`
   * @throws MediaProviderException если токен не задан, повтор с тем же ключом
   *   уже создан (возвращается существующая задача), upstream недоступен или
   *   ответил ошибкой
   */
  async createTaskAsync(input: CreateMediaTaskInput): Promise<MediaTaskResult> {
    this.assertToken();

    const cached = this.readIdempotency(input.idempotencyKey);

    if (cached) {
      this.logger.log(
        `Повтор с ключом идемпотентности ${input.idempotencyKey}: используется предсказание ${cached} (новой генерации нет)`,
      );

      return this.getTaskAsync(cached);
    }

    const modelId = normalizeReplicateId(input.model);
    const { model, version } = splitVersion(modelId);
    const body: Record<string, unknown> = {
      input: buildInput(input),
    };

    if (version) {
      body.version = version;
    }

    if (input.wait === true) {
      body.wait = 60;
    }

    const response = await this.sendAsync(
      `${this.baseUrl}/predictions`,
      { method: 'POST', body: JSON.stringify(body) },
      CREATE_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        `не удалось создать задачу ${model}`,
        response,
      );
    }

    const payload = await this.parseJsonAsync(response, 'создание задачи');
    const task = this.toTaskResult(payload, model);

    this.writeIdempotency(input.idempotencyKey, task.taskId);
    this.logger.log(
      `Предсказание Replicate создано: ${task.taskId} (model=${model}, status=${task.status})`,
    );

    return task;
  }

  /**
   * Возвращает состояние предсказания.
   *
   * @param taskId - id предсказания из {@link createTaskAsync}
   * @returns состояние задачи; при `done` — с URL-ами результата
   * @throws MediaProviderException если токен не задан, предсказание не найдено
   *   или upstream ответил ошибкой
   */
  async getTaskAsync(taskId: string): Promise<MediaTaskResult> {
    this.assertToken();

    const response = await this.sendAsync(
      `${this.baseUrl}/predictions/${encodeURIComponent(taskId)}`,
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

    return this.toTaskResult(payload, readString(payload.model) ?? taskId);
  }

  /**
   * Применяет media-инструмент к готовому файлу (KI-371, R7.1).
   *
   * Replicate умеет `replicate.run(model, input)` с любым входом, поэтому вызов
   * сводится к тому же `POST /predictions`, но `input` собирается из операции:
   * - `image` — публичная ссылка на входной файл;
   * - `prompt` — из `params.prompt`, иначе дефолт операции
   *   ({@link DEFAULT_IMAGE_TOOL_PROMPTS});
   * - `audio` — из `params.audioUrl` (закадровый липсинк у моделей, которые его
   *   принимают);
   * - остальные скаляры из `params` — как есть (имена полей принадлежат модели).
   *
   * Опроса внутри нет (контракт {@link IMediaProvider.applyToolAsync}): если
   * upstream не успел за окно `wait`, вернётся задача в статусе
   * `queued`/`running`, а опрос — на стороне исполнителя узла.
   *
   * @param input - публично доступный URL входного файла (`http`/`https`)
   * @param tool - операция инструмента (`upscale`, `bg_removal`, ...)
   * @param params - служебные ключи (`model`, `prompt`, `idempotencyKey`,
   *   `inputs`, `audioUrl`) и параметры модели
   * @returns задача инструмента: сразу `done` с URL-ами или `queued`/`running`
   * @throws MediaProviderException если токен не задан, ссылка на вход не
   *   `http(s)`, у операции нет модели и она не задана в `params.model`
   */
  async applyToolAsync(
    input: string,
    tool: ImageToolOperation,
    params: ImageToolParams = {},
  ): Promise<MediaTaskResult> {
    this.assertToken();

    const inputUrl = readHttpUrl(input, this.name, tool);
    const requestedModel =
      typeof params.model === 'string' && params.model.length > 0
        ? params.model
        : TOOL_MODEL_BY_OPERATION[tool];

    if (!requestedModel) {
      throw new MediaProviderException(
        this.name,
        `для операции ${tool} не выбрана модель: укажите id модели из каталога Replicate (дефолта у операции нет)`,
      );
    }

    const modelId = normalizeReplicateId(requestedModel);
    const toolParams: Record<string, string | number | boolean> = {
      ...readToolModelParams(params),
      image: inputUrl,
    };
    const prompt = readToolPrompt(tool, params.prompt);

    if (prompt !== null) {
      toolParams.prompt = prompt;
    }

    const audioUrl =
      typeof params.audioUrl === 'string' ? params.audioUrl.trim() : '';

    if (audioUrl.startsWith('https://') || audioUrl.startsWith('http://')) {
      toolParams.audio = audioUrl;
    }

    this.logger.log(
      `Инструмент Replicate ${tool}: model=${modelId}, inputLen=${inputUrl.length}, prompt=${prompt === null ? 'нет' : 'есть'}`,
    );

    return this.createTaskAsync({
      model: modelId,
      params: toolParams,
      idempotencyKey: readToolIdempotencyKey(params, tool, inputUrl),
      wait: true,
    });
  }

  /**
   * Строит каталог моделей Replicate с ценами в рублях.
   *
   * @returns описания моделей провайдера
   */
  private catalog(): readonly MediaModelInfo[] {
    return REPLICATE_MODELS.map((spec) =>
      toDirectModelInfo(this.name, spec, this.usdRubRate),
    );
  }

  /**
   * Проверяет доступность API Replicate.
   *
   * @throws MediaProviderException если upstream недоступен или ответил ошибкой
   */
  private async assertReachableAsync(): Promise<void> {
    const response = await this.sendAsync(
      `${this.baseUrl}/models`,
      { method: 'GET' },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        'не удалось получить каталог моделей',
        response,
      );
    }

    // Тело проверяем схемой: 200 с HTML (прокси/портал вместо API) иначе
    // прошёл бы как «доступно», а ошибка всплыла бы на платном запросе.
    const payload = await this.parseJsonAsync(response, 'каталог моделей');
    const parsed = ModelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      this.logger.warn(
        `Ответ GET /v1/models не по схеме: ${parsed.error.issues
          .slice(0, 3)
          .map((issue) => issue.path.join('.') || '<root>')
          .join('; ')} — каталог берётся из кода`,
      );
    }
  }

  /**
   * Отправляет запрос в Replicate с авторизацией и таймаутом.
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
          Authorization: `Bearer ${this.token ?? ''}`,
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
          ? 'запрос к API Replicate истёк по таймауту'
          : 'не удалось обратиться к API Replicate',
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
        `Replicate вернул ответ не в формате JSON (${action})`,
        { cause: error },
      );
    }

    if (!isJsonObject(payload)) {
      throw new MediaProviderException(
        this.name,
        `неожиданный формат ответа Replicate (${action})`,
      );
    }

    return payload;
  }

  /**
   * Приводит предсказание Replicate к внутреннему виду задачи.
   *
   * Соответствие статусов: `starting` → `queued`, `processing` → `running`,
   * `succeeded` → `done`, `failed`/`canceled` → `failed`.
   *
   * @param payload - разобранное предсказание
   * @param fallbackModel - id модели, если upstream его не отдал
   * @returns результат задачи в camelCase
   */
  private toTaskResult(
    payload: Record<string, unknown>,
    fallbackModel: string,
  ): MediaTaskResult {
    const rawStatus = readString(payload.status) ?? 'starting';
    const status = mapStatus(rawStatus);

    return {
      taskId: readString(payload.id) ?? '',
      model: readString(payload.model) ?? fallbackModel,
      status,
      resultUrls: status === 'done' ? readOutputUrls(payload.output) : [],
      // Replicate цены не отдаёт (только `metrics.predict_time`), поэтому
      // рубли здесь — `null`, если upstream не прислал явное поле `cost`
      // (KI-371-смежное: выдуманная сумма хуже отсутствия).
      costRub: readCostRub(payload.metrics, this.usdRubRate),
      error: status === 'failed' ? readPredictionError(payload) : null,
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
   * @returns id предсказания либо `null`
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
   * Запоминает созданное предсказание под ключом идемпотентности.
   *
   * @param key - ключ идемпотентности
   * @param taskId - id созданного предсказания
   */
  private writeIdempotency(key: string, taskId: string): void {
    if (taskId.length === 0) {
      return;
    }

    this.idempotency.set(key, {
      taskId,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Бросает ошибку, если токен не задан.
   *
   * @throws MediaProviderException если `REPLICATE_API_TOKEN` пуст
   */
  private assertToken(): void {
    if (!this.token) {
      throw new MediaProviderException(
        this.name,
        'REPLICATE_API_TOKEN не задан',
      );
    }
  }
}

/**
 * Убирает префикс провайдера из id модели.
 *
 * Реестр отдаёт id в пространстве имён (`replicate:owner/name`), а в Replicate
 * уходит только `owner/name`. Префикс допускается и без разделителя — так
 * значения из старых workflow (и из тестов) не приходится переписывать.
 *
 * @param modelId - id модели из каталога или из `data.model` узла
 * @returns id модели в формате Replicate
 */
export function normalizeReplicateId(modelId: string): string {
  const prefix = 'replicate:';

  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

/**
 * Разделяет модель и версию (`owner/name:hash`).
 *
 * @param modelId - id модели в формате Replicate
 * @returns путь модели и хеш версии (если он указан)
 */
function splitVersion(modelId: string): { model: string; version?: string } {
  const separator = modelId.lastIndexOf(':');

  if (separator <= 0) {
    return { model: modelId };
  }

  return {
    model: modelId.slice(0, separator),
    version: modelId.slice(separator + 1),
  };
}

/**
 * Собирает `input` предсказания из запроса.
 *
 * @param input - вход создания задачи
 * @returns объект `input` для Replicate
 */
function buildInput(input: CreateMediaTaskInput): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...input.params };

  if (input.prompt !== undefined && input.prompt.length > 0) {
    payload.prompt = input.prompt;
  }

  // KI-196: входные файлы по ролям. Replicate принимает их как поля модели
  // (`image`, `mask`, `audio`), поэтому роль без массива — берём первый файл;
  // если роль называется иначе, кладём и её, и алиас `image`.
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
 * Приводит статус Replicate к внутреннему статусу задачи.
 *
 * @param status - статус upstream
 * @returns `queued` | `running` | `done` | `failed`
 */
function mapStatus(
  status: string,
): MediaTaskResult['status'] {
  switch (status) {
    case 'succeeded':
      return 'done';
    case 'failed':
    case 'canceled':
      return 'failed';
    case 'processing':
      return 'running';
    default:
      return 'queued';
  }
}

/**
 * Извлекает URL-ы результата из поля `output`.
 *
 * Replicate отдаёт результат по-разному: строкой (одна картинка), массивом
 * строк (несколько), массивом объектов `{ url }` или объектом с полем `url`.
 *
 * @param output - поле `output` предсказания
 * @returns список `http(s)`-ссылок (пустой, если результата нет)
 */
function readOutputUrls(output: unknown): string[] {
  if (typeof output === 'string') {
    return isHttpUrl(output) ? [output] : [];
  }

  if (Array.isArray(output)) {
    return output.flatMap((item) => readOutputUrls(item));
  }

  if (isJsonObject(output)) {
    const url = readString(output.url);

    if (url !== null && isHttpUrl(url)) {
      return [url];
    }
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
 * Читает стоимость предсказания в рублях.
 *
 * Replicate не отдаёт цену генерации: в `metrics` есть только время
 * (`predict_time`), а тариф зависит от модели. Явное поле `cost` (если
 * upstream его когда-нибудь добавит) пересчитывается в рубли по курсу, иначе
 * возвращается `null`: **выдуманная сумма в `node_runs.cost_rub` хуже
 * отсутствия**. Бюджет запуска при этом не страдает — он проверяется оценкой
 * из каталога **до** платного вызова (KI-048).
 *
 * @param metrics - поле `metrics` предсказания (любое значение из JSON)
 * @param usdRubRate - курс USD→RUB для пересчёта явной цены
 * @returns стоимость в рублях либо `null`, если upstream её не отдал
 */
function readCostRub(metrics: unknown, usdRubRate: number): number | null {
  if (!isJsonObject(metrics)) {
    return null;
  }

  const explicit = readNumber(metrics.cost);

  return explicit === null ? null : explicit * usdRubRate;
}

/**
 * Читает причину падения предсказания.
 *
 * @param payload - разобранное предсказание
 * @returns текст причины (никогда не `null`: без причины узел показал бы
 *   «причина неизвестна»)
 */
function readPredictionError(payload: Record<string, unknown>): string {
  const direct = readString(payload.error);

  if (direct !== null) {
    return direct;
  }

  const nested = payload.error;

  if (isJsonObject(nested)) {
    const message = readString(nested.message) ?? readString(nested.detail);

    if (message !== null) {
      return message;
    }
  }

  return readString(payload.detail) ?? 'предсказание завершилось с ошибкой';
}

/**
 * Читает скалярные параметры модели из параметров вызова инструмента.
 *
 * Служебные ключи (`model`, `idempotencyKey`, `inputs`, `audioUrl`) отсекаются:
 * они управляют вызовом, а не уходят в модель.
 *
 * @param params - параметры вызова инструмента
 * @returns скалярные параметры для `input`
 */
function readToolModelParams(
  params: ImageToolParams,
): Record<string, string | number | boolean> {
  const reserved = new Set([
    'model',
    'idempotencyKey',
    'inputs',
    'audioUrl',
    'prompt',
  ]);
  const collected: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(params)) {
    if (reserved.has(key)) {
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
 * @returns промпт либо `null` — «поле не передавать»
 */
function readToolPrompt(
  tool: ImageToolOperation,
  requested: unknown,
): string | null {
  if (typeof requested === 'string' && requested.trim().length > 0) {
    return requested.trim();
  }

  return DEFAULT_IMAGE_TOOL_PROMPTS[tool] ?? null;
}

/**
 * Строит ключ идемпотентности для инструмента, если его не передали.
 *
 * Ключ детерминирован парой «операция + вход», поэтому повтор не создаст
 * второе платное предсказание (KI-040).
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
