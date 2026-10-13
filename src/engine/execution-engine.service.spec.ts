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
import { UnsupportedNodeTypeException } from './node-executors.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** Строка `workflow_runs` в тестовом двойнике БД. */
interface FakeRun {
  id: string;
  status: RunStatus;
  outputs: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
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
  durationMs: number | null;
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
  let sequence = 0;

  const applySet = (target: object, values: Record<string, unknown>): void => {
    Object.assign(target, values);
  };

  const db = {
    transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
      callback(db),
    insert: (_table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async (): Promise<unknown[]> => {
          sequence += 1;

          const row = {
            id: `node-run-${sequence}`,
            error: null,
            outputs: null,
            durationMs: null,
            finishedAt: null,
            ...values,
          } as FakeNodeRun;

          rows.push(row);

          return [{ id: row.id }];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown): Promise<void> => {
          const id = wherePairs(condition).get('id');

          if (table === workflowRuns) {
            if (id === run.id) {
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

            const row = rows.find(
              (candidate) =>
                candidate.runId === pairs.get('run_id') &&
                candidate.nodeId === pairs.get('node_id') &&
                candidate.status === pairs.get('status'),
            );

            return row ? [{ outputs: row.outputs }] : [];
          },
        }),
      }),
    }),
  };

  return { db: db as unknown as Database, run, rows };
}

describe('ExecutionEngineService', () => {
  let service: ExecutionEngineService;
  let engineService: EngineService;
  let publish: ReturnType<typeof vi.fn>;
  let llmExecute: ReturnType<typeof vi.fn>;
  let fake: ReturnType<typeof createFakeDb>;

  /** Типы опубликованных событий в порядке публикации. */
  const eventTypes = (): string[] => publish.mock.calls.map(([, event]) => event.type);

  beforeEach(async () => {
    publish = vi.fn((_runId: string, _event: RunEventDto) => Promise.resolve());
    llmExecute = vi.fn((_node: NodeDto, _inputs: Record<string, unknown>) =>
      Promise.resolve({ text: 'ответ модели' }),
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
      C: { url: null },
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
      'run_completed',
    ]);

    const startedOrder = publish.mock.calls.flatMap(([, event]) =>
      event.type === 'node_started' ? [event.nodeId] : [],
    );

    expect(startedOrder).toEqual(['A', 'B', 'C']);
    expect(publish).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ type: 'run_started', runId: RUN_ID }),
    );
    expect(publish).toHaveBeenLastCalledWith(
      RUN_ID,
      expect.objectContaining({ type: 'run_completed', status: 'completed' }),
    );
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

  it('прерывает следующие уровни на первом упавшем узле', async () => {
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
      ) => Promise<Record<string, unknown>>;
    };

    vi.spyOn(internals, 'runNodeAsync').mockImplementation(
      async (current: NodeDto) => {
        if (current.id === 'B') {
          throw new Error('узел упал');
        }

        return { text: 'ok' };
      },
    );

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('failed');
    expect(result.failedNodeId).toBe('B');
    expect(result.error).toBe('узел упал');
    expect(result.executedNodes).toBe(1);

    // Строка A закрыта, строка B — failed, узел C не выполнялся вовсе.
    expect(fake.rows.map((row) => [row.nodeId, row.status])).toEqual([
      ['A', 'completed'],
      ['B', 'failed'],
    ]);
    expect(fake.rows[1].error).toBe('узел упал');
    expect(fake.rows.find((row) => row.nodeId === 'C')).toBeUndefined();

    expect(fake.run.status).toBe('failed');
    expect(fake.run.error).toBe('узел упал');
    expect(eventTypes()).toContain('node_failed');
    expect(eventTypes().at(-1)).toBe('run_completed');
    expect(publish).toHaveBeenLastCalledWith(
      RUN_ID,
      expect.objectContaining({ type: 'run_completed', status: 'failed' }),
    );
  });

  it('прокидывает null, когда выход предшественника пуст (url = null)', async () => {
    const graph: GraphDto = {
      nodes: [node('A', 'image_generation'), node('B', 'llm')],
      edges: [edge('e1', 'A', 'B', 'image-output', 'prompt')],
    };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('completed');
    expect(fake.rows[0].outputs).toEqual({ url: null });
    expect(fake.rows[1].inputs).toEqual({ prompt: null });
  });

  it('падает с UnsupportedNodeTypeException на неизвестном типе узла', async () => {
    const graph: GraphDto = { nodes: [node('A', 'merge')], edges: [] };

    const result = await service.executeAsync(RUN_ID, graph);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Неподдерживаемый тип узла: merge');
    expect(fake.rows[0].status).toBe('failed');
    expect(fake.rows[0].error).toContain('Неподдерживаемый тип узла: merge');
    expect(fake.run.status).toBe('failed');
  });

  it('runNodeAsync бросает UnsupportedNodeTypeException с типом узла', async () => {
    const internals = service as unknown as {
      runNodeAsync: (
        node: NodeDto,
        inputs: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
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
    expect(eventTypes()).toEqual(['run_started', 'run_completed']);
  });
});
