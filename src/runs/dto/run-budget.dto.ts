import type { BudgetMode } from '../cost-budget.service.js';

/**
 * Ответ `GET /runs/:id/budget` (R7.1, KI-048).
 *
 * Отдельная ручка, а не поле SSE-снимка: контракт потока
 * (`docs/development/sse-contract.json`, KI-348) в R7.1 не расширяется, а
 * бюджет нужен UI для прогресс-бара в TopBar. Числа нормализованы в USD по
 * курсу `WORKFLOW_RUN_USD_RUB_RATE`; рублёвый лимит отдаётся отдельно, чтобы
 * UI мог показать обе шкалы.
 */
export interface RunBudgetResponse {
  /** Укладывается ли следующий вызов в лимиты (факт, без учёта режима). */
  ok: boolean;
  /** Потрачено запуском, USD. */
  accumulated: number;
  /** Оценка следующего вызова, USD (для этой ручки — 0: вызова ещё нет). */
  estimated: number;
  /** Остаток бюджета, USD (может быть отрицательным). */
  remaining: number;
  /** Лимит запуска в USD. */
  maxUsd: number;
  /** Лимит запуска в рублях. */
  maxRub: number;
  /** Режим бюджета: `hard` — блокирует вызов, `soft` — предупреждает. */
  mode: BudgetMode;
}
