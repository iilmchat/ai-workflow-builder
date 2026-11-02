import { getQueueToken } from '@nestjs/bullmq';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  nodeRuns,
  workflowRuns,
  workflows,
  type Workflow,
  type WorkflowRun,
} from '../db/schema.js';
import { EXECUTE_RUN_JOB, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { NodeRunSnapshotMapper } from './node-run-snapshot.mapper.js';
import type { NodeRunSnapshot } from './dto/index.js';
import { encodeRunHistoryCursor } from './dto/index.js';
import { RunsService } from './runs.service.js';
import { RUNS_INSTANCE_ID } from './runs.worker-options.js';
import {
  accessibleWorkflowIdsSubquery,
  workflowAccessFilter,
  type WorkflowAccess,
} from '../workflow/workflow-access.js';

/**
 * Оборачивает функции доступа spy-моками с pass-through поведением.
 *
 * Нужно, чтобы тесты `listRunsAsync`/`createRunAsync`/`getRunRowAsync`
 * пиннили **аргументы** предикатов доступа: мок Drizzle SQL не исполняет,
 * поэтому без проверки аргументов регрессия «роль `editor` → `viewer`» или
 * «организация потерялась по пути» осталась бы зелёной. Реализация не
 * подменяется — существующие тесты работают как раньше.
 */
vi.mock('../workflow/workflow-access.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../workflow/workflow-access.js')>();

  return {
    ...actual,
    workflowAccessFilter: vi.fn(actual.workflowAccessFilter),
    accessibleWorkflowIdsSubquery: vi.fn(actual.accessibleWorkflowIdsSubquery),
  };
});

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID_2 = '33333333-3333-4333-8333-333333333333';
/** Пользователь, от имени которого проверяется доступ к истории. */
const USER_ID = '44444444-4444-4444-8444-444444444444';
/** Организация-арендатор пользователя (v1.0.0 S2). */
const ORG_ID = '55555555-5555-4555-8555-555555555555';
/** Организация, к которой тестовый пользователь не принадлежит (S2). */
const OTHER_ORG_ID = '66666666-6666-4666-8666-666666666666';
/** Контекст доступа: пользователь + его организация (v1.0.0 S2). */
const ACCESS: WorkflowAccess = { userId: USER_ID, orgId: ORG_ID };
const STARTED_AT = new Date('2024-01-01T00:00:00.000Z');
/** KI-015: дата создания намеренно отличается от даты старта. */
const CREATED_AT = new Date('2023-12-31T23:00:00.000Z');

const baseWorkflow: Workflow = {
  id: WORKFLOW_ID,
  userId: 'user-1',
  // v1.0 S1: организация-арендатор обязательна в схеме.
  organizationId: ORG_ID,
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

  for (const method of ['from', 'where', 'limit', 'values', 'set', 'orderBy', 'offset', 'groupBy']) {
    link[method] = vi.fn(() => proxy);
  }

  link.returning = vi.fn(() => resolveWith);

  return proxy;
}

/**
 * Ищет bind-параметр `expected` во вложенных чанках SQL-условия Drizzle.
 *
 * Мок Drizzle не исполняет и не рендерит SQL в текст, поэтому проверяются
 * внутренние чанки `SQL`: `eq(column, value)` кладёт значение в
 * `Param.value`. Так тест доказывает, что `organization_id = access.orgId`
 * действительно попал в WHERE, а не остался только аргументом фильтра.
 *
 * @param sql - SQL-условие (или любой вложенный чанк)
 * @param expected - значение, которое обязано быть в SQL
 * @param depth - текущая глубина рекурсии (защита от циклов)
 * @returns `true`, если значение найдено среди параметров условия
 */
function sqlContainsValue(sql: unknown, expected: unknown, depth = 0): boolean {
  if (depth > 20 || sql === null || typeof sql !== 'object') {
    return false;
  }

  const node = sql as { value?: unknown; queryChunks?: unknown[] };

  if ('value' in node && node.value === expected) {
    return true;
  }

  return (
    Array.isArray(node.queryChunks) &&
    node.queryChunks.some((chunk) => sqlContainsValue(chunk, expected, depth + 1))
  );
}

/**
 * Собирает SQL-условия, переданные в `where` тестовой цепочки Drizzle.
 *
 * @param target - цепочка-заглушка Drizzle
 * @returns аргументы всех вызовов `where`
 */
function whereConditions(
  target: Record<string, ReturnType<typeof vi.fn>>,
): unknown[] {
  return target.where.mock.calls.map((call) => call[0] as unknown);
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
        ACCESS,
      );

      expect(result.workflowId).toBe(WORKFLOW_ID);
      expect(queue.add).toHaveBeenCalled();
    });

    it('v1.0.0 S2: проверка доступа получает организацию из access', async () => {
      selectChain.limit.mockImplementation(() => [baseWorkflow]);

      await service.createRunAsync({ workflowId: WORKFLOW_ID }, ACCESS);

      // Роль editor — R7.6; access обязан нести orgId, иначе фильтр перестал
      // бы отсекать workflow другой организации.
      expect(vi.mocked(workflowAccessFilter)).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        ACCESS,
        'editor',
      );
    });

    it('v1.0.0 S2: SQL проверки доступа содержит organization_id арендатора', async () => {
      selectChain.limit.mockImplementation(() => [baseWorkflow]);

      await service.createRunAsync({ workflowId: WORKFLOW_ID }, ACCESS);

      // Помимо аргумента фильтра проверяем сам WHERE: организация обязана
      // попасть в SQL-параметр (иначе «изоляция» была бы только в подписи).
      const conditions = whereConditions(selectChain);

      expect(
        conditions.some((condition) => sqlContainsValue(condition, ORG_ID)),
      ).toBe(true);
    });

    it('viewer не запускает workflow: фильтр editor не находит строку (R7.6)', async () => {
      // SQL-условие роли проверяет workflow-access.spec.ts; здесь — поведение
      // сервиса, когда фильтр не вернул ни одной строки.
      selectChain.limit.mockImplementation(() => []);

      await expect(
        service.createRunAsync({ workflowId: WORKFLOW_ID }, ACCESS),
      ).rejects.toThrow(NotFoundException);

      expect(db.insert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('v1.0.0 S2: workflow другой организации — 404 (фильтр вернул пусто)', async () => {
      selectChain.limit.mockImplementation(() => []);

      const foreignAccess: WorkflowAccess = {
        userId: USER_ID,
        orgId: OTHER_ORG_ID,
      };

      await expect(
        service.createRunAsync({ workflowId: WORKFLOW_ID }, foreignAccess),
      ).rejects.toThrow(NotFoundException);

      expect(db.insert).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(vi.mocked(workflowAccessFilter)).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        foreignAccess,
        'editor',
      );
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

      await expect(service.getRunAsync(RUN_ID, ACCESS)).rejects.toThrow(
        NotFoundException,
      );

      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
    });

    it('v1.0.0 S2: доступ к запуску ищется среди workflow организации', async () => {
      stubRun();

      await service.getRunAsync(RUN_ID, ACCESS);

      // Подзапрос «доступные workflow» получает orgId: запуск workflow другой
      // организации в него не попадёт → 404, а не данные чужого арендатора.
      expect(vi.mocked(accessibleWorkflowIdsSubquery)).toHaveBeenCalledWith(
        expect.anything(),
        ACCESS,
      );
      // И organization_id действительно оказался в SQL-условии подзапроса.
      const conditions = whereConditions(selectChain);

      expect(
        conditions.some((condition) => sqlContainsValue(condition, ORG_ID)),
      ).toBe(true);
    });

    it('v1.0.0 S2: запуск другой организации — 404 (mock: пустая выборка)', async () => {
      selectChain.limit.mockImplementation(() => []);

      const foreignAccess: WorkflowAccess = {
        userId: USER_ID,
        orgId: OTHER_ORG_ID,
      };

      await expect(service.getRunAsync(RUN_ID, foreignAccess)).rejects.toThrow(
        NotFoundException,
      );

      expect(vi.mocked(accessibleWorkflowIdsSubquery)).toHaveBeenCalledWith(
        expect.anything(),
        foreignAccess,
      );
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

    it('проверяет доступ и передаёт access в getRunRowAsync', async () => {
      selectChain.limit.mockImplementation(() => [baseRun]);

      await service.listNodeRunsAsync(RUN_ID, ACCESS);

      // Для чужого запуска фильтр вернул бы пустую строку — 404 (KI-202).
      expect(selectChain.where).toHaveBeenCalled();
      expect(vi.mocked(accessibleWorkflowIdsSubquery)).toHaveBeenCalledWith(
        expect.anything(),
        ACCESS,
      );
      expect(snapshotMapper.listAsync).toHaveBeenCalledWith(
        RUN_ID,
        baseRun.snapshot,
      );
    });

    it('чужой/несуществующий запуск отдаёт 404 и не читает node_runs', async () => {
      selectChain.limit.mockImplementation(() => []);

      await expect(
        service.listNodeRunsAsync(RUN_ID, ACCESS),
      ).rejects.toThrow(NotFoundException);

      // Доступ проверен до чтения узлов: маппер не вызывался.
      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
    });
  });

  // v0.14 S1 (DESIGN V014 § 3.1): история запусков workflow с пагинацией.
  describe('listRunsAsync', () => {
    /** Цепочки очередных SELECT'ов: доступ → count → страница → суммы. */
    let chains: ReturnType<typeof chain>[];

    /**
     * Настраивает `db.select` на последовательность ответов.
     *
     * `listRunsAsync` делает до четырёх SELECT'ов подряд (проверка доступа,
     * `count(*)`, страница запусков, суммы `node_runs`); каждый получает свой
     * элемент `batches`. Недостающие ответы — пустые массивы.
     *
     * @param batches - результаты последовательных SELECT'ов
     */
    function stubSelects(...batches: unknown[][]): void {
      // `workflowAccessFilter` собирает `EXISTS`-подзапрос участника через
      // `db.select()`. Это второй вызов builder'а внутри `where` — он не
      // ожидается через `await`, но в моке тоже занимает ответ. Вставляем
      // пустую заглушку сразу после батча проверки доступа.
      const sequenced = [batches[0] ?? [], [], ...batches.slice(1)];

      chains = [];
      db.select.mockImplementation(() => {
        const next = chain(sequenced.shift() ?? []);
        chains.push(next);

        return next;
      });
    }

    beforeEach(() => {
      chains = [];
    });

    it('возвращает страницу с total, длительностью и суммами node_runs', async () => {
      const finishedAt = new Date(STARTED_AT.getTime() + 1500);
      stubSelects(
        // 1. Проверка доступа: workflow найден (владелец/editor).
        [{ id: WORKFLOW_ID }],
        // 2. count(*) по всей истории — total не зависит от страницы.
        [{ total: 2 }],
        // 3. Страница запусков (сначала новые).
        [
          {
            id: RUN_ID,
            status: 'completed',
            createdAt: CREATED_AT,
            startedAt: STARTED_AT,
            finishedAt,
          },
          {
            id: RUN_ID_2,
            status: 'running',
            createdAt: STARTED_AT,
            startedAt: STARTED_AT,
            finishedAt: null,
          },
        ],
        // 4. Суммы node_runs только для запусков страницы.
        [
          { runId: RUN_ID, costUsd: '0.123456', costRub: '0' },
          { runId: RUN_ID_2, costUsd: null, costRub: '42.5' },
        ],
      );

      const result = await service.listRunsAsync(WORKFLOW_ID, ACCESS, 20);

      expect(result.total).toBe(2);
      expect(result.nextCursor).toBeNull();
      expect(result.runs).toEqual([
        {
          id: RUN_ID,
          cursor: encodeRunHistoryCursor({
            createdAt: CREATED_AT.toISOString(),
            id: RUN_ID,
          }),
          status: 'completed',
          createdAt: CREATED_AT,
          startedAt: STARTED_AT,
          finishedAt,
          durationMs: 1500,
          costUsd: 0.123456,
          costRub: 0,
        },
        {
          id: RUN_ID_2,
          cursor: encodeRunHistoryCursor({
            createdAt: STARTED_AT.toISOString(),
            id: RUN_ID_2,
          }),
          status: 'running',
          createdAt: STARTED_AT,
          startedAt: STARTED_AT,
          finishedAt: null,
          durationMs: null,
          costUsd: 0,
          costRub: 42.5,
        },
      ]);
      expect(db.select).toHaveBeenCalledTimes(5);
      // 1. Доступ проверяется по `workflows` до чтения истории (KI-202).
      expect(chains[0].from).toHaveBeenCalledWith(workflows);
      expect(chains[0].limit).toHaveBeenCalledWith(1);
      // R7.6: фильтр доступа обязан требовать именно роль `editor`
      // (viewer/чужой → пустая выборка). SQL в моке не исполняется, поэтому
      // роль пиннится по аргументу вызова: регрессия `editor` → `viewer` иначе
      // осталась бы зелёной, а проверка прав жила бы только в gitignored smoke.
      // v1.0.0 S2: access несёт orgId — фильтр ограничивает выборку арендатором.
      expect(vi.mocked(workflowAccessFilter)).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        ACCESS,
        'editor',
      );

      // ...и organization_id реально попал в SQL проверки доступа.
      expect(
        whereConditions(chains[0]).some((condition) =>
          sqlContainsValue(condition, ORG_ID),
        ),
      ).toBe(true);
      // 2. total — отдельный count(*) по workflow_runs (chains[1] — EXISTS-
      //    подзапрос участника внутри фильтра доступа).
      expect(chains[2].from).toHaveBeenCalledWith(workflowRuns);
      // 3. Страница с keyset-фильтром и стабильной сортировкой.
      expect(chains[3].from).toHaveBeenCalledWith(workflowRuns);
      expect(chains[3].orderBy).toHaveBeenCalled();
      // +1 строка — сервер определяет «есть ли ещё» без опоры на total.
      expect(chains[3].limit).toHaveBeenCalledWith(21);
      // v0.16 S1 (KI-542): offset больше не используется — только курсор.
      expect(chains[3].offset).not.toHaveBeenCalled();
      // 4. Суммы — по node_runs и только для id страницы.
      expect(chains[4].from).toHaveBeenCalledWith(nodeRuns);
      expect(chains[4].where).toHaveBeenCalled();
      expect(chains[4].groupBy).toHaveBeenCalled();
    });

    it('ровно limit строк — nextCursor=null (страница последняя)', async () => {
      stubSelects(
        [{ id: WORKFLOW_ID }],
        [{ total: 2 }],
        [
          {
            id: RUN_ID,
            status: 'completed',
            createdAt: CREATED_AT,
            startedAt: STARTED_AT,
            finishedAt: STARTED_AT,
          },
          {
            id: RUN_ID_2,
            status: 'completed',
            createdAt: STARTED_AT,
            startedAt: STARTED_AT,
            finishedAt: STARTED_AT,
          },
        ],
        [],
      );

      const result = await service.listRunsAsync(WORKFLOW_ID, ACCESS, 2);

      expect(result.runs).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      // Запрос всё равно берёт limit + 1, чтобы отличить «ровно limit» от
      // «есть ещё»: сервер получает 2 строки вместо 3 и видит, что больше нет.
      expect(chains[3].limit).toHaveBeenCalledWith(3);
    });

    it('возвращает nextCursor, когда строк больше limit (выборка limit + 1)', async () => {
      stubSelects(
        [{ id: WORKFLOW_ID }],
        [{ total: 3 }],
        [
          {
            id: RUN_ID,
            status: 'completed',
            createdAt: CREATED_AT,
            // Микросекунды PostgreSQL: JS Date их теряет, курсор — нет.
            cursorCreatedAt: '2023-12-31T23:00:00.000123Z',
            startedAt: STARTED_AT,
            finishedAt: STARTED_AT,
          },
          {
            id: RUN_ID_2,
            status: 'completed',
            createdAt: STARTED_AT,
            cursorCreatedAt: '2024-01-01T00:00:00.000456Z',
            startedAt: STARTED_AT,
            finishedAt: STARTED_AT,
          },
          {
            // «Лишняя» строка: доказывает, что есть следующая страница.
            id: '44444444-4444-4444-8444-444444444444',
            status: 'completed',
            createdAt: new Date('2023-12-31T22:00:00.000Z'),
            cursorCreatedAt: '2023-12-31T22:00:00.000789Z',
            startedAt: STARTED_AT,
            finishedAt: STARTED_AT,
          },
        ],
        [],
      );

      const result = await service.listRunsAsync(WORKFLOW_ID, ACCESS, 2);

      expect(result.runs).toHaveLength(2);
      // Курсор сохраняет µs-точность (иначе tie-break по id мог бы пропускать
      // запуски одной миллисекунды — замечание verifier'а).
      expect(result.runs[1]?.cursor).toBe(
        encodeRunHistoryCursor({
          createdAt: '2024-01-01T00:00:00.000456Z',
          id: RUN_ID_2,
        }),
      );
      expect(result.nextCursor).toBe(
        encodeRunHistoryCursor({
          createdAt: '2024-01-01T00:00:00.000456Z',
          id: RUN_ID_2,
        }),
      );
      expect(chains[3].limit).toHaveBeenCalledWith(3);
    });

    it('чужой или недоступный workflow отдаёт 404 и не читает историю', async () => {
      // workspace-filter вернул пусто → workflow не найден/чужой/только viewer.
      stubSelects([]);

      await expect(
        service.listRunsAsync(WORKFLOW_ID, ACCESS, 20),
      ).rejects.toThrow(NotFoundException);

      // Только сборка условия доступа: главный SELECT + EXISTS-подзапрос.
      // Историю не читаем: count/страница/node_runs не запрашивались.
      expect(db.select).toHaveBeenCalledTimes(2);
      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
    });

    it('v1.0.0 S2: workflow другой организации — 404 и история не читается', async () => {
      // Фильтр организации вернул пусто — workflow чужого арендатора невидим.
      stubSelects([]);
      const foreignAccess: WorkflowAccess = {
        userId: USER_ID,
        orgId: OTHER_ORG_ID,
      };

      await expect(
        service.listRunsAsync(WORKFLOW_ID, foreignAccess, 20),
      ).rejects.toThrow(NotFoundException);

      // Организация доехала до фильтра доступа: регрессия «access без orgId»
      // снова открыла бы чужую историю.
      expect(vi.mocked(workflowAccessFilter)).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        foreignAccess,
        'editor',
      );
      expect(db.select).toHaveBeenCalledTimes(2);
      expect(snapshotMapper.listAsync).not.toHaveBeenCalled();
    });

    it('пустая страница отдаёт total и не запрашивает суммы node_runs', async () => {
      stubSelects([{ id: WORKFLOW_ID }], [{ total: 7 }], []);

      const result = await service.listRunsAsync(
        WORKFLOW_ID,
        ACCESS,
        20,
        { createdAt: STARTED_AT.toISOString(), id: RUN_ID_2 },
      );

      expect(result).toEqual({ runs: [], nextCursor: null, total: 7 });
      // Четыре вызова builder'а: доступ, EXISTS-подзапрос, count, страница.
      // Агрегат `node_runs` на пустой странице не нужен.
      expect(db.select).toHaveBeenCalledTimes(4);
      expect(chains[3].where).toHaveBeenCalled();
      expect(chains[3].offset).not.toHaveBeenCalled();
    });

    it('невалидная дата курсора — 400, а не молчаливый пустой результат (KI-542)', async () => {
      stubSelects([{ id: WORKFLOW_ID }], [{ total: 2 }], []);

      await expect(
        service.listRunsAsync(WORKFLOW_ID, ACCESS, 20, {
          createdAt: '2026-13-40T00:00:00.000000Z',
          id: RUN_ID,
        }),
      ).rejects.toThrow('некорректный cursor истории запусков');

      // Страница не читалась: курсор проверен до count/запроса строк.
      // Два вызова — главный SELECT доступа и EXISTS-подзапрос участника.
      expect(db.select).toHaveBeenCalledTimes(2);
    });

    it('без строк node_runs стоимости равны нулю (а не null)', async () => {
      stubSelects(
        [{ id: WORKFLOW_ID }],
        [{ total: 1 }],
        [
          {
            id: RUN_ID,
            status: 'pending',
            createdAt: CREATED_AT,
            startedAt: STARTED_AT,
            finishedAt: null,
          },
        ],
        [],
      );

      const result = await service.listRunsAsync(WORKFLOW_ID, ACCESS, 20);

      expect(result.runs[0]).toMatchObject({
        costUsd: 0,
        costRub: 0,
        durationMs: null,
      });
    });

    it('защищает запрос: limit ограничен сверху (KI-542)', async () => {
      stubSelects(
        [{ id: WORKFLOW_ID }],
        [{ total: 1 }],
        [
          {
            id: RUN_ID,
            status: 'pending',
            createdAt: CREATED_AT,
            startedAt: null,
            finishedAt: null,
          },
        ],
        [],
      );

      // Контроллер валидирует значения Zod'ом, но сервис — вторая граница:
      // огромный limit вытянул бы всю историю.
      await service.listRunsAsync(WORKFLOW_ID, ACCESS, 10_000);

      expect(chains[3].limit).toHaveBeenCalledWith(101);
    });

    it('длительность не отрицательна при рассинхроне часов (v0.14 S1)', async () => {
      const startedAt = new Date('2024-01-01T00:00:10.000Z');
      const finishedAt = new Date('2024-01-01T00:00:05.000Z');
      stubSelects(
        [{ id: WORKFLOW_ID }],
        [{ total: 1 }],
        [
          {
            id: RUN_ID,
            status: 'failed',
            createdAt: CREATED_AT,
            startedAt,
            finishedAt,
          },
        ],
        [],
      );

      const result = await service.listRunsAsync(WORKFLOW_ID, ACCESS, 20);

      expect(result.runs[0].durationMs).toBe(0);
    });
  });
});
