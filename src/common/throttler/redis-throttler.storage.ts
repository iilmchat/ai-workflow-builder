/**
 * Redis-хранилище счётчиков `@nestjs/throttler` (v0.11 S15, DESIGN § 3.5.2).
 *
 * **Зачем.** In-memory `ThrottlerStorageService` считает лимиты по инстансу
 * (KI-420): при двух backend-подах за балансировщиком клиент получает
 * `limit × N` запросов, а `Retry-After`/счётчики расходятся. Redis делает
 * счётчики общими, поэтому лимит — на всю инсталляцию, а не на pod.
 *
 * **Почему своё соединение.** Общий `REDIS_TOKEN` настроен на
 * `maxRetriesPerRequest: null` (нужно BullMQ/pub-sub): при мёртвом Redis
 * `eval` встал бы в offline-очередь и висел, а fallback не сработал бы.
 * Поэтому {@link RedisThrottlerStorage} делает `duplicate()` с
 * `maxRetriesPerRequest: 1` и `enableOfflineQueue: false` — ошибка Redis
 * доходит до `catch` сразу. Своё соединение закрывается в
 * `onApplicationShutdown`.
 *
 * **Почему fallback в память.** Redis — обязательная инфраструктура, но rate
 * limit не должен ронять API: если Redis недоступен, BullMQ и SSE уже
 * деградировали, и отдавать 500 на каждый HTTP-запрос хуже, чем временно
 * считать лимиты по инстансу. Fallback логируется (не чаще раза в минуту),
 * чтобы не спамить.
 */
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { InjectRedis } from '../../redis/redis.module.js';

/**
 * Lua-скрипт атомарного инкремента (DESIGN § 3.5.2).
 *
 * Атомарность обязательна: без неё два параллельных запроса прочитают
 * `hits=limit-1`, оба пройдут, и лимит будет превышен. Скрипт заодно
 * выставляет TTL только на первом хите и блокировку (`…:blocked`) после
 * превышения.
 */
export const THROTTLE_LUA = `
local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local blockKey = key .. ':blocked'

if redis.call('EXISTS', blockKey) == 1 then
  return { limit + 1, redis.call('PTTL', key), 1, redis.call('PTTL', blockKey) }
end

local hits = redis.call('INCR', key)
if hits == 1 then
  redis.call('PEXPIRE', key, ttl)
end
local ttlLeft = redis.call('PTTL', key)

if hits > limit and block > 0 then
  redis.call('SET', blockKey, '1', 'PX', block)
  return { hits, ttlLeft, 1, block }
end

return { hits, ttlLeft, 0, 0 }
`;

/** Интервал между warn-логами о недоступном Redis, мс (DESIGN § 3.5.2). */
const REDIS_WARN_INTERVAL_MS = 60_000;

/**
 * Локальная структура результата `increment` (KI-513).
 *
 * Пакет `@nestjs/throttler` не реэкспортирует `ThrottlerStorageRecord` из
 * index — deep-import `@nestjs/throttler/dist/...` ломается при смене его
 * внутренней раскладки. Контракт стабилен и описан здесь.
 */
export interface ThrottlerStorageRecord {
  /** Число запросов в текущем окне. */
  totalHits: number;
  /** Оставшееся время окна, мс. */
  timeToExpire: number;
  /** Активна ли блокировка после превышения лимита. */
  isBlocked: boolean;
  /** Оставшееся время блокировки, мс. */
  timeToBlockExpire: number;
}

/**
 * Проверяет ответ Lua перед использованием (KI-514, RULES 1.17).
 *
 * @param reply - сырой результат `EVAL`
 * @returns кортеж из четырёх конечных чисел либо `null`
 */
function parseLuaReply(reply: unknown): [number, number, number, number] | null {
  if (!Array.isArray(reply) || reply.length !== 4) {
    return null;
  }

  if (!reply.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }

  return [reply[0], reply[1], reply[2], reply[3]];
}

/**
 * Приводит неизвестную ошибку к тексту для лога.
 *
 * @param error - значение из `catch`
 * @returns текст ошибки без стека
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Redis-хранилище лимитов `@nestjs/throttler` (DESIGN § 3.5.2, KI-420).
 *
 * Реализует контракт `ThrottlerStorage`: `increment` вызывается guard'ом на
 * каждый запрос под лимитом. Ключ включает версионный префикс из
 * `THROTTLER_KEY_PREFIX` и имя throttler'а — dev/staging/prod на общем Redis
 * не делят счётчики (DESIGN § 3.5.2).
 */
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnApplicationShutdown
{
  /** Логгер сервиса (технические сообщения — RULES 1.8). */
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /** Префикс ключей: изоляция окружений на общем Redis. */
  private readonly prefix: string;

  /** Время последнего warn о недоступном Redis (throttle логов). */
  private lastWarnAt = 0;

  /**
   * Отдельное fail-fast соединение, создаваемое лениво (KI-515).
   *
   * `duplicate()` наследует `REDIS_URL`/`keepAlive`/`retryStrategy`, но
   * перекрывает поведение очереди команд: при мёртвом Redis `eval` сразу
   * падает, а не копится в offline-очереди. При `THROTTLER_STORAGE=memory`
   * соединение не создаётся вовсе.
   */
  private redis: Redis | null = null;

  /** Базовый клиент, от которого делается `duplicate()`. */
  private readonly base: Redis;

  /**
   * @param base - общий клиент Redis (`REDIS_TOKEN`) для `duplicate()`
   * @param fallback - in-memory хранилище на случай недоступного Redis
   * @param config - конфигурация (RULES 4.6: env только через DI)
   */
  constructor(
    @InjectRedis() base: Redis,
    private readonly fallback: ThrottlerStorageService,
    config: ConfigService,
  ) {
    this.base = base;
    // Префикс версионирован: смена алгоритма не должна смешивать старые ключи.
    this.prefix = config.get<string>('THROTTLER_KEY_PREFIX') ?? 'throttle:v1';
  }

  /**
   * Возвращает fail-fast соединение, создавая его при первом обращении.
   *
   * @returns клиент Redis для `EVAL`
   */
  private getRedis(): Redis {
    if (this.redis === null) {
      this.redis = this.base.duplicate({
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    }

    return this.redis;
  }

  /**
   * Закрывает собственное соединение с Redis при остановке приложения
   * (RULES 4.12).
   *
   * @returns промис без значения; ошибка закрытия не пробрасывается
   */
  async onApplicationShutdown(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
    this.redis = null;
  }

  /**
   * Атомарно увеличивает счётчик и возвращает состояние лимита.
   *
   * При ошибке Redis отдаёт результат in-memory fallback'а — API продолжает
   * работать, пока Redis восстанавливается.
   *
   * @param key - ключ трекера (IP/пользователь)
   * @param ttl - окно подсчёта, мс
   * @param limit - максимум запросов за окно
   * @param blockDuration - длительность блокировки после превышения, мс
   * @param throttlerName - имя throttler'а (входит в ключ)
   * @returns счётчик, TTL окна и блокировки
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const reply = parseLuaReply(
        await this.getRedis().eval(
          THROTTLE_LUA,
          1,
          `${this.prefix}:${throttlerName}:${key}`,
          ttl,
          limit,
          blockDuration,
        ),
      );

      // Некорректный ответ upstream — не доверяем ему, уходим в fallback.
      if (reply === null) {
        throw new Error('Некорректный ответ Lua Redis Throttler');
      }

      const [totalHits, timeToExpire, blocked, timeToBlockExpire] = reply;

      return {
        totalHits,
        timeToExpire,
        isBlocked: blocked === 1,
        timeToBlockExpire,
      };
    } catch (error: unknown) {
      // Redis — обязательная инфраструктура, но rate limit не должен ронять API.
      if (Date.now() - this.lastWarnAt > REDIS_WARN_INTERVAL_MS) {
        this.lastWarnAt = Date.now();
        this.logger.warn(
          `Throttler Redis недоступен, fallback in-memory: ${toMessage(error)}`,
        );
      }

      return this.fallback.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
