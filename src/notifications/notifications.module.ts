import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DbModule } from '../db/db.module.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { NotificationsController } from './notifications.controller.js';
import { RuStorePushService } from './rustore-push.service.js';

/**
 * Модуль push-уведомлений (v1.5.0 S3, DESIGN V150 § 3 S3; отправка — S4-B).
 *
 * Отдаёт HTTP-ручку `POST /notifications/register` и экспортирует
 * `DeviceTokensService` (регистрация/UPSERT токенов и `sendToUserAsync`) и
 * `RuStorePushService` (низкоуровневая отправка через RuStore API): сервис
 * отправки не спрятан внутри модуля, чтобы будущие потребители (события
 * организации, воркеры) инжектили его напрямую.
 *
 * `DbModule` — источник токена {@link DRIZZLE} (RULES 4.10): модуль `@Global`,
 * но импорт объявлен явно, чтобы зависимость сервиса была видна в графе.
 * `AuthModule` нужен ради `JwtAuthGuard`/`JwtModule` (проверка access-токена):
 * guard инжектит `JwtService` и `ConfigService`, которые экспортирует он.
 * `ConfigService` для `RuStorePushService` приходит из глобального
 * `ConfigModule` (`app.module.ts`), отдельный импорт не нужен.
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [NotificationsController],
  providers: [DeviceTokensService, RuStorePushService],
  exports: [DeviceTokensService, RuStorePushService],
})
export class NotificationsModule {}
