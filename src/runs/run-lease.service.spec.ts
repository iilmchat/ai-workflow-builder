import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { RunLeaseService } from './run-lease.service.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** Второй запуск — для проверки нескольких таймеров. */
const SECOND_RUN_ID = '33333333-3333-4333-8333-333333333333';

/** Период heartbeat в тестах (значение из ConfigService-заглушки). */
const HEARTBEAT_MS = 1_000;

/** Срок аренды в тестах (значение из ConfigService-заглушки). */
const LEASE_TTL_MS = 3_000;

/** Состояние тестового двойника Drizzle. */
interface FakeDbState {
  /** Строка запуска ещё `running` (иначе UPDATE не вернёт её). */
  running: boolean;
  /** Сколько раз дошло до `returning()` (одна попытка продления). */
  renewCalls: number;
  /** Payload'ы `.set(...)` — для проверки, что lease действительно пишется. */
  updates: Array<Record<string, unknown>>;
  /** Если задано — `returning()` бросает эту ошибку (имитация сбоя БД). */
  failure: Error | null;
}

/**
 * Создаёт минимальный двойник Drizzle для `RunLeaseService`.
 *
 * Сервис делает ровно одну цепочку: `update(workflowRuns).set(...).where(...)`
 * `.returning({ id })`. Двойник запоминает payload `.set` и возвращает строку,
 * только пока `running = true` — так проверяется условие `status = 'running'`.
 *
 * @returns двойник `Database` и его изменяемое состояние
 */
function createFakeDb(): {
  db: Database;
  state: FakeDbState;
} {
  const state: FakeDbState = {
    running: true,
    renewCalls: 0,
    updates: [],
    failure: null,
  };

  const db = {
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);

        return {
          where: (_condition: unknown) => ({
            returning: async (): Promise<Array<{ id: string }>> => {
              state.renewCalls += 1;

              if (state.failure !== null) {
                throw state.failure;
              }

              return state.running ? [{ id: RUN_ID }] : [];
            },
          }),
        };
      },
    }),
  };

  return { db: db as unknown as Database, state };
}

describe('RunLeaseService (v0.11 S9, KI-066)', () => {
  let service: RunLeaseService;
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(async () => {
    fake = createFakeDb();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunLeaseService,
        { provide: DRIZZLE, useValue: fake.db },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): unknown => {
              if (key === 'WORKFLOW_RUN_HEARTBEAT_MS') {
                return HEARTBEAT_MS;
              }

              if (key === 'WORKFLOW_RUN_LEASE_TTL_MS') {
                return LEASE_TTL_MS;
              }

              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RunLeaseService);

    // Фейковые таймеры ставим после сборки Nest-модуля: сборка DI не должна
    // зависеть от подмены глобальных таймеров.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('читает TTL из ConfigService и отдаёт его движку', () => {
    expect(service.leaseTtlMs).toBe(LEASE_TTL_MS);
  });

  it('renewAsync продлевает lease только для running-строки', async () => {
    await expect(service.renewAsync(RUN_ID)).resolves.toBe(true);
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0]).toHaveProperty('leaseExpiresAt');
    expect(fake.state.updates[0].leaseExpiresAt).not.toBeNull();

    fake.state.running = false;

    await expect(service.renewAsync(RUN_ID)).resolves.toBe(false);
  });

  it('startAsync продлевает аренду сразу и планирует следующий тик', async () => {
    await service.startAsync(RUN_ID);

    // Первое продление — до первого setTimeout (нет окна с истёкшей арендой).
    expect(fake.state.renewCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);
    expect(fake.state.renewCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fake.state.renewCalls).toBe(2);
    // Тик перепланировал следующий.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('startAsync не планирует тик, если запуск уже не running', async () => {
    fake.state.running = false;

    await service.startAsync(RUN_ID);

    expect(fake.state.renewCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('сбой БД в тике логируется, но heartbeat продолжает работать', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await service.startAsync(RUN_ID);
    expect(fake.state.renewCalls).toBe(1);

    fake.state.failure = new Error('БД недоступна');
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(fake.state.renewCalls).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Heartbeat запуска ${RUN_ID} не удался`),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('БД недоступна'));
    // Ошибка не убила серию: следующий тик запланирован.
    expect(vi.getTimerCount()).toBe(1);

    fake.state.failure = null;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(fake.state.renewCalls).toBe(3);
  });

  it('прекращает heartbeat, когда запуск перестал быть running', async () => {
    await service.startAsync(RUN_ID);

    fake.state.running = false;
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    expect(fake.state.renewCalls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);

    // Дальнейшие тики не выполняются.
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3);
    expect(fake.state.renewCalls).toBe(2);
  });

  it('stop идемпотентен: снимает таймер и останавливает тики', async () => {
    await service.startAsync(RUN_ID);
    expect(vi.getTimerCount()).toBe(1);

    service.stop(RUN_ID);
    service.stop(RUN_ID);

    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 5);
    expect(fake.state.renewCalls).toBe(1);
  });

  it('stop во время тика не перепланирует таймер (гонка stop/tick)', async () => {
    await service.startAsync(RUN_ID);

    let releaseRenew!: () => void;
    const renewGate = new Promise<void>((resolve) => {
      releaseRenew = resolve;
    });

    // Тик «зависает» на продлении аренды: между проверкой #stopped и schedule.
    vi.spyOn(service, 'renewAsync').mockImplementationOnce(async () => {
      await renewGate;

      return true;
    });

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(vi.getTimerCount()).toBe(0);

    service.stop(RUN_ID);
    releaseRenew();
    await vi.advanceTimersByTimeAsync(0);

    // После `await` тик обязан увидеть флаг остановки и не планировать тик.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('повторный startAsync после stop снова включает heartbeat', async () => {
    await service.startAsync(RUN_ID);
    service.stop(RUN_ID);

    await service.startAsync(RUN_ID);

    expect(fake.state.renewCalls).toBe(2);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(fake.state.renewCalls).toBe(3);
  });

  it('onApplicationShutdown останавливает таймеры всех запусков', async () => {
    await service.startAsync(RUN_ID);
    await service.startAsync(SECOND_RUN_ID);

    expect(vi.getTimerCount()).toBe(2);

    service.onApplicationShutdown();

    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2);
    expect(fake.state.renewCalls).toBe(2);
  });
});
