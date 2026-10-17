/**
 * Режим reasoning для моделей, которые его поддерживают (R6.3.1, KI-193).
 *
 * `'off'` — не передавать провайдеру поле `reasoning_effort` вовсе (а не
 * `'none'`: часть прокси не знает такого значения).
 */
export type ReasoningEffort =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

/** Опции вызова LLM. */
export interface LlmGenerateOptions {
  /** Модель (id, как её знает провайдер). */
  model: string;
  /** Системный промпт (опционально). */
  system?: string;
  /** Лимит токенов ответа. */
  maxTokens?: number;
  /** Температура. */
  temperature?: number;
  /**
   * Режим reasoning (KI-193).
   *
   * Передаётся провайдеру, только если `ModelInfo.supportsReasoning === true`;
   * `'off'` и отсутствие значения означают «поле не отправлять».
   */
  reasoningEffort?: ReasoningEffort;
  /** AbortSignal для отмены/таймаута (RULES 4.19). */
  signal?: AbortSignal;
}

/** Метрики вызова LLM. */
export interface LlmUsage {
  /** Токенов на входе (null, если провайдер не отдал значение). */
  inputTokens: number | null;
  /** Токенов на выходе (null, если провайдер не отдал значение). */
  outputTokens: number | null;
  /**
   * Сколько входных токенов провайдер отдал из промпт-кэша (R7.7, KI-055).
   *
   * Источники: Anthropic `cache_read_input_tokens`, OpenAI
   * `prompt_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`.
   * Отсутствие поля — «кэш не применялся или провайдер метрику не отдал»
   * (нулевые значения не проставляются).
   */
  cacheReadTokens?: number;
  /**
   * Сколько токенов записано в промпт-кэш (R7.7, KI-150).
   *
   * Есть только у Anthropic (`cache_creation_input_tokens`): такие токены
   * стоят дороже обычных входных, поэтому их нельзя сваливать в `inputTokens`.
   */
  cacheCreationTokens?: number;
  /**
   * Входят ли кэш-токены в {@link inputTokens} (R7.7).
   *
   * `undefined`/`true` — входят (OpenAI, DeepSeek): при расчёте стоимости
   * обычная цена применяется к остатку `inputTokens - cacheRead - cacheCreation`.
   * `false` — не входят (Anthropic): `input_tokens` там только некешированные.
   */
  cacheTokensIncludedInInput?: boolean;
  /** Модель, фактически использованная провайдером. */
  model: string;
}

/** Результат вызова LLM. */
export interface LlmGenerateResult {
  /** Текст ответа. */
  text: string;
  /** Метрики вызова (null, если провайдер их не отдал). */
  usage: LlmUsage | null;
  /**
   * Обслужен ли вызов локальным провайдером (KI-148).
   *
   * Проставляется {@link LlmService} из флага провайдера, чтобы вызывающий код
   * (executor узла) мог посчитать стоимость как `0` для локальных моделей, не
   * имея доступа к самому провайдеру. Отсутствие значения — «не локальный».
   */
  isLocal?: boolean;
}

/**
 * Модальность: что модель принимает или отдаёт.
 *
 * 'text' — текстовая (вход и/или выход);
 * 'vision' — понимает изображения на входе;
 * 'image-generation' — генерирует изображения на выходе;
 * 'audio' — TTS/STT;
 * 'video' — генерирует или понимает видео;
 * 'embedding' — векторное представление.
 */
export type ModelModality =
  | 'text'
  | 'vision'
  | 'image-generation'
  | 'audio'
  | 'video'
  | 'embedding';

/**
 * Полный список модальностей для рантайм-проверок (Zod-схемы, парсеры).
 *
 * Дублирует {@link ModelModality}: тип живёт только на этапе компиляции, а
 * валидация внешних данных (env) нуждается в списке значений во время работы.
 */
export const MODEL_MODALITIES: readonly ModelModality[] = [
  'text',
  'vision',
  'image-generation',
  'audio',
  'video',
  'embedding',
];

/** Декларация модели: id, label, модальности. */
export interface ModelInfo {
  /** id для API-вызова (уходит в upstream как есть). */
  readonly id: string;
  /** Человекочитаемое имя для UI. */
  readonly label: string;
  /**
   * Что модель принимает на входе.
   * Минимум один: `['text']` для чисто текстовых.
   */
  readonly inputModalities: readonly ModelModality[];
  /**
   * Что модель отдаёт на выходе.
   * Минимум один: `['text']` для чисто текстовых.
   */
  readonly outputModalities: readonly ModelModality[];
  /**
   * Поддерживает ли модель reasoning (R6.3.1, KI-193).
   *
   * `true` — провайдер может передать `reasoning_effort`; отсутствие значения
   * трактуется как `false` (поле не отправляем, чтобы не ловить 400 у прокси).
   */
  readonly supportsReasoning?: boolean;
  /**
   * Дефолтный лимит токенов ответа для этой модели (KI-183).
   *
   * У reasoning-моделей выше: рассуждения расходуют бюджет ответа, и при
   * лимите 1024 `content` остаётся пустым.
   */
  readonly defaultMaxTokens?: number;
}

/** Опции вызова embeddings (R7.4a). */
export interface EmbeddingOptions {
  /**
   * id модели эмбеддингов. По умолчанию — `text-embedding-3-small`
   * (1536 измерений — как колонка `vector(1536)`).
   */
  model?: string;
  /** AbortSignal для отмены/таймаута (RULES 4.19). */
  signal?: AbortSignal;
}

/** Провайдер LLM. */
export interface ILlmProvider {
  /**
   * Идентификатор провайдера: `anthropic`, `openai`, `routerai`, `deepseek`,
   * `yandex`, `lmstudio`.
   */
  readonly name: string;
  /** Модели, доступные у провайдера, с их модальностями (v0.6.0a). */
  readonly models: readonly ModelInfo[];
  /**
   * Поддерживает ли провайдер embeddings (R7.4a).
   *
   * `false`/отсутствие поля — провайдер не умеет `/embeddings` (Anthropic),
   * и `resolveEmbeddingProviderAsync` его пропускает. Флаг нужен потому, что
   * требование контракта «метод есть» и «метод работает» — разные вещи:
   * Anthropic обязан реализовать `embedAsync`, но только чтобы бросить
   * {@link EmbeddingNotSupportedException}.
   */
  readonly supportsEmbeddings?: boolean;
  /**
   * Готов ли провайдер к вызовам.
   *
   * `true`, если API-ключ задан и клиент SDK создан. `false` — ключа нет;
   * вызовы будут падать с `LlmProviderException` (KI-039).
   */
  readonly isConfigured: boolean;
  /**
   * Локальный провайдер: модели запущены на своём железе (LM Studio) и
   * бесплатны для пользователя.
   *
   * Для таких провайдеров стоимость вызова — `0`, а не `null` («неизвестно»):
   * `null` в панели результата выглядит как отсутствие данных, хотя на самом
   * деле вызов ничего не стоил (KI-148).
   *
   * Поле опциональное, чтобы не трогать провайдеры, которые его не задают:
   * отсутствие значения трактуется как «не локальный» (`false`).
   */
  readonly isLocal?: boolean;
  /**
   * Сгенерировать текст (не-стриминговый для R3).
   *
   * @param prompt - пользовательский промпт (целиком не логируется, RULES 5.9)
   * @param options - модель, лимиты, отмена
   * @returns текст ответа и метрики вызова (KI-038)
   * @throws LlmProviderException при ошибке провайдера, таймауте или отсутствии ключа
   */
  generateAsync(prompt: string, options: LlmGenerateOptions): Promise<LlmGenerateResult>;

  /**
   * Получить эмбеддинги для набора текстов (R7.4a, DESIGN v0.9 § 3.4).
   *
   * Провайдеры без embeddings (Anthropic) обязаны реализовать метод, но
   * бросают {@link EmbeddingNotSupportedException}: контракт интерфейса един
   * для всех, а выбор провайдера делает
   * `LlmRegistryService.resolveEmbeddingProviderAsync`.
   *
   * Порядок векторов в ответе **совпадает** с порядком `texts` — executor
   * вектора полагается на это, склеивая текст и вектор.
   *
   * @param texts - тексты для векторизации; пустой массив — пустой результат
   * @param options - модель эмбеддингов и отмена (RULES 4.19)
   * @returns массив векторов: `result[i]` — эмбеддинг `texts[i]`
   * @throws EmbeddingNotSupportedException если провайдер не умеет embeddings
   * @throws LlmProviderException при ошибке провайдера, таймауте или отсутствии ключа
   */
  embedAsync(
    texts: string[],
    options?: EmbeddingOptions,
  ): Promise<number[][]>;
}

/**
 * Ошибка: выбранный провайдер не поддерживает embeddings (R7.4a).
 *
 * Наследуется от `Error`, а не от `LlmProviderException`: это не сбой вызова,
 * а несовместимая возможность провайдера. `retryable` у неё нет намеренно —
 * повтор с тем же провайдером даст тот же результат.
 */
export class EmbeddingNotSupportedException extends Error {
  /**
   * @param provider - идентификатор провайдера (например, `anthropic`)
   */
  constructor(provider: string) {
    super(`[${provider}] провайдер не поддерживает embeddings`);
    this.name = 'EmbeddingNotSupportedException';
  }
}

/**
 * Ошибка провайдера LLM.
 *
 * Наследуется от `Error` (а не от Nest `HttpException`): исключение живёт в
 * контексте worker'а и должно приводить к `run.status='failed'`, а не к
 * HTTP-ответу.
 */
export class LlmProviderException extends Error {
  /**
   * Признак «временной» ошибки: имеет ли смысл повторять вызов (KI-036).
   *
   * `true` — 429/5xx, таймаут, сетевой сбой; `false` — детерминированные
   * ошибки (400/401/403/404, пустой prompt, неизвестная модель).
   */
  readonly retryable: boolean;

  /**
   * @param provider - идентификатор провайдера (`anthropic`, `openai`,
   *   `routerai`, `deepseek`, `yandex`, `lmstudio`, а также `llm`/`registry`
   *   для ошибок уровня сервиса)
   * @param message - текст ошибки
   * @param options.cause - исходная ошибка (если есть)
   * @param options.retryable - можно ли повторять вызов (по умолчанию `false`)
   */
  constructor(
    provider: string,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'LlmProviderException';
    this.retryable = options.retryable ?? false;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
