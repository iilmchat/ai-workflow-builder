import { z } from 'zod';

/**
 * Роли участника workflow (R7.6, DESIGN v0.9 § 3.6) — зеркало backend
 * `WORKFLOW_COLLABORATOR_ROLES`.
 *
 * `viewer` — только чтение; `editor` — чтение + правка графа + запуск.
 * Владелец в этом списке отсутствует: он задаётся полем `workflows.user_id`,
 * а не строкой участия.
 */
export const CollaboratorRoleSchema = z.enum(['viewer', 'editor']);

/** Роль участника workflow. */
export type CollaboratorRole = z.infer<typeof CollaboratorRoleSchema>;

/**
 * Участник workflow — зеркало backend `CollaboratorResponse` (R7.6).
 *
 * `email` необязателен, потому что backend собирает его JOIN'ом и оставляет
 * поле пустым, если у пользователя его нет. Состав полей сверяет
 * `api-contract.spec.ts` через `docs/development/api-contract.json`.
 */
export const CollaboratorSchema = z.object({
  userId: z.uuid(),
  email: z.string().optional(),
  role: CollaboratorRoleSchema,
  invitedAt: z.string(),
  invitedBy: z.uuid(),
});

/** Участник workflow. */
export type Collaborator = z.infer<typeof CollaboratorSchema>;

/**
 * Тело приглашения `POST /workflow/:id/collaborators` (R7.6).
 *
 * Инвайт — по uuid пользователя (email-нотификации вне scope v0.9). Форма
 * валидирует ввод локально, чтобы не отправлять заведомо неверный uuid.
 */
export const InviteCollaboratorPayloadSchema = z.object({
  userId: z.uuid('Укажите корректный UUID пользователя'),
  role: CollaboratorRoleSchema,
});

/** Валидированное тело приглашения. */
export type InviteCollaboratorPayload = z.infer<typeof InviteCollaboratorPayloadSchema>;
