/**
 * OpenAI Images — прямой провайдер image-моделей (R7.3, DESIGN v0.9 § 3.3, KI-363).
 *
 * Провайдер обращается к `POST /v1/images/generations` напрямую (а не через
 * GPTunnel CreativeLab), поддерживая `gpt-image-1` и `dall-e-3`.
 *
 * ### Ключ и base URL
 *
 * Ключ берётся из `OPENAI_IMAGES_API_KEY`, а если он пуст — из
 * `OPENAI_API_KEY` (fallback: у пользователя уже есть ключ OpenAI для chat, и
 * требовать второй только ради картинок незачем). Base URL —
 * `OPENAI_IMAGES_BASE_URL` (дефолт `https://api.openai.com/v1`), потому что
 * изображения могут ходить через отдельный прокси.
 *
 * ### Почему `fetch`, а не SDK, и что с `client !== null`
 *
 * DESIGN § 3.3 говорит «уже знакомый SDK». SDK (`openai`) в проекте есть, но
 * он даёт только типизированную обёртку над тем же HTTP-запросом и прячет URL,
 * по которому реально ушёл запрос. Здесь используется `fetch`: тело и URL видны
 * в логе, поведение совпадает с `client.images.generate(...)` байт-в-байт, а
 * новых зависимостей не появляется. Для `applyToolAsync` (KI-380) нужен уже
 * `multipart/form-data` в `/v1/images/edits`; он собирается вручную через
 * стандартный `FormData`, поэтому Content-Type с boundary выставляет сам
 * `fetch`, а не наш код.
 *
 * `isConfigured === client !== null` в терминах R7.3 = «ключ задан»: клиент —
 * это `{ apiKey, baseUrl }`, собранный в конструкторе, и он `null`, если ключа
 * нет (провайдер тогда не регистрируется, RULES 4.6).
 *
 * ### Результат приходит в base64
 *
 * `gpt-image-1` (и при `response_format: 'b64_json'`) возвращает картинку
 * **содержимым**, а не ссылкой. Провайдер отдаёт её как `data:`-URI
 * (`data:image/png;base64,...`). Это честно отражает действительность, но
 * требует постоянного хранилища файлов перед использованием результата в
 * графе: `<img src>` такой результат не покажет (`isRenderableMediaUrl`
 * допускает только `http(s)`, KI-006), а `MediaNodeOutputsSchema` ждёт `url()`.
 * В R7.3 это осознанное ограничение (KI-378 в отчёте), а не выбор: хранилище —
 * срез R7.8 «Media storage (S3 / TTL)» по DESIGN v0.9 § 3.8.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import {
  isBlockedHostname,
  isBlockedIpAddress,
  isMetadataHostname,
  isMetadataIpAddress,
  normalizeHostname,
} from '../../common/utils/network-safety.js';
import type { MediaTaskResult } from '../dto/media-task.mapper.js';
import {
  IMAGE_TOOL_RESERVED_PARAM_KEYS,
  type ImageToolOperation,
  type ImageToolParams,
} from '../image-tool.js';
import {
  MediaProviderException,
  type CreateMediaTaskInput,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaParam,
  type MediaType,
} from '../media-provider.interface.js';
import {
  DEFAULT_USD_RUB_RATE,
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

/** Дефолтный адрес OpenAI API (совпадает с дефолтом env-схемы). */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** Таймаут запроса к `/v1/models` (проверка доступности). */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Таймаут генерации изображения.
 *
 * `gpt-image-1` на размере 1024×1536 синтезирует картинку десятками секунд;
 * лимит с запасом, иначе клиент оборвал бы соединение раньше готового ответа.
 */
const CREATE_TASK_TIMEOUT_MS = 180_000;
/** Таймаут скачивания входного изображения для `/images/edits`. */
const TOOL_DOWNLOAD_TIMEOUT_MS = 30_000;
/**
 * Максимальный размер входного изображения.
 *
 * OpenAI Images принимает файлы до 25 МБ; проверяем и `Content-Length`, и
 * фактический размер, потому что chunked-ответ может не объявлять длину.
 */
const MAX_TOOL_IMAGE_BYTES = 25 * 1024 * 1024;
/**
 * Модели, для которых OpenAI поддерживает `/v1/images/edits`.
 *
 * `dall-e-3` редактирование не поддерживает: его наличие в каталоге генерации
 * не означает поддержку инструментов. Неподдерживаемая модель отвергается до
 * скачивания и платного запроса.
 */
const EDIT_MODELS: ReadonlySet<string> = new Set(['gpt-image-1', 'dall-e-2']);
/** Операции, которые действительно являются редактированием файла. */
const EDIT_OPERATIONS: ReadonlySet<ImageToolOperation> = new Set([
  'upscale',
  'bg_removal',
]);
/** MIME-типы, которые принимает `/v1/images/edits`. */
const EDIT_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
/** Дефолтный TTL кэша каталога и записей идемпотентности (15 минут). */
const DEFAULT_CACHE_TTL_MS = 900_000;
/** Тип содержимого `data:`-URI по имени формата ответа. */
const MIME_BY_FORMAT: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Параметр `size` (у OpenAI это размер, а не соотношение сторон).
 *
 * Ключ именно `size`: исполнитель узла отправляет из формы только поля,
 * объявленные каталогом (`readParamsAsync`, KI-181), поэтому `aspect_ratio`
 * сюда бы не попал — и модель вернула бы размер по умолчанию.
 */
const SIZE_PARAM: MediaParam = {
  key: 'size',
  type: 'enum',
  label: 'wfc_size',
  default: '1024x1024',
  options: [
    { value: '1024x1024', label: 'wfc_opt_square' },
    { value: '1536x1024', label: 'wfc_opt_landscape' },
    { value: '1024x1536', label: 'wfc_opt_portrait' },
  ],
};

/** Параметр `quality` (только `gpt-image-1`). */
const QUALITY_PARAM: MediaParam = {
  key: 'quality',
  type: 'enum',
  label: 'wfc_quality',
  default: 'auto',
  options: [
    { value: 'auto', label: 'wfc_opt_auto' },
    { value: 'low', label: 'wfc_opt_low' },
    { value: 'medium', label: 'wfc_opt_medium' },
    { value: 'high', label: 'wfc_opt_high' },
  ],
};

/**
 * Каталог моделей OpenAI Images.
 *
 * Цена за генерацию у OpenAI зависит от размера, качества и числа картинок,
 * поэтому `priceUsd` не задан (`price: 0`): выдуманная ставка в бюджете (KI-048)
 * хуже отсутствия. Модель без цены не обходит предохранитель — превышение
 * ловится по уже потраченному (см. `MediaNodeExecutor.findModelPriceRubAsync`).
 */
export const OPENAI_IMAGE_MODELS: readonly DirectModelSpec[] = [
  {
    id: 'gpt-image-1',
    code: 'gpt-image-1',
    params: [SIZE_PARAM, QUALITY_PARAM],
  },
  {
    id: 'dall-e-3',
    code: 'dall-e-3',
    params: [
      SIZE_PARAM,
      {
        key: 'quality',
        type: 'enum',
        label: 'wfc_quality',
        default: 'standard',
        options: [
          { value: 'standard', label: 'wfc_opt_standard' },
          { value: 'hd', label: 'wfc_opt_hd' },
        ],
      },
    ],
  },
];

/**
 * Прямой провайдер OpenAI Images.
 *
 * Без ключа провайдер не падает на старте (`isConfigured === false`), а бросает
 * {@link MediaProviderException} при вызове.
 */
@Injectable()
export class OpenAiImagesProvider implements IMediaProvider {
  readonly name = 'openai_images';

  private readonly logger = new Logger(OpenAiImagesProvider.name);
  /**
   * Клиент провайдера: ключ и base URL. `null` — ключа нет (R7.3:
   * `isConfigured` проверяет именно `client !== null`).
   */
  private readonly client: { apiKey: string; baseUrl: string } | null;
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
   * Записи идемпотентности: ключ → готовая задача.
   *
   * `POST /v1/images/generations` не имеет ни серверного ключа идемпотентности,
   * ни `taskId`: запрос либо возвращает готовые картинки, либо падает. Поэтому
   * под ключом хранится **готовый результат** целиком (включая `data:`-URI), и
   * повтор (job-level retry, KI-040) не создаёт вторую платную генерацию.
   * Хранилище живёт в памяти процесса и ограничено TTL.
   */
  private readonly idempotency = new Map<
    string,
    { result: MediaTaskResult; expiresAt: number }
  >();

  /**
   * @param config - доступ к переменным окружения OpenAI Images (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const apiKey =
      config.get<string>('OPENAI_IMAGES_API_KEY') ??
      config.get<string>('OPENAI_API_KEY') ??
      '';
    const baseUrl = (
      config.get<string>('OPENAI_IMAGES_BASE_URL') ?? DEFAULT_BASE_URL
    ).replace(/\/+$/, '');

    this.client = apiKey.length > 0 ? { apiKey, baseUrl } : null;
    this.usdRubRate =
      config.get<number>('MEDIA_USD_RUB_RATE') ?? DEFAULT_USD_RUB_RATE;
    this.cacheTtlMs = DEFAULT_CACHE_TTL_MS;

    if (!this.client) {
      this.logger.warn(
        'OPENAI_IMAGES_API_KEY (и OPENAI_API_KEY) не заданы — модели OpenAI Images недоступны',
      );
    }
  }

  /** Готов ли провайдер к вызовам (`client !== null`, то есть задан ключ). */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Возвращает модели OpenAI Images указанного типа.
   *
   * Каталог — {@link OPENAI_IMAGE_MODELS}, кэшируется на 15 минут. Первый вызов
   * проверяет доступность `GET /v1/models` (с тем же ключом): без этого
   * недействительный ключ или опечатка в base URL всплыли бы только на платном
   * запросе генерации.
   *
   * @param type - тип модели, либо `undefined` — все типы
   * @returns описания моделей в camelCase
   * @throws MediaProviderException если ключ не задан, upstream недоступен или
   *   ответил ошибкой
   */
  async listModelsAsync(
    type?: MediaType,
  ): Promise<readonly MediaModelInfo[]> {
    const client = this.requireClient();

    const cacheKey: MediaType | 'ALL' = type ?? 'ALL';
    const cached = this.readCache(cacheKey);

    if (cached) {
      return cached;
    }

    await this.assertReachableAsync(client);

    const models = filterByType(this.catalog(), type);

    this.cache.set(cacheKey, {
      data: models,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    this.logger.debug(
      `Модели OpenAI Images (${cacheKey}): ${models.length} из каталога`,
    );

    return models;
  }

  /**
   * Сбрасывает кэш каталога и записи идемпотентности.
   *
   * Нужен тестам (не зависеть от порядка вызовов).
   */
  clearCache(): void {
    this.cache.clear();
    this.idempotency.clear();
  }

  /**
   * Создаёт изображение через `/v1/images/generations`.
   *
   * Тело: `{ model, prompt, n: 1, response_format: 'b64_json', ...params }`.
   * `response_format` задаётся явно: у `dall-e-3` дефолт — ссылка с TTL 60
   * минут, а нам нужен результат, который не «протухнет» до записи в
   * `node_runs.outputs`.
   *
   * `idempotency_key` у OpenAI нет, поэтому повтор с тем же ключом возвращает
   * сохранённый результат и **не уходит в upstream** (KI-040).
   *
   * @param input - модель, промпт, параметры и ключ идемпотентности
   * @returns задача: OpenAI отвечает только готовым результатом, поэтому
   *   статус всегда `done` (или исключение)
   * @throws MediaProviderException если ключ не задан, промпт пуст, upstream
   *   недоступен или ответил ошибкой
   */
  async createTaskAsync(input: CreateMediaTaskInput): Promise<MediaTaskResult> {
    const client = this.requireClient();
    const cached = this.readIdempotency(input.idempotencyKey);

    if (cached) {
      this.logger.log(
        `Повтор с ключом идемпотентности ${input.idempotencyKey}: результат взят из памяти (новой генерации нет)`,
      );

      return cached;
    }

    const modelId = normalizeOpenAiImagesId(input.model);
    const prompt = input.prompt?.trim() ?? '';

    if (prompt.length === 0) {
      throw new MediaProviderException(
        this.name,
        `модель ${modelId} требует промпт: пустой запрос не отправлен`,
      );
    }

    const body: Record<string, unknown> = {
      ...input.params,
      model: modelId,
      prompt,
      n: 1,
      response_format: 'b64_json',
    };
    const response = await this.sendAsync(
      client,
      `${client.baseUrl}/images/generations`,
      body,
      CREATE_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        `не удалось создать изображение моделью ${modelId}`,
        response,
      );
    }

    const payload = await this.parseJsonAsync(response);
    const result = this.toTaskResult(payload, modelId, input.params);

    this.writeIdempotency(input.idempotencyKey, result);
    this.logger.log(
      `Изображение OpenAI создано: model=${modelId}, images=${result.resultUrls.length}`,
    );

    return result;
  }

  /**
   * Возвращает состояние задачи.
   *
   * У `/v1/images/generations` нет отложенных задач: запрос либо вернул
   * картинку, либо упал. Создание в {@link createTaskAsync} всегда даёт
   * `done`/`failed`, поэтому опрашивать нечего, и метод сообщает об этом явной
   * ошибкой вместо выдуманного статуса: тихая «заглушка» скрыла бы, что
   * `MediaNodeExecutor.pollAsync` вызван там, где опрос не поддерживается.
   *
   * @param taskId - id задачи (у OpenAI Images их не существует)
   * @returns результат задачи — никогда (метод всегда бросает)
   * @throws MediaProviderException всегда: опрос задач OpenAI Images не
   *   поддерживается
   */
  async getTaskAsync(taskId: string): Promise<MediaTaskResult> {
    this.requireClient();

    throw new MediaProviderException(
      this.name,
      `опрос задач не поддерживается: OpenAI Images отвечает готовым результатом (запрошен ${taskId})`,
    );
  }

  /**
   * Применяет media-инструмент к готовому файлу через `/v1/images/edits`
   * (KI-380, R7.1).
   *
   * OpenAI Images не принимает ссылку на вход: эндпоинт редактирования ждёт
   * `multipart/form-data` с самим файлом. Поэтому метод:
   * 1. проверяет `http(s)`-ссылку и скачивает изображение в буфер (лимит 25 МБ);
   * 2. собирает `FormData` с `image` (Blob), `prompt`, `model` и скалярными
   *    параметрами модели;
   * 3. отправляет POST в `/v1/images/edits` и разбирает `url`/`b64_json` тем же
   *    {@link toTaskResult}, что и генерация.
   *
   * Поддерживаются только операции, которые действительно являются
   * редактированием изображения (`upscale`, `bg_removal`). Для `trim`,
   * `lipsync` и `chromakey` бросается понятная ошибка до скачивания: OpenAI
   * Images не умеет работать с видео и не объявляет модель хромакея (KI-418).
   *
   * @param input - публично доступный URL входного файла (`http`/`https`)
   * @param tool - операция инструмента (`upscale`, `bg_removal`)
   * @param params - служебные ключи (`model`, `prompt`, `idempotencyKey`) и
   *   параметры модели
   * @returns результат редактирования: `done` с `data:`-URI или URL-ом
   * @throws MediaProviderException если ключ не задан, ссылка на вход не
   *   `http(s)`, операция/модель не поддержана, upstream ответил ошибкой или
   *   файл превышает лимит
   */
  async applyToolAsync(
    input: string,
    tool: ImageToolOperation,
    params: ImageToolParams = {},
  ): Promise<MediaTaskResult> {
    const client = this.requireClient();

    if (!EDIT_OPERATIONS.has(tool)) {
      throw new MediaProviderException(
        this.name,
        `операция ${tool} не поддерживается OpenAI Images: доступны upscale и bg_removal`,
      );
    }

    const inputUrl = readHttpUrl(input, this.name, tool);
    const requestedModel =
      typeof params.model === 'string' && params.model.length > 0
        ? params.model
        : OPENAI_IMAGE_MODELS[0]?.id;

    if (!requestedModel) {
      throw new MediaProviderException(
        this.name,
        'каталог моделей пуст: нечего использовать для инструмента',
      );
    }

    const modelId = normalizeOpenAiImagesId(requestedModel);

    if (!EDIT_MODELS.has(modelId)) {
      throw new MediaProviderException(
        this.name,
        `модель ${modelId} не поддерживает /images/edits: доступны ${[...EDIT_MODELS].join(', ')}`,
      );
    }

    const idempotencyKey = readToolIdempotencyKey(params, tool, inputUrl);
    const cached = this.readIdempotency(idempotencyKey);

    if (cached) {
      this.logger.log(
        `Повтор с ключом идемпотентности ${idempotencyKey}: результат инструмента взят из памяти (нового редактирования нет)`,
      );

      return cached;
    }

    const image = await this.downloadToolImageAsync(inputUrl);
    const prompt = readEditPrompt(tool, params.prompt);
    const form = new FormData();

    // Копия в «чистый» Uint8Array: Buffer в Node типизирован как
    // `ArrayBufferLike`, а `BlobPart` требует ArrayBuffer без SharedArrayBuffer.
    const imageBytes = new Uint8Array(image.buffer.length);
    imageBytes.set(image.buffer);

    form.append('model', modelId);
    form.append('prompt', prompt);
    form.append('image', new Blob([imageBytes], { type: image.mime }), image.fileName);
    form.append('n', '1');

    // Скалярные параметры операции (`size`, `quality`, ...) уходят полями
    // формы. Служебные ключи (`model`, `prompt`, `idempotencyKey`, ...) уже
    // обработаны выше и в `params` формы не попадут.
    for (const [key, value] of Object.entries(readToolModelParams(params))) {
      // `n` уже зафиксирован выше: инструмент возвращает один результат
      // (узел сохраняет первый URL), дублировать поле в форме нельзя.
      if (key === 'n') {
        continue;
      }

      form.append(key, String(value));
    }

    const response = await this.sendMultipartAsync(
      client,
      `${client.baseUrl}/images/edits`,
      form,
      CREATE_TASK_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        `не удалось выполнить ${tool} моделью ${modelId}`,
        response,
      );
    }

    const payload = await this.parseJsonAsync(response);
    const result = this.toTaskResult(payload, modelId, readToolModelParams(params));

    this.writeIdempotency(idempotencyKey, result);
    this.logger.log(
      `Инструмент OpenAI Images ${tool} выполнен: model=${modelId}, inputLen=${inputUrl.length}, images=${result.resultUrls.length}`,
    );

    return result;
  }

  /**
   * Строит каталог моделей OpenAI Images с ценами в рублях.
   *
   * @returns описания моделей провайдера
   */
  private catalog(): readonly MediaModelInfo[] {
    return OPENAI_IMAGE_MODELS.map((spec) =>
      toDirectModelInfo(this.name, spec, this.usdRubRate),
    );
  }

  /**
   * Проверяет доступность `GET /v1/models` с ключом провайдера.
   *
   * @param client - клиент провайдера (ключ + base URL)
   * @throws MediaProviderException если upstream недоступен или ответил ошибкой
   */
  private async assertReachableAsync(client: {
    apiKey: string;
    baseUrl: string;
  }): Promise<void> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${client.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          Accept: 'application/json',
        },
        signal,
      });
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        signal.aborted
          ? 'запрос к API OpenAI Images истёк по таймауту'
          : 'не удалось обратиться к API OpenAI Images',
        { cause: error, retryable: true },
      );
    }

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        'не удалось получить список моделей',
        response,
      );
    }
  }

  /**
   * Отправляет запрос генерации.
   *
   * @param client - клиент провайдера (ключ + base URL)
   * @param url - полный URL запроса
   * @param body - тело запроса (сериализуется в JSON)
   * @param timeoutMs - таймаут запроса (RULES 4.19)
   * @returns HTTP-ответ
   * @throws MediaProviderException при сетевой ошибке или таймауте (retryable)
   */
  private async sendAsync(
    client: { apiKey: string; baseUrl: string },
    url: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        signal.aborted
          ? 'запрос к API OpenAI Images истёк по таймауту'
          : 'не удалось обратиться к API OpenAI Images',
        { cause: error, retryable: true },
      );
    }
  }

  /**
   * Скачивает входное изображение для `/images/edits` в буфер.
   *
   * `fetch` с `redirect: 'error'`: редирект на приватный адрес — типичный
   * обход SSRF-проверки, поэтому цепочка редиректов не поддерживается.
   * `Content-Length` проверяется до чтения, фактический размер — после:
   * chunked-ответ может не объявлять длину (RULES 4.19).
   *
   * @param inputUrl - публично доступный `http(s)`-URL изображения
   * @returns буфер, MIME и имя файла для multipart-части
   * @throws MediaProviderException если адрес запрещён, сеть/таймаут, ответ
   *   не 2xx, файл пуст/больше лимита или формат не поддержан
   */
  private async downloadToolImageAsync(
    inputUrl: string,
  ): Promise<{ buffer: Buffer; mime: string; fileName: string }> {
    assertSafeToolInputUrl(inputUrl, this.name);

    const signal = AbortSignal.timeout(TOOL_DOWNLOAD_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(inputUrl, {
        method: 'GET',
        headers: { Accept: 'image/*' },
        redirect: 'error',
        signal,
      });
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        signal.aborted
          ? 'скачивание входного изображения истекло по таймауту'
          : 'не удалось скачать входное изображение',
        { cause: error, retryable: true },
      );
    }

    if (!response.ok) {
      throw await buildHttpErrorAsync(
        this.name,
        'не удалось скачать входное изображение',
        response,
      );
    }

    const rawLength = response.headers.get('content-length');
    const declaredLength = rawLength === null ? Number.NaN : Number(rawLength);

    if (Number.isFinite(declaredLength) && declaredLength > MAX_TOOL_IMAGE_BYTES) {
      throw new MediaProviderException(
        this.name,
        `входное изображение больше лимита ${MAX_TOOL_IMAGE_BYTES} байт`,
      );
    }

    let buffer: Buffer;

    try {
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        'не удалось прочитать входное изображение',
        { cause: error, retryable: true },
      );
    }

    if (buffer.length === 0) {
      throw new MediaProviderException(
        this.name,
        'входное изображение пустое',
      );
    }

    if (buffer.length > MAX_TOOL_IMAGE_BYTES) {
      throw new MediaProviderException(
        this.name,
        `входное изображение больше лимита ${MAX_TOOL_IMAGE_BYTES} байт`,
      );
    }

    const mime = readToolImageMime(
      response.headers.get('content-type'),
      inputUrl,
    );

    if (mime === null) {
      throw new MediaProviderException(
        this.name,
        'формат входного изображения не поддержан: нужен PNG, JPEG или WebP',
      );
    }

    return {
      buffer,
      mime,
      fileName: `input.${extensionForMime(mime)}`,
    };
  }

  /**
   * Отправляет `multipart/form-data` в `/v1/images/edits`.
   *
   * `Content-Type` не задаётся вручную: `fetch` сам добавляет
   * `multipart/form-data; boundary=...`. Если задать заголовок без boundary,
   * upstream ответит 400.
   *
   * @param client - клиент провайдера (ключ + base URL)
   * @param url - полный URL эндпоинта
   * @param body - собранная форма
   * @param timeoutMs - таймаут запроса (RULES 4.19)
   * @returns HTTP-ответ
   * @throws MediaProviderException при сетевой ошибке или таймауте (retryable)
   */
  private async sendMultipartAsync(
    client: { apiKey: string; baseUrl: string },
    url: string,
    body: FormData,
    timeoutMs: number,
  ): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);

    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          Accept: 'application/json',
        },
        body,
        signal,
      });
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        signal.aborted
          ? 'запрос к API OpenAI Images истёк по таймауту'
          : 'не удалось обратиться к API OpenAI Images',
        { cause: error, retryable: true },
      );
    }
  }

  /**
   * Читает JSON-тело ответа, проверяя, что это словарь (RULES 1.17).
   *
   * @param response - успешный HTTP-ответ
   * @returns разобранный объект
   * @throws MediaProviderException если тело не JSON или не словарь
   */
  private async parseJsonAsync(
    response: Response,
  ): Promise<Record<string, unknown>> {
    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      throw new MediaProviderException(
        this.name,
        'OpenAI Images вернул ответ не в формате JSON',
        { cause: error },
      );
    }

    if (!isJsonObject(payload)) {
      throw new MediaProviderException(
        this.name,
        'неожиданный формат ответа OpenAI Images',
      );
    }

    return payload;
  }

  /**
   * Приводит ответ `/v1/images/generations` к внутреннему виду задачи.
   *
   * @param payload - разобранный ответ upstream (`{ data: [...] }`)
   * @param modelId - id модели (OpenAI его в ответе не повторяет)
   * @param params - параметры запроса (нужен `output_format` для MIME)
   * @returns результат задачи: `done` с `data:`-URI либо `failed`
   * @throws MediaProviderException если upstream не отдал ни одного изображения
   */
  private toTaskResult(
    payload: Record<string, unknown>,
    modelId: string,
    params: Record<string, string | number | boolean>,
  ): MediaTaskResult {
    const entries = Array.isArray(payload.data) ? payload.data : [];
    const urls: string[] = [];

    for (const entry of entries) {
      if (!isJsonObject(entry)) {
        continue;
      }

      const url = readString(entry.url);

      if (url !== null && isHttpUrl(url)) {
        urls.push(url);
        continue;
      }

      const base64 = readString(entry.b64_json);

      if (base64 !== null) {
        urls.push(toDataUri(base64, readFormat(params)));
      }
    }

    if (urls.length === 0) {
      // Ответ распознан (есть `created`), но картинок в нём нет — это либо
      // изменение контракта, либо модерация отфильтровала результат. Пустой
      // `resultUrls` узел принял бы за успех с `mediaUrl: null`.
      const details =
        readNumber(payload.created) === null
          ? 'OpenAI Images вернул ответ без ожидаемых полей'
          : 'OpenAI Images не вернул ни одного изображения';

      throw new MediaProviderException(this.name, details);
    }

    return {
      // У OpenAI нет id задачи: генерация синхронная. Детерминированный
      // псевдо-id нужен, чтобы выходы узла (`taskId`) оставались заполненными
      // и в логе было видно, к какой модели относится результат.
      taskId: `openai-images:${modelId}`,
      model: modelId,
      status: 'done',
      resultUrls: urls,
      // Цена за картинку зависит от размера и качества, а в ответе её нет:
      // `null` вместо выдуманной суммы (KI-048 ловит превышение по тратам).
      costRub: null,
      error: null,
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
   * @returns сохранённый результат задачи либо `null`
   */
  private readIdempotency(key: string): MediaTaskResult | null {
    const entry = this.idempotency.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.idempotency.delete(key);

      return null;
    }

    return entry.result;
  }

  /**
   * Запоминает результат под ключом идемпотентности.
   *
   * @param key - ключ идемпотентности
   * @param result - готовый результат задачи
   */
  private writeIdempotency(key: string, result: MediaTaskResult): void {
    this.idempotency.set(key, {
      result,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /**
   * Возвращает клиента или бросает ошибку.
   *
   * @returns клиент провайдера (`apiKey` + `baseUrl`)
   * @throws MediaProviderException если ключ не задан
   */
  private requireClient(): { apiKey: string; baseUrl: string } {
    if (!this.client) {
      throw new MediaProviderException(
        this.name,
        'OPENAI_IMAGES_API_KEY (и OPENAI_API_KEY) не заданы',
      );
    }

    return this.client;
  }
}

/**
 * Убирает префикс провайдера из id модели.
 *
 * @param modelId - id модели из каталога или из `data.model` узла
 * @returns id модели в формате OpenAI (`gpt-image-1`)
 */
export function normalizeOpenAiImagesId(modelId: string): string {
  const prefix = 'openai_images:';

  return modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId;
}

/**
 * Собирает `data:`-URI из base64-содержимого.
 *
 * @param base64 - содержимое файла из `b64_json`
 * @param format - формат ответа (`png`, `jpeg`, ...)
 * @returns URI вида `data:image/png;base64,...`
 */
function toDataUri(base64: string, format: string): string {
  const mime = MIME_BY_FORMAT[format] ?? 'image/png';

  return `data:${mime};base64,${base64}`;
}

/**
 * Читает запрошенный формат ответа.
 *
 * @param params - параметры запроса
 * @returns имя формата в нижнем регистре (`png` по умолчанию)
 */
function readFormat(params: Record<string, string | number | boolean>): string {
  const value = params.output_format;

  return typeof value === 'string' ? value.toLowerCase() : 'png';
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
 * Собирает промпт для `/images/edits`.
 *
 * @param tool - операция инструмента (`upscale` или `bg_removal`)
 * @param requested - промпт, заданный вызывающим кодом
 * @returns непустой промпт
 */
function readEditPrompt(
  tool: ImageToolOperation,
  requested: unknown,
): string {
  if (typeof requested === 'string' && requested.trim().length > 0) {
    return requested.trim();
  }

  return tool === 'bg_removal'
    ? 'Remove the background from this image and keep only the main subject on a clean background.'
    : 'Upscale this image to a higher resolution, preserving details, composition and colors.';
}

/**
 * Проверяет, что URL входного изображения не ведёт во внутреннюю сеть.
 *
 * Полная защита от DNS rebinding живёт в `SafeHttpClient`, но он отдаёт тело
 * строкой и не подходит для бинарного файла. Здесь закрыты дешёвые векторы:
 * `localhost`/metadata-имена, приватные IP-литералы, URL с учётными данными и
 * редиректы (`redirect: 'error'` в {@link downloadToolImageAsync}).
 *
 * @param inputUrl - проверяемая ссылка
 * @param provider - имя провайдера для текста ошибки
 * @throws MediaProviderException если URL некорректен или ведёт на запрещённый
 *   адрес
 */
function assertSafeToolInputUrl(inputUrl: string, provider: string): void {
  let url: URL;

  try {
    url = new URL(inputUrl);
  } catch {
    throw new MediaProviderException(
      provider,
      `некорректная ссылка на входное изображение: ${inputUrl.slice(0, 120)}`,
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new MediaProviderException(
      provider,
      'ссылка на входное изображение не должна содержать учётные данные',
    );
  }

  const hostname = normalizeHostname(url.hostname);

  if (isMetadataHostname(hostname) || isBlockedHostname(hostname)) {
    throw new MediaProviderException(
      provider,
      `ссылка на входное изображение ведёт на запрещённый хост: ${hostname}`,
    );
  }

  if (
    isIP(hostname) !== 0 &&
    (isMetadataIpAddress(hostname) || isBlockedIpAddress(hostname))
  ) {
    throw new MediaProviderException(
      provider,
      `ссылка на входное изображение ведёт на приватный адрес: ${hostname}`,
    );
  }
}

/**
 * Определяет MIME входного изображения по `Content-Type` или расширению URL.
 *
 * @param contentType - заголовок `Content-Type` ответа (может отсутствовать)
 * @param inputUrl - исходный URL (fallback по расширению)
 * @returns поддержанный MIME либо `null`
 */
function readToolImageMime(
  contentType: string | null,
  inputUrl: string,
): string | null {
  const normalized =
    contentType?.split(';')[0]?.trim().toLowerCase() ?? '';

  if (normalized.startsWith('image/')) {
    return EDIT_MIME_BY_EXTENSION[normalized.slice('image/'.length)] ?? null;
  }

  try {
    const path = new URL(inputUrl).pathname;
    const extension = path.split('.').pop()?.toLowerCase() ?? '';

    return EDIT_MIME_BY_EXTENSION[extension] ?? null;
  } catch {
    return null;
  }
}

/**
 * Возвращает расширение файла для MIME.
 *
 * @param mime - поддержанный MIME
 * @returns `png`, `jpg` или `webp`
 */
function extensionForMime(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] ?? 'png');
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
