import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  LocalMediaStorage,
  NoopMediaStorage,
  S3MediaStorage,
  buildGeneratedStorageKey,
  createMediaStorage,
  normalizeGeneratedExtension,
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

/**
 * Дочитывает `Body` команды S3 в буфер.
 *
 * `Upload` (KI-442) отправляет чанки буфером, но helper оставляет поддержку
 * `Readable`: так проверка «SDK получил ровно те байты» не зависит от того,
 * какую форму тела выбрал SDK.
 *
 * @param body - `Body` из `PutObjectCommand.input`/`UploadPartCommand.input`
 * @returns собранные байты
 * @throws Error если тело не поток и не байты
 */
async function readCommandBodyAsync(body: unknown): Promise<Buffer> {
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];

    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }

    return Buffer.concat(chunks);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  throw new Error(`Неожиданный тип Body: ${typeof body}`);
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
    await expect(storage.refreshStoredUrlAsync('r/n.png')).resolves.toBeNull();
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

/**
 * Конфигурация настоящего клиента для подставного `send`.
 *
 * `Upload` из `@aws-sdk/lib-storage` читает из `client.config` endpoint,
 * path-style и настройку checksums, поэтому одного `send` тестовой заглушке
 * уже недостаточно (KI-442).
 */
const REAL_S3_CONFIG = new S3Client({
  region: 'us-east-1',
  endpoint: 'https://s3.test',
  forcePathStyle: true,
  credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
}).config;

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
      client: { send, config: REAL_S3_CONFIG } as unknown as S3ClientLike,
    };
  }

  it('Upload кладёт тело одним PutObject и отдаёт signed URL приватного бакета', async () => {
    const body = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    stubFetch(body, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(body.byteLength),
      },
    });

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
    // KI-442: `Upload` буферизует чанк — SDK может повторить запрос с теми
    // же байтами (одноразовый поток после первого чтения уже пуст).
    expect(command.input.Body).not.toBeInstanceOf(Readable);
    expect(await readCommandBodyAsync(command.input.Body)).toEqual(Buffer.from(body));

    expect(saved?.storageKey).toBe('run-1/node-a.png');
    expect(saved?.bytes).toBe(body.byteLength);
    // Публичность бакета не задана — safe default: presigned GET (KI-425).
    expect(saved?.storedUrl).toContain('https://s3.test/media/run-1/node-a.png?');
    expect(saved?.storedUrl).toContain('X-Amz-Expires=3600');
    expect(saved?.storedUrl).toContain('X-Amz-Signature=');
    expect(saved?.storedExpiresAt).toBeInstanceOf(Date);

    const seconds = (saved?.storedExpiresAt?.getTime() ?? 0) - Date.now();
    expect(seconds).toBeGreaterThan(3500 * 1000);
    expect(seconds).toBeLessThan(3700 * 1000);
  });

  it('без Content-Length не передаёт длину: Upload считает байты сам', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    stubFetch(body, { headers: { 'content-type': 'video/mp4' } });

    const uploaded: Buffer[] = [];
    // `Upload` вычитывает Body чанками сам — заглушка делает то же, иначе
    // счётчик размера (KI-427) не успевает сработать.
    const send = vi.fn(async (command: PutObjectCommand) => {
      uploaded.push(await readCommandBodyAsync(command.input.Body));

      return {};
    });
    const storage = new S3MediaStorage(optionsWith(send));

    const saved = await storage.uploadAsync({
      runId: 'run-1',
      nodeId: 'node-a',
      sourceUrl: 'https://provider.test/out.mp4',
    });

    const command = send.mock.calls[0]?.[0];

    expect(command.input.ContentLength).toBeUndefined();
    expect(uploaded[0]).toEqual(Buffer.from(body));
    expect(saved?.bytes).toBe(body.byteLength);
  });

  it('KI-442: объект больше 5 МБ уходит multipart-чанками, готовыми к повтору', async () => {
    const partSize = 5 * 1024 * 1024;
    const body = new Uint8Array(partSize + 1024);
    stubFetch(body, {
      headers: {
        'content-type': 'video/mp4',
        'content-length': String(body.byteLength),
      },
    });

    const commands: unknown[] = [];
    const send = vi.fn(async (command: unknown) => {
      commands.push(command);

      if (command instanceof CreateMultipartUploadCommand) {
        return { UploadId: 'upload-1' };
      }

      if (command instanceof UploadPartCommand) {
        return { ETag: `"etag-${command.input.PartNumber ?? 0}"` };
      }

      if (command instanceof CompleteMultipartUploadCommand) {
        return {};
      }

      return {};
    });
    const storage = new S3MediaStorage(optionsWith(send));

    const saved = await storage.uploadAsync({
      runId: 'run-1',
      nodeId: 'node-a',
      sourceUrl: 'https://provider.test/out.mp4',
    });

    expect(saved?.bytes).toBe(body.byteLength);
    expect(
      commands.some((command) => command instanceof CreateMultipartUploadCommand),
    ).toBe(true);

    const parts = commands
      .filter((command): command is UploadPartCommand =>
        command instanceof UploadPartCommand,
      )
      .sort(
        (left, right) =>
          (left.input.PartNumber ?? 0) - (right.input.PartNumber ?? 0),
      );

    // Каждая часть — самостоятельный буфер: её можно отправить повторно.
    expect(parts).toHaveLength(2);
    expect((await readCommandBodyAsync(parts[0]?.input.Body)).byteLength).toBe(
      partSize,
    );
    expect((await readCommandBodyAsync(parts[1]?.input.Body)).byteLength).toBe(1024);

    const complete = commands.find(
      (command): command is CompleteMultipartUploadCommand =>
        command instanceof CompleteMultipartUploadCommand,
    );

    expect(complete?.input.MultipartUpload?.Parts).toHaveLength(2);
  });

  it('KI-442: повторяет PutObject после 503 (буфер вместо одноразового потока)', async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    stubFetch(body, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(body.byteLength),
      },
    });

    let attempts = 0;
    const server = createServer((request, response) => {
      request.on('data', () => undefined);
      request.on('end', () => {
        attempts += 1;

        if (attempts === 1) {
          response.writeHead(503, { 'content-type': 'application/xml' });
          response.end('<Error><Code>SlowDown</Code><Message>retry</Message></Error>');

          return;
        }

        response.writeHead(200, { ETag: '"etag-1"' });
        response.end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const endpoint = `http://127.0.0.1:${address.port}`;
      const storage = new S3MediaStorage({
        endpoint,
        bucket: 'media',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        ttlDays: 30,
        publicBucket: true,
      });

      const saved = await storage.uploadAsync({
        runId: 'run-1',
        nodeId: 'node-a',
        sourceUrl: 'https://provider.test/out.png',
      });

      // Первый PUT — 503, второй — 200: результат не потерян.
      expect(saved).not.toBeNull();
      expect(attempts).toBe(2);
      expect(saved?.storedUrl).toBe(`${endpoint}/media/run-1/node-a.png`);
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it('публичный бакет — прямой URL и TTL в днях (KI-425)', async () => {
    const body = new Uint8Array([1, 2, 3]);
    stubFetch(body, {
      headers: {
        'content-type': 'image/png',
        'content-length': String(body.byteLength),
      },
    });

    const send = vi.fn(async (command: PutObjectCommand) => {
      await readCommandBodyAsync(command.input.Body);

      return {};
    });
    const storage = new S3MediaStorage({
      ...optionsWith(send),
      publicBucket: true,
    });
    const saved = await storage.uploadAsync({
      runId: 'run-1',
      nodeId: 'node-a',
      sourceUrl: 'https://provider.test/out.png',
    });

    // Endpoint без хвостового `/`, path-style.
    expect(saved?.storedUrl).toBe('https://s3.test/media/run-1/node-a.png');
    expect(saved?.storedUrl).not.toContain('X-Amz-Signature');

    const days = (saved?.storedExpiresAt?.getTime() ?? 0) - Date.now();
    expect(days).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(days).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it('getSignedUrlAsync подписывает GetObject на час (KI-425)', async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const storage = new S3MediaStorage(optionsWith(send));

    const signed = await storage.getSignedUrlAsync('run-1/node-a.png');

    expect(signed).toContain('https://s3.test/media/run-1/node-a.png?');
    expect(signed).toContain('X-Amz-Expires=3600');
    expect(signed).toContain('X-Amz-Signature=');
    // Подпись локальная: ни одной команды в S3 не отправлено.
    expect(send).not.toHaveBeenCalled();
  });

  it('KI-443: refreshStoredUrlAsync переподписывает просроченный URL по ключу', async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const storage = new S3MediaStorage(optionsWith(send));

    const refreshed = await storage.refreshStoredUrlAsync(
      'https://s3.test/media/run-1/node-a.png?X-Amz-Signature=old',
    );

    expect(refreshed?.storedUrl).toContain(
      'https://s3.test/media/run-1/node-a.png?',
    );
    expect(refreshed?.storedUrl).toContain('X-Amz-Signature=');
    expect(refreshed?.storedUrl).not.toContain('old');
    expect(refreshed?.storedExpiresAt).toBeInstanceOf(Date);

    const seconds = (refreshed?.storedExpiresAt?.getTime() ?? 0) - Date.now();
    expect(seconds).toBeGreaterThan(3500 * 1000);
    expect(seconds).toBeLessThan(3700 * 1000);
    // Переподпись локальная: в S3 ничего не отправляется.
    expect(send).not.toHaveBeenCalled();
  });

  it('KI-443: refreshStoredUrlAsync не трогает чужой bucket и публичный URL', async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const privateStorage = new S3MediaStorage(optionsWith(send));

    await expect(
      privateStorage.refreshStoredUrlAsync(
        'https://other.test/other-bucket/run-1/node-a.png',
      ),
    ).resolves.toBeNull();

    const publicStorage = new S3MediaStorage({
      ...optionsWith(send),
      publicBucket: true,
    });

    await expect(
      publicStorage.refreshStoredUrlAsync(
        'https://s3.test/media/run-1/node-a.png',
      ),
    ).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('getSignedUrlAsync без настроек S3 — исключение', async () => {
    const storage = new S3MediaStorage({
      ...optionsWith(vi.fn(() => Promise.resolve({}))),
      accessKeyId: undefined,
    });

    await expect(storage.getSignedUrlAsync('run-1/node-a.png')).rejects.toThrow(
      /не настроен/,
    );
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

  it('публичный бакет с TTL=0 — ссылка без срока (storedExpiresAt = null)', async () => {
    stubFetch(new Uint8Array([1, 2, 3]));

    const send = vi.fn(() => Promise.resolve({}));
    const storage = new S3MediaStorage({
      ...optionsWith(send),
      ttlDays: 0,
      publicBucket: true,
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

/** MIME-тип DOCX — его отдаёт `openAsync` и получает S3 (v0.10 S5). */
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Минимальный «DOCX»: важен только ZIP-заголовок `PK\x03\x04`. */
const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0]);

describe('saveGeneratedAsync: документы (v0.10 S5)', () => {
  it('local: пишет generated-<nodeId>.<ext> и возвращает ключ и URL', async () => {
    const storage = new LocalMediaStorage(baseDir, 30);
    const saved = await storage.saveGeneratedAsync(
      DOCX_BYTES,
      'docx',
      'run-1',
      'node-a',
    );

    expect(saved).toEqual({
      url: '/media/file/run-1/generated-node-a.docx',
      key: 'run-1/generated-node-a.docx',
    });

    const onDisk = await readFile(
      join(baseDir, 'run-1', 'generated-node-a.docx'),
    );

    expect(onDisk.equals(DOCX_BYTES)).toBe(true);

    // Документ отдаётся той же ручкой `GET /media/file/...`, что и media.
    const opened = await storage.openAsync(saved.key ?? '');

    expect(opened?.contentType).toBe(DOCX_MIME);
    expect(opened?.bytes).toBe(DOCX_BYTES.byteLength);
  });

  it('local: нормализует расширение и санитизирует сегменты ключа', async () => {
    const storage = new LocalMediaStorage(baseDir, 30);
    const saved = await storage.saveGeneratedAsync(
      Buffer.from([1, 2, 3]),
      '.DOCX',
      'run/../1',
      '../node',
    );

    // `..` вырезается, `/` заменяется на `_` — за пределы каталога не выйти.
    expect(saved.key).toBe('run___1/generated-node.docx');
    expect(saved.url).toBe('/media/file/run___1/generated-node.docx');
  });

  it('local: недопустимое расширение заменяется на bin', async () => {
    const storage = new LocalMediaStorage(baseDir, 30);
    const saved = await storage.saveGeneratedAsync(
      Buffer.from([1]),
      'tar.gz',
      'run-1',
      'node-a',
    );

    expect(saved.key).toBe('run-1/generated-node-a.bin');
  });

  it('noop: хранилище выключено — null-поля без исключения', async () => {
    const storage = new NoopMediaStorage();

    await expect(
      storage.saveGeneratedAsync(DOCX_BYTES, 'docx', 'run-1', 'node-a'),
    ).resolves.toEqual({ url: null, key: null });
  });
});

describe('S3MediaStorage: saveGeneratedAsync (v0.10 S5)', () => {
  /**
   * Собирает S3-хранилище с подставным `send`.
   *
   * @param send - заглушка отправки команд (вместо сети)
   * @param options - переопределения (публичный бакет, отсутствие ключей)
   * @returns хранилище для теста
   */
  function createStorage(
    send: ReturnType<typeof vi.fn>,
    options: Partial<S3MediaStorageOptions> = {},
  ): S3MediaStorage {
    return new S3MediaStorage({
      endpoint: 'https://s3.test/',
      bucket: 'documents',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      region: 'us-east-1',
      ttlDays: 30,
      client: { send, config: REAL_S3_CONFIG } as unknown as S3ClientLike,
      ...options,
    });
  }

  it('кладёт буфер одним PutObject и отдаёт presigned URL', async () => {
    let uploaded: Buffer | undefined;
    const send = vi.fn(async (command: PutObjectCommand) => {
      uploaded = await readCommandBodyAsync(command.input.Body);

      return {};
    });
    const storage = createStorage(send);

    const saved = await storage.saveGeneratedAsync(
      DOCX_BYTES,
      'docx',
      'run-1',
      'node-a',
    );

    expect(send).toHaveBeenCalledTimes(1);

    const command = send.mock.calls[0]?.[0];

    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'documents',
      Key: 'run-1/generated-node-a.docx',
      ContentType: DOCX_MIME,
      ContentLength: DOCX_BYTES.byteLength,
    });
    // `Upload` получает готовый буфер: повтор запроса не теряет данные.
    expect(uploaded?.equals(DOCX_BYTES)).toBe(true);

    expect(saved.key).toBe('run-1/generated-node-a.docx');
    // Публичность не задана — безопасный дефолт: presigned GET.
    expect(saved.url).toContain(
      'https://s3.test/documents/run-1/generated-node-a.docx?',
    );
    expect(saved.url).toContain('X-Amz-Signature=');
  });

  it('публичный бакет — прямой URL без подписи', async () => {
    const send = vi.fn((_command: PutObjectCommand) => Promise.resolve({}));
    const storage = createStorage(send, { publicBucket: true });

    const saved = await storage.saveGeneratedAsync(
      DOCX_BYTES,
      'docx',
      'run-1',
      'node-a',
    );

    expect(saved).toEqual({
      key: 'run-1/generated-node-a.docx',
      url: 'https://s3.test/documents/run-1/generated-node-a.docx',
    });
  });

  it('S3 не настроен — null-поля и ни одного вызова клиента', async () => {
    const send = vi.fn(() => Promise.resolve({}));
    const storage = createStorage(send, {
      accessKeyId: undefined,
      secretAccessKey: undefined,
    });

    await expect(
      storage.saveGeneratedAsync(DOCX_BYTES, 'docx', 'run-1', 'node-a'),
    ).resolves.toEqual({ url: null, key: null });
    expect(send).not.toHaveBeenCalled();
  });

  it('S3 недоступен — null-поля, исключения нет', async () => {
    const send = vi.fn(() => Promise.reject(new Error('S3 connection refused')));
    const storage = createStorage(send);

    await expect(
      storage.saveGeneratedAsync(DOCX_BYTES, 'docx', 'run-1', 'node-a'),
    ).resolves.toEqual({ url: null, key: null });
  });
});

describe('Нормализация ключа сгенерированного файла (v0.10 S5)', () => {
  it('normalizeGeneratedExtension приводит регистр и отбрасывает опасные значения', () => {
    expect(normalizeGeneratedExtension('DOCX')).toBe('docx');
    expect(normalizeGeneratedExtension('.pdf')).toBe('pdf');
    expect(normalizeGeneratedExtension('../../evil')).toBe('bin');
    expect(normalizeGeneratedExtension('')).toBe('bin');
  });

  it('buildGeneratedStorageKey использует префикс generated-', () => {
    expect(buildGeneratedStorageKey('run-1', 'node-a', 'docx')).toBe(
      'run-1/generated-node-a.docx',
    );
  });
});
