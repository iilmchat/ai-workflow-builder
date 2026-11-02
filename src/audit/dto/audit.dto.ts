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
 * Zod-схема query-параметров `GET /admin/audit` (v1.0.0 S3).
 *
 * `limit` приходит строкой, поэтому приводится через `z.coerce` (тот же приём,
 * что в `RunHistoryQuerySchema`/`ListWorkflowsQuerySchema`). `cursor`
 * опционален: его отсутствие — первая страница.
 */
export const AuditQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int('limit должен быть целым числом')
    .min(1, 'limit должен быть не меньше 1')
    .max(MAX_AUDIT_LIMIT, `limit не больше ${MAX_AUDIT_LIMIT}`)
    .default(DEFAULT_AUDIT_LIMIT),
  cursor: AuditCursorSchema.optional(),
});

/** Валидированные query-параметры журнала аудита. */
export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;
