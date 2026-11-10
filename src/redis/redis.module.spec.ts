import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pingRedisWithTimeoutAsync,
  REDIS_PING_TIMEOUT_MS,
  RedisModule,
} from './redis.module.js';

/** Клиент, у которого `ping` никогда не завершается. */
function neverRespondingClient(): { ping: () => Promise<never> } {
  return { ping: () => new Promise<never>(() => undefined) };
}

describe('RedisModule (KI-019)', () => {
  beforeEach(() => {
    // Недоступный Redis на старте — ожидаемый ERROR в тестах.
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('по умолчанию ждёт PING три секунды', () => {
    expect(REDIS_PING_TIMEOUT_MS).toBe(3_000);
  });

  it('завершается успешно, когда Redis отвечает на PING', async () => {
    const ping = vi.fn(() => Promise.resolve('PONG'));

    await expect(pingRedisWithTimeoutAsync({ ping })).resolves.toBeUndefined();
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('пробрасывает ошибку PING (соединение отклонено)', async () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:6379');

    await expect(
      pingRedisWithTimeoutAsync({ ping: () => Promise.reject(error) }),
    ).rejects.toThrow(error);
  });

  it('падает по таймауту, если Redis не отвечает', async () => {
    await expect(
      pingRedisWithTimeoutAsync(neverRespondingClient(), 20),
    ).rejects.toThrow('Redis не ответил на PING за 20 мс');
  });

  it('onModuleInit бросает Error, если Redis недоступен (fail-fast)', async () => {
    const moduleRef = new RedisModule({
      ping: () => Promise.reject(new Error('нет соединения')),
    } as unknown as Redis);

    await expect(moduleRef.onModuleInit()).rejects.toThrow(
      'Redis недоступен при старте: нет соединения',
    );
  });

  it('onModuleInit завершается, если PING прошёл', async () => {
    const moduleRef = new RedisModule({
      ping: () => Promise.resolve('PONG'),
    } as unknown as Redis);

    await expect(moduleRef.onModuleInit()).resolves.toBeUndefined();
  });
});
