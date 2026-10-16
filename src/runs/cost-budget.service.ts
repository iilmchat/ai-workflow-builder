import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns } from '../db/schema.js';

/** Режим бюджета запуска: `hard` — блокировать, `soft` — только предупреждать. */
export type BudgetMode = 'hard' | 'soft';

/** Дефолтный лимит запуска в USD (совпадает с дефолтом env-схемы). */
export const DEFAULT_MAX_COST_USD = 5;
/** Дефолтный лимит запуска в рублях (совпадает с дефолтом env-схемы). */
export const DEFAULT_MAX_COST_RUB = 500;
/** Дефолтный курс RUB→USD для нормализации лимитов в одну валюту. */
export const DEFAULT_USD_RUB_RATE = 100;
/** Дефолтный режим бюджета. */
export const DEFAULT_BUDGET_MODE: BudgetMode = 'hard';

/**
 * Оценка стоимости следующего вызова (в валюте провайдера).
 *
 * Обе валюты необязательны: LLM-узлы оцениваются в USD, media-узлы — в рублях,
 * а узел без известной цены может не передать оценку вовсе (`0`).
 */
export interface CostEstimate {
  /** Ожидаемая стоимость вызова в USD. */
  usd?: number;
  /** Ожидаемая стоимость вызова в рублях. */
  rub?: number;
}

/** Результат проверки бюджета запуска. */
export interface BudgetCheckResult {
  /**
   * Укладывается ли следующий вызов в лимиты — **факт**, без учёта режима.
   *
   * В `soft`-режиме `ok: false` не блокирует вызов (это решает
   * {@link CostBudgetService.assertWithinBudgetAsync}), но UI показывает
   * предупреждение, а не «всё хорошо».
   */
  ok: boolean;
  /** Уже потрачено запуском, USD (рубли пересчитаны по курсу). */
  accumulated: number;
  /** Оценка проверяемого вызова, USD. */
  estimated: number;
  /** Остаток бюджета, USD (может быть отрицательным — бюджет превышен). */
  remaining: number;
  /** Лимит запуска в USD. */
  maxUsd: number;
  /** Лимит запуска в рублях. */
  maxRub: number;
  /** Режим бюджета. */
  mode: BudgetMode;
}

/**
 * Ошибка: бюджет запуска исчерпан (KI-048).
 *
 * Текст ошибки — публичный контракт: он попадает в `node_runs.error` и
 * показывается пользователю в узле как
 * `Budget exceeded (estimated: $X, remaining: $Y)` (DESIGN v0.9 § 3.1),
 * поэтому формат собирается здесь, а не в исполнителях.
 */
export class BudgetExceededException extends Error {
  /** Оценка несостоявшегося вызова, USD. */
  readonly estimated: number;
  /** Остаток бюджета на момент проверки, USD. */
  readonly remaining: number;

  /**
   * @param estimated - оценка стоимости вызова в USD
   * @param remaining - остаток бюджета в USD (может быть отрицательным)
   */
  constructor(estimated: number, remaining: number) {
    super(
      `Budget exceeded (estimated: $${estimated.toFixed(4)}, remaining: $${remaining.toFixed(4)})`,
    );
    this.name = 'BudgetExceededException';
    this.estimated = estimated;
    this.remaining = remaining;
  }
}

/**
 * Стоимости запуска по валютам (сырые значения из `node_runs`).
 */
interface RunCostRow {
  /** Сумма `node_runs.cost_usd`, строка (Drizzle `numeric`). */
  costUsd: string | null;
  /** Сумма `node_runs.cost_rub`, строка (Drizzle `numeric`). */
  costRub: string | null;
}

/**
 * Предохранитель по стоимости запуска (R7.1, KI-048).
 *
 * **Зачем.** До v0.9 стоимость запуска ничем не ограничивалась: до 3 job-попыток
 * × 3 node-попыток = до 9 платных вызовов провайдера на узел, и каждый job-retry
 * прогонял граф заново (KI-046). Для текстовых моделей это копейки, для
 * media-инструментов (апскейл, липсинк, видео) — заметные деньги.
 *
 * **Модель.** Бюджет — свойство **запуска** (графа), а не попытки: суммы берутся
 * из `node_runs` (`cost_usd`/`cost_rub`), поэтому повторный прогон графа
 * учитывает уже потраченное (DESIGN v0.9 § 3.1 «Взаимодействие с job-retry»).
 * Лимиты задаются в двух валютах (`WORKFLOW_RUN_MAX_COST_USD` /
 * `WORKFLOW_RUN_MAX_COST_RUB`), а нормализуются в USD по курсу
 * `WORKFLOW_RUN_USD_RUB_RATE` — так у пользователя одна шкала в UI и в тексте
 * ошибки, и при этом рублёвый лимит остаётся независимым.
 *
 * **Режимы.** `hard` (дефолт) — превышение блокирует вызов
 * ({@link assertWithinBudgetAsync} бросает {@link BudgetExceededException}),
 * `soft` — предупреждение в лог и продолжение (DESIGN § 2.6: industry practice
 * warning + graceful degradation).
 *
 * Проверка вызывается **перед** обращением к провайдеру — в исполнителях узлов
 * `llm`, `image_generation` и `image_tool`.
 */
@Injectable()
export class CostBudgetService {
  private readonly logger = new Logger(CostBudgetService.name);

  /** Лимит запуска в USD. */
  private readonly maxUsd: number;
  /** Лимит запуска в рублях. */
  private readonly maxRub: number;
  /** Режим бюджета. */
  private readonly mode: BudgetMode;
  /** Курс RUB→USD для нормализации (сколько рублей в одном долларе). */
  private readonly usdRubRate: number;

  /**
   * @param db - доступ к `node_runs` (источник фактических трат запуска)
   * @param config - переменные окружения бюджета (RULES 4.6)
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
  ) {
    this.maxUsd =
      config.get<number>('WORKFLOW_RUN_MAX_COST_USD') ?? DEFAULT_MAX_COST_USD;
    this.maxRub =
      config.get<number>('WORKFLOW_RUN_MAX_COST_RUB') ?? DEFAULT_MAX_COST_RUB;
    this.mode =
      config.get<BudgetMode>('WORKFLOW_RUN_BUDGET_MODE') ?? DEFAULT_BUDGET_MODE;
    this.usdRubRate =
      config.get<number>('WORKFLOW_RUN_USD_RUB_RATE') ?? DEFAULT_USD_RUB_RATE;
  }

  /**
   * Проверяет, укладывается ли следующий вызов в бюджет запуска.
   *
   * @param runId - uuid запуска
   * @param estimate - оценка стоимости вызова (обе валюты необязательны)
   * @returns снимок бюджета: `ok`, потрачено, оценка, остаток и лимиты
   * @throws Error если не удалось прочитать траты запуска (RULES 4.18: не гасим)
   */
  async checkBudgetAsync(
    runId: string,
    estimate: CostEstimate = {},
  ): Promise<BudgetCheckResult> {
    const [row] = await this.db
      .select({
        costUsd: sql<string | null>`coalesce(sum(${nodeRuns.costUsd}), 0)`,
        costRub: sql<string | null>`coalesce(sum(${nodeRuns.costRub}), 0)`,
      })
      .from(nodeRuns)
      .where(eq(nodeRuns.runId, runId));

    const spentUsd = toAmount((row as RunCostRow | undefined)?.costUsd);
    const spentRub = toAmount((row as RunCostRow | undefined)?.costRub);
    const accumulated = spentUsd + spentRub / this.usdRubRate;

    const estimatedUsd = (estimate.usd ?? 0) + (estimate.rub ?? 0) / this.usdRubRate;
    const remaining = Math.min(
      this.maxUsd - accumulated,
      (this.maxRub - spentRub) / this.usdRubRate,
    );
    const withinLimits =
      accumulated + estimatedUsd <= this.maxUsd &&
      spentRub + (estimate.rub ?? 0) <= this.maxRub;

    return {
      ok: withinLimits,
      accumulated,
      estimated: estimatedUsd,
      remaining,
      maxUsd: this.maxUsd,
      maxRub: this.maxRub,
      mode: this.mode,
    };
  }

  /**
   * Проверяет бюджет и бросает исключение при превышении в режиме `hard`.
   *
   * Вызывается исполнителями узлов перед обращением к провайдеру: в `soft`
   * режиме превышение попадает в лог предупреждением и работа продолжается,
   * в `hard` — узел падает с {@link BudgetExceededException} (текст ошибки
   * показывается пользователю).
   *
   * @param runId - uuid запуска
   * @param estimate - оценка стоимости вызова
   * @returns снимок бюджета (пригоден для логов и UI)
   * @throws BudgetExceededException если лимит превышен, а режим — `hard`
   */
  async assertWithinBudgetAsync(
    runId: string,
    estimate: CostEstimate = {},
  ): Promise<BudgetCheckResult> {
    const check = await this.checkBudgetAsync(runId, estimate);

    // `remaining` — минимум из двух лимитов (USD и RUB), поэтому превышение
    // определяется сравнением с ним: вызов не влезает, если оценка больше
    // остатка. Нулевая оценка при уже исчерпанном бюджете тоже считается
    // превышением — иначе hard cap не остановил бы повторный прогон графа
    // (KI-048: стоимость предыдущих попыток не сбрасывается).
    const exceeded = check.estimated > check.remaining;

    if (!exceeded) {
      return check;
    }

    if (check.mode === 'soft') {
      this.logger.warn(
        `Запуск ${runId}: бюджет превышен (потрачено $${check.accumulated.toFixed(4)}, ` +
          `оценка $${check.estimated.toFixed(4)}, остаток $${check.remaining.toFixed(4)}) — ` +
          'режим soft, вызов продолжается',
      );

      return check;
    }

    this.logger.warn(
      `Запуск ${runId}: бюджет исчерпан (потрачено $${check.accumulated.toFixed(4)}, ` +
        `оценка $${check.estimated.toFixed(4)}, остаток $${check.remaining.toFixed(4)})`,
    );

    throw new BudgetExceededException(check.estimated, check.remaining);
  }

  /**
   * Возвращает лимиты и режим бюджета без обращения к БД.
   *
   * Нужен UI (прогресс-бар в TopBar) и ручке `GET /runs/:id/budget`, когда
   * запуска ещё нет.
   *
   * @returns лимиты в двух валютах и режим
   */
  getLimits(): { maxUsd: number; maxRub: number; mode: BudgetMode } {
    return { maxUsd: this.maxUsd, maxRub: this.maxRub, mode: this.mode };
  }
}

/**
 * Приводит значение `numeric`/`sum` из БД к числу.
 *
 * Drizzle отдаёт `numeric` строкой (RULES 4.23), а агрегат может прийти
 * `null`-ом на пустой выборке: обе формы сводим к `0`.
 *
 * @param value - значение из БД (строка, число или `null`)
 * @returns число; `0`, если значение пустое или не число
 */
function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
