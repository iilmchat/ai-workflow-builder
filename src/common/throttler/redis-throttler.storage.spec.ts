/**
 * Тесты Redis-хранилища throttler'а (v0.11 S15, DESIGN § 3.5.2, KI-420).
 *
 * Redis замокан: проверяются контракт `ThrottlerStorage`, ключ/префикс,
 * Lua-вызов с аргументами и fallback в память при недоступном Redis (включая
 * throttle warn-логов). Реальный Redis проверяется smoke-сценарием «два
 * инстанса → общий лимит».
 */
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ThrottlerStorageService } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RedisThrottlerStorage,
  THROTTLE_LUA,
} from './redis-throttler.storage.js';

/** Запись, которую отдаёт fallback. */
const FALLBACK_RECORD: ThrottlerStorageRecord = {
  totalHits: 1,
  timeToExpire: 60_000,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/** Результат Lua-скрипта (DESIGN § 3.5.2). */
type LuaResult = [number, number, number, number];

/**
 * Собирает хранилище с моками Redis и fallback.
 *
 * @param evalImpl - поведение `eval` (результат или ошибка)
 * @param prefix - значение `THROTTLER_KEY_PREFIX`
 * @returns хранилище и моки
 */
function createStorage(
  evalImpl: () => Promise<unknown>,
  prefix = 'throttle:test',
): {
  storage: RedisThrottlerStorage;
  evalMock: ReturnType<typeof vi.fn>;
  quitMock: ReturnType<typeof vi.fn>;
  duplicateMock: ReturnType<typeof vi.fn>;
  fallbackIncrement: ReturnType<typeof vi.fn>;
} {
  const evalMock = vi.fn(evalImpl);
  const quitMock = vi.fn(() => Promise.resolve('OK'));
  const duplicateMock = vi.fn();
  const redis = {
    eval: evalMock,
    quit: quitMock,
  };

  duplicateMock.mockReturnValue(redis);

  const base = { duplicate: duplicateMock } as unknown as Redis;
  const fallbackIncrement = vi.fn(() => Promise.resolve(FALLBACK_RECORD));
  const fallback = {
    increment: fallbackIncrement,
  } as unknown as ThrottlerStorageService;
  const config = {
    get: vi.fn((key: string) =>
      key === 'THROTTLER_KEY_PREFIX' ? prefix : undefined,
    ),
  } as unknown as ConfigService;

  return {
    storage: new RedisThrottlerStorage(base, fallback, config),
    evalMock,
    quitMock,
    duplicateMock,
    fallbackIncrement,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('RedisThrottlerStorage (v0.11 S15, KI-420)', () => {
  it('создаёт fail-fast duplicate и читает префикс из конфига', () => {
    const { duplicateMock } = createStorage(() =>
      Promise.resolve([1, 60_000, 0, 0] as LuaResult),
    );

    expect(duplicateMock).toHaveBeenCalledWith({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  });

  it('успешный increment: ключ с префиксом и именем throttler, результат Lua', async () => {
    const { storage, evalMock, fallbackIncrement } = createStorage(() =>
      Promise.resolve([2, 59_500, 0, 0] as LuaResult),
    );

    const record = await storage.increment(
      '127.0.0.1',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(record).toEqual({
      totalHits: 2,
      timeToExpire: 59_500,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(evalMock).toHaveBeenCalledWith(
      THROTTLE_LUA,
      1,
      'throttle:test:default:127.0.0.1',
      60_000,
      5,
      30_000,
    );
    expect(fallbackIncrement).not.toHaveBeenCalled();
  });

  it('блокировка из Lua: isBlocked=true и время блокировки', async () => {
    const { storage } = createStorage(() =>
      Promise.resolve([6, 1_000, 1, 30_000] as LuaResult),
    );

    const record = await storage.increment(
      'user-1',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(record).toEqual({
      totalHits: 6,
      timeToExpire: 1_000,
      isBlocked: true,
      timeToBlockExpire: 30_000,
    });
  });

  it('ошибка Redis → fallback in-memory с теми же аргументами', async () => {
    const { storage, fallbackIncrement } = createStorage(() =>
      Promise.reject(new Error('ECONNREFUSED 127.0.0.1:6379')),
    );

    const record = await storage.increment(
      '127.0.0.1',
      60_000,
      5,
      30_000,
      'default',
    );

    expect(record).toEqual(FALLBACK_RECORD);
    expect(fallbackIncrement).toHaveBeenCalledWith(
      '127.0.0.1',
      60_000,
      5,
      30_000,
      'default',
    );
  });

  it('warn о недоступном Redis — не чаще раза в минуту', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let now = 1_000_000;

    vi.useFakeTimers();
    vi.setSystemTime(now);

    const { storage } = createStorage(() =>
      Promise.reject(new Error('Redis недоступен')),
    );

    await storage.increment('ip', 60_000, 5, 0, 'default');
    await storage.increment('ip', 60_000, 5, 0, 'default');

    expect(warnSpy).toHaveBeenCalledTimes(1);

    now += 61_000;
    vi.setSystemTime(now);
    await storage.increment('ip', 60_000, 5, 0, 'default');

    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('onApplicationShutdown закрывает собственное соединение', async () => {
    const { storage, quitMock } = createStorage(() =>
      Promise.resolve([1, 60_000, 0, 0] as LuaResult),
    );

    await storage.onApplicationShutdown();

    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it('ошибка quit при shutdown не пробрасывается (RULES 4.12)', async () => {
    const { storage, quitMock } = createStorage(() =>
      Promise.resolve([1, 60_000, 0, 0] as LuaResult),
    );

    quitMock.mockRejectedValueOnce(new Error('already closed'));

    await expect(storage.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
