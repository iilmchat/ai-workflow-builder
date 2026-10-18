import { and, eq, exists, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { Database } from '../db/db.module.js';
import { workflowCollaborators, workflows } from '../db/schema.js';

/**
 * Минимальная роль, которой достаточно для доступа к workflow (R7.6).
 *
 * `viewer` — чтение; `editor` — чтение + правка графа + запуск. Владелец
 * проходит оба условия и проверяется отдельной веткой `workflows.user_id`.
 */
export type WorkflowAccessRole = 'viewer' | 'editor';

/**
 * Роль пользователя в workflow с учётом владельца (KI-398).
 *
 * В отличие от {@link WorkflowAccessRole} включает `owner`: в таблице
 * `workflow_collaborators` роли владельца нет (он определяется по
 * `workflows.user_id`), но в ответе `GET /workflow` клиенту нужна одна
 * величина, по которой UI решает, что показывать (KI-397).
 */
export type WorkflowAccessRoleWithOwner = 'owner' | WorkflowAccessRole;

/**
 * Коррелированное `EXISTS` по участнику workflow (R7.6).
 *
 * Подзапрос ссылается на внешнюю таблицу `workflows` (`workflows.id`), поэтому
 * его можно вставлять в любой `WHERE`, где есть `workflows` из основного
 * запроса, — без второго запроса в БД и без чтения роли в память. Условие по
 * роли добавляется только для `editor`: `viewer` проходит с любой ролью.
 *
 * @param db - соединение Drizzle
 * @param userId - uuid пользователя из access-токена
 * @param minimumRole - минимальная роль участника
 * @returns SQL-условие `EXISTS (...)`
 */
export function collaboratorExistsCondition(
  db: Database,
  userId: string,
  minimumRole: WorkflowAccessRole,
): SQL {
  const conditions = [
    eq(workflowCollaborators.workflowId, workflows.id),
    eq(workflowCollaborators.userId, userId),
  ];

  if (minimumRole === 'editor') {
    conditions.push(eq(workflowCollaborators.role, 'editor'));
  }

  const subquery = db
    .select({ workflowId: workflowCollaborators.workflowId })
    .from(workflowCollaborators)
    .where(and(...conditions));

  return exists(subquery);
}

/**
 * Собирает WHERE для доступа к workflow по id: владелец **или** участник с
 * достаточной ролью (R7.6).
 *
 * Заменяет прежний `eq(workflows.userId, userId)`: editor и viewer получают
 * доступ к чужому workflow, но с разными правами. Чужой и несуществующий
 * workflow по-прежнему неотличимы — оба дают пустую выборку (404, KI-202).
 *
 * @param db - соединение Drizzle
 * @param workflowId - uuid workflow
 * @param userId - uuid пользователя из access-токена
 * @param minimumRole - минимальная роль участника (по умолчанию `viewer`)
 * @returns условие для Drizzle
 */
export function workflowAccessFilter(
  db: Database,
  workflowId: string,
  userId: string,
  minimumRole: WorkflowAccessRole = 'viewer',
): SQL {
  // `and` возвращает `SQL | undefined` только из-за сигнатуры с optional-
  // аргументами; здесь оба аргумента заданы, поэтому fallback недостижим.
  return (
    and(eq(workflows.id, workflowId), workflowAccessListFilter(db, userId, minimumRole)) ??
    eq(workflows.id, workflowId)
  );
}

/**
 * WHERE «workflow, доступные пользователю» без привязки к конкретному id
 * (KI-398).
 *
 * Списочный вариант {@link workflowAccessFilter}: тот же предикат
 * «владелец **или** участник», но без `workflows.id = $1`. Нужен
 * `GET /workflow`, который раньше отдавал только собственные графы, из-за чего
 * collaborative-workflow были видны лишь по прямой ссылке.
 *
 * @param db - соединение Drizzle
 * @param userId - uuid пользователя из access-токена
 * @param minimumRole - минимальная роль участника (по умолчанию `viewer`)
 * @returns условие для Drizzle
 */
export function workflowAccessListFilter(
  db: Database,
  userId: string,
  minimumRole: WorkflowAccessRole = 'viewer',
): SQL {
  const owner = eq(workflows.userId, userId);
  const collaborator = collaboratorExistsCondition(db, userId, minimumRole);

  // `or` возвращает `SQL | undefined` только из-за optional-сигнатуры; оба
  // аргумента заданы, поэтому fallback недостижим.
  return or(owner, collaborator) ?? owner;
}

/**
 * Проекция роли пользователя для элемента списка workflow (KI-398).
 *
 * Один проход по БД вместо второго запроса «прочитать роли»: владелец получает
 * `owner`, участник — свою роль из `workflow_collaborators`
 * (`editor`/`viewer`). `LIMIT 1` страхует от дублей (в БД их не бывает —
 * составной PK `(workflow_id, user_id)`), но не меняет результат.
 *
 * Выражение коррелировано с `workflows` основного запроса, поэтому его можно
 * вставлять только в `SELECT`, где есть эта таблица.
 *
 * @param userId - uuid пользователя из access-токена
 * @returns SQL-выражение с алиасом `access_role`
 */
export function workflowAccessRoleExpression(
  userId: string,
): SQL.Aliased<WorkflowAccessRoleWithOwner> {
  return sql<WorkflowAccessRoleWithOwner>`
    case
      when ${workflows.userId} = ${userId} then 'owner'
      else (
        select ${workflowCollaborators.role}
        from ${workflowCollaborators}
        where ${workflowCollaborators.workflowId} = ${workflows.id}
          and ${workflowCollaborators.userId} = ${userId}
        limit 1
      )
    end
  `.as('access_role');
}

/**
 * WHERE только для владельца workflow (R7.6).
 *
 * Удаление workflow, share-ссылка и управление участниками остаются
 * исключительно у владельца: участник с ролью `editor` эти операции не
 * получает (DESIGN v0.9 § 3.6).
 *
 * @param workflowId - uuid workflow
 * @param userId - uuid пользователя из access-токена
 * @returns условие для Drizzle
 */
export function workflowOwnerFilter(workflowId: string, userId: string): SQL {
  return and(eq(workflows.id, workflowId), eq(workflows.userId, userId)) ?? eq(workflows.id, workflowId);
}

/**
 * Подзапрос «workflow, доступные пользователю» — владельцем или участником
 * (R7.6).
 *
 * Нужен там, где фильтр строится не по `workflows.id`, а по связанной таблице
 * (`workflow_runs.workflow_id`): запуск виден и участнику, который его
 * запустил, иначе SSE-поток editor'а отвечал бы 404.
 *
 * @param db - соединение Drizzle
 * @param userId - uuid пользователя из access-токена
 * @returns подзапрос `SELECT id FROM workflows WHERE ...` для `inArray`
 */
export function accessibleWorkflowIdsSubquery(db: Database, userId: string): SQLWrapper {
  const owner = eq(workflows.userId, userId);
  const collaborator = collaboratorExistsCondition(db, userId, 'viewer');

  return db
    .select({ id: workflows.id })
    .from(workflows)
    .where(or(owner, collaborator) ?? owner);
}
