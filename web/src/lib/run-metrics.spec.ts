import { describe, expect, it } from 'vitest';
import { formatCacheRead } from './run-metrics';

/**
 * Строка «Cache read» в панели результата (R7.7, KI-055).
 *
 * Проверяется чистый форматтер: в `web/` нет jsdom/React Testing Library,
 * поэтому панель не рендерится — тест фиксирует ровно то, что она печатает.
 */
describe('formatCacheRead: подпись кэша в панели (R7.7)', () => {
  it('показывает «Cache read: N токенов (экономия $X)»', () => {
    const line = formatCacheRead({ cacheReadTokens: 12_500, cacheSavingsUsd: 0.34 });

    // Заголовок и сумма — как в DESIGN § 3.7.3.
    expect(line).toContain('Cache read');
    expect(line).toContain('12');
    expect(line).toContain('$0.34');
    // Текст экономии локализован (ru по умолчанию в тестах).
    expect(line).toMatch(/экономия|saved/);
  });

  it('без кэша строки нет (0/null — не шум)', () => {
    expect(formatCacheRead({ cacheReadTokens: null, cacheSavingsUsd: null })).toBeNull();
    expect(formatCacheRead({ cacheReadTokens: 0, cacheSavingsUsd: 0 })).toBeNull();
    expect(formatCacheRead(undefined)).toBeNull();
  });

  it('цена кэша неизвестна — токены показываются без экономии', () => {
    const line = formatCacheRead({ cacheReadTokens: 800, cacheSavingsUsd: null });

    expect(line).toContain('800');
    expect(line).not.toContain('$');
  });
});
