import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTimestamp, type PgTable } from 'drizzle-orm/pg-core';
import { expectTypeOf } from 'vitest';
import type { EdgeDto, GraphSnapshotDto, NodeDto } from '../engine/dto/index.js';
import {
  EMAIL_OUTBOX_STATUSES,
  NODE_RUN_STATUSES,
  TERMINAL_WORKFLOW_RUN_STATUSES,
  USER_ROLES,
  WORKFLOW_RUN_STATUSES,
  auditLogs,
  emailOutbox,
  nodeRuns,
  organizations,
  users,
  workflowRuns,
  workflows,
  type AuditLog,
  type EmailOutboxRow,
  type EmailOutboxStatus,
  type NewAuditLog,
  type NewOrganization,
  type NewUser,
  type NewWorkflow,
  type NodeRun,
  type NodeRunStatus,
  type Organization,
  type RunStatus,
  type User,
  type UserRole,
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
    expect(TERMINAL_WORKFLOW_RUN_STATUSES).toEqual([
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(WORKFLOW_RUN_STATUSES).toEqual(
      expect.arrayContaining([...TERMINAL_WORKFLOW_RUN_STATUSES]),
    );
    expectTypeOf<(typeof TERMINAL_WORKFLOW_RUN_STATUSES)[number]>().toEqualTypeOf<
      'completed' | 'failed' | 'cancelled'
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

/**
 * Роли пользователей и журнал аудита (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Живая БД не нужна — проверяются метаданные таблиц и выведенные TS-типы.
 * CHECK на `users.role` и FK `audit_logs` дублируют правила уровня сервиса:
 * Zod валидирует только вход API, а прямые записи ограничивает БД (RULES 1.17).
 */
describe('Роли и журнал аудита (v1.0.0 S3)', () => {
  it('users.role: text NOT NULL DEFAULT member и CHECK users_role_check', () => {
    const columns = getTableColumns(users);
    const role = columns.role;

    expect(role.name).toBe('role');
    expect(role.columnType).toBe('PgText');
    expect(role.notNull).toBe(true);
    expect(role.hasDefault).toBe(true);
    // DEFAULT — безопасный дефолт для будущих участников (S5); создатель
    // личной организации пишется явно с ролью `owner`.
    expect(role.default).toBe('member');

    const roleCheck = getTableConfig(users).checks.find(
      (check) => check.name === 'users_role_check',
    );

    expect(roleCheck).toBeDefined();
    expect(roleCheck?.value).toBeDefined();

    expect(USER_ROLES).toEqual(['owner', 'admin', 'member', 'viewer']);
    expectTypeOf<UserRole>().toEqualTypeOf<
      'owner' | 'admin' | 'member' | 'viewer'
    >();
    expectTypeOf<User['role']>().toEqualTypeOf<UserRole>();
    // Поле необязательно при INSERT: DEFAULT `member` заполняет его сам.
    expectTypeOf<NewUser['role']>().toEqualTypeOf<UserRole | undefined>();
  });

  it('audit_logs: 7 колонок, PK, FK с CASCADE и index под keyset-пагинацию', () => {
    expect(getTableName(auditLogs)).toBe('audit_logs');

    const columns = getTableColumns(auditLogs);

    expect(Object.keys(columns)).toHaveLength(7);

    expect(columns.id.name).toBe('id');
    expect(columns.id.columnType).toBe('PgUUID');
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);

    expect(columns.createdAt.name).toBe('created_at');
    expect(columns.createdAt.columnType).toBe('PgTimestamp');
    expect(
      is(columns.createdAt, PgTimestamp) && columns.createdAt.withTimezone,
    ).toBe(true);
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);

    const userIdForeignKey = findForeignKeyByColumn(auditLogs, 'user_id');

    expect(columns.userId.name).toBe('user_id');
    expect(columns.userId.columnType).toBe('PgUUID');
    expect(columns.userId.notNull).toBe(true);
    expect(columns.userId.hasDefault).toBe(false);

    if (userIdForeignKey === undefined) {
      throw new Error('audit_logs: нет FK по user_id');
    }

    expect(getTableName(userIdForeignKey.reference().foreignTable)).toBe('users');
    expect(
      userIdForeignKey.reference().foreignColumns.map((column) => column.name),
    ).toEqual(['id']);
    expect(userIdForeignKey.onDelete).toBe('cascade');

    const organizationIdForeignKey = findForeignKeyByColumn(
      auditLogs,
      'organization_id',
    );

    expect(columns.organizationId.name).toBe('organization_id');
    expect(columns.organizationId.columnType).toBe('PgUUID');
    expect(columns.organizationId.notNull).toBe(true);
    expect(columns.organizationId.hasDefault).toBe(false);

    if (organizationIdForeignKey === undefined) {
      throw new Error('audit_logs: нет FK по organization_id');
    }

    expect(
      getTableName(organizationIdForeignKey.reference().foreignTable),
    ).toBe('organizations');
    expect(
      organizationIdForeignKey
        .reference()
        .foreignColumns.map((column) => column.name),
    ).toEqual(['id']);
    expect(organizationIdForeignKey.onDelete).toBe('cascade');

    expect(columns.action.name).toBe('action');
    expect(columns.action.columnType).toBe('PgText');
    expect(columns.action.notNull).toBe(true);
    expect(columns.action.hasDefault).toBe(false);

    // resource_id nullable: id объекта известен не для каждого действия.
    expect(columns.resourceId.name).toBe('resource_id');
    expect(columns.resourceId.columnType).toBe('PgUUID');
    expect(columns.resourceId.notNull).toBe(false);
    expect(columns.resourceId.hasDefault).toBe(false);

    expect(columns.metadata.name).toBe('metadata');
    expect(columns.metadata.columnType).toBe('PgJsonb');
    expect(columns.metadata.notNull).toBe(true);
    expect(columns.metadata.hasDefault).toBe(true);
    expect(columns.metadata.default).toEqual({});

    const auditIndex = getTableConfig(auditLogs).indexes.find(
      (index) => index.config.name === 'audit_logs_org_created_id_idx',
    );

    expect(auditIndex).toBeDefined();
    // Колонки индекса в Drizzle — `IndexedColumn | SQL`; SQL-выражений здесь
    // нет, поэтому имена собираются без потерь.
    const indexedColumnNames = (auditIndex?.config.columns ?? []).flatMap(
      (column) =>
        'name' in column && typeof column.name === 'string' ? [column.name] : [],
    );

    expect(indexedColumnNames).toEqual(['organization_id', 'created_at', 'id']);

    expectTypeOf<AuditLog['createdAt']>().toEqualTypeOf<Date>();
    expectTypeOf<AuditLog['resourceId']>().toEqualTypeOf<string | null>();
    expectTypeOf<AuditLog['metadata']>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<NewAuditLog['action']>().toEqualTypeOf<string>();
  });

  it('KI-623: email_outbox хранит payload письма и статус доставки', () => {
    const columns = getTableColumns(emailOutbox);

    expect(getTableName(emailOutbox)).toBe('email_outbox');
    expect(EMAIL_OUTBOX_STATUSES).toEqual(['pending', 'sent', 'failed']);

    expect(columns.id.name).toBe('id');
    expect(columns.id.columnType).toBe('PgUUID');
    expect(columns.id.hasDefault).toBe(true);

    // PII и ссылка-приглашение — в БД, а не в Redis (KI-623).
    for (const column of [columns.to, columns.orgName, columns.inviteLink]) {
      expect(column.columnType).toBe('PgText');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    }

    expect(columns.to.name).toBe('to');
    expect(columns.orgName.name).toBe('org_name');
    expect(columns.inviteLink.name).toBe('invite_link');

    // Новая строка — pending, попыток ещё не было.
    expect(columns.status.name).toBe('status');
    expect(columns.status.notNull).toBe(true);
    expect(columns.status.hasDefault).toBe(true);
    expect(columns.status.default).toBe('pending');
    expect(columns.attempts.name).toBe('attempts');
    expect(columns.attempts.columnType).toBe('PgInteger');
    expect(columns.attempts.notNull).toBe(true);
    expect(columns.attempts.default).toBe(0);

    expect(columns.createdAt.name).toBe('created_at');
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);

    expectTypeOf<EmailOutboxStatus>().toEqualTypeOf<
      'pending' | 'sent' | 'failed'
    >();
    expectTypeOf<EmailOutboxRow['status']>().toEqualTypeOf<EmailOutboxStatus>();
    expectTypeOf<EmailOutboxRow['attempts']>().toEqualTypeOf<number>();
    expectTypeOf<EmailOutboxRow['createdAt']>().toEqualTypeOf<Date>();
  });
});
