import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  deviceTokens,
  users,
  type DeviceTokenPlatform,
} from '../db/schema.js';

/**
 * Сервис push-токенов устройств (v1.5.0 S3, DESIGN V150 § 3 S3).
 *
 * Токен FCM/APNs уникален глобально и может «переехать» между аккаунтами: одно
 * устройство вышло из одного пользователя и вошло другим. Поэтому регистрация —
 * UPSERT по `token`: `INSERT ... ON CONFLICT (token) DO UPDATE SET user_id,
 * organization_id`. Строка не задваивается, а меняет владельца; `platform` и
 * `created_at` при конфликте остаются прежними (платформа устройства не
 * меняется, дата первой регистрации — история).
 *
 * **Организация — из БД, а не из токена (KI-554).** На вход сервис получает
 * только `userId` (`sub` access-токена), а `organization_id` читает из строки
 * `users` отдельным SELECT'ом. Устаревший `orgId` в access-токене не должен
 * привязывать токен устройства к чужому арендатору; та же конвенция, что в
 * `OrgMembersService`. Запись `organization_id` денормализована: будущая
 * отправка push выбирает токены по арендатору.
 */
@Injectable()
export class DeviceTokensService {
  /**
   * @param db - соединение Drizzle (инъекция по токену {@link DRIZZLE})
   */
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Возвращает организацию пользователя по строке `users` (KI-554).
   *
   * Один SELECT — источников правды два (JWT и БД) быть не должно: значение
   * `orgId` из access-токена живёт до 24 часов и после переезда пользователя в
   * другую организацию устарело бы.
   *
   * @param userId - `sub` access-токена (id пользователя)
   * @returns uuid организации из `users.organization_id`
   * @throws UnauthorizedException если строки `users` нет (пользователь удалён)
   */
  async resolveOrganizationIdAsync(userId: string): Promise<string> {
    const [row] = await this.db
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (row === undefined) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return row.organizationId;
  }

  /**
   * Регистрирует push-токен устройства (UPSERT по `token`).
   *
   * Повторная регистрация того же токена не создаёт вторую строку: конфликт по
   * UNIQUE `device_tokens_token_unique` разрешается обновлением владельца
   * (`user_id`) и арендатора (`organization_id`). Остальные поля не трогаются —
   * см. JSDoc класса. Токен и платформа уже валидированы
   * `RegisterDeviceTokenSchema` на границе HTTP (RULES 1.17), повторный
   * `parse` внутри сервиса не нужен.
   *
   * @param userId - id пользователя (владелец токена)
   * @param organizationId - uuid организации из БД (см. {@link resolveOrganizationIdAsync})
   * @param token - push-токен устройства (FCM/APNs/web-push)
   * @param platform - платформа устройства (`android`/`ios`/`web`)
   * @returns промис без значения: контроллер отвечает `{ ok: true }`
   * @throws Error если запрос к БД не выполнился (ошибка драйвера пробрасывается)
   */
  async upsertAsync(
    userId: string,
    organizationId: string,
    token: string,
    platform: DeviceTokenPlatform,
  ): Promise<void> {
    await this.db
      .insert(deviceTokens)
      .values({ userId, organizationId, token, platform })
      // Токен — естественный ключ UPSERT'а: устройство могло войти другим
      // аккаунтом, тогда строка переезжает к новому владельцу.
      .onConflictDoUpdate({
        target: deviceTokens.token,
        set: { userId, organizationId },
      });
  }
}
