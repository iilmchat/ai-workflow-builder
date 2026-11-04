import type { Provider } from '@nestjs/common';
import { DEMO_ORG_ID } from '../../src/auth/auth.constants.js';
import { DRIZZLE, type Database } from '../../src/db/db.module.js';

/**
 * Строка `users`, которую `JwtAuthGuard` читает при проверке access-токена
 * (v1.1.0 S5, KI-601).
 *
 * В HTTP-спеках контроллеров нужен ровно один SELECT — `organization_id` и
 * `token_version` по `sub`. Полноценная БД им не нужна, поэтому helper отдаёт
 * «тогдабельную» цепочку Drizzle с фиксированной строкой.
 */
export interface JwtGuardUserRow {
  /** Организация, с которой должен совпасть `orgId` из токена. */
  organizationId: string;
  /** Версия токена, с которой должен совпасть `ver` из токена. */
  tokenVersion: number;
}

/**
 * Создаёт заглушку `DRIZZLE` для `JwtAuthGuard`.
 *
 * @param row - строка `users` (по умолчанию демо-организация, версия 0)
 *   либо `null`, если пользователя нет
 * @returns объект, совместимый с `Database` в объёме одного `select`
 */
export function createJwtAuthDbStub(
  row: JwtGuardUserRow | null = {
    organizationId: DEMO_ORG_ID,
    tokenVersion: 0,
  },
): Database {
  const rows = (): JwtGuardUserRow[] => (row === null ? [] : [row]);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    // Guard может дождаться цепочки на любом звене: объект «тогдабельный».
    // oxlint-disable-next-line unicorn/no-thenable
    then: (onFulfilled: (value: JwtGuardUserRow[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(rows()).then(onFulfilled, onRejected),
  };

  return { select: () => chain } as unknown as Database;
}

/**
 * Nest-провайдер `DRIZZLE` для HTTP-спеков с настоящим `JwtAuthGuard`.
 *
 * @param row - строка `users` для сверки токена (по умолчанию демо-пользователь)
 * @returns провайдер для `providers: [...]`
 */
export function jwtAuthDbProvider(
  row: JwtGuardUserRow | null = {
    organizationId: DEMO_ORG_ID,
    tokenVersion: 0,
  },
): Provider {
  return { provide: DRIZZLE, useValue: createJwtAuthDbStub(row) };
}
