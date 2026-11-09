import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { DeviceTokensService } from '../notifications/device-tokens.service.js';
import type { ExecuteRunJobDto, RunEventDto } from './dto/index.js';
import { RunEventsService } from './run-events.service.js';
import { RunsProcessor } from './runs.processor.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** uuid workflow, к которому относится запуск. */
const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333';

/** uuid владельца workflow (`workflows.user_id`). */
const USER_ID = '44444444-4444-4444-8444-444444444444';

/** Имя workflow в теле уведомления. */
const WORKFLOW_NAME = 'Мой сценарий';

/** Валидный снимок графа из одной ноды. */
const snapshot = {
  nodes: [{ id: 'A', type: 'text', data: { value: 'x' } }],
  edges: [],
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * Копия хелпера из `runs.processor.spec.ts`: тест push сам решает, что вернёт
 * второй SELECT (владелец workflow), поэтому нужен отдельный набор цепочек.
 *
 * @param resolveWith - значение, которое получит `await` цепочки
 * @returns прокси-chain с методами-моками
 */
function chain(resolveWith: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of ['from', 'innerJoin', 'where', 'limit', 'values', 'set']) {
    link[method] = vi.fn(() => proxy);
  }

  link.returning = vi.fn(() => resolveWith);

  return proxy;
}

/**
 * Цепочка, которая падает при `await` (сбой БД).
 *
 * Нужна, чтобы проверить изоляцию push: SELECT владельца может не выполниться,
 * но `run_completed` уже опубликован и процессор не должен пробрасывать эту
 * ошибку наружу.
 *
 * @param failure - ошибка, которую получит `await` цепочки
 * @returns прокси-chain, отклоняющий ожидание
 */
function rejectingChain(failure: Error): Record<string, ReturnType<typeof vi.fn>> {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (
          _resolve: (value: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) => reject(failure);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of ['from', 'innerJoin', 'where', 'limit']) {
    link[method] = vi.fn(() => proxy);
  }

  return proxy;
}

/**
 * Оборачивает данные в минимальный объект задания BullMQ.
 *
 * @param attemptsMade - сколько попыток уже сделал BullMQ
 * @returns задание с `data`, `attemptsMade` и `opts.attempts`
 */
function job(attemptsMade = 0): Job<ExecuteRunJobDto> {
  return {
    id: 'job-1',
    data: { runId: RUN_ID },
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<ExecuteRunJobDto>;
}

/** Окружение push-флагов для одного теста. */
interface PushEnv {
  /** `PUSH_ON_RUN_COMPLETE`. */
  readonly enabled: boolean;
  /** `PUSH_ON_RUN_COMPLETE_SUCCESS`. */
  readonly onSuccess: boolean;
}

/** Собранный процессор и его моки. */
interface Harness {
  readonly processor: RunsProcessor;
  readonly executor: { executeAsync: ReturnType<typeof vi.fn> };
  readonly events: { publishAsync: ReturnType<typeof vi.fn> };
  readonly send: ReturnType<typeof vi.fn>;
}

/**
 * Собирает `RunsProcessor` с моками БД, движка, событий и push-сервиса.
 *
 * Первый `db.select` — поиск запуска (`findRunAsync`), второй — владелец и имя
 * workflow для уведомления. Порядок детерминирован: `process` делает эти
 * запросы строго последовательно.
 *
 * @param env - значения push-флагов, которые увидит `ConfigService`
 * @param ownerFailure - если задано, SELECT владельца падает этой ошибкой
 * @returns процессор и моки для проверок
 */
async function createHarnessAsync(
  env: PushEnv,
  ownerFailure?: Error,
): Promise<Harness> {
  const runChain = chain([{ status: 'pending', snapshot }]);
  const ownerChain =
    ownerFailure === undefined
      ? chain([
          {
            userId: USER_ID,
            workflowId: WORKFLOW_ID,
            workflowName: WORKFLOW_NAME,
          },
        ])
      : rejectingChain(ownerFailure);
  const updateChain = chain([{ id: RUN_ID }]);

  let selectCalls = 0;
  const db = {
    select: vi.fn(() => {
      selectCalls += 1;

      return selectCalls === 1 ? runChain : ownerChain;
    }),
    update: vi.fn(() => updateChain),
  };

  const executor = {
    executeAsync: vi.fn(() =>
      Promise.resolve({
        status: 'completed',
        executedNodes: 1,
        failedNodeId: null,
        error: null,
        outputs: {},
      }),
    ),
  };
  const events = { publishAsync: vi.fn(() => Promise.resolve()) };
  const send = vi.fn(() => Promise.resolve(1));
  const deviceTokens = { sendToUserAsync: send };

  const moduleRef = await Test.createTestingModule({
    providers: [
      RunsProcessor,
      { provide: DRIZZLE, useValue: db as unknown as Database },
      { provide: ExecutionEngineService, useValue: executor },
      { provide: RunEventsService, useValue: events },
      { provide: DeviceTokensService, useValue: deviceTokens },
      {
        provide: ConfigService,
        useValue: {
          get: vi.fn((key: string) =>
            key === 'PUSH_ON_RUN_COMPLETE' ? env.enabled : env.onSuccess,
          ),
        },
      },
    ],
  }).compile();

  return {
    processor: moduleRef.get(RunsProcessor),
    executor,
    events,
    send,
  };
}

/**
 * Последнее опубликованное событие заданного типа.
 *
 * @param events - мок `RunEventsService`
 * @param type - тип события
 * @returns событие либо `undefined`
 */
function publishedEvent(
  events: Harness['events'],
  type: RunEventDto['type'],
): RunEventDto | undefined {
  return events.publishAsync.mock.calls
    .map(([, event]) => event)
    .filter((event) => (event as RunEventDto).type === type)
    .at(-1) as RunEventDto | undefined;
}

describe('RunsProcessor: push о завершении запуска (v1.5.0 S5-B, KI-659)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('failed + PUSH_ON_RUN_COMPLETE=true: отправляет push с runId и workflowId', async () => {
    const harness = await createHarnessAsync({ enabled: true, onSuccess: false });

    harness.executor.executeAsync.mockRejectedValue(new Error('граф упал'));

    // attemptsMade=2 при attempts=3 — финальная попытка, retry не будет.
    await expect(harness.processor.process(job(2))).rejects.toThrow('граф упал');

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledWith(
      USER_ID,
      'Запуск упал',
      expect.stringContaining(WORKFLOW_NAME),
      expect.objectContaining({ runId: RUN_ID, workflowId: WORKFLOW_ID }),
    );
  });

  it('completed + PUSH_ON_RUN_COMPLETE_SUCCESS=false: push не отправляется', async () => {
    const harness = await createHarnessAsync({ enabled: true, onSuccess: false });

    await expect(harness.processor.process(job())).resolves.toBeUndefined();

    expect(harness.send).not.toHaveBeenCalled();
    expect(publishedEvent(harness.events, 'run_completed')).toMatchObject({
      status: 'completed',
      final: true,
    });
  });

  it('completed + PUSH_ON_RUN_COMPLETE_SUCCESS=true: push отправляется', async () => {
    const harness = await createHarnessAsync({ enabled: true, onSuccess: true });

    await expect(harness.processor.process(job())).resolves.toBeUndefined();

    expect(harness.send).toHaveBeenCalledTimes(1);
    expect(harness.send).toHaveBeenCalledWith(
      USER_ID,
      'Запуск завершён',
      expect.stringContaining(WORKFLOW_NAME),
      expect.objectContaining({ runId: RUN_ID, workflowId: WORKFLOW_ID }),
    );
  });

  it('PUSH_ON_RUN_COMPLETE=false: не отправляет push ни для failed, ни для completed', async () => {
    const failed = await createHarnessAsync({ enabled: false, onSuccess: true });

    failed.executor.executeAsync.mockRejectedValue(new Error('граф упал'));

    await expect(failed.processor.process(job(2))).rejects.toThrow('граф упал');
    expect(failed.send).not.toHaveBeenCalled();

    const completed = await createHarnessAsync({ enabled: false, onSuccess: true });

    await expect(completed.processor.process(job())).resolves.toBeUndefined();
    expect(completed.send).not.toHaveBeenCalled();
  });

  it('ошибка sendToUserAsync не отменяет run_completed и логируется', async () => {
    const harness = await createHarnessAsync({ enabled: true, onSuccess: true });
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    harness.send.mockRejectedValue(new Error('RuStore недоступен'));

    await expect(harness.processor.process(job())).resolves.toBeUndefined();

    expect(publishedEvent(harness.events, 'run_completed')).toMatchObject({
      status: 'completed',
      final: true,
    });

    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Не удалось отправить push'),
      );
    });
  });

  it('сбой SELECT владельца не ломает завершение запуска', async () => {
    const harness = await createHarnessAsync(
      { enabled: true, onSuccess: true },
      new Error('БД недоступна'),
    );
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(harness.processor.process(job())).resolves.toBeUndefined();

    expect(publishedEvent(harness.events, 'run_completed')).toMatchObject({
      status: 'completed',
      final: true,
    });
    expect(harness.send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Не удалось подготовить push'),
    );
  });
});
