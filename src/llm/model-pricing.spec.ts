import {
  MODEL_PRICING,
  calculateCostUsd,
  calculateCostUsdForProvider,
} from './model-pricing.js';

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

describe('calculateCostUsdForProvider (KI-148)', () => {
  it('для локального провайдера стоимость — 0, а не null', () => {
    // Модель вне прайс-листа: без флага было бы null («неизвестно»).
    expect(
      calculateCostUsdForProvider({ isLocal: true }, 'qwen2.5-7b-instruct', 10, 20),
    ).toBe(0);
  });

  it('для локального провайдера 0 даже без usage (модель бесплатна)', () => {
    expect(calculateCostUsdForProvider({ isLocal: true }, 'qwen2.5-7b-instruct', null, null)).toBe(
      0,
    );
  });

  it('для не-локального провайдера делегирует в calculateCostUsd', () => {
    expect(calculateCostUsdForProvider({ isLocal: false }, 'gpt-4o', 1_000_000, 0)).toBe(2.5);
    // Модель вне прайса остаётся «неизвестной» — null, не 0.
    expect(calculateCostUsdForProvider({ isLocal: false }, 'deepseek-reasoner', 10, 20)).toBeNull();
  });

  it('отсутствие флага трактуется как «не локальный»', () => {
    expect(calculateCostUsdForProvider({}, 'gpt-4o', 1_000_000, 0)).toBe(2.5);
    expect(calculateCostUsdForProvider({}, 'unknown-model', 10, 20)).toBeNull();
  });
});
