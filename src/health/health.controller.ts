import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Logger,
  Res,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { REDIS_TOKEN } from '../redis/redis.module.js';

/**
 * Статус одной зависимости в ответе `/health`.
 *
 * `up` — проверка прошла (PostgreSQL ответил на `SELECT 1`, Redis — на `PING`);
 * `down` — ошибка, таймаут или недоступность. Строки, а не boolean: ответ
 * читает человек (и `docker healthcheck`), и `{ db: 'down' }` понятнее, чем
 * `{ db: false }`.
 */
export type HealthComponentStatus = 'up' | 'down';

/** Детализация по проверяемым зависимостям. */
export interface HealthDetails {
  /** PostgreSQL: `SELECT 1` через drizzle-клиент. */
  readonly db: HealthComponentStatus;
  /** Redis: `PING` через ioredis-клиент (тот же, что у throttler/pub-sub). */
  readonly redis: HealthComponentStatus;
}

/** Контракт ответа `GET /health`. */
export interface HealthResponse {
  /** `ok` — обе зависимости живы; `error` — хотя бы одна лежит (HTTP 503). */
  readonly status: 'ok' | 'error';
  /** Постатусная детализация: что именно лежит. */
  readonly details: HealthDetails;
}

/**
 * Предел ожидания одной проверки, мс (S6-A).
 *
 * Healthcheck не должен висеть, пока «задумавшийся» `pg` ждёт TCP: Caddy и
 * Docker-проверка считают такой ответ зависанием, и контейнер уходит в
 * `unhealthy` без понятной причины. 2 с — заметно больше нормального `SELECT 1`
 * и `PING` (единицы мс), но меньше типичного таймаута healthcheck'а.
 */
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/**
 * Публичный health/readiness-эндпоинт `GET /health` (v1.6.0 S6-A).
 *
 * Зачем отдельно от `GET /` (AppController): тот отвечает "Hello World!" и не
 * знает о зависимостях — контейнер мог быть «healthy», пока PostgreSQL и Redis
 * лежали, и Caddy уже направлял на него трафик. Здесь проверяются ровно те две
 * зависимости, без которых API не работает: БД (запросы) и Redis (очереди
 * BullMQ и общий rate limit).
 *
 * **Без авторизации**: ручку дёргает `docker healthcheck`, Caddy/uptime-монитор
 * и инфра-агент — пользовательского токена у них нет. Данные не секретные:
 * только `up`/`down`. Ручка не ходит во внешние API и не трогает бизнес-таблицы
 * (`SELECT 1` не читает пользовательских данных).
 *
 * `503 Service Unavailable` при частичном отказе — сознательно, а не `200` с
 * `status: 'error'`: Docker/Compose и внешние мониторы смотрят на HTTP-код, а
 * не на тело. Caddy не проксирует unhealthy-контейнер.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  /**
   * @param db - drizzle-клиент (`DbModule`, `@Global`) для `SELECT 1`
   * @param redis - ioredis-клиент (`RedisModule`, `@Global`) для `PING`
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  /**
   * `GET /health` — проверяет процесс и обе зависимости.
   *
   * Проверки идут параллельно (`Promise.all`): последовательный `SELECT 1` +
   * `PING` удваивал бы время ответа, а они независимы (RULES 4.17).
   *
   * @param response - HTTP-ответ Express: через него выставляется код 200/503
   *   (тело остаётся контрактом {@link HealthResponse})
   * @returns статус и детализацию по БД и Redis
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async checkAsync(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([
      this.checkDbAsync(),
      this.checkRedisAsync(),
    ]);
    const healthy = db === 'up' && redis === 'up';

    response.status(
      healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );

    return {
      status: healthy ? 'ok' : 'error',
      details: { db, redis },
    };
  }

  /**
   * Проверка PostgreSQL: `SELECT 1` через drizzle.
   *
   * @returns `up` при успешном запросе, `down` при ошибке или таймауте
   */
  private async checkDbAsync(): Promise<HealthComponentStatus> {
    try {
      await this.withTimeoutAsync(this.db.execute(sql`SELECT 1`), 'PostgreSQL');

      return 'up';
    } catch (error: unknown) {
      this.logger.warn(
        `Healthcheck: PostgreSQL недоступен — ${error instanceof Error ? error.message : String(error)}`,
      );

      return 'down';
    }
  }

  /**
   * Проверка Redis: `PING` тем же клиентом, что используют throttler/pub-sub.
   *
   * @returns `up` при ответе `PONG`, `down` при ошибке или таймауте
   */
  private async checkRedisAsync(): Promise<HealthComponentStatus> {
    try {
      await this.withTimeoutAsync(this.redis.ping(), 'Redis');

      return 'up';
    } catch (error: unknown) {
      this.logger.warn(
        `Healthcheck: Redis недоступен — ${error instanceof Error ? error.message : String(error)}`,
      );

      return 'down';
    }
  }

  /**
   * Ограничивает проверку таймаутом (RULES 4.19).
   *
   * @param operation - промис проверки зависимости
   * @param label - имя зависимости для текста ошибки (без секретов)
   * @returns результат проверки
   * @throws Error если проверка не уложилась в {@link HEALTH_CHECK_TIMEOUT_MS}
   */
  private async withTimeoutAsync<T>(
    operation: Promise<T>,
    label: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}: таймаут ${HEALTH_CHECK_TIMEOUT_MS} мс`)),
        HEALTH_CHECK_TIMEOUT_MS,
      );
      // Таймер не должен держать event loop при выключении процесса.
      timer.unref?.();
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
