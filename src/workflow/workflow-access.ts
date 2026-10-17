import { and, eq, exists, or, type SQL, type SQLWrapper } from 'drizzle-orm';
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
  const owner = eq(workflows.userId, userId);
  const collaborator = collaboratorExistsCondition(db, userId, minimumRole);

  // `and` возвращает `SQL | undefined` только из-за сигнатуры с optional-
  // аргументами; здесь оба аргумента заданы, поэтому fallback недостижим.
  return and(eq(workflows.id, workflowId), or(owner, collaborator)) ?? eq(workflows.id, workflowId);
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
