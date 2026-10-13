import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
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
 * Провайдер OpenAI (GPT) — R3.
 *
 * Клиент SDK создаётся лениво-терпимо: без `OPENAI_API_KEY` провайдер не роняет
 * старт приложения (ключи объявлены опциональными в `EnvSchema`), а отдаёт
 * `LlmProviderException` при вызове. Промпты в логи не пишутся (RULES 5.9).
 */
@Injectable()
export class OpenAiProvider implements ILlmProvider {
  readonly name = 'openai';

  readonly models: ReadonlyArray<{ id: string; label: string }> = [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  ];

  private readonly logger = new Logger(OpenAiProvider.name);
  /** Клиент SDK либо `null`, если ключ не задан (см. JSDoc класса). */
  private readonly client: OpenAI | null;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY не задан — вызовы OpenAI будут падать с LlmProviderException',
      );
      this.client = null;

      return;
    }

    this.client = new OpenAI({ apiKey });
  }

  /**
   * Генерирует текст через OpenAI Chat Completions API.
   *
   * @param prompt - пользовательский промпт
   * @param options - модель, system, лимиты, отмена
   * @returns текст первого варианта ответа (пустая строка, если контента нет)
   * @throws LlmProviderException если ключ не задан, вызов упал или истёк таймаут
   */
  async generateAsync(prompt: string, options: LlmGenerateOptions): Promise<string> {
    if (!this.client) {
      throw new LlmProviderException(this.name, 'OPENAI_API_KEY не задан');
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

      return completion.choices[0]?.message.content ?? '';
    } catch (error: unknown) {
      throw toProviderException(this.name, error, signal);
    }
  }
}
