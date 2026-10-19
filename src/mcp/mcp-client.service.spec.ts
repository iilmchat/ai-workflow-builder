import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClientService } from './mcp-client.service.js';
import {
  McpConfigurationException,
  McpDisabledException,
  McpToolCallException,
  McpUnavailableException,
} from './mcp.errors.js';
import { McpServerRegistry } from './mcp-server.registry.js';

/** Ответ `tools/list`, который отдаёт фейковый клиент. */
interface ListToolsPage {
  tools: unknown[];
  nextCursor?: string;
}

/**
 * Подмена SDK-модулей MCP (v0.11 S6, DESIGN § 3.2.9).
 *
 * Клиент тестируется без сети и без реального MCP-сервера: `Client` и оба
 * транспорта заменяются управляемыми фейками. Это позволяет проверить то, что
 * принадлежит нашему коду: connect-mutex, пагинацию каталога, TTL-кэш,
 * инвалидацию по `list_changed`, переподключение после `onclose` и
 * таймауты, переданные в SDK.
 *
 * Поведение по умолчанию задаётся **статическими** полями: конструктор
 * сервиса создаёт клиент внутри `listToolsAsync`, поэтому настроить конкретный
 * инстанс до вызова нельзя.
 */
const sdk = vi.hoisted(() => {
  /** Управляемый фейк транспорта: тест дёргает `onclose`/`onerror` вручную. */
  class FakeTransport {
    static instances: FakeTransport[] = [];

    readonly url: URL;
    readonly options: Record<string, unknown> | undefined;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
    closeCalls = 0;

    constructor(url: URL, options?: Record<string, unknown>) {
      this.url = url;
      this.options = options;
      FakeTransport.instances.push(this);
    }

    async start(): Promise<void> {}

    async close(): Promise<void> {
      this.closeCalls += 1;
    }

    async send(): Promise<void> {}
  }

  /** Управляемый фейк MCP-клиента. */
  class FakeClient {
    static instances: FakeClient[] = [];
    static defaultConnectError: Error | null = null;
    static defaultListToolsHandler: (params?: {
      cursor?: string;
    }) => Promise<ListToolsPage> = async () => ({ tools: [] });
    static defaultCallToolHandler: (params: {
      name: string;
      arguments?: Record<string, unknown>;
    }) => Promise<unknown> = async () => ({
      content: [{ type: 'text', text: 'ok' }],
    });

    readonly options:
      | {
          listChanged?: {
            tools?: {
              onChanged?: (
                error: Error | null,
                items: unknown[] | null,
              ) => void;
            };
          };
        }
      | undefined;
    connectCalls = 0;
    closeCalls = 0;
    connectError: Error | null = FakeClient.defaultConnectError;
    connectOptions: { timeout?: number } | undefined;
    transport: FakeTransport | null = null;
    listToolsCalls: Array<{ params?: { cursor?: string }; timeout?: number }> =
      [];
    callToolCalls: Array<{
      params: { name: string; arguments?: Record<string, unknown> };
      timeout?: number;
    }> = [];
    listToolsHandler = FakeClient.defaultListToolsHandler;
    callToolHandler = FakeClient.defaultCallToolHandler;

    constructor(
      _info: unknown,
      options?: {
        listChanged?: {
          tools?: {
            onChanged?: (error: Error | null, items: unknown[] | null) => void;
          };
        };
      },
    ) {
      this.options = options;
      FakeClient.instances.push(this);
    }

    async connect(
      transport: FakeTransport,
      options?: { timeout?: number },
    ): Promise<void> {
      this.connectCalls += 1;
      this.transport = transport;
      this.connectOptions = options;

      if (this.connectError !== null) {
        throw this.connectError;
      }
    }

    async listTools(
      params?: { cursor?: string },
      options?: { timeout?: number },
    ): Promise<ListToolsPage> {
      this.listToolsCalls.push({ params, timeout: options?.timeout });

      return this.listToolsHandler(params);
    }

    async callTool(
      params: { name: string; arguments?: Record<string, unknown> },
      _schema?: unknown,
      options?: { timeout?: number },
    ): Promise<unknown> {
      this.callToolCalls.push({ params, timeout: options?.timeout });

      return this.callToolHandler(params);
    }

    async close(): Promise<void> {
      this.closeCalls += 1;
    }
  }

  return { FakeClient, FakeTransport };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: sdk.FakeClient,
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: sdk.FakeTransport,
}));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: sdk.FakeTransport,
}));

/** Базовый реестр из трёх серверов: http, sse и выключенный. */
const BASE_CONFIG: Record<string, unknown> = {
  MCP_ENABLED: true,
  MCP_SERVERS: JSON.stringify({
    filesystem: {
      transport: 'http',
      url: 'http://mcp-filesystem:3010/mcp',
    },
    legacy: {
      transport: 'sse',
      url: 'http://mcp-legacy:3011/sse',
    },
    disabled: {
      transport: 'http',
      url: 'http://mcp-disabled:3012/mcp',
      enabled: false,
    },
  }),
  MCP_CONNECT_TIMEOUT_MS: 10_000,
  MCP_REQUEST_TIMEOUT_MS: 30_000,
  MCP_CATALOG_TTL_MS: 60_000,
  MCP_MAX_TOOLS_PER_SERVER: 200,
};

/**
 * Собирает клиент и реестр через Nest-DI (RULES 4.13).
 *
 * @param overrides - точечные замены env-значений
 * @returns клиент, реестр и управляемое «текущее время»
 */
async function createHarness(overrides: Record<string, unknown> = {}): Promise<{
  service: McpClientService;
  registry: McpServerRegistry;
  now: { value: number };
}> {
  const values = { ...BASE_CONFIG, ...overrides };
  const moduleRef = await Test.createTestingModule({
    providers: [
      McpServerRegistry,
      McpClientService,
      {
        provide: ConfigService,
        useValue: {
          get: <T>(key: string): T | undefined => values[key] as T | undefined,
        },
      },
    ],
  }).compile();

  const now = { value: 1_000_000 };

  vi.spyOn(Date, 'now').mockImplementation(() => now.value);

  return {
    service: moduleRef.get(McpClientService),
    registry: moduleRef.get(McpServerRegistry),
    now,
  };
}

beforeEach(() => {
  sdk.FakeClient.instances.length = 0;
  sdk.FakeTransport.instances.length = 0;
  sdk.FakeClient.defaultConnectError = null;
  sdk.FakeClient.defaultListToolsHandler = async () => ({ tools: [] });
  sdk.FakeClient.defaultCallToolHandler = async () => ({
    content: [{ type: 'text', text: 'ok' }],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('McpClientService — подключение и каталог (v0.11 S6)', () => {
  it('подключается по HTTP, отдаёт каталог и передаёт таймауты в SDK', async () => {
    sdk.FakeClient.defaultListToolsHandler = async () => ({
      tools: [
        {
          name: 'read_file',
          title: 'Read file',
          description: 'Reads a file',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
          },
          annotations: { readOnlyHint: true, idempotentHint: true },
        },
      ],
    });
    const { service } = await createHarness();

    const tools = await service.listToolsAsync('filesystem');
    const client = sdk.FakeClient.instances[0];
    const transport = sdk.FakeTransport.instances[0];

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'read_file',
      title: 'Read file',
      description: 'Reads a file',
      annotations: { readOnlyHint: true, idempotentHint: true },
    });
    expect(tools[0]?.inputSchema).toEqual({
      type: 'object',
      properties: { path: { type: 'string' } },
    });
    expect(client?.connectCalls).toBe(1);
    expect(client?.connectOptions).toEqual({ timeout: 10_000 });
    expect(client?.listToolsCalls[0]?.timeout).toBe(30_000);
    expect(transport?.url.href).toBe('http://mcp-filesystem:3010/mcp');
    expect(transport?.options).toMatchObject({ redirectPolicy: 'same-origin' });
    // Валидация узла до preflight: реестр знает только описанные серверы.
    expect(service.hasServer('filesystem')).toBe(true);
    expect(service.hasServer('nope')).toBe(false);
  });

  it('connect-mutex: параллельные вызовы создают одно соединение', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    sdk.FakeClient.defaultListToolsHandler = async () => {
      await gate;

      return { tools: [{ name: 'one', inputSchema: { type: 'object' } }] };
    };
    const { service } = await createHarness();

    const first = service.listToolsAsync('filesystem');
    const second = service.listToolsAsync('filesystem');

    release?.();
    await Promise.all([first, second]);

    expect(sdk.FakeClient.instances).toHaveLength(1);
    expect(sdk.FakeClient.instances[0]?.listToolsCalls).toHaveLength(1);
  });

  it('читает каталог постранично (nextCursor) и складывает инструменты', async () => {
    sdk.FakeClient.defaultListToolsHandler = async (params) =>
      params?.cursor === 'cursor-2'
        ? { tools: [{ name: 'b', inputSchema: { type: 'object' } }] }
        : {
            tools: [{ name: 'a', inputSchema: { type: 'object' } }],
            nextCursor: 'cursor-2',
          };
    const { service } = await createHarness();

    const tools = await service.listToolsAsync('filesystem');
    const client = sdk.FakeClient.instances[0];

    expect(tools.map((tool) => tool.name)).toEqual(['a', 'b']);
    expect(client?.listToolsCalls).toHaveLength(2);
    expect(client?.listToolsCalls[0]?.params).toBeUndefined();
    expect(client?.listToolsCalls[1]?.params).toEqual({ cursor: 'cursor-2' });
  });

  it('TTL-кэш: повторный вызов в пределах TTL не ходит в сеть', async () => {
    const { service, now } = await createHarness();

    await service.listToolsAsync('filesystem');
    await service.listToolsAsync('filesystem');

    const client = sdk.FakeClient.instances[0];

    expect(client?.listToolsCalls).toHaveLength(1);

    now.value += 59_999;
    await service.listToolsAsync('filesystem');
    expect(client?.listToolsCalls).toHaveLength(1);

    now.value += 2;
    await service.listToolsAsync('filesystem');
    expect(client?.listToolsCalls).toHaveLength(2);
  });

  it('tools/list_changed инвалидирует каталог', async () => {
    const { service } = await createHarness();

    await service.listToolsAsync('filesystem');

    const client = sdk.FakeClient.instances[0];
    const onChanged = client?.options?.listChanged?.tools?.onChanged;

    expect(onChanged).toBeTypeOf('function');

    onChanged?.(null, null);
    await service.listToolsAsync('filesystem');

    expect(client?.listToolsCalls).toHaveLength(2);
  });

  it('onclose помечает клиент неготовым, следующий вызов переподключается', async () => {
    const { service } = await createHarness();

    await service.listToolsAsync('filesystem');

    const transport = sdk.FakeTransport.instances[0];

    expect(transport).toBeDefined();

    transport?.onclose?.();
    await service.listToolsAsync('filesystem');

    expect(sdk.FakeClient.instances).toHaveLength(2);
    expect(sdk.FakeClient.instances[1]?.connectCalls).toBe(1);
    expect(sdk.FakeTransport.instances).toHaveLength(2);
  });

  it('ошибка connect превращается в McpUnavailableException, следующий вызов пробует снова', async () => {
    sdk.FakeClient.defaultConnectError = new Error('Request timed out');
    const { service } = await createHarness();

    await expect(service.listToolsAsync('filesystem')).rejects.toBeInstanceOf(
      McpUnavailableException,
    );
    expect(sdk.FakeClient.instances[0]?.connectCalls).toBe(1);

    // Следующий вызов создаёт новый клиент и переподключается (сбой не
    // кэшируется навсегда).
    sdk.FakeClient.defaultConnectError = null;
    await expect(service.listToolsAsync('filesystem')).resolves.toHaveLength(0);
    expect(sdk.FakeClient.instances).toHaveLength(2);
  });

  it('лимит MCP_MAX_TOOLS_PER_SERVER обрезает каталог', async () => {
    sdk.FakeClient.defaultListToolsHandler = async () => ({
      tools: [
        { name: 'a', inputSchema: { type: 'object' } },
        { name: 'b', inputSchema: { type: 'object' } },
        { name: 'c', inputSchema: { type: 'object' } },
      ],
    });
    const { service } = await createHarness({ MCP_MAX_TOOLS_PER_SERVER: 2 });

    const tools = await service.listToolsAsync('filesystem');

    expect(tools.map((tool) => tool.name)).toEqual(['a', 'b']);
  });

  it('SSE-транспорт выбирается по конфигурации сервера', async () => {
    const { service } = await createHarness();

    await service.listToolsAsync('legacy');

    expect(sdk.FakeTransport.instances[0]?.url.href).toBe(
      'http://mcp-legacy:3011/sse',
    );
  });

  it('tokenEnv: токен уходит в Authorization, отсутствие переменной — ошибка конфигурации', async () => {
    const servers = JSON.stringify({
      secured: {
        transport: 'http',
        url: 'http://mcp-secured:3010/mcp',
        tokenEnv: 'MCP_SECURED_TOKEN',
      },
    });

    const withToken = await createHarness({
      MCP_SERVERS: servers,
      MCP_SECURED_TOKEN: 'secret-token',
    });

    await withToken.service.listToolsAsync('secured');

    const requestInit = sdk.FakeTransport.instances[0]?.options?.requestInit as
      { headers?: Record<string, string> } | undefined;

    expect(requestInit?.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
    });

    sdk.FakeClient.instances.length = 0;
    sdk.FakeTransport.instances.length = 0;

    const withoutToken = await createHarness({ MCP_SERVERS: servers });

    await expect(
      withoutToken.service.listToolsAsync('secured'),
    ).rejects.toBeInstanceOf(McpConfigurationException);
    expect(sdk.FakeClient.instances).toHaveLength(0);
  });

  it('prepareAsync схлопывает дубли серверов и падает при неизвестном сервере', async () => {
    const { service } = await createHarness();

    await service.prepareAsync(['filesystem', 'filesystem']);

    expect(sdk.FakeClient.instances).toHaveLength(1);
    expect(sdk.FakeClient.instances[0]?.listToolsCalls).toHaveLength(1);

    await expect(service.prepareAsync(['unknown'])).rejects.toBeInstanceOf(
      McpUnavailableException,
    );
  });

  it('выключенный сервер и выключенный MCP дают понятные ошибки', async () => {
    const { service } = await createHarness();

    await expect(service.listToolsAsync('disabled')).rejects.toBeInstanceOf(
      McpUnavailableException,
    );

    sdk.FakeClient.instances.length = 0;

    const off = await createHarness({ MCP_ENABLED: false });

    await expect(
      off.service.prepareAsync(['filesystem']),
    ).rejects.toBeInstanceOf(McpDisabledException);
    expect(sdk.FakeClient.instances).toHaveLength(0);
  });

  it('callToolAsync передаёт имя/аргументы, таймаут и оборачивает сбой', async () => {
    const { service } = await createHarness();

    await service.listToolsAsync('filesystem');

    const client = sdk.FakeClient.instances[0];

    if (client === undefined) {
      throw new Error('клиент не создан');
    }

    const result = await service.callToolAsync('filesystem', 'read_file', {
      path: 'a.txt',
    });

    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(client.callToolCalls[0]?.params).toEqual({
      name: 'read_file',
      arguments: { path: 'a.txt' },
    });
    expect(client.callToolCalls[0]?.timeout).toBe(30_000);

    client.callToolHandler = async () => {
      throw new Error('socket hang up');
    };

    await expect(
      service.callToolAsync('filesystem', 'read_file', {}),
    ).rejects.toBeInstanceOf(McpToolCallException);

    // DESIGN § 3.2.3: сбой вызова сбрасывает соединение — следующий вызов
    // переподключается, а не бьёт в мёртвый клиент.
    await service.listToolsAsync('filesystem');

    expect(sdk.FakeClient.instances).toHaveLength(2);
    expect(client.closeCalls).toBe(1);
  });

  it('onApplicationShutdown закрывает всех клиентов', async () => {
    const { service } = await createHarness();

    await service.listToolsAsync('filesystem');

    const client = sdk.FakeClient.instances[0];

    await service.onApplicationShutdown();

    expect(client?.closeCalls).toBe(1);

    await expect(service.listToolsAsync('filesystem')).rejects.toBeInstanceOf(
      McpUnavailableException,
    );
  });
});

describe('McpServerRegistry (v0.11 S6)', () => {
  it('читает реестр и отдаёт конфигурацию по имени', async () => {
    const { registry } = await createHarness();

    expect(registry.isEnabled()).toBe(true);
    expect(registry.getServer('filesystem')).toMatchObject({
      transport: 'http',
      enabled: true,
    });
    expect(registry.getServer('disabled')).toMatchObject({ enabled: false });
    expect(registry.listServers().map((entry) => entry.name)).toEqual([
      'filesystem',
      'legacy',
      'disabled',
    ]);
  });

  it('битый JSON при MCP_ENABLED=false не роняет реестр', async () => {
    const { registry } = await createHarness({
      MCP_ENABLED: false,
      MCP_SERVERS: '{not-json',
    });

    expect(registry.isEnabled()).toBe(false);
    expect(registry.listServers()).toEqual([]);
  });

  it('битый JSON при MCP_ENABLED=true — fail-fast', async () => {
    await expect(
      createHarness({ MCP_ENABLED: true, MCP_SERVERS: '{not-json' }),
    ).rejects.toThrow(/Некорректная конфигурация MCP/);
  });

  it('неизвестный сервер: getServerOrThrow бросает McpUnavailableException', async () => {
    const { registry } = await createHarness();

    expect(registry.getServer('nope')).toBeUndefined();
    expect(() => registry.getServerOrThrow('nope')).toThrow(
      McpUnavailableException,
    );
  });
});
