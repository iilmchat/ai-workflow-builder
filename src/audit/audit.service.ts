import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { auditLogs, users } from '../db/schema.js';
import {
  encodeAuditCursor,
  MAX_AUDIT_LIMIT,
  type AuditCursor,
  type AuditFilter,
  type AuditLogSummary,
  type AuditLogsResponse,
} from './dto/audit.dto.js';

/**
 * Запись, которую `AuditInterceptor` сохраняет в журнал (v1.0.0 S3).
 *
 * `organizationId` — арендатор, **сверенный с БД** (v1.1.0 S5, KI-605):
 * `JwtAuthGuard` читает `users.organization_id` и обновляет payload, поэтому
 * устаревший `orgId` из access-токена в журнал не попадает. `resourceId` — id
 * затронутого объекта, если он известен; `metadata` уже санитизирован
 * интерсептором (без паролей/токенов, с ограничением размера; email в
 * действиях состава маскируется, KI-589).
 */
export interface AuditEntry {
  /** uuid пользователя, совершившего действие. */
  readonly userId: string;
  /** uuid организации-арендатора, к журналу которой относится запись. */
  readonly organizationId: string;
  /** Код действия (`workflow.create`, `run.start`, …). */
  readonly action: string;
  /** uuid затронутого объекта; `null` — действие не привязано к ресурсу. */
  readonly resourceId: string | null;
  /** Санитизированные детали запроса для `audit_logs.metadata`. */
  readonly metadata: Record<string, unknown>;
}

/**
 * Подмножество колонок `audit_logs`, которое читает список журнала.
 *
 * `cursorCreatedAt` — `created_at` с микросекундной точностью из SQL
 * (`to_char(..., 'US')`): `Date` хранит только миллисекунды, а для
 * keyset-курсора нужна позиция, совпадающая с БД. Необязательность — для
 * тестовых моков без этого поля (тогда fallback на ms-ISO).
 */
interface AuditLogRow {
  /** uuid строки журнала. */
  id: string;
  /** Дата записи (JS Date, точность — мс). */
  createdAt: Date;
  /** `created_at` с точностью микросекунд (ISO-8601 UTC) для курсора. */
  cursorCreatedAt?: string;
  /** uuid автора действия. */
  userId: string;
  /** uuid организации-арендатора. */
  organizationId: string;
  /** Код действия. */
  action: string;
  /** uuid затронутого объекта или `null`. */
  resourceId: string | null;
  /** Санитизированные детали запроса. */
  metadata: Record<string, unknown>;
}

/**
 * Сервис журнала аудита (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Отвечает за две операции: запись действия ({@link recordAsync}) и чтение
 * журнала организации с keyset-пагинацией ({@link listAsync}). Запись вызывает
 * глобальный `AuditInterceptor` после успешного мутирующего HTTP-запроса;
 * чтение — `GET /admin/audit` (доступ проверяют guard'ы контроллера).
 *
 * Таблица `audit_logs` append-only: сервис не обновляет и не удаляет строки,
 * только вставляет и читает. Изоляция арендаторов — на уровне SQL: список
 * всегда фильтруется по `organization_id`, прочитанному из `users` по `sub`
 * access-токена (v1.1.0 S3, KI-587), а не по `orgId` из самого токена.
 */
@Injectable()
export class AuditService {
  /**
   * @param db - соединение Drizzle (инъекция по токену {@link DRIZZLE})
   */
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Записывает действие пользователя в журнал аудита.
   *
   * Вызывается интерсептором **после** успешного выполнения запроса; ошибка
   * INSERT'а не должна ломать исходный HTTP-ответ, поэтому catch — на стороне
   * интерсептора (RULES 4.18), а сервис лишь пробрасывает сбой наверх.
   *
   * @param entry - данные действия: автор, арендатор, код, ресурс, metadata
   * @returns промис без значения (строка вставлена)
   * @throws Error если INSERT не выполнен (БД недоступна, нарушены ограничения)
   */
  async recordAsync(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLogs).values({
      userId: entry.userId,
      organizationId: entry.organizationId,
      action: entry.action,
      resourceId: entry.resourceId,
      metadata: entry.metadata,
    });
  }

  /**
   * Возвращает страницу журнала аудита организации (`GET /admin/audit`).
   *
   * **Изоляция и KI-587.** Организация резолвится из `users` по `userId`
   * (`sub` access-токена), а не берётся из `JwtPayload.orgId`. Токен живёт
   * 24 часа, и после переезда пользователя в другую организацию (или удаления
   * из неё) `orgId` в токене устаревает: чтение журнала старой организации было
   * бы доступно до истечения токена. Теперь `WHERE` всегда содержит
   * `audit_logs.organization_id = <organization_id из БД>` (KI-587, KI-601).
   *
   * **Фильтры (KI-585).** `action`, `userId` (автор действия), `from` и `to`
   * добавляются в тот же `WHERE`, что и org-условие, — и в страницу, и в
   * `count(*)`. Поэтому `total` описывает отфильтрованный журнал, а не всю
   * организацию. Фильтр `userId` не расширяет видимость: организация всё равно
   * берётся из БД по актору.
   *
   * **Keyset-пагинация (как в истории запусков, KI-542).** Порядок —
   * `created_at DESC, id DESC`; курсор задаёт позицию последнего элемента
   * предыдущей страницы, поэтому новые записи между запросами не сдвигают
   * окно. Признак «есть ещё» — выборка `limit + 1`; `nextCursor` равен `null`,
   * когда следующая страница пуста. `total` — отдельный `count(*)` по тому же
   * предикату и не зависит от страницы.
   *
   * `cursor.createdAt` несёт микросекунды: `Date` их теряет, а без точного
   * совпадения `created_at` tie-break по `id` мог бы пропускать строки,
   * созданные в одну миллисекунду.
   *
   * @param userId - `sub` access-токена (id пользователя)
   * @param limit - размер страницы (1..{@link MAX_AUDIT_LIMIT})
   * @param cursor - позиция последнего элемента предыдущей страницы;
   *   `undefined` — первая страница
   * @param filter - фильтры `action`/`userId`/`from`/`to` (v1.1.0 S3)
   * @returns записи страницы, курсор следующей страницы и общее число записей
   * @throws BadRequestException если `cursor.createdAt` — невалидная дата
   * @throws UnauthorizedException если строки `users` с таким id нет (гонка с
   *   удалением между guard'ом и сервисом; guard отвечает 401 раньше)
   */
  async listAsync(
    userId: string,
    limit: number,
    cursor?: AuditCursor,
    filter: AuditFilter = {},
  ): Promise<AuditLogsResponse> {
    // Контроллер валидирует limit Zod-схемой, но сервис — вторая граница
    // (RULES 1.17): огромный limit вытянул бы весь журнал организации.
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_AUDIT_LIMIT);

    if (cursor !== undefined && Number.isNaN(Date.parse(cursor.createdAt))) {
      // Zod отсекает мусор на границе API; здесь — защита от вызова сервиса
      // в обход контроллера: с невалидной датой SQL молча вернул бы пустую
      // страницу вместо ошибки.
      throw new BadRequestException('некорректный cursor журнала аудита');
    }

    // Арендатор — из БД, а не из токена (KI-587): organization_id читается по
    // sub, поэтому устаревший orgId в JWT не может открыть чужой/старый журнал.
    const [actor] = await this.db
      .select({ organizationId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (actor === undefined) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    // Общий предикат count и страницы: org-граница + фильтры (KI-585). total
    // считается по нему, иначе счётчик показывал бы записи вне фильтра.
    const filterConditions: SQL[] = [
      eq(auditLogs.organizationId, actor.organizationId),
    ];

    if (filter.action !== undefined) {
      filterConditions.push(eq(auditLogs.action, filter.action));
    }

    if (filter.userId !== undefined) {
      filterConditions.push(eq(auditLogs.userId, filter.userId));
    }

    if (filter.from !== undefined) {
      filterConditions.push(gte(auditLogs.createdAt, filter.from));
    }

    if (filter.to !== undefined) {
      filterConditions.push(lte(auditLogs.createdAt, filter.to));
    }

    const listFilter = and(...filterConditions) ?? eq(
      auditLogs.organizationId,
      actor.organizationId,
    );

    const pageFilter =
      cursor === undefined
        ? listFilter
        : and(
            listFilter,
            // Строго после последнего элемента: при `created_at DESC, id DESC`
            // следующая страница — это (created_at, id) < (cursor.createdAt,
            // cursor.id). Курсор несёт µs, поэтому tie-break по id сохраняется.
            or(
              sql`${auditLogs.createdAt} < ${cursor.createdAt}::timestamptz`,
              and(
                sql`${auditLogs.createdAt} = ${cursor.createdAt}::timestamptz`,
                lt(auditLogs.id, cursor.id),
              ),
            ),
          ) ?? listFilter;

    // total не зависит от страницы: счётчик UI не должен «прыгать» при
    // пагинации (и visible на пустой странице).
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(listFilter);

    const total = countRow?.total ?? 0;

    const rows: AuditLogRow[] = await this.db
      .select({
        id: auditLogs.id,
        createdAt: auditLogs.createdAt,
        // `to_char` с `US` сохраняет микросекунды PostgreSQL: `Date` их теряет,
        // а keyset-курсору нужна точная позиция (см. AuditLogRow).
        cursorCreatedAt: sql<string>`to_char(${auditLogs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        userId: auditLogs.userId,
        organizationId: auditLogs.organizationId,
        action: auditLogs.action,
        resourceId: auditLogs.resourceId,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(pageFilter)
      // Стабильная сортировка: `id` — вторичный ключ, иначе записи, сделанные
      // в одну миллисекунду, «плавали» бы между страницами.
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      // +1 строка — чтобы отличить последнюю страницу от «есть ещё», не
      // полагаясь на total (он меняется с каждой новой записью). Лишняя строка
      // в ответ не попадает.
      .limit(safeLimit + 1);

    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow !== undefined
        ? encodeAuditCursor({
            createdAt: lastRow.cursorCreatedAt ?? lastRow.createdAt.toISOString(),
            id: lastRow.id,
          })
        : null;

    return {
      logs: pageRows.map((row) => toAuditLogSummary(row)),
      nextCursor,
      total,
    };
  }
}

/**
 * Преобразует строку `audit_logs` в публичный элемент журнала.
 *
 * Курсор элемента собирается из µs-точности SQL (`cursorCreatedAt`), а
 * fallback на ms-ISO остаётся только для тестовых моков без этого поля.
 *
 * @param row - подмножество колонок `audit_logs`
 * @returns публичный элемент журнала с собственным курсором
 */
function toAuditLogSummary(row: AuditLogRow): AuditLogSummary {
  return {
    id: row.id,
    cursor: encodeAuditCursor({
      createdAt: row.cursorCreatedAt ?? row.createdAt.toISOString(),
      id: row.id,
    }),
    createdAt: row.createdAt,
    userId: row.userId,
    organizationId: row.organizationId,
    action: row.action,
    resourceId: row.resourceId,
    metadata: row.metadata,
  };
}
