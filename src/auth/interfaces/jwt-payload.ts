/**
 * Полезная нагрузка access-токена.
 *
 * `sub` — id пользователя (uuid) по RFC 7519. Refresh-токена нет: MVP R6.1a
 * выдаёт только access на 24 часа (упрощение зафиксировано в отчёте).
 *
 * `orgId` — организация-арендатор (DESIGN_V100_ENTERPRISE § 3.1): guard
 * извлекает её из токена и кладёт в `request.user`. Поле обязательно, поэтому
 * старые JWT без `orgId` инвалидируются (DESIGN § 4) — после миграции на
 * organizations клиент обязан войти заново.
 */
export interface JwtPayload {
  /** id пользователя (uuid). */
  sub: string;
  /** Email пользователя — для UI и логов без второго запроса в БД. */
  email: string;
  /** id организации-арендатора (uuid, DESIGN § 3.1). */
  orgId: string;
}
