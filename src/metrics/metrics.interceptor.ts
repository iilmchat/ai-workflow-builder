import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';
import { MetricsService } from './metrics.service.js';

/** Путь ручки экспозиции метрик: её саму не наблюдаем. */
const METRICS_PATH = '/metrics';

/**
 * Формат uuid в пути запроса: сегменты-идентификаторы заменяются на `:id`,
 * чтобы подпись `route` не размножалась по каждому объекту (кардинальность).
 */
const UUID_SEGMENT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Минимальный контракт запроса, нужный интерсептору (без `any`, RULES 4.15).
 *
 * `route` заполняет Express при сопоставлении маршрута; в тестовом контексте
 * и на нестандартных адаптерах поля может не быть — тогда работает fallback по
 * фактическому пути.
 */
interface MetricsRequest {
  /** HTTP-метод запроса. */
  readonly method: string;
  /** Путь запроса без query-строки (Express `request.path`). */
  readonly path?: string;
  /** Полный исходный URL (fallback для `path`). */
  readonly originalUrl?: string;
  /** Сопоставленный Express-маршрут (`{ path: '/workflow/:id' }`). */
  readonly route?: { readonly path?: unknown };
}

/** Минимальный контракт ответа: интерсептору нужен только статус. */
interface MetricsResponse {
  /** Итоговый HTTP-статус (`@HttpCode` применён до интерсепторов). */
  readonly statusCode: number;
}

/**
 * Глобальный интерсептор HTTP-метрик (v1.0.0 S4, DESIGN V100 § 3.3).
 *
 * Измеряет длительность каждого HTTP-запроса и пишет её в
 * `http_request_duration_seconds` через {@link MetricsService}. Регистрация —
 * `APP_INTERCEPTOR` в `AppModule` **до** `AuditInterceptor`: метрики описывают
 * весь запрос (включая время аудита), поэтому это самый внешний слой.
 *
 * **Как измеряется.** `performance.now()` (монотонные часы, не зависят от
 * системного времени) снимается до вызова обработчика, а запись делается в
 * `finalize`: он срабатывает и при успехе, и при ошибке, и при отмене клиентом,
 * поэтому упавшие запросы (4xx/5xx) тоже попадают в гистограмму — статус
 * берётся из `response.statusCode`. Ответ интерсептор не меняет.
 *
 * **Что не измеряется.** Не-HTTP контексты (`context.getType() !== 'http'`) и
 * сама ручка `GET /metrics` — иначе скрейп Prometheus добавлял бы запись на
 * каждый свой вызов (самонаблюдение).
 *
 * **Кардинальность.** Подпись `route` — шаблон, а не фактический URL:
 * `request.route.path` Express (`/workflow/:id`) либо нормализованный путь, в
 * котором uuid-сегменты заменены на `:id`. Без этого каждый объект был бы
 * отдельной серией и реестр рос бы бесконечно.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  /**
   * @param metricsService - сервис записи метрик (глобальный модуль)
   */
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Оборачивает обработчик замером длительности запроса.
   *
   * @param context - контекст выполнения Nest
   * @param next - следующий обработчик цепочки
   * @returns исходный поток ответа без изменений
   */
  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<MetricsRequest>();
    const path = readRequestPath(request);

    // Экспозиция метрик не наблюдает себя: скрейп не должен попадать в
    // http_request_duration_seconds (и шуметь в дашбордах).
    if (path === METRICS_PATH) {
      return next.handle();
    }

    const response = http.getResponse<MetricsResponse>();
    const method = request.method.toUpperCase();
    const route = resolveRouteLabel(request, path);
    const startedAt = performance.now();

    return next.handle().pipe(
      finalize(() => {
        const durationSeconds = (performance.now() - startedAt) / 1000;

        try {
          this.metricsService.observeHttpRequest(
            method,
            route,
            response.statusCode,
            durationSeconds,
          );
        } catch (error: unknown) {
          // Сбой метрик не должен влиять на исход запроса (RULES 4.18):
          // это вспомогательная подсистема, ответ уже сформирован.
          const message = error instanceof Error ? error.message : String(error);

          this.logger.warn(`Не удалось записать HTTP-метрику: ${message}`);
        }
      }),
    );
  }
}

/**
 * Достаёт путь запроса без query-строки, хэша и хвостового слэша.
 *
 * `request.path` в Express уже без query; в тестовом контексте/некоторых
 * адаптерах поля может не быть — тогда используется `originalUrl`. Ведущий
 * слэш гарантируется, а хвостовой снимается: `/metrics/` — та же ручка.
 *
 * @param request - запрос интерсептора
 * @returns нормализованный путь с ведущим слэшем (`/metrics`, `/workflow/:id`)
 */
function readRequestPath(request: MetricsRequest): string {
  const raw =
    request.path !== undefined && request.path.length > 0
      ? request.path
      : (request.originalUrl ?? '');
  const pathname = raw.split('?')[0].split('#')[0];
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;

  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

/**
 * Собирает ограниченную подпись маршрута для метрики.
 *
 * Приоритет — зарегистрированный шаблон Express (`request.route.path`,
 * например `/workflow/:id`): он уже без реальных идентификаторов. Если шаблона
 * нет, фактический путь нормализуется: uuid-сегменты заменяются на `:id`,
 * поэтому `/workflow/1111…/export` и `/workflow/2222…/export` — одна серия.
 *
 * @param request - запрос интерсептора
 * @param path - нормализованный фактический путь
 * @returns шаблон маршрута для подписи `route`
 */
function resolveRouteLabel(request: MetricsRequest, path: string): string {
  const routePath = request.route?.path;

  if (typeof routePath === 'string' && routePath.length > 0) {
    return routePath;
  }

  return path
    .split('/')
    .map((segment) => (UUID_SEGMENT_PATTERN.test(segment) ? ':id' : segment))
    .join('/');
}
