import { z } from 'zod';
import {
  CollaboratorSchema,
  InviteCollaboratorPayloadSchema,
  type Collaborator,
  type CollaboratorRole,
  type InviteCollaboratorPayload,
} from '@/types/collaborator';
import { requestAsync } from './api';

// Реэкспорт зеркал: единая точка импорта для UI и паритет-гейта
// (`api-contract.spec.ts` берёт `CollaboratorSchema` отсюда).
export { CollaboratorSchema, CollaboratorRoleSchema } from '@/types/collaborator';
export type { Collaborator, CollaboratorRole, InviteCollaboratorPayload } from '@/types/collaborator';

/**
 * Читает участников workflow (R7.6).
 *
 * Список доступен владельцу и любому участнику; изображение/роль приходят
 * готовыми с backend, поэтому UI не сравнивает id владельца с участниками.
 *
 * @param workflowId - uuid сохранённого workflow
 * @returns участники, отсортированные по дате приглашения
 * @throws ApiError при сетевой ошибке, не-2xx статусе (404 — нет доступа) или
 *   неожиданном формате ответа
 */
export async function fetchCollaboratorsAsync(
  workflowId: string,
): Promise<Collaborator[]> {
  const data = await requestAsync<unknown>(
    `/workflow/${encodeURIComponent(workflowId)}/collaborators`,
  );

  return z.array(CollaboratorSchema).parse(data);
}

/**
 * Приглашает участника по uuid (R7.6).
 *
 * Доступно только владельцу: backend отвечает 404 участнику с ролью `editor`
 * (DESIGN v0.9 § 3.6), поэтому UI скрывает форму для не-владельца.
 *
 * @param workflowId - uuid сохранённого workflow
 * @param payload - `{ userId, role }`, проверенный формой
 * @returns созданное участие
 * @throws ApiError при сетевой ошибке, не-2xx статусе (409 — уже участвует,
 *   404 — нет пользователя/доступа) или неожиданном формате ответа
 */
export async function inviteCollaboratorAsync(
  workflowId: string,
  payload: InviteCollaboratorPayload,
): Promise<Collaborator> {
  const data = await requestAsync<unknown>(
    `/workflow/${encodeURIComponent(workflowId)}/collaborators`,
    {
      method: 'POST',
      body: JSON.stringify(InviteCollaboratorPayloadSchema.parse(payload)),
    },
  );

  return CollaboratorSchema.parse(data);
}

/**
 * Меняет роль участника workflow (R7.6).
 *
 * @param workflowId - uuid сохранённого workflow
 * @param userId - uuid участника
 * @param role - новая роль (`viewer` | `editor`)
 * @returns обновлённое участие
 * @throws ApiError при сетевой ошибке, не-2xx статусе (404 — участник/доступ)
 *   или неожиданном формате ответа
 */
export async function updateCollaboratorRoleAsync(
  workflowId: string,
  userId: string,
  role: CollaboratorRole,
): Promise<Collaborator> {
  const data = await requestAsync<unknown>(
    `/workflow/${encodeURIComponent(workflowId)}/collaborators/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    },
  );

  return CollaboratorSchema.parse(data);
}

/**
 * Убирает участника из workflow (R7.6).
 *
 * @param workflowId - uuid сохранённого workflow
 * @param userId - uuid участника
 * @returns промис без значения
 * @throws ApiError при сетевой ошибке или не-2xx статусе (404 — участник/доступ)
 */
export async function removeCollaboratorAsync(
  workflowId: string,
  userId: string,
): Promise<void> {
  await requestAsync<null>(
    `/workflow/${encodeURIComponent(workflowId)}/collaborators/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}
