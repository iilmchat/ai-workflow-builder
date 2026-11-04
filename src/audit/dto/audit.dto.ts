import { z } from 'zod';

/**
 * Элемент журнала действий пользователей (`GET /admin/audit`, v1.0.0 S3).
 *
 * Лёгкая проекция строки `audit_logs`: журнал просматривает владелец
 * организации, и ему нужны автор, действие, затронутый ресурс и детали запроса.
 * Тяжёлых полей у таблицы нет (только `metadata` jsonb), поэтому проекция
 * практически совпадает со строкой БД; исключение — `cursor`.
 *
 * `createdAt` — `audit_logs.created_at`: момент записи действия в журнал.
 * `resourceId` — id затронутого объекта, если он известен (у действия может не
 * быть ресурса, например у неудачливого запроса он не пишется вовсе).
 */
export interface AuditLogSummary {
  /** uuid строки журнала. */
  id: string;
  /**
   * Непрозрачный курсор keyset-пагинации этого элемента.
   *
   * Содержит `createdAt` (µs-точность) + `id`; клиент передаёт курсор
   * последнего полученного элемента в `GET /admin/audit?cursor=…`, чтобы
   * получить следующую страницу. Формат — деталь реализации (см.
   * {@link encodeAuditCursor}), его можно менять без правок UI.
   */
  cursor: string;
  /** Когда действие было записано в журнал. */
  createdAt: Date;
  /** uuid пользователя, совершившего действие. */
  userId: string;
  /** uuid организации-арендатора, к которой относится запись. */
  organizationId: string;
  /** Код действия (`workflow.create`, `run.start`, …; см. `audit.constants.ts`). */
  action: string;
  /** uuid затронутого объекта; `null` — действие не привязано к ресурсу. */
  resourceId: string | null;
  /** Санитизированные детали запроса (метод, путь, params, тело, статус). */
  metadata: Record<string, unknown>;
}

/**
 * Ответ `GET /admin/audit` (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Пагинация — **keyset-курсором**, как в истории запусков (KI-542):
 * `nextCursor` — курсор следующей страницы (`null` — страниц больше нет).
 * Он вычисляется сервером по факту «есть ли ещё строки» (выборка `limit + 1`),
 * а не из `total`: между запросами в журнал добавляются новые записи, и
 * `total` может опережать страницу. UI навигируется только `nextCursor`, чтобы
 * не зациклиться на «Загрузить ещё».
 */
export interface AuditLogsResponse {
  /** Записи текущей страницы (сначала новые — по `createdAt DESC, id DESC`). */
  logs: AuditLogSummary[];
  /** Курсор следующей страницы либо `null`, если она пуста. */
  nextCursor: string | null;
  /** Всего записей журнала у организации (не зависит от страницы). */
  total: number;
}

/** Размер страницы журнала аудита по умолчанию. */
export const DEFAULT_AUDIT_LIMIT = 20;

/**
 * Максимальный размер страницы журнала аудита.
 *
 * Верхняя граница нужна, чтобы клиент не мог одним запросом вытянуть весь
 * журнал организации и загрузить БД/сеть.
 */
export const MAX_AUDIT_LIMIT = 100;

/**
 * Позиция keyset-пагинации журнала аудита (v1.0.0 S3).
 *
 * Упорядочивание — `createdAt DESC, id DESC`, поэтому позиция последнего
 * элемента однозначно задаёт начало следующей страницы даже при одинаковом
 * `created_at` (вторичный ключ `id`).
 */
export interface AuditCursor {
  /**
   * `audit_logs.created_at` последнего элемента страницы.
   *
   * **Строка ISO-8601 с микросекундами** (`YYYY-MM-DDTHH:MM:SS.ffffffZ`), а не
   * `Date`: `Date` хранит только миллисекунды, а `timestamptz` в PostgreSQL —
   * микросекунды. Потеря µs сломала бы сверку `created_at = cursor.createdAt`,
   * и записи, сделанные в одну миллисекунду, могли бы пропускаться (тот же
   * риск и то же решение, что в `run-history.dto.ts`, KI-542).
   */
  createdAt: string;
  /** `audit_logs.id` последнего элемента страницы (вторичный ключ). */
  id: string;
}

/**
 * Формат метки времени курсора: ISO-8601 UTC с 1–6 дробными цифрами.
 *
 * 3 цифры — совместимость с ms-курсорами; 6 — µs-точность из PostgreSQL.
 */
const CURSOR_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}Z$/;

/** Zod-схема «сырого» курсора: `{ c: ISO-дата с µs, i: uuid }`. */
const RawAuditCursorSchema = z.object({
  c: z
    .string()
    .regex(
      CURSOR_TIMESTAMP_PATTERN,
      'createdAt курсора должен быть ISO-8601 UTC с микросекундами',
    ),
  i: z.uuid(),
});

/**
 * Кодирует позицию keyset-пагинации журнала в непрозрачную строку.
 *
 * Формат — base64url от JSON `{ c: ISO-дата с µs, i: uuid }`: URL-безопасен,
 * компактен и не требует экранирования в query-параметре. Клиент не должен
 * разбирать курсор — только передавать его обратно.
 *
 * @param cursor - позиция последнего элемента страницы
 * @returns непрозрачный курсор для `?cursor=`
 */
export function encodeAuditCursor(cursor: AuditCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt, i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Декодирует курсор keyset-пагинации журнала аудита.
 *
 * @param value - значение `?cursor=` из запроса
 * @returns позиция последнего элемента предыдущей страницы (µs-точность)
 * @throws Error если строка не base64url/JSON, не соответствует схеме или
 *   содержит несуществующую дату
 */
export function decodeAuditCursor(value: string): AuditCursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (error: unknown) {
    throw new Error('некорректный cursor журнала аудита', { cause: error });
  }

  const result = RawAuditCursorSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error('некорректный cursor журнала аудита', {
      cause: result.error,
    });
  }

  // Дополнительно проверяем, что дата реальна (regex пропускает 2026-13-40).
  if (Number.isNaN(Date.parse(result.data.c))) {
    throw new Error('некорректный cursor журнала аудита');
  }

  return {
    createdAt: result.data.c,
    id: result.data.i,
  };
}

/**
 * Zod-схема курсора в query-параметрах.
 *
 * Проверяет и форму (непустая строка разумной длины), и декодируемость:
 * мусорный `cursor` — 400 от `ZodValidationPipe`, а не 500 из сервиса. Декодер
 * бросает `Error`, поэтому `refine` возвращает `false`, а не роняет валидацию
 * исключением.
 */
export const AuditCursorSchema = z
  .string()
  .trim()
  .min(1, 'cursor не может быть пустым')
  .max(512, 'cursor слишком длинный')
  .refine(
    (value) => {
      try {
        decodeAuditCursor(value);

        return true;
      } catch {
        return false;
      }
    },
    { message: 'cursor должен быть курсором из предыдущего ответа журнала' },
  );

/**
 * Фильтры журнала аудита (v1.1.0 S3, KI-585).
 *
 * Сервис принимает уже нормализованные значения (`from`/`to` — `Date`), а не
 * строки query: разбор и валидацию делает `AuditQuerySchema` на границе API
 * (RULES 1.17). Пустое поле означает «фильтра нет» — `undefined` отличается от
 * «фильтр по пустой строке», которого не бывает.
 *
 * `userId` — **автор действия**, а не текущий пользователь: владелец журнала
 * может посмотреть действия конкретного участника. Фильтр по пользователю не
 * расширяет видимость — организация всё равно берётся из БД по актору.
 */
export interface AuditFilter {
  /** Код действия (`workflow.create`, `run.start`, …). */
  readonly action?: string;
  /** uuid автора действия (`audit_logs.user_id`). */
  readonly userId?: string;
  /** Нижняя граница `created_at` включительно. */
  readonly from?: Date;
  /** Верхняя граница `created_at` включительно. */
  readonly to?: Date;
}

/**
 * Формат даты без времени: `YYYY-MM-DD`.
 *
 * UI использует `<input type="date">`, поэтому дата приходит без зоны. Такая
 * дата трактуется как UTC-сутки: `from` — начало дня, `to` — конец дня. UI
 * (S3) отправляет полные ISO-моменты локальных суток, поэтому пользователь
 * видит ожидаемое окно и в своём часовом поясе.
 */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Формат полного ISO-8601 с обязательной зоной (`Z` или `±HH:MM`). */
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Разбирает значение `from`/`to` в `Date` с проверкой календарной даты.
 *
 * `new Date('2026-02-30')` молча нормализуется в 2 марта, поэтому для
 * формата `YYYY-MM-DD` выполняется обратная проверка: ISO-строка должна
 * начинаться с исходной даты. Для полного ISO-8601 проверяется формат и
 * `Date.parse` (месяц/день вне диапазона дают `NaN`).
 *
 * @param value - значение query-параметра (`2026-11-01` или ISO-8601)
 * @param edge - `start` для `from` (начало суток), `end` для `to` (конец суток)
 * @returns момент времени либо `null`, если значение не является датой
 */
function parseAuditDate(value: string, edge: 'start' | 'end'): Date | null {
  if (DATE_ONLY_PATTERN.test(value)) {
    const iso =
      edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
    const date = new Date(iso);

    if (
      Number.isNaN(date.getTime()) ||
      !date.toISOString().startsWith(value)
    ) {
      return null;
    }

    return date;
  }

  if (!DATE_TIME_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Zod-схема даты фильтра: `YYYY-MM-DD` или ISO-8601, на выходе — `Date`.
 *
 * @param edge - `start` для `from`, `end` для `to`
 * @returns схема со строковым входом и `Date` на выходе
 */
function auditDateFilterSchema(edge: 'start' | 'end') {
  return z
    .string()
    .trim()
    .min(1, 'дата не может быть пустой')
    .transform((value, ctx) => {
      const parsed = parseAuditDate(value, edge);

      if (parsed === null) {
        ctx.addIssue({
          code: 'custom',
          message:
            'дата должна быть YYYY-MM-DD или ISO-8601 (например, 2026-11-01)',
        });

        return z.NEVER;
      }

      return parsed;
    });
}

/** Код действия: `<сущность>.<глагол>`, допускаются `_` в сегментах. */
const AUDIT_ACTION_VALUE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

/**
 * Zod-схема query-параметров `GET /admin/audit` (v1.0.0 S3; фильтры — v1.1.0 S3).
 *
 * `limit` приходит строкой, поэтому приводится через `z.coerce` (тот же приём,
 * что в `RunHistoryQuerySchema`/`ListWorkflowsQuerySchema`). `cursor`
 * опционален: его отсутствие — первая страница.
 *
 * Фильтры (KI-585) — `action` (точный код действия), `userId` (uuid автора),
 * `from`/`to` (границы `created_at` включительно). Домен `action` намеренно не
 * ограничен списком `AUDIT_ACTIONS`: интерсептор пишет fallback `http.<метод>`,
 * а новое действие не должно требовать правки валидатора (формат проверяется,
 * значение — нет). Если `from` позже `to`, запрос отклоняется 400, а не
 * возвращает пустую страницу «молча».
 */
export const AuditQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int('limit должен быть целым числом')
      .min(1, 'limit должен быть не меньше 1')
      .max(MAX_AUDIT_LIMIT, `limit не больше ${MAX_AUDIT_LIMIT}`)
      .default(DEFAULT_AUDIT_LIMIT),
    cursor: AuditCursorSchema.optional(),
    action: z
      .string()
      .trim()
      .min(1, 'action не может быть пустым')
      .max(128, 'action слишком длинный')
      .regex(
        AUDIT_ACTION_VALUE_PATTERN,
        'action должен быть кодом вида workflow.create',
      )
      .optional(),
    userId: z.uuid('userId должен быть uuid').optional(),
    from: auditDateFilterSchema('start').optional(),
    to: auditDateFilterSchema('end').optional(),
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.from.getTime() <= query.to.getTime(),
    { message: 'from не может быть позже to', path: ['from'] },
  );

/** Валидированные query-параметры журнала аудита. */
export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;
