/**
 * Тесты ручки каталога MCP-серверов (v0.11 S8, DESIGN § 3.2.6).
 *
 * Проверяются три контрактных инварианта:
 * 1. `MCP_ENABLED=false` → `{ enabled: false, servers: [] }` со статусом 200,
 *    клиент MCP не трогается (выключенная фича не ходит в сеть);
 * 2. при включённом MCP ошибка одного сервера не роняет ручку
 *    (`Promise.allSettled`), остальные серверы и их инструменты остаются;
 * 3. в ответе нет URL/заголовков/токенов — ни полей, ни текста ошибки
 *    (RULES 5.1, DESIGN § 3.2.6/§ 3.2.8).
 */
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from './mcp.config.js';
import type { McpServerEntry } from './mcp-server.registry.js';
import { McpClientService } from './mcp-client.service.js';
import { McpController } from './mcp.controller.js';
import { McpServerRegistry } from './mcp-server.registry.js';
import type { McpToolDescriptor } from './mcp.types.js';

/** URL сервера-заглушки: в ответ API попадать не должен. */
const SERVER_URL = 'http://internal-mcp.local:9999/mcp';

/** Имя env-переменной с токеном: тоже не должно попадать в ответ. */
const TOKEN_ENV = 'MCP_INTERNAL_TOKEN';

/** Значение токена: не должно попадать в ответ ни в каком виде. */
const TOKEN_VALUE = 'super-secret-token-value';

/**
 * Собирает конфигурацию MCP-сервера для реестра-заглушки.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns валидированная конфигурация (тип `McpServerConfig`)
 */
function serverConfig(
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig {
  return {
    transport: 'http',
    url: SERVER_URL,
    tokenEnv: TOKEN_ENV,
    headers: { 'X-Api-Key': TOKEN_VALUE },
    enabled: true,
    ...overrides,
  };
}

/**
 * Собирает запись реестра для теста.
 *
 * @param name - имя сервера
 * @param config - конфигурация сервера
 * @returns запись «имя → конфигурация»
 */
function serverEntry(
  name: string,
  config: McpServerConfig = serverConfig(),
): McpServerEntry {
  return { name, config };
}

/**
 * Инструмент, который вернёт замоканный клиент.
 *
 * `inputSchema` есть в описании клиента, но в DTO ответа его быть не должно:
 * UI не собирает аргументы, а JSON Schema только раздувает ответ.
 */
const READ_TOOL: McpToolDescriptor = {
  name: 'read_file',
  title: 'Read file',
  description: 'Прочитать файл',
  inputSchema: { type: 'object' },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
};

/** Пишущий инструмент: проверяем, что `destructiveHint` доходит до UI. */
const WRITE_TOOL: McpToolDescriptor = {
  name: 'write_file',
  description: 'Записать файл',
  inputSchema: { type: 'object' },
  annotations: { destructiveHint: true },
};

/**
 * Создаёт контроллер с замоканными зависимостями.
 *
 * `Test.createTestingModule`, а не `new McpController(...)` — по RULES 4.13:
 * у контроллера есть зависимости, и тест должен собирать их через DI-контейнер
 * (как остальные controller-spec'и проекта).
 *
 * @param options - включённость MCP, серверы реестра и поведение клиента
 * @returns инстанс контроллера вместе с моками
 */
async function createControllerAsync(options: {
  readonly enabled: boolean;
  readonly entries?: readonly McpServerEntry[];
  readonly listTools?: (serverName: string) => Promise<readonly McpToolDescriptor[]>;
  readonly maxToolsPerNode?: number;
}): Promise<{
  controller: McpController;
  listToolsAsync: ReturnType<typeof vi.fn>;
  configGet: ReturnType<typeof vi.fn>;
}> {
  const listToolsAsync = vi.fn(
    options.listTools ?? (async () => [READ_TOOL]),
  );
  const configGet = vi.fn((key: string): unknown =>
    key === 'MCP_MAX_TOOLS_PER_NODE' ? options.maxToolsPerNode : undefined,
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [McpController],
    providers: [
      McpController,
      {
        provide: McpServerRegistry,
        useValue: {
          isEnabled: () => options.enabled,
          listServers: () => options.entries ?? [],
        },
      },
      {
        provide: McpClientService,
        useValue: { listToolsAsync },
      },
      {
        provide: ConfigService,
        useValue: { get: configGet },
      },
      // `JwtAuthGuard` (R6.1a) инстанцируется Nest'ом из декоратора
      // `@UseGuards`: ему нужен `JwtService`. Сами методы в тесте вызываются
      // напрямую, поэтому проверка токена не выполняется.
      { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
    ],
  }).compile();

  return {
    controller: moduleRef.get(McpController),
    listToolsAsync,
    configGet,
  };
}

describe('McpController — GET /mcp/servers (v0.11 S8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('при MCP_ENABLED=false отдаёт пустой список и не трогает клиент', async () => {
    const { controller, listToolsAsync } = await createControllerAsync({
      enabled: false,
      entries: [serverEntry('filesystem')],
      maxToolsPerNode: 7,
    });

    await expect(controller.listServersAsync()).resolves.toEqual({
      enabled: false,
      maxToolsPerNode: 7,
      servers: [],
    });
    expect(listToolsAsync).not.toHaveBeenCalled();
  });

  it('при MCP_ENABLED=true отдаёт серверы, статусы и инструменты', async () => {
    const { controller, listToolsAsync } = await createControllerAsync({
      enabled: true,
      entries: [
        serverEntry('filesystem'),
        serverEntry('search', serverConfig({ transport: 'sse' })),
      ],
      listTools: async (name) =>
        name === 'filesystem' ? [READ_TOOL, WRITE_TOOL] : [],
      maxToolsPerNode: 5,
    });

    const response = await controller.listServersAsync();

    expect(response.enabled).toBe(true);
    expect(response.maxToolsPerNode).toBe(5);
    expect(response.servers).toEqual([
      {
        name: 'filesystem',
        transport: 'http',
        status: 'ok',
        tools: [
          {
            name: 'read_file',
            title: 'Read file',
            description: 'Прочитать файл',
            readOnlyHint: true,
            idempotentHint: true,
          },
          {
            name: 'write_file',
            description: 'Записать файл',
            destructiveHint: true,
          },
        ],
      },
      {
        name: 'search',
        transport: 'sse',
        status: 'ok',
        tools: [],
      },
    ]);
    expect(listToolsAsync).toHaveBeenCalledTimes(2);
  });

  it('ошибка одного сервера не роняет ручку (Promise.allSettled)', async () => {
    const { controller } = await createControllerAsync({
      enabled: true,
      entries: [serverEntry('broken'), serverEntry('working')],
      listTools: async (name) => {
        if (name === 'broken') {
          throw new Error(
            `connect ECONNREFUSED ${SERVER_URL} (token=${TOKEN_VALUE})`,
          );
        }

        return [READ_TOOL];
      },
    });

    const response = await controller.listServersAsync();

    expect(response.servers.map((server) => server.status)).toEqual([
      'error',
      'ok',
    ]);
    expect(response.servers[0]?.error).toBe(
      'не удалось получить каталог инструментов',
    );
    expect(response.servers[1]?.tools.map((tool) => tool.name)).toEqual([
      'read_file',
    ]);
  });

  it('сервер с enabled=false получает статус disabled и не подключается', async () => {
    const { controller, listToolsAsync } = await createControllerAsync({
      enabled: true,
      entries: [
        serverEntry('off', serverConfig({ enabled: false })),
        serverEntry('on'),
      ],
    });

    const response = await controller.listServersAsync();

    expect(response.servers[0]).toEqual({
      name: 'off',
      transport: 'http',
      status: 'disabled',
      tools: [],
    });
    expect(listToolsAsync).toHaveBeenCalledTimes(1);
    expect(listToolsAsync).toHaveBeenCalledWith('on');
  });

  it('не отдаёт URL, заголовки и токены — ни в полях, ни в тексте ошибки', async () => {
    const { controller } = await createControllerAsync({
      enabled: true,
      entries: [serverEntry('filesystem')],
      listTools: async () => {
        throw new Error(
          `Ошибка ${SERVER_URL} ${TOKEN_ENV}=${TOKEN_VALUE} X-Api-Key: ${TOKEN_VALUE}`,
        );
      },
    });

    const serialized = JSON.stringify(await controller.listServersAsync());

    expect(serialized).not.toContain(SERVER_URL);
    expect(serialized).not.toContain('internal-mcp.local');
    expect(serialized).not.toContain('9999');
    expect(serialized).not.toContain(TOKEN_ENV);
    expect(serialized).not.toContain(TOKEN_VALUE);
    expect(serialized).not.toContain('X-Api-Key');
    expect(serialized).not.toContain('inputSchema');
  });

  it('лимит на узел по умолчанию — жёсткий потолок 20', async () => {
    const { controller } = await createControllerAsync({ enabled: false });

    await expect(controller.listServersAsync()).resolves.toEqual({
      enabled: false,
      maxToolsPerNode: 20,
      servers: [],
    });
  });

  it('неизвестная (нечисловая) настройка лимита не роняет ручку', async () => {
    const { controller } = await createControllerAsync({
      enabled: false,
      maxToolsPerNode: Number.NaN,
    });

    const response = await controller.listServersAsync();

    expect(response.maxToolsPerNode).toBe(20);
  });
});
