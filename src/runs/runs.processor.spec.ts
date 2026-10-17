import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns } from '../db/schema.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import type { ExecuteRunJobDto, RunEventDto } from './dto/index.js';
import { RunEventsService } from './run-events.service.js';
import { RunsProcessor } from './runs.processor.js';
import {
  RUNS_INSTANCE_ID,
  WORKFLOW_RUNS_WORKER_OPTIONS,
} from './runs.worker-options.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** Валидный снимок графа из одной ноды. */
const snapshot = {
  nodes: [{ id: 'A', type: 'text', data: { value: 'x' } }],
  edges: [],
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * Каждый метод возвращает саму цепочку (её можно дожидаться через `await`),
 * значение для `await` задаётся через `resolveWith`; терминальный `returning()`
 * возвращает массив строк, как настоящий Drizzle.
 *
 * @param resolveWith - значение, которое получит `await` цепочки
 * @returns прокси-chain с методами-моками
 */
function chain(resolveWith: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  // Свойство `then` живёт только в прокси, чтобы не заводить thenable
  // в самом объекте цепочки (правило unicorn/no-thenable).
  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of ['from', 'where', 'limit', 'values', 'set']) {
    link[method] = vi.fn(() => proxy);
  }

  link.returning = vi.fn(() => resolveWith);

  return proxy;
}

/**
 * Оборачивает данные в минимальный объект задания BullMQ.
 *
 * @param data - payload задания
 * @param attemptsMade - сколько попыток уже сделал BullMQ (0 — первый вызов)
 * @returns задание с `data`, `attemptsMade` и `opts.attempts`
 */
function job(data: unknown, attemptsMade = 0): Job<ExecuteRunJobDto> {
  return {
    id: 'job-1',
    data,
    attemptsMade,
    opts: { attempts: 3 },
  } as unknown as Job<ExecuteRunJobDto>;
}

describe('RunsProcessor', () => {
  let processor: RunsProcessor;
  let selectChain: ReturnType<typeof chain>;
  let updateChain: ReturnType<typeof chain>;
  let db: Record<string, ReturnType<typeof vi.fn>>;
  let executor: { executeAsync: ReturnType<typeof vi.fn> };
  let events: {
    publishAsync: ReturnType<
      typeof vi.fn<(runId: string, event: RunEventDto) => Promise<void>>
    >;
  };

  beforeEach(async () => {
    selectChain = chain([{ status: 'pending', snapshot }]);
    updateChain = chain([{ id: RUN_ID }]);

    db = {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    };

    executor = {
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

    events = { publishAsync: vi.fn(() => Promise.resolve()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunsProcessor,
        { provide: DRIZZLE, useValue: db as unknown as Database },
        { provide: ExecutionEngineService, useValue: executor },
        { provide: RunEventsService, useValue: events },
      ],
    }).compile();

    processor = moduleRef.get(RunsProcessor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Последнее опубликованное событие заданного типа.
   *
   * @param type - тип события прогресса
   * @returns событие либо `undefined`, если такого не публиковалось
   */
  const publishedEvent = (type: RunEventDto['type']): RunEventDto | undefined =>
    events.publishAsync.mock.calls
      .map(([, event]) => event)
      .filter((event) => event.type === type)
      .at(-1);

  it('делегирует выполнение executor-сервису с валидированным снимком графа', async () => {
    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(selectChain.from).toHaveBeenCalledWith(workflowRuns);
    expect(executor.executeAsync).toHaveBeenCalledWith(RUN_ID, {
      nodes: [{ id: 'A', type: 'text', data: { value: 'x' } }],
      edges: [],
    });
  });

  it('помечает запуск failed и бросает при битом snapshot', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'pending', snapshot: { nodes: 'не-массив' } },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).rejects.toThrow(
      'Некорректный snapshot',
    );

    expect(executor.executeAsync).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledWith(workflowRuns);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('пропускает задание, если запуск уже не pending (идемпотентность)', async () => {
    selectChain.limit.mockImplementation(() => [{ status: 'completed', snapshot }]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('пропускает свежий running-запуск: аренда ещё жива (KI-023)', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'running', snapshot, startedAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('перезапускает граф для зависшего running-запуска (KI-023)', async () => {
    selectChain.limit.mockImplementation(() => [
      {
        status: 'running',
        snapshot,
        startedAt: new Date(Date.now() - 10 * 60_000),
      },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ nodes: expect.any(Array) }),
    );
  });

  it('пропускает running-запуск без started_at (консервативно, KI-023)', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'running', snapshot, startedAt: null },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('не перезапускает упавший запуск, даже если started_at старый (KI-023)', async () => {
    selectChain.limit.mockImplementation(() => [
      {
        status: 'failed',
        snapshot,
        startedAt: new Date(Date.now() - 10 * 60_000),
      },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('KI-040: не переигрывает failed-запуск без job-level retry (attemptsMade=0)', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'failed', snapshot, startedAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('KI-040: переигрывает граф при job-level retry для failed-запуска', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'failed', snapshot, startedAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(
      processor.process(job({ runId: RUN_ID }, 2)),
    ).resolves.toBeUndefined();

    expect(executor.executeAsync).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ nodes: expect.any(Array) }),
    );
  });

  it('KI-040: не переигрывает completed-запуск даже при job-level retry', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'completed', snapshot, startedAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(
      processor.process(job({ runId: RUN_ID }, 2)),
    ).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('KI-040: живой lease важнее job-level retry для running-запуска', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'running', snapshot, startedAt: new Date(Date.now() - 60_000) },
    ]);

    await expect(
      processor.process(job({ runId: RUN_ID }, 2)),
    ).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('бросает, если запуск не найден', async () => {
    selectChain.limit.mockImplementation(() => []);

    await expect(processor.process(job({ runId: RUN_ID }))).rejects.toThrow(
      `Запуск ${RUN_ID} не найден`,
    );
    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('пробрасывает ошибку executor-сервиса, не гася стек', async () => {
    const failure = new Error('граф упал');

    executor.executeAsync.mockRejectedValue(failure);

    await expect(processor.process(job({ runId: RUN_ID }))).rejects.toBe(failure);
  });

  it('отклоняет задание с невалидным payload', async () => {
    await expect(processor.process(job({ runId: 'не-uuid' }))).rejects.toThrow(
      'Некорректный payload',
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  describe('настройки воркера (KI-065)', () => {
    it('опции concurrency/lockDuration/maxStalledCount доезжают до @Processor', () => {
      // Ключ метаданных из @nestjs/bullmq (bull.constants.js): публичного
      // аксессора в пакете нет, поэтому читаем метаданные напрямую. Если
      // декоратор перестанет получать опции — тест упадёт.
      const options: unknown = Reflect.getMetadata(
        'bullmq:worker_metadata',
        RunsProcessor,
      );

      expect(options).toEqual(
        expect.objectContaining({
          concurrency: WORKFLOW_RUNS_WORKER_OPTIONS.concurrency,
          lockDuration: WORKFLOW_RUNS_WORKER_OPTIONS.lockDuration,
          maxStalledCount: WORKFLOW_RUNS_WORKER_OPTIONS.maxStalledCount,
          // KI-387: воркер обязан слушать тот же префикс, что и очередь.
          prefix: WORKFLOW_RUNS_WORKER_OPTIONS.prefix,
        }),
      );
      expect(WORKFLOW_RUNS_WORKER_OPTIONS.prefix).toBe('workflow-runs');
    });

    it('concurrency больше 1 — очередь не блокируется одним заданием', () => {
      expect(WORKFLOW_RUNS_WORKER_OPTIONS.concurrency).toBeGreaterThan(1);
    });
  });

  describe('изоляция инстансов (KI-387)', () => {
    it('пропускает задание чужого instanceId: лог + return без обращения к БД', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        processor.process(job({ runId: RUN_ID, instanceId: 'other-instance' })),
      ).resolves.toBeUndefined();

      // Задание чужого инстанса не должно трогать чужой запуск в БД и не
      // должно выполнять граф: именно это привело к списанию 80 ₽ в R7.2.
      expect(db.select).not.toHaveBeenCalled();
      expect(executor.executeAsync).not.toHaveBeenCalled();
      expect(events.publishAsync).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('KI-387'));
    });

    it('выполняет задание, созданное этим же инстансом', async () => {
      await expect(
        processor.process(job({ runId: RUN_ID, instanceId: RUNS_INSTANCE_ID })),
      ).resolves.toBeUndefined();

      expect(executor.executeAsync).toHaveBeenCalledWith(
        RUN_ID,
        expect.objectContaining({ nodes: expect.any(Array) }),
      );
    });

    it('выполняет задание без instanceId (обратная совместимость)', async () => {
      // Задания, поставленные до R7.2b, маркера не несут — их нельзя терять.
      await expect(
        processor.process(job({ runId: RUN_ID })),
      ).resolves.toBeUndefined();

      expect(executor.executeAsync).toHaveBeenCalled();
    });
  });

  describe('run_completed и признак финальности (KI-060)', () => {
    it('публикует final=true при успешном запуске', async () => {
      await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

      expect(publishedEvent('run_completed')).toEqual(
        expect.objectContaining({
          status: 'completed',
          attemptsMade: 0,
          attempts: 3,
          final: true,
        }),
      );
    });

    it('публикует final=true при детерминированном провале без проброса (KI-037)', async () => {
      // Так ведёт себя executeAsync на графе с циклом: статус failed в БД,
      // исключения нет → BullMQ повторять не будет.
      executor.executeAsync.mockResolvedValue({
        status: 'failed',
        executedNodes: 0,
        failedNodeId: null,
        error: 'Граф содержит цикл',
        outputs: {},
      });

      await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

      expect(publishedEvent('run_completed')).toEqual(
        expect.objectContaining({
          status: 'failed',
          attemptsMade: 0,
          attempts: 3,
          final: true,
        }),
      );
    });

    it('публикует final=false, когда проброс есть, а попытки остались', async () => {
      executor.executeAsync.mockRejectedValue(new Error('граф упал'));

      await expect(processor.process(job({ runId: RUN_ID }, 0))).rejects.toThrow(
        'граф упал',
      );

      expect(publishedEvent('run_completed')).toEqual(
        expect.objectContaining({
          status: 'failed',
          attemptsMade: 0,
          attempts: 3,
          final: false,
        }),
      );
    });

    it('публикует final=true, когда проброс есть и попытки исчерпаны', async () => {
      executor.executeAsync.mockRejectedValue(new Error('граф упал'));

      await expect(processor.process(job({ runId: RUN_ID }, 2))).rejects.toThrow(
        'граф упал',
      );

      expect(publishedEvent('run_completed')).toEqual(
        expect.objectContaining({
          status: 'failed',
          attemptsMade: 2,
          attempts: 3,
          final: true,
        }),
      );
    });

    it('публикует final=true, когда лимит попыток не задан (BullMQ не ретраит)', async () => {
      executor.executeAsync.mockRejectedValue(new Error('граф упал'));

      const noLimitJob = {
        id: 'job-1',
        data: { runId: RUN_ID },
        attemptsMade: 0,
        opts: {},
      } as unknown as Job<ExecuteRunJobDto>;

      await expect(processor.process(noLimitJob)).rejects.toThrow('граф упал');

      expect(publishedEvent('run_completed')).toEqual(
        expect.objectContaining({
          status: 'failed',
          attemptsMade: 0,
          attempts: null,
          final: true,
        }),
      );
    });

    it('публикует run_completed и при битом snapshot (проброс, попытки остались)', async () => {
      selectChain.limit.mockImplementation(() => [
        { status: 'pending', snapshot: { nodes: 'не-массив' } },
      ]);

      await expect(processor.process(job({ runId: RUN_ID }))).rejects.toThrow(
        'Некорректный snapshot',
      );

      expect(publishedEvent('run_completed')).toEqual(
        expect.objectContaining({ status: 'failed', final: false }),
      );
    });

    it('не публикует run_completed, если задание отброшено guard-ом', async () => {
      selectChain.limit.mockImplementation(() => [
        { status: 'completed', snapshot, startedAt: new Date(Date.now() - 60_000) },
      ]);

      await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

      expect(events.publishAsync).not.toHaveBeenCalled();
    });
  });
});
