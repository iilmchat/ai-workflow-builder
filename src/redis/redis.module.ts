import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
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
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_TOKEN) private readonly redis: Redis) {}

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
