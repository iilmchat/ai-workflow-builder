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
  type WorkflowAccess,
} from './workflow-access.js';

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '55555555-5555-4555-8555-555555555555';

/** Контекст доступа: пользователь и его организация (v1.0 S2). */
const ACCESS: WorkflowAccess = { userId: USER_ID, orgId: ORG_ID };

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

describe('workflow-access (R7.6, v1.0 S2)', () => {
  it('viewer: владелец OR любая строка участия, без условия по роли; организация обязательна', () => {
    const query = render(workflowAccessFilter(db, WORKFLOW_ID, ACCESS, 'viewer'));

    expect(query.sql).toContain('"workflows"."user_id" =');
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('"workflow_collaborators"."user_id" =');
    // viewer проходит с любой ролью — conditions.push(role) не должен сработать.
    expect(query.sql).not.toContain('"workflow_collaborators"."role"');
    // v1.0 S2: изоляция арендатора — обязательное условие organization_id.
    expect(query.sql).toContain('"workflows"."organization_id" =');
    expect(query.params).toEqual([WORKFLOW_ID, ORG_ID, USER_ID, USER_ID]);
  });

  it('editor: EXISTS требует роль editor, организация остаётся в предикате', () => {
    const query = render(workflowAccessFilter(db, WORKFLOW_ID, ACCESS, 'editor'));

    expect(query.sql).toContain('"workflow_collaborators"."role" =');
    expect(query.sql).toContain('"workflows"."organization_id" =');
    expect(query.params).toEqual([WORKFLOW_ID, ORG_ID, USER_ID, USER_ID, 'editor']);
  });

  it('списочный фильтр не ограничивает по id, но учитывает владельца, участие и организацию (KI-398)', () => {
    const query = render(workflowAccessListFilter(db, ACCESS));

    // Список — не один workflow: условия `workflows.id = ...` быть не должно.
    expect(query.sql).not.toContain('"workflows"."id" =');
    expect(query.sql).toContain('"workflows"."user_id" =');
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('"workflow_collaborators"."user_id" =');
    // S2: список ограничен организацией арендатора.
    expect(query.sql).toContain('"workflows"."organization_id" =');
    expect(query.params).toEqual([ORG_ID, USER_ID, USER_ID]);
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

  it('owner-filter: владелец + организация, участники не учитываются', () => {
    const query = render(workflowOwnerFilter(WORKFLOW_ID, ACCESS));

    expect(query.sql).toContain('"workflows"."id" =');
    expect(query.sql).toContain('"workflows"."user_id" =');
    // S2: владеть графом можно только в своей организации.
    expect(query.sql).toContain('"workflows"."organization_id" =');
    expect(query.sql).not.toContain('exists');
    expect(query.params).toEqual([WORKFLOW_ID, USER_ID, ORG_ID]);
  });

  it('подзапрос доступных workflow учитывает участие и организацию (для runs)', () => {
    const subquery = accessibleWorkflowIdsSubquery(db, ACCESS) as unknown as {
      getSQL: () => Parameters<PgDialect['sqlToQuery']>[0];
    };
    const query = render(subquery.getSQL());

    expect(query.sql).toContain('from "workflows"');
    expect(query.sql).toContain('exists');
    // S2: подзапрос для runs тоже ограничен организацией арендатора.
    expect(query.sql).toContain('"workflows"."organization_id" =');
    expect(query.params).toEqual([ORG_ID, USER_ID, USER_ID]);
  });
});
