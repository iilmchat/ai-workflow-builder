/**
 * Таблица атак и юнит-тесты `SafeHttpClient` (v0.11 S14, DESIGN § 3.5.1).
 *
 * Тесты не ходят в сеть: транспорт одного хопа подменён фейком, резолвер DNS —
 * моком. Проверяется именно логика защиты: денлист имён/адресов, **один**
 * DNS-резолв, pinning IP (rebinding), ручная обработка каждого `Location`,
 * лимит хопов, лимит тела и объединение таймаута с сигналом вызова.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from 'undici';
import {
  HTTP_MAX_REDIRECTS,
  SsrfBlockedException,
  TooManyRedirectsException,
} from '../utils/network-safety.js';
import {
  SAFE_HTTP_MAX_RESPONSE_BYTES,
  SafeHttpClient,
  SafeHttpDnsException,
  SafeHttpResponseTooLargeException,
  createPinnedLookup,
  type SafeHttpTransportAsync,
  type SafeHttpTransportInit,
  type SafeHttpTransportResponse,
} from './safe-http.client.js';

/** Публичный адрес для «разрешённых» сценариев. */
const PUBLIC_IP = '93.184.216.34';

/** Резолвер, который отдаёт публичный адрес. */
function publicLookup(): Promise<readonly string[]> {
  return Promise.resolve([PUBLIC_IP]);
}

/**
 * Собирает ответ транспорта из строки.
 *
 * @param status - HTTP-код
 * @param body - текст тела
 * @param headers - заголовки (например `location`)
 * @returns ответ транспорта
 */
function transportResponse(
  status: number,
  body = '',
  headers: Record<string, string> = {},
): SafeHttpTransportResponse {
  const bytes = Buffer.from(body, 'utf8');

  return {
    status,
    headers: new Headers(headers),
    body: (async function* stream(): AsyncGenerator<Uint8Array> {
      if (bytes.length > 0) {
        yield bytes;
      }
    })(),
    discardAsync: (): Promise<void> => Promise.resolve(),
  };
}

/** Вызов транспорта, сохранённый для проверок. */
interface TransportCall {
  readonly url: URL;
  readonly init: SafeHttpTransportInit;
  readonly dispatcher: Agent;
}

/**
 * Создаёт клиент с фейковым транспортом и моком DNS.
 *
 * @param handler - что вернуть на n-й хоп
 * @param lookup - резолвер DNS (по умолчанию публичный)
 * @returns клиент, вызовы транспорта и моки
 */
function createClient(
  handler: (call: TransportCall) => SafeHttpTransportResponse,
  lookup: (hostname: string) => Promise<readonly string[]> = publicLookup,
): {
  client: SafeHttpClient;
  calls: TransportCall[];
  transportAsync: ReturnType<typeof vi.fn>;
  lookupAsync: ReturnType<typeof vi.fn>;
} {
  const calls: TransportCall[] = [];
  const transportAsync = vi.fn(
    async (
      url: URL,
      init: SafeHttpTransportInit,
      dispatcher: Agent,
    ): Promise<SafeHttpTransportResponse> => {
      const call: TransportCall = { url, init, dispatcher };

      calls.push(call);

      return handler(call);
    },
  );
  const lookupAsync = vi.fn(lookup);
  const client = new SafeHttpClient({
    lookupAsync,
    transportAsync: transportAsync as unknown as SafeHttpTransportAsync,
  });

  return { client, calls, transportAsync, lookupAsync };
}

/** Базовый запрос к клиенту. */
function request(overrides: Partial<Parameters<SafeHttpClient['fetchAsync']>[0]> = {}) {
  return {
    url: 'https://public.example/resource',
    method: 'GET' as const,
    timeoutMs: 1_000,
    ...overrides,
  };
}

describe('SafeHttpClient — таблица атак DESIGN § 3.5.1', () => {
  const attackInputs = [
    'http://127.0.0.1',
    'http://[::1]',
    'http://169.254.169.254/latest/meta-data',
    'http://2130706433',
    'http://0x7f.1',
    'http://localhost.',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://instance-data/latest/meta-data/',
  ];

  for (const input of attackInputs) {
    it(`блокирует ${input} до сетевого вызова`, async () => {
      const { client, transportAsync, lookupAsync } = createClient(() =>
        transportResponse(200, 'should not happen'),
      );

      await expect(client.fetchAsync(request({ url: input }))).rejects.toBeInstanceOf(
        SsrfBlockedException,
      );

      expect(transportAsync).not.toHaveBeenCalled();
      // IP-литералы и денлистные имена не требуют DNS.
      expect(lookupAsync).not.toHaveBeenCalled();
    });
  }

  it('блокирует ftp:// и file:// (только http/https)', async () => {
    const { client, transportAsync } = createClient(() =>
      transportResponse(200, 'should not happen'),
    );

    await expect(
      client.fetchAsync(request({ url: 'ftp://public.example/file.txt' })),
    ).rejects.toThrow(/http или https/);
    await expect(
      client.fetchAsync(request({ url: 'file:///etc/passwd' })),
    ).rejects.toThrow(/http или https/);

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('запрещает URL с учётными данными user:pass@', async () => {
    const { client, transportAsync } = createClient(() =>
      transportResponse(200, 'should not happen'),
    );

    await expect(
      client.fetchAsync(
        request({ url: 'https://user:secret@public.example/resource' }),
      ),
    ).rejects.toThrow(/учётными данными/);

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('блокирует домен, который резолвится в приватный адрес (любой из ответов)', async () => {
    const { client, transportAsync } = createClient(
      () => transportResponse(200, 'should not happen'),
      () => Promise.resolve([PUBLIC_IP, '10.0.0.5']),
    );

    await expect(
      client.fetchAsync(request({ url: 'https://internal.example/api' })),
    ).rejects.toMatchObject({
      name: 'SsrfBlockedException',
      hostname: 'internal.example',
      address: '10.0.0.5',
    });

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('DNS-ошибка — fail closed (SafeHttpDnsException), запроса нет', async () => {
    const { client, transportAsync } = createClient(
      () => transportResponse(200, 'should not happen'),
      () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.test')),
    );

    await expect(
      client.fetchAsync(request({ url: 'https://api.test/items' })),
    ).rejects.toBeInstanceOf(SafeHttpDnsException);

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('редирект на приватный адрес блокируется на втором хопе', async () => {
    const { client, transportAsync, lookupAsync } = createClient((call) =>
      call.url.hostname === 'public.example'
        ? transportResponse(302, '', { location: 'http://10.0.0.5/internal' })
        : transportResponse(200, 'should not happen'),
    );

    const error: unknown = await client
      .fetchAsync(request({ url: 'https://public.example/go' }))
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(SsrfBlockedException);
    expect(error).toMatchObject({
      hostname: '10.0.0.5',
      redirectFrom: 'https://public.example/go',
    });

    // Первый хоп — только публичный хост; приватный Location не запрашивался.
    expect(transportAsync).toHaveBeenCalledTimes(1);
    expect(lookupAsync).toHaveBeenCalledTimes(1);
    expect(lookupAsync).toHaveBeenCalledWith('public.example');
  });

  it('идёт по безопасному редиректу и возвращает финальный ответ', async () => {
    const { client, transportAsync } = createClient((call) =>
      call.url.pathname === '/start'
        ? transportResponse(301, '', {
            location: 'https://public.example/final',
          })
        : transportResponse(200, '{"ok":true}'),
    );

    const response = await client.fetchAsync(
      request({ url: 'https://public.example/start' }),
    );

    expect(response).toMatchObject({
      status: 200,
      ok: true,
      body: '{"ok":true}',
      finalUrl: 'https://public.example/final',
    });
    expect(transportAsync).toHaveBeenCalledTimes(2);
  });

  it('6 редиректов — TooManyRedirectsException (лимит 5)', async () => {
    const { client, transportAsync } = createClient(() =>
      transportResponse(307, '', {
        location: 'https://public.example/loop',
      }),
    );

    await expect(
      client.fetchAsync(request({ url: 'https://public.example/loop' })),
    ).rejects.toBeInstanceOf(TooManyRedirectsException);

    expect(transportAsync).toHaveBeenCalledTimes(HTTP_MAX_REDIRECTS + 1);
  });

  it('3xx без Location возвращается как финальный ответ', async () => {
    const { client, transportAsync } = createClient(() =>
      transportResponse(302),
    );

    const response = await client.fetchAsync(
      request({ url: 'https://public.example/no-location' }),
    );

    expect(response.status).toBe(302);
    expect(transportAsync).toHaveBeenCalledTimes(1);
  });

  it('тело больше лимита — ResponseTooLarge, а не «обрезанное»', async () => {
    const tenMegabytes = Buffer.alloc(10_000_000, 0x61);

    const { client } = createClient(() => ({
      status: 200,
      headers: new Headers(),
      body: (async function* stream(): AsyncGenerator<Uint8Array> {
        yield tenMegabytes;
      })(),
      discardAsync: (): Promise<void> => Promise.resolve(),
    }));

    await expect(
      client.fetchAsync(request({ url: 'https://public.example/big' })),
    ).rejects.toBeInstanceOf(SafeHttpResponseTooLargeException);
  });

  it('тело ровно по лимиту пропускается', async () => {
    const exactlyLimit = 'a'.repeat(SAFE_HTTP_MAX_RESPONSE_BYTES);
    const { client } = createClient(() => transportResponse(200, exactlyLimit));

    const response = await client.fetchAsync(
      request({ url: 'https://public.example/exact' }),
    );

    expect(Buffer.byteLength(response.body, 'utf8')).toBe(
      SAFE_HTTP_MAX_RESPONSE_BYTES,
    );
  });

  it('кастомный maxResponseBytes соблюдается', async () => {
    const { client } = createClient(() => transportResponse(200, 'abcd'));

    await expect(
      client.fetchAsync(
        request({ url: 'https://public.example/small-limit', maxResponseBytes: 3 }),
      ),
    ).rejects.toBeInstanceOf(SafeHttpResponseTooLargeException);

    const response = await client.fetchAsync(
      request({ url: 'https://public.example/small-limit', maxResponseBytes: 4 }),
    );

    expect(response.body).toBe('abcd');
  });
});

describe('SafeHttpClient — pinning и DNS rebinding (KI-435)', () => {
  it('резолвит DNS ровно один раз на хоп и не даёт rebinding', async () => {
    // Первый и «второй» резолв отдают разное: если бы клиент резолвил повторно
    // (внутри соединения), он увидел бы приватный адрес. Pinning исключает
    // второй резолв: lookup вызван ровно один раз, а pinned lookup всегда
    // возвращает проверенный публичный IP.
    let resolutions = 0;
    const lookupAsync = vi.fn(() => {
      resolutions += 1;

      return Promise.resolve(
        resolutions === 1 ? [PUBLIC_IP] : ['10.0.0.5'],
      );
    });
    const transportAsync = vi.fn(
      async (
        _url: URL,
        _init: SafeHttpTransportInit,
        dispatcher: Agent,
      ): Promise<SafeHttpTransportResponse> => {
        // Транспорт изображает undici: соединение спрашивает lookup у Agent,
        // и второй DNS-резолв не должен произойти.
        const pinned = createPinnedLookup('public.example', PUBLIC_IP, 4);
        const callback = vi.fn();

        pinned('public.example', { all: true }, callback);

        expect(callback).toHaveBeenCalledWith(
          null,
          [{ address: PUBLIC_IP, family: 4 }],
          4,
        );
        expect(dispatcher).toBeInstanceOf(Object);

        return transportResponse(200, 'ok');
      },
    );
    const client = new SafeHttpClient({
      lookupAsync,
      transportAsync: transportAsync as unknown as SafeHttpTransportAsync,
    });

    const response = await client.fetchAsync(
      request({ url: 'https://public.example/resource' }),
    );

    expect(response.body).toBe('ok');
    expect(lookupAsync).toHaveBeenCalledTimes(1);
    expect(resolutions).toBe(1);
  });

  it('createPinnedLookup: одиночный адрес и режим all:true', () => {
    const lookup = createPinnedLookup('public.example', PUBLIC_IP, 4);
    const single = vi.fn();
    const all = vi.fn();

    lookup('public.example', {}, single);
    lookup('public.example', { all: true }, all);

    expect(single).toHaveBeenCalledWith(null, PUBLIC_IP, 4);
    expect(all).toHaveBeenCalledWith(
      null,
      [{ address: PUBLIC_IP, family: 4 }],
      4,
    );
  });

  it('createPinnedLookup: неожиданный hostname — ошибка соединения', () => {
    const lookup = createPinnedLookup('public.example', PUBLIC_IP, 4);
    const callback = vi.fn();

    lookup('evil.example', {}, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const [error] = callback.mock.calls[0] as [Error];

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('неожиданный hostname');
  });
});

describe('SafeHttpClient — запрос, редиректы и таймаут', () => {
  it('передаёт метод, заголовки и тело; отдаёт status/ok/headers/finalUrl', async () => {
    const { client, calls } = createClient(() =>
      transportResponse(201, 'created', { 'x-trace': 'abc' }),
    );

    const response = await client.fetchAsync(
      request({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}',
      }),
    );

    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(response).toMatchObject({
      status: 201,
      ok: true,
      body: 'created',
      finalUrl: 'https://public.example/resource',
    });
    expect(response.headers.get('x-trace')).toBe('abc');
  });

  it('303 с POST превращается в GET без тела', async () => {
    const { client, calls } = createClient((call) =>
      call.init.method === 'POST'
        ? transportResponse(303, '', {
            location: 'https://public.example/result',
          })
        : transportResponse(200, 'ok'),
    );

    await client.fetchAsync(
      request({ method: 'POST', body: '{"a":1}' }),
    );

    expect(calls[1]?.init.method).toBe('GET');
    expect(calls[1]?.init.body).toBeUndefined();
  });

  it('307 сохраняет метод и тело', async () => {
    const { client, calls } = createClient((call) =>
      call.url.pathname === '/resource'
        ? transportResponse(307, '', {
            location: 'https://public.example/retry',
          })
        : transportResponse(200, 'ok'),
    );

    await client.fetchAsync(
      request({ method: 'PUT', body: '{"a":1}' }),
    );

    expect(calls[1]?.init.method).toBe('PUT');
    expect(calls[1]?.init.body).toBe('{"a":1}');
  });

  it('таймаут объединяется с сигналом вызова (AbortSignal.any)', async () => {
    const neverResponds = vi.fn(
      (_url: URL, init: SafeHttpTransportInit): Promise<SafeHttpTransportResponse> =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('timeout', 'TimeoutError'));
          });
        }),
    );
    const client = new SafeHttpClient({
      lookupAsync: publicLookup,
      transportAsync: neverResponds as unknown as SafeHttpTransportAsync,
    });

    await expect(
      client.fetchAsync(
        request({ url: 'https://public.example/slow', timeoutMs: 20 }),
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('сигнал вызывающего кода прерывает запрос', async () => {
    const controller = new AbortController();
    const neverResponds = vi.fn(
      (_url: URL, init: SafeHttpTransportInit): Promise<SafeHttpTransportResponse> =>
        new Promise((_resolve, reject) => {
          // Сигнал мог быть отменён до вызова транспорта (AbortSignal.any
          // пробрасывает уже отменённый signal): проверяем и это.
          if (init.signal.aborted) {
            reject(new DOMException('aborted', 'AbortError'));

            return;
          }

          init.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new SafeHttpClient({
      lookupAsync: publicLookup,
      transportAsync: neverResponds as unknown as SafeHttpTransportAsync,
    });
    const pending = client.fetchAsync(
      request({ url: 'https://public.example/slow', signal: controller.signal }),
    );

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('allowPrivateNetworks=true разрешает приватные адреса, но не metadata', async () => {
    const { client, transportAsync } = createClient(() =>
      transportResponse(200, 'internal ok'),
    );

    const response = await client.fetchAsync(
      request({
        url: 'http://127.0.0.1:1234/v1/models',
        allowPrivateNetworks: true,
      }),
    );

    expect(response.body).toBe('internal ok');
    expect(transportAsync).toHaveBeenCalledTimes(1);

    // Metadata-алиасы — всегда в блоке, даже для доверенной инсталляции.
    await expect(
      client.fetchAsync(
        request({
          url: 'http://169.254.169.254/latest/meta-data',
          allowPrivateNetworks: true,
        }),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);
    await expect(
      client.fetchAsync(
        request({
          url: 'http://metadata.google.internal/computeMetadata/v1/',
          allowPrivateNetworks: true,
        }),
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);
  });

  it('без allowPrivateNetworks приватный хост блокируется', async () => {
    const { client, transportAsync } = createClient(() =>
      transportResponse(200, 'should not happen'),
    );

    await expect(
      client.fetchAsync(request({ url: 'http://127.0.0.1:1234/v1/models' })),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(transportAsync).not.toHaveBeenCalled();
  });
});
