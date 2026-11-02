import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { expectTypeOf } from 'vitest';
import type { EdgeDto, GraphSnapshotDto, NodeDto } from '../engine/dto/index.js';
import {
  NODE_RUN_STATUSES,
  TERMINAL_WORKFLOW_RUN_STATUSES,
  WORKFLOW_RUN_STATUSES,
  nodeRuns,
  organizations,
  users,
  workflowRuns,
  workflows,
  type NewOrganization,
  type NewWorkflow,
  type NodeRun,
  type NodeRunStatus,
  type Organization,
  type RunStatus,
  type User,
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

  it('KI-451: storage_key — nullable text без default', () => {
    const columns = getTableColumns(nodeRuns);

    expect(columns.storageKey.name).toBe('storage_key');
    expect(columns.storageKey.columnType).toBe('PgText');
    expect(columns.storageKey.notNull).toBe(false);
    expect(columns.storageKey.hasDefault).toBe(false);
    expectTypeOf<NodeRun['storageKey']>().toEqualTypeOf<string | null>();
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

  it('KI-353: финальные статусы запуска — подмножество канона', () => {
    // Единственный список статусов живёт здесь; DTO импортируют его, а не
    // выводят заново. `satisfies readonly RunStatus[]` в схеме проверяет
    // вложенность на компиляции, тест — то же множество на рантайме.
    expect(TERMINAL_WORKFLOW_RUN_STATUSES).toEqual(['completed', 'failed']);
    expect(WORKFLOW_RUN_STATUSES).toEqual(
      expect.arrayContaining([...TERMINAL_WORKFLOW_RUN_STATUSES]),
    );
    expectTypeOf<(typeof TERMINAL_WORKFLOW_RUN_STATUSES)[number]>().toEqualTypeOf<
      'completed' | 'failed'
    >();
  });
});

/**
 * Ищет внешний ключ таблицы по имени колонки.
 *
 * @param table - таблица Drizzle-схемы.
 * @param columnName - snake_case-имя колонки в БД.
 * @returns Найденный внешний ключ или `undefined`.
 */
function findForeignKeyByColumn(
  table: PgTable,
  columnName: string,
): ReturnType<typeof getTableConfig>['foreignKeys'][number] | undefined {
  return getTableConfig(table).foreignKeys.find((foreignKey) =>
    foreignKey.reference().columns.some((column) => column.name === columnName),
  );
}

/**
 * Арендатор (organizations) в Drizzle-схеме: v1.0 S1, DESIGN § 3.1.
 *
 * Живая БД не нужна — проверяются метаданные таблиц и выведенные TS-типы.
 * Колонки в БД nullable до backfill'а (см. `backfill-organizations.ts`), но
 * схема обязана объявлять NOT NULL: parity-гейт сверяет итоговое состояние.
 */
describe('Organizations / multi-tenancy (v1.0 S1)', () => {
  it('organizations: id uuid PK default, name text NOT NULL, created_at timestamptz NOT NULL', () => {
    expect(getTableName(organizations)).toBe('organizations');

    const columns = getTableColumns(organizations);

    expect(columns.id.name).toBe('id');
    expect(columns.id.columnType).toBe('PgUUID');
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);

    expect(columns.name.name).toBe('name');
    expect(columns.name.columnType).toBe('PgText');
    expect(columns.name.notNull).toBe(true);
    expect(columns.name.hasDefault).toBe(false);

    expect(columns.createdAt.name).toBe('created_at');
    expect(columns.createdAt.columnType).toBe('PgTimestamp');
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);

    expectTypeOf<Organization['id']>().toEqualTypeOf<string>();
    expectTypeOf<Organization['name']>().toEqualTypeOf<string>();
    expectTypeOf<Organization['createdAt']>().toEqualTypeOf<Date>();
    expectTypeOf<NewOrganization['name']>().toEqualTypeOf<string>();
  });

  it('users и workflows: organization_id — uuid NOT NULL, FK на organizations ON DELETE CASCADE, индекс', () => {
    for (const table of [users, workflows]) {
      const tableName = getTableName(table);
      const columns = getTableColumns(table);
      const organizationId = columns.organizationId;

      expect(organizationId.name).toBe('organization_id');
      expect(organizationId.columnType).toBe('PgUUID');
      expect(organizationId.notNull).toBe(true);
      expect(organizationId.hasDefault).toBe(false);

      const foreignKey = findForeignKeyByColumn(table, 'organization_id');

      if (foreignKey === undefined) {
        throw new Error(`${tableName}: нет FK по organization_id`);
      }

      const reference = foreignKey.reference();

      expect(getTableName(reference.foreignTable)).toBe('organizations');
      expect(reference.foreignColumns.map((column) => column.name)).toEqual(['id']);
      expect(foreignKey.onDelete).toBe('cascade');

      const organizationIndex = getTableConfig(table).indexes.find(
        (index) => index.config.name === `${tableName}_organization_id_idx`,
      );
      // Колонки индекса в Drizzle — `IndexedColumn | SQL`; имя есть только у
      // колонки, SQL-выражения (например, `lower(email)`) в этот индекс не
      // входят.
      const indexedColumnNames = (organizationIndex?.config.columns ?? []).flatMap(
        (column) =>
          'name' in column && typeof column.name === 'string' ? [column.name] : [],
      );

      expect(indexedColumnNames).toEqual(['organization_id']);
    }

    expectTypeOf<User['organizationId']>().toEqualTypeOf<string>();
    expectTypeOf<Workflow['organizationId']>().toEqualTypeOf<string>();
    expectTypeOf<NewWorkflow['organizationId']>().toEqualTypeOf<string>();
  });
});
