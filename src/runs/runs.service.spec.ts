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
import { NodeRunSnapshotMapper } from './node-run-snapshot.mapper.js';
import type { NodeRunSnapshot } from './dto/index.js';
import { RunsService } from './runs.service.js';
import { RUNS_INSTANCE_ID } from './runs.worker-options.js';

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
  // v0.11 S1 (KI-066): nullable-колонка аренды; в старых строках — null.
  leaseExpiresAt: null,
};

/**
 * Снимок узла, который отдаёт `NodeRunSnapshotMapper.listAsync`
 * (v0.11 S12, KI-077). Сами `node_runs` сервис не читает — это делает маппер.
 */
const nodeSnapshot: NodeRunSnapshot = {
  nodeId: 'n1',
  nodeType: 'text',
  status: 'completed',
  inputs: {},
  outputs: { text: 'привет' },
  error: null,
  logs: null,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  costRub: null,
  durationMs: 5,
  startedAt: STARTED_AT.toISOString(),
  finishedAt: STARTED_AT.toISOString(),
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

  for (const method of ['from', 'where', 'limit', 'values', 'set', 'orderBy']) {
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
  let snapshotMapper: { listAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    selectChain = chain([baseWorkflow]);
    insertChain = chain([baseRun]);
    updateChain = chain([{ id: RUN_ID }]);
    snapshotMapper = {
      // Сервис не читает `node_runs` сам: проекция и подпись ссылок живут
      // в маппере (DESIGN § 3.4.2), поэтому в спеке достаточно заглушки.
      listAsync: vi.fn(() => Promise.resolve([nodeSnapshot])),
    };

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
        // v0.11 S12 (DESIGN § 3.4.2): `GET /runs/:id/nodes` строит ответ
        // общим маппером с SSE-снимком.
        { provide: NodeRunSnapshotMapper, useValue: snapshotMapper },
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
      // KI-387: в payload едет маркер инстанса, чтобы чужой воркер пропустил
      // задание на общем Redis.
      expect(queue.add).toHaveBeenCalledWith(EXECUTE_RUN_JOB, {
        runId: RUN_ID,
        instanceId: RUNS_INSTANCE_ID,
      });
      expect(result).toEqual({
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'pending',
        createdAt: CREATED_AT,
        // v0.11 S12: у запуска нет ошибки — поле присутствует и равно null.
        error: null,
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

    it('editor запускает чужой workflow (R7.6)', async () => {
      // Фильтр доступа нашёл workflow: владелец или участник с ролью editor.
      selectChain.limit.mockImplementation(() => [baseWorkflow]);

      const result = await service.createRunAsync(
        { workflowId: WORKFLOW_ID },
        '33333333-3333-4333-8333-333333333333',
      );

      expect(result.workflowId).toBe(WORKFLOW_ID);
      expect(queue.add).toHaveBeenCalled();
    });

    it('viewer не запускает workflow: фильтр editor не находит строку (R7.6)', async () => {
      // SQL-условие роли проверяет workflow-access.spec.ts; здесь — поведение
      // сервиса, когда фильтр не вернул ни одной строки.
      selectChain.limit.mockImplementation(() => []);

      await expect(
        service.createRunAsync(
          { workflowId: WORKFLOW_ID },
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(db.insert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('getRunAsync', () => {
    /**
     * Настраивает двойник БД на SELECT строки `workflow_runs`.
     *
     * @param run - строка, которую вернёт запрос
     */
    function stubRun(run: WorkflowRun = baseRun): void {
      selectChain.limit.mockImplementation(() => [run]);
    }

    it('возвращает запуск в публичном представлении — без узлов', async () => {
      stubRun();

      const result = await service.getRunAsync(RUN_ID);

      expect(selectChain.from).toHaveBeenCalledWith(workflowRuns);
      expect(selectChain.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'pending',
        createdAt: CREATED_AT,
        error: null,
      });
      // v0.11 S12: история узлов — отдельная ручка `GET /runs/:id/nodes`,
      // `GET /runs/:id` остаётся дешёвым и в `node_runs` не ходит.
      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
      expect(selectChain.orderBy).not.toHaveBeenCalled();
    });

    it('v0.11 S12: отдаёт error запуска (KI-347)', async () => {
      stubRun({
        ...baseRun,
        status: 'failed',
        error: 'Узел B упал: HTTP 404',
      });

      const result = await service.getRunAsync(RUN_ID);

      // Без поля восстановленный после F5 failed-запуск не показывал причину:
      // SSE-снимок её отдаёт, REST — теперь тоже (DESIGN § 3.4.2).
      expect(result.error).toBe('Узел B упал: HTTP 404');
      expect(result.status).toBe('failed');
    });

    it('берёт createdAt из created_at, а не из started_at (KI-015)', async () => {
      stubRun();

      const result = await service.getRunAsync(RUN_ID);

      expect(result.createdAt).toBe(CREATED_AT);
      expect(result.createdAt).not.toEqual(STARTED_AT);
    });

    it('бросает NotFoundException, если запуск не найден', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(service.getRunAsync(RUN_ID)).rejects.toThrow(NotFoundException);
    });

    it('чужой запуск отдаёт 404 и не читает узлы (KI-202)', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(
        service.getRunAsync(RUN_ID, '44444444-4444-4444-8444-444444444444'),
      ).rejects.toThrow(NotFoundException);

      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
    });
  });

  // v0.11 S12 (DESIGN § 3.4.2, KI-077): история узлов для восстановления после F5.
  describe('listNodeRunsAsync', () => {
    it('возвращает снимки узлов общим маппером (тот же, что у SSE)', async () => {
      selectChain.limit.mockImplementation(() => [baseRun]);

      const result = await service.listNodeRunsAsync(RUN_ID);

      expect(snapshotMapper.listAsync).toHaveBeenCalledWith(
        RUN_ID,
        baseRun.snapshot,
      );
      expect(result).toEqual([nodeSnapshot]);
    });

    it('проверяет доступ и передаёт владельца в getRunRowAsync', async () => {
      selectChain.limit.mockImplementation(() => [baseRun]);

      await service.listNodeRunsAsync(
        RUN_ID,
        '44444444-4444-4444-8444-444444444444',
      );

      // Для чужого запуска фильтр вернул бы пустую строку — 404 (KI-202).
      expect(selectChain.where).toHaveBeenCalled();
      expect(snapshotMapper.listAsync).toHaveBeenCalledWith(
        RUN_ID,
        baseRun.snapshot,
      );
    });

    it('чужой/несуществующий запуск отдаёт 404 и не читает node_runs', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(
        service.listNodeRunsAsync(RUN_ID, '44444444-4444-4444-8444-444444444444'),
      ).rejects.toThrow(NotFoundException);

      // Доступ проверен до чтения узлов: маппер не вызывался.
      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
    });
  });
});
