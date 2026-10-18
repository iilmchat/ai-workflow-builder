import { PutObjectCommand } from '@aws-sdk/client-s3';
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
  type S3ClientLike,
  type S3MediaStorageOptions,
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

  it('createMediaStorage выбирает бэкенд по env', () => {
    const config = (values: Record<string, unknown>): ConfigService =>
      ({ get: (key: string) => values[key] }) as unknown as ConfigService;

    expect(createMediaStorage(config({ MEDIA_STORAGE_BACKEND: 'none' })).backend).toBe(
      'none',
    );
    expect(createMediaStorage(config({})).backend).toBe('local');
  });

  it('createMediaStorage: s3 без ключей откатывается на local (KI-412)', () => {
    const config = (values: Record<string, unknown>): ConfigService =>
      ({ get: (key: string) => values[key] }) as unknown as ConfigService;

    // Бакет/ключи не заданы — S3 недоступен, сохранять «в никуда» нельзя.
    expect(createMediaStorage(config({ MEDIA_STORAGE_BACKEND: 's3' })).backend).toBe(
      'local',
    );
  });

  it('createMediaStorage: настроенный s3 остаётся s3 (KI-412)', () => {
    const config = (values: Record<string, unknown>): ConfigService =>
      ({ get: (key: string) => values[key] }) as unknown as ConfigService;

    const storage = createMediaStorage(
      config({
        MEDIA_STORAGE_BACKEND: 's3',
        S3_ENDPOINT: 'https://s3.test',
        S3_BUCKET: 'media',
        S3_ACCESS_KEY_ID: 'access',
        S3_SECRET_ACCESS_KEY: 'secret',
        S3_REGION: 'us-east-1',
        S3_TTL_DAYS: 30,
      }),
    );

    expect(storage.backend).toBe('s3');
  });
});

describe('S3MediaStorage: загрузка в бакет (R7.8, KI-412)', () => {
  /**
   * Собирает полные параметры S3 с подставным клиентом.
   *
   * @param send - заглушка `send` (проверяет команду вместо сети)
   * @returns параметры хранилища для теста
   */
  function optionsWith(send: ReturnType<typeof vi.fn>): S3MediaStorageOptions {
    return {
      endpoint: 'https://s3.test/',
      bucket: 'media',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      ttlDays: 30,
      client: { send } as unknown as S3ClientLike,
    };
  }

  it('скачивает результат и отправляет PutObjectCommand в бакет', async () => {
    const body = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    stubFetch(body, { headers: { 'content-type': 'image/png' } });

    const send = vi.fn((_command: PutObjectCommand) => Promise.resolve({}));
    const storage = new S3MediaStorage(optionsWith(send));

    const saved = await storage.uploadAsync({
      runId: 'run-1',
      nodeId: 'node-a',
      sourceUrl: 'https://provider.test/out.png',
    });

    // Ровно один вызов — один объект в бакете.
    expect(send).toHaveBeenCalledTimes(1);

    const command = send.mock.calls[0]?.[0];

    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'media',
      Key: 'run-1/node-a.png',
      ContentType: 'image/png',
      ContentLength: body.byteLength,
    });
    expect(command.input.Body).toEqual(body);

    expect(saved?.storageKey).toBe('run-1/node-a.png');
    // Ссылка ведёт прямо в бакет (path-style), endpoint без хвостового `/`.
    expect(saved?.storedUrl).toBe('https://s3.test/media/run-1/node-a.png');
    expect(saved?.bytes).toBe(body.byteLength);
    expect(saved?.storedExpiresAt).toBeInstanceOf(Date);

    const days = (saved?.storedExpiresAt?.getTime() ?? 0) - Date.now();
    expect(days).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(days).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it('S3 не настроен (нет ключей) → null и ни одного вызова клиента', async () => {
    stubFetch(new Uint8Array([1, 2, 3]));

    const send = vi.fn(() => Promise.resolve({}));
    const storage = new S3MediaStorage({
      ...optionsWith(send),
      accessKeyId: undefined,
      secretAccessKey: undefined,
    });

    expect(storage.isConfigured).toBe(false);
    await expect(
      storage.uploadAsync({
        runId: 'run-2',
        nodeId: 'node-b',
        sourceUrl: 'https://provider.test/out.png',
      }),
    ).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('S3 недоступен (send отклонён) → null, исключения нет', async () => {
    stubFetch(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'image/webp' },
    });

    const send = vi.fn(() => Promise.reject(new Error('S3 connection refused')));
    const storage = new S3MediaStorage(optionsWith(send));

    await expect(
      storage.uploadAsync({
        runId: 'run-3',
        nodeId: 'node-c',
        sourceUrl: 'https://provider.test/out',
      }),
    ).resolves.toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('upstream ответил ошибкой → null (узел живёт на ссылке провайдера)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 502 }))),
    );

    const send = vi.fn(() => Promise.resolve({}));
    const storage = new S3MediaStorage(optionsWith(send));

    await expect(
      storage.uploadAsync({
        runId: 'run-4',
        nodeId: 'node-d',
        sourceUrl: 'https://provider.test/broken.png',
      }),
    ).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('TTL=0 — ссылка без срока (storedExpiresAt = null)', async () => {
    stubFetch(new Uint8Array([1, 2, 3]));

    const send = vi.fn(() => Promise.resolve({}));
    const storage = new S3MediaStorage({
      ...optionsWith(send),
      ttlDays: 0,
    });
    const saved = await storage.uploadAsync({
      runId: 'run-5',
      nodeId: 'node-e',
      sourceUrl: 'https://provider.test/out',
    });

    expect(saved?.storedExpiresAt).toBeNull();
    // Без content-type и расширения в URL — `.bin`.
    expect(saved?.storageKey).toBe('run-5/node-e.bin');
  });
});
