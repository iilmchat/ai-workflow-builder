import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import type { EmailOutboxRow } from '../db/schema.js';
import { EmailOutboxService } from './email-outbox.service.js';
import {
  EMAIL_INVITATIONS_QUEUE,
  EmailInvitationJobSchema,
  EmailInvitationPayloadSchema,
  type EmailInvitationJobData,
} from './email.queue.js';
import { EmailService } from './email.service.js';

/**
 * Воркер очереди писем-приглашений (v1.2.0 S2, DESIGN V120 § 3.3; outbox —
 * v1.4.0 S3, KI-623).
 *
 * Забирает задания `send-invitation` из {@link EMAIL_INVITATIONS_QUEUE},
 * читает payload из `email_outbox` по `outboxId` и вызывает
 * `EmailService.sendInvitationAsync` — единственное место, где выполняется
 * реальный SMTP-вызов. В Redis нет PII: email, название организации и
 * ссылка-приглашение лежат в БД.
 *
 * Очередь даёт то, чего не было в v1.1.0: HTTP-запрос приглашения не ждёт
 * SMTP, а сбой отправки не теряет письмо — BullMQ повторяет job по
 * `EMAIL_INVITATION_JOB_OPTIONS` (3 попытки, exponential backoff 5 с).
 *
 * **Ошибка → throw.** `sendInvitationAsync` не бросает, а возвращает `false`
 * (так его контракт защищает HTTP-путь); здесь `false` превращается в
 * исключение, иначе BullMQ считал бы job успешным и не повторил бы отправку.
 * `status` в outbox обновляется после каждой попытки: `sent` при успехе,
 * `failed` — только когда попытки исчерпаны.
 *
 * **Payload валидируется дважды.** `outboxId` приходит из Redis (RULES 1.17),
 * поля письма — из БД (тоже внешняя граница). Повреждённое/устаревшее задание
 * или строка не должны доходить до `sendMail` с `undefined`; такое задание
 * помечается `UnrecoverableError` — повторять его бессмысленно.
 *
 * Email в логи не пишется (RULES 5.9): только id задания/outbox, номер
 * попытки и статус.
 */
@Processor(EMAIL_INVITATIONS_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  /**
   * @param emailService - сервис, выполняющий реальную SMTP-отправку
   * @param outbox - хранилище payload писем (v1.4.0 S3, KI-623)
   */
  constructor(
    private readonly emailService: EmailService,
    private readonly outbox: EmailOutboxService,
  ) {
    super();
  }

  /**
   * Обрабатывает задание отправки письма-приглашения.
   *
   * @param job - задание BullMQ с `{ outboxId }`
   * @returns `undefined` после успешной отправки (или если письмо уже отправлено)
   * @throws UnrecoverableError если payload задания/строки не прошёл Zod-валидацию
   *   либо строки outbox нет
   * @throws Error если SMTP не принял письмо — BullMQ повторит задание
   */
  async process(job: Job<EmailInvitationJobData>): Promise<void> {
    const parsedJob = EmailInvitationJobSchema.safeParse(job.data);

    if (!parsedJob.success) {
      const details = parsedJob.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

      this.logger.error(
        `Некорректный payload задания ${job.id} в очереди ${EMAIL_INVITATIONS_QUEUE}: ${details}`,
      );

      // Повторять битый payload бессмысленно: данные не изменятся.
      throw new UnrecoverableError(
        `некорректный payload задания ${job.id}: ${details}`,
      );
    }

    const { outboxId } = parsedJob.data;
    const row = await this.findOutboxAsync(outboxId);

    if (row === null) {
      this.logger.error(
        `Задание ${job.id}: строка email_outbox ${outboxId} не найдена`,
      );

      throw new UnrecoverableError(
        `строка email_outbox ${outboxId} не найдена`,
      );
    }

    // Идемпотентность: повторная доставка уже отправленного задания не должна
    // отправить второе письмо (BullMQ гарантирует at-least-once).
    if (row.status === 'sent') {
      this.logger.log(
        `Задание ${job.id}: письмо из email_outbox ${outboxId} уже отправлено — пропуск`,
      );

      return;
    }

    const parsedPayload = EmailInvitationPayloadSchema.safeParse({
      to: row.to,
      orgName: row.orgName,
      inviteLink: row.inviteLink,
    });

    if (!parsedPayload.success) {
      const details = parsedPayload.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');

      this.logger.error(
        `Некорректные данные email_outbox ${outboxId}: ${details}`,
      );
      await this.markFailedSafelyAsync(outboxId);

      // Строка не изменится сама — повторять задание незачем.
      throw new UnrecoverableError(
        `некорректные данные email_outbox ${outboxId}: ${details}`,
      );
    }

    const { to, orgName, inviteLink } = parsedPayload.data;
    // Номер попытки для лога — из задания (1-based), как и раньше. Счётчик в
    // БД увеличивается отдельно и может отличаться при ручном перезапуске.
    const attempt = job.attemptsMade + 1;
    await this.registerAttemptAsync(outboxId);
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
    let delivered = false;

    try {
      const sent = await this.emailService.sendInvitationAsync(
        to,
        orgName,
        inviteLink,
      );

      if (!sent) {
        throw new Error('SMTP не принял письмо-приглашение');
      }

      delivered = true;
      await this.outbox.markSentAsync(outboxId);

      this.logger.log(
        `Задание ${job.id}: письмо-приглашение отправлено (попытка ${attempt})`,
      );
    } catch (error: unknown) {
      // `failed` ставим только на последней попытке: до неё строка ещё
      // `pending`, и следующий повтор BullMQ продолжит с того же outboxId.
      // Если SMTP уже принял письмо, а упала только запись статуса, статус не
      // «разжаловываем» — письмо ушло.
      if (!delivered && isLastAttempt) {
        await this.markFailedSafelyAsync(outboxId);
      }

      this.logger.error(
        `Задание ${job.id}: отправка письма-приглашения не удалась (попытка ${attempt}): ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      // Пробрасываем — BullMQ сделает повтор с backoff, пока не кончатся попытки.
      throw error;
    }
  }

  /**
   * Читает строку outbox, не превращая сбой БД в `UnrecoverableError`.
   *
   * @param outboxId - uuid строки из задания
   * @returns строка либо `null`, если её нет
   * @throws Error при недоступной БД — BullMQ повторит задание
   */
  private async findOutboxAsync(
    outboxId: string,
  ): Promise<EmailOutboxRow | null> {
    try {
      return await this.outbox.findByIdAsync(outboxId);
    } catch (error: unknown) {
      this.logger.error(
        `email_outbox ${outboxId}: не удалось прочитать строку: ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      throw error;
    }
  }

  /**
   * Увеличивает счётчик попыток; сбой БД — повторяемая ошибка.
   *
   * @param outboxId - uuid строки outbox
   * @returns номер текущей попытки
   * @throws Error при недоступной БД — BullMQ повторит задание
   */
  private async registerAttemptAsync(outboxId: string): Promise<number> {
    try {
      return await this.outbox.registerAttemptAsync(outboxId);
    } catch (error: unknown) {
      this.logger.error(
        `email_outbox ${outboxId}: не удалось увеличить attempts: ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      throw error;
    }
  }

  /**
   * Помечает строку failed, не роняя исходную ошибку обработки.
   *
   * @param outboxId - uuid строки outbox
   * @returns промис без значения
   */
  private async markFailedSafelyAsync(outboxId: string): Promise<void> {
    try {
      await this.outbox.markFailedAsync(outboxId);
    } catch (error: unknown) {
      this.logger.error(
        `email_outbox ${outboxId}: не удалось пометить failed: ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );
    }
  }
}
