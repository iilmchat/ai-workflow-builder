import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  EMAIL_INVITATIONS_QUEUE,
  EmailInvitationJobSchema,
  type EmailInvitationJobData,
} from './email.queue.js';
import { EmailService } from './email.service.js';

/**
 * Воркер очереди писем-приглашений (v1.2.0 S2, DESIGN V120 § 3.3).
 *
 * Забирает задания `send-invitation` из {@link EMAIL_INVITATIONS_QUEUE} и
 * вызывает `EmailService.sendInvitationAsync` — единственное место, где
 * выполняется реальный SMTP-вызов. Очередь даёт то, чего не было в v1.1.0:
 * HTTP-запрос приглашения не ждёт SMTP, а сбой отправки не теряет письмо —
 * BullMQ повторяет job по `EMAIL_INVITATION_JOB_OPTIONS` (3 попытки,
 * exponential backoff 5 с).
 *
 * **Ошибка → throw.** `sendInvitationAsync` не бросает, а возвращает `false`
 * (так его контракт защищает HTTP-путь); здесь `false` превращается в
 * исключение, иначе BullMQ считал бы job успешным и не повторил бы отправку.
 *
 * **Payload валидируется Zod.** Данные приходят из Redis (RULES 1.17):
 * повреждённое/устаревшее задание не должно доходить до `sendMail` с
 * `undefined`. Такое задание помечается `UnrecoverableError` — повторять его
 * бессмысленно.
 *
 * Email в логи не пишется (RULES 5.9): только id задания и номер попытки.
 */
@Processor(EMAIL_INVITATIONS_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  /**
   * @param emailService - сервис, выполняющий реальную SMTP-отправку
   */
  constructor(private readonly emailService: EmailService) {
    super();
  }

  /**
   * Обрабатывает задание отправки письма-приглашения.
   *
   * @param job - задание BullMQ с {@link EmailInvitationJobData}
   * @returns `undefined` после успешной отправки
   * @throws UnrecoverableError если payload не прошёл Zod-валидацию
   * @throws Error если SMTP не принял письмо — BullMQ повторит задание
   */
  async process(job: Job<EmailInvitationJobData>): Promise<void> {
    const parsed = EmailInvitationJobSchema.safeParse(job.data);

    if (!parsed.success) {
      const details = parsed.error.issues
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

    const { to, orgName, inviteLink } = parsed.data;
    const attempt = job.attemptsMade + 1;

    try {
      const sent = await this.emailService.sendInvitationAsync(
        to,
        orgName,
        inviteLink,
      );

      if (!sent) {
        throw new Error('SMTP не принял письмо-приглашение');
      }

      this.logger.log(
        `Задание ${job.id}: письмо-приглашение отправлено (попытка ${attempt})`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Задание ${job.id}: отправка письма-приглашения не удалась (попытка ${attempt}): ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      // Пробрасываем — BullMQ сделает повтор с backoff, пока не кончатся попытки.
      throw error;
    }
  }
}
