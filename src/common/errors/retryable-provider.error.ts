/**
 * Единый маркер «ошибка внешнего провайдера, которую имеет смысл повторить»
 * (v0.11 S10, DESIGN § 3.3.2, KI-104).
 *
 * `LlmProviderException` и `MediaProviderException` живут в разных модулях и
 * имеют разных предков, но движку нужен **один** признак повтора, а не
 * перечисление классов: без него временная ошибка media-провайдера
 * (429/5xx/таймаут) сразу переводила узел в `failed`, а её `retryable` был
 * декоративным.
 *
 * Интерфейс структурный: реализовать его может любой класс ошибки с полями
 * `provider` и `retryable`, не меняя наследования. Это важно для будущих
 * провайдеров (MCP, сторонние API) — им не придётся тянуть зависимости
 * LLM/media-модулей ради маркера.
 */
export interface RetryableProviderError extends Error {
  /** Идентификатор провайдера (`anthropic`, `creativelab`, `media`, …). */
  readonly provider: string;
  /** Признак «временная ошибка»: повтор вызова имеет смысл. */
  readonly retryable: boolean;
  /**
   * Подсказка от провайдера «повторить не раньше, чем через N мс»
   * (`Retry-After`), если upstream её отдал.
   *
   * `undefined` — подсказки нет; движок считает задержку сам по экспоненте.
   */
  readonly retryAfterMs?: number;
}

/**
 * Проверяет, что ошибку можно повторить как «временную» ошибку провайдера.
 *
 * Проверка структурная, а не `instanceof`: движок не должен знать обо всех
 * классах ошибок провайдеров, а тесты и сторонние реализации интерфейса
 * получают тот же контракт без наследования от конкретной иерархии.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns `true`, если ошибка реализует {@link RetryableProviderError} с
 *   `retryable === true` и строковым `provider`
 */
export function isRetryableProviderError(
  error: unknown,
): error is RetryableProviderError {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Partial<RetryableProviderError>;

  return candidate.retryable === true && typeof candidate.provider === 'string';
}
