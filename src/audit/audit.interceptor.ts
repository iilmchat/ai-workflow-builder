import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { toWorkflowAccess } from '../workflow/workflow-access.js';
import { resolveAuditAction } from './audit.constants.js';
import { AuditService, type AuditEntry } from './audit.service.js';

/** Методы, которые считаются мутирующими (только они попадают в аудит). */
const AUDITED_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/**
 * Префикс аутентификации: запросы `/auth/*` в S3 не аудируются.
 *
 * Причина — в момент `POST /auth/register|login|refresh|logout` `request.user`
 * ещё не существует (guard аутентификации их не защищает, payload только
 * формируется), а тело содержит пароль/refresh-токен. Аудит логина — задача
 * отдельного сервисного вызова (DESIGN § 2.2), а не HTTP-интерсептора: писать
 * нечего (нет автора) и опасно (тело — секрет).
 */
const AUTH_PATH_PATTERN = /^\/auth(?:\/|$)/;

/** Ключи, значения которых никогда не попадают в журнал (RULES § 5). */
const SECRET_KEY_PATTERN = /password|token|secret|api[_-]?key|authorization|cookie/i;

/** Максимальный размер JSON-представления тела запроса в metadata — 16 KiB. */
const MAX_AUDIT_BODY_BYTES = 16 * 1024;

/** Максимальная глубина обхода тела при санитизации (защита от «дерева»). */
const MAX_AUDIT_BODY_DEPTH = 8;

/** Формат uuid: resourceId пишется в uuid-колонку `audit_logs.resource_id`. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Минимальный контракт запроса, нужный интерсептору (без `any`, RULES 4.15).
 *
 * Поля необязательны там, где Nest/Express их не гарантируют в тестовом
 * контексте; `user` заполняет `JwtAuthGuard` до интерсептора.
 */
interface AuditRequest {
  /** HTTP-метод запроса. */
  readonly method: string;
  /** Путь запроса без query-строки (Express `request.path`). */
  readonly path?: string;
  /** Полный исходный URL (fallback для `path`). */
  readonly originalUrl?: string;
  /** Path-параметры маршрута (`id`, `userId`, `templateId`, …). */
  readonly params?: Record<string, string | undefined>;
  /** Тело запроса (уже распарсенное Express). */
  readonly body?: unknown;
  /** Payload access-токена, заполненный `JwtAuthGuard`. */
  readonly user?: JwtPayload;
}

/** Минимальный контракт ответа: интерсептору нужен только статус. */
interface AuditResponse {
  /** Итоговый HTTP-статус обработчика (`@HttpCode` применён до интерсептора). */
  readonly statusCode: number;
}

/**
 * Глобальный интерсептор журнала аудита (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Перехватывает **успешные** мутирующие запросы (`POST`/`PATCH`/`DELETE`) и
 * пишет запись в `audit_logs`: автора и организацию берёт из access-токена
 * (`request.user`), действие — из метода и фактического пути
 * ({@link resolveAuditAction}), ресурс — из тела ответа (`.id`) либо из
 * path-параметра `id`, детали — из санитизированного запроса.
 *
 * **Почему только успешные.** Запись делается в `tap(next)` — после того как
 * обработчик вернул результат. Если запрос упал (4xx/5xx), записи нет: журнал
 * фиксирует действия, а не попытки (неудачный вход аудируется отдельно, S5).
 *
 * **Почему ошибки аудита не влияют на ответ (RULES 4.18).** Запись —
 * fire-and-forget: сбой INSERT'а только логируется через `Logger.warn` и не
 * меняет исходный observable, поэтому недоступность журнала не ломает
 * пользовательские операции.
 *
 * **Что не пишется.** GET/HEAD/OPTIONS, `/auth/*` (нет автора, в теле секреты —
 * см. {@link AUTH_PATH_PATTERN}) и запросы без `request.user` (публичные ручки,
 * например `POST /workflow/share/:token` не существует, но share-ссылки
 * бывают) пропускаются без обращения к БД.
 *
 * Тело копируется и очищается глубоко: ключи, похожие на пароль/токен/секрет/
 * API-ключ/authorization/cookie, удаляются на любом уровне вложенности; глубина
 * ограничена, а JSON длиннее 16 KiB заменяется маркером `{ truncated, bytes }`.
 * Оригинальное тело запроса не мутируется.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  /**
   * @param auditService - сервис записи в журнал аудита
   */
  constructor(private readonly auditService: AuditService) {}

  /**
   * Оборачивает выполнение обработчика записью в журнал (только успех).
   *
   * Возвращает **исходный** observable: интерсептор не подменяет поток и не
   * читает его заранее (иначе SSE/файловые ответы сломались бы). Запись
   * выполняется при `next`-событии, ошибки обработчика пробрасываются как есть.
   *
   * @param context - контекст выполнения Nest (HTTP)
   * @param next - следующий обработчик цепочки
   * @returns исходный поток ответа без изменений
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuditRequest>();
    const method = request.method.toUpperCase();

    if (!AUDITED_METHODS.has(method)) {
      return next.handle();
    }

    const path = readRequestPath(request);

    // `/auth/*`: нет автора (register/login) и в теле пароль/refresh-токен.
    // Явная проверка нужна, даже если user уже появился: такие ручки не
    // аудируются интерсептором по решению S3.
    if (AUTH_PATH_PATTERN.test(path)) {
      return next.handle();
    }

    // Публичные ручки и запросы без аутентификации не журналируются: писать
    // нечего (нет userId/organizationId) и некуда (NOT NULL-колонки).
    if (request.user === undefined) {
      return next.handle();
    }

    const response = http.getResponse<AuditResponse>();
    const user = request.user;

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          // `tap` не умеет await: запись стартует и не задерживает ответ.
          // `void` — осознанный fire-and-forget (ошибки поглощены внутри).
          void this.auditAsync(
            user,
            method,
            path,
            request,
            body,
            response.statusCode,
          );
        },
      }),
    );
  }

  /**
   * Собирает запись и отправляет её в сервис, не влияя на ответ.
   *
   * Синхронные и асинхронные сбои аудита только логируются (RULES 4.18):
   * журнал — вспомогательная подсистема, его сбой не должен ронять операцию.
   *
   * @param user - payload access-токена (автор действия)
   * @param method - HTTP-метод (верхний регистр)
   * @param path - нормализованный путь запроса
   * @param request - исходный запрос (params/body)
   * @param body - тело ответа обработчика (для поиска `.id`)
   * @param statusCode - итоговый HTTP-статус ответа
   * @returns промис без значения; ошибки записи поглощены и залогированы
   */
  private async auditAsync(
    user: JwtPayload,
    method: string,
    path: string,
    request: AuditRequest,
    body: unknown,
    statusCode: number,
  ): Promise<void> {
    try {
      const access = toWorkflowAccess(user);
      const params = request.params ?? {};

      const entry: AuditEntry = {
        userId: access.userId,
        organizationId: access.orgId,
        action: resolveAuditAction(method, path),
        resourceId: resolveResourceId(body, params),
        metadata: {
          method,
          path,
          params: { ...params },
          body: sanitizeAuditBody(request.body),
          statusCode,
        },
      };

      await this.auditService.recordAsync(entry);
    } catch (error: unknown) {
      // Сбой аудита (сборка записи или INSERT) не должен менять исход
      // пользовательской операции: только технический лог (RULES 4.18).
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Не удалось записать действие в журнал аудита: ${message}`);
    }
  }
}

/**
 * Достаёт путь запроса без query-строки и хэша.
 *
 * `request.path` в Express уже без query, но в тестовом контексте/некоторых
 * адаптерах поля может не быть — тогда используется `originalUrl`. Ведущий
 * слэш гарантируется: по нему работают и префикс `/auth`, и шаблоны действий.
 *
 * @param request - запрос интерсептора
 * @returns путь запроса с ведущим слэшем (без query-строки)
 */
function readRequestPath(request: AuditRequest): string {
  const raw =
    request.path !== undefined && request.path.length > 0
      ? request.path
      : (request.originalUrl ?? '');
  const pathname = raw.split('?')[0].split('#')[0];

  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

/**
 * Определяет id затронутого ресурса для `audit_logs.resource_id`.
 *
 * Приоритет — тело ответа (`.id`), затем path-параметр `id`: тело надёжнее для
 * создания (id генерирует БД), параметр — для удаления/обновления, где тело
 * ответа пустое (204) или не содержит id. Значение обязано быть uuid: колонка
 * uuid, а мусор из ответа не должен ронять весь аудит.
 *
 * @param body - тело ответа обработчика
 * @param params - path-параметры запроса
 * @returns uuid ресурса либо `null`, если id не найден/невалиден
 */
function resolveResourceId(
  body: unknown,
  params: Record<string, string | undefined>,
): string | null {
  if (body !== null && typeof body === 'object' && 'id' in body) {
    const bodyId = (body as { id?: unknown }).id;

    if (typeof bodyId === 'string' && UUID_PATTERN.test(bodyId)) {
      return bodyId;
    }
  }

  const paramId = params['id'];

  return typeof paramId === 'string' && UUID_PATTERN.test(paramId) ? paramId : null;
}

/**
 * Санитизирует тело запроса для `audit_logs.metadata`.
 *
 * Тело не мутируется: строится глубокая копия, из которой на любом уровне
 * вложенности удаляются ключи по {@link SECRET_KEY_PATTERN}. Если JSON
 * результата длиннее 16 KiB, он заменяется маркером `{ truncated: true,
 * bytes }`: журнал не должен раздуваться телами загрузок/больших графов, но
 * факт и размер обрезанного тела сохраняются.
 *
 * @param body - тело запроса (любой JSON-совместимый тип)
 * @returns безопасная копия тела, маркер усечения либо исходный примитив
 */
function sanitizeAuditBody(body: unknown): unknown {
  const sanitized = sanitizeValue(body, 0);

  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    // Циклические ссылки/BigInt в теле не должны ронять аудит: пишем только
    // факт усечения, а сам запрос не страдает.
    return { truncated: true, bytes: 0 };
  }

  if (serialized === undefined) {
    // `undefined`/функции: JSON их не сериализует, метаданные останутся без
    // ключа `body` — это ожидаемо для запросов без тела.
    return sanitized;
  }

  const bytes = Buffer.byteLength(serialized, 'utf8');

  return bytes > MAX_AUDIT_BODY_BYTES ? { truncated: true, bytes } : sanitized;
}

/**
 * Рекурсивно копирует значение, вырезая секретные ключи объектов.
 *
 * Массивы обходятся поэлементно, глубина ограничена
 * {@link MAX_AUDIT_BODY_DEPTH}: на превышении возвращается строка-маркер, а не
 * исключение. Примитивы возвращаются как есть.
 *
 * @param value - копируемое значение
 * @param depth - текущая глубина рекурсии (0 — корень)
 * @returns безопасная копия значения
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_AUDIT_BODY_DEPTH) {
    return '[max-depth]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }

  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        continue;
      }

      copy[key] = sanitizeValue(item, depth + 1);
    }

    return copy;
  }

  return value;
}
