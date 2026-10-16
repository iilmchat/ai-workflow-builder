import { getQueueToken } from '@nestjs/bullmq';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  workflowRuns,
  workflows,
  type Workflow,
  type WorkflowRun,
} from '../db/schema.js';
import { EXECUTE_RUN_JOB, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { RunsService } from './runs.service.js';

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const STARTED_AT = new Date('2024-01-01T00:00:00.000Z');
/** KI-015: дата создания намеренно отличается от даты старта. */
const CREATED_AT = new Date('2023-12-31T23:00:00.000Z');

const baseWorkflow: Workflow = {
  id: WORKFLOW_ID,
  userId: 'user-1',
  name: 'My workflow',
  description: null,
  nodes: [{ id: 'n1', type: 'llm', data: {} }],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  // KI-317: поле схемы обязательно в типе — у непубличного workflow null.
  shareToken: null,
  version: 1,
  createdAt: STARTED_AT,
  updatedAt: STARTED_AT,
};

const baseRun: WorkflowRun = {
  id: RUN_ID,
  workflowId: WORKFLOW_ID,
  status: 'pending',
  inputs: {},
  outputs: {},
  error: null,
  snapshot: { nodes: baseWorkflow.nodes, edges: baseWorkflow.edges },
  createdAt: CREATED_AT,
  startedAt: STARTED_AT,
  finishedAt: null,
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * Каждый метод (`from`/`where`/`limit`/`values`/`set`) возвращает саму
 * цепочку, поэтому её можно дожидаться через `await`; значение, которое
 * получит `await`, задаётся через `resolveWith`. Терминальный `returning()`
 * возвращает массив строк, как настоящий Drizzle.
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

describe('RunsService', () => {
  let service: RunsService;
  let selectChain: ReturnType<typeof chain>;
  let insertChain: ReturnType<typeof chain>;
  let updateChain: ReturnType<typeof chain>;
  let db: Record<string, ReturnType<typeof vi.fn>>;
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    selectChain = chain([baseWorkflow]);
    insertChain = chain([baseRun]);
    updateChain = chain([{ id: RUN_ID }]);

    db = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    };

    queue = { add: vi.fn(() => Promise.resolve({ id: 'job-1' })) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunsService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
        {
          provide: getQueueToken(WORKFLOW_RUNS_QUEUE),
          useValue: queue as unknown as Queue,
        },
      ],
    }).compile();

    service = moduleRef.get(RunsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createRunAsync', () => {
    it('бросает NotFoundException, если workflow не найден', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(service.createRunAsync({ workflowId: WORKFLOW_ID })).rejects.toThrow(
        NotFoundException,
      );

      expect(db.insert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('создаёт запуск в БД и ставит задание в очередь', async () => {
      const result = await service.createRunAsync({ workflowId: WORKFLOW_ID });

      expect(selectChain.from).toHaveBeenCalledWith(workflows);
      expect(db.insert).toHaveBeenCalledWith(workflowRuns);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: WORKFLOW_ID,
          status: 'pending',
          inputs: {},
        }),
      );
      expect(insertChain.returning).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(EXECUTE_RUN_JOB, { runId: RUN_ID });
      expect(result).toEqual({
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'pending',
        createdAt: CREATED_AT,
      });
    });

    it('сохраняет в snapshot копию графа workflow', async () => {
      await service.createRunAsync({ workflowId: WORKFLOW_ID });

      const values = insertChain.values.mock.calls[0][0] as { snapshot: unknown };

      expect(values.snapshot).toEqual({
        nodes: baseWorkflow.nodes,
        edges: baseWorkflow.edges,
      });
    });

    it('помечает запуск failed и бросает 500, если очередь недоступна', async () => {
      queue.add.mockRejectedValue(new Error('Redis недоступен'));

      await expect(service.createRunAsync({ workflowId: WORKFLOW_ID })).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(db.update).toHaveBeenCalledWith(workflowRuns);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', error: 'Redis недоступен' }),
      );
      expect(updateChain.where).toHaveBeenCalled();
    });
  });

  describe('getRunAsync', () => {
    it('возвращает запуск в публичном представлении', async () => {
      selectChain.limit.mockImplementation(() => [baseRun]);

      const result = await service.getRunAsync(RUN_ID);

      expect(selectChain.from).toHaveBeenCalledWith(workflowRuns);
      expect(selectChain.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'pending',
        createdAt: CREATED_AT,
      });
    });

    it('берёт createdAt из created_at, а не из started_at (KI-015)', async () => {
      selectChain.limit.mockImplementation(() => [baseRun]);

      const result = await service.getRunAsync(RUN_ID);

      expect(result.createdAt).toBe(CREATED_AT);
      expect(result.createdAt).not.toEqual(STARTED_AT);
    });

    it('бросает NotFoundException, если запуск не найден', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(service.getRunAsync(RUN_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
