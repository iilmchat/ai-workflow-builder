/**
 * Модуль Redis-хранилища throttler'а (v0.11 S15, DESIGN § 3.5.2, KI-420).
 *
 * Вынесен отдельно от `AppModule`, потому что `ThrottlerModule.forRootAsync`
 * не видит провайдеров родительского модуля: фабрике нужен
 * {@link RedisThrottlerStorage}, а он должен быть в `imports` динамического
 * модуля. `RedisModule` — `@Global()` и экспортирует `REDIS_TOKEN`, поэтому у
 * хранилища есть базовый клиент для `duplicate()`.
 */
import { Module } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { RedisModule } from '../../redis/redis.module.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/**
 * Провайдеры хранилища: Redis-реализация + in-memory fallback.
 */
@Module({
  imports: [RedisModule],
  providers: [ThrottlerStorageService, RedisThrottlerStorage],
  exports: [RedisThrottlerStorage, ThrottlerStorageService],
})
export class RedisThrottlerModule {}
