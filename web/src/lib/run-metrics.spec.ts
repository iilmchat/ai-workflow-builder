import { describe, expect, it } from 'vitest';
import { formatCacheRead, formatMetrics } from './run-metrics';

/**
 * Строка «Cache read» в панели результата (R7.7, KI-055).
 *
 * Проверяется чистый форматтер, поэтому панель не монтируется: тест фиксирует
 * ровно то, что она печатает. jsdom и `@testing-library/react` настроены
 * (KI-155) — они нужны компонентным тестам.
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

describe('formatMetrics: costStatus (S8.1, KI-152)', () => {
  const base = {
    durationMs: 100,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: '0.000000',
    costRub: null,
  };

  it('exact показывает стоимость как раньше', () => {
    expect(formatMetrics({ ...base, costStatus: 'exact' })).toContain('$0.00');
  });

  it('cached не дублирует нулевую стоимость — её объясняет бейдж', () => {
    expect(formatMetrics({ ...base, costStatus: 'cached' })).not.toContain('$');
  });

  it('local не дублирует нулевую стоимость', () => {
    expect(formatMetrics({ ...base, costStatus: 'local' })).not.toContain('$');
  });

  it('unknown не показывает $0.00', () => {
    expect(formatMetrics({ ...base, costStatus: 'unknown' })).not.toContain('$');
  });

  it('без costStatus (старые данные) стоимость остаётся', () => {
    expect(formatMetrics(base)).toContain('$0.00');
  });
});
