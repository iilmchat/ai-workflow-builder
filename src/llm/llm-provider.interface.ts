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
  /** AbortSignal для отмены/таймаута (RULES 4.19). */
  signal?: AbortSignal;
}

/** Провайдер LLM. */
export interface ILlmProvider {
  /** Идентификатор провайдера: 'anthropic' | 'openai'. */
  readonly name: string;
  /** Модели, доступные у провайдера. */
  readonly models: ReadonlyArray<{ id: string; label: string }>;
  /**
   * Сгенерировать текст (не-стриминговый для R3).
   *
   * @param prompt - пользовательский промпт (целиком не логируется, RULES 5.9)
   * @param options - модель, лимиты, отмена
   * @returns текст ответа
   * @throws LlmProviderException при ошибке провайдера, таймауте или отсутствии ключа
   */
  generateAsync(prompt: string, options: LlmGenerateOptions): Promise<string>;
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
   * @param provider - идентификатор провайдера ('anthropic' | 'openai' | 'llm' | 'registry')
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
