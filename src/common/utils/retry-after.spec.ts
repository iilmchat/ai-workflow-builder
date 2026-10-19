import { describe, expect, it } from 'vitest';
import { parseRetryAfterMs } from './retry-after.js';

/**
 * Разбор `Retry-After` (v0.11 S10, DESIGN § 3.3.2).
 *
 * Заголовок встречается в двух форматах RFC 9110; ошибка разбора не должна
 * превращаться в паузу (иначе узел «заснёт» на мусорном значении), поэтому
 * непонятное значение даёт `undefined` и движок считает задержку сам.
 */
describe('parseRetryAfterMs (v0.11 S10)', () => {
  it('переводит delta-seconds в миллисекунды', () => {
    expect(parseRetryAfterMs('3')).toBe(3_000);
    expect(parseRetryAfterMs(' 1.5 ')).toBe(1_500);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('переводит HTTP-дату в паузу от «сейчас»', () => {
    const now = Date.parse('2026-10-19T10:00:00.000Z');

    expect(
      parseRetryAfterMs('Sun, 19 Oct 2026 10:00:07 GMT', now),
    ).toBe(7_000);
    // Дата в прошлом — ждать не нужно, пауза 0 (а не отрицательное число).
    expect(parseRetryAfterMs('Sun, 19 Oct 2026 09:59:00 GMT', now)).toBe(0);
  });

  it('возвращает undefined для отсутствующего и невалидного значения', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('   ')).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
    expect(parseRetryAfterMs('-5')).toBeUndefined();
  });
});
