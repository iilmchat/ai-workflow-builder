/**
 * Полезная нагрузка access-токена.
 *
 * `sub` — id пользователя (uuid) по RFC 7519. Refresh-токена нет: MVP R6.1a
 * выдаёт только access на 24 часа (упрощение зафиксировано в отчёте).
 */
export interface JwtPayload {
  /** id пользователя (uuid). */
  sub: string;
  /** Email пользователя — для UI и логов без второго запроса в БД. */
  email: string;
}
