/**
 * Юнит-тесты SSRF-защиты (KI-409/434/435/478).
 *
 * Тесты не ходят в сеть: IP-литералы проверяются до DNS, а резолвер для доменов
 * подменяется моком. `fetch` тоже подменяется — проверяется не сеть, а то, что
 * guard блокирует небезопасный адрес **до** вызова клиента и заново проверяет
 * каждый `Location`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  HTTP_MAX_REDIRECTS,
  SsrfBlockedException,
  TooManyRedirectsException,
  assertPublicHttpUrlAsync,
  fetchWithSsrfGuardAsync,
  isBlockedIpAddress,
  isPrivateIp,
} from './network-safety.js';

/** Публичный резолвер: домен указывает на публичный адрес. */
function publicLookup(): Promise<readonly string[]> {
  return Promise.resolve(['93.184.216.34']);
}

/**
 * Собирает ответ с заданным кодом и заголовками.
 *
 * @param status - HTTP-код
 * @param headers - заголовки ответа
 * @param body - текст тела (по умолчанию пусто)
 * @returns объект в форме, достаточной для guard
 */
function response(
  status: number,
  headers: Record<string, string> = {},
  body = '',
): Response {
  return {
    status,
    headers: new Headers(headers),
    text: (): Promise<string> => Promise.resolve(body),
  } as unknown as Response;
}

describe('isPrivateIp (v0.10.2, ТЗ: приватные диапазоны)', () => {
  it('IPv4: 10/8, 172.16/12, 192.168/16, 127/8 и 169.254/16 — приватные', () => {
    const privateAddresses = [
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.20.10.10',
      '172.31.255.255',
      '192.168.0.1',
      '192.168.255.254',
      '127.0.0.1',
      '127.1.2.3',
      '169.254.0.1',
      // AWS/GCP metadata — тот самый адрес из KI-409/KI-478.
      '169.254.169.254',
    ];

    for (const address of privateAddresses) {
      expect(isPrivateIp(address), address).toBe(true);
    }
  });

  it('IPv4: публичные адреса и границы диапазонов — не приватные', () => {
    const publicAddresses = [
      '8.8.8.8',
      '93.184.216.34',
      '1.1.1.1',
      // Границы 172.16/12: 172.15 и 172.32 уже публичные.
      '172.15.0.1',
      '172.32.0.1',
      '169.253.0.1',
      '11.0.0.1',
    ];

    for (const address of publicAddresses) {
      expect(isPrivateIp(address), address).toBe(false);
    }
  });

  it('IPv6: ::1 и fc00::/7 — приватные, глобальные — нет', () => {
    const privateAddresses = ['::1', 'fc00::1', 'fd12:3456::1', 'FC00::1'];
    const publicAddresses = [
      '2001:4860:4860::8888',
      '2001:4860:4860::ABCD',
      '2001:db8::1',
    ];

    for (const address of privateAddresses) {
      expect(isPrivateIp(address), address).toBe(true);
    }

    for (const address of publicAddresses) {
      expect(isPrivateIp(address), address).toBe(false);
    }
  });

  it('IPv4-mapped: приватный IPv4 внутри IPv6 не обходит проверку', () => {
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('isPrivateIp не считает link-local IPv6 «приватным», но денлист это ловит', () => {
    // Разделение контрактов: isPrivateIp — ровно диапазоны из ТЗ, а
    // isBlockedIpAddress — полный SSRF-денлист (включая fe80::/10).
    expect(isPrivateIp('fe80::1')).toBe(false);
    expect(isBlockedIpAddress('fe80::1')).toBe(true);
  });

  it('не-IP строки не считаются ни приватными, ни заблокированными', () => {
    for (const value of ['', 'example.com', '999.1.1.1', '::gg']) {
      expect(isPrivateIp(value), value).toBe(false);
      expect(isBlockedIpAddress(value), value).toBe(false);
    }
  });
});

describe('isBlockedIpAddress (SSRF-денлист строже private)', () => {
  it('блокирует служебные, multicast и документационные диапазоны', () => {
    const blocked = [
      '0.0.0.0',
      '0.1.2.3',
      '100.64.0.1',
      '192.0.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:10.0.0.1',
    ];

    for (const address of blocked) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it('пропускает публичные адреса', () => {
    for (const address of ['8.8.8.8', '93.184.216.34', '2001:4860::8888']) {
      expect(isBlockedIpAddress(address), address).toBe(false);
    }
  });
});

describe('assertPublicHttpUrlAsync', () => {
  it('блокирует localhost по имени, не выполняя DNS-запрос', async () => {
    const lookupAsync = vi.fn(publicLookup);

    await expect(
      assertPublicHttpUrlAsync('http://localhost:3000/admin', lookupAsync),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(lookupAsync).not.toHaveBeenCalled();
  });

  it('блокирует literal приватного IP без DNS-запроса', async () => {
    const lookupAsync = vi.fn(publicLookup);

    await expect(
      assertPublicHttpUrlAsync('http://127.0.0.1:3000', lookupAsync),
    ).rejects.toMatchObject({
      name: 'SsrfBlockedException',
      hostname: '127.0.0.1',
      address: '127.0.0.1',
    });

    expect(lookupAsync).not.toHaveBeenCalled();
  });

  it('блокирует домен, который резолвится в приватный адрес', async () => {
    const lookupAsync = vi.fn(() =>
      Promise.resolve(['93.184.216.34', '10.0.0.5']),
    );

    await expect(
      assertPublicHttpUrlAsync('https://internal.example/api', lookupAsync),
    ).rejects.toMatchObject({
      name: 'SsrfBlockedException',
      hostname: 'internal.example',
      address: '10.0.0.5',
    });
  });

  it('пропускает публичный домен и нерезолвящееся имя', async () => {
    await expect(
      assertPublicHttpUrlAsync('https://api.example.com/items', vi.fn(publicLookup)),
    ).resolves.toBeUndefined();

    // Сбой DNS не блокирует: запрос всё равно не дойдёт до приватного адреса,
    // а fetch вернёт понятную сетевую ошибку.
    await expect(
      assertPublicHttpUrlAsync(
        'https://api.test/items',
        vi.fn(() => Promise.reject(new Error('ENOTFOUND'))),
      ),
    ).resolves.toBeUndefined();
  });

  it('ALLOW_PRIVATE_IPS: пропускает приватный адрес, но требует http(s)', async () => {
    await expect(
      assertPublicHttpUrlAsync(
        'http://127.0.0.1:1234/v1',
        vi.fn(),
        { allowPrivateIps: true },
      ),
    ).resolves.toBeUndefined();

    await expect(
      assertPublicHttpUrlAsync(
        'ftp://example.com/file',
        vi.fn(publicLookup),
      ),
    ).rejects.toThrow(/http или https/);
  });
});

describe('fetchWithSsrfGuardAsync (KI-434/478: manual redirects)', () => {
  it('передаёт redirect: manual и не идёт по 3xx сам', async () => {
    const fetchAsync = vi.fn(() =>
      Promise.resolve(
        response(302, { location: 'http://169.254.169.254/latest/meta-data/' }),
      ),
    );

    await expect(
      fetchWithSsrfGuardAsync(
        fetchAsync as unknown as typeof fetch,
        'https://public.example/redirect',
        {},
        { lookupAsync: publicLookup },
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    // Ровно один запрос: приватный Location не запрашивался.
    expect(fetchAsync).toHaveBeenCalledTimes(1);

    // `vi.fn()` без типов даёт `calls[0]` типа `[]` — приводим через `unknown`.
    const [, init] = fetchAsync.mock.calls[0] as unknown as [string, RequestInit];

    expect(init.redirect).toBe('manual');
  });

  it('блокирует редирект на приватный адрес и указывает источник перехода', async () => {
    const fetchAsync = vi.fn(() =>
      Promise.resolve(response(302, { location: 'http://10.0.0.5/admin' })),
    );

    const error: unknown = await fetchWithSsrfGuardAsync(
      fetchAsync as unknown as typeof fetch,
      'https://public.example/go',
      {},
      { lookupAsync: publicLookup },
    ).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(SsrfBlockedException);
    expect(error).toMatchObject({
      hostname: '10.0.0.5',
      redirectFrom: 'https://public.example/go',
    });
  });

  it('идёт по безопасному редиректу и возвращает финальный ответ', async () => {
    const fetchAsync = vi
      .fn()
      .mockResolvedValueOnce(
        response(301, { location: 'https://public.example/final' }),
      )
      .mockResolvedValueOnce(response(200, {}, 'ok'));

    const result = await fetchWithSsrfGuardAsync(
      fetchAsync as unknown as typeof fetch,
      'https://public.example/start',
      { method: 'GET' },
      { lookupAsync: publicLookup },
    );

    expect(result.status).toBe(200);
    expect(fetchAsync).toHaveBeenCalledTimes(2);
    expect(fetchAsync.mock.calls[1]?.[0]).toBe('https://public.example/final');
  });

  it('превышение лимита редиректов — TooManyRedirectsException', async () => {
    const fetchAsync = vi.fn((url: string) =>
      Promise.resolve(
        response(307, {
          location: url.endsWith('/loop') ? '/loop' : 'https://public.example/loop',
        }),
      ),
    );

    await expect(
      fetchWithSsrfGuardAsync(
        fetchAsync as unknown as typeof fetch,
        'https://public.example/loop',
        {},
        { lookupAsync: publicLookup },
      ),
    ).rejects.toBeInstanceOf(TooManyRedirectsException);

    expect(fetchAsync).toHaveBeenCalledTimes(HTTP_MAX_REDIRECTS + 1);
  });

  it('3xx без Location возвращается как финальный ответ', async () => {
    const fetchAsync = vi.fn(() => Promise.resolve(response(302)));

    const result = await fetchWithSsrfGuardAsync(
      fetchAsync as unknown as typeof fetch,
      'https://public.example/no-location',
      {},
      { lookupAsync: publicLookup },
    );

    expect(result.status).toBe(302);
    expect(fetchAsync).toHaveBeenCalledTimes(1);
  });

  it('ALLOW_PRIVATE_IPS=true пропускает приватный редирект', async () => {
    const fetchAsync = vi
      .fn()
      .mockResolvedValueOnce(
        response(302, { location: 'http://10.0.0.5/internal' }),
      )
      .mockResolvedValueOnce(response(200, {}, 'ok'));

    const result = await fetchWithSsrfGuardAsync(
      fetchAsync as unknown as typeof fetch,
      'https://public.example/start',
      {},
      { lookupAsync: publicLookup, allowPrivateIps: true },
    );

    expect(result.status).toBe(200);
    expect(fetchAsync).toHaveBeenCalledTimes(2);
  });
});
