import { z } from 'zod';
import {
  INVITABLE_USER_ROLES,
  type InvitableUserRole,
  type UserRole,
} from '../../db/schema.js';

/**
 * Участник организации в ответе `GET /admin/members` (v1.0.0 S5, KI-555).
 *
 * Отдельной таблицы членства нет: состав организации — это строки `users` с
 * общим `organization_id`, а роль лежит в `users.role`. `joinedAt` — дата
 * регистрации (`users.created_at`): момент, с которого пользователь состоит в
 * организации. Владелец тоже участник и присутствует в списке с ролью `owner`.
 */
export interface OrganizationMemberSummary {
  /** uuid пользователя (`users.id`). */
  userId: string;
  /** Email пользователя. */
  email: string;
  /** Роль в организации (`owner`/`admin`/`member`/`viewer`). */
  role: UserRole;
  /** Дата вступления в организацию (= `users.created_at`). */
  joinedAt: Date;
}

/**
 * Ожидающее приглашение в ответе `GET /admin/members` (v1.0.0 S5, KI-563).
 *
 * Приглашённый ещё не пользователь, поэтому вместо `userId` здесь `email`, а
 * роль ограничена назначаемыми (`admin`/`member`/`viewer`): `owner` через
 * инвайт не выдаётся.
 */
export interface OrganizationInvitationSummary {
  /** Email, на который выписано приглашение (нормализованный). */
  email: string;
  /** Роль, которая будет выдана при регистрации по этому email. */
  role: InvitableUserRole;
  /** uuid пользователя, отправившего приглашение. */
  invitedBy: string;
  /** Дата выписки приглашения (`organization_invitations.created_at`). */
  invitedAt: Date;
}

/**
 * Ответ `GET /admin/members` (v1.0.0 S5).
 *
 * Два независимых списка: действующие участники (по возрастанию даты вступления)
 * и ожидающие приглашения (сначала новые). UI команды рисует один экран из
 * этого ответа, не делая второй запрос.
 */
export interface OrganizationMembersResponse {
  /** Участники организации (`ORDER BY created_at ASC, id ASC`). */
  members: OrganizationMemberSummary[];
  /** Ожидающие приглашения (`ORDER BY created_at DESC, id DESC`). */
  invitations: OrganizationInvitationSummary[];
}

/**
 * Тело `POST /admin/members/invite` — приглашение в организацию по email
 * (v1.0.0 S5, KI-563).
 *
 * `email` нормализуется в сервисе (trim + lower case), потому что один и тот же
 * адрес может прийти в разном регистре. `role` — только из
 * {@link INVITABLE_USER_ROLES}: владельца через инвайт назначить нельзя.
 */
export const InviteMemberSchema = z.object({
  /** Email приглашаемого; приводится к нижнему регистру в сервисе. */
  email: z.email('некорректный email').max(320),
  /** Роль, которая будет выдана при регистрации по этому email. */
  role: z.enum(INVITABLE_USER_ROLES),
});

/** Валидированное тело приглашения в организацию. */
export type InviteMemberDto = z.infer<typeof InviteMemberSchema>;

/**
 * Ответ `POST /admin/members/invite` (v1.1.0 S1, DESIGN V110 § 3.1).
 *
 * Совпадает с {@link OrganizationInvitationSummary} и добавляет `emailSent` —
 * результат отправки письма. Приглашение создаётся **всегда** (fallback при
 * ненастроенном/недоступном SMTP, DESIGN § 3.1), поэтому 201 не означает
 * «письмо доставлено»; UI показывает «приглашение создано, но письмо не
 * отправлено», если `emailSent === false`.
 *
 * Интерфейс объявлен «плоским», без `extends`: backend-гейт
 * `api-contract.spec.ts` читает поля интерфейса компилятором TypeScript и
 * наследование не разворачивает (KI-352).
 */
export interface InviteMemberResponse {
  /** Email, на который выписано приглашение (нормализованный). */
  email: string;
  /** Роль, которая будет выдана при регистрации по этому email. */
  role: InvitableUserRole;
  /** uuid пользователя, отправившего приглашение. */
  invitedBy: string;
  /** Дата выписки приглашения (`organization_invitations.created_at`). */
  invitedAt: Date;
  /** `true`, если SMTP принял письмо; `false` — создано только в БД. */
  emailSent: boolean;
}

/**
 * Параметр пути `/admin/members/:userId` (v1.1.0 S2).
 *
 * `userId` валидируется как uuid на границе HTTP: мусорный id — 400 от
 * `ZodValidationPipe`, а не 500 из драйвера БД (RULES 1.17).
 */
export const MemberParamSchema = z.object({
  /** uuid участника организации (строка `users.id`). */
  userId: z.uuid('Некорректный uuid участника'),
});

/** Валидированные параметры пути участника. */
export type MemberParamDto = z.infer<typeof MemberParamSchema>;

/**
 * Тело `PATCH /admin/members/:userId` — смена роли участника (v1.1.0 S2,
 * DESIGN V110 § 3.2).
 *
 * `owner` недоступен: владелец — создатель организации, и смена роли не должна
 * ни назначать второго владельца, ни разжаловать существующего. Домен — тот же
 * {@link INVITABLE_USER_ROLES}, что у приглашения: назначить можно ровно те
 * роли, которые можно выдать инвайтом.
 */
export const UpdateMemberRoleSchema = z.object({
  /** Новая роль участника (`admin`/`member`/`viewer`). */
  role: z.enum(INVITABLE_USER_ROLES),
});

/** Валидированное тело смены роли участника. */
export type UpdateMemberRoleDto = z.infer<typeof UpdateMemberRoleSchema>;
