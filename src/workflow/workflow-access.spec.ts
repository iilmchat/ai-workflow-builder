import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.js';
import {
  accessibleWorkflowIdsSubquery,
  workflowAccessFilter,
  workflowAccessListFilter,
  workflowAccessRoleExpression,
  workflowOwnerFilter,
} from './workflow-access.js';

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Соединение нужно только как фабрика Drizzle-билдеров: запросы рендерятся в
 * SQL и в БД не уходят (Pool без запросов соединение не открывает).
 */
const pool = new Pool({ connectionString: 'postgres://user:pass@127.0.0.1:1/none' });
const db = drizzle(pool, { schema });
const dialect = new PgDialect();

/**
 * Рендерит условие Drizzle в SQL и параметры.
 *
 * @param condition - SQL-условие
 * @returns текст SQL и значения параметров
 */
function render(condition: Parameters<PgDialect['sqlToQuery']>[0]) {
  return dialect.sqlToQuery(condition);
}

afterAll(async () => {
  await pool.end();
});

describe('workflow-access (R7.6)', () => {
  it('viewer: владелец OR любая строка участия, без условия по роли', () => {
    const query = render(workflowAccessFilter(db, WORKFLOW_ID, USER_ID, 'viewer'));

    expect(query.sql).toContain('"workflows"."user_id" =');
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('"workflow_collaborators"."user_id" =');
    // viewer проходит с любой ролью — conditions.push(role) не должен сработать.
    expect(query.sql).not.toContain('"workflow_collaborators"."role"');
    expect(query.params).toEqual([WORKFLOW_ID, USER_ID, USER_ID]);
  });

  it('editor: EXISTS требует роль editor', () => {
    const query = render(workflowAccessFilter(db, WORKFLOW_ID, USER_ID, 'editor'));

    expect(query.sql).toContain('"workflow_collaborators"."role" =');
    expect(query.params).toEqual([WORKFLOW_ID, USER_ID, USER_ID, 'editor']);
  });

  it('списочный фильтр не ограничивает по id, но учитывает владельца и участие (KI-398)', () => {
    const query = render(workflowAccessListFilter(db, USER_ID));

    // Список — не один workflow: условия `workflows.id = ...` быть не должно.
    expect(query.sql).not.toContain('"workflows"."id" =');
    expect(query.sql).toContain('"workflows"."user_id" =');
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('"workflow_collaborators"."user_id" =');
    expect(query.params).toEqual([USER_ID, USER_ID]);
  });

  it('проекция роли: owner для владельца, иначе роль участия (KI-398)', () => {
    const query = render(workflowAccessRoleExpression(USER_ID).getSQL());

    expect(query.sql.toLowerCase()).toContain('case');
    expect(query.sql).toContain("then 'owner'");
    // Роль участника берётся из workflow_collaborators по (workflow_id, user_id).
    expect(query.sql).toContain('"workflow_collaborators"."role"');
    expect(query.sql).toContain('"workflow_collaborators"."workflow_id" = "workflows"."id"');
    expect(query.sql).toContain('"workflow_collaborators"."user_id" =');
    expect(query.params).toEqual([USER_ID, USER_ID]);
  });

  it('owner-filter участников не учитывает', () => {
    const query = render(workflowOwnerFilter(WORKFLOW_ID, USER_ID));

    expect(query.sql).toContain('"workflows"."id" =');
    expect(query.sql).toContain('"workflows"."user_id" =');
    expect(query.sql).not.toContain('exists');
    expect(query.params).toEqual([WORKFLOW_ID, USER_ID]);
  });

  it('подзапрос доступных workflow учитывает участие (для runs)', () => {
    const subquery = accessibleWorkflowIdsSubquery(db, USER_ID) as unknown as {
      getSQL: () => Parameters<PgDialect['sqlToQuery']>[0];
    };
    const query = render(subquery.getSQL());

    expect(query.sql).toContain('from "workflows"');
    expect(query.sql).toContain('exists');
    expect(query.params).toEqual([USER_ID, USER_ID]);
  });
});
