import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailOutboxRow } from '../db/schema.js';
import type { EmailOutboxService } from './email-outbox.service.js';
import { EmailProcessor } from './email.processor.js';
import { EMAIL_INVITATIONS_QUEUE, type EmailInvitationJobData } from './email.queue.js';
import type { EmailService } from './email.service.js';

/** Ссылка-приглашение в строке outbox. */
const INVITE_LINK = 'https://app.example.com/login?invite=invitation-1';
/** uuid строки outbox в тестах. */
const OUTBOX_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Собирает строку `email_outbox` для теста воркера.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns строка outbox с типизированными полями
 */
function rowOf(overrides: Partial<EmailOutboxRow> = {}): EmailOutboxRow {
  return {
    id: OUTBOX_ID,
    to: 'alice@example.com',
    orgName: 'Acme Org',
    inviteLink: INVITE_LINK,
    status: 'pending',
    createdAt: new Date('2026-11-08T10:00:00.000Z'),
    attempts: 0,
    ...overrides,
  };
}

/**
 * Собирает задание BullMQ для теста воркера.
 *
 * @param overrides - поля задания, которые нужно переопределить
 * @returns задание с типизированным payload
 */
function jobOf(
  overrides: {
    data?: Partial<EmailInvitationJobData> | Record<string, unknown>;
    attemptsMade?: number;
    attempts?: number;
  } = {},
): Job<EmailInvitationJobData> {
  return {
    id: 'job-1',
    data: {
      outboxId: OUTBOX_ID,
      ...overrides.data,
    },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job<EmailInvitationJobData>;
}

describe('EmailProcessor (v1.2.0 S2; outbox — v1.4.0 S3)', () => {
  let sendInvitationAsync: ReturnType<typeof vi.fn>;
  let findByIdAsync: ReturnType<typeof vi.fn>;
  let registerAttemptAsync: ReturnType<typeof vi.fn>;
  let markSentAsync: ReturnType<typeof vi.fn>;
  let markFailedAsync: ReturnType<typeof vi.fn>;
  let processor: EmailProcessor;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendInvitationAsync = vi.fn(() => Promise.resolve(true));
    findByIdAsync = vi.fn(() => Promise.resolve(rowOf()));
    registerAttemptAsync = vi.fn(() => Promise.resolve(1));
    markSentAsync = vi.fn(() => Promise.resolve());
    markFailedAsync = vi.fn(() => Promise.resolve());

    processor = new EmailProcessor(
      { sendInvitationAsync } as unknown as EmailService,
      {
        findByIdAsync,
        registerAttemptAsync,
        markSentAsync,
        markFailedAsync,
      } as unknown as EmailOutboxService,
    );
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('читает payload из БД по outboxId и отправляет письмо', async () => {
    await expect(processor.process(jobOf())).resolves.toBeUndefined();

    expect(findByIdAsync).toHaveBeenCalledWith(OUTBOX_ID);
    expect(sendInvitationAsync).toHaveBeenCalledTimes(1);
    expect(sendInvitationAsync).toHaveBeenCalledWith(
      'alice@example.com',
      'Acme Org',
      INVITE_LINK,
    );
    expect(registerAttemptAsync).toHaveBeenCalledWith(OUTBOX_ID);
    expect(markSentAsync).toHaveBeenCalledWith(OUTBOX_ID);
    expect(markFailedAsync).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('письмо-приглашение отправлено'),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('пишет номер попытки в лог (attemptsMade + 1)', async () => {
    sendInvitationAsync.mockResolvedValue(false);

    await expect(processor.process(jobOf({ attemptsMade: 2 }))).rejects.toThrow(
      'SMTP не принял письмо-приглашение',
    );

    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('попытка 3');
  });

  it('false от сервиса на последней попытке помечает outbox failed и бросает', async () => {
    sendInvitationAsync.mockResolvedValue(false);

    await expect(processor.process(jobOf({ attemptsMade: 2 }))).rejects.toThrow(
      'SMTP не принял письмо-приглашение',
    );

    expect(markFailedAsync).toHaveBeenCalledWith(OUTBOX_ID);
    expect(markSentAsync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('не удалась');
  });

  it('false до последней попытки не помечает failed: BullMQ ещё повторит', async () => {
    sendInvitationAsync.mockResolvedValue(false);

    await expect(processor.process(jobOf({ attemptsMade: 0 }))).rejects.toThrow(
      'SMTP не принял письмо-приглашение',
    );

    expect(markFailedAsync).not.toHaveBeenCalled();
  });

  it('исключение сервиса пробрасывается без подмены', async () => {
    const failure = new Error('SMTP timeout');
    sendInvitationAsync.mockRejectedValue(failure);

    await expect(processor.process(jobOf())).rejects.toBe(failure);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('SMTP timeout');
  });

  it('битый payload задания → UnrecoverableError, БД не читается', async () => {
    const job = jobOf({ data: { outboxId: 'not-a-uuid' } });

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(findByIdAsync).not.toHaveBeenCalled();
    expect(sendInvitationAsync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(EMAIL_INVITATIONS_QUEUE),
    );
  });

  it('отсутствующая строка outbox → UnrecoverableError, SMTP не вызывается', async () => {
    findByIdAsync.mockResolvedValue(null);

    await expect(processor.process(jobOf())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(sendInvitationAsync).not.toHaveBeenCalled();
  });

  it('уже отправленное письмо не отправляется повторно (идемпотентность)', async () => {
    findByIdAsync.mockResolvedValue(rowOf({ status: 'sent' }));

    await expect(processor.process(jobOf())).resolves.toBeUndefined();

    expect(sendInvitationAsync).not.toHaveBeenCalled();
    expect(markSentAsync).not.toHaveBeenCalled();
  });

  it('битые данные в outbox → failed + UnrecoverableError, SMTP не вызывается', async () => {
    findByIdAsync.mockResolvedValue(rowOf({ to: 'not-an-email' }));

    await expect(processor.process(jobOf())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(markFailedAsync).toHaveBeenCalledWith(OUTBOX_ID);
    expect(sendInvitationAsync).not.toHaveBeenCalled();
  });

  it('ошибка чтения БД — повторяемая ошибка, не UnrecoverableError', async () => {
    findByIdAsync.mockRejectedValue(new Error('db down'));

    await expect(processor.process(jobOf())).rejects.toThrow('db down');
    expect(sendInvitationAsync).not.toHaveBeenCalled();
  });
});
