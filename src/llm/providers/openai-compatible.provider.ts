import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  LlmProviderException,
  type EmbeddingOptions,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
  type LlmUsage,
  type ModelInfo,
  type ReasoningEffort,
} from '../llm-provider.interface.js';
/** Лимит токенов ответа по умолчанию. */
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MAX_TOKENS,
} from '../llm-constants.js';
import { toProviderException } from '../provider-errors.js';
import { readOpenAiCacheTokens } from '../token-usage.js';

/** Таймаут вызова по умолчанию, если свой signal не передан (RULES 4.19). */
const DEFAULT_TIMEOUT_MS = 60_000;


/**
 * Определяет значение `reasoning_effort` для запроса (R6.3.1, KI-193).
 *
 * Поле уходит в upstream только для моделей с `supportsReasoning === true`:
 * у остальных часть прокси отвечает 400 на неизвестный параметр. `'off'` и
 * отсутствие значения означают «поле не отправлять».
 *
 * @param logger - логгер провайдера
 * @param providerName - имя провайдера (для сообщения)
 * @param options - опции вызова (модель и режим reasoning)
 * @param modelInfo - декларация модели, если она есть в списке провайдера
 * @returns значение `reasoning_effort` для SDK либо `null` — «поле не передавать»
 */
function resolveReasoningEffort(
  logger: Logger,
  providerName: string,
  options: LlmGenerateOptions,
  modelInfo: ModelInfo | undefined,
): Exclude<ReasoningEffort, 'off'> | null {
  const effort = options.reasoningEffort;

  if (effort === undefined || effort === 'off') {
    return null;
  }

  if (modelInfo?.supportsReasoning !== true) {
    logger.warn(
      `${providerName}: reasoning_effort не поддержан моделью ${options.model} — поле не отправлено`,
    );

    return null;
  }

  return effort;
}

/**
 * Извлекает метрики использования токенов из ответа OpenAI.
 *
 * `usage` в ответе необязателен, поэтому значение проверяется явно (RULES 1.17).
 *
 * @param completion - ответ `chat.completions.create`
 * @param fallbackModel - модель, запрошенная вызывающим кодом
 * @returns метрики либо `null`, если usage в ответе нет
 */
function extractUsage(
  completion: { model?: unknown; usage?: unknown },
  fallbackModel: string,
): LlmUsage | null {
  const usage = completion.usage;

  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const candidate = usage as { prompt_tokens?: unknown; completion_tokens?: unknown };
  const model =
    typeof completion.model === 'string' && completion.model.length > 0
      ? completion.model
      : fallbackModel;
  // R7.7 (KI-055/KI-150): кэш-токены — отдельно от inputTokens. Поле `usage`
  // у прокси разное (OpenAI `prompt_tokens_details.cached_tokens`, DeepSeek
  // `prompt_cache_hit_tokens`), нормализация — в `token-usage.ts`.
  const cache = readOpenAiCacheTokens(usage);

  return {
    inputTokens:
      typeof candidate.prompt_tokens === 'number' ? candidate.prompt_tokens : null,
    outputTokens:
      typeof candidate.completion_tokens === 'number'
        ? candidate.completion_tokens
        : null,
    ...cache,
    model,
  };
}

/**
 * Извлекает текст ответа и причину остановки (KI-179).
 *
 * Провайдеры с reasoning (DeepSeek V4 Flash через GPTunnel) при упоре в лимит
 * токенов отдают **пустой** `content`, а весь бюджет уходит в `reasoning`
 * (`finish_reason: 'length'`). Проверено на живом GPTunnel: `content` пуст на
 * любом лимите, включая 256 токенов. Раньше такой ответ молча превращался в
 * `text: ''`, и падал уже следующий узел — с невнятным «Пустой prompt».
 *
 * @param completion - ответ `chat.completions.create`
 * @returns текст (content либо reasoning), длину reasoning и finish_reason
 */
function extractText(completion: {
  choices?: Array<{ finish_reason?: unknown; message?: unknown }>;
}): { text: string; reasoningLength: number; finishReason: string | null } {
  const choice = completion.choices?.[0];
  const message = choice?.message;

  const finishReason =
    typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;

  if (typeof message !== 'object' || message === null) {
    return { text: '', reasoningLength: 0, finishReason };
  }

  const candidate = message as { content?: unknown; reasoning?: unknown };
  const content = typeof candidate.content === 'string' ? candidate.content : '';
  // Имя поля у разных прокси разное: `reasoning` (GPTunnel), `reasoning_content`
  // (DeepSeek напрямую).
  const reasoning = readReasoningText(candidate);

  return {
    text: content.length > 0 ? content : reasoning,
    reasoningLength: reasoning.length,
    finishReason,
  };
}

/**
 * Достаёт reasoning-текст из сообщения ассистента.
 *
 * @param message - `choices[0].message` (форма не типизирована SDK)
 * @returns текст рассуждений либо пустую строку
 */
function readReasoningText(message: {
  reasoning?: unknown;
  reasoning_content?: unknown;
}): string {
  for (const value of [message.reasoning, message.reasoning_content]) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return '';
}

/**
 * Извлекает векторы из ответа `embeddings.create` (R7.4a).
 *
 * Ответ провайдера — внешние данные (RULES 1.17), поэтому форма проверяется
 * явно: ожидается `{ data: [{ index, embedding: number[] }] }`. Векторы
 * сортируются по `index` — upstream не обязан возвращать их в порядке входа,
 * а исполнитель склеивает `texts[i]` с `vectors[i]` по позиции.
 *
 * @param response - ответ `client.embeddings.create`
 * @param providerName - идентификатор провайдера (для текста ошибки)
 * @returns векторы в порядке исходных текстов; пустой массив, если данных нет
 * @throws LlmProviderException если вектор содержит не числа
 */
function extractEmbeddings(
  response: {
    data?: Array<{ index?: unknown; embedding?: unknown }>;
  },
  providerName: string,
): number[][] {
  const items = response.data ?? [];
  const ordered = [...items].sort(
    (left, right) =>
      (typeof left.index === 'number' ? left.index : 0) -
      (typeof right.index === 'number' ? right.index : 0),
  );

  return ordered.map((item) => {
    const embedding = item.embedding;

    if (
      !Array.isArray(embedding) ||
      !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
    ) {
      throw new LlmProviderException(
        providerName,
        'ответ /embeddings содержит вектор не из чисел',
      );
    }

    return embedding;
  });
}

/** Конфиг OpenAI-совместимого провайдера. */
export interface OpenAiCompatibleConfig {
  /** Идентификатор для UI ('openai', 'routerai', 'deepseek', ...). */
  name: string;
  /** API key. Для LM Studio — заглушка ('not-needed'). */
  apiKey: string;
  /** Base URL, например https://api.openai.com/v1. */
  baseURL: string;
  /** Список моделей, доступных у провайдера. */
  models: readonly ModelInfo[];
  /**
   * Имя переменной окружения с ключом — попадает в текст ошибки, когда ключ
   * не задан (например, `OPENAI_API_KEY`). Для LM Studio ключ не нужен.
   */
  envKey?: string;
  /**
   * Локальный провайдер (модели на своём железе, бесплатны).
   *
   * Используется для расчёта стоимости: у локальных провайдеров она равна `0`,
   * а не `null` (KI-148). По умолчанию — `false`.
   */
  isLocal?: boolean;
  /**
   * Преобразует id модели в то, что ждёт upstream (KI-159).
   *
   * Нужен провайдерам, у которых идентификатор модели — не просто строка:
   * Yandex AI Studio требует URI `gpt://<folder_id>/<model>/latest`, тогда как
   * в UI и в `node.data.model` хранится короткое имя (`yandexgpt-lite`).
   * Без преобразования upstream отвечает 400 «Failed to parse model URI».
   *
   * По умолчанию id уходит как есть.
   */
  resolveModel?: (model: string) => string;
  /**
   * Преобразует id модели эмбеддингов для upstream (R7.4a).
   *
   * Отдельно от {@link resolveModel}: у RouterAI embedding-модели имеют
   * префикс провайдера (`openai/text-embedding-3-small`), а chat-модели — свой
   * (`anthropic/claude-sonnet-4`), поэтому одна функция на оба случая
   * подставляла бы неверный префикс. По умолчанию id уходит как есть.
   */
  resolveEmbeddingModel?: (model: string) => string;
}

/**
 * Универсальный провайдер для любого OpenAI-совместимого API (v0.5.0).
 *
 * Один и тот же класс обслуживает OpenAI, RouterAI, DeepSeek, Yandex AI Studio
 * и локальный LM Studio: все они реализуют `/chat/completions`, а различия
 * сведены к `baseURL`, ключу и списку моделей. Именно поэтому `OPENAI_BASE_URL`
 * из R5.0 перестал быть костылём — теперь у каждого провайдера свой baseURL,
 * и они могут работать одновременно.
 *
 * Экземпляры создаёт только {@link LlmProviderFactory}, который решает, какие
 * провайдеры сконфигурированы. Поэтому провайдер всегда готов к вызовам
 * (`isConfigured === true`): без ключа он просто не создаётся. Исключение —
 * LM Studio: там ключ не нужен, и в `apiKey` передаётся заглушка.
 *
 * Промпты в логи не пишутся (RULES 5.9).
 */
@Injectable()
export class OpenAiCompatibleProvider implements ILlmProvider {
  /** Идентификатор провайдера для UI и логов. */
  readonly name: string;

  /** Модели, объявленные у провайдера. */
  readonly models: readonly ModelInfo[];

  /**
   * Поддержка embeddings (R7.4a): `/v1/embeddings` есть у всех
   * OpenAI-совместимых API, которые обслуживает этот класс.
   */
  readonly supportsEmbeddings = true;

  /**
   * Локальный ли провайдер (LM Studio — да, облачные — нет).
   *
   * Влияет на расчёт стоимости: у локального она `0`, а не `null` (KI-148).
   */
  readonly isLocal: boolean;

  /** Преобразование id модели для upstream (KI-159); `undefined` — как есть. */
  private readonly resolveModel: ((model: string) => string) | undefined;

  /** Преобразование id embedding-модели (R7.4a); `undefined` — как есть. */
  private readonly resolveEmbeddingModel: ((model: string) => string) | undefined;

  private readonly logger: Logger;
  /** Клиент SDK: создаётся всегда, кроме случая отсутствия ключа. */
  private readonly client: OpenAI | null;
  /** Имя переменной окружения с ключом (для текста ошибки). */
  private readonly envKey: string | undefined;

  /**
   * @param config - идентификатор, ключ, baseURL и список моделей
   */
  constructor(config: OpenAiCompatibleConfig) {
    this.name = config.name;
    this.models = config.models;
    this.envKey = config.envKey;
    this.isLocal = config.isLocal ?? false;
    this.resolveModel = config.resolveModel;
    this.resolveEmbeddingModel = config.resolveEmbeddingModel;
    this.logger = new Logger(`OpenAiCompatibleProvider:${config.name}`);

    if (!config.apiKey) {
      this.logger.warn(
        `${config.envKey ?? 'API key'} не задан — вызовы ${config.name} будут падать с LlmProviderException`,
      );
      this.client = null;

      return;
    }

    // KI-500: SDK не должен повторять 429/5xx сам. Иначе его два внутренних
    // повтора умножаются на `NODE_RETRY_MAX_ATTEMPTS` движка (до 9 платных
    // upstream-вызовов на узел). Повторы — только на уровне движка, где они
    // видны в `node_runs.logs`, учитываются бюджетом и используют `Retry-After`.
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
    });
  }

  /**
   * Готов ли провайдер к вызовам (KI-039).
   *
   * `false` только если экземпляр создан без ключа — в штатном пути фабрика
   * такие провайдеры не создаёт.
   */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Генерирует текст через OpenAI-совместимый Chat Completions API.
   *
   * @param prompt - пользовательский промпт (целиком не логируется, RULES 5.9)
   * @param options - модель, system, лимиты, отмена
   * @returns текст первого варианта ответа и метрики использования токенов
   * @throws LlmProviderException если ключ не задан, вызов упал или истёк таймаут
   */
  async generateAsync(
    prompt: string,
    options: LlmGenerateOptions,
  ): Promise<LlmGenerateResult> {
    if (!this.client) {
      throw new LlmProviderException(
        this.name,
        `${this.envKey ?? 'API key'} не задан`,
      );
    }

    const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    // KI-159: часть провайдеров (Yandex) требует URI вместо короткого id.
    const upstreamModel = this.resolveModel
      ? this.resolveModel(options.model)
      : options.model;
    // KI-183/KI-193: декларация модели даёт дефолтный лимит токенов и признак
    // поддержки reasoning.
    const modelInfo = this.models.find((item) => item.id === options.model);
    const reasoningEffort = resolveReasoningEffort(
      this.logger,
      this.name,
      options,
      modelInfo,
    );

    // Результат разбора выносится за `try`, чтобы ошибка «пустой ответ»
    // (KI-179) не переоборачивалась в `toProviderException`.
    let answer: ReturnType<typeof extractText>;
    let usage: ReturnType<typeof extractUsage>;

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: upstreamModel,
          // Актуальное поле лимита ответа (в SDK есть и deprecated max_tokens).
          // KI-183: приоритет — явный override → дефолт модели → константа.
          max_completion_tokens:
            options.maxTokens ??
            modelInfo?.defaultMaxTokens ??
            DEFAULT_MAX_TOKENS,
          temperature: options.temperature,
          // KI-193: поле добавляем только для моделей, помеченных как
          // поддерживающие reasoning, — иначе часть прокси отвечает 400.
          ...(reasoningEffort === null
            ? {}
            : { reasoning_effort: reasoningEffort }),
          messages: [
            ...(options.system
              ? [{ role: 'system' as const, content: options.system }]
              : []),
            { role: 'user' as const, content: prompt },
          ],
        },
        { signal },
      );

      answer = extractText(completion);
      usage = extractUsage(completion, options.model);
    } catch (error: unknown) {      throw toProviderException(this.name, error, signal);
    }

    // KI-179: пустой ответ — не «успех с пустым текстом», а явная ошибка:
    // иначе следующий узел падает с невнятным «Пустой prompt». Проверка вне
    // `try`, чтобы сообщение не переобернулось в `toProviderException`.
    if (answer.text.length === 0) {
      throw new LlmProviderException(
        this.name,
        `LLM вернул пустой ответ (finish_reason: ${answer.finishReason ?? 'неизвестен'})`,
        // Упор в лимит токенов — не временный сбой, но и не «навсегда»:
        // повтор с тем же лимитом даст то же самое, поэтому не retryable.
        { retryable: false },
      );
    }

    if (answer.reasoningLength > 0) {
      // Ответ собран из reasoning: полезно знать, что модель не дошла до
      // финального текста (обычно из-за лимита токенов).
      this.logger.warn(
        `Ответ модели ${options.model} пуст в content, использован reasoning (${answer.reasoningLength} симв., finish_reason: ${answer.finishReason ?? 'неизвестен'})`,
      );
    }

    return { text: answer.text, usage };
  }

  /**
   * Получает эмбеддинги через OpenAI-совместимый `/v1/embeddings` (R7.4a).
   *
   * Модель по умолчанию — `text-embedding-3-small` (1536 измерений).
   * `resolveModel` здесь **не** применяется: он существует для chat-моделей
   * Yandex (`gpt://…`). Отдельный `resolveEmbeddingModel` нужен прокси вроде
   * RouterAI, где id embedding-модели несёт префикс провайдера
   * (`openai/text-embedding-3-small`).
   *
   * @param texts - тексты для векторизации (порядок сохраняется)
   * @param options - модель и signal отмены (RULES 4.19)
   * @returns массив векторов: `result[i]` — эмбеддинг `texts[i]`
   * @throws LlmProviderException если ключ не задан, вызов упал, истёк таймаут
   *   или провайдер вернул не то число векторов
   */
  async embedAsync(
    texts: string[],
    options: EmbeddingOptions = {},
  ): Promise<number[][]> {
    if (!this.client) {
      throw new LlmProviderException(
        this.name,
        `${this.envKey ?? 'API key'} не задан`,
      );
    }

    if (texts.length === 0) {
      return [];
    }

    const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const requestedModel = options.model ?? DEFAULT_EMBEDDING_MODEL;
    const model = this.resolveEmbeddingModel
      ? this.resolveEmbeddingModel(requestedModel)
      : requestedModel;

    let vectors: number[][];

    try {
      const response = await this.client.embeddings.create(
        { model, input: texts },
        { signal },
      );

      vectors = extractEmbeddings(response, this.name);
    } catch (error: unknown) {
      throw toProviderException(this.name, error, signal);
    }

    // Один текст → один вектор. Расхождение означает, что upstream вернул
    // частичный ответ: склеивать его с текстами по индексу нельзя.
    if (vectors.length !== texts.length) {
      throw new LlmProviderException(
        this.name,
        `embeddings вернул ${vectors.length} векторов на ${texts.length} текстов`,
      );
    }

    return vectors;
  }
}
