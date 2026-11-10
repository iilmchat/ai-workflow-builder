import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthService } from './auth.service.js';
import {
  REFRESH_TOKEN_CLEANUP_CRON,
  REFRESH_TOKEN_CLEANUP_JOB_NAME,
  REFRESH_TOKEN_CLEANUP_SCHEDULER_ID,
  RefreshTokenCleanupProcessor,
} from './refresh-token-cleanup.service.js';

describe('RefreshTokenCleanupProcessor (KI-215)', () => {
  const cleanupExpiredTokensAsync = vi.fn();
  const upsertJobScheduler = vi.fn();
  let processor: RefreshTokenCleanupProcessor;
  let loggerLog: ReturnType<typeof vi.spyOn>;
  let loggerError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanupExpiredTokensAsync.mockReset();
    upsertJobScheduler.mockReset();
    upsertJobScheduler.mockResolvedValue(undefined);
    loggerLog = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    processor = new RefreshTokenCleanupProcessor(
      { cleanupExpiredTokensAsync } as unknown as AuthService,
      { upsertJobScheduler } as unknown as Queue<Record<string, never>>,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('регистрирует ежедневное расписание по стабильному id', async () => {
    await processor.onModuleInit();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      REFRESH_TOKEN_CLEANUP_SCHEDULER_ID,
      { pattern: REFRESH_TOKEN_CLEANUP_CRON },
      {
        name: REFRESH_TOKEN_CLEANUP_JOB_NAME,
        data: {},
      },
    );
  });

  it('не роняет приложение, если расписание не зарегистрировалось', async () => {
    upsertJobScheduler.mockRejectedValueOnce(new Error('Redis timeout'));

    await expect(processor.onModuleInit()).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('Redis timeout'),
    );
  });

  it('вызывает очистку истёкших токенов при обработке задания', async () => {
    cleanupExpiredTokensAsync.mockResolvedValueOnce(7);

    await processor.process({} as never);

    expect(cleanupExpiredTokensAsync).toHaveBeenCalledTimes(1);
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining('удалено строк 7'),
    );
  });
});
