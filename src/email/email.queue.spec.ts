import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEmailQueueOptions,
  EMAIL_INVITATION_JOB_OPTIONS,
  EMAIL_INVITATIONS_QUEUE,
  EmailInvitationJobSchema,
  EmailInvitationPayloadSchema,
  SEND_INVITATION_JOB,
  type EmailInvitationJobData,
} from './email.queue.js';
import type { EmailOutboxService } from './email-outbox.service.js';
import { EmailService } from './email.service.js';

/** Ссылка-приглашение, которую сервис передаёт в очередь. */
const INVITE_LINK = 'https://app.example.com/login?invite=invitation-1';

/**
 * Собирает заглушку `ConfigService` с минимальными настройками.
 *
 * @param values - значения окружения
 * @returns объект, ведущий себя как `ConfigService`
 */
function configOf(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];

      if (value === undefined) {
        throw new Error(`не задано: ${key}`);
      }

      return value;
    },
  } as unknown as ConfigService;
}

describe('очередь email-invitations (v1.2.0 S2)', () => {
  let add: ReturnType<typeof vi.fn>;
  let createAsync: ReturnType<typeof vi.fn>;
  let markFailedAsync: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let service: EmailService;

  beforeEach(() => {
    add = vi.fn(() => Promise.resolve({ id: 'job-1' }));
    createAsync = vi.fn(() => Promise.resolve('outbox-1'));
    markFailedAsync = vi.fn(() => Promise.resolve());
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new EmailService(
      configOf({ SMTP_HOST: undefined, APP_PUBLIC_URL: 'https://app.example.com' }),
      { add } as unknown as Queue<EmailInvitationJobData>,
      { createAsync, markFailedAsync } as unknown as EmailOutboxService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queueInvitationAsync пишет outbox и ставит job с одним outboxId (без PII)', async () => {
    await expect(
      service.queueInvitationAsync('alice@example.com', 'Acme Org', INVITE_LINK),
    ).resolves.toBe(true);

    // Payload письма — в БД (KI-623): email/orgName/inviteLink не попадают в Redis.
    expect(createAsync).toHaveBeenCalledTimes(1);
    expect(createAsync).toHaveBeenCalledWith(
      'alice@example.com',
      'Acme Org',
      INVITE_LINK,
    );

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      SEND_INVITATION_JOB,
      { outboxId: 'outbox-1' },
      EMAIL_INVITATION_JOB_OPTIONS,
    );

    // В самом payload задания нет ни email, ни названия, ни ссылки.
    const jobData = add.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(jobData)).toEqual(['outboxId']);
    expect(JSON.stringify(jobData)).not.toContain('alice@example.com');
    expect(JSON.stringify(jobData)).not.toContain('Acme Org');
    expect(JSON.stringify(jobData)).not.toContain(INVITE_LINK);

    // Успех — в LOG, email маскируется (RULES 5.9).
    expect(logSpy).toHaveBeenCalledTimes(1);
    const message = String(logSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain(EMAIL_INVITATIONS_QUEUE);
    expect(message).toContain('a***@example.com');
    expect(message).not.toContain('alice@example.com');
    // SMTP при постановке в очередь не вызывается: транспорт не создан.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ошибка Redis возвращает false, помечает outbox failed и не бросает', async () => {
    add.mockRejectedValue(new Error('Redis connection lost'));

    await expect(
      service.queueInvitationAsync('alice@example.com', 'Acme Org', INVITE_LINK),
    ).resolves.toBe(false);

    expect(createAsync).toHaveBeenCalledTimes(1);
    expect(markFailedAsync).toHaveBeenCalledWith('outbox-1');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('Redis connection lost');
    expect(message).toContain('a***@example.com');
    expect(message).not.toContain('alice@example.com');
  });

  it('ошибка БД при создании outbox: job не ставится, возвращается false', async () => {
    createAsync.mockRejectedValue(new Error('insert failed'));

    await expect(
      service.queueInvitationAsync('alice@example.com', 'Acme Org', INVITE_LINK),
    ).resolves.toBe(false);

    expect(add).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('insert failed');
    expect(String(errorSpy.mock.calls[0]?.[0] ?? '')).toContain('a***@example.com');
  });

  it('ошибка пометки failed не скрывает исходную ошибку очереди', async () => {
    add.mockRejectedValue(new Error('Redis connection lost'));
    markFailedAsync.mockRejectedValue(new Error('update failed'));

    await expect(
      service.queueInvitationAsync('alice@example.com', 'Acme Org', INVITE_LINK),
    ).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(String(errorSpy.mock.calls[1]?.[0] ?? '')).toContain(
      'Redis connection lost',
    );
  });

  it('опции задания: 3 попытки, exponential backoff 5000, removeOn*', () => {
    expect(EMAIL_INVITATION_JOB_OPTIONS.attempts).toBe(3);
    expect(EMAIL_INVITATION_JOB_OPTIONS.backoff).toEqual({
      type: 'exponential',
      delay: 5_000,
    });
    expect(EMAIL_INVITATION_JOB_OPTIONS.removeOnComplete).toBeDefined();
    expect(EMAIL_INVITATION_JOB_OPTIONS.removeOnFail).toBeDefined();
  });

  it('createEmailQueueOptions читает prefix/db/url и кладёт defaultJobOptions', () => {
    const options = createEmailQueueOptions(
      configOf({
        REDIS_URL: 'redis://127.0.0.1:6379',
        BULLMQ_PREFIX: 'smoke-s2',
        REDIS_QUEUE_DB: 3,
      }),
    );

    expect(options.prefix).toBe('smoke-s2');
    expect(options.connection).toEqual({
      url: 'redis://127.0.0.1:6379',
      db: 3,
    });
    expect(options.defaultJobOptions).toEqual(EMAIL_INVITATION_JOB_OPTIONS);
  });

  it('createEmailQueueOptions применяет дефолты prefix/db', () => {
    const options = createEmailQueueOptions(
      configOf({ REDIS_URL: 'redis://127.0.0.1:6379' }),
    );

    expect(options.prefix).toBe('workflow-runs');
    expect(options.connection).toEqual({
      url: 'redis://127.0.0.1:6379',
      db: 0,
    });
  });

  it('createEmailQueueOptions падает без REDIS_URL (fail-fast)', () => {
    expect(() => createEmailQueueOptions(configOf())).toThrow('REDIS_URL');
  });

  it('Zod-схема задания принимает только uuid outboxId', () => {
    expect(
      EmailInvitationJobSchema.safeParse({
        outboxId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);

    // Старый payload (to/orgName/inviteLink) больше не является заданием:
    // после v1.4.0 S3 в Redis должен лежать только id (KI-623).
    expect(
      EmailInvitationJobSchema.safeParse({
        to: 'alice@example.com',
        orgName: 'Acme Org',
        inviteLink: INVITE_LINK,
      }).success,
    ).toBe(false);
    expect(
      EmailInvitationJobSchema.safeParse({ outboxId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('Zod-схема payload из БД отвергает битый email и не-http ссылку', () => {
    const valid = {
      to: 'alice@example.com',
      orgName: 'Acme Org',
      inviteLink: INVITE_LINK,
    };

    expect(EmailInvitationPayloadSchema.safeParse(valid).success).toBe(true);
    expect(
      EmailInvitationPayloadSchema.safeParse({ ...valid, to: 'not-an-email' })
        .success,
    ).toBe(false);
    expect(
      EmailInvitationPayloadSchema.safeParse({
        ...valid,
        inviteLink: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    // Пустое имя организации не должно доходить до темы письма.
    expect(
      EmailInvitationPayloadSchema.safeParse({ ...valid, orgName: '  ' }).success,
    ).toBe(false);
  });
});
