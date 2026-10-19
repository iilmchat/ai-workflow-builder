import { describe, expect, it, vi } from 'vitest';
import {
  SsrfBlockedException,
  assertPublicHttpUrlAsync,
  isBlockedIpAddress,
} from '../common/utils/network-safety.js';
import type { AgentToolContext } from './agent.types.js';
import { TOOL_REGISTRY } from './agent-tools.js';

/**
 * Публичный резолвер для тестов «разрешено»: адрес не из приватных диапазонов.
 */
function publicLookup(): Promise<readonly string[]> {
  return Promise.resolve(['93.184.216.34']);
}

/**
 * Собирает контекст только для `http_request`.
 *
 * Инструменту нужны `fetchAsync` и `dnsLookupAsync`; остальные зависимости
 * контракта объявлены моками, чтобы тест ловил случайное обращение к ним.
 *
 * @param lookupAsync - резолвер DNS, подменяющий сеть
 * @returns контекст и мок `fetch`
 */
function createHttpContext(
  lookupAsync: (hostname: string) => Promise<readonly string[]>,
  overrides: Partial<AgentToolContext> = {},
): { context: AgentToolContext; fetchAsync: ReturnType<typeof vi.fn> } {
  const fetchAsync = vi.fn(() =>
    Promise.resolve(new Response('{"ok":true}', { status: 200 })),
  );
  const context: AgentToolContext = {
    runId: 'run-1',
    nodeId: 'agent-1',
    workflowId: 'wf-1',
    model: 'claude-test',
    store: {
      insertVectorAsync: vi.fn(),
      queryVectorsAsync: vi.fn(),
      readMemoryAsync: vi.fn(),
      writeMemoryAsync: vi.fn(),
    },
    embedAsync: vi.fn(),
    llmGenerateAsync: vi.fn(),
    sandbox: { evaluateSandboxedAsync: vi.fn() },
    fetchAsync: fetchAsync as unknown as typeof fetch,
    dnsLookupAsync: lookupAsync,
    ...overrides,
  };

  return { context, fetchAsync };
}

/**
 * Юнит-тесты SSRF-защиты инструмента `http_request` (KI-409).
 *
 * `url` приходит от модели, то есть является недоверенным вводом: запрос к
 * loopback, приватной подсети или metadata-сервису облака давал бы доступ к
 * внутренней инфраструктуре. Тесты не ходят в сеть: IP-литералы проверяются
 * до DNS, а для доменов резолвер подменён моком.
 */
describe('SSRF-защита http_request (KI-409)', () => {
  it('isBlockedIpAddress: loopback, приватные, link-local и metadata', () => {
    const blocked = [
      '0.0.0.0',
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:169.254.169.254',
      // IPv6 в верхнем регистре не должен обходить проверку.
      '::FFFF:127.0.0.1',
    ];

    for (const address of blocked) {
      expect(isBlockedIpAddress(address), address).toBe(true);
    }
  });

  it('isBlockedIpAddress: публичные адреса пропускаются', () => {
    const allowed = [
      '8.8.8.8',
      '93.184.216.34',
      // Граница 172.16/12: 172.15 и 172.32 — уже публичные.
      '172.15.0.1',
      '172.32.0.1',
      '2001:4860:4860::8888',
      '2001:4860:4860::ABCD',
    ];

    for (const address of allowed) {
      expect(isBlockedIpAddress(address), address).toBe(false);
    }
  });

  it('блокирует localhost по имени, не выполняя DNS-запрос', async () => {
    const lookupAsync = vi.fn(() => publicLookup());

    await expect(
      assertPublicHttpUrlAsync('http://localhost:3000/admin', lookupAsync),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(lookupAsync).not.toHaveBeenCalled();
  });

  it('блокирует 127.0.0.1 и ::1 без DNS-запроса', async () => {
    const lookupAsync = vi.fn(() => publicLookup());

    await expect(
      assertPublicHttpUrlAsync('http://127.0.0.1:3000', lookupAsync),
    ).rejects.toBeInstanceOf(SsrfBlockedException);
    await expect(
      assertPublicHttpUrlAsync('http://[::1]:3000', lookupAsync),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(lookupAsync).not.toHaveBeenCalled();
  });

  it('блокирует AWS metadata 169.254.169.254', async () => {
    const lookupAsync = vi.fn(() => publicLookup());

    await expect(
      assertPublicHttpUrlAsync(
        'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        lookupAsync,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

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
    expect(lookupAsync).toHaveBeenCalledWith('internal.example');
  });

  it('пропускает домен с публичным адресом', async () => {
    const lookupAsync = vi.fn(() => publicLookup());

    await expect(
      assertPublicHttpUrlAsync('https://api.example.com/items', lookupAsync),
    ).resolves.toBeUndefined();
    expect(lookupAsync).toHaveBeenCalledWith('api.example.com');
  });

  it('нерезолвящееся имя не блокируется: fetch сам вернёт сетевую ошибку', async () => {
    const lookupAsync = vi.fn(() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND api.test')),
    );

    await expect(
      assertPublicHttpUrlAsync('https://api.test/items', lookupAsync),
    ).resolves.toBeUndefined();
  });

  it('http_request отвергает не-http(s) протокол до сетевого вызова', async () => {
    const { context, fetchAsync } = createHttpContext(publicLookup);

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'ftp://example.com/file.txt' },
        context,
      ),
    ).rejects.toThrow(/http или https/);

    expect(fetchAsync).not.toHaveBeenCalled();
  });

  it('http_request не делает сетевой вызов к localhost', async () => {
    const { context, fetchAsync } = createHttpContext(publicLookup);

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'http://localhost:3000/internal' },
        context,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(fetchAsync).not.toHaveBeenCalled();
  });

  it('http_request не делает сетевой вызов к 169.254.169.254', async () => {
    const { context, fetchAsync } = createHttpContext(publicLookup);

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'http://169.254.169.254/latest/meta-data/' },
        context,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(fetchAsync).not.toHaveBeenCalled();
  });

  it('http_request блокирует домен, резолвящийся во внутреннюю сеть', async () => {
    const { context, fetchAsync } = createHttpContext(() =>
      Promise.resolve(['192.168.1.10']),
    );

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'https://intranet.example/secret' },
        context,
      ),
    ).rejects.toMatchObject({
      name: 'SsrfBlockedException',
      address: '192.168.1.10',
    });

    expect(fetchAsync).not.toHaveBeenCalled();
  });

  it('KI-434: http_request блокирует редирект на metadata-адрес (redirect: manual)', async () => {
    const { context, fetchAsync } = createHttpContext(publicLookup);

    fetchAsync.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );

    const error: unknown = await TOOL_REGISTRY.http_request
      .executeAsync({ url: 'https://public.example/go' }, context)
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(SsrfBlockedException);
    expect(error).toMatchObject({
      hostname: '169.254.169.254',
      redirectFrom: 'https://public.example/go',
    });

    // Второго запроса не было: приватный Location не запрашивался.
    expect(fetchAsync).toHaveBeenCalledTimes(1);

    const [, init] = fetchAsync.mock.calls[0] as [string, RequestInit];

    // KI-434: без manual fetch пошёл бы по 3xx сам, минуя проверку.
    expect(init.redirect).toBe('manual');
  });

  it('KI-434: http_request идёт по безопасному редиректу', async () => {
    const { context, fetchAsync } = createHttpContext(publicLookup);

    fetchAsync
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: 'https://public.example/final' },
        }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));

    const result = await TOOL_REGISTRY.http_request.executeAsync(
      { url: 'https://public.example/start' },
      context,
    );

    expect(result).toMatchObject({ status: 200, ok: true });
    expect(fetchAsync).toHaveBeenCalledTimes(2);
    expect(fetchAsync.mock.calls[1]?.[0]).toBe('https://public.example/final');
  });

  it('ALLOW_PRIVATE_IPS=true: http_request пропускает приватный хост', async () => {
    const { context, fetchAsync } = createHttpContext(publicLookup, {
      allowPrivateIps: true,
    });

    const result = await TOOL_REGISTRY.http_request.executeAsync(
      { url: 'http://127.0.0.1:1234/v1/models' },
      context,
    );

    expect(result).toMatchObject({ status: 200, ok: true });
    expect(fetchAsync).toHaveBeenCalledTimes(1);
  });
});
