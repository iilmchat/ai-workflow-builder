import { describe, expect, it } from 'vitest';
import { buildHttpErrorAsync, isRetryableStatus } from './provider-http.js';

/**
 * Общий HTTP-слой media-провайдеров: превращение не-2xx в
 * `MediaProviderException` (v0.11 S10, DESIGN § 3.3.2).
 *
 * Проверяется главное для повторов: 429/5xx помечаются `retryable`, а
 * заголовок `Retry-After` доезжает до исключения как `retryAfterMs`.
 */
describe('buildHttpErrorAsync / isRetryableStatus (v0.11 S10)', () => {
  it('429 → retryable + retryAfterMs из заголовка', async () => {
    const error = await buildHttpErrorAsync(
      'fal',
      'не удалось создать задачу',
      new Response(JSON.stringify({ detail: 'rate limited' }), {
        status: 429,
        headers: { 'retry-after': '4' },
      }),
    );

    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(4_000);
    expect(error.provider).toBe('fal');
    expect(error.message).toContain('429');
  });

  it('503 без заголовка → retryable, но retryAfterMs отсутствует', async () => {
    const error = await buildHttpErrorAsync(
      'replicate',
      'не удалось создать задачу',
      new Response('{}', { status: 503 }),
    );

    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBeUndefined();
  });

  it('401 → не повторяется, даже если есть Retry-After', async () => {
    const error = await buildHttpErrorAsync(
      'openai-images',
      'не удалось создать задачу',
      new Response('{}', {
        status: 401,
        headers: { 'retry-after': '10' },
      }),
    );

    expect(error.retryable).toBe(false);
  });

  it('isRetryableStatus: 429 и 5xx — да, остальные — нет', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});
