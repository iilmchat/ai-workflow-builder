import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Инъекционный токен отдельного клиента Redis для pub/sub.
 *
 * Соединение BullMQ намеренно не переиспользуется: Redis-subscriber не может
 * выполнять обычные команды, пока подписан на канал.
 */
export const REDIS_TOKEN = 'REDIS_TOKEN';

/**
 * Таймаут проверки Redis на старте (KI-019).
 *
 * Три секунды — компромисс: локальный Redis и Redis в той же сети отвечают за
 * миллисекунды, а недоступный хост успевает отдать ошибку соединения. Ждать
 * дольше нельзя: контейнер должен перезапуститься, а не висеть в `starting`.
 */
export const REDIS_PING_TIMEOUT_MS = 3_000;

/** Минимальный контракт клиента, достаточный для проверки доступности. */
interface RedisPingClient {
  /**
   * Отправляет `PING`.
   *
   * @returns ответ Redis (`PONG`)
   */
  ping(): Promise<unknown>;
}

/**
 * Проверяет Redis через `PING` с ограничением по времени (KI-019).
 *
 * ioredis при недоступном Redis не отвергает команду сразу: с
 * `retryStrategy` он держит её в очереди и переподключается. Без гонки с
 * таймером `onModuleInit` ждал бы вечно, и приложение «поднималось» бы, падая
 * позже на первом запросе. Таймер снимается в `finally`, чтобы успешный
 * `PING` не оставлял висящий `setTimeout`.
 *
 * @param redis - клиент с методом `ping`
 * @param timeoutMs - предел ожидания в миллисекундах
 * @returns промис без значения
 * @throws Error если `PING` не прошёл или не уложился в таймаут
 */
export async function pingRedisWithTimeoutAsync(
  redis: RedisPingClient,
  timeoutMs: number = REDIS_PING_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      redis.ping(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Redis не ответил на PING за ${timeoutMs} мс`));
        }, timeoutMs);

        // Таймер не должен сам держать процесс живым (например, в тестах).
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Декоратор инъекции клиента Redis для pub/sub.
 *
 * @returns параметр-декоратор NestJS, привязывающий аргумент к {@link REDIS_TOKEN}
 */
export const InjectRedis = (): ParameterDecorator => Inject(REDIS_TOKEN);

/**
 * Глобальный модуль Redis-клиента для pub/sub.
 *
 * Клиент создаётся один раз из `REDIS_URL` через `ConfigService` (RULES 4.6)
 * и закрывается на `onApplicationShutdown` (RULES 4.12). Строка подключения
 * в логи не попадает (RULES 5.3).
 *
 * **Fail-fast (KI-019).** На `onModuleInit` модуль проверяет Redis через
 * `PING` с таймаутом {@link REDIS_PING_TIMEOUT_MS}. Если Redis недоступен,
 * старт прерывается: контейнер перезапустится, вместо того чтобы подняться и
 * падать на первом job'е/запросе.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis(config.getOrThrow<string>('REDIS_URL'), {
          // Для BullMQ-совместимого клиента команды не должны падать при реконнекте.
          maxRetriesPerRequest: null,
          // WSL2-прокси (wslrelay.exe) может закрывать idle TCP: держим
          // соединение живым через TCP keep-alive каждые 10 с (KI-110).
          keepAlive: 10_000,
          // Ограниченный экспоненциальный реконнект — не долбить wslrelay.
          retryStrategy: (times) => Math.min(times * 200, 3_000),
        }),
    },
  ],
  exports: [REDIS_TOKEN],
})
export class RedisModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_TOKEN) private readonly redis: Redis) {}

  /**
   * Проверяет доступность Redis при старте приложения (KI-019).
   *
   * @returns промис без значения
   * @throws Error если `PING` не прошёл за {@link REDIS_PING_TIMEOUT_MS}
   */
  async onModuleInit(): Promise<void> {
    try {
      await pingRedisWithTimeoutAsync(this.redis);
      this.logger.log('Redis доступен: PING прошёл');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Redis недоступен при старте: ${message}`);

      // Fail-fast: без Redis очередь запусков и rate limiter неработоспособны,
      // поэтому лучше не подниматься вовсе (контейнер перезапустится).
      throw new Error(`Redis недоступен при старте: ${message}`);
    }
  }

  /**
   * Закрывает соединение с Redis при остановке приложения.
   *
   * @returns промис без значения
   */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Не удалось корректно закрыть Redis: ${message}`);
    }
  }
}
