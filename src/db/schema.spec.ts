import { getTableColumns } from 'drizzle-orm';
import { expectTypeOf } from 'vitest';
import type { EdgeDto, GraphSnapshotDto, NodeDto } from '../engine/dto/index.js';
import {
  NODE_RUN_STATUSES,
  WORKFLOW_RUN_STATUSES,
  nodeRuns,
  workflowRuns,
  workflows,
  type NodeRun,
  type NodeRunStatus,
  type RunStatus,
  type Workflow,
  type WorkflowRun,
} from './schema.js';

/**
 * Проверки схемы Drizzle после закрытия KI-014 (`$type<T>()` для jsonb)
 * и KI-015 (`workflow_runs.created_at`).
 *
 * Тесты не требуют живой БД: проверяются метаданные колонок и выведенные
 * TypeScript-типы (последние проверяются при type-check прогоне).
 */
describe('Drizzle schema (KI-014, KI-015)', () => {
  it('типизирует jsonb-колонки workflows и сохраняет snake_case-имена', () => {
    const columns = getTableColumns(workflows);

    expect(columns.nodes.name).toBe('nodes');
    expect(columns.nodes.columnType).toBe('PgJsonb');
    expect(columns.nodes.notNull).toBe(true);
    expect(columns.nodes.hasDefault).toBe(true);
    expect(columns.edges.columnType).toBe('PgJsonb');
    expect(columns.userId.name).toBe('user_id');
  });

  it('делает snapshot обязательным jsonb, а created_at — NOT NULL с default (KI-015)', () => {
    const columns = getTableColumns(workflowRuns);

    expect(columns.snapshot.columnType).toBe('PgJsonb');
    expect(columns.snapshot.notNull).toBe(true);
    expect(columns.createdAt.name).toBe('created_at');
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    // started_at по-прежнему необязателен: он проставляется при старте.
    expect(columns.startedAt.notNull).toBe(false);
  });

  it('типизирует jsonb-колонки node_runs (KI-014)', () => {
    const columns = getTableColumns(nodeRuns);

    expect(columns.logs.columnType).toBe('PgJsonb');
    expect(columns.logs.hasDefault).toBe(true);
    expect(columns.inputs.columnType).toBe('PgJsonb');
    expect(columns.outputs.columnType).toBe('PgJsonb');
    expect(columns.durationMs.name).toBe('duration_ms');
  });

  it('выводит TS-типы jsonb-колонок из $type<T>()', () => {
    expectTypeOf<Workflow['nodes']>().toEqualTypeOf<NodeDto[]>();
    expectTypeOf<Workflow['edges']>().toEqualTypeOf<EdgeDto[]>();
    expectTypeOf<WorkflowRun['snapshot']>().toEqualTypeOf<GraphSnapshotDto>();
    expectTypeOf<WorkflowRun['createdAt']>().toEqualTypeOf<Date>();
    expectTypeOf<RunStatus>().toEqualTypeOf<
      'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
    >();
  });

  it('KI-336: skipped — статус узла, а не запуска', () => {
    // Списки не дублируются: статусы узла выводятся из статусов запуска.
    expect(WORKFLOW_RUN_STATUSES).toEqual([
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(NODE_RUN_STATUSES).toEqual([...WORKFLOW_RUN_STATUSES, 'skipped']);

    // Типы: у запуска `skipped` нет, у узла — есть (KI-288).
    expectTypeOf<NodeRunStatus>().toEqualTypeOf<
      'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'
    >();
  });

  it('KI-336: типы колонок status расходятся ровно на skipped', () => {
    // Движок пишет `node_runs.status='skipped'` без приведения к `RunStatus`:
    // колонка узла объявлена шире колонки запуска.
    expectTypeOf<WorkflowRun['status']>().toEqualTypeOf<RunStatus>();
    expectTypeOf<NodeRun['status']>().toEqualTypeOf<NodeRunStatus>();
    expectTypeOf<WorkflowRun['status']>().not.toEqualTypeOf<NodeRunStatus>();
  });
});
