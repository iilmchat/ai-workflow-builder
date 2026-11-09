import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DbModule } from '../db/db.module.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { NotificationsController } from './notifications.controller.js';

/**
 * Модуль push-уведомлений (v1.5.0 S3, DESIGN V150 § 3 S3).
 *
 * Отдаёт HTTP-ручку `POST /notifications/register` и экспортирует
 * `DeviceTokensService` — его же будет использовать будущий сервис отправки
 * push (S5+), поэтому сервис не спрятан внутри модуля.
 *
 * `DbModule` — источник токена {@link DRIZZLE} (RULES 4.10): модуль `@Global`,
 * но импорт объявлен явно, чтобы зависимость сервиса была видна в графе.
 * `AuthModule` нужен ради `JwtAuthGuard`/`JwtModule` (проверка access-токена):
 * guard инжектит `JwtService` и `ConfigService`, которые экспортирует он.
 */
@Module({
  imports: [DbModule, AuthModule],
  controllers: [NotificationsController],
  providers: [DeviceTokensService],
  exports: [DeviceTokensService],
})
export class NotificationsModule {}
