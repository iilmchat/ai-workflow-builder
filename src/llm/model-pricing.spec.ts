import { MODEL_PRICING, calculateCostUsd } from './model-pricing.js';

describe('calculateCostUsd', () => {
  it('считает стоимость известной модели по токенам (KI-038)', () => {
    // claude-sonnet-4: 3 USD за 1M входных, 15 USD за 1M выходных.
    expect(calculateCostUsd('claude-sonnet-4-20250514', 1_000_000, 0)).toBe(3);
    expect(calculateCostUsd('claude-sonnet-4-20250514', 0, 1_000_000)).toBe(15);
    expect(calculateCostUsd('claude-sonnet-4-20250514', 1000, 500)).toBe(0.0105);
  });

  it('возвращает null для модели вне прайс-листа (KI-038)', () => {
    expect(calculateCostUsd('unknown-model', 100, 100)).toBeNull();
    expect(calculateCostUsd('', 100, 100)).toBeNull();
  });

  it('возвращает null, если провайдер не отдал usage (KI-052)', () => {
    // «Неизвестно» ≠ «ноль»: 0 USD в node_runs читался бы как бесплатный вызов.
    expect(calculateCostUsd('gpt-4o', null, null)).toBeNull();
    expect(calculateCostUsd('claude-sonnet-4-20250514', null, null)).toBeNull();
  });

  it('считает стоимость по известной части токенов (KI-052)', () => {
    expect(calculateCostUsd('gpt-4o', 1_000_000, null)).toBe(2.5);
    expect(calculateCostUsd('gpt-4o', null, 1_000_000)).toBe(10);
  });

  it('регресс: стоимость по обоим счётчикам не изменилась (KI-052)', () => {
    expect(calculateCostUsd('gpt-4o', 1000, 500)).toBe(0.0075);
    expect(calculateCostUsd('claude-sonnet-4-20250514', 1000, 500)).toBe(0.0105);
  });

  it('округляет результат до 6 знаков (KI-038)', () => {
    expect(calculateCostUsd('gpt-4o-mini', 1000, 0)).toBe(0.00015);
    // 1 токен дешевле 1e-6 — округление даёт 0.
    expect(calculateCostUsd('gpt-4o-mini', 1, 0)).toBe(0);
  });

  it('прайс-лист покрывает все модели провайдеров', () => {
    expect(Object.keys(MODEL_PRICING)).toEqual([
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'gpt-4o',
      'gpt-4o-mini',
    ]);
  });
});
