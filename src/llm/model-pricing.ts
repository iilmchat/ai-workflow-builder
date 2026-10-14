/**
 * Прайс-лист моделей и расчёт стоимости вызова (KI-038).
 *
 * Цены указаны за 1 миллион токенов в USD и отражают тарифы на момент
 * implementation; при изменении тарифов правится только эта таблица.
 */

/** Цены модели за 1M токенов (USD). */
export interface ModelPricing {
  /** Цена входных токенов за 1M. */
  inputPerMillionUsd: number;
  /** Цена выходных токенов за 1M. */
  outputPerMillionUsd: number;
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
  'claude-opus-4-20250514': { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  'claude-sonnet-4-20250514': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  'gpt-4o-mini': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  // Yandex AI Studio (KI-176): 0.002 / 0.005 / 0.010 USD за 1k токенов.
  'yandexgpt-lite': { inputPerMillionUsd: 2, outputPerMillionUsd: 2 },
  yandexgpt: { inputPerMillionUsd: 5, outputPerMillionUsd: 5 },
  'yandexgpt-32k': { inputPerMillionUsd: 10, outputPerMillionUsd: 10 },
  'qwen3.6-35b-a3b': { inputPerMillionUsd: 2, outputPerMillionUsd: 3 },
};

/**
 * Извлекает короткое имя модели из id для поиска в прайс-листе (KI-176).
 *
 * В `node.data.model` модели Yandex лежат как URI
 * (`gpt://<folder>/<model>/<version>`), а ключи прайса — короткие имена.
 * Берём сегмент перед версией (`/latest`, `/rc`), то есть предпоследний.
 *
 * @param modelId - id модели из конфигурации узла
 * @returns короткое имя модели; исходная строка, если она без `/`
 */
export function bareModelId(modelId: string): string {
  const segments = modelId.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return modelId;
  }

  // `gpt://` даёт пустые сегменты — они отфильтрованы; последний сегмент —
  // версия, поэтому имя модели — предпоследний.
  return segments.length >= 2 ? segments[segments.length - 2] : segments[0];
}

/**
 * Считает стоимость вызова модели.
 *
 * Если провайдер не отдал usage вовсе (оба счётчика `null`), стоимость
 * неизвестна и возвращается `null` (KI-052): «неизвестно» и «ноль» —
 * семантически разные значения, а `cost_usd = 0` в `node_runs` читался бы
 * как «бесплатный вызов». Если известна только часть метрик, считается
 * стоимость известной части.
 *
 * @param model - id модели
 * @param inputTokens - токенов на входе (может быть `null`)
 * @param outputTokens - токенов на выходе (может быть `null`)
 * @returns стоимость в USD (округление до 6 знаков) либо `null`, если модель
 *   отсутствует в прайс-листе или usage недоступен
 */
export function calculateCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  // KI-176: у Yandex id модели — URI, а ключи прайса короткие, поэтому
  // пробуем сначала точное совпадение, затем имя, извлечённое из URI.
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[bareModelId(model)];

  if (!pricing) {
    return null;
  }

  if (inputTokens === null && outputTokens === null) {
    return null;
  }

  const inputCost = ((inputTokens ?? 0) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * pricing.outputPerMillionUsd;

  return Number((inputCost + outputCost).toFixed(6));
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
 * @returns `0` для локального провайдера, иначе стоимость в USD либо `null`
 */
export function calculateCostUsdForProvider(
  provider: { isLocal?: boolean },
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (provider.isLocal === true) {
    return 0;
  }

  return calculateCostUsd(model, inputTokens, outputTokens);
}
