import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { emailOutbox, type EmailOutboxRow } from '../db/schema.js';

/**
 * Хранилище исходящих писем-приглашений (outbox, v1.4.0 S3, KI-623).
 *
 * Продюсер (`EmailService.queueInvitationAsync`) пишет сюда строку и ставит в
 * BullMQ задание с одним `outboxId`; воркер (`EmailProcessor`) читает payload
 * из БД, отправляет письмо и обновляет статус. В Redis больше нет email,
 * названия организации и ссылки-приглашения — только uuid.
 *
 * Сервис — тонкий слой над Drizzle: он не отправляет письма и не знает про
 * SMTP. Так `EmailService` отвечает за постановку/отправку, а SQL не
 * расползается по воркеру и не мешает его unit-тестам.
 */
@Injectable()
export class EmailOutboxService {
  /**
   * @param db - singleton Drizzle-клиент (RULES 4.10)
   */
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Создаёт строку outbox со снимком письма.
   *
   * @param to - email приглашённого (нормализованный)
   * @param orgName - название организации для темы и текста
   * @param inviteLink - абсолютная ссылка на регистрацию с `?invite=`
   * @returns id созданной строки — он и уходит в payload задания
   * @throws Error если INSERT не вернул строку (БД недоступна/схема разошлась)
   */
  async createAsync(
    to: string,
    orgName: string,
    inviteLink: string,
  ): Promise<string> {
    const rows = await this.db
      .insert(emailOutbox)
      .values({ to, orgName, inviteLink })
      .returning({ id: emailOutbox.id });

    const created = rows[0];

    if (created === undefined) {
      throw new Error('email_outbox: INSERT не вернул id');
    }

    return created.id;
  }

  /**
   * Читает строку outbox по id.
   *
   * @param id - uuid строки из payload задания
   * @returns строка либо `null`, если её нет (удалена/повреждён payload)
   */
  async findByIdAsync(id: string): Promise<EmailOutboxRow | null> {
    const rows = await this.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Увеличивает счётчик попыток перед отправкой.
   *
   * Атомарный `attempts = attempts + 1` в SQL, а не чтение-изменение-запись:
   * два воркера (повторная доставка BullMQ) не потеряют попытку.
   *
   * @param id - uuid строки outbox
   * @returns новое значение `attempts` (0 — строки нет)
   */
  async registerAttemptAsync(id: string): Promise<number> {
    const rows = await this.db
      .update(emailOutbox)
      .set({ attempts: sql`${emailOutbox.attempts} + 1` })
      .where(eq(emailOutbox.id, id))
      .returning({ attempts: emailOutbox.attempts });

    return rows[0]?.attempts ?? 0;
  }

  /**
   * Помечает письмо отправленным.
   *
   * @param id - uuid строки outbox
   * @returns промис без значения
   */
  async markSentAsync(id: string): Promise<void> {
    await this.db
      .update(emailOutbox)
      .set({ status: 'sent' })
      .where(eq(emailOutbox.id, id));
  }

  /**
   * Помечает письмо неудачным (исчерпаны попытки или очередь недоступна).
   *
   * Не перезаписывает `sent`: если письмо уже ушло, поздняя ошибка другого
   * дубля задания не должна «разжаловать» его обратно в failed.
   *
   * @param id - uuid строки outbox
   * @returns промис без значения
   */
  async markFailedAsync(id: string): Promise<void> {
    await this.db
      .update(emailOutbox)
      .set({ status: 'failed' })
      .where(and(eq(emailOutbox.id, id), ne(emailOutbox.status, 'sent')));
  }
}
