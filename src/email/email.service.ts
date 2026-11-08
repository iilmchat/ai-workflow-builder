import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createTransport, type Transporter } from 'nodemailer';
import {
  buildInvitationHtml,
  buildInvitationSubject,
  buildInvitationText,
} from './email.templates.js';
import {
  EMAIL_INVITATION_JOB_OPTIONS,
  EMAIL_INVITATIONS_QUEUE,
  SEND_INVITATION_JOB,
  type EmailInvitationJobData,
} from './email.queue.js';
import { EmailOutboxService } from './email-outbox.service.js';

/** Порт SMTP по умолчанию (STARTTLS). */
const DEFAULT_SMTP_PORT = 587;
/** Адрес отправителя по умолчанию (если `SMTP_FROM` не задан). */
const DEFAULT_SMTP_FROM = 'noreply@workflow-builder.local';
/** Публичный адрес приложения по умолчанию (локальный запуск). */
const DEFAULT_APP_PUBLIC_URL = 'http://localhost:3000';
/**
 * Таймаут установки SMTP-соединения и приветствия, мс.
 *
 * С v1.2.0 S2 отправка выполняется воркером очереди `email-invitations`, а не
 * в HTTP-запросе, но таймауты всё равно нужны: зависший SMTP не должен
 * держать job (и его lock) минутами. 10 секунд на соединение — компромисс
 * между медленным внешним SMTP и скоростью повторов.
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
 * Сервис писем-приглашений в организацию (v1.1.0 S1; очередь — v1.2.0 S2).
 *
 * **Fallback обязателен.** SMTP — опциональная подсистема: если `SMTP_HOST` не
 * задан, приглашение всё равно создаётся в БД (`OrgMembersService`), а сервис
 * возвращает `false` и пишет WARN. Тот же контракт при сбое отправки
 * (недоступный SMTP, таймаут, отказ авторизации): HTTP-ручка не превращает
 * успешное приглашение в 500.
 *
 * **Отправка асинхронная (DESIGN V120 § 3.3).** `queueInvitationAsync` кладёт
 * задание в BullMQ и возвращает управление сразу; реальную отправку делает
 * `EmailProcessor` через `sendInvitationAsync`. Поэтому HTTP-запрос не ждёт
 * SMTP, а недоступный SMTP приводит к повторам задания (3 попытки,
 * экспоненциальный backoff), а не к потере письма.
 *
 * **Payload — в БД (v1.4.0 S3, KI-623).** В Redis уходит только `outboxId`
 * строки `email_outbox`: email, название организации и ссылка-приглашение
 * хранятся в БД. `EmailOutboxService` пишет снимок до постановки задания;
 * `EmailProcessor` читает его и обновляет статус.
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
   * @param queue - очередь `email-invitations` для асинхронной отправки
   * @param outbox - хранилище payload писем (v1.4.0 S3, KI-623)
   */
  constructor(
    private readonly config: ConfigService,
    @InjectQueue(EMAIL_INVITATIONS_QUEUE)
    private readonly queue: Queue<EmailInvitationJobData>,
    private readonly outbox: EmailOutboxService,
  ) {
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
   * Сохраняет письмо в `email_outbox` и ставит задание в очередь
   * `email-invitations` (v1.2.0 S2; outbox — v1.4.0 S3, KI-623).
   *
   * Возвращает управление сразу после `queue.add`: SMTP вызывается позже
   * `EmailProcessor`, поэтому HTTP-ручка приглашения не ждёт сеть и не зависит
   * от доступности почтового сервера. Недоступный SMTP не теряет письмо —
   * BullMQ повторит задание (`attempts: 3`, exponential backoff 5 с).
   *
   * Сначала INSERT в `email_outbox`, затем `queue.add` с одним `outboxId`.
   * Ошибка БД или Redis не роняет приглашение: приглашение уже в БД, метод
   * возвращает `false` и пишет ERROR (fallback DESIGN V120 § 3.3). Строка,
   * для которой не удалось поставить задание, помечается `failed`, чтобы её
   * было видно при разборе (повторная постановка — KI-624).
   *
   * @param to - email приглашённого (нормализованный)
   * @param orgName - название организации для темы и текста
   * @param inviteLink - абсолютная ссылка на регистрацию с `?invite=`
   * @returns `true`, если задание поставлено в очередь; `false` — не удалось
   */
  async queueInvitationAsync(
    to: string,
    orgName: string,
    inviteLink: string,
  ): Promise<boolean> {
    let outboxId: string;

    try {
      outboxId = await this.outbox.createAsync(to, orgName, inviteLink);
    } catch (error: unknown) {
      // Название организации в лог не пишем: у личной организации оно
      // содержит email владельца (PII, RULES 5.9).
      this.logger.error(
        `Не удалось сохранить письмо-приглашение в email_outbox (${maskEmail(to)}): ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      return false;
    }

    try {
      await this.queue.add(
        SEND_INVITATION_JOB,
        { outboxId },
        EMAIL_INVITATION_JOB_OPTIONS,
      );

      // Название организации в лог не пишем: у личной организации оно
      // содержит email владельца (PII, RULES 5.9).
      this.logger.log(
        `Письмо-приглашение поставлено в очередь ${EMAIL_INVITATIONS_QUEUE}: ${maskEmail(to)} (outbox ${outboxId})`,
      );

      return true;
    } catch (error: unknown) {
      // Ошибка Redis: приглашение уже создано в БД, письмо не поставлено.
      // Строку outbox помечаем failed, иначе она навсегда останется pending.
      try {
        await this.outbox.markFailedAsync(outboxId);
      } catch (markError: unknown) {
        this.logger.error(
          `Не удалось пометить email_outbox ${outboxId} как failed: ${
            markError instanceof Error ? markError.message : 'неизвестная ошибка'
          }`,
        );
      }

      this.logger.error(
        `Не удалось поставить письмо-приглашение в очередь ${EMAIL_INVITATIONS_QUEUE} (${maskEmail(to)}): ${
          error instanceof Error ? error.message : 'неизвестная ошибка'
        }`,
      );

      return false;
    }
  }

  /**
   * Отправляет письмо-приглашение в организацию.
   *
   * Вызывается `EmailProcessor` (воркером очереди), а не HTTP-ручкой: здесь
   * выполняется реальный SMTP-вызов. Никогда не бросает: сбой SMTP — это
   * `false` + ERROR в лог; воркер увидит `false`, выбросит ошибку и BullMQ
   * повторит job. Без `SMTP_HOST` — `false` + WARN, письмо не формируется.
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
        `Письмо-приглашение отправлено: ${maskEmail(to)}`,
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
