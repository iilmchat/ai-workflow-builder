import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  deviceTokens,
  users,
  type DeviceTokenPlatform,
} from '../db/schema.js';
import { RuStorePushService } from './rustore-push.service.js';

/**
 * Сервис push-токенов устройств (v1.5.0 S3, DESIGN V150 § 3 S3).
 *
 * Токен провайдера (RuStore/APNs) уникален глобально и может «переехать» между аккаунтами: одно
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
 * `OrgMembersService`. Запись `organization_id` денормализована: отправка push
 * выбирает токены по арендатору.
 *
 * **Отправка (S4-B).** `sendToUserAsync` — первый потребитель
 * `RuStorePushService`: выбирает android-токены пользователя и отправляет push
 * через RuStore API. Сбой отправки не пробрасывается: один отказ устройства не
 * должен отменять доставку остальным (RULES 4.16).
 */
@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  /**
   * @param db - соединение Drizzle (инъекция по токену {@link DRIZZLE})
   * @param ruStorePush - отправка push через RuStore API (S4-B)
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ruStorePush: RuStorePushService,
  ) {}

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
   * @param token - push-токен устройства (RuStore/APNs/web-push)
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

  /**
   * Отправляет push-уведомление на все android-токены пользователя (S4-B).
   *
   * RuStore Push — только Android, поэтому выбираются строки `device_tokens` с
   * `platform = 'android'`: iOS/web идут через свои каналы (APNs/web-push) и
   * здесь не участвуют. Один токен — один запрос
   * ({@link RuStorePushService.sendAsync}), запросы выполняются параллельно
   * (`Promise.allSettled`, RULES 4.16): отказ одного устройства не отменяет
   * доставку остальным и не роняет вызывающий код.
   *
   * **Fallback обязателен.** Если RuStore не настроен
   * (`isConfigured() === false`), метод пишет WARN и возвращает 0, не обращаясь
   * ни к БД, ни к API — вызывающий код (например, уведомление о событии) не
   * должен падать из-за отсутствия операторской настройки. Токен устройства и
   * сервисный токен в лог не попадают (RULES 5.3, 5.9): в WARN — только
   * количество доставленных и текст ошибки.
   *
   * @param userId - id пользователя (владелец токенов)
   * @param title - заголовок уведомления
   * @param body - текст уведомления
   * @param data - дополнительные data-поля (см.
   *   {@link RuStorePushService.sendAsync})
   * @returns число android-токенов, на которые push доставлен (HTTP 200);
   *   `0` — токенов нет, RuStore не настроен или все отправки упали
   * @throws Error если SELECT по `device_tokens` не выполнился (ошибка
   *   драйвера пробрасывается); ошибки самой отправки не пробрасываются
   */
  async sendToUserAsync(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<number> {
    if (!this.ruStorePush.isConfigured()) {
      this.logger.warn(
        'RuStore Push не настроен (RUSTORE_PROJECT_ID/RUSTORE_SERVICE_TOKEN): уведомление не отправлено',
      );

      return 0;
    }

    const tokens = await this.db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(
        and(
          eq(deviceTokens.userId, userId),
          eq(deviceTokens.platform, 'android'),
        ),
      );

    if (tokens.length === 0) {
      return 0;
    }

    const results = await Promise.allSettled(
      tokens.map(({ token }) =>
        this.ruStorePush.sendAsync(token, title, body, data),
      ),
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected',
    );
    const delivered = results.length - failures.length;

    if (failures.length > 0) {
      const firstReason = failures[0]?.reason;

      // Токен не логируем даже частично: в WARN — только количества и причина
      // (RULES 5.3, 5.9).
      this.logger.warn(
        `RuStore Push: доставлено ${delivered} из ${results.length}: ${
          firstReason instanceof Error
            ? firstReason.message
            : 'неизвестная ошибка отправки'
        }`,
      );
    }

    return delivered;
  }
}
