import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { isIpAllowed, normalizeClientIp, parseIpAllowlist } from './metrics-ip-allowlist.js';

/**
 * Guard сетевого доступа к `GET /metrics` (v1.6.0 S6-A, KI-575).
 *
 * Ручка метрик не может требовать JWT (скрейпер Prometheus его не имеет),
 * поэтому доступ ограничен по IP: `METRICS_ALLOWED_IPS` — точные адреса и
 * IPv4-CIDR. Остальным — `403 Forbidden` **до** построения экспозиции, чтобы
 * не тратить CPU на `metrics()` и не отдавать наружу карточку сервиса.
 *
 * Порядок выбора адреса важен: сначала `req.ip` (Express учитывает
 * `TRUST_PROXY=true` и берёт адрес из `X-Forwarded-For` только у доверенного
 * прокси), и лишь если его нет — заголовок напрямую. Наоборот было бы дырой:
 * при `TRUST_PROXY=false` клиент подставил бы себе любой IP в
 * `X-Forwarded-For` и прошёл бы allowlist.
 *
 * Guard намеренно **не** отключается в dev: дефолт (`127.0.0.1`) пускает
 * локальный scrape, а подсеть Docker/Prometheus оператор добавляет в env
 * (см. `docs/development/PRODUCTION.md`).
 */
@Injectable()
export class MetricsIpGuard implements CanActivate {
  private readonly logger = new Logger(MetricsIpGuard.name);

  /**
   * @param config - `ConfigService` (`@Global`): значение `METRICS_ALLOWED_IPS`
   *   читается на каждый запрос, чтобы правка env не требовала перезапуска
   *   кода; список короткий, стоимость разбора пренебрежима
   */
  constructor(private readonly config: ConfigService) {}

  /**
   * Проверяет IP клиента против allowlist'а.
   *
   * @param context - контекст выполнения Nest (HTTP)
   * @returns `true`, если адрес разрешён
   * @throws ForbiddenException если адрес вне allowlist или не определён
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const rules = parseIpAllowlist(
      this.config.get<string>('METRICS_ALLOWED_IPS'),
    );
    const clientIp = resolveRequestIp(request);

    if (isIpAllowed(clientIp, rules)) {
      return true;
    }

    // WARN с адресом — операторская диагностика (RULES 1.8); сообщение в ответе
    // без адреса, чтобы не подсказывать сканеру, «почти» он попал или нет.
    this.logger.warn(
      `GET /metrics отклонён: ${clientIp ?? 'IP не определён'} вне METRICS_ALLOWED_IPS`,
    );

    throw new ForbiddenException(
      'GET /metrics доступен только из доверенной сети (METRICS_ALLOWED_IPS)',
    );
  }
}

/**
 * Достаёт адрес клиента из Express-запроса.
 *
 * @param request - запрос (в тестах — его минимальный срез)
 * @returns нормализованный IP или `null`, если определить не удалось
 */
export function resolveRequestIp(
  request: Pick<Request, 'ip' | 'headers' | 'socket'>,
): string | null {
  const expressIp = normalizeClientIp(request.ip);

  if (expressIp !== null) {
    return expressIp;
  }

  const header = request.headers['x-forwarded-for'];
  const rawHeader = Array.isArray(header) ? header[0] : header;
  const forwarded = normalizeClientIp(rawHeader?.split(',')[0]);

  if (forwarded !== null) {
    return forwarded;
  }

  return normalizeClientIp(request.socket?.remoteAddress ?? null);
}
