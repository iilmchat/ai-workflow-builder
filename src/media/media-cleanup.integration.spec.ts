import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../db/db.module.js';
import { MediaCleanupService } from './media-cleanup.service.js';

/**
 * Интеграционный тест cron-очистки (KI-413).
 *
 * В отличие от юнитов (`media-cleanup.service.spec.ts`, где `node:fs/promises`
 * замокан), здесь всё настоящее: файлы пишутся на диск во временный каталог,
 * `mtime` выставляется через `utimes`, а решение «что удалять» проверяется по
 * фактическому состоянию файловой системы. Подменена только БД: вместо живого
 * PostgreSQL — заглушка контракта Drizzle с просроченной строкой `node_runs`.
 * Живая БД проверяется отдельно в `media-storage.integration.spec.ts` при
 * заданном `DATABASE_URL`.
 */

/** Миллисекунд в сутках. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** TTL в тесте: 30 дней. */
const TTL_DAYS = 30;

/** Временный корень теста. */
let root = '';

/** Каталог media-хранилища. */
let mediaDir = '';

/** Каталог workspace. */
let workspaceDir = '';

/**
 * Создаёт файл с заданным «возрастом» (mtime).
 *
 * @param path - абсолютный путь файла
 * @param content - содержимое
 * @param ageDays - сколько дней назад файл изменялся
 * @returns промис без значения
 */
async function writeAgedFileAsync(
  path: string,
  content: string,
  ageDays: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  const timestamp = new Date(Date.now() - ageDays * DAY_MS);

  await utimes(path, timestamp, timestamp);
}

/**
 * Проверяет существование файла.
 *
 * @param path - абсолютный путь
 * @returns `true`, если файл есть
 */
async function existsAsync(path: string): Promise<boolean> {
  try {
    await stat(path);

    return true;
  } catch {
    return false;
  }
}

/**
 * Заглушка БД: одна просроченная строка `node_runs` с `storage_key`.
 *
 * Имитирует контракт `db.select({...}).from(nodeRuns).where(...)`; фильтрация
 * не нужна — сервис ожидает уже отфильтрованные строки от SQL.
 *
 * @returns соединение-заглушка
 */
function expiredRowsDb(): Database {
  return {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve([{ storageKey: 'run-db/expired.png' }]),
      }),
    }),
  } as unknown as Database;
}

describe('MediaCleanupService: cron-очистка на реальной ФС (KI-413)', () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'wb-cleanup-integration-'));
    mediaDir = join(root, 'media');
    workspaceDir = join(root, 'workspace');

    // media: старый и свежий файлы одного прогона.
    await writeAgedFileAsync(join(mediaDir, 'run-old', 'old.png'), 'old', 40);
    await writeAgedFileAsync(
      join(mediaDir, 'run-old', 'fresh.png'),
      'fresh',
      1,
    );
    // media: файл, который удаляется только по TTL из БД (свежий mtime).
    await writeAgedFileAsync(
      join(mediaDir, 'run-db', 'expired.png'),
      'expired-by-db',
      1,
    );

    // workspace: вложенность, старый/свежий файлы, опустевший каталог.
    await writeAgedFileAsync(join(workspaceDir, 'wf-1', 'old.txt'), 'old', 45);
    await writeAgedFileAsync(
      join(workspaceDir, 'wf-1', 'fresh.txt'),
      'fresh',
      1,
    );
    await writeAgedFileAsync(
      join(workspaceDir, 'wf-1', 'notes', 'nested-old.txt'),
      'nested-old',
      50,
    );
    await writeAgedFileAsync(
      join(workspaceDir, 'wf-2', 'recent', 'keep.txt'),
      'keep',
      1,
    );
  }, 30_000);

  afterAll(async () => {
    if (root.length > 0) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('удаляет просроченное, оставляет свежее и вычищает пустые каталоги', async () => {
    const service = new MediaCleanupService(mediaDir, TTL_DAYS, {
      db: expiredRowsDb(),
      mediaBackend: 'local',
      workspacePath: workspaceDir,
      workspaceTtlDays: TTL_DAYS,
    });

    const result = await service.cleanupAsync();

    // 1) media по mtime: старый удалён, свежий остался.
    expect(await existsAsync(join(mediaDir, 'run-old', 'old.png'))).toBe(false);
    expect(await existsAsync(join(mediaDir, 'run-old', 'fresh.png'))).toBe(true);
    expect(result.removedFiles).toBe(1);

    // 2) media по TTL из БД: удалён по storage_key, хотя mtime свежий.
    expect(await existsAsync(join(mediaDir, 'run-db', 'expired.png'))).toBe(
      false,
    );
    expect(result.removedExpiredDbFiles).toBe(1);

    // 3) workspace: старые файлы удалены рекурсивно, свежие — нет.
    expect(await existsAsync(join(workspaceDir, 'wf-1', 'old.txt'))).toBe(false);
    expect(
      await existsAsync(join(workspaceDir, 'wf-1', 'notes', 'nested-old.txt')),
    ).toBe(false);
    expect(await existsAsync(join(workspaceDir, 'wf-1', 'fresh.txt'))).toBe(
      true,
    );
    expect(await existsAsync(join(workspaceDir, 'wf-2', 'recent', 'keep.txt'))).toBe(
      true,
    );
    expect(result.removedWorkspaceFiles).toBe(2);

    // Опустевший `notes` удалён, каталог со свежим файлом — нет.
    expect(await existsAsync(join(workspaceDir, 'wf-1', 'notes'))).toBe(false);
    expect(result.removedWorkspaceDirectories).toBe(1);
  });

  it('повторный проход идемпотентен (удалять больше нечего)', async () => {
    const service = new MediaCleanupService(mediaDir, TTL_DAYS, {
      db: expiredRowsDb(),
      mediaBackend: 'local',
      workspacePath: workspaceDir,
      workspaceTtlDays: TTL_DAYS,
    });

    const result = await service.cleanupAsync();

    expect(result.removedFiles).toBe(0);
    expect(result.removedExpiredDbFiles).toBe(0);
    expect(result.removedWorkspaceFiles).toBe(0);
    // Свежие файлы на месте.
    expect(await readFile(join(mediaDir, 'run-old', 'fresh.png'), 'utf8')).toBe(
      'fresh',
    );
  });
});
