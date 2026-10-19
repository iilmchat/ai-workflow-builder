import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { MediaStorageController } from './media-storage.controller.js';
import type { IMediaStorage } from './media-storage.service.js';
import { buildSignedMediaPath, type MediaSigningOptions } from './media-url-signer.js';

/**
 * Проверка подписи в `GET /media/file/:runId/:fileName` (KI-415).
 *
 * Контроллер вызывается напрямую (без HTTP): проверяется решение «403 или
 * отдача», а не работа Nest-роутинга. Хранилище подменено — диск и файлы не
 * нужны.
 */

/** Секрет для тестов: HMAC-подпись, не API-ключ. */
const SECRET = 'unit-test-media-signing-secret';

/** Параметры подписи, которые увидит контроллер через ConfigService. */
const SIGNING: MediaSigningOptions = { secret: SECRET, ttlSeconds: 3600 };

/** Ключ объекта в тестах. */
const RUN_ID = 'run-1';
const FILE_NAME = 'node-a.png';
const STORAGE_KEY = `${RUN_ID}/${FILE_NAME}`;

/**
 * Собирает заглушку хранилища.
 *
 * `openAsync` возвращается отдельной ссылкой: `expect(openAsync)`
 * поднимает предупреждение oxlint/unbound-method (метод без `this`).
 *
 * @param found - отдавать ли файл
 * @returns хранилище-заглушка и его `openAsync`
 */
function storageStub(found = true): {
  storage: IMediaStorage;
  openAsync: ReturnType<typeof vi.fn>;
} {
  const openAsync = vi.fn(() =>
    Promise.resolve(
      found
        ? {
            stream: Readable.from([Buffer.from([1, 2, 3])]),
            contentType: 'image/png',
            bytes: 3,
          }
        : null,
    ),
  );

  return {
    openAsync,
    storage: {
      backend: 'local',
      uploadAsync: vi.fn(() => Promise.resolve(null)),
      saveGeneratedAsync: vi.fn(() => Promise.resolve({ url: null, key: null })),
      openAsync,
      refreshStoredUrlAsync: vi.fn(() => Promise.resolve(null)),
      refreshStoredUrlByKeyAsync: vi.fn(() => Promise.resolve(null)),
    },
  };
}

/**
 * Собирает `ConfigService`-заглушку.
 *
 * @param values - карта env
 * @returns объект с `get` (структурно совпадает с ConfigService)
 */
function configStub(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Достаёт query-параметры подписи из пути.
 *
 * @param path - подписанный путь
 * @returns значения `expires` и `sign`
 */
function signatureOf(path: string): { expires: string; sign: string } {
  const url = new URL(path, 'http://localhost');

  return {
    expires: url.searchParams.get('expires') ?? '',
    sign: url.searchParams.get('sign') ?? '',
  };
}

describe('MediaStorageController: подписанные ссылки (KI-415)', () => {
  it('валидная подпись — файл отдаётся', async () => {
    const { storage, openAsync } = storageStub();
    const controller = new MediaStorageController(
      storage,
      configStub({ JWT_SECRET: SECRET }),
    );
    const { expires, sign } = signatureOf(
      buildSignedMediaPath(STORAGE_KEY, SIGNING).path,
    );

    const file = await controller.readFileAsync(RUN_ID, FILE_NAME, sign, expires);

    expect(openAsync).toHaveBeenCalledWith(STORAGE_KEY);
    expect(file.getStream()).toBeInstanceOf(Readable);
  });

  it('без подписи при настроенном секрете — 403, файл не читается', async () => {
    const { storage, openAsync } = storageStub();
    const controller = new MediaStorageController(
      storage,
      configStub({ JWT_SECRET: SECRET }),
    );

    await expect(
      controller.readFileAsync(RUN_ID, FILE_NAME),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(openAsync).not.toHaveBeenCalled();
  });

  it('подпись чужого файла — 403', async () => {
    const { storage } = storageStub();
    const controller = new MediaStorageController(
      storage,
      configStub({ JWT_SECRET: SECRET }),
    );
    // Подпись выпущена для другого файла: путь подменён, HMAC не сойдётся.
    const { expires, sign } = signatureOf(
      buildSignedMediaPath(`${RUN_ID}/other.png`, SIGNING).path,
    );

    await expect(
      controller.readFileAsync(RUN_ID, FILE_NAME, sign, expires),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('истёкшая подпись — 403', async () => {
    const { storage } = storageStub();
    const controller = new MediaStorageController(
      storage,
      configStub({ JWT_SECRET: SECRET }),
    );
    // Подпись выпущена «в прошлом» на минуту: срок уже вышел.
    const expired = buildSignedMediaPath(
      STORAGE_KEY,
      SIGNING,
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );
    const { expires, sign } = signatureOf(expired.path);

    await expect(
      controller.readFileAsync(RUN_ID, FILE_NAME, sign, expires),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('без секрета подписи ручка работает как раньше (legacy/dev)', async () => {
    const { storage, openAsync } = storageStub();
    const controller = new MediaStorageController(storage, configStub({}));

    await expect(
      controller.readFileAsync(RUN_ID, FILE_NAME),
    ).resolves.toBeDefined();
    expect(openAsync).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('валидная подпись, но файла нет — 404', async () => {
    const { storage } = storageStub(false);
    const controller = new MediaStorageController(
      storage,
      configStub({ JWT_SECRET: SECRET }),
    );
    const { expires, sign } = signatureOf(
      buildSignedMediaPath(STORAGE_KEY, SIGNING).path,
    );

    await expect(
      controller.readFileAsync(RUN_ID, FILE_NAME, sign, expires),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
