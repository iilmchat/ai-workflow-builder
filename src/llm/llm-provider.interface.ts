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
  /**
   * Организация-арендатор вызова (v1.6.0 S8, FinOps).
   *
   * Нужна только кэшу ответов: ключ включает `orgId`, чтобы одинаковый
   * промпт двух организаций не смешивался. Провайдеру поле не передаётся —
   * `LlmRouterService` вырезает его перед вызовом.
   */
  orgId?: string;
  /**
   * Включить промпт-кэш для system-промпта (R7.7, KI-414).
   *
   * Поддержан только Anthropic: при `true` и длине system-промпта выше порога
   * (`PROMPT_CACHE_MIN_TOKENS`, по умолчанию 1024) последний блок `system`
   * помечается `cache_control: { type: 'ephemeral' }`. Остальные провайдеры
   * флаг игнорируют: у OpenAI/DeepSeek кэш включается автоматически, а
   * неизвестное поле ломало бы запросы прокси.
   *
   * Отсутствие значения трактуется как `false` — поведение до R7.7.
   */
  promptCache?: boolean;
  /** AbortSignal для отмены/таймаута (RULES 4.19). */
  signal?: AbortSignal;
  /**
   * Вызов использует tool-цикл (v1.3 S1, KI-617).
   *
   * Агент выставляет `true`: его LLM-шаг подразумевает инструменты, и роутер
   * не должен подменять модель на ту, которая не умеет tool-calling. Обычные
   * LLM-узлы флаг не ставят: у них инструментов нет, и требование
   * `supportsTools` к fallback было бы ложным.
   */
  requiresTools?: boolean;
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

/**
 * Статус стоимости вызова LLM (v1.6.0 S8.1, KI-152).
 *
 * `exact` — облачный вызов с известными токенами: `costUsd` посчитан по прайсу;
 * `cached` — ответ из Redis-кэша, провайдер не вызывался, стоимость `0`;
 * `local` — локальный провайдер (LM Studio), стоимость `0`;
 * `unknown` — провайдер не отдал usage, цену посчитать нельзя.
 */
export type CostStatus = 'exact' | 'cached' | 'local' | 'unknown';

/** Результат вызова LLM. */
export interface LlmGenerateResult {  /** Текст ответа. */
  text: string;
  /** Метрики вызова (null, если провайдер их не отдал). */
  usage: LlmUsage | null;
  /**
   * Обслужен ли вызов локальным провайдером (KI-148).
   *
   * Проставляется `LlmRouterService` (v1.2 S1) из флага фактически
   * использованного провайдера, чтобы вызывающий код (executor узла) мог
   * посчитать стоимость как `0` для локальных моделей, не имея доступа к самому
   * провайдеру. Отсутствие значения — «не локальный».
   */
  isLocal?: boolean;
  /**
   * Ответ выдан из Redis-кэша, провайдер не вызывался (v1.6.0 S8).
   *
   * UI показывает бейдж «из кэша», а исполнитель узла не начисляет стоимость
   * повторного вызова. Отсутствие значения — обычный вызов провайдера.
   */
  cached?: boolean;
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

/** Декларация модели: id, label, модальности и возможности. */
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
   * Поддерживает ли модель tool-calling (v1.3 S1, KI-617).
   *
   * Нужен роутеру: агентский вызов (`requiresTools: true`) нельзя подменять
   * моделью без инструментов. Отсутствие значения трактуется как «поддерживает,
   * если модель принимает текст» ({@link buildModelCapabilities}): в текущей
   * реализации инструменты агента передаются промптом, поэтому любая
   * текстовая модель способна вести tool-цикл. Явный `false` — для моделей,
   * у которых tool-calling заведомо не поддержан.
   */
  readonly supportsTools?: boolean;
  /**
   * Максимальный размер контекста модели (вход + выход), в токенах
   * (v1.3 S1, KI-617).
   *
   * Не путать с {@link defaultMaxTokens} — это дефолтный лимит **ответа**.
   * `undefined`/`0` — размер неизвестен; сверка контекста пропускается
   * (KI-629): требовать от модели недоказуемое нельзя.
   */
  readonly maxTokens?: number;
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
   * Доступен ли провайдер прямо сейчас (v1.2 S1, DESIGN V120 § 3.1).
   *
   * Отвечает на вопрос «можно ли отправить вызов», а не «настроен ли
   * провайдер»: `isConfigured` — статический признак наличия ключа, а этот
   * метод может проверить сеть. Поэтому:
   *
   * - облачные провайдеры возвращают `true` без сетевого запроса: ключ уже
   *   проверен фабрикой (`isConfigured`), а пинг на каждый вызов добавил бы
   *   лишний round-trip к платному upstream;
   * - локальный LM Studio пингует `GET {baseURL}/models` с коротким
   *   таймаутом: сервер может быть выключен, пока облачные ключи настроены.
   *
   * Метод не бросает исключений: «недоступен» — это `false`, а не ошибка.
   * Нужен роутеру (`LlmRouterService`) и healthcheck'у (`LlmHealthService`).
   *
   * @returns `true`, если провайдер готов принять вызов
   */
  isAvailableAsync(): Promise<boolean>;

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
   * Идентификатор провайдера, у которого произошла ошибка.
   *
   * Вынесен отдельным полем, а не только в тексте сообщения: движку и
   * структурному guard'у `isRetryableProviderError` нужен признак провайдера
   * без разбора строки (v0.11 S10, DESIGN § 3.3.2, KI-104).
   */
  readonly provider: string;

  /**
   * Признак «временной» ошибки: имеет ли смысл повторять вызов (KI-036).
   *
   * `true` — 429/5xx, таймаут, сетевой сбой; `false` — детерминированные
   * ошибки (400/401/403/404, пустой prompt, неизвестная модель).
   */
  readonly retryable: boolean;

  /**
   * Подсказка upstream «повторить не раньше, чем через N мс» (`Retry-After`).
   *
   * `undefined` — провайдер подсказку не отдал; движок считает паузу сам.
   */
  readonly retryAfterMs?: number;

  /**
   * @param provider - идентификатор провайдера (`anthropic`, `openai`,
   *   `routerai`, `deepseek`, `yandex`, `lmstudio`, а также `llm`/`registry`
   *   для ошибок уровня сервиса)
   * @param message - текст ошибки
   * @param options.cause - исходная ошибка (если есть)
   * @param options.retryable - можно ли повторять вызов (по умолчанию `false`)
   * @param options.retryAfterMs - подсказка `Retry-After` в мс (v0.11 S10)
   */
  constructor(
    provider: string,
    message: string,
    options: { cause?: unknown; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'LlmProviderException';
    this.provider = provider;
    this.retryable = options.retryable ?? false;

    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
