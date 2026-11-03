import { z } from 'zod';

/**
 * Роли пользователя в организации (v1.0.0 S5, DESIGN V100 § 3.2).
 *
 * Зеркало backend-домена `OrgRole` (`src/organizations/dto/*`): состав и
 * порядок значений обязан совпадать — паритет проверяет
 * `api-contract.spec.ts` через `docs/development/api-contract.json`
 * (`UserPublic.role`, `OrganizationMemberSummary.role`).
 *
 * `owner` — владелец организации (единственный, кого нельзя изменить/удалить);
 * `admin` — управляет участниками и приглашениями, видит журнал аудита;
 * `member` — работает с workflow организации; `viewer` — только чтение.
 */
export const OrgRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);

/** Роль пользователя в организации. */
export type OrgRole = z.infer<typeof OrgRoleSchema>;

/**
 * Роли, которые можно указать в приглашении (v1.0.0 S5).
 *
 * `owner` в приглашении недоступен: владелец организации один и передаётся
 * отдельным сценарием (не в scope S5). Зеркало backend
 * `OrganizationInvitationSummary.role` — паритет проверяет
 * `api-contract.spec.ts`.
 */
export const InvitableOrgRoleSchema = z.enum(['admin', 'member', 'viewer']);

/** Роль, которую можно пригласить (без `owner`). */
export type InvitableOrgRole = z.infer<typeof InvitableOrgRoleSchema>;
