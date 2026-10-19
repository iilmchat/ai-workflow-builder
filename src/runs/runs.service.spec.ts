import { getQueueToken } from '@nestjs/bullmq';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  workflowRuns,
  workflows,
  type NodeRun,
  type Workflow,
  type WorkflowRun,
} from '../db/schema.js';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from '../media/media-storage.service.js';
import { EXECUTE_RUN_JOB, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
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
 * Строка `node_runs` для KI-450: `GET /runs/:id` отдаёт узлы проекцией
 * SSE-снимка. Поля совпадают со схемой `NodeRun`, включая nullable-колонки.
 */
const baseNodeRun: NodeRun = {
  id: '33333333-3333-4333-8333-333333333333',
  runId: RUN_ID,
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
  cacheReadTokens: null,
  cacheCreationTokens: null,
  storedUrl: null,
  storedExpiresAt: null,
  storageKey: null,
  durationMs: 5,
  startedAt: STARTED_AT,
  finishedAt: STARTED_AT,
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
  let mediaStorage: {
    backend: 'local';
    uploadAsync: ReturnType<typeof vi.fn>;
    saveGeneratedAsync: ReturnType<typeof vi.fn>;
    openAsync: ReturnType<typeof vi.fn>;
    refreshStoredUrlAsync: ReturnType<typeof vi.fn>;
    refreshStoredUrlByKeyAsync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    selectChain = chain([baseWorkflow]);
    insertChain = chain([baseRun]);
    updateChain = chain([{ id: RUN_ID }]);
    mediaStorage = {
      backend: 'local',
      // RunsService читает только переподпись ссылок; остальные методы
      // IMediaStorage существуют, чтобы мок соответствовал интерфейсу.
      uploadAsync: vi.fn(() => Promise.resolve(null)),
      saveGeneratedAsync: vi.fn(() =>
        Promise.resolve({ url: null, key: null }),
      ),
      openAsync: vi.fn(() => Promise.resolve(null)),
      refreshStoredUrlAsync: vi.fn(() => Promise.resolve(null)),
      refreshStoredUrlByKeyAsync: vi.fn(() => Promise.resolve(null)),
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
        // KI-450: проекция узлов переподписывает media-ссылки (KI-443/464).
        { provide: MEDIA_STORAGE, useValue: mediaStorage as IMediaStorage },
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
        // KI-450: у только что созданного запуска узлов ещё нет.
        nodes: [],
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
     * Настраивает двойник БД на два SELECT: `workflow_runs`, затем `node_runs`
     * (KI-450 — публичный ответ читает узлы).
     *
     * @param nodeRows - строки `node_runs`, которые вернёт второй запрос
     */
    function stubRunAndNodes(nodeRows: NodeRun[] = []): void {
      selectChain.limit.mockImplementation(() => [baseRun]);
      const rowsChain = chain(nodeRows);

      db.select
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce(rowsChain);
    }

    it('возвращает запуск в публичном представлении', async () => {
      stubRunAndNodes();

      const result = await service.getRunAsync(RUN_ID);

      expect(selectChain.from).toHaveBeenCalledWith(workflowRuns);
      expect(selectChain.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'pending',
        createdAt: CREATED_AT,
        nodes: [],
      });
    });

    it('KI-450: отдаёт node_runs в поле nodes (проекция SSE-снимка)', async () => {
      stubRunAndNodes([baseNodeRun]);

      const result = await service.getRunAsync(RUN_ID);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toMatchObject({
        nodeId: 'n1',
        nodeType: 'text',
        status: 'completed',
        // `outputs` — как в SSE-снимке: null-safe объект.
        outputs: { text: 'привет' },
        startedAt: STARTED_AT.toISOString(),
      });
    });

    it('берёт createdAt из created_at, а не из started_at (KI-015)', async () => {
      stubRunAndNodes();

      const result = await service.getRunAsync(RUN_ID);

      expect(result.createdAt).toBe(CREATED_AT);
      expect(result.createdAt).not.toEqual(STARTED_AT);
    });

    it('бросает NotFoundException, если запуск не найден', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(service.getRunAsync(RUN_ID)).rejects.toThrow(NotFoundException);
    });

    it('KI-450: чужой запуск отдаёт 404 и не читает node_runs', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(
        service.getRunAsync(RUN_ID, '44444444-4444-4444-8444-444444444444'),
      ).rejects.toThrow(NotFoundException);
      // `SELECT node_runs` (единственный запрос с `orderBy`) не выполнялся:
      // доступ проверен до чтения узлов.
      expect(selectChain.orderBy).not.toHaveBeenCalled();
    });
  });
});
