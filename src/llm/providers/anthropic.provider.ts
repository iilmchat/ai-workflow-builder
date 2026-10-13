import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmProviderException,
  type ILlmProvider,
  type LlmGenerateOptions,
} from '../llm-provider.interface.js';
import { toProviderException } from '../provider-errors.js';

/** Таймаут вызова по умолчанию, если свой signal не передан (RULES 4.19). */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Лимит токенов ответа по умолчанию. */
const DEFAULT_MAX_TOKENS = 1024;

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

  readonly models: ReadonlyArray<{ id: string; label: string }> = [
    { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
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

  /**
   * Генерирует текст через Anthropic Messages API.
   *
   * @param prompt - пользовательский промпт
   * @param options - модель, system, лимиты, отмена
   * @returns склеенный текст всех text-блоков ответа
   * @throws LlmProviderException если ключ не задан, вызов упал или истёк таймаут
   */
  async generateAsync(prompt: string, options: LlmGenerateOptions): Promise<string> {
    if (!this.client) {
      throw new LlmProviderException(this.name, 'ANTHROPIC_API_KEY не задан');
    }

    const signal = options.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

    try {
      const response = await this.client.messages.create(
        {
          model: options.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
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

      return parts.join('');
    } catch (error: unknown) {
      throw toProviderException(this.name, error, signal);
    }
  }
}
