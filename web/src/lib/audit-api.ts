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
 * Фильтры журнала аудита (`GET /admin/audit`, v1.1.0 S3, KI-585).
 *
 * Все поля опциональны; `from`/`to` — **полные ISO-8601-моменты** (не
 * `YYYY-MM-DD`): границы локальных суток вычисляет UI (`TeamPage`), чтобы
 * фильтр «с 1 ноября» означал 1 ноября по часовому поясу пользователя, а не
 * UTC. Пустая строка не отправляется — сервис считает отсутствие параметра
 * «фильтра нет».
 */
export interface AuditLogFilters {
  /** Точный код действия (`workflow.create`, `http.post`, …). */
  action?: string;
  /** uuid автора действия. */
  userId?: string;
  /** Нижняя граница `createdAt` включительно (ISO-8601). */
  from?: string;
  /** Верхняя граница `createdAt` включительно (ISO-8601). */
  to?: string;
}

/**
 * Действия, доступные в селекте фильтра (v1.1.0 S3).
 *
 * Источник — backend `src/audit/audit.constants.ts` (`AUDIT_ACTIONS`) плюс
 * fallback-коды интерсептора `http.post|patch|delete`. Список захардкожен
 * осознанно (DESIGN V110 § 3.3 разрешает оба варианта): отдельная ручка
 * `GET /admin/audit/actions` стоила бы нового DTO и паритет-гейта ради
 * статического массива. Цена — новое действие backend'а не появится в селекте
 * до правки этого списка (KI-605): в журнале оно всё равно отображается
 * (fallback на сырой код), а фильтр по нему можно передать вручную.
 */
export const AUDIT_ACTION_FILTER_OPTIONS = [
  'workflow.create',
  'workflow.import',
  'workflow.update',
  'workflow.delete',
  'workflow.share',
  'workflow.unshare',
  'workflow.instantiate',
  'collaborator.invite',
  'collaborator.update',
  'collaborator.remove',
  'document_template.create',
  'document_template.delete',
  'member.invite',
  'member.role_change',
  'member.remove',
  'run.start',
  'http.post',
  'http.patch',
  'http.delete',
] as const;

/**
 * Возвращает страницу журнала аудита организации (`GET /admin/audit`,
 * v1.0.0 S5; фильтры — v1.1.0 S3).
 *
 * Доступно владельцу и администратору: остальным backend отвечает 403, и UI не
 * открывает вкладку «Аудит». `limit`/`cursor`/фильтры уходят query-параметрами;
 * первая страница запрашивается без курсора, следующая — по `nextCursor`
 * предыдущей (фильтры при этом те же: иначе вторая страница была бы из другого
 * набора строк).
 *
 * @param limit - размер страницы (по умолчанию 20)
 * @param cursor - курсор следующей страницы; `null`/не задан — первая страница
 * @param filters - фильтры `action`/`userId`/`from`/`to`; пустые не отправляются
 * @returns страница журнала: `logs` (сначала новые), `nextCursor` и `total`
 * @throws ApiError при сетевой ошибке, 401/403 (нет прав), 400 (невалидные
 *   фильтры) или неожиданном формате ответа
 */
export async function fetchAuditLogsAsync(
  limit = 20,
  cursor: string | null = null,
  filters: AuditLogFilters = {},
): Promise<AuditLogsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });

  // Курсор добавляется только когда он есть: `cursor=null` строка ушла бы на
  // backend как невалидное значение и вернула 400.
  if (cursor !== null) {
    params.set('cursor', cursor);
  }

  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') {
      params.set(key, value);
    }
  }

  const data = await requestAsync<unknown>(`/admin/audit?${params.toString()}`);

  return AuditLogsResponseSchema.parse(data);
}
