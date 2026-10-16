import { Test } from '@nestjs/testing';
import { Param } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns, type RunStatus } from '../db/schema.js';
import type { RunEventDto } from '../runs/dto/index.js';
import { RunEventsService } from '../runs/run-events.service.js';
import type { EdgeDto, GraphDto, NodeDto } from './dto/index.js';
import { EngineService } from './engine.service.js';
import { ExecutionEngineService } from './execution-engine.service.js';
import { LlmNodeExecutor } from '../llm/llm-node-executor.service.js';
import { MediaNodeExecutor } from '../media/media-node-executor.service.js';
import { LlmProviderException } from '../llm/llm-provider.interface.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { UnsupportedNodeTypeException, type SubWorkflowRecord } from './node-executors.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** Владелец запуска (R6.7): его отдаёт join-запрос в двойнике БД. */
const RUN_OWNER_ID = '44444444-4444-4444-8444-444444444444';

/** uuid подграфа в тестах R6.7. */
const SUB_WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

/** Строка `workflow_runs` в тестовом двойнике БД. */
interface FakeRun {
  id: string;
  status: RunStatus;
  outputs: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** Результат выполнения узла в моке исполнителя (выходы и метрики, KI-038). */
interface FakeNodeStep {
  outputs: Record<string, unknown>;
  metrics: {
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    model: string;
  } | null;
}

/** Строка `node_runs` в тестовом двойнике БД. */
interface FakeNodeRun {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown> | null;
  error: string | null;
  logs: string[] | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: string | null;
  costRub: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** Создаёт узел графа с минимально необходимыми полями. */
function node(id: string, type: string, data: Record<string, unknown> = {}): NodeDto {
  return { id, type, data };
}

/** Создаёт связь графа. */
function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string,
): EdgeDto {
  return { id, source, target, sourceHandle, targetHandle };
}

/**
 * Извлекает пары «имя колонки → значение» из условия Drizzle (`eq`/`and`).
 *
 * Тестовому двойнику БД нужно понимать, к какой строке относится UPDATE/SELECT,
 * поэтому условие разбирается по `queryChunks`: колонка и следующий за ней
 * `Param` образуют пару.
 *
 * @param condition - условие Drizzle, переданное в `where`
 * @returns карта «имя колонки → значение параметра»
 */
function wherePairs(condition: unknown): Map<string, unknown> {
  const pairs = new Map<string, unknown>();
  let lastColumn: string | null = null;

  const walk = (chunk: unknown): void => {
    if (Array.isArray(chunk)) {
      chunk.forEach(walk);

      return;
    }

    if (chunk instanceof Param) {
      if (lastColumn !== null) {
        pairs.set(lastColumn, chunk.value);
        lastColumn = null;
      }

      return;
    }

    if (!chunk || typeof chunk !== 'object') {
      return;
    }

    const wrapper = chunk as { name?: unknown; table?: unknown; queryChunks?: unknown[] };

    if (typeof wrapper.name === 'string' && wrapper.table) {
      lastColumn = wrapper.name;

      return;
    }

    if (Array.isArray(wrapper.queryChunks)) {
      wrapper.queryChunks.forEach(walk);
    }
  };

  walk(condition);

  return pairs;
}

/**
 * Создаёт минимальный in-memory двойник Drizzle для нужд executor'а.
 *
 * Поддерживает ровно те вызовы, которые делает сервис: `transaction`,
 * `insert(...).values(...).returning()`, `update(...).set(...).where()`,
 * `select(...).from(...).where(...).limit()`. Строки `node_runs` хранятся
 * в массиве, поэтому проверяется реальный обмен данными между узлами
 * (`collectInputsAsync` читает outputs предшественника).
 *
 * @param runId - uuid запуска, для которого создаётся строка `workflow_runs`
 * @returns двойник БД, строка запуска и массив строк `node_runs`
 */
function createFakeDb(runId: string) {
  const run: FakeRun = {
    id: runId,
    status: 'pending',
    outputs: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
  const rows: FakeNodeRun[] = [];
  /** Payload'ы UPDATE workflow_runs — для проверки сброса полей (KI-040). */
  const runUpdates: Array<Record<string, unknown>> = [];
  /** Payload'ы UPSERT node_runs — для проверки сброса состояния (KI-047). */
  const upserts: Array<{ values: Record<string, unknown>; set?: Record<string, unknown> }> =
    [];
  let sequence = 0;

  const applySet = (target: object, values: Record<string, unknown>): void => {
    Object.assign(target, values);
  };

  const db = {
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
      callback(db),
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        /** Вставляет строку или (при конфликте) обновляет существующую — как ON CONFLICT DO UPDATE. */
        const upsert = async (set?: Record<string, unknown>): Promise<unknown[]> => {
          const existing = rows.find(
            (candidate) =>
              candidate.runId === values.runId && candidate.nodeId === values.nodeId,
          );

          upserts.push({ values, set });

          if (existing) {
            if (set) {
              Object.assign(existing, set);
            }

            return [{ id: existing.id }];
          }

          sequence += 1;

          const row = {
            id: `node-run-${sequence}`,
            error: null,
            outputs: null,
            durationMs: null,
            logs: null,
            tokensIn: null,
            tokensOut: null,
            costUsd: null,
            costRub: null,
            finishedAt: null,
            ...values,
          } as FakeNodeRun;

          rows.push(row);

          return [{ id: row.id }];
        };

        return {
          returning: (): Promise<unknown[]> => upsert(),
          onConflictDoUpdate: (config: { set?: Record<string, unknown> }) => ({
            returning: (): Promise<unknown[]> => upsert(config.set),
          }),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown): Promise<void> => {
          const id = wherePairs(condition).get('id');

          if (table === workflowRuns) {
            if (id === run.id) {
              runUpdates.push(values);
              applySet(run, values);
            }

            return;
          }

          const row = rows.find((candidate) => candidate.id === id);

          if (row) {
            applySet(row, values);
          }
        },
      }),
    }),
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (condition: unknown) => ({
          limit: async (): Promise<unknown[]> => {
            const pairs = wherePairs(condition);

            // Матчим только по тем колонкам, что есть в условии: executor
            // ищет строку либо по (run_id, node_id, status) для inputs, либо
            // по (run_id, node_id) для проверки переиспользования (KI-046).
            const row = rows.find((candidate) =>
              [...pairs.entries()].every(([column, value]) => {
                if (column === 'run_id') {
                  return candidate.runId === value;
                }

                if (column === 'node_id') {
                  return candidate.nodeId === value;
                }

                if (column === 'status') {
                  return candidate.status === value;
                }

                if (column === 'id') {
                  return candidate.id === value;
                }

                return false;
              }),
            );

            return row
              ? [
                  {
                    id: row.id,
                    status: row.status,
                    inputs: row.inputs,
                    outputs: row.outputs,
                  },
                ]
              : [];
          },
        }),
        // R6.7 (KI-200): `ExecutionEngineService` читает владельца корневого
        // workflow join-запросом (`workflow_runs` → `workflows`). Двойник
        // отвечает владельцем, если запуск существует.
        innerJoin: (_joined: unknown, _on: unknown) => ({
          where: (condition: unknown) => ({
            limit: async (): Promise<unknown[]> => {
              const id = wherePairs(condition).get('id');

              return id === run.id ? [{ userId: RUN_OWNER_ID }] : [];
            },
          }),
        }),
      }),
    }),
  };

  return { db: db as unknown as Database, run, rows, runUpdates, upserts };
}

describe('ExecutionEngineService', () => {
  let service: ExecutionEngineService;
  let engineService: EngineService;
  let publish: ReturnType<typeof vi.fn>;
  let llmExecute: ReturnType<typeof vi.fn>;
  let mediaExecute: ReturnType<typeof vi.fn>;
  let findWorkflow: ReturnType<typeof vi.fn>;
  let fake: ReturnType<typeof createFakeDb>;

  /** Типы опубликованных событий в порядке публикации. */
  const eventTypes = (): string[] => publish.mock.calls.map(([, event]) => event.type);

  /**
   * Последнее опубликованное событие заданного типа.
   *
   * @param type - тип события прогресса
   * @returns событие либо `undefined`, если такого события не было
   */
  const lastEventOfType = (type: RunEventDto['type']): RunEventDto | undefined =>
    publish.mock.calls
      .map(([, event]) => event)
      .filter((event) => event.type === type)
      .at(-1);

  /**
   * Подменяет приватный `runNodeAsync` (проверка падений узла).
   *
   * @param impl - реализация-заглушка для выполнения узла (выходы + метрики)
   */
  const spyRunNode = (
    impl: (node: NodeDto) => Promise<FakeNodeStep>,
  ): void => {
    const internals = service as unknown as {
      runNodeAsync: (
        node: NodeDto,
        inputs: Record<string, unknown>,
      ) => Promise<FakeNodeStep>;
    };

    vi.spyOn(internals, 'runNodeAsync').mockImplementation((current: NodeDto) =>
      impl(current),
    );
  };

  /**
   * Собирает результат LLM-узла для мока исполнителя (KI-038).
   *
   * @param text - текст ответа модели
   * @returns результат с выходом `{ text }` и метриками по умолчанию
   */
  const llmNodeResult = (text: string) => ({
    outputs: { text },
    metrics: {
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.0001,
      model: 'fake-model',
    },
  });

  /**
   * Собирает результат media-узла для мока исполнителя (v0.6.0b.2.2).
   *
   * @param url - URL сгенерированного файла
   * @returns результат с выходом `{ mediaUrl }` и метриками в рублях
   */
  const mediaNodeResult = (url: string) => ({
    outputs: { mediaUrl: url, mediaType: 'IMAGE', taskId: 'task-1' },
    metrics: { costRub: 0.6, mediaType: 'IMAGE', taskId: 'task-1' },
  });

  beforeEach(async () => {
    publish = vi.fn((_runId: string, _event: RunEventDto) => Promise.resolve());
    llmExecute = vi.fn((_node: NodeDto, _inputs: Record<string, unknown>) =>
      Promise.resolve(llmNodeResult('ответ модели')),
    );
    mediaExecute = vi.fn((_node: NodeDto, _inputs: Record<string, unknown>, _runId: string) =>
      Promise.resolve(mediaNodeResult('https://cdn/img.png')),
    );
    // R6.7: подграфы приходят из WorkflowService — в юнит-тесте он замокан.
    findWorkflow = vi.fn((_id: string, _userId?: string) =>
      Promise.resolve(null as SubWorkflowRecord | null),
    );
    fake = createFakeDb(RUN_ID);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionEngineService,
        EngineService,
        { provide: DRIZZLE, useValue: fake.db },
        { provide: RunEventsService, useValue: { publishAsync: publish } },
        // R3: llm-узел ходит в провайдера — в юнит-тесте он замокан.
        { provide: LlmNodeExecutor, useValue: { executeAsync: llmExecute } },
        // v0.6.0b.2.2: media-узел ходит в CreativeLab — тоже замокан.
        { provide: MediaNodeExecutor, useValue: { executeAsync: mediaExecute } },
        // R6.7 (KI-200): источник подграфов для узла sub_workflow.
        { provide: WorkflowService, useValue: { findOneAsync: findWorkflow } },
      ],
    }).compile();

    service = moduleRef.get(ExecutionEngineService);
    engineService = moduleRef.get(EngineService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('выполняет линейный граф A→B→C и публикует полную цепочку событий', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: 'привет' }),
        node('B', 'llm'),
        node('C', 'image_generation'),
      ],
      edges: [
        edge('e1', 'A', 'B', 'text', 'prompt'),
        edge('e2', 'B', 'C', 'text', 'prompt'),
      ],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');
    expect(result.executedNodes).toBe(3);
    expect(result.error).toBeNull();
    expect(result.failedNodeId).toBeNull();
    expect(result.outputs).toEqual({
      A: { text: 'привет' },
      B: { text: 'ответ модели' },
      // v0.6.0b.2.2: раньше здесь был стаб `{ url: null }`, теперь узел
      // реально ходит в media-провайдера (в тесте он замокан).
      C: { mediaUrl: 'https://cdn/img.png', mediaType: 'IMAGE', taskId: 'task-1' },
    });

    // R3: llm-узел получил нормализованный вход prompt и ушёл в LLM-исполнитель.
    expect(llmExecute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'B', type: 'llm' }),
      { prompt: 'привет' },
    );

    // Запуск переведён в running и закрыт completed.
    expect(fake.run.status).toBe('completed');
    expect(fake.run.startedAt).toBeInstanceOf(Date);
    expect(fake.run.finishedAt).toBeInstanceOf(Date);
    expect(fake.run.error).toBeNull();

    // Все узлы выполнены по порядку уровней.
    expect(fake.rows.map((row) => [row.nodeId, row.status])).toEqual([
      ['A', 'completed'],
      ['B', 'completed'],
      ['C', 'completed'],
    ]);
    expect(fake.rows.map((row) => row.durationMs)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);

    // B получил текст от A по своему входному порту.
    expect(fake.rows[1].inputs).toEqual({ prompt: 'привет' });

    expect(eventTypes()).toEqual([
      'run_started',
      'node_started',
      'node_completed',
      'node_started',
      'node_completed',
      'node_started',
      'node_completed',
    ]);

    const startedOrder = publish.mock.calls.flatMap(([, event]) =>
      event.type === 'node_started' ? [event.nodeId] : [],
    );

    expect(startedOrder).toEqual(['A', 'B', 'C']);
    expect(publish).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ type: 'run_started', runId: RUN_ID }),
    );
    // KI-060: run_completed публикует процессор, а не executor.
    expect(eventTypes()).not.toContain('run_completed');
  });

  it('выполняет diamond: B и C на одном уровне, D — последним', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: 'a' }),
        node('B', 'text', { value: 'b' }),
        node('C', 'text', { value: 'c' }),
        node('D', 'text', { value: 'd' }),
      ],
      edges: [
        edge('ab', 'A', 'B', 'text', 'in'),
        edge('ac', 'A', 'C', 'text', 'in'),
        edge('bd', 'B', 'D', 'text', 'left'),
        edge('cd', 'C', 'D', 'text', 'right'),
      ],
    };

    // План движка: средний уровень — параллельная «волна».
    expect((await engineService.buildExecutionPlanAsync(graph)).levels).toEqual([
      ['A'],
      ['B', 'C'],
      ['D'],
    ]);

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');
    expect(result.executedNodes).toBe(4);
    expect(fake.rows).toHaveLength(4);
    expect(fake.rows.every((row) => row.status === 'completed')).toBe(true);

    // D запускается последним: все его предшественники уже записаны.
    expect(fake.rows.at(-1)?.nodeId).toBe('D');

    const nodeD = fake.rows.find((row) => row.nodeId === 'D');

    // KI-034: ключи входов нормализованы в имя порта, а у 'text'-узла порт один,
    // поэтому вторая связь перекрывает первую. Готовый multi-input (merge,
    // condition) потребует per-handle контракта в R4.
    expect(nodeD?.inputs).toEqual({ text: 'c' });
  });

  it('KI-288 (A→B→C): потомок упавшего узла получает skipped, а не падает сам', async () => {
    const graph: GraphDto = {
      nodes: [node('A', 'text', { value: 'a' }), node('B', 'llm'), node('C', 'llm')],
      edges: [
        edge('e1', 'A', 'B', 'text', 'prompt'),
        edge('e2', 'B', 'C', 'text', 'prompt'),
      ],
    };

    const internals = service as unknown as {
      runNodeAsync: (
        node: NodeDto,
        inputs: Record<string, unknown>,
      ) => Promise<FakeNodeStep>;
    };
    /** Узлы, которые реально дошли до исполнителя. */
    const executed: string[] = [];

    vi.spyOn(internals, 'runNodeAsync').mockImplementation(
      async (current: NodeDto) => {
        executed.push(current.id);

        if (current.id === 'B') {
          throw new Error('узел упал');
        }

        return { outputs: { text: 'ok' }, metrics: null };
      },
    );

    // KI-036: после исчерпания попыток узла executeAsync пробрасывает ошибку
    // (job-level retry), но запуск уже закрыт 'failed' в БД.
    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('узел упал');

    // KI-288: раньше (после KI-287) уровень C выполнялся с `prompt=null` и либо
    // падал сам, либо отдавал fallback в outputs (KI-290). Теперь C не
    // запускается вообще — у него `skipped`.
    expect(fake.rows.map((row) => [row.nodeId, row.status])).toEqual([
      ['A', 'completed'],
      ['B', 'failed'],
      ['C', 'skipped'],
    ]);
    expect(fake.rows[1].error).toBe('узел упал');

    const skippedC = fake.rows[2];

    expect(skippedC.error).toBe('Пропущен: упал предшественник');
    expect(skippedC.outputs).toBeNull();
    expect(skippedC.inputs).toEqual({});
    expect(skippedC.durationMs).toBe(0);
    expect(skippedC.startedAt).toBeInstanceOf(Date);
    expect(skippedC.finishedAt).toBeInstanceOf(Date);

    // Пропущенный узел не доходит до исполнителя и не публикует node_started.
    expect(executed).toEqual(['A', 'B']);

    const startedOrder = publish.mock.calls.flatMap(([, event]) =>
      event.type === 'node_started' ? [event.nodeId] : [],
    );

    expect(startedOrder).toEqual(['A', 'B']);

    // KI-290: fallback-выход пропущенного узла в outputs запуска не попадает.
    expect(fake.run.outputs).toEqual({ A: { text: 'ok' } });
    // Запуск всё равно `failed`, а ошибка в workflow_runs — первого падения.
    expect(fake.run.status).toBe('failed');
    expect(fake.run.error).toBe('узел упал');
    expect(eventTypes()).toContain('node_failed');
    expect(lastEventOfType('node_skipped')).toEqual({
      type: 'node_skipped',
      runId: RUN_ID,
      nodeId: 'C',
      nodeType: 'llm',
      reason: 'Пропущен: упал предшественник',
      skippedAt: expect.any(String),
    });
    // KI-060: запуск закрыт в БД, но run_completed отдаёт процессор.
    expect(eventTypes()).not.toContain('run_completed');
  });

  it('KI-288: ветвление A→(B,C) — падение B не мешает независимому C', async () => {
    // Оба узла — потомки A, но друг от друга не зависят: B падает, C обязан
    // выполниться (RULES 4.16), а не превратиться в `skipped`.
    const graph: GraphDto = {
      nodes: [node('A', 'text', { value: 'a' }), node('B', 'llm'), node('C', 'llm')],
      edges: [
        edge('ab', 'A', 'B', 'text', 'prompt'),
        edge('ac', 'A', 'C', 'text', 'prompt'),
      ],
    };

    llmExecute.mockImplementation((current: NodeDto) =>
      current.id === 'B'
        ? Promise.reject(new Error('B упал'))
        : Promise.resolve(llmNodeResult('ответ C')),
    );

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('B упал');

    const statusOf = (nodeId: string): string | undefined =>
      fake.rows.find((row) => row.nodeId === nodeId)?.status;

    expect(statusOf('A')).toBe('completed');
    expect(statusOf('B')).toBe('failed');
    expect(statusOf('C')).toBe('completed');
    // C независим от B: его выход остаётся в outputs запуска.
    expect(fake.run.outputs).toEqual({ A: { text: 'a' }, C: { text: 'ответ C' } });
    expect(fake.run.status).toBe('failed');
  });

  it('KI-288: пропуск транзитивен A→B→C→D (B упал → C и D skipped)', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: 'a' }),
        node('B', 'text', { value: 'b' }),
        node('C', 'text', { value: 'c' }),
        node('D', 'text', { value: 'd' }),
      ],
      edges: [
        edge('ab', 'A', 'B', 'text', 'text'),
        edge('bc', 'B', 'C', 'text', 'text'),
        edge('cd', 'C', 'D', 'text', 'text'),
      ],
    };

    spyRunNode(async (current: NodeDto) => {
      if (current.id === 'B') {
        throw new Error('B упал');
      }

      return { outputs: { text: String(current.data.value) }, metrics: null };
    });

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('B упал');

    // C пропущен как потомок упавшего B, D — как потомок пропущенного C.
    expect(fake.rows.map((row) => [row.nodeId, row.status])).toEqual([
      ['A', 'completed'],
      ['B', 'failed'],
      ['C', 'skipped'],
      ['D', 'skipped'],
    ]);

    const skippedOrder = publish.mock.calls.flatMap(([, event]) =>
      event.type === 'node_skipped' ? [event.nodeId] : [],
    );

    expect(skippedOrder).toEqual(['C', 'D']);

    // KI-290: fallback-значения text-узлов ('c'/'d' из data.value) в outputs
    // запуска не попадают — ветка результата не дала.
    expect(fake.run.outputs).toEqual({ A: { text: 'a' } });
    expect(fake.run.status).toBe('failed');
  });

  it('KI-288: узел пропускается, если упал хотя бы один из двух предшественников', async () => {
    // A падает, B успешен, оба питают C: узел пропускается (для узлов с
    // несколькими входами «упал любой предшественник» = нет полного набора
    // данных; пофайловый merge — KI-035/KI-278).
    const graph: GraphDto = {
      nodes: [
        node('A', 'llm'),
        node('B', 'text', { value: 'b' }),
        node('C', 'compare', { mode: 'diff' }),
      ],
      edges: [
        edge('ac', 'A', 'C', 'text', 'a'),
        edge('bc', 'B', 'C', 'text', 'b'),
      ],
    };

    llmExecute.mockRejectedValue(new Error('A упал'));

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('A упал');

    const statusOf = (nodeId: string): string | undefined =>
      fake.rows.find((row) => row.nodeId === nodeId)?.status;

    expect(statusOf('A')).toBe('failed');
    expect(statusOf('B')).toBe('completed');
    expect(statusOf('C')).toBe('skipped');
    expect(fake.run.outputs).toEqual({ B: { text: 'b' } });
  });

  it('KI-287 (Т1): падение на уровне не мешает независимым узлам того же уровня', async () => {
    // Уровни плана: ['A'] → ['B', 'C'] — B и C не зависят ни от A, ни друг от друга.
    const graph: GraphDto = {
      nodes: [
        node('A', 'llm'),
        node('B', 'text', { value: 'b' }),
        node('C', 'text', { value: 'c' }),
      ],
      edges: [],
    };

    spyRunNode(async (current: NodeDto) => {
      if (current.id === 'A') {
        throw new Error('llm недоступен');
      }

      return { outputs: { text: String(current.data.value) }, metrics: null };
    });

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('llm недоступен');

    // Строка создана для всех трёх узлов: падение A не отменило уровень B/C.
    expect(fake.rows.map((row) => row.nodeId).sort()).toEqual(['A', 'B', 'C']);
    expect(
      fake.rows
        .map((row) => [row.nodeId, row.status])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ['A', 'failed'],
      ['B', 'completed'],
      ['C', 'completed'],
    ]);
    expect(fake.rows.find((row) => row.nodeId === 'A')?.error).toBe('llm недоступен');
    expect(fake.rows.find((row) => row.nodeId === 'B')?.outputs).toEqual({ text: 'b' });
    expect(fake.rows.find((row) => row.nodeId === 'C')?.outputs).toEqual({ text: 'c' });
    // Событий пропуска нет: B и C не потомки упавшего A.
    expect(eventTypes()).not.toContain('node_skipped');

    // Т3: хотя независимые узлы завершились, запуск закрыт `failed`.
    expect(fake.run.status).toBe('failed');
    expect(fake.run.error).toBe('llm недоступен');
  });

  it('KI-287 (Т2) / KI-288: независимая ветка следующего уровня выполняется, зависимая пропускается', async () => {
    // Две параллельные ветки: `источник`(http, падает) → `зависимый`, и
    // `независимый-1` → `независимый-2`. Второй уровень обязан быть обработан
    // целиком: независимая ветка доигрывается, зависимый узел — `skipped`
    // (до KI-287 цикл прерывался и третьего/второго уровня не было вовсе).
    const graph: GraphDto = {
      nodes: [
        node('источник', 'http', { url: 'http://127.0.0.1:1/never' }),
        node('зависимый', 'llm'),
        node('независимый-1', 'text', { value: 'своя ветка' }),
        node('независимый-2', 'text', { value: 'её продолжение' }),
      ],
      edges: [
        edge('e1', 'источник', 'зависимый', 'text', 'prompt'),
        edge('e2', 'независимый-1', 'независимый-2', 'text', 'text'),
      ],
    };

    // Проверяем, что план действительно двухуровневый (иначе тест не о том).
    expect((await engineService.buildExecutionPlanAsync(graph)).levels).toEqual([
      ['источник', 'независимый-1'],
      ['зависимый', 'независимый-2'],
    ]);

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow();

    const statusOf = (nodeId: string): string | undefined =>
      fake.rows.find((row) => row.nodeId === nodeId)?.status;

    // `http` падает сам (порт 1 закрыт), зависимый узел не запускается, а
    // независимая ветка выполняется до конца.
    expect(statusOf('источник')).toBe('failed');
    expect(statusOf('независимый-1')).toBe('completed');
    expect(statusOf('зависимый')).toBe('skipped');
    expect(statusOf('независимый-2')).toBe('completed');

    const dependentRow = fake.rows.find((row) => row.nodeId === 'зависимый');

    // До KI-288 здесь был `prompt: null` и падение самого узла.
    expect(dependentRow?.inputs).toEqual({});
    expect(dependentRow?.error).toBe('Пропущен: упал предшественник');

    // В outputs запуска попадают только успешно завершившиеся узлы.
    expect(fake.run.outputs).toEqual({
      'независимый-1': { text: 'своя ветка' },
      'независимый-2': { text: 'её продолжение' },
    });
    expect(fake.run.status).toBe('failed');
  });

  it('KI-287 (Т3) / KI-288: несколько падений → независимые ветки записаны, зависимые пропущены', async () => {
    // Три уровня: a и d → b, e и f → c. Падает только a: b (и его потомок c) и
    // e пропускаются, а независимая ветка d → f доигрывается до конца — именно
    // её терял прежний `break` (KI-287).
    const graph: GraphDto = {
      nodes: [
        node('a', 'llm'),
        node('b', 'llm'),
        node('c', 'http'),
        node('d', 'text', { value: 'd' }),
        node('e', 'text', { value: 'e' }),
        node('f', 'text', { value: 'f' }),
      ],
      edges: [
        edge('ab', 'a', 'b', 'text', 'prompt'),
        edge('bc', 'b', 'c', 'text', 'prompt'),
        edge('ae', 'a', 'e', 'text', 'text'),
        edge('df', 'd', 'f', 'text', 'text'),
      ],
    };

    expect((await engineService.buildExecutionPlanAsync(graph)).levels).toEqual([
      ['a', 'd'],
      ['b', 'e', 'f'],
      ['c'],
    ]);

    llmExecute.mockImplementation((current: NodeDto) => {
      if (current.id === 'a') {
        throw new Error('узел a упал');
      }

      return Promise.resolve(llmNodeResult('ok'));
    });

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('узел a упал');

    const statusOf = (nodeId: string): string | undefined =>
      fake.rows.find((row) => row.nodeId === nodeId)?.status;

    expect(statusOf('a')).toBe('failed');
    expect(statusOf('d')).toBe('completed');
    expect(statusOf('b')).toBe('skipped');
    expect(statusOf('e')).toBe('skipped');
    expect(statusOf('f')).toBe('completed');
    expect(statusOf('c')).toBe('skipped');

    // Ошибка запуска — первого падения, а не последнего.
    expect(fake.run.status).toBe('failed');
    expect(fake.run.error).toBe('узел a упал');
    expect(fake.run.outputs).toEqual({ d: { text: 'd' }, f: { text: 'f' } });
    // Падение одно; пропусков три (b, e и потомок пропущенного b — c).
    expect(eventTypes().filter((type) => type === 'node_failed')).toHaveLength(1);
    expect(eventTypes().filter((type) => type === 'node_skipped')).toHaveLength(3);
  });

  it('KI-290: fallback-выход text-потомка упавшего узла не попадает в outputs', async () => {
    // До KI-288: A падает → B (text с собственным `data.value`) выполнялся с
    // `null`-входом, вход игнорировал и отдавал 'fallback' — это значение
    // оседало в `workflow_runs.outputs` как полноценный результат ветки.
    const graph: GraphDto = {
      nodes: [
        node('A', 'http', { url: 'http://127.0.0.1:1/never' }),
        node('B', 'text', { value: 'fallback' }),
      ],
      edges: [edge('ab', 'A', 'B', 'text', 'text')],
    };

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow();

    const rowB = fake.rows.find((row) => row.nodeId === 'B');

    expect(rowB?.status).toBe('skipped');
    expect(rowB?.outputs).toBeNull();
    expect(fake.run.outputs).toEqual({});
    expect(fake.run.status).toBe('failed');
  });

  it('прокидывает null, когда выход предшественника пуст (prompt = null)', async () => {
    const graph: GraphDto = {
      nodes: [node('A', 'image_generation'), node('B', 'llm')],
      edges: [edge('e1', 'A', 'B', 'image-output', 'prompt')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');
    // v0.6.0b.2.2: media-узел отдаёт mediaUrl (стаб отдавал `{ url: null }`).
    expect(fake.rows[0].outputs).toEqual({
      mediaUrl: 'https://cdn/img.png',
      mediaType: 'IMAGE',
      taskId: 'task-1',
    });
    // Порт `image-output` не совпадает с реальным выходом узла, поэтому
    // зависимый узел получает null — это и проверяем.
    expect(fake.rows[1].inputs).toEqual({ prompt: null });
  });

  it('падает с UnsupportedNodeTypeException на неизвестном типе узла', async () => {
    const graph: GraphDto = { nodes: [node('A', 'merge')], edges: [] };

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
      UnsupportedNodeTypeException,
    );

    expect(fake.rows[0].status).toBe('failed');
    expect(fake.rows[0].error).toContain('Неподдерживаемый тип узла: merge');
    expect(fake.run.status).toBe('failed');
  });

  it('runNodeAsync бросает UnsupportedNodeTypeException с типом узла', async () => {
    const internals = service as unknown as {
      runNodeAsync: (
        node: NodeDto,
        inputs: Record<string, unknown>,
      ) => Promise<FakeNodeStep>;
    };

    await expect(internals.runNodeAsync(node('A', 'merge'), {})).rejects.toThrow(
      UnsupportedNodeTypeException,
    );
    await expect(internals.runNodeAsync(node('A', 'merge'), {})).rejects.toThrow(
      'Неподдерживаемый тип узла: merge',
    );
  });

  it('завершает пустой граф без строк node_runs', async () => {
    const result = await service.executeAsync(RUN_ID, { nodes: [], edges: [] });

    expect(result).toEqual({
      status: 'completed',
      executedNodes: 0,
      failedNodeId: null,
      error: null,
      outputs: {},
    });
    expect(fake.rows).toHaveLength(0);
    expect(fake.run.status).toBe('completed');
    expect(eventTypes()).toEqual(['run_started']);
  });

  it('R6.5.1: выполняет граф http → text и пишет outputs http в node_runs', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: new Headers(),
        text: () => Promise.resolve('{"ip":"127.0.0.1"}'),
      } as unknown as Response),
    );

    vi.stubGlobal('fetch', fetchMock);

    try {
      const graph: GraphDto = {
        nodes: [
          node('A', 'http', { method: 'GET', url: 'https://example.com/get', timeoutMs: 5000 }),
          node('B', 'text', { value: 'после http' }),
        ],
        edges: [],
      };

      const result = await service.executeAsync(RUN_ID, graph);

      expect(result.status).toBe('completed');
      expect(result.executedNodes).toBe(2);

      const httpRow = fake.rows.find((row) => row.nodeId === 'A');

      expect(httpRow?.status).toBe('completed');
      expect(httpRow?.nodeType).toBe('http');
      expect(httpRow?.outputs).toEqual({ status: 200, body: '{"ip":"127.0.0.1"}' });
      // У http-узла нет метрик: обе колонки стоимости остаются NULL (KI-038).
      expect(httpRow?.costUsd).toBeNull();
      expect(httpRow?.costRub).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fake.run.status).toBe('completed');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('R6.5.1: http без url падает с понятной ошибкой и не повторяется', async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    try {
      const graph: GraphDto = { nodes: [node('A', 'http', { method: 'GET' })], edges: [] };

      await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
        'Узел http: не задан url',
      );

      expect(fake.rows[0].status).toBe('failed');
      expect(fake.rows[0].error).toContain('не задан url');
      // Детерминированная ошибка: сеть не дёргалась, повторов не было (KI-041).
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fake.rows[0].logs).toEqual([]);
      expect(fake.run.status).toBe('failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('KI-289: http с failOnHttpError=true делает 4xx ошибкой узла и пропускает потомка', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        status: 404,
        headers: new Headers(),
        text: () => Promise.resolve('not found'),
      } as unknown as Response),
    );

    vi.stubGlobal('fetch', fetchMock);

    try {
      const graph: GraphDto = {
        nodes: [
          node('A', 'http', {
            method: 'GET',
            url: 'https://example.com/missing',
            failOnHttpError: true,
          }),
          node('B', 'text', { value: 'fallback-потомок' }),
        ],
        edges: [edge('ab', 'A', 'B', 'result', 'text')],
      };

      await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow('HTTP 404');

      const rowA = fake.rows.find((row) => row.nodeId === 'A');
      const rowB = fake.rows.find((row) => row.nodeId === 'B');

      // KI-289: узел закрыт failed, а не completed с { status, body }.
      expect(rowA?.status).toBe('failed');
      expect(rowA?.error).toBe('HTTP 404');
      expect(rowA?.outputs).toBeNull();
      // KI-288: потомок упавшего http-узла не запускается вовсе.
      expect(rowB?.status).toBe('skipped');
      expect(fake.run.outputs).toEqual({});
      expect(fake.run.status).toBe('failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('R6.5.1: compare получает оба входа a и b (per-handle fallback)', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: 'одинаково' }),
        node('B', 'text', { value: 'одинаково' }),
        node('C', 'compare', { mode: 'diff' }),
      ],
      edges: [edge('e1', 'A', 'C', 'text-output', 'a'), edge('e2', 'B', 'C', 'text-output', 'b')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');

    const compareRow = fake.rows.find((row) => row.nodeId === 'C');

    // У `compare` нет контракта в NODE_PORT_CONTRACT намеренно: контракт описал
    // бы один вход, и вторая связь перекрыла бы первую (KI-035). Без контракта
    // работает fallback по targetHandle — оба операнда доходят до исполнителя.
    expect(compareRow?.inputs).toEqual({ a: 'одинаково', b: 'одинаково' });
    expect(compareRow?.outputs).toEqual({ diff: '', equal: true });
  });

  it('R6.5.1: condition получает нормализованный вход input и отдаёт result', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: '5' }),
        node('B', 'condition', { left: 'input.value', operator: '>', right: '3' }),
      ],
      edges: [edge('e1', 'A', 'B', 'text-output', 'input')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');

    const conditionRow = fake.rows.find((row) => row.nodeId === 'B');

    expect(conditionRow?.inputs).toEqual({ input: '5' });
    expect(conditionRow?.outputs).toEqual({
      result: true,
      evaluated: { left: 5, right: 3 },
    });
  });

  it('R6.5.1: output подписывает вход именем из data.name', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: 'текст из text-узла' }),
        node('B', 'output', { name: 'my_output' }),
      ],
      edges: [edge('e1', 'A', 'B', 'text-output', 'prompt')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');

    const outputRow = fake.rows.find((row) => row.nodeId === 'B');

    expect(outputRow?.inputs).toEqual({ prompt: 'текст из text-узла' });
    expect(outputRow?.outputs).toEqual({ my_output: 'текст из text-узла' });
  });

  it('KI-037: ошибка планирования закрывает запуск failed, а не оставляет pending', async () => {
    const graph: GraphDto = {
      nodes: [node('A', 'text'), node('B', 'text')],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('failed');
    expect(result.executedNodes).toBe(0);
    expect(result.error).toContain('цикл');
    expect(fake.run.status).toBe('failed');
    expect(fake.run.error).toContain('цикл');
    expect(fake.run.finishedAt).toBeInstanceOf(Date);
    expect(fake.rows).toHaveLength(0);
    // KI-037 + KI-060: планирование упало до run_started, а run_completed
    // публикует процессор (он же увидит, что исключения нет → final=true).
    expect(eventTypes()).toEqual([]);
  });

  it('KI-036: повторяет «временную» ошибку и завершает узел с третьей попытки', async () => {
    const graph: GraphDto = { nodes: [node('A', 'llm')], edges: [] };
    let calls = 0;

    spyRunNode(async () => {
      calls += 1;

      if (calls < 3) {
        throw new LlmProviderException('anthropic', 'rate limit', { retryable: true });
      }

      return { outputs: { text: 'ответ после повтора' }, metrics: null };
    });

    vi.useFakeTimers();

    try {
      const promise = service.executeAsync(RUN_ID, graph);

      await vi.advanceTimersByTimeAsync(10_000);

      await expect(promise).resolves.toEqual(
        expect.objectContaining({ status: 'completed', executedNodes: 1 }),
      );
    } finally {
      vi.useRealTimers();
    }

    expect(calls).toBe(3);
    expect(fake.rows[0].status).toBe('completed');
    expect(fake.rows[0].outputs).toEqual({ text: 'ответ после повтора' });
    expect(fake.rows[0].error).toBeNull();
    // В logs остались две неудачные попытки (KI-036).
    expect(fake.rows[0].logs).toHaveLength(2);
    expect(fake.rows[0].logs?.[0]).toContain('попытка 1/3');
    expect(fake.rows[0].logs?.[1]).toContain('попытка 2/3');
  });

  it('KI-036: после исчерпания попыток бросает наружу для job-level retry', async () => {
    const graph: GraphDto = { nodes: [node('A', 'llm')], edges: [] };
    let calls = 0;

    spyRunNode(async () => {
      calls += 1;
      throw new LlmProviderException('anthropic', 'overloaded', { retryable: true });
    });

    vi.useFakeTimers();

    try {
      const promise = service.executeAsync(RUN_ID, graph);
      const rejection = expect(promise).rejects.toThrow('overloaded');

      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }

    expect(calls).toBe(3);
    expect(fake.run.status).toBe('failed');
    expect(fake.rows[0].status).toBe('failed');
    expect(fake.rows[0].logs).toHaveLength(2);
    expect(eventTypes()).not.toContain('run_completed');
  });

  it('KI-036: не повторяет детерминированную ошибку провайдера', async () => {
    const graph: GraphDto = { nodes: [node('A', 'llm')], edges: [] };
    let calls = 0;

    spyRunNode(async () => {
      calls += 1;
      throw new LlmProviderException('anthropic', 'invalid api key', {
        retryable: false,
      });
    });

    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
      'invalid api key',
    );

    expect(calls).toBe(1);
    expect(fake.rows[0].status).toBe('failed');
    expect(fake.rows[0].logs).toEqual([]);
  });

  it('KI-031: повторный прогон графа не создаёт дубли node_runs (upsert)', async () => {
    const graph: GraphDto = {
      nodes: [node('A', 'text', { value: 'a' }), node('B', 'text', { value: 'b' })],
      edges: [edge('e1', 'A', 'B', 'text')],
    };

    await service.executeAsync(RUN_ID, graph);

    const idsAfterFirstRun = fake.rows.map((row) => row.id);

    await service.executeAsync(RUN_ID, graph);

    // Те же строки обновлены, новых не появилось.
    expect(fake.rows).toHaveLength(2);
    expect(fake.rows.map((row) => row.id)).toEqual(idsAfterFirstRun);
    expect(fake.rows.every((row) => row.status === 'completed')).toBe(true);
  });

  it('KI-040: retry сбрасывает error и finished_at прошлой попытки', async () => {
    fake.run.status = 'failed';
    fake.run.error = 'ошибка прошлой попытки';
    fake.run.finishedAt = new Date();

    await service.executeAsync(RUN_ID, { nodes: [], edges: [] });

    // markRunRunningAsync — первый UPDATE workflow_runs в прогоне.
    expect(fake.runUpdates[0]).toEqual(
      expect.objectContaining({
        status: 'running',
        error: null,
        finishedAt: null,
        startedAt: expect.any(Date),
      }),
    );
    expect(fake.run.error).toBeNull();
    // `finished_at` на завершении прогона проставляет finishRunAsync, поэтому
    // проверяется именно сброс в момент старта повтора (payload первого UPDATE).
  });

  /**
   * Кладёт в фейковую БД готовую строку `node_runs` (имитация прошлой попытки).
   *
   * @param row - поля строки (runId по умолчанию — тестовый)
   */
  const seedNodeRun = (row: Partial<FakeNodeRun> & { nodeId: string }): void => {
    fake.rows.push({
      id: `seeded-${row.nodeId}`,
      runId: row.runId ?? RUN_ID,
      nodeId: row.nodeId,
      nodeType: row.nodeType ?? 'llm',
      status: row.status ?? 'completed',
      inputs: row.inputs ?? {},
      outputs: row.outputs ?? null,
      error: row.error ?? null,
      logs: row.logs ?? null,
      durationMs: row.durationMs ?? null,
      tokensIn: row.tokensIn ?? null,
      tokensOut: row.tokensOut ?? null,
      costUsd: row.costUsd ?? null,
      costRub: row.costRub ?? null,
      startedAt: row.startedAt ?? null,
      finishedAt: row.finishedAt ?? null,
    });
  };

  it('KI-047: UPSERT сбрасывает outputs и duration_ms прошлой попытки', async () => {
    await service.executeAsync(RUN_ID, { nodes: [node('A', 'text')], edges: [] });

    expect(fake.upserts[0].set).toEqual(
      expect.objectContaining({
        status: 'running',
        inputs: {},
        error: null,
        logs: [],
        outputs: null,
        durationMs: null,
        startedAt: expect.any(Date),
        finishedAt: null,
      }),
    );
  });

  it('KI-047: устаревшие outputs не остаются после переигранной попытки', async () => {
    seedNodeRun({
      nodeId: 'A',
      status: 'failed',
      inputs: {},
      outputs: { text: 'устаревший результат' },
      error: 'прошлая ошибка',
      durationMs: 999,
    });

    const result = await service.executeAsync(RUN_ID, {
      nodes: [node('A', 'llm')],
      edges: [],
    });

    expect(result.status).toBe('completed');
    expect(fake.rows[0].outputs).toEqual({ text: 'ответ модели' });
    expect(fake.rows[0].error).toBeNull();
  });

  it('KI-046: переиспользует completed-узел с теми же входами и молчит в событиях', async () => {
    seedNodeRun({
      nodeId: 'A',
      status: 'completed',
      inputs: {},
      outputs: { text: 'результат прошлой попытки' },
      durationMs: 42,
    });

    const internals = service as unknown as {
      runNodeAsync: (
        node: NodeDto,
        inputs: Record<string, unknown>,
      ) => Promise<FakeNodeStep>;
    };
    const runSpy = vi.spyOn(internals, 'runNodeAsync');

    const result = await service.executeAsync(RUN_ID, {
      nodes: [node('A', 'llm')],
      edges: [],
    });

    expect(result.status).toBe('completed');
    expect(result.outputs).toEqual({ A: { text: 'результат прошлой попытки' } });
    expect(runSpy).not.toHaveBeenCalled();
    expect(llmExecute).not.toHaveBeenCalled();
    // События переиспользованного узла повторно не публикуются.
    expect(eventTypes()).toEqual(['run_started']);
    // Строка осталась от прошлой попытки — upsert не выполнялся.
    expect(fake.upserts).toHaveLength(0);
    expect(fake.rows[0].durationMs).toBe(42);
  });

  it('KI-046: переигрывает узел, если входы изменились', async () => {
    // A переиспользуется (его входы — {}), но сохранённые входы B отличаются
    // от того, что A отдаёт сейчас, поэтому B выполняется заново.
    seedNodeRun({ nodeId: 'A', inputs: {}, outputs: { text: 'привет' } });
    seedNodeRun({
      nodeId: 'B',
      inputs: { prompt: 'другой вход' },
      outputs: { text: 'старый ответ' },
    });

    const graph: GraphDto = {
      nodes: [node('A', 'text', { value: 'привет' }), node('B', 'llm')],
      edges: [edge('e1', 'A', 'B', 'text', 'prompt')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');
    expect(llmExecute).toHaveBeenCalledTimes(1);
    expect(llmExecute.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'B' }));

    const nodeB = fake.rows.find((row) => row.nodeId === 'B');

    expect(nodeB?.inputs).toEqual({ prompt: 'привет' });
    expect(nodeB?.outputs).toEqual({ text: 'ответ модели' });
  });

  it('KI-046: не переиспользует failed-строку', async () => {
    seedNodeRun({
      nodeId: 'A',
      status: 'failed',
      inputs: {},
      outputs: { text: 'устаревшее' },
      error: 'бум',
    });

    await service.executeAsync(RUN_ID, { nodes: [node('A', 'llm')], edges: [] });

    expect(llmExecute).toHaveBeenCalledTimes(1);
  });

  it('KI-046: не переиспользует running-строку (зависшая попытка)', async () => {
    seedNodeRun({
      nodeId: 'A',
      status: 'running',
      inputs: {},
      outputs: null,
      startedAt: new Date(Date.now() - 60_000),
    });

    await service.executeAsync(RUN_ID, { nodes: [node('A', 'llm')], edges: [] });

    expect(llmExecute).toHaveBeenCalledTimes(1);
    expect(fake.rows[0].status).toBe('completed');
  });

  it('KI-046: без строки прошлой попытки узел выполняется как обычно', async () => {
    const result = await service.executeAsync(RUN_ID, {
      nodes: [node('A', 'llm')],
      edges: [],
    });

    expect(result.status).toBe('completed');
    expect(llmExecute).toHaveBeenCalledTimes(1);
    expect(fake.upserts).toHaveLength(1);
  });

  it('KI-046: при job-retry переиспользует A и B и переигрывает только упавший C', async () => {
    const graph: GraphDto = {
      nodes: [
        node('A', 'text', { value: 'привет' }),
        node('B', 'llm'),
        node('C', 'llm'),
      ],
      edges: [
        edge('e1', 'A', 'B', 'text', 'prompt'),
        edge('e2', 'B', 'C', 'text', 'prompt'),
      ],
    };

    let cFails = true;

    llmExecute.mockImplementation((current: NodeDto) =>
      current.id === 'C' && cFails
        ? Promise.reject(
            new LlmProviderException('anthropic', 'invalid api key', {
              retryable: false,
            }),
          )
        : Promise.resolve(llmNodeResult(`ответ ${current.id}`)),
    );

    // Первая попытка: A и B успешны, C падает (неповторяемо).
    await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
      'invalid api key',
    );

    expect(fake.rows.map((row) => [row.nodeId, row.status])).toEqual([
      ['A', 'completed'],
      ['B', 'completed'],
      ['C', 'failed'],
    ]);

    // Job-level retry: C больше не падает.
    cFails = false;
    llmExecute.mockClear();

    const internals = service as unknown as {
      runNodeAsync: (
        node: NodeDto,
        inputs: Record<string, unknown>,
      ) => Promise<FakeNodeStep>;
    };
    const runSpy = vi.spyOn(internals, 'runNodeAsync');

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');
    // Выполнялся только C — A и B переиспользованы из прошлой попытки.
    expect(runSpy.mock.calls.map(([current]) => current.id)).toEqual(['C']);
    expect(llmExecute).toHaveBeenCalledTimes(1);
    expect(llmExecute.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'C' }));
    expect(fake.rows).toHaveLength(3);
    expect(fake.rows.every((row) => row.status === 'completed')).toBe(true);
  });

  it('KI-038: пишет tokens_in/tokens_out/cost_usd в node_runs', async () => {
    llmExecute.mockResolvedValue({
      outputs: { text: 'ответ с метриками' },
      metrics: {
        inputTokens: 1234,
        outputTokens: 56,
        costUsd: 0.0045,
        model: 'claude-sonnet-4-20250514',
      },
    });

    await service.executeAsync(RUN_ID, { nodes: [node('A', 'llm')], edges: [] });

    const row = fake.rows.find((candidate) => candidate.nodeId === 'A');

    expect(row?.tokensIn).toBe(1234);
    expect(row?.tokensOut).toBe(56);
    // Drizzle-колонка numeric без mode — значение хранится строкой (6 знаков).
    expect(row?.costUsd).toBe('0.004500');
  });

  it('KI-038: у не-LLM узла метрики остаются null', async () => {
    await service.executeAsync(RUN_ID, { nodes: [node('A', 'text')], edges: [] });

    const row = fake.rows.find((candidate) => candidate.nodeId === 'A');

    expect(row?.tokensIn).toBeNull();
    expect(row?.tokensOut).toBeNull();
    expect(row?.costUsd).toBeNull();
    expect(row?.costRub).toBeNull();
  });

  it('v0.6.0b.2.2: media-узел пишет cost_rub, а не cost_usd', async () => {
    await service.executeAsync(RUN_ID, {
      nodes: [node('A', 'image_generation', { model: 'flux-schnell' })],
      edges: [],
    });

    const row = fake.rows.find((candidate) => candidate.nodeId === 'A');

    // Стоимость media приходит в рублях: numeric(10,6) → строка с 6 знаками.
    expect(row?.costRub).toBe('0.600000');
    // USD-колонка не заполняется: валюты не смешиваются (RULES 4.23).
    expect(row?.costUsd).toBeNull();
    expect(row?.tokensIn).toBeNull();
    expect(row?.tokensOut).toBeNull();
    expect(row?.status).toBe('completed');
    expect(row?.outputs).toEqual({
      mediaUrl: 'https://cdn/img.png',
      mediaType: 'IMAGE',
      taskId: 'task-1',
    });
  });

  it('v0.6.0b.2.2: media-исполнитель получает runId для ключа идемпотентности', async () => {
    await service.executeAsync(RUN_ID, {
      nodes: [node('A', 'image_generation', { model: 'flux-schnell' })],
      edges: [],
    });

    expect(mediaExecute).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'A', type: 'image_generation' }),
      expect.any(Object),
      RUN_ID,
    );
  });

  it('v0.6.0b.2.2: падение media-узла помечает его failed с текстом ошибки', async () => {
    // Свежий reject на каждый вызов: узел повторяется до NODE_MAX_ATTEMPTS раз,
    // и общий rejected-промис давал бы unhandled rejection между попытками.
    mediaExecute.mockImplementation(() =>
      Promise.reject(new Error('задача генерации упала')),
    );
    const result = await service
      .executeAsync(RUN_ID, {
        nodes: [node('A', 'image_generation'), node('B', 'text')],
        edges: [edge('e1', 'A', 'B', 'media', 'prompt')],
      })
      // KI-036: запуск закрыт 'failed' в БД, но исключение бросается наружу,
      // чтобы BullMQ увидел провал job'а. Ловим его, чтобы проверить строку.
      .catch((caught: unknown) => caught);

    expect(result).toBeInstanceOf(Error);

    const row = fake.rows.find((candidate) => candidate.nodeId === 'A');

    expect(fake.run.status).toBe('failed');
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('задача генерации упала');
  });

  it('KI-047: UPSERT сбрасывает cost_rub прошлой попытки (v0.6.0b.2.2)', async () => {
    // Строка прошлой попытки — failed: completed-строку узел переиспользовал бы
    // (KI-046) и до UPSERT дело бы не дошло.
    seedNodeRun({
      nodeId: 'A',
      nodeType: 'image_generation',
      status: 'failed',
      costRub: '9.990000',
    });
    mediaExecute.mockImplementation(() =>
      Promise.reject(new Error('задача генерации упала')),
    );

    await service
      .executeAsync(RUN_ID, {
        nodes: [node('A', 'image_generation')],
        edges: [],
      })
      // Узел падает, поэтому запуск закрывается 'failed' и бросает наружу
      // (KI-036); строка node_runs при этом уже обновлена.
      .catch(() => undefined);

    expect(fake.upserts[0].set).toEqual(
      expect.objectContaining({ costRub: null, costUsd: null }),
    );
  });

  it('KI-060: не публикует run_completed — это ответственность процессора', async () => {
    const result = await service.executeAsync(RUN_ID, {
      nodes: [node('A', 'text')],
      edges: [],
    });

    expect(result.status).toBe('completed');
    // Executor отдаёт события узлов и старт, но не финал запуска.
    expect(eventTypes()).toEqual(['run_started', 'node_started', 'node_completed']);
    expect(eventTypes()).not.toContain('run_completed');
  });

  it('KI-060: не публикует run_completed и на детерминированном провале планирования', async () => {
    const graph: GraphDto = {
      nodes: [node('A', 'text'), node('B', 'text')],
      edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'A')],
    };

    await expect(service.executeAsync(RUN_ID, graph)).resolves.toEqual(
      expect.objectContaining({ status: 'failed' }),
    );

    // Ни run_started (планирование не дошло), ни run_completed (это процессор).
    expect(eventTypes()).toEqual([]);
    expect(lastEventOfType('run_completed')).toBeUndefined();
  });

  /* ──────────────────────── sub_workflow (R6.7, KI-200) ──────────────────── */

  describe('узлы sub_workflow', () => {
    /** Подграф из двух узлов: Text → LLM (терминальный — LLM). */
    const subGraph: SubWorkflowRecord = {
      id: SUB_WORKFLOW_ID,
      name: 'Подграф A',
      version: 2,
      nodes: [
        { id: 'S1', type: 'text', data: { value: 'под-' } },
        { id: 'S2', type: 'llm', data: {} },
      ],
      edges: [edge('se1', 'S1', 'S2', 'text', 'prompt')],
    };

    /** Читает строку `node_runs` по id узла. */
    const rowOf = (nodeId: string): FakeNodeRun | undefined =>
      fake.rows.find((row) => row.nodeId === nodeId);

    it('выполняет подграф как часть родительского запуска и кладёт результат в outputs.result', async () => {
      findWorkflow.mockResolvedValue(subGraph);

      const graph: GraphDto = {
        nodes: [
          node('sub-1', 'sub_workflow', {
            kind: 'sub_workflow',
            workflowId: SUB_WORKFLOW_ID,
          }),
          node('out-1', 'output', { name: 'answer' }),
        ],
        edges: [edge('e1', 'sub-1', 'out-1', 'result-output', 'text-input')],
      };

      const result = await service.executeAsync(RUN_ID, graph);

      expect(result.status).toBe('completed');

      // Узел sub_workflow: результат подграфа → outputs.result.
      expect(result.outputs['sub-1']).toEqual({ result: { text: 'ответ модели' } });

      // Результат подграфа доехал до зависимого узла родителя (контракт порта
      // `result-output` → `result`).
      expect(result.outputs['out-1']).toEqual({
        answer: { text: 'ответ модели' },
      });

      // Строка node_runs самого узла sub_workflow — completed с result.
      expect(rowOf('sub-1')).toMatchObject({
        status: 'completed',
        nodeType: 'sub_workflow',
        outputs: { result: { text: 'ответ модели' } },
      });

      // Узлы подграфа изолированы префиксом `sub_<nodeId>__` (DESIGN § 5.3).
      expect(rowOf('sub_sub-1__S1')).toMatchObject({
        status: 'completed',
        nodeType: 'text',
      });
      expect(rowOf('sub_sub-1__S2')).toMatchObject({
        status: 'completed',
        nodeType: 'llm',
      });

      // LLM подграфа получил вход от Text подграфа (сбор входов работает
      // на префиксованных id).
      expect(llmExecute).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_sub-1__S2' }),
        { prompt: 'под-' },
      );

      // Подграф загружен у владельца запуска: фильтр по rootUserId.
      expect(findWorkflow).toHaveBeenCalledWith(SUB_WORKFLOW_ID, RUN_OWNER_ID);
    });

    it('несколько терминальных узлов подграфа сливаются в плоский result', async () => {
      findWorkflow.mockResolvedValue({
        ...subGraph,
        nodes: [
          { id: 'S1', type: 'text', data: { value: 'первый' } },
          { id: 'S2', type: 'text', data: { value: 'второй' } },
        ],
        edges: [],
      });

      const graph: GraphDto = {
        nodes: [
          node('sub-1', 'sub_workflow', {
            kind: 'sub_workflow',
            workflowId: SUB_WORKFLOW_ID,
          }),
        ],
        edges: [],
      };

      const result = await service.executeAsync(RUN_ID, graph);

      // Оба узла терминальны (связей нет) — в result оба выхода; ключ `text`
      // перезаписывается последним по порядку плана.
      expect(result.outputs['sub-1']).toEqual({ result: { text: 'второй' } });
    });

    it('вложенный sub_workflow выполняется рекурсивно (глубина 2)', async () => {
      const innerId = '66666666-6666-4666-8666-666666666666';
      const innerGraph: SubWorkflowRecord = {
        id: innerId,
        name: 'Внутренний',
        version: 1,
        nodes: [{ id: 'I1', type: 'text', data: { value: 'внутри' } }],
        edges: [],
      };
      const outerGraph: SubWorkflowRecord = {
        id: SUB_WORKFLOW_ID,
        name: 'Внешний',
        version: 1,
        nodes: [
          {
            id: 'O1',
            type: 'sub_workflow',
            data: { kind: 'sub_workflow', workflowId: innerId },
          },
        ],
        edges: [],
      };

      findWorkflow.mockImplementation((id: string) =>
        Promise.resolve(id === innerId ? innerGraph : outerGraph),
      );

      const graph: GraphDto = {
        nodes: [
          node('sub-1', 'sub_workflow', {
            kind: 'sub_workflow',
            workflowId: SUB_WORKFLOW_ID,
          }),
        ],
        edges: [],
      };

      const result = await service.executeAsync(RUN_ID, graph);

      expect(result.status).toBe('completed');
      expect(result.outputs['sub-1']).toEqual({
        result: { result: { text: 'внутри' } },
      });

      // Префикс накопился дважды: id узлов не пересекаются с родителем.
      expect(rowOf('sub_sub-1__O1')).toMatchObject({ status: 'completed' });
      expect(rowOf('sub_sub_sub-1__O1__I1')).toMatchObject({ status: 'completed' });
    });

    it('циклическая ссылка workflow на себя → узел падает «Циклическая ссылка»', async () => {
      const selfId = '77777777-7777-4777-8777-777777777777';
      const selfGraph: SubWorkflowRecord = {
        id: selfId,
        name: 'C',
        version: 1,
        nodes: [
          {
            id: 'self',
            type: 'sub_workflow',
            data: { kind: 'sub_workflow', workflowId: selfId },
          },
        ],
        edges: [],
      };

      findWorkflow.mockResolvedValue(selfGraph);

      const graph: GraphDto = {
        nodes: [
          node('sub-root', 'sub_workflow', {
            kind: 'sub_workflow',
            workflowId: selfId,
          }),
        ],
        edges: [],
      };

      await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
        'Циклическая ссылка на workflow',
      );

      expect(fake.run.status).toBe('failed');
      expect(fake.run.error).toContain('Циклическая ссылка');
      expect(rowOf('sub-root')?.status).toBe('failed');
      // Вложенный узел тоже зафиксирован как failed — видно, где замкнулось.
      expect(rowOf('sub_sub-root__self')?.status).toBe('failed');
    });

    it('чужой workflow → узел падает 404-ошибкой (существование не раскрывается)', async () => {
      findWorkflow.mockResolvedValue(null);

      const graph: GraphDto = {
        nodes: [
          node('sub-1', 'sub_workflow', {
            kind: 'sub_workflow',
            workflowId: SUB_WORKFLOW_ID,
          }),
        ],
        edges: [],
      };

      await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
        /Workflow .* не найден/,
      );

      expect(rowOf('sub-1')?.status).toBe('failed');
      expect(rowOf('sub-1')?.error).toContain('не найден');
      // Узлов подграфа в node_runs нет: граф даже не загрузился.
      expect(fake.rows).toHaveLength(1);
    });

    it('пустой workflowId падает валидацией данных узла, не доходя до БД', async () => {
      const graph: GraphDto = {
        nodes: [
          node('sub-1', 'sub_workflow', { kind: 'sub_workflow', workflowId: '' }),
        ],
        edges: [],
      };

      await expect(service.executeAsync(RUN_ID, graph)).rejects.toThrow(
        'Некорректные данные узла sub_workflow',
      );

      expect(findWorkflow).not.toHaveBeenCalled();
      expect(rowOf('sub-1')?.status).toBe('failed');
    });
  });
});
