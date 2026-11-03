import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import {
  buildInvitationHtml,
  buildInvitationSubject,
  buildInvitationText,
} from './email.templates.js';

/** Порт SMTP по умолчанию (STARTTLS). */
const DEFAULT_SMTP_PORT = 587;
/** Адрес отправителя по умолчанию (если `SMTP_FROM` не задан). */
const DEFAULT_SMTP_FROM = 'noreply@workflow-builder.local';
/** Публичный адрес приложения по умолчанию (локальный запуск). */
const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';
/**
 * Таймаут установки SMTP-соединения и приветствия, мс.
 *
 * Приглашение создаётся синхронно с HTTP-запросом (outbox/очереди в v1.1.0
 * нет, KI-593), поэтому зависший SMTP не должен держать запрос минутами:
 * 10 секунд на соединение — компромисс между медленным внешним SMTP и
 * отзывчивостью `POST /admin/members/invite`.
 */
const SMTP_TIMEOUT_MS = 10_000;

/**
 * Приводит строковую env-переменную к «задана/не задана».
 *
 * `validateEnv` возвращает `{ ...config, ...parsed }`: пустая строка из `.env`
 * остаётся в исходном `config`, даже если Zod-схема превратила её в `undefined`
 * (см. `emptyToUndefined`). Поэтому `ConfigService.get()` может вернуть `''`, и
 * проверять нужно именно «непустую строку», а не `undefined` (иначе пустой
 * `SMTP_HOST` создал бы транспорт на localhost:587 — поймано смоуком).
 *
 * @param value - сырое значение из `ConfigService`
 * @returns обрезанное непустое значение либо `undefined`
 */
function readOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Маскирует email для логов (RULES 5.9: PII не пишем целиком).
 *
 * @param email - адрес приглашённого
 * @returns маска вида `a***@example.com`; для битой строки — `***`
 */
function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');

  if (atIndex <= 0) {
    return '***';
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex);

  return `${localPart.slice(0, 1)}***${domain}`;
}

/**
 * Сервис отправки писем-приглашений в организацию (v1.1.0 S1, DESIGN § 3.1).
 *
 * **Fallback обязателен.** SMTP — опциональная подсистема: если `SMTP_HOST` не
 * задан, приглашение всё равно создаётся в БД (`OrgMembersService`), а сервис
 * возвращает `false` и пишет WARN. Тот же контракт при сбое отправки
 * (недоступный SMTP, таймаут, отказ авторизации): вызывающий код никогда не
 * получает исключение, и HTTP-ручка не превращает успешное приглашение в 500.
 *
 * Транспорт создаётся один раз в конструкторе (nodemailer держит пул
 * соединений), конфигурация читается из `ConfigService` (валидирована
 * `SmtpEnvSchema`). Пароль `SMTP_PASS` в логи не попадает (RULES 5.3), email
 * приглашённого маскируется (RULES 5.9).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /** Транспорт nodemailer; `null` — SMTP не настроен (fallback-only режим). */
  private readonly transport: Transporter | null;

  /** Адрес отправителя из `SMTP_FROM`. */
  private readonly from: string;

  /** Публичный адрес приложения без хвостового слэша. */
  private readonly publicUrl: string;

  /**
   * @param config - валидированная конфигурация окружения (SMTP_*,
   *   APP_PUBLIC_URL)
   */
  constructor(private readonly config: ConfigService) {
    this.from =
      readOptionalString(this.config.get<string>('SMTP_FROM')) ??
      DEFAULT_SMTP_FROM;
    this.publicUrl = (
      readOptionalString(this.config.get<string>('APP_PUBLIC_URL')) ??
      DEFAULT_APP_PUBLIC_URL
    ).replace(/\/+$/, '');

    // Пустая строка — тоже «не настроено»: `validateEnv` сохраняет исходный
    // ключ, поэтому `get('SMTP_HOST')` может вернуть `''`.
    const host = readOptionalString(this.config.get<string>('SMTP_HOST'));

    if (host === undefined) {
      this.transport = null;

      return;
    }

    const user = readOptionalString(this.config.get<string>('SMTP_USER'));
    const pass = readOptionalString(this.config.get<string>('SMTP_PASS'));

    this.transport = createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT') ?? DEFAULT_SMTP_PORT,
      secure: this.config.get<boolean>('SMTP_SECURE') ?? false,
      // Аутентификация — только когда заданы оба поля: провайдеры без auth
      // (локальный mock-SMTP в смоуке) не должны получать пустые креды.
      ...(user !== undefined && pass !== undefined
        ? { auth: { user, pass } }
        : {}),
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS * 2,
    });
  }

  /**
   * Настроена ли отправка писем (задан `SMTP_HOST`).
   *
   * Нужен вызывающему коду, который не хочет даже пытаться отправить письмо
   * в заведомо ненастроенном окружении, и смоуку для диагностики.
   *
   * @returns `true`, если транспорт создан и письмо может быть отправлено
   */
  isConfigured(): boolean {
    return this.transport !== null;
  }

  /**
   * Собирает абсолютную ссылку на регистрацию с идентификатором приглашения.
   *
   * Идентификатор — `organization_invitations.id` (uuid): непрозрачный для
   * пользователя и не содержит email (PII в URL не уходит). Ссылка ведёт на
   * страницу входа/регистрации SPA; параметр `invite` пока только
   * информационный — регистрация «сжигает» приглашение по email (KI-594).
   *
   * @param invitationId - uuid строки `organization_invitations`
   * @returns абсолютный URL вида `<APP_PUBLIC_URL>/login?invite=<uuid>`
   */
  buildInvitationLink(invitationId: string): string {
    return `${this.publicUrl}/login?invite=${encodeURIComponent(invitationId)}`;
  }

  /**
   * Отправляет письмо-приглашение в организацию.
   *
   * Никогда не бросает: сбой SMTP — это `false` + ERROR в лог, а не отказ
   * HTTP-ручки (приглашение уже в БД, fallback по DESIGN § 3.1). Без
   * `SMTP_HOST` — `false` + WARN, письмо не формируется вовсе.
   *
   * @param to - email приглашённого (уже нормализованный вызывающим кодом)
   * @param orgName - название организации для темы и текста
   * @param inviteLink - абсолютная ссылка на регистрацию с `?invite=`
   * @returns `true`, если SMTP принял письмо; `false` — не отправлено
   */
  async sendInvitationAsync(
    to: string,
    orgName: string,
    inviteLink: string,
  ): Promise<boolean> {
    if (this.transport === null) {
      this.logger.warn(
        `SMTP не настроен (SMTP_HOST не задан): приглашение для ${maskEmail(to)} создано, но письмо не отправлено`,
      );

      return false;
    }

    try {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject: buildInvitationSubject(orgName),
        text: buildInvitationText(orgName, inviteLink),
        html: buildInvitationHtml(orgName, inviteLink),
      });

      this.logger.log(
        `Письмо-приглашение отправлено: ${maskEmail(to)} (${orgName})`,
      );

      return true;
    } catch (error: unknown) {
      // Причина отказа — в лог, письмо и креды — нет (RULES 5.3).
      this.logger.error(
        `Не удалось отправить письмо-приглашение (${maskEmail(to)}): ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      return false;
    }
  }
}
