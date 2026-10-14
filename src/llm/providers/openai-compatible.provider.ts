import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  LlmProviderException,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
  type LlmUsage,
  type ModelInfo,
} from '../llm-provider.interface.js';
import { toProviderException } from '../provider-errors.js';

/** Таймаут вызова по умолчанию, если свой signal не передан (RULES 4.19). */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Лимит токенов ответа по умолчанию. */
const DEFAULT_MAX_TOKENS = 1024;

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

  return {
    inputTokens:
      typeof candidate.prompt_tokens === 'number' ? candidate.prompt_tokens : null,
    outputTokens:
      typeof candidate.completion_tokens === 'number'
        ? candidate.completion_tokens
        : null,
    model,
  };
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
   * Локальный ли провайдер (LM Studio — да, облачные — нет).
   *
   * Влияет на расчёт стоимости: у локального она `0`, а не `null` (KI-148).
   */
  readonly isLocal: boolean;

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
    this.logger = new Logger(`OpenAiCompatibleProvider:${config.name}`);

    if (!config.apiKey) {
      this.logger.warn(
        `${config.envKey ?? 'API key'} не задан — вызовы ${config.name} будут падать с LlmProviderException`,
      );
      this.client = null;

      return;
    }

    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
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

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: options.model,
          // Актуальное поле лимита ответа (в SDK есть и deprecated max_tokens).
          max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: options.temperature,
          messages: [
            ...(options.system
              ? [{ role: 'system' as const, content: options.system }]
              : []),
            { role: 'user' as const, content: prompt },
          ],
        },
        { signal },
      );

      return {
        text: completion.choices[0]?.message.content ?? '',
        usage: extractUsage(completion, options.model),
      };
    } catch (error: unknown) {
      throw toProviderException(this.name, error, signal);
    }
  }
}
