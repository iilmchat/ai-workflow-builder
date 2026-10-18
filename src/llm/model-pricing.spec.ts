import {
  MODEL_PRICING,
  bareModelId,
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
      // KI-176: Yandex AI Studio (0.002 / 0.005 / 0.010 / 0.002+0.003 USD за 1k).
      'yandexgpt-lite',
      'yandexgpt',
      'yandexgpt-32k',
      'qwen3.6-35b-a3b',
    ]);
  });

  it('KI-176: считает стоимость Yandex по короткому имени', () => {
    // 0.002 USD за 1k токенов = 2 USD за 1M.
    expect(calculateCostUsd('yandexgpt-lite', 1_000_000, 0)).toBe(2);
    expect(calculateCostUsd('yandexgpt', 0, 1_000_000)).toBe(5);
    expect(calculateCostUsd('yandexgpt-32k', 1000, 1000)).toBe(0.02);
    // qwen3.6-35b-a3b: 0.002 вход / 0.003 выход за 1k.
    expect(calculateCostUsd('qwen3.6-35b-a3b', 1_000_000, 1_000_000)).toBe(5);
  });

  it('KI-176: находит цену по полному URI модели Yandex', () => {
    // В node.data.model лежит URI, а ключи прайса — короткие имена.
    expect(
      calculateCostUsd('gpt://b1gufspraeh2i5nin6nt/yandexgpt-lite/latest', 1_000_000, 0),
    ).toBe(2);
    expect(
      calculateCostUsd('gpt://b1gufspraeh2i5nin6nt/yandexgpt-32k/rc', 0, 1_000_000),
    ).toBe(10);
  });

  it('bareModelId: извлекает имя модели из URI', () => {
    expect(bareModelId('gpt://folder/yandexgpt-lite/latest')).toBe('yandexgpt-lite');
    expect(bareModelId('gpt://folder/qwen3.6-35b-a3b/latest')).toBe('qwen3.6-35b-a3b');
    expect(bareModelId('yandexgpt-lite')).toBe('yandexgpt-lite');
    expect(bareModelId('gpt-4o')).toBe('gpt-4o');
  });

  it('bareModelId: для прокси-префикса берёт последний сегмент, а не vendor (KI-406)', () => {
    // `openai/gpt-4o` — цена лежит под `gpt-4o`, а не под `openai`.
    expect(bareModelId('openai/gpt-4o')).toBe('gpt-4o');
    expect(bareModelId('openai/text-embedding-3-small')).toBe(
      'text-embedding-3-small',
    );
    expect(bareModelId('anthropic/claude-sonnet-4-20250514')).toBe(
      'claude-sonnet-4-20250514',
    );
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
