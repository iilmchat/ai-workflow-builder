import { z } from 'zod';
import { InvitableOrgRoleSchema, OrgRoleSchema } from '@/types/organization';
import { requestAsync } from './api';

// Реэкспорт зеркал ролей: единая точка импорта для UI и паритет-гейта.
export {
  InvitableOrgRoleSchema,
  OrgRoleSchema,
} from '@/types/organization';
export type { InvitableOrgRole, OrgRole } from '@/types/organization';

/**
 * Участник организации (`GET /admin/members`, v1.0.0 S5).
 *
 * Зеркало backend `OrganizationMemberSummary`; паритет состава полей проверяет
 * `api-contract.spec.ts` через `docs/development/api-contract.json`. Даты
 * приходят ISO-строками после сериализации `Date`.
 */
export const OrgMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: OrgRoleSchema,
  joinedAt: z.string(),
});

/** Участник организации в терминах API. */
export type OrgMember = z.infer<typeof OrgMemberSchema>;

/**
 * Ожидающее приглашение в организацию (`GET /admin/members`, v1.0.0 S5).
 *
 * Зеркало backend `OrganizationInvitationSummary`; `invitedBy` — uuid
 * пользователя, отправившего приглашение (UI показывает email только для
 * участников: пригласивший может уже не состоять в организации).
 */
export const OrgInvitationSchema = z.object({
  email: z.string(),
  role: InvitableOrgRoleSchema,
  invitedBy: z.string(),
  invitedAt: z.string(),
});

/** Ожидающее приглашение в терминах API. */
export type OrgInvitation = z.infer<typeof OrgInvitationSchema>;

/**
 * Ответ `POST /admin/members/invite` (v1.1.0 S1, DESIGN V110 § 3.1).
 *
 * Совпадает с {@link OrgInvitationSchema} и добавляет `emailSent` — признак
 * того, что SMTP принял письмо. `false` не означает ошибку: приглашение
 * создано в БД, но письмо не отправлено (SMTP не настроен или отказал) — UI
 * обязан показать это отличие, а не утверждать «письмо отправлено».
 */
export const InviteMemberResponseSchema = OrgInvitationSchema.extend({
  emailSent: z.boolean(),
});

/** Ответ `POST /admin/members/invite` в терминах API. */
export type InviteMemberResponse = z.infer<typeof InviteMemberResponseSchema>;

/**
 * Ответ `GET /admin/members` (v1.0.0 S5).
 *
 * `members` — принявшие приглашение пользователи организации; `invitations` —
 * ещё не зарегистрировавшиеся адреса. Обе секции UI показывает отдельно, чтобы
 * не смешивать действующих участников и приглашения.
 */
export const OrganizationMembersResponseSchema = z.object({
  members: z.array(OrgMemberSchema),
  invitations: z.array(OrgInvitationSchema),
});

/** Участники и приглашения организации в терминах API. */
export type OrganizationMembersResponse = z.infer<
  typeof OrganizationMembersResponseSchema
>;

/**
 * Тело приглашения `POST /admin/members/invite` (v1.0.0 S5).
 *
 * `owner` пригласить нельзя — домен роли тот же, что у
 * `OrganizationInvitationSummary.role`. Email проверяется локально в форме,
 * чтобы не отправлять заведомо неверное значение (backend всё равно
 * валидирует Zod'ом, RULES 1.17).
 */
export const InviteMemberPayloadSchema = z.object({
  email: z.email('Укажите корректный email'),
  role: InvitableOrgRoleSchema,
});

/** Валидированное тело приглашения участника организации. */
export type InviteMemberPayload = z.infer<typeof InviteMemberPayloadSchema>;

/**
 * Читает участников и ожидающие приглашения организации
 * (`GET /admin/members`, v1.0.0 S5).
 *
 * Ручка отдаёт `Cache-Control: no-store`: состав участников меняется без
 * перезагрузки страницы, поэтому кэшировать ответ нельзя.
 *
 * @returns участники организации и ожидающие приглашения
 * @throws ApiError при сетевой ошибке, 401/403 (нет доступа) или неожиданном
 *   формате ответа
 */
export async function fetchOrganizationMembersAsync(): Promise<OrganizationMembersResponse> {
  const data = await requestAsync<unknown>('/admin/members');

  return OrganizationMembersResponseSchema.parse(data);
}

/**
 * Приглашает пользователя в организацию (`POST /admin/members/invite`,
 * v1.0.0 S5; v1.1.0 S1 — письмо).
 *
 * Доступно владельцу и администратору: UI скрывает форму для остальных ролей.
 * Приглашённый станет участником организации с указанной ролью после
 * регистрации по этому email. Приглашение создаётся всегда, а `emailSent`
 * говорит, ушло ли письмо: при ненастроенном/недоступном SMTP бэкенд отвечает
 * 201 с `emailSent: false`, и UI не должен утверждать «письмо отправлено».
 *
 * @param payload - `{ email, role }`, проверенный формой
 * @returns созданное приглашение и признак отправки письма
 * @throws ApiError при 409 (email уже зарегистрирован или приглашение уже
 *   отправлено), 403 (нет прав) или сетевой ошибке
 */
export async function inviteMemberAsync(
  payload: InviteMemberPayload,
): Promise<InviteMemberResponse> {
  const data = await requestAsync<unknown>('/admin/members/invite', {
    method: 'POST',
    body: JSON.stringify(InviteMemberPayloadSchema.parse(payload)),
  });

  return InviteMemberResponseSchema.parse(data);
}
