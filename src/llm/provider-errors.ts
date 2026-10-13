import { LlmProviderException } from './llm-provider.interface.js';

/** HTTP-статусы, при которых повтор вызова имеет смысл. */
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Сетевые коды ошибок, при которых повтор имеет смысл. */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
]);

/**
 * Приводит неизвестную ошибку к тексту.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Извлекает HTTP-статус из ошибки SDK.
 *
 * Anthropic и OpenAI кладут его в `status` (у части ошибок — в `statusCode`).
 *
 * @param error - значение из `catch`
 * @returns числовой статус либо `null`, если его нет
 */
function extractStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.status ?? candidate.statusCode;

  return typeof status === 'number' ? status : null;
}

/**
 * Извлекает системный код ошибки (например, `ECONNREFUSED`).
 *
 * @param error - значение из `catch`
 * @returns строковый код либо `null`, если его нет
 */
function extractErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown };

  return typeof candidate.code === 'string' ? candidate.code : null;
}

/**
 * Определяет, стоит ли повторять упавший вызов провайдера.
 *
 * Повторяемыми считаются: таймаут/отмена сигнала, сетевые ошибки и «временные»
 * HTTP-статусы (429, 5xx). Ошибки вида 400/401/403/404 и отсутствие ключа —
 * детерминированные, повтор только сожжёт лимиты.
 *
 * @param error - значение из `catch`
 * @param signal - сигнал вызова (отличает таймаут/отмену от прочих сбоев)
 * @returns `true`, если вызов имеет смысл повторить
 */
export function isRetryableProviderError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) {
    return true;
  }

  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'APIUserAbortError')
  ) {
    return true;
  }

  const status = extractStatus(error);

  if (status !== null) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const code = extractErrorCode(error);

  return code !== null && RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Оборачивает ошибку SDK в {@link LlmProviderException} с признаком повторяемости.
 *
 * @param provider - идентификатор провайдера (`anthropic`/`openai`)
 * @param error - ошибка из `catch`
 * @param signal - сигнал вызова (используется для классификации)
 * @returns ошибка провайдера с сохранённой причиной и флагом `retryable`
 */
export function toProviderException(
  provider: string,
  error: unknown,
  signal: AbortSignal,
): LlmProviderException {
  const retryable = isRetryableProviderError(error, signal);
  const message = signal.aborted
    ? 'вызов отменён или истёк таймаут'
    : toErrorMessage(error);

  return new LlmProviderException(provider, message, { cause: error, retryable });
}
