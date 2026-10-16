import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Database } from '../db/db.module.js';
import { DRIZZLE } from '../db/db.module.js';
import {
  BudgetExceededException,
  CostBudgetService,
  type BudgetCheckResult,
} from './cost-budget.service.js';

/**
 * Создаёт заглушку DRIZZLE с одной строкой агрегата.
 *
 * `CostBudgetService` читает траты запуска одним запросом
 * `select(...).from(node_runs).where(...)` — этого хватает, чтобы проверить всю
 * логику бюджета, не поднимая БД (KI-048).
 *
 * @param row - строка агрегата (`sum(cost_usd)`, `sum(cost_rub)`) либо `undefined`
 * @returns заглушка `Database`
 */
function fakeDb(row?: { costUsd: string | null; costRub: string | null }): Database {
  const rows = row === undefined ? [] : [row];

  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    }),
  } as unknown as Database;
}

/**
 * Собирает сервис бюджета на заданных env и тратах запуска.
 *
 * @param env - значения переменных окружения бюджета
 * @param row - строка агрегата трат (по умолчанию — ничего не потрачено)
 * @returns экземпляр сервиса
 */
async function createService(
  env: Record<string, unknown> = {},
  row?: { costUsd: string | null; costRub: string | null },
): Promise<CostBudgetService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      CostBudgetService,
      { provide: DRIZZLE, useValue: fakeDb(row) },
      {
        provide: ConfigService,
        useValue: { get: vi.fn((key: string) => env[key]) },
      },
    ],
  }).compile();

  return moduleRef.get(CostBudgetService);
}

/** Идентификатор запуска в тестах. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

describe('CostBudgetService (R7.1, KI-048)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('считает потраченное как сумму USD и RUB, приведённых к доллару', async () => {
    const service = await createService(
      { WORKFLOW_RUN_USD_RUB_RATE: 100 },
      { costUsd: '0.500000', costRub: '100.000000' },
    );

    const check = await service.checkBudgetAsync(RUN_ID);

    // 0.5 USD + 100 ₽ / 100 = 1.5 USD.
    expect(check.accumulated).toBeCloseTo(1.5, 6);
    expect(check.remaining).toBeCloseTo(3.5, 6);
    expect(check.maxUsd).toBe(5);
    expect(check.maxRub).toBe(500);
    expect(check.mode).toBe('hard');
    expect(check.ok).toBe(true);
  });

  it('без строк в node_runs потраченное равно нулю', async () => {
    const service = await createService();
    const check = await service.checkBudgetAsync(RUN_ID);

    expect(check.accumulated).toBe(0);
    expect(check.remaining).toBe(5);
  });

  it('hard: превышение лимита USD → BudgetExceededException с точным текстом', async () => {
    const service = await createService(
      { WORKFLOW_RUN_MAX_COST_USD: 1, WORKFLOW_RUN_USD_RUB_RATE: 100 },
      { costUsd: '0.900000', costRub: '0' },
    );

    const error = await service
      .assertWithinBudgetAsync(RUN_ID, { usd: 0.5 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BudgetExceededException);
    // Формат текста — контракт DESIGN v0.9 § 3.1: узел показывает его как есть.
    expect((error as BudgetExceededException).message).toBe(
      'Budget exceeded (estimated: $0.5000, remaining: $0.1000)',
    );
  });

  it('hard: вызов в пределах лимита проходит и возвращает снимок', async () => {
    const service = await createService(
      { WORKFLOW_RUN_MAX_COST_USD: 5, WORKFLOW_RUN_USD_RUB_RATE: 100 },
      { costUsd: '1.000000', costRub: '0' },
    );

    const check = await service.assertWithinBudgetAsync(RUN_ID, { usd: 0.5 });

    expect(check.ok).toBe(true);
    expect(check.accumulated).toBeCloseTo(1, 6);
  });

  it('soft: превышение не бросает, но ok=false (graceful degradation)', async () => {
    const service = await createService(
      {
        WORKFLOW_RUN_MAX_COST_USD: 1,
        WORKFLOW_RUN_BUDGET_MODE: 'soft',
        WORKFLOW_RUN_USD_RUB_RATE: 100,
      },
      { costUsd: '5.000000', costRub: '0' },
    );

    const check = await service.assertWithinBudgetAsync(RUN_ID, { usd: 1 });
    const raw = await service.checkBudgetAsync(RUN_ID, { usd: 1 });

    expect(check.mode).toBe('soft');
    expect(check.ok).toBe(false);
    expect(raw.ok).toBe(false);
    expect(check.remaining).toBeLessThan(0);
  });

  it('рублёвый лимит работает независимо от долларового', async () => {
    const service = await createService(
      {
        WORKFLOW_RUN_MAX_COST_USD: 1000,
        WORKFLOW_RUN_MAX_COST_RUB: 500,
        WORKFLOW_RUN_USD_RUB_RATE: 100,
      },
      { costUsd: '0', costRub: '400.000000' },
    );

    const allowed = await service.assertWithinBudgetAsync(RUN_ID, { rub: 50 });
    const error = await service
      .assertWithinBudgetAsync(RUN_ID, { rub: 200 })
      .catch((caught: unknown) => caught);

    expect(allowed.ok).toBe(true);
    expect(error).toBeInstanceOf(BudgetExceededException);
  });

  it('нулевая оценка при исчерпанном бюджете — тоже превышение (job-retry, KI-048)', async () => {
    // DESIGN v0.9 § 3.1: стоимость прошлых попыток не сбрасывается, поэтому на
    // повторном прогоне графа узел обязан упасть, даже если оценка неизвестна.
    const service = await createService(
      { WORKFLOW_RUN_MAX_COST_USD: 1, WORKFLOW_RUN_USD_RUB_RATE: 100 },
      { costUsd: '2.000000', costRub: '0' },
    );

    await expect(service.assertWithinBudgetAsync(RUN_ID)).rejects.toThrow(
      BudgetExceededException,
    );
  });

  it('отдаёт лимиты и режим без обращения к БД (для UI и ручки бюджета)', async () => {
    const service = await createService({
      WORKFLOW_RUN_MAX_COST_USD: 7,
      WORKFLOW_RUN_MAX_COST_RUB: 700,
      WORKFLOW_RUN_BUDGET_MODE: 'soft',
    });

    expect(service.getLimits()).toEqual({
      maxUsd: 7,
      maxRub: 700,
      mode: 'soft',
    });
  });

  it('оценка в рублях нормализуется в доллары в снимке', async () => {
    const service = await createService(
      { WORKFLOW_RUN_USD_RUB_RATE: 80 },
      { costUsd: '0', costRub: '0' },
    );

    const check: BudgetCheckResult = await service.checkBudgetAsync(RUN_ID, {
      rub: 160,
    });

    // 160 ₽ / 80 = 2 USD.
    expect(check.estimated).toBeCloseTo(2, 6);
    expect(check.remaining).toBeCloseTo(5, 6);
  });
});
