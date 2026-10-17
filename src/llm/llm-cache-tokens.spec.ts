import {
  readAnthropicCacheTokens,
  readOpenAiCacheTokens,
  readTokenCount,
} from './token-usage.js';
import {
  calculateCacheSavingsUsd,
  calculateCostUsd,
  calculateCostUsdForProvider,
} from './model-pricing.js';

/**
 * Кэш-токены провайдеров (R7.7, KI-055/KI-150).
 *
 * Проверяются три уровня:
 * 1. нормализация ответов провайдеров (`token-usage.ts`) — разные имена полей
 *    у OpenAI/DeepSeek/Anthropic и защита от мусора в ответе;
 * 2. расчёт стоимости (`model-pricing.ts`) — кэш-токены по отдельным тарифам,
 *    без двойного учёта входных;
 * 3. экономия — только чтение из кэша, без записи (она окупается на повторах).
 */
describe('Кэш-токены: нормализация ответов провайдеров (R7.7)', () => {
  it('OpenAI: cached_tokens из prompt_tokens_details', () => {
    const usage = {
      prompt_tokens: 1000,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 800 },
    };

    expect(readOpenAiCacheTokens(usage)).toEqual({
      cacheReadTokens: 800,
      cacheTokensIncludedInInput: true,
    });
  });

  it('DeepSeek: prompt_cache_hit_tokens', () => {
    expect(readOpenAiCacheTokens({ prompt_tokens: 500, prompt_cache_hit_tokens: 300 }))
      .toEqual({ cacheReadTokens: 300, cacheTokensIncludedInInput: true });
  });

  it('прокси с anthropic-именем: cache_read_input_tokens и cache_creation_input_tokens', () => {
    expect(
      readOpenAiCacheTokens({
        prompt_tokens: 100,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 20,
      }),
    ).toEqual({
      cacheReadTokens: 60,
      cacheCreationTokens: 20,
      cacheTokensIncludedInInput: true,
    });
  });

  it('Anthropic: cache-токены отдельные от input_tokens', () => {
    expect(
      readAnthropicCacheTokens({
        input_tokens: 50,
        output_tokens: 7,
        cache_read_input_tokens: 12_500,
        cache_creation_input_tokens: 2_000,
      }),
    ).toEqual({
      cacheReadTokens: 12_500,
      cacheCreationTokens: 2_000,
      cacheTokensIncludedInInput: false,
    });
  });

  it('нет кэша → поля не появляются (usage как до R7.7)', () => {
    expect(readOpenAiCacheTokens({ prompt_tokens: 10 })).toEqual({});
    expect(readAnthropicCacheTokens({ input_tokens: 10 })).toEqual({});
  });

  it('ноль не считается кэшем: 0 → поля нет', () => {
    expect(readTokenCount(0)).toBeUndefined();
    expect(readOpenAiCacheTokens({ prompt_tokens_details: { cached_tokens: 0 } })).toEqual(
      {},
    );
  });

  it('мусор в ответе не превращается в число (RULES 1.17)', () => {
    expect(readTokenCount('12')).toBeUndefined();
    expect(readTokenCount(12.5)).toBeUndefined();
    expect(readTokenCount(-3)).toBeUndefined();
    expect(readTokenCount(null)).toBeUndefined();
    expect(readOpenAiCacheTokens('usage')).toEqual({});
    expect(readAnthropicCacheTokens(null)).toEqual({});
  });
});

describe('Кэш-токены: расчёт стоимости (R7.7, KI-055/KI-150)', () => {
  it('OpenAI: кэш входит в inputTokens — обычная цена только на остаток', () => {
    // gpt-4o: 1M входа = $2.5, cached = $1.25.
    // 1000 входных, из них 800 из кэша: 200*2.5/1M + 800*1.25/1M + 0 выхода.
    expect(
      calculateCostUsd('gpt-4o', 1000, 0, { cacheReadTokens: 800 }),
    ).toBeCloseTo(0.0015, 6);
    // Без кэша те же токены стоили бы $0.0025.
    expect(calculateCostUsd('gpt-4o', 1000, 0)).toBeCloseTo(0.0025, 6);
  });

  it('Anthropic: кэш отдельный от inputTokens — input считается целиком', () => {
    // claude-sonnet: 1M входа = $3, cache read = $0.3.
    // 1000 некешированных + 10 000 из кэша + 0 выхода.
    expect(
      calculateCostUsd('claude-sonnet-4-20250514', 1000, 0, {
        cacheReadTokens: 10_000,
        cacheTokensIncludedInInput: false,
      }),
    ).toBeCloseTo(0.006, 6);
  });

  it('запись в кэш дороже входа (Anthropic 1.25×)', () => {
    // 1M токенов записи у sonnet: $3.75; 0 входа/выхода.
    expect(
      calculateCostUsd('claude-sonnet-4-20250514', 0, 0, {
        cacheCreationTokens: 1_000_000,
        cacheTokensIncludedInInput: false,
      }),
    ).toBeCloseTo(3.75, 6);
  });

  it('кэш больше inputTokens не уводит остаток в минус', () => {
    // Прокси вернул 900 кэша при 100 prompt_tokens — считаем не меньше нуля.
    expect(calculateCostUsd('gpt-4o', 100, 0, { cacheReadTokens: 900 })).toBeCloseTo(
      900 * 1.25 * 1e-6,
      6,
    );
  });

  it('без usage и кэша стоимость неизвестна (null, KI-052)', () => {
    expect(calculateCostUsd('gpt-4o', null, null)).toBeNull();
  });

  it('модель вне прайс-листа → null даже с кэшем', () => {
    expect(
      calculateCostUsd('unknown-model', 10, 10, { cacheReadTokens: 5 }),
    ).toBeNull();
  });

  it('локальный провайдер бесплатен независимо от кэша (KI-148)', () => {
    expect(
      calculateCostUsdForProvider({ isLocal: true }, 'gpt-4o', 1000, 100, {
        cacheReadTokens: 800,
      }),
    ).toBe(0);
  });

  it('экономия: разница между обычной ценой входа и ценой кэша', () => {
    // 10 000 токенов sonnet: (3 - 0.3) * 10 000 / 1M = $0.027.
    expect(calculateCacheSavingsUsd('claude-sonnet-4-20250514', 10_000)).toBeCloseTo(
      0.027,
      6,
    );
  });

  it('экономия неизвестна без модели/кэша/цены кэша', () => {
    expect(calculateCacheSavingsUsd('unknown-model', 100)).toBeNull();
    expect(calculateCacheSavingsUsd('gpt-4o', null)).toBeNull();
    expect(calculateCacheSavingsUsd('gpt-4o', 0)).toBeNull();
    // У yandexgpt цена кэша не задана — экономию не выдумываем.
    expect(calculateCacheSavingsUsd('yandexgpt', 100)).toBeNull();
  });

  it('RouterAI-префикс в id модели: цена находится по последнему сегменту', () => {
    // `openai/gpt-4o` — так id приходит от RouterAI; прайс знает `gpt-4o`.
    expect(calculateCostUsd('openai/gpt-4o', 1_000_000, 0)).toBe(2.5);
    // 1000 токенов кэша: (2.5 - 1.25) * 1000 / 1M = $0.00125.
    expect(calculateCacheSavingsUsd('openai/gpt-4o', 1000)).toBeCloseTo(0.00125, 6);
  });
});
