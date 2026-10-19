import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEDIA_URL_TTL_SECONDS,
  MEDIA_FILE_URL_PREFIX,
  buildSignedMediaPath,
  parseLocalMediaStorageKey,
  parseSignedMediaUrlExpiry,
  resolveMediaSigningOptions,
  verifyMediaFileSignature,
  type MediaSigningOptions,
} from './media-url-signer.js';

/**
 * HMAC-подпись ссылок локального media (KI-415).
 *
 * Проверяются четыре свойства: подпись выпускается и проходит проверку,
 * подделка (ключ/подпись/секрет) не проходит, просроченная ссылка не проходит,
 * а параметры подписи собираются из env с правильным fallback'ом.
 */

/** Секрет для тестов: подпись HMAC, не API-ключ. */
const SECRET = 'unit-test-media-signing-secret';

/** Срок жизни ссылки в тестах — минута (удобно «просрочить»). */
const TTL_SECONDS = 60;

/** Фиксированное «сейчас»: тесты не зависят от системных часов. */
const NOW = new Date('2026-10-19T12:00:00.000Z');

/** Ключ объекта — как его строит LocalMediaStorage. */
const STORAGE_KEY = 'run-1/node-a.png';

/**
 * Собирает параметры подписи для теста.
 *
 * @param overrides - переопределения секрета/TTL
 * @returns параметры подписи
 */
function signingOptions(
  overrides: Partial<MediaSigningOptions> = {},
): MediaSigningOptions {
  return { secret: SECRET, ttlSeconds: TTL_SECONDS, ...overrides };
}

/**
 * Разбирает query-параметры подписанного пути.
 *
 * @param path - путь из `buildSignedMediaPath`
 * @returns `expires` и `sign` как строки
 */
function queryOf(path: string): { expires: string; sign: string } {
  const url = new URL(path, 'http://localhost');

  return {
    expires: url.searchParams.get('expires') ?? '',
    sign: url.searchParams.get('sign') ?? '',
  };
}

describe('buildSignedMediaPath: выпуск подписанной ссылки (KI-415)', () => {
  it('строит путь /media/file/<key> с expires и sign', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);

    expect(signed.path.startsWith(`${MEDIA_FILE_URL_PREFIX}/${STORAGE_KEY}?`)).toBe(
      true,
    );
    expect(signed.expiresAt.getTime()).toBe(
      NOW.getTime() + TTL_SECONDS * 1000,
    );

    const { expires, sign } = queryOf(signed.path);

    expect(Number(expires)).toBe(Math.floor(NOW.getTime() / 1000) + TTL_SECONDS);
    expect(sign).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('для одного ключа, срока и секрета подпись детерминирована', () => {
    const first = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const second = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);

    expect(second.path).toBe(first.path);
  });

  it('другой ключ при том же сроке даёт другую подпись', () => {
    const first = queryOf(
      buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW).path,
    );
    const second = queryOf(
      buildSignedMediaPath('run-1/node-b.png', signingOptions(), NOW).path,
    );

    expect(second.sign).not.toBe(first.sign);
  });
});

describe('verifyMediaFileSignature: проверка подписи (KI-415)', () => {
  it('валидная свежая подпись проходит', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const { expires, sign } = queryOf(signed.path);

    expect(
      verifyMediaFileSignature(STORAGE_KEY, sign, expires, signingOptions(), NOW),
    ).toBe(true);
  });

  it('просроченная ссылка не проходит', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const { expires, sign } = queryOf(signed.path);
    const afterExpiry = new Date(signed.expiresAt.getTime() + 1);

    expect(
      verifyMediaFileSignature(
        STORAGE_KEY,
        sign,
        expires,
        signingOptions(),
        afterExpiry,
      ),
    ).toBe(false);
  });

  it('подмена ключа объекта не проходит (подпись покрывает путь)', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const { expires, sign } = queryOf(signed.path);

    expect(
      verifyMediaFileSignature(
        'run-1/node-b.png',
        sign,
        expires,
        signingOptions(),
        NOW,
      ),
    ).toBe(false);
  });

  it('подмена или отсутствие sign не проходит', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const { expires, sign } = queryOf(signed.path);
    const tampered = `${sign.slice(0, -1)}A`;

    expect(
      verifyMediaFileSignature(STORAGE_KEY, tampered, expires, signingOptions(), NOW),
    ).toBe(false);
    expect(
      verifyMediaFileSignature(STORAGE_KEY, undefined, expires, signingOptions(), NOW),
    ).toBe(false);
    expect(
      verifyMediaFileSignature(STORAGE_KEY, '', expires, signingOptions(), NOW),
    ).toBe(false);
  });

  it('подпись чужим секретом не проходит', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const { expires, sign } = queryOf(signed.path);

    expect(
      verifyMediaFileSignature(
        STORAGE_KEY,
        sign,
        expires,
        signingOptions({ secret: 'another-unit-test-secret' }),
        NOW,
      ),
    ).toBe(false);
  });

  it('нечисловой expires не проходит и не бросает', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);
    const { sign } = queryOf(signed.path);

    expect(
      verifyMediaFileSignature(STORAGE_KEY, sign, 'not-a-number', signingOptions(), NOW),
    ).toBe(false);
    expect(
      verifyMediaFileSignature(STORAGE_KEY, sign, undefined, signingOptions(), NOW),
    ).toBe(false);
  });
});

describe('parseSignedMediaUrlExpiry / parseLocalMediaStorageKey (KI-415, KI-464)', () => {
  it('достаёт срок из подписанной локальной ссылки', () => {
    const signed = buildSignedMediaPath(STORAGE_KEY, signingOptions(), NOW);

    expect(parseSignedMediaUrlExpiry(signed.path)?.getTime()).toBe(
      signed.expiresAt.getTime(),
    );
  });

  it('чужая ссылка, S3-presigned URL и ссылка без expires — null', () => {
    expect(
      parseSignedMediaUrlExpiry(
        'https://s3.test/media/run-1/a.png?X-Amz-Signature=x',
      ),
    ).toBeNull();
    expect(
      parseSignedMediaUrlExpiry(`${MEDIA_FILE_URL_PREFIX}/${STORAGE_KEY}`),
    ).toBeNull();
    expect(parseSignedMediaUrlExpiry('not a url %%%')).toBeNull();
  });

  it('разбирает ключ объекта из локального URL (fallback для старых строк)', () => {
    expect(
      parseLocalMediaStorageKey(
        `${MEDIA_FILE_URL_PREFIX}/run-1/node-a.png?expires=1&sign=x`,
      ),
    ).toBe('run-1/node-a.png');
    expect(
      parseLocalMediaStorageKey(
        'https://app.test/media/file/run-1/generated-A.docx',
      ),
    ).toBe('run-1/generated-A.docx');
    // Не наш префикс — не трогаем.
    expect(
      parseLocalMediaStorageKey('https://s3.test/media/run-1/node-a.png'),
    ).toBeNull();
    expect(parseLocalMediaStorageKey(`${MEDIA_FILE_URL_PREFIX}/`)).toBeNull();
  });
});

describe('resolveMediaSigningOptions: сборка из env (KI-415)', () => {
  /**
   * Собирает заглушку чтения env.
   *
   * @param values - карта env
   * @returns объект с `get`
   */
  function config(values: Record<string, unknown>): {
    get(key: string): unknown;
  } {
    return { get: (key: string) => values[key] };
  }

  it('берёт явный MEDIA_URL_SIGNING_SECRET и TTL', () => {
    const options = resolveMediaSigningOptions(
      config({
        MEDIA_URL_SIGNING_SECRET: SECRET,
        MEDIA_URL_TTL_SECONDS: 120,
        // JWT_SECRET не должен перебить явный секрет.
        JWT_SECRET: 'jwt-secret-for-unit-tests-0123456789',
      }),
    );

    expect(options).toEqual({ secret: SECRET, ttlSeconds: 120 });
  });

  it('без явного секрета использует JWT_SECRET, TTL — дефолтный час', () => {
    const jwtSecret = 'jwt-secret-for-unit-tests-0123456789';

    expect(resolveMediaSigningOptions(config({ JWT_SECRET: jwtSecret }))).toEqual({
      secret: jwtSecret,
      ttlSeconds: DEFAULT_MEDIA_URL_TTL_SECONDS,
    });
  });

  it('короткий секрет и пустой конфиг — подпись не настроена', () => {
    expect(
      resolveMediaSigningOptions(
        config({ MEDIA_URL_SIGNING_SECRET: 'short' }),
      ),
    ).toBeNull();
    expect(resolveMediaSigningOptions(config({}))).toBeNull();
    expect(resolveMediaSigningOptions(undefined)).toBeNull();
  });

  it('некорректный TTL подменяется дефолтом', () => {
    const options = resolveMediaSigningOptions(
      config({ MEDIA_URL_SIGNING_SECRET: SECRET, MEDIA_URL_TTL_SECONDS: 'abc' }),
    );

    expect(options?.ttlSeconds).toBe(DEFAULT_MEDIA_URL_TTL_SECONDS);
  });
});
