import { z } from 'zod';
import { requestAsync } from './api';

/**
 * Запись журнала аудита (`GET /admin/audit`, v1.0.0 S3/S5).
 *
 * Зеркало backend `AuditLogSummary`; паритет состава полей проверяет
 * `api-contract.spec.ts` через `docs/development/api-contract.json`.
 *
 * - `cursor` — непрозрачный ключ keyset-пагинации (как у истории запусков,
 *   v0.16 S1): следующая страница запрашивается по курсору последней записи,
 *   а не по offset; появление новых записей не сдвигает окно.
 * - `action` — код действия (`workflow.create`, `run.start`, …) или fallback
 *   `http.<метод>`; подпись для него UI ищет в `audit.action.<код>`, а при
 *   отсутствии перевода показывает сам код (см. `TeamPage`).
 * - `resourceId` — идентификатор затронутой сущности (`null` — действие без
 *   конкретного ресурса, например вход в систему).
 * - `metadata` — произвольные детали действия (JSONB из БД). Поля не
 *   типизированы: UI их не разбирает, а показывает только журнал целиком.
 */
export const AuditLogSchema = z.object({
  id: z.string(),
  cursor: z.string(),
  createdAt: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  action: z.string(),
  resourceId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

/** Запись журнала аудита в терминах API. */
export type AuditLog = z.infer<typeof AuditLogSchema>;

/**
 * Ответ `GET /admin/audit` — страница журнала (v1.0.0 S5).
 *
 * `nextCursor` — курсор следующей страницы (`null` — страниц больше нет);
 * `total` — общее число записей журнала организации (для счётчика «Показано
 * N из M»). Сервер вычисляет `nextCursor` по факту наличия строк, поэтому UI
 * не опирается на `total`: между запросами записей может стать больше.
 */
export const AuditLogsResponseSchema = z.object({
  logs: z.array(AuditLogSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

/** Страница журнала аудита в терминах API. */
export type AuditLogsResponse = z.infer<typeof AuditLogsResponseSchema>;

/**
 * Возвращает страницу журнала аудита организации (`GET /admin/audit`,
 * v1.0.0 S5).
 *
 * Доступно владельцу и администратору: остальным backend отвечает 403, и UI не
 * открывает вкладку «Аудит». `limit`/`cursor` уходят query-параметрами; первая
 * страница запрашивается без курсора, следующая — по `nextCursor` предыдущей.
 *
 * @param limit - размер страницы (по умолчанию 20)
 * @param cursor - курсор следующей страницы; `null`/не задан — первая страница
 * @returns страница журнала: `logs` (сначала новые), `nextCursor` и `total`
 * @throws ApiError при сетевой ошибке, 401/403 (нет прав) или неожиданном
 *   формате ответа
 */
export async function fetchAuditLogsAsync(
  limit = 20,
  cursor: string | null = null,
): Promise<AuditLogsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });

  // Курсор добавляется только когда он есть: `cursor=null` строка ушла бы на
  // backend как невалидное значение и вернула 400.
  if (cursor !== null) {
    params.set('cursor', cursor);
  }

  const data = await requestAsync<unknown>(`/admin/audit?${params.toString()}`);

  return AuditLogsResponseSchema.parse(data);
}
