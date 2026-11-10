import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/**
 * Модуль health/readiness-проверок (v1.6.0 S6-A).
 *
 * Отдельный модуль, а не ручка в `AppController`, по двум причинам:
 * - `AppController` — «Hello World!» и не должен зависеть от БД/Redis: его
 *   единственный тест не создаёт ни пул `pg`, ни клиент `ioredis`;
 * - зависимости healthcheck'а — инфраструктурные (`DbModule`, `RedisModule`),
 *   и в `imports` их перечислять не нужно: оба модуля помечены `@Global`, а
 *   `HealthController` инжектит `DRIZZLE` и `REDIS_TOKEN` по токенам.
 *
 * Контроллер зарегистрирован здесь, а подключение модуля — в `AppModule`.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
