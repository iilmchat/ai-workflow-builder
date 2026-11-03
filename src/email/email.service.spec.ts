import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service.js';
import {
  buildInvitationHtml,
  buildInvitationSubject,
  buildInvitationText,
  escapeHtml,
  sanitizeHeaderValue,
} from './email.templates.js';

/**
 * Моки nodemailer (v1.1.0 S1).
 *
 * `vi.hoisted` нужен, потому что `vi.mock` поднимается в начало файла: сами
 * фабрики должны быть доступны до импорта `EmailService` (он импортирует
 * `createTransport`). Мокается только транспорт — шаблоны и сервис
 * тестируются по-настоящему, поэтому проверяются фактические subject/html/text.
 */
const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({ createTransport: createTransportMock }));

/** Ссылка-приглашение, которую сервис передаёт в письмо. */
const INVITE_LINK = 'https://app.example.com/login?invite=invitation-1';

/**
 * Создаёт заглушку `ConfigService` с SMTP-настройками.
 *
 * @param overrides - значения, которые перекрывают дефолтные (например,
 *   `SMTP_HOST: undefined` для сценария «SMTP не настроен»)
 * @returns объект, ведущий себя как `ConfigService.get`
 */
function configOf(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_USER: 'mailer',
    SMTP_PASS: 'secret',
    SMTP_FROM: 'noreply@example.com',
    SMTP_SECURE: false,
    APP_PUBLIC_URL: 'https://app.example.com',
    ...overrides,
  };

  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('EmailService (v1.1.0 S1)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createTransportMock.mockReset();
    sendMailMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    sendMailMock.mockResolvedValue({ messageId: 'id-1' });
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('без SMTP (fallback DESIGN V110 § 3.1)', () => {
    it('не создаёт транспорт, пишет WARN и возвращает false', async () => {
      const service = new EmailService(configOf({ SMTP_HOST: undefined }));

      expect(service.isConfigured()).toBe(false);
      expect(createTransportMock).not.toHaveBeenCalled();

      const sent = await service.sendInvitationAsync(
        'alice@example.com',
        'Acme Org',
        INVITE_LINK,
      );

      expect(sent).toBe(false);
      expect(sendMailMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Email в логе маскируется (RULES 5.9), полного адреса в логах нет.
      const warning = String(warnSpy.mock.calls[0]?.[0] ?? '');
      expect(warning).toContain('a***@example.com');
      expect(warning).not.toContain('alice@example.com');
      expect(warning).toContain('SMTP');
    });

    it('пустой SMTP_HOST из .env считается «не настроен» (validateEnv сохраняет "")', async () => {
      // `validateEnv` возвращает `{ ...config, ...parsed }`, поэтому пустая
      // строка из `.env` остаётся в конфиге, хотя Zod превратил её в undefined.
      // Смоук поймал регресс: `host === ''` создавал транспорт на localhost:587.
      const service = new EmailService(configOf({ SMTP_HOST: '' }));

      expect(service.isConfigured()).toBe(false);
      expect(createTransportMock).not.toHaveBeenCalled();

      await expect(
        service.sendInvitationAsync('alice@example.com', 'Acme Org', INVITE_LINK),
      ).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it('пустые SMTP_FROM/APP_PUBLIC_URL заменяются дефолтами', async () => {
      const service = new EmailService(
        configOf({ SMTP_FROM: '', APP_PUBLIC_URL: '' }),
      );

      expect(service.buildInvitationLink('invitation-1')).toBe(
        'http://localhost:3000/login?invite=invitation-1',
      );

      await service.sendInvitationAsync(
        'alice@example.com',
        'Acme Org',
        INVITE_LINK,
      );

      const message = sendMailMock.mock.calls[0]?.[0] as { from: string };

      expect(message.from).toBe('noreply@workflow-builder.local');
    });
  });

  describe('транспорт', () => {
    it('создаёт SMTP-транспорт с host/port/secure/auth и таймаутами', () => {
      const service = new EmailService(configOf());

      expect(service.isConfigured()).toBe(true);
      expect(createTransportMock).toHaveBeenCalledTimes(1);
      expect(createTransportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          auth: { user: 'mailer', pass: 'secret' },
          connectionTimeout: expect.any(Number),
          greetingTimeout: expect.any(Number),
          socketTimeout: expect.any(Number),
        }),
      );
    });

    it('без SMTP_USER/SMTP_PASS не передаёт auth (локальный mock-SMTP)', () => {
      const service = new EmailService(
        configOf({ SMTP_USER: undefined, SMTP_PASS: undefined }),
      );

      expect(service.isConfigured()).toBe(true);

      const options = createTransportMock.mock.calls[0]?.[0] as Record<string, unknown>;

      expect(options).not.toHaveProperty('auth');
    });

    it('уважает SMTP_SECURE=true (implicit TLS, порт 465)', () => {
      new EmailService(configOf({ SMTP_SECURE: true, SMTP_PORT: 465 }));

      expect(createTransportMock).toHaveBeenCalledWith(
        expect.objectContaining({ port: 465, secure: true }),
      );
    });
  });

  describe('sendInvitationAsync', () => {
    it('отправляет письмо с темой, HTML и текстом и возвращает true', async () => {
      const service = new EmailService(configOf());

      const sent = await service.sendInvitationAsync(
        'alice@example.com',
        'Acme Org',
        INVITE_LINK,
      );

      expect(sent).toBe(true);
      expect(sendMailMock).toHaveBeenCalledTimes(1);

      const message = sendMailMock.mock.calls[0]?.[0] as {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
      };

      expect(message.from).toBe('noreply@example.com');
      expect(message.to).toBe('alice@example.com');
      expect(message.subject).toBe('Приглашение в организацию Acme Org');
      expect(message.html).toContain('Acme Org');
      expect(message.html).toContain(INVITE_LINK.replace(/&/g, '&amp;'));
      expect(message.text).toContain(INVITE_LINK);
      expect(message.text).toContain('Acme Org');
      // Успех — в LOG, email маскируется (RULES 5.9).
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(String(logSpy.mock.calls[0]?.[0] ?? '')).toContain('a***@example.com');
    });

    it('сбой SMTP возвращает false, пишет ERROR и не бросает', async () => {
      sendMailMock.mockRejectedValue(new Error('550 mailbox unavailable'));
      const service = new EmailService(configOf());

      await expect(
        service.sendInvitationAsync('alice@example.com', 'Acme Org', INVITE_LINK),
      ).resolves.toBe(false);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const errorMessage = String(errorSpy.mock.calls[0]?.[0] ?? '');
      expect(errorMessage).toContain('550 mailbox unavailable');
      expect(errorMessage).toContain('a***@example.com');
      expect(errorMessage).not.toContain('alice@example.com');
      // Пароль не должен попасть в лог даже при ошибке (RULES 5.3).
      expect(errorMessage).not.toContain('secret');
    });
  });

  describe('buildInvitationLink', () => {
    it('собирает абсолютную ссылку на регистрацию с id приглашения', () => {
      const service = new EmailService(configOf());

      expect(service.buildInvitationLink('invitation-1')).toBe(
        'https://app.example.com/login?invite=invitation-1',
      );
    });

    it('убирает хвостовой слэш из APP_PUBLIC_URL', () => {
      const service = new EmailService(
        configOf({ APP_PUBLIC_URL: 'https://app.example.com/' }),
      );

      expect(service.buildInvitationLink('abc')).toBe(
        'https://app.example.com/login?invite=abc',
      );
    });
  });
});

describe('шаблоны письма-приглашения', () => {
  it('sanitizeHeaderValue удаляет управляющие символы и схлопывает пробелы', () => {
    expect(sanitizeHeaderValue('Acme\r\nBcc: evil@example.com')).toBe(
      'Acme Bcc: evil@example.com',
    );
    expect(sanitizeHeaderValue('  Acme \t Org  ')).toBe('Acme Org');
    expect(sanitizeHeaderValue('Acme\u0000Org')).toBe('Acme Org');
  });

  it('escapeHtml экранирует все пять HTML-спецсимволов', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('тема письма санитизирована (без CR/LF)', () => {
    const subject = buildInvitationSubject('Acme\r\nBcc: x@example.com');

    expect(subject).toBe('Приглашение в организацию Acme Bcc: x@example.com');
    expect(subject).not.toContain('\n');
    expect(subject).not.toContain('\r');
  });

  it('text-версия содержит организацию и ссылку', () => {
    const text = buildInvitationText('Acme Org', INVITE_LINK);

    expect(text).toContain('Acme Org');
    expect(text).toContain(INVITE_LINK);
    expect(text).toContain('© 2026 RuChating (iilmchat)');
  });

  it('HTML-версия экранирует имя организации и сохраняет ссылку', () => {
    const html = buildInvitationHtml('<script>alert(1)</script>', INVITE_LINK);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain(INVITE_LINK.replace(/&/g, '&amp;'));
    expect(html).toContain('Присоединиться');
  });
});
