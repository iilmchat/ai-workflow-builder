import type { Dirent, Stats } from 'node:fs';
import { readdir, rmdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIA_CLEANUP_CRON,
  MEDIA_CLEANUP_SCHEDULER_ID,
  MediaCleanupProcessor,
  MediaCleanupService,
} from './media-cleanup.service.js';

/**
 * Cron-очистка локального media-хранилища (R7.8, KI-413).
 *
 * Файловая система подменена `vi.mock('node:fs/promises')`: тест проверяет
 * решение «что удалять и что оставить», а не работу `unlink`. Настоящий диск
 * здесь не нужен, поэтому тест детерминирован и не зависит от mtime машины.
 */
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
}));

/** Корень хранилища в тестах (путь не существует — всё подменено). */
const BASE_DIR = join('virtual', 'data', 'media');

/** Миллисекунд в сутках. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Фиксированное «сейчас»: TTL считается от него, а не от системных часов. */
const NOW = new Date('2026-10-18T12:00:00.000Z');

/**
 * Собирает запись каталога для `readdir(..., { withFileTypes: true })`.
 *
 * @param name - имя файла/каталога
 * @param kind - тип записи
 * @returns заглушка `Dirent`
 */
function dirent(name: string, kind: 'file' | 'dir'): Dirent {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
  } as unknown as Dirent;
}

/**
 * Собирает `Stats` с заданным mtime.
 *
 * @param mtimeMs - время последнего изменения (мс)
 * @returns заглушка `Stats`
 */
function stats(mtimeMs: number): Stats {
  return { mtimeMs } as unknown as Stats;
}

/**
 * Ошибка файловой системы с кодом (`ENOENT`/`ENOTEMPTY`).
 *
 * @param code - код ошибки Node
 * @returns ошибка с полем `code`
 */
function fsError(code: string): Error {
  return Object.assign(new Error(`fs error ${code}`), { code });
}

/**
 * Настраивает `readdir` по путям: корень хранилища и каталоги запусков.
 *
 * @param tree - карта «путь → записи»
 */
function mockTree(tree: Record<string, Dirent[]>): void {
  vi.mocked(readdir).mockImplementation((async (path: string) => {
    const entries = tree[path];

    if (entries === undefined) {
      throw fsError('ENOENT');
    }

    return entries;
  }) as unknown as typeof readdir);
}

/**
 * Настраивает `stat` по путям файлов.
 *
 * @param mtimes - карта «путь → mtime в мс»
 */
function mockMtimes(mtimes: Record<string, number>): void {
  vi.mocked(stat).mockImplementation((async (path: string) => {
    const mtime = mtimes[path];

    if (mtime === undefined) {
      throw fsError('ENOENT');
    }

    return stats(mtime);
  }) as unknown as typeof stat);
}

beforeEach(() => {
  vi.mocked(readdir).mockReset();
  vi.mocked(stat).mockReset();
  vi.mocked(unlink).mockReset();
  vi.mocked(rmdir).mockReset();
  vi.mocked(unlink).mockResolvedValue(undefined);
  vi.mocked(rmdir).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MediaCleanupService: удаление по TTL (R7.8, KI-413)', () => {
  it('удаляет старые файлы, оставляет свежие и убирает опустевший каталог', async () => {
    const runDir = join(BASE_DIR, 'run-old');
    const oldFile = join(runDir, 'node-old.png');
    const freshFile = join(runDir, 'node-fresh.png');

    mockTree({
      [BASE_DIR]: [dirent('run-old', 'dir')],
      [runDir]: [dirent('node-old.png', 'file'), dirent('node-fresh.png', 'file')],
    });
    mockMtimes({
      // 40 дней — старше TTL 30 дней.
      [oldFile]: NOW.getTime() - 40 * DAY_MS,
      // 1 день — не трогаем.
      [freshFile]: NOW.getTime() - 1 * DAY_MS,
    });
    // Свежий файл остался — настоящий rmdir ответил бы ENOTEMPTY.
    vi.mocked(rmdir).mockRejectedValue(fsError('ENOTEMPTY'));

    const service = new MediaCleanupService(BASE_DIR, 30);
    const result = await service.cleanupAsync(NOW);

    expect(vi.mocked(unlink)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(unlink)).toHaveBeenCalledWith(oldFile);
    expect(vi.mocked(unlink)).not.toHaveBeenCalledWith(freshFile);
    // Каталог пытались убрать, но он не опустел — это не ошибка.
    expect(vi.mocked(rmdir)).toHaveBeenCalledWith(runDir);
    expect(result).toEqual({
      scannedFiles: 2,
      removedFiles: 1,
      removedDirectories: 0,
      skipped: false,
    });
  });

  it('удаляет опустевший каталог запуска после уборки', async () => {
    const runDir = join(BASE_DIR, 'run-empty');
    const oldFile = join(runDir, 'node-a.mp4');

    mockTree({
      [BASE_DIR]: [dirent('run-empty', 'dir')],
      [runDir]: [dirent('node-a.mp4', 'file')],
    });
    mockMtimes({ [oldFile]: NOW.getTime() - 31 * DAY_MS });

    const service = new MediaCleanupService(BASE_DIR, 30);
    const result = await service.cleanupAsync(NOW);

    expect(vi.mocked(unlink)).toHaveBeenCalledWith(oldFile);
    expect(vi.mocked(rmdir)).toHaveBeenCalledWith(runDir);
    expect(result.removedDirectories).toBe(1);
  });

  it('TTL=0 — очистка отключена, файлы не читаются и не удаляются', async () => {
    const service = new MediaCleanupService(BASE_DIR, 0);
    const result = await service.cleanupAsync(NOW);

    expect(result.skipped).toBe(true);
    expect(result.removedFiles).toBe(0);
    expect(vi.mocked(readdir)).not.toHaveBeenCalled();
    expect(vi.mocked(unlink)).not.toHaveBeenCalled();
  });

  it('корневого каталога нет — нормальный пустой проход без исключения', async () => {
    vi.mocked(readdir).mockRejectedValue(fsError('ENOENT'));

    const service = new MediaCleanupService(BASE_DIR, 30);
    const result = await service.cleanupAsync(NOW);

    expect(result).toEqual({
      scannedFiles: 0,
      removedFiles: 0,
      removedDirectories: 0,
      skipped: false,
    });
    expect(vi.mocked(unlink)).not.toHaveBeenCalled();
  });

  it('не-каталоги в корне и symlink-подобные записи пропускаются', async () => {
    mockTree({
      [BASE_DIR]: [dirent('stray.txt', 'file'), dirent('run-x', 'dir')],
      [join(BASE_DIR, 'run-x')]: [dirent('nested', 'dir')],
    });

    const service = new MediaCleanupService(BASE_DIR, 30);
    const result = await service.cleanupAsync(NOW);

    expect(vi.mocked(stat)).not.toHaveBeenCalled();
    expect(result.scannedFiles).toBe(0);
    expect(result.removedFiles).toBe(0);
  });

  it('ошибка удаления одного файла не прерывает проход', async () => {
    const runDir = join(BASE_DIR, 'run-locked');
    const lockedFile = join(runDir, 'locked.png');

    mockTree({
      [BASE_DIR]: [dirent('run-locked', 'dir')],
      [runDir]: [dirent('locked.png', 'file')],
    });
    mockMtimes({ [lockedFile]: NOW.getTime() - 60 * DAY_MS });
    vi.mocked(unlink).mockRejectedValue(fsError('EPERM'));

    const service = new MediaCleanupService(BASE_DIR, 30);
    const result = await service.cleanupAsync(NOW);

    expect(result.scannedFiles).toBe(1);
    expect(result.removedFiles).toBe(0);
    // rmdir не вызывается: удалять из каталога нечего было.
    expect(vi.mocked(rmdir)).not.toHaveBeenCalled();
  });
});

describe('MediaCleanupProcessor: расписание (R7.8, KI-413)', () => {
  /**
   * Собирает очередь-заглушку с `upsertJobScheduler`.
   *
   * @returns очередь и её метод регистрации расписания
   */
  function queueStub(): {
    queue: Queue<Record<string, never>>;
    upsert: ReturnType<typeof vi.fn>;
  } {
    const upsert = vi.fn(() => Promise.resolve({}));

    return {
      upsert,
      queue: {
        upsertJobScheduler: upsert,
      } as unknown as Queue<Record<string, never>>,
    };
  }

  it('регистрирует ежедневный cron при старте модуля', async () => {
    const { queue, upsert } = queueStub();
    const cleanup = new MediaCleanupService(BASE_DIR, 30);
    const processor = new MediaCleanupProcessor(cleanup, queue);

    await processor.onModuleInit();

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      MEDIA_CLEANUP_SCHEDULER_ID,
      { pattern: MEDIA_CLEANUP_CRON },
      expect.objectContaining({ name: 'cleanup' }),
    );
  });

  it('TTL=0 — расписание не регистрируется', async () => {
    const { queue, upsert } = queueStub();
    const cleanup = new MediaCleanupService(BASE_DIR, 0);
    const processor = new MediaCleanupProcessor(cleanup, queue);

    await processor.onModuleInit();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('process запускает очистку', async () => {
    const { queue } = queueStub();
    const cleanup = new MediaCleanupService(BASE_DIR, 30);
    const spy = vi
      .spyOn(cleanup, 'cleanupAsync')
      .mockResolvedValue({
        scannedFiles: 0,
        removedFiles: 0,
        removedDirectories: 0,
        skipped: false,
      });
    const processor = new MediaCleanupProcessor(cleanup, queue);

    await processor.process({
      data: {},
    } as unknown as Parameters<MediaCleanupProcessor['process']>[0]);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
