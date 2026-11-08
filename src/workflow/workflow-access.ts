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
 * Контекст доступа к workflow: пользователь и его организация-арендатор
 * (v1.0.0 S2, DESIGN V100 § 3.1).
 *
 * Введён вместо пары строк `(userId, orgId)` в сигнатурах сервисов: забыть
 * `orgId` при вызове структурно невозможно, а все предикаты доступа получают
 * один объект. `orgId` обязателен — изоляция арендаторов (S2) применяется во
 * **всех** выборках workflow, кроме публичной share-ссылки (доступ по токену).
 */
export interface WorkflowAccess {
  /** uuid пользователя из access-токена (`JwtPayload.sub`). */
  readonly userId: string;
  /** uuid организации-арендатора из access-токена (`JwtPayload.orgId`). */
  readonly orgId: string;
}

/**
 * Собирает {@link WorkflowAccess} из payload access-токена.
 *
 * Принимает структурный минимум (`sub` + `orgId`), поэтому не тянет
 * `JwtPayload` в модуль доступа к БД.
 *
 * @param user - payload access-токена (`@CurrentUser()`)
 * @returns контекст доступа для сервисов workflow/runs/documents
 */
export function toWorkflowAccess(user: {
  readonly sub: string;
  readonly orgId: string;
}): WorkflowAccess {
  return { userId: user.sub, orgId: user.orgId };
}


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
 * достаточной ролью (R7.6) **и** workflow принадлежит организации арендатора
 * (v1.0.0 S2, DESIGN V100 § 3.1).
 *
 * Заменяет прежний `eq(workflows.userId, userId)`: editor и viewer получают
 * доступ к чужому workflow, но с разными правами. Чужой и несуществующий
 * workflow по-прежнему неотличимы — оба дают пустую выборку (404, KI-202).
 *
 * S2: `workflows.organization_id = access.orgId` — обязательное условие
 * изоляции. Даже участник, чья строка `workflow_collaborators` осталась от
 * версии до мультитенантности, не получит доступ к workflow другой организации.
 *
 * @param db - соединение Drizzle
 * @param workflowId - uuid workflow
 * @param access - пользователь и его организация из access-токена
 * @param minimumRole - минимальная роль участника (по умолчанию `viewer`)
 * @returns условие для Drizzle
 */
export function workflowAccessFilter(
  db: Database,
  workflowId: string,
  access: WorkflowAccess,
  minimumRole: WorkflowAccessRole = 'viewer',
): SQL {
  // `and` возвращает `SQL | undefined` только из-за сигнатуры с optional-
  // аргументами; здесь оба аргумента заданы, поэтому fallback недостижим.
  return (
    and(eq(workflows.id, workflowId), workflowAccessListFilter(db, access, minimumRole)) ??
    eq(workflows.id, workflowId)
  );
}

/**
 * WHERE «workflow, доступные пользователю» без привязки к конкретному id
 * (KI-398; изоляция арендатора — v1.0.0 S2).
 *
 * Списочный вариант {@link workflowAccessFilter}: тот же предикат
 * «владелец **или** участник», но без `workflows.id = $1`, плюс обязательное
 * `organization_id = access.orgId`. Нужен `GET /workflow`: пользователь видит
 * только графы своей организации, к которым у него есть доступ.
 *
 * @param db - соединение Drizzle
 * @param access - пользователь и его организация из access-токена
 * @param minimumRole - минимальная роль участника (по умолчанию `viewer`)
 * @returns условие для Drizzle
 */
export function workflowAccessListFilter(
  db: Database,
  access: WorkflowAccess,
  minimumRole: WorkflowAccessRole = 'viewer',
): SQL {
  const tenant = eq(workflows.organizationId, access.orgId);
  const owner = eq(workflows.userId, access.userId);
  const collaborator = collaboratorExistsCondition(db, access.userId, minimumRole);

  // `or`/`and` возвращают `SQL | undefined` только из-за optional-сигнатуры;
  // здесь все аргументы заданы, поэтому fallback недостижим.
  return and(tenant, or(owner, collaborator) ?? owner) ?? tenant;
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
 * WHERE только для владельца workflow (R7.6) **и** его организации
 * (v1.0.0 S2).
 *
 * Удаление workflow, share-ссылка и управление участниками остаются
 * исключительно у владельца: участник с ролью `editor` эти операции не
 * получает (DESIGN v0.9 § 3.6). `organization_id = access.orgId` — страховка
 * изоляции арендаторов: чужой организации операция не видна.
 *
 * @param workflowId - uuid workflow
 * @param access - пользователь и его организация из access-токена
 * @returns условие для Drizzle
 */
export function workflowOwnerFilter(
  workflowId: string,
  access: WorkflowAccess,
): SQL {
  return (
    and(
      eq(workflows.id, workflowId),
      eq(workflows.userId, access.userId),
      eq(workflows.organizationId, access.orgId),
    ) ?? eq(workflows.id, workflowId)
  );
}

/**
 * Подзапрос «workflow, доступные пользователю» — владельцем или участником
 * (R7.6), только в рамках его организации (v1.0.0 S2).
 *
 * Нужен там, где фильтр строится не по `workflows.id`, а по связанной таблице
 * (`workflow_runs.workflow_id`): запуск виден и участнику, который его
 * запустил, иначе SSE-поток editor'а отвечал бы 404. Условие по
 * `organization_id` не даёт получить запуск workflow другой организации даже
 * при знании его uuid.
 *
 * `minimumRole` (v1.4.0 S1): отмена запуска — право `editor`, поэтому
 * `RunsService.cancelRunAsync` запрашивает подзапрос с этой ролью; для чтения
 * запусков/SSE остаётся дефолтный `viewer`.
 *
 * @param db - соединение Drizzle
 * @param access - пользователь и его организация из access-токена
 * @param minimumRole - минимальная роль участника (по умолчанию `viewer`)
 * @returns подзапрос `SELECT id FROM workflows WHERE ...` для `inArray`
 */
export function accessibleWorkflowIdsSubquery(
  db: Database,
  access: WorkflowAccess,
  minimumRole: WorkflowAccessRole = 'viewer',
): SQLWrapper {
  const tenant = eq(workflows.organizationId, access.orgId);
  const owner = eq(workflows.userId, access.userId);
  const collaborator = collaboratorExistsCondition(
    db,
    access.userId,
    minimumRole,
  );

  return db
    .select({ id: workflows.id })
    .from(workflows)
    .where(and(tenant, or(owner, collaborator) ?? owner) ?? tenant);
}
