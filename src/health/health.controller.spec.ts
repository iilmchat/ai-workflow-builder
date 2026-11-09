import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { REDIS_TOKEN } from '../redis/redis.module.js';
import { HealthController } from './health.controller.js';

/**
 * Мок Express-ответа: контроллер использует только `status()`.
 *
 * @returns мок ответа и шпион `status` для проверки HTTP-кода
 */
function createResponseMock(): {
  readonly response: Response;
  readonly status: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn();

  return { response: { status } as unknown as Response, status };
}

describe('HealthController (S6-A)', () => {
  const execute = vi.fn();
  const ping = vi.fn();
  let controller: HealthController;

  beforeEach(async () => {
    execute.mockReset();
    ping.mockReset();
    // Проверки «лежит» пишут WARN — в тестах это лишний шум.
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DRIZZLE, useValue: { execute } as unknown as Database },
        { provide: REDIS_TOKEN, useValue: { ping } as unknown as Redis },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('200 OK, когда PostgreSQL и Redis отвечают', async () => {
    execute.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue('PONG');
    const { response, status } = createResponseMock();

    const body = await controller.checkAsync(response);

    expect(body).toMatchObject({
      status: 'ok',
      details: { db: 'up', redis: 'up' },
    });
    expect(status).toHaveBeenCalledWith(200);
    // PostgreSQL проверяется именно запросом, Redis — именно PING.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('503 Service Unavailable, когда лежат обе зависимости', async () => {
    execute.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    ping.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));
    const { response, status } = createResponseMock();

    const body = await controller.checkAsync(response);

    expect(body).toMatchObject({
      status: 'error',
      details: { db: 'down', redis: 'down' },
    });
    expect(status).toHaveBeenCalledWith(503);
  });

  it('503 и частичная детализация, когда лежит только Redis', async () => {
    execute.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockRejectedValue(new Error('Connection is closed.'));
    const { response, status } = createResponseMock();

    const body = await controller.checkAsync(response);

    // Детализация постатусная: оператор сразу видит, что БД жива, а Redis — нет.
    expect(body).toMatchObject({
      status: 'error',
      details: { db: 'up', redis: 'down' },
    });
    expect(status).toHaveBeenCalledWith(503);
  });

  it('503 и `db: down`, когда PostgreSQL отвечает дольше таймаута', async () => {
    vi.useFakeTimers();
    // Промис, который никогда не завершится: имитация зависшего TCP.
    execute.mockReturnValue(new Promise(() => undefined));
    ping.mockResolvedValue('PONG');
    const { response, status } = createResponseMock();

    const pending = controller.checkAsync(response);
    await vi.advanceTimersByTimeAsync(2_000);
    const body = await pending;

    expect(body).toMatchObject({
      status: 'error',
      details: { db: 'down', redis: 'up' },
    });
    expect(status).toHaveBeenCalledWith(503);
  });
});
