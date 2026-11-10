import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LlmResponseCacheService,
  type LlmCacheKeyParams,
} from './llm-response-cache.service.js';
import type { LlmGenerateResult } from './llm-provider.interface.js';

/** Заглушка ConfigService с заданными значениями. */
function configStub(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Минимальный мок Redis-клиента, используемый сервисом. */
function redisStub(): {
  redis: Redis;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  const set = vi.fn(() => Promise.resolve('OK'));
  const del = vi.fn(() => Promise.resolve(1));

  return {
    redis: { get, set, del } as unknown as Redis,
    get,
    set,
    del,
  };
}

/** Базовые параметры ключа. */
function keyParams(overrides: Partial<LlmCacheKeyParams> = {}): LlmCacheKeyParams {
  return {
    orgId: 'org-1',
    modelId: 'gpt-4o',
    prompt: 'привет',
    options: { system: 'ты кот', temperature: 0.2 },
    ...overrides,
  };
}

describe('LlmResponseCacheService (S8, FinOps)', () => {
  let loggerWarn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerWarn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('по умолчанию выключен и имеет TTL сутки', () => {
    const { redis } = redisStub();
    const cache = new LlmResponseCacheService(redis);

    expect(cache.isEnabled()).toBe(false);
    expect(cache.ttlSeconds).toBe(86_400);
  });

  it('читает флаг и TTL из env строго', () => {
    const { redis } = redisStub();
    const cache = new LlmResponseCacheService(
      redis,
      configStub({ LLM_CACHE_ENABLED: 'true', LLM_CACHE_TTL_SECONDS: '120' }),
    );

    expect(cache.isEnabled()).toBe(true);
    expect(cache.ttlSeconds).toBe(120);
  });

  it('не включает кэш на строку "false" (RULES 4.35)', () => {
    const { redis } = redisStub();
    const cache = new LlmResponseCacheService(
      redis,
      configStub({ LLM_CACHE_ENABLED: 'false' }),
    );

    expect(cache.isEnabled()).toBe(false);
  });

  it('ключ стабилен и учитывает организацию, модель, промпт и опции', () => {
    const { redis } = redisStub();
    const cache = new LlmResponseCacheService(redis);

    const base = cache.buildKey(keyParams());

    expect(cache.buildKey(keyParams())).toBe(base);
    expect(cache.buildKey(keyParams({ orgId: 'org-2' }))).not.toBe(base);
    expect(cache.buildKey(keyParams({ modelId: 'gpt-4o-mini' }))).not.toBe(base);
    expect(cache.buildKey(keyParams({ prompt: 'другой' }))).not.toBe(base);
    expect(
      cache.buildKey(keyParams({ options: { system: 'ты кот', temperature: 0.9 } })),
    ).not.toBe(base);
  });

  it('порядок ключей опций не влияет на ключ, signal игнорируется', () => {
    const { redis } = redisStub();
    const cache = new LlmResponseCacheService(redis);
    const controller = new AbortController();

    const first = cache.buildKey(
      keyParams({ options: { temperature: 0.2, system: 'ты кот' } }),
    );
    const second = cache.buildKey(
      keyParams({
        options: {
          system: 'ты кот',
          temperature: 0.2,
          signal: controller.signal,
        },
      }),
    );

    expect(second).toBe(first);
  });

  it('читает валидную запись из Redis', async () => {
    const { redis, get } = redisStub();
    const cache = new LlmResponseCacheService(redis);
    const body = { text: 'ответ', usage: null, isLocal: false };

    get.mockResolvedValueOnce(JSON.stringify(body));

    await expect(cache.getAsync('key')).resolves.toEqual(body);
  });

  it('удаляет битую запись и возвращает промах', async () => {
    const { redis, get, del } = redisStub();
    const cache = new LlmResponseCacheService(redis);

    get.mockResolvedValueOnce('not-json');

    await expect(cache.getAsync('key')).resolves.toBeNull();
    expect(del).toHaveBeenCalledWith('key');
  });

  it('не падает, если Redis недоступен при чтении', async () => {
    const { redis, get } = redisStub();
    const cache = new LlmResponseCacheService(redis);

    get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(cache.getAsync('key')).resolves.toBeNull();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
    );
  });

  it('пишет ответ с TTL через SET ... EX', async () => {
    const { redis, set } = redisStub();
    const cache = new LlmResponseCacheService(
      redis,
      configStub({ LLM_CACHE_TTL_SECONDS: 60 }),
    );
    const result: LlmGenerateResult = {
      text: 'ответ',
      usage: { inputTokens: 3, outputTokens: 2, model: 'gpt-4o' },
      isLocal: false,
    };

    await cache.setAsync('key', result);

    expect(set).toHaveBeenCalledWith('key', JSON.stringify(result), 'EX', 60);
  });

  it('не падает, если Redis недоступен при записи', async () => {
    const { redis, set } = redisStub();
    const cache = new LlmResponseCacheService(redis);

    set.mockRejectedValueOnce(new Error('timeout'));

    await expect(
      cache.setAsync('key', { text: 'ответ', usage: null }),
    ).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('timeout'),
    );
  });
});
