import type { JobsOptions, QueueOptions, ConnectionOptions } from 'bullmq';
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';

/**
 * Имя очереди BullMQ для писем-приглашений (v1.2.0 S2, DESIGN V120 § 3.3).
 *
 * Вынесено в отдельный модуль (как `WORKFLOW_RUNS_QUEUE`), чтобы имя не
 * дублировалось между сервисом (постановка), процессором (обработка) и
 * модулем (`registerQueue`).
 */
export const EMAIL_INVITATIONS_QUEUE = 'email-invitations';

/** Имя задания внутри очереди {@link EMAIL_INVITATIONS_QUEUE}. */
export const SEND_INVITATION_JOB = 'send-invitation';

/**
 * Данные задания «отправить письмо-приглашение» (v1.4.0 S3, KI-623).
 *
 * В Redis лежит **только идентификатор** строки `email_outbox`: email
 * приглашённого, название организации и ссылка-приглашение хранятся в БД.
 * Раньше payload был сериализуемым снимком `{ to, orgName, inviteLink }`, и
 * пока job жил в Redis (сутки/неделю по `removeOn*`), PII и одноразовый
 * секрет-ссылка были доступны любому с доступом к Redis/дампу (KI-623).
 */
export interface EmailInvitationJobData {
  /** uuid строки `email_outbox` с payload письма. */
  outboxId: string;
}

/**
 * Zod-схема payload задания (RULES 1.17).
 *
 * Данные приходят из Redis, то есть из внешнего хранилища: даже если продюсер
 * пишет их по типу, задание могло быть создано старой версией кода или
 * повреждено. Валидация на границе воркера даёт понятную ошибку вместо
 * SQL-запроса с `undefined`.
 */
export const EmailInvitationJobSchema = z.object({
  /** Ссылка на строку outbox; проверяется как uuid до запроса в БД. */
  outboxId: z.uuid('некорректный outboxId в задании'),
});

/**
 * Zod-схема payload письма, прочитанного из `email_outbox` (RULES 1.17).
 *
 * БД — тоже граница: строку могла оставить старая версия кода, а миграция или
 * ручная правка — повредить. Проверяем те же поля, что раньше проверялись в
 * payload задания: email, непустое имя организации и http(s)-ссылку.
 */
export const EmailInvitationPayloadSchema = z.object({
  /** Email приглашённого; формат проверяется до SMTP. */
  to: z.email('некорректный email в email_outbox').max(320),
  /** Название организации: непустое, с разумным пределом. */
  orgName: z.string().trim().min(1).max(200),
  /** Ссылка приглашения: только http(s), иначе письмо уведёт не туда. */
  inviteLink: z
    .url({ protocol: /^https?$/ })
    .max(2048),
});

/** Валидированные данные задания. */
export type EmailInvitationJob = z.infer<typeof EmailInvitationJobSchema>;

/** Валидированный payload письма из `email_outbox`. */
export type EmailInvitationPayload = z.infer<typeof EmailInvitationPayloadSchema>;

/**
 * Опции задания очереди `email-invitations` (DESIGN V120 § 3.3).
 *
 * `attempts: 3` — первая попытка + два повтора; `backoff: exponential 5000` —
 * паузы 5 и 10 секунд. Это компромисс: короткий сбой SMTP (перезапуск,
 * временная 4xx-ошибка) переживаем, но job не «висит» в очереди часами.
 * `removeOnComplete`/`removeOnFail` ограничивают рост Redis. С v1.4.0 S3
 * payload содержит только `outboxId` (PII — в БД, KI-623), но лимиты
 * сохраняются: история заданий нужна для диагностики доставки, а не вечно.
 */
export const EMAIL_INVITATION_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // Успешные задания храним сутки / до 100 штук — для диагностики доставки.
  removeOnComplete: { count: 100, age: 24 * 3600 },
  // Упавшие — неделю / до 500 штук: разбор инцидентов и повтор вручную.
  removeOnFail: { count: 500, age: 7 * 24 * 3600 },
};

/** Префикс очередей по умолчанию (совпадает с дефолтом env-схемы `BULLMQ_PREFIX`). */
const DEFAULT_QUEUE_PREFIX = 'workflow-runs';

/** Номер БД Redis по умолчанию (совпадает с дефолтом `REDIS_QUEUE_DB`). */
const DEFAULT_QUEUE_DB = 0;

/**
 * Собирает опции очереди `email-invitations` из окружения.
 *
 * `prefix` и `db` должны совпадать с очередью workflow-runs (KI-387): оба
 * продюсера и воркера одного инстанса смотрят в одно пространство ключей, а
 * параллельные инстансы (dev/smoke/prod) не забирают чужие письма. Очередь
 * регистрируется асинхронно, потому что `ConfigService` доступен только через
 * DI, а не на этапе объявления декоратора.
 *
 * @param config - валидированная конфигурация (REDIS_URL, BULLMQ_PREFIX,
 *   REDIS_QUEUE_DB)
 * @returns опции `BullModule.registerQueueAsync`
 * @throws Error если `REDIS_URL` не задан (fail-fast при старте)
 */
export function createEmailQueueOptions(config: ConfigService): QueueOptions {
  const connection: ConnectionOptions = {
    url: config.getOrThrow<string>('REDIS_URL'),
    db: config.get<number>('REDIS_QUEUE_DB') ?? DEFAULT_QUEUE_DB,
  };

  return {
    prefix: config.get<string>('BULLMQ_PREFIX') ?? DEFAULT_QUEUE_PREFIX,
    connection,
    defaultJobOptions: EMAIL_INVITATION_JOB_OPTIONS,
  };
}
