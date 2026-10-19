import { describe, expect, it, vi } from 'vitest';
import type { Agent } from 'undici';
import {
  SafeHttpClient,
  type SafeHttpTransportAsync,
  type SafeHttpTransportInit,
  type SafeHttpTransportResponse,
} from '../common/http/safe-http.client.js';
import { SsrfBlockedException } from '../common/utils/network-safety.js';
import type { AgentToolContext } from './agent.types.js';
import { TOOL_REGISTRY } from './agent-tools.js';

/** Публичный адрес для «разрешённых» сценариев. */
const PUBLIC_IP = '93.184.216.34';

/** Ответ транспорта из строки. */
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

/**
 * Собирает контекст только для `http_request`.
 *
 * SSRF-защита живёт в настоящем {@link SafeHttpClient} с фейковым транспортом:
 * тест проверяет именно связку «инструмент → клиент», не ходя в сеть.
 *
 * @param handler - что вернуть транспорту
 * @param lookup - резолвер DNS
 * @returns контекст, вызовы транспорта и мок DNS
 */
function createHttpContext(
  handler: (url: URL) => SafeHttpTransportResponse = () =>
    transportResponse(200, '{"ok":true}'),
  lookup: (hostname: string) => Promise<readonly string[]> = () =>
    Promise.resolve([PUBLIC_IP]),
): {
  context: AgentToolContext;
  transportAsync: ReturnType<typeof vi.fn>;
  lookupAsync: ReturnType<typeof vi.fn>;
} {
  const transportAsync = vi.fn(
    async (
      url: URL,
      _init: SafeHttpTransportInit,
      _dispatcher: Agent,
    ): Promise<SafeHttpTransportResponse> => handler(url),
  );
  const lookupAsync = vi.fn(lookup);
  const httpClient = new SafeHttpClient({
    lookupAsync,
    transportAsync: transportAsync as unknown as SafeHttpTransportAsync,
  });
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
    httpClient,
  };

  return { context, transportAsync, lookupAsync };
}

/**
 * Юнит-тесты SSRF-защиты инструмента `http_request` (KI-409/434/435/478).
 *
 * `url` приходит от модели, то есть является недоверенным вводом: запрос к
 * loopback, приватной подсети или metadata-сервису облака давал бы доступ к
 * внутренней инфраструктуре. Инструмент **всегда** блокирует приватные адреса:
 * флаг `HTTP_NODE_ALLOW_PRIVATE_NETWORKS` относится только к узлу `http`.
 */
describe('SSRF-защита http_request (KI-409/434/435/478)', () => {
  it('отвергает не-http(s) протокол до сетевого вызова', async () => {
    const { context, transportAsync } = createHttpContext();

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'ftp://example.com/file.txt' },
        context,
      ),
    ).rejects.toThrow(/http или https/);

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('не делает сетевой вызов к localhost', async () => {
    const { context, transportAsync, lookupAsync } = createHttpContext();

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'http://localhost:3000/internal' },
        context,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(transportAsync).not.toHaveBeenCalled();
    expect(lookupAsync).not.toHaveBeenCalled();
  });

  it('не делает сетевой вызов к 127.0.0.1 и [::1]', async () => {
    const { context, transportAsync } = createHttpContext();

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'http://127.0.0.1:3000' },
        context,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);
    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'http://[::1]:3000' },
        context,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('не делает сетевой вызов к 169.254.169.254', async () => {
    const { context, transportAsync } = createHttpContext();

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'http://169.254.169.254/latest/meta-data/' },
        context,
      ),
    ).rejects.toBeInstanceOf(SsrfBlockedException);

    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('блокирует домен, резолвящийся во внутреннюю сеть', async () => {
    const { context, transportAsync } = createHttpContext(
      () => transportResponse(200, 'should not happen'),
      () => Promise.resolve(['192.168.1.10']),
    );

    const error: unknown = await TOOL_REGISTRY.http_request
      .executeAsync({ url: 'https://intranet.example/secret' }, context)
      .then(
        () => null,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(SsrfBlockedException);
    expect(error).toMatchObject({ address: '192.168.1.10' });
    expect(transportAsync).not.toHaveBeenCalled();
  });

  it('KI-434: блокирует редирект на metadata-адрес', async () => {
    const { context, transportAsync } = createHttpContext(() =>
      transportResponse(302, '', {
        location: 'http://169.254.169.254/latest/meta-data/',
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
    expect(transportAsync).toHaveBeenCalledTimes(1);
  });

  it('KI-434: идёт по безопасному редиректу', async () => {
    const { context, transportAsync } = createHttpContext((url) =>
      url.pathname === '/start'
        ? transportResponse(301, '', {
            location: 'https://public.example/final',
          })
        : transportResponse(200, '{"ok":true}'),
    );

    const result = await TOOL_REGISTRY.http_request.executeAsync(
      { url: 'https://public.example/start' },
      context,
    );

    expect(result).toMatchObject({ status: 200, ok: true });
    expect(transportAsync).toHaveBeenCalledTimes(2);
  });

  it('не передаёт allowPrivateNetworks клиенту (инструмент агента закрыт всегда)', async () => {
    const { context } = createHttpContext();
    // Спай на публичном контракте клиента: инструмент не должен выставлять
    // флаг, разрешающий приватные сети (он относится только к узлу `http`).
    const fetchSpy = vi.spyOn(context.httpClient, 'fetchAsync');

    await TOOL_REGISTRY.http_request.executeAsync(
      { url: 'https://public.example/items' },
      context,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0].allowPrivateNetworks).toBeUndefined();
  });

  it('не-2xx — это данные, а не сбой инструмента', async () => {
    const { context } = createHttpContext(() =>
      transportResponse(503, 'service unavailable'),
    );

    const result = (await TOOL_REGISTRY.http_request.executeAsync(
      { url: 'https://public.example/fail' },
      context,
    )) as { status: number; ok: boolean; body: string };

    expect(result).toMatchObject({
      status: 503,
      ok: false,
      body: 'service unavailable',
    });
  });
});
