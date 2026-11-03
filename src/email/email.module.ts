import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';

/**
 * Модуль отправки email (v1.1.0 S1, DESIGN V110 § 3.1).
 *
 * Экспортирует `EmailService` для потребителей (сейчас — `OrgMembersModule`).
 * `ConfigModule` подключать не нужно: в `AppModule` он объявлен `@Global()`,
 * поэтому `ConfigService` доступен в любом провайдере.
 */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
