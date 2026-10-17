import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  LocalMediaStorage,
  NoopMediaStorage,
  S3MediaStorage,
  createMediaStorage,
  resolveFileExtension,
  sanitizeStorageSegment,
} from './media-storage.service.js';

/**
 * Хранилище media-результатов (R7.8, KI-362).
 *
 * Скачивание проверяется на реальном диске во временном каталоге, а граница
 * сети подменяется `fetch` — внешний провайдер в тестах не нужен.
 */

/** Каталог хранилища на время теста. */
let baseDir = '';

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'wb-media-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(baseDir, { recursive: true, force: true });
});

/**
 * Подменяет `fetch` ответом с заданным телом.
 *
 * @param body - байты тела
 * @param init - статус и заголовки ответа
 */
function stubFetch(body: Uint8Array, init: ResponseInit = {}): void {
  // Приведение к `BodyInit`: типы DOM и `@types/node` расходятся по форме
  // `Uint8Array`, в рантайме `Response` принимает байты как есть.
  const payload = body as unknown as BodyInit;

  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(payload, { status: 200, ...init }))),
  );
}

describe('LocalMediaStorage: скачивание и отдача (R7.8, KI-362)', () => {
  it('скачивает результат и кладёт файл в ./data/media-подобный каталог', async () => {
    const body = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    stubFetch(body, { headers: { 'content-type': 'image/png' } });

    const storage = new LocalMediaStorage(baseDir, 30);
    const saved = await storage.uploadAsync({
      runId: 'run-1',
      nodeId: 'node-a',
      sourceUrl: 'https://provider.test/out.png',
    });

    expect(saved.storedUrl).toBe('/media/file/run-1/node-a.png');
    expect(saved.storageKey).toBe('run-1/node-a.png');
    expect(saved.bytes).toBe(body.byteLength);
    // TTL считается от текущего момента (30 дней).
    const days = (saved.storedExpiresAt?.getTime() ?? 0) - Date.now();
    expect(days).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(days).toBeLessThan(31 * 24 * 60 * 60 * 1000);

    const onDisk = await readFile(join(baseDir, 'run-1', 'node-a.png'));
    expect([...onDisk]).toEqual([...body]);
  });

  it('TTL=0 — ссылка без срока (storedExpiresAt = null)', async () => {
    stubFetch(new Uint8Array([1, 2, 3]));

    const storage = new LocalMediaStorage(baseDir, 0);
    const saved = await storage.uploadAsync({
      runId: 'run-2',
      nodeId: 'node-b',
      sourceUrl: 'https://provider.test/out',
    });

    expect(saved.storedExpiresAt).toBeNull();
    // Без content-type и без расширения в URL — `.bin`.
    expect(saved.storageKey).toBe('run-2/node-b.bin');
  });

  it('ошибка upstream → исключение, частичный файл удалён', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 502 }))),
    );

    const storage = new LocalMediaStorage(baseDir, 30);

    await expect(
      storage.uploadAsync({
        runId: 'run-3',
        nodeId: 'node-c',
        sourceUrl: 'https://provider.test/broken.png',
      }),
    ).rejects.toThrow(/502/);

    await expect(stat(join(baseDir, 'run-3', 'node-c.png'))).rejects.toThrow();
  });

  it('слишком большой Content-Length → исключение до записи', async () => {
    stubFetch(new Uint8Array([1]), {
      headers: { 'content-length': String(500 * 1024 * 1024) },
    });

    const storage = new LocalMediaStorage(baseDir, 30);

    await expect(
      storage.uploadAsync({
        runId: 'run-4',
        nodeId: 'node-d',
        sourceUrl: 'https://provider.test/huge.mp4',
      }),
    ).rejects.toThrow(/лимита/);
  });

  it('openAsync отдаёт поток, MIME-тип и размер; отсутствующий файл — null', async () => {
    const body = new Uint8Array([9, 8, 7]);
    stubFetch(body, { headers: { 'content-type': 'video/mp4' } });

    const storage = new LocalMediaStorage(baseDir, 30);
    const saved = await storage.uploadAsync({
      runId: 'run-5',
      nodeId: 'node-e',
      sourceUrl: 'https://provider.test/out',
    });
    const opened = await storage.openAsync(saved.storageKey);

    expect(opened?.contentType).toBe('video/mp4');
    expect(opened?.bytes).toBe(body.byteLength);

    const chunks: Buffer[] = [];

    for await (const chunk of opened?.stream ?? []) {
      chunks.push(chunk as Buffer);
    }

    expect(Buffer.concat(chunks).equals(Buffer.from(body))).toBe(true);
    await expect(storage.openAsync('run-5/missing.mp4')).resolves.toBeNull();
  });

  it('openAsync не выпускает за пределы каталога (path traversal)', async () => {
    const storage = new LocalMediaStorage(baseDir, 30);

    await expect(storage.openAsync('../secret.txt')).rejects.toThrow(/пределы/);
  });
});

describe('Нормализация имён и расширений (R7.8)', () => {
  it('санитизирует nodeId из пользовательского графа', () => {
    expect(sanitizeStorageSegment('node/../../etc')).toBe('node_____etc');
    expect(sanitizeStorageSegment('')).toBe('unknown');
    expect(sanitizeStorageSegment('...')).toBe('unknown');
  });

  it('выбирает расширение по Content-Type, затем по URL, затем .bin', () => {
    expect(resolveFileExtension('https://x/out', 'image/webp')).toBe('webp');
    expect(resolveFileExtension('https://x/out', 'image/webp; charset=binary')).toBe(
      'webp',
    );
    expect(resolveFileExtension('https://x/out.MP4')).toBe('mp4');
    expect(resolveFileExtension('https://x/out.exe')).toBe('bin');
    expect(resolveFileExtension('not-a-url')).toBe('bin');
  });
});

describe('Другие бэкенды хранилища (R7.8)', () => {
  it('none: ничего не сохраняет', async () => {
    const storage = new NoopMediaStorage();

    expect(storage.backend).toBe('none');
    await expect(
      storage.uploadAsync({ runId: 'r', nodeId: 'n', sourceUrl: 'https://x/y.png' }),
    ).resolves.toBeNull();
    await expect(storage.openAsync('r/n.png')).resolves.toBeNull();
  });

  it('s3 (заглушка): не падает и возвращает null — узел живёт на ссылке провайдера', async () => {
    const storage = new S3MediaStorage('https://s3.test', 'bucket');

    expect(storage.backend).toBe('s3');
    await expect(
      storage.uploadAsync({ runId: 'r', nodeId: 'n', sourceUrl: 'https://x/y.png' }),
    ).resolves.toBeNull();
  });

  it('createMediaStorage выбирает бэкенд по env', () => {
    const config = (values: Record<string, unknown>): ConfigService =>
      ({ get: (key: string) => values[key] }) as unknown as ConfigService;

    expect(createMediaStorage(config({ MEDIA_STORAGE_BACKEND: 'none' })).backend).toBe(
      'none',
    );
    expect(createMediaStorage(config({ MEDIA_STORAGE_BACKEND: 's3' })).backend).toBe(
      's3',
    );
    expect(createMediaStorage(config({})).backend).toBe('local');
  });
});
