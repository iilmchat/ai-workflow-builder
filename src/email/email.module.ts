import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailProcessor } from './email.processor.js';
import { EmailOutboxService } from './email-outbox.service.js';
import {
  createEmailQueueOptions,
  EMAIL_INVITATIONS_QUEUE,
} from './email.queue.js';
import { EmailService } from './email.service.js';

/**
 * Модуль отправки email (v1.1.0 S1, DESIGN V110 § 3.1; очередь — v1.2.0 S2).
 *
 * Экспортирует `EmailService` для потребителей (сейчас — `OrgMembersModule`).
 * `ConfigModule` подключать не нужно: в `AppModule` он объявлен `@Global()`,
 * поэтому `ConfigService` доступен в любом провайдере.
 *
 * С S2 модуль регистрирует очередь BullMQ `email-invitations` и воркер
 * `EmailProcessor`: `EmailService.queueInvitationAsync` ставит задание,
 * воркер выполняет реальный SMTP-вызов. `BullModule.forRootAsync` объявлен в
 * `AppModule` и глобален, поэтому здесь достаточно `registerQueueAsync`.
 *
 * С v1.4.0 S3 (KI-623) в модуле также живёт `EmailOutboxService`: payload
 * письма хранится в таблице `email_outbox`, а в Redis уходит только его id.
 */
@Module({
  imports: [
    BullModule.registerQueueAsync({
      name: EMAIL_INVITATIONS_QUEUE,
      inject: [ConfigService],
      // Асинхронно, потому что REDIS_URL/BULLMQ_PREFIX читаются из DI.
      useFactory: createEmailQueueOptions,
    }),
  ],
  providers: [EmailService, EmailOutboxService, EmailProcessor],
  exports: [EmailService],
})
export class EmailModule {}
