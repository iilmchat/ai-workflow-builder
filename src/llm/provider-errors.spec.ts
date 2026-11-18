import { describe, expect, it } from 'vitest';
import { isRetryableProviderError } from './provider-errors.js';

/** Открытый сигнал — отмены пользователя нет. */
const signal = new AbortController().signal;

/**
 * Создаёт ошибку SDK с заданным именем класса.
 *
 * @param name - имя класса ошибки (`APIConnectionError` и т.п.)
 * @returns ошибка с этим именем
 */
function sdkError(name: string): Error {
  const error = new Error('сетевой сбой');
  error.name = name;
  return error;
}

describe('isRetryableProviderError (KI-062)', () => {
  it('сетевые ошибки SDK повторяются даже без системного code', () => {
    expect(isRetryableProviderError(sdkError('APIConnectionError'), signal)).toBe(true);
    expect(isRetryableProviderError(sdkError('ConnectionError'), signal)).toBe(true);
    expect(isRetryableProviderError(sdkError('NetworkError'), signal)).toBe(true);
  });

  it('отмена и таймаут по сигналу остаются повторяемыми', () => {
    expect(isRetryableProviderError(sdkError('AbortError'), signal)).toBe(true);
    expect(isRetryableProviderError(sdkError('APIUserAbortError'), signal)).toBe(true);

    const controller = new AbortController();
    controller.abort();
    expect(isRetryableProviderError(new Error('другое'), controller.signal)).toBe(true);
  });

  it('детерминированные ошибки не повторяются', () => {
    expect(isRetryableProviderError(new Error('invalid api key'), signal)).toBe(false);
    expect(isRetryableProviderError(sdkError('APIError'), signal)).toBe(false);
  });
});
