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

/** Прайс-лист: id модели → цены (USD за 1M токенов). */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-20250514': { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  'claude-sonnet-4-20250514': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'gpt-4o': { inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  'gpt-4o-mini': { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
};

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
  const pricing = MODEL_PRICING[model];

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
