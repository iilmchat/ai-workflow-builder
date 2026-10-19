import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmbeddingNotSupportedException,
  LlmProviderException,
  type EmbeddingOptions,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
  type LlmUsage,
  type ModelInfo,
} from '../llm-provider.interface.js';
/** Лимит токенов ответа по умолчанию. */
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_PROMPT_CACHE_MIN_TOKENS,
} from '../llm-constants.js';
import { toProviderException } from '../provider-errors.js';
import { readAnthropicCacheTokens } from '../token-usage.js';

/** Таймаут вызова по умолчанию, если свой signal не передан (RULES 4.19). */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Имя переменной окружения с порогом включения промпт-кэша (KI-414). */
const PROMPT_CACHE_MIN_TOKENS_ENV = 'PROMPT_CACHE_MIN_TOKENS';

/** Блок system-промпта с точкой кэширования Anthropic (R7.7, KI-414). */
interface CachedSystemBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control: { readonly type: 'ephemeral' };
}

/**
 * Читает порог включения промпт-кэша из окружения (KI-414).
 *
 * `PROMPT_CACHE_MIN_TOKENS` не объявлена в `EnvSchema` (в R7.7-fix схема
 * окружения не меняется), поэтому значение проверяется здесь: не число,
 * `0` и отрицательные значения откатываются на
 * {@link DEFAULT_PROMPT_CACHE_MIN_TOKENS}. Пустая строка — тоже дефолт.
 *
 * @param config - доступ к переменным окружения (RULES 4.6)
 * @returns положительное целое — порог в символах system-промпта
 */
function readPromptCacheMinTokens(config: ConfigService): number {
  const raw: unknown = config.get(PROMPT_CACHE_MIN_TOKENS_ENV);
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim().length > 0
        ? Number(raw)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PROMPT_CACHE_MIN_TOKENS;
}

/**
 * Собирает поле `system` запроса Anthropic (R7.7, KI-414).
 *
 * Без кэша (и для короткого промпта) возвращается исходная строка — запрос
 * неотличим от поведения до R7.7. С кэшем system превращается в массив
 * text-блоков: `cache_control` ставится на последний (в R7.7 он единственный)
 * блок, и Anthropic кэширует промпт целиком.
 *
 * @param systemPrompt - system-промпт узла
 * @param promptCache - запрошен ли промпт-кэш (`options.promptCache === true`)
 * @param minChars - минимальная длина промпта для включения кэша
 * @returns строка, массив блоков либо `undefined` — «поле не передавать»
 */
function buildSystemParam(
  systemPrompt: string | undefined,
  promptCache: boolean,
  minChars: number,
): string | CachedSystemBlock[] | undefined {
  if (systemPrompt === undefined || systemPrompt.length === 0) {
    return undefined;
  }

  if (!promptCache || systemPrompt.length <= minChars) {
    return systemPrompt;
  }

  return [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * Извлекает метрики использования токенов из ответа Anthropic.
 *
 * Поля читаются через явное сужение: ответ SDK — внешние данные, а в тестах
 * `usage` может отсутствовать вовсе (RULES 1.17).
 *
 * @param response - ответ `messages.create`
 * @param fallbackModel - модель, запрошенная вызывающим кодом
 * @returns метрики либо `null`, если usage в ответе нет
 */
function extractUsage(
  response: { model?: unknown; usage?: unknown },
  fallbackModel: string,
): LlmUsage | null {
  const usage = response.usage;

  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const candidate = usage as { input_tokens?: unknown; output_tokens?: unknown };
  const model =
    typeof response.model === 'string' && response.model.length > 0
      ? response.model
      : fallbackModel;
  // R7.7 (KI-055/KI-150): `cache_read_input_tokens` и
  // `cache_creation_input_tokens` Anthropic **не входят** в `input_tokens` —
  // `cacheTokensIncludedInInput: false` сообщает это расчётчику стоимости.
  const cache = readAnthropicCacheTokens(usage);

  return {
    inputTokens:
      typeof candidate.input_tokens === 'number' ? candidate.input_tokens : null,
    outputTokens:
      typeof candidate.output_tokens === 'number' ? candidate.output_tokens : null,
    ...cache,
    model,
  };
}

/**
 * Провайдер Anthropic (Claude) — R3.
 *
 * Клиент SDK создаётся лениво-терпимо: без `ANTHROPIC_API_KEY` провайдер не
 * роняет старт приложения (ключи объявлены опциональными в `EnvSchema`), а
 * отдаёт `LlmProviderException` при вызове. Промпты в логи не пишутся (RULES 5.9).
 */
@Injectable()
export class AnthropicProvider implements ILlmProvider {
  readonly name = 'anthropic';

  /**
   * Anthropic не предоставляет embeddings API (DESIGN v0.9 § 3.4):
   * для эмбеддингов используется OpenAI-совместимый провайдер.
   */
  readonly supportsEmbeddings = false;

  readonly models: readonly ModelInfo[] = [
    {
      id: 'claude-opus-4-20250514',
      label: 'Claude Opus 4',
      inputModalities: ['text', 'vision'],
      outputModalities: ['text'],
    },
    {
      id: 'claude-sonnet-4-20250514',
      label: 'Claude Sonnet 4',
      inputModalities: ['text', 'vision'],
      outputModalities: ['text'],
    },
  ];

  private readonly logger = new Logger(AnthropicProvider.name);
  /** Клиент SDK либо `null`, если ключ не задан (см. JSDoc класса). */
  private readonly client: Anthropic | null;
  /** Порог длины system-промпта для prompt caching (KI-414). */
  private readonly promptCacheMinTokens: number;

  constructor(config: ConfigService) {
    // Порог читается всегда: он не зависит от наличия ключа и нужен в тестах,
    // где провайдер создаётся без клиента.
    this.promptCacheMinTokens = readPromptCacheMinTokens(config);
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY не задан — вызовы Anthropic будут падать с LlmProviderException',
      );
      this.client = null;

      return;
    }

    // KI-500: внутренние ретраи SDK выключены. Повторять упавший вызов
    // должен только движок (`NODE_RETRY_MAX_ATTEMPTS`), иначе 2 ретрая SDK ×
    // 3 попытки движка дают до 9 платных upstream-вызовов на один узел.
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  /** Готов ли провайдер к вызовам (задан ли `ANTHROPIC_API_KEY`, KI-039). */
  get isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Генерирует текст через Anthropic Messages API.
   *
   * @param prompt - пользовательский промпт
   * @param options - модель, system, лимиты, отмена
   * @returns текст всех text-блоков ответа и метрики использования токенов
   * @throws LlmProviderException если ключ не задан, вызов упал или истёк таймаут
   */
  async generateAsync(
    prompt: string,
    options: LlmGenerateOptions,
  ): Promise<LlmGenerateResult> {
    if (!this.client) {
      throw new LlmProviderException(this.name, 'ANTHROPIC_API_KEY не задан');
    }

    const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    // KI-183: дефолтный лимит берём из декларации модели, если она есть.
    const modelInfo = this.models.find((item) => item.id === options.model);

    // KI-193: extended thinking у Anthropic требует beta-заголовков, поэтому
    // reasoning в R6.3.1 не поддержан — предупреждаем и идём без него.
    if (options.reasoningEffort !== undefined && options.reasoningEffort !== 'off') {
      this.logger.warn(
        `Anthropic: reasoning не поддержан (extended thinking — v0.8.x), модель ${options.model}`,
      );
    }

    try {
      // KI-414: при promptCache=true и длинном system-промпте — массив блоков
      // с cache_control на последнем. Короткий промпт остаётся строкой.
      const system = buildSystemParam(
        options.system,
        options.promptCache === true,
        this.promptCacheMinTokens,
      );

      const response = await this.client.messages.create(
        {
          model: options.model,
          max_tokens:
            options.maxTokens ??
            modelInfo?.defaultMaxTokens ??
            DEFAULT_MAX_TOKENS,
          temperature: options.temperature,
          ...(system === undefined ? {} : { system }),
          messages: [{ role: 'user', content: prompt }],
        },
        { signal },
      );

      const parts: string[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          parts.push(block.text);
        }
      }

      return { text: parts.join(''), usage: extractUsage(response, options.model) };
    } catch (error: unknown) {
      throw toProviderException(this.name, error, signal);
    }
  }

  /**
   * Anthropic не поддерживает embeddings (R7.4a, DESIGN v0.9 § 3.4).
   *
   * Метод обязателен по контракту {@link ILlmProvider}, но всегда бросает
   * {@link EmbeddingNotSupportedException}: реестр пропускает провайдера по
   * флагу {@link supportsEmbeddings}, а прямой вызов обязан падать явно, а не
   * возвращать пустые векторы.
   *
   * @param _texts - тексты для векторизации (не используются)
   * @param _options - модель и signal отмены (не используются)
   * @returns никогда — метод всегда бросает исключение
   * @throws EmbeddingNotSupportedException всегда
   */
  async embedAsync(
    _texts: string[],
    _options?: EmbeddingOptions,
  ): Promise<number[][]> {
    throw new EmbeddingNotSupportedException(this.name);
  }
}
