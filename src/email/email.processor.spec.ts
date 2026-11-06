import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailProcessor } from './email.processor.js';
import { EMAIL_INVITATIONS_QUEUE, type EmailInvitationJobData } from './email.queue.js';
import type { EmailService } from './email.service.js';

/** Ссылка-приглашение в задании. */
const INVITE_LINK = 'https://app.example.com/login?invite=invitation-1';

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
  } = {},
): Job<EmailInvitationJobData> {
  return {
    id: 'job-1',
    data: {
      to: 'alice@example.com',
      orgName: 'Acme Org',
      inviteLink: INVITE_LINK,
      ...overrides.data,
    },
    attemptsMade: overrides.attemptsMade ?? 0,
  } as unknown as Job<EmailInvitationJobData>;
}

describe('EmailProcessor (v1.2.0 S2)', () => {
  let sendInvitationAsync: ReturnType<typeof vi.fn>;
  let processor: EmailProcessor;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendInvitationAsync = vi.fn(() => Promise.resolve(true));
    processor = new EmailProcessor({
      sendInvitationAsync,
    } as unknown as EmailService);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('вызывает EmailService.sendInvitationAsync с payload задания', async () => {
    await expect(processor.process(jobOf())).resolves.toBeUndefined();

    expect(sendInvitationAsync).toHaveBeenCalledTimes(1);
    expect(sendInvitationAsync).toHaveBeenCalledWith(
      'alice@example.com',
      'Acme Org',
      INVITE_LINK,
    );
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

  it('false от сервиса превращается в throw — BullMQ повторит задание', async () => {
    sendInvitationAsync.mockResolvedValue(false);

    await expect(processor.process(jobOf())).rejects.toThrow(
      'SMTP не принял письмо-приглашение',
    );

    expect(sendInvitationAsync).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('не удалась');
  });

  it('исключение сервиса пробрасывается без подмены', async () => {
    const failure = new Error('SMTP timeout');
    sendInvitationAsync.mockRejectedValue(failure);

    await expect(processor.process(jobOf())).rejects.toBe(failure);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('SMTP timeout');
  });

  it('битый payload → UnrecoverableError, сервис не вызывается', async () => {
    const job = jobOf({ data: { to: 'not-an-email' } });

    await expect(processor.process(job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );

    expect(sendInvitationAsync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(EMAIL_INVITATIONS_QUEUE),
    );
  });
});
