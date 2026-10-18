/**
 * Прайс-лист моделей и расчёт стоимости вызова (KI-038; кэш-токены — R7.7).
 *
 * Цены указаны за 1 миллион токенов в USD и отражают тарифы на момент
 * implementation; при изменении тарифов правится только эта таблица.
 *
 * **Кэш-токены (R7.7, KI-055/KI-150).** Провайдеры тарифицируют их отдельно от
 * обычных входных, поэтому в {@link ModelPricing} появились
 * `cacheReadPerMillionUsd` и `cacheCreationPerMillionUsd`:
 *
 * - Anthropic: чтение из кэша — 0.1× входной цены, запись — 1.25×
 *   (см. https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching);
 * - OpenAI: `cached_tokens` — 0.5× у gpt-4o и gpt-4o-mini.
 *
 * Если цена кэша у модели не задана, кэш-токены считаются по обычной входной
 * цене — стоимость не занижается, а прайс можно наполнять постепенно.
 */

/**
 * Кэш-токены вызова для расчёта стоимости (R7.7).
 *
 * `cacheReadTokens`/`cacheCreationTokens` — количества из `LlmUsage`.
 */
export interface LlmCacheTokens {
  /** Сколько входных токенов прочитано из кэша. */
  cacheReadTokens?: number | null;
  /** Сколько токенов записано в кэш. */
  cacheCreationTokens?: number | null;
  /**
   * Входят ли кэш-токены в `inputTokens`.
   *
   * `true`/`undefined` — входят (OpenAI, DeepSeek); `false` — отдельные
   * (Anthropic). Без этого флага двойной учёт занижал бы стоимость.
   */
  cacheTokensIncludedInInput?: boolean;
}

/** Цены модели за 1M токенов (USD). */
export interface ModelPricing {
  /** Цена входных токенов за 1M. */
  inputPerMillionUsd: number;
  /** Цена выходных токенов за 1M. */
  outputPerMillionUsd: number;
  /** Цена чтения из промпт-кэша за 1M (если тариф отличается от входного). */
  cacheReadPerMillionUsd?: number;
  /** Цена записи в промпт-кэш за 1M (Anthropic: дороже обычного входа). */
  cacheCreationPerMillionUsd?: number;
}

/**
 * Прайс-лист: id модели → цены (USD за 1M токенов).
 *
 * Yandex AI Studio (KI-176): тарифы на 2026-10-15, приведены к цене за 1M
 * токенов (в прайсе Yandex — за 1000 токенов, поэтому умножены на 1000).
 * Источник: https://yandex.cloud/ru/docs/foundation-models/pricing
 *
 * Ключ — короткое имя модели **без** префикса `gpt://`: в `node.data.model`
 * может лежать полный URI, поэтому {@link calculateCostUsd} пробует и его, и
 * имя, извлечённое из URI.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-20250514': {
    inputPerMillionUsd: 15,
    outputPerMillionUsd: 75,
    // Anthropic: кэш-чтение 0.1× входа, кэш-запись 1.25× входа.
    cacheReadPerMillionUsd: 1.5,
    cacheCreationPerMillionUsd: 18.75,
  },
  'claude-sonnet-4-20250514': {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    cacheReadPerMillionUsd: 0.3,
    cacheCreationPerMillionUsd: 3.75,
  },
  'gpt-4o': {
    inputPerMillionUsd: 2.5,
    outputPerMillionUsd: 10,
    // OpenAI: `cached_tokens` — половина входной цены.
    cacheReadPerMillionUsd: 1.25,
  },
  'gpt-4o-mini': {
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
    cacheReadPerMillionUsd: 0.075,
  },
  // Yandex AI Studio (KI-176): 0.002 / 0.005 / 0.010 USD за 1k токенов.
  'yandexgpt-lite': { inputPerMillionUsd: 2, outputPerMillionUsd: 2 },
  yandexgpt: { inputPerMillionUsd: 5, outputPerMillionUsd: 5 },
  'yandexgpt-32k': { inputPerMillionUsd: 10, outputPerMillionUsd: 10 },
  'qwen3.6-35b-a3b': { inputPerMillionUsd: 2, outputPerMillionUsd: 3 },
};

/**
 * Извлекает короткое имя модели из id для поиска в прайс-листе (KI-176).
 *
 * Поддерживаются два вида id:
 * - Yandex-URI (`gpt://<folder>/<model>/<version>`) — берётся сегмент перед
 *   версией (`/latest`, `/rc`), то есть предпоследний;
 * - прокси-префикс (`openai/gpt-4o`, `anthropic/claude-sonnet-4`) — берётся
 *   последний сегмент. Раньше для двух сегментов возвращался **первый**
 *   (`openai`), что противоречило контракту «короткое имя» и скрывало цену
 *   RouterAI за третьим fallback'ом в {@link findModelPricing} (R7.7-fix).
 *
 * @param modelId - id модели из конфигурации узла
 * @returns короткое имя модели; исходная строка, если она без `/`
 */
export function bareModelId(modelId: string): string {
  const segments = modelId.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return modelId;
  }

  // URI Yandex (`gpt://…`) отличаем по схеме: там последний сегмент — версия.
  if (modelId.includes('://')) {
    return segments.length >= 2
      ? segments[segments.length - 2]
      : segments[0];
  }

  // Префикс прокси-провайдера (`openai/model`): модель — последний сегмент.
  return segments[segments.length - 1];
}

/**
 * Находит тариф модели с учётом URI-идентификаторов (KI-176) и префиксов
 * прокси (KI-150).
 *
 * Порядок:
 * 1. точное совпадение;
 * 2. имя, извлечённое {@link bareModelId} (Yandex-URI: `gpt://…/model/latest`);
 * 3. последний сегмент пути — id прокси-провайдера вида
 *    `openai/gpt-4o` (RouterAI): `bareModelId` вернул бы `openai`, а цена
 *    лежит под `gpt-4o`. Без этого шага стоимость и экономия кэша для
 *    RouterAI молча оставались `null` (смоук R7.7).
 *
 * @param model - id модели (короткое имя, URI Yandex или `provider/model`)
 * @returns тариф либо `undefined`, если модели нет в прайс-листе
 */
export function findModelPricing(model: string): ModelPricing | undefined {
  const direct = MODEL_PRICING[model];

  if (direct !== undefined) {
    return direct;
  }

  const bare = bareModelId(model);
  const byBare = MODEL_PRICING[bare];

  if (byBare !== undefined) {
    return byBare;
  }

  const segments = model.split('/').filter((segment) => segment.length > 0);
  const last = segments.at(-1);

  return last === undefined ? undefined : MODEL_PRICING[last];
}

/**
 * Считает стоимость вызова модели.
 *
 * Если провайдер не отдал usage вовсе (все счётчики `null`), стоимость
 * неизвестна и возвращается `null` (KI-052): «неизвестно» и «ноль» —
 * семантически разные значения, а `cost_usd = 0` в `node_runs` читался бы
 * как «бесплатный вызов». Если известна только часть метрик, считается
 * стоимость известной части.
 *
 * **Кэш-токены (R7.7).** Учитываются отдельными ценами:
 * `input = (inputTokens - cacheRead - cacheCreation)` для провайдеров, где кэш
 * входит во вход (OpenAI/DeepSeek), и `input = inputTokens` для Anthropic,
 * где `input_tokens` уже не содержит кэш. Остаток не может быть отрицательным
 * (прокси иногда отдаёт кэш больше `prompt_tokens` — это его баг, а не повод
 * уходить в минус).
 *
 * @param model - id модели
 * @param inputTokens - токенов на входе (может быть `null`)
 * @param outputTokens - токенов на выходе (может быть `null`)
 * @param cache - кэш-токены вызова (R7.7); без них расчёт прежний
 * @returns стоимость в USD (округление до 6 знаков) либо `null`, если модель
 *   отсутствует в прайс-листе или usage недоступен
 */
export function calculateCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  cache: LlmCacheTokens = {},
): number | null {
  // KI-176: у Yandex id модели — URI, а ключи прайса короткие, поэтому
  // пробуем сначала точное совпадение, затем имя, извлечённое из URI.
  const pricing = findModelPricing(model);

  if (!pricing) {
    return null;
  }

  const cacheRead = cache.cacheReadTokens ?? 0;
  const cacheCreation = cache.cacheCreationTokens ?? 0;
  const hasCache = cacheRead > 0 || cacheCreation > 0;

  if (inputTokens === null && outputTokens === null && !hasCache) {
    return null;
  }

  const cacheIncluded = cache.cacheTokensIncludedInInput !== false;
  // Обычная входная цена действует только на некэшированный остаток.
  const billedInput =
    inputTokens === null
      ? 0
      : cacheIncluded
        ? Math.max(0, inputTokens - cacheRead - cacheCreation)
        : inputTokens;

  const inputCost = (billedInput / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * pricing.outputPerMillionUsd;
  const cacheReadCost =
    (cacheRead / 1_000_000) *
    (pricing.cacheReadPerMillionUsd ?? pricing.inputPerMillionUsd);
  const cacheCreationCost =
    (cacheCreation / 1_000_000) *
    (pricing.cacheCreationPerMillionUsd ?? pricing.inputPerMillionUsd);

  return Number(
    (inputCost + outputCost + cacheReadCost + cacheCreationCost).toFixed(6),
  );
}

/**
 * Считает экономию на чтении из кэша (R7.7, KI-055).
 *
 * Экономия = `cacheReadTokens × (inputPrice − cacheReadPrice)`: столько вызов
 * сэкономил бы, если бы кэш-токены считались обычными входными. Запись в кэш
 * (Anthropic, 1.25×) в экономию не входит: она окупается только на повторных
 * вызовах, и складывать её с чтением в одну подпись UI было бы обманом.
 *
 * @param model - id модели
 * @param cacheReadTokens - сколько токенов прочитано из кэша (`null` — нет)
 * @returns экономия в USD либо `null`, если модель/цена кэша неизвестна либо
 *   кэш не применялся
 */
export function calculateCacheSavingsUsd(
  model: string,
  cacheReadTokens: number | null | undefined,
): number | null {
  const pricing = findModelPricing(model);

  if (!pricing || cacheReadTokens === null || cacheReadTokens === undefined) {
    return null;
  }

  const cacheReadPrice = pricing.cacheReadPerMillionUsd;

  if (cacheReadPrice === undefined || cacheReadTokens <= 0) {
    return null;
  }

  const saved =
    (cacheReadTokens * (pricing.inputPerMillionUsd - cacheReadPrice)) / 1_000_000;

  return Number(saved.toFixed(6));
}

/**
 * Считает стоимость вызова с учётом локальности провайдера (KI-148).
 *
 * Для локальных провайдеров (LM Studio) модели запущены на своём железе и
 * бесплатны, поэтому стоимость — `0`, а не `null`: `null` в панели результата
 * означал бы «неизвестно» и выглядел бы как отсутствие данных, хотя вызов
 * действительно ничего не стоил. Для остальных провайдеров результат
 * полностью совпадает с {@link calculateCostUsd} — в том числе `null` для
 * модели вне прайс-листа (KI-052).
 *
 * @param provider - провайдер; учитывается только флаг `isLocal`
 * @param model - id модели
 * @param inputTokens - токенов на входе (может быть `null`)
 * @param outputTokens - токенов на выходе (может быть `null`)
 * @param cache - кэш-токены вызова (R7.7)
 * @returns `0` для локального провайдера, иначе стоимость в USD либо `null`
 */
export function calculateCostUsdForProvider(
  provider: { isLocal?: boolean },
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
  cache: LlmCacheTokens = {},
): number | null {
  if (provider.isLocal === true) {
    return 0;
  }

  return calculateCostUsd(model, inputTokens, outputTokens, cache);
}
