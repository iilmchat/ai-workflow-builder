import type { ConfigService } from '@nestjs/config';

/**
 * Курс USD→RUB по умолчанию (v1.6.0 S8.1, KI-383).
 *
 * Грубая оценка на случай, если переменная не задана. В проде значение
 * берётся из `USD_RUB_RATE`.
 */
export const DEFAULT_USD_RUB_RATE = 100;

/** Ключи, которые проверяются по порядку: канонический и legacy-алиасы. */
const USD_RUB_RATE_KEYS = [
  'USD_RUB_RATE',
  'WORKFLOW_RUN_USD_RUB_RATE',
  'MEDIA_USD_RUB_RATE',
] as const;

/**
 * Читает единый курс USD→RUB из `ConfigService` (KI-383).
 *
 * До S8.1 курс задавался двумя переменными — `WORKFLOW_RUN_USD_RUB_RATE`
 * (бюджет запуска) и `MEDIA_USD_RUB_RATE` (каталог media-провайдеров), из-за
 * чего шкалы могли разойтись. Канонический ключ теперь `USD_RUB_RATE`;
 * старые имена читаются как fallback, чтобы существующие `.env` не изменили
 * поведение после обновления.
 *
 * @param config - доступ к env (RULES 4.6)
 * @returns положительный курс; `DEFAULT_USD_RUB_RATE`, если ни один ключ не задан
 */
export function resolveUsdRubRate(
  config: Pick<ConfigService, 'get'>,
): number {
  for (const key of USD_RUB_RATE_KEYS) {
    const raw = config.get<unknown>(key);
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim().length > 0
          ? Number(raw)
          : Number.NaN;

    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return DEFAULT_USD_RUB_RATE;
}
