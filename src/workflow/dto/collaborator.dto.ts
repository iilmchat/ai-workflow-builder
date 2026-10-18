import { z } from 'zod';
import {
  WORKFLOW_COLLABORATOR_ROLES,
  type WorkflowCollaboratorRole,
} from '../../db/schema.js';

/**
 * Роль в ответе со списком участников (KI-399).
 *
 * `owner` есть только в ответе: владелец не является строкой
 * `workflow_collaborators`, но UI должен нарисовать его в общем списке
 * (DESIGN v0.9 § 3.6 обещает «owner + participants»). В инвайте и смене роли
 * (`CollaboratorRoleSchema`) значение по-прежнему ограничено
 * `viewer`/`editor` — владельца назначить нельзя.
 */
export type WorkflowParticipantRole = 'owner' | WorkflowCollaboratorRole;

/**
 * Роль участника workflow, которую можно назначить через API (R7.6).
 *
 * Роль `owner` сюда не входит: владелец определяется по
 * `workflows.user_id`, а не строкой в `workflow_collaborators`, и через
 * инвайт не назначается (DESIGN v0.9 § 3.6).
 */
export const CollaboratorRoleSchema = z.enum(WORKFLOW_COLLABORATOR_ROLES);

/**
 * Тело `POST /workflow/:id/collaborators` — приглашение по uuid (R7.6).
 *
 * Инвайт **по id пользователя**, а не по email: email-нотификации вне scope
 * v0.9 (DESIGN v0.9 § 3.6). `z.uuid()` отсекает мусор до запроса в БД.
 */
export const InviteCollaboratorSchema = z.object({
  /** uuid приглашаемого пользователя. */
  userId: z.uuid('userId должен быть валидным UUID'),
  /** Роль: только чтение либо чтение + правка. */
  role: CollaboratorRoleSchema,
});

/** Валидированное тело приглашения участника. */
export type InviteCollaboratorDto = z.infer<typeof InviteCollaboratorSchema>;

/**
 * Тело `PATCH /workflow/:id/collaborators/:userId` — смена роли (R7.6).
 *
 * `userId` берётся из path, а не из body: так один и тот же DTO нельзя
 * использовать для подмены адресата.
 */
export const UpdateCollaboratorRoleSchema = z.object({
  /** Новая роль участника. */
  role: CollaboratorRoleSchema,
});

/** Валидированное тело смены роли участника. */
export type UpdateCollaboratorRoleDto = z.infer<typeof UpdateCollaboratorRoleSchema>;

/**
 * Участник workflow в ответах API (R7.6).
 *
 * `GET /workflow/:id/collaborators` отдаёт **владельца первой строкой** с
 * ролью `owner` (KI-399), остальные строки — обычные участники. Для владельца
 * `invitedAt` — дата создания workflow (он участвует с этого момента), а
 * `invitedBy` — его собственный uuid: отдельного «пригласившего» у него нет.
 *
 * `email` — необязательное поле: список строится JOIN'ом с `users`, и для
 * гипотетического пользователя без email (схема этого не запрещает) ответ
 * останется валидным. `invitedAt` — ISO-8601, как остальные даты API.
 */
export interface CollaboratorResponse {
  /** uuid участника (для владельца — `workflows.user_id`). */
  userId: string;
  /** Email участника (для отображения в списке). */
  email?: string;
  /** Роль: `owner` у владельца, иначе роль участия. */
  role: WorkflowParticipantRole;
  /** Дата приглашения (у владельца — дата создания workflow) в ISO-8601. */
  invitedAt: string;
  /** uuid пользователя, который пригласил (у владельца — он сам). */
  invitedBy: string;
}
