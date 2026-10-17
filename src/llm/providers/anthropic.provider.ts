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
import { DEFAULT_MAX_TOKENS } from '../llm-constants.js';
import { toProviderException } from '../provider-errors.js';
import { readAnthropicCacheTokens } from '../token-usage.js';

/** Таймаут вызова по умолчанию, если свой signal не передан (RULES 4.19). */
const DEFAULT_TIMEOUT_MS = 60_000;

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

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY не задан — вызовы Anthropic будут падать с LlmProviderException',
      );
      this.client = null;

      return;
    }

    this.client = new Anthropic({ apiKey });
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
      const response = await this.client.messages.create(
        {
          model: options.model,
          max_tokens:
            options.maxTokens ??
            modelInfo?.defaultMaxTokens ??
            DEFAULT_MAX_TOKENS,
          temperature: options.temperature,
          system: options.system,
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
