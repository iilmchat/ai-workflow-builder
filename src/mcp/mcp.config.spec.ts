import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assertStdioCommandAllowed,
  isStdioServerConfig,
  McpServerConfigSchema,
  McpServersSchema,
  parseMcpServersConfig,
  readBooleanConfig,
  readIntegerConfig,
} from './mcp.config.js';

/**
 * Конфигурация MCP (v0.11 S6, v0.12 S4, DESIGN § 3.2.9 / § 3.3.1).
 *
 * Проверяется граница «env → валидированный реестр» (RULES 1.17): битый JSON,
 * невалидные имена/URL/транспорт, `tokenEnv`, пустая строка, а с v0.12 S4 —
 * `stdio`-конфиги (`command`/`args`, `MCP_ENABLE_STDIO`, denylist команд).
 * Это дешёвые тесты без сети и без Nest-модуля.
 */
describe('mcp.config — Zod-схемы (v0.11 S6)', () => {
  it('принимает валидный сервер и подставляет enabled=true', () => {
    const parsed = McpServerConfigSchema.parse({
      transport: 'http',
      url: 'http://mcp-filesystem:3010/mcp',
      tokenEnv: 'MCP_FILESYSTEM_TOKEN',
    });

    expect(parsed).toEqual({
      transport: 'http',
      url: 'http://mcp-filesystem:3010/mcp',
      tokenEnv: 'MCP_FILESYSTEM_TOKEN',
      enabled: true,
    });
  });

  it('отвергает неизвестный транспорт и не-http(s) URL', () => {
    expect(
      McpServerConfigSchema.safeParse({
        transport: 'websocket',
        url: 'http://localhost:1/mcp',
      }).success,
    ).toBe(false);

    expect(
      McpServerConfigSchema.safeParse({
        transport: 'http',
        url: 'ftp://mcp.example/mcp',
      }).success,
    ).toBe(false);
  });

  it('tokenEnv — имя переменной, а не значение секрета', () => {
    expect(
      McpServerConfigSchema.safeParse({
        transport: 'http',
        url: 'http://mcp.example/mcp',
        tokenEnv: 'lowercase_token',
      }).success,
    ).toBe(false);

    expect(
      McpServerConfigSchema.safeParse({
        transport: 'http',
        url: 'http://mcp.example/mcp',
        tokenEnv: 'MCP_TOKEN_1',
      }).success,
    ).toBe(true);
  });

  it('имена серверов проверяются регуляркой', () => {
    expect(
      McpServersSchema.safeParse({
        'Filesystem Server': {
          transport: 'http',
          url: 'http://mcp.example/mcp',
        },
      }).success,
    ).toBe(false);
  });

  it('пустая строка — пустой реестр', () => {
    expect(parseMcpServersConfig('')).toEqual({});
    expect(parseMcpServersConfig('   ')).toEqual({});
    expect(parseMcpServersConfig(undefined)).toEqual({});
  });

  it('битый JSON — ошибка с понятным текстом', () => {
    expect(() => parseMcpServersConfig('{oops')).toThrow(
      /MCP_SERVERS: некорректный JSON/,
    );
  });

  it('массив вместо объекта — ошибка', () => {
    expect(() => parseMcpServersConfig('[]')).toThrow(/ожидается JSON-объект/);
  });

  it('неизвестное имя сервера в JSON — ошибка схемы', () => {
    expect(() =>
      parseMcpServersConfig(
        JSON.stringify({
          BadName: { transport: 'http', url: 'http://mcp.example/mcp' },
        }),
      ),
    ).toThrow(/MCP_SERVERS/);
  });

  it('принимает уже разобранный объект (тесты и повторное использование)', () => {
    expect(
      parseMcpServersConfig({
        fs: { transport: 'http', url: 'http://mcp.example/mcp' },
      }),
    ).toMatchObject({ fs: { enabled: true } });
  });
});

/**
 * `stdio`-конфигурация (v0.12 S4, KI-526, DESIGN v0.12 § 3.3.1/§ 3.3.3).
 *
 * Проверяется три вещи: схема требует `command` и не смешивает транспорты,
 * `MCP_ENABLE_STDIO=false` не даёт запустить процесс, а denylist отсекает
 * оболочки и разрушительные утилиты ещё на старте.
 */
describe('mcp.config — stdio-транспорт (v0.12 S4)', () => {
  /** Валидный stdio-сервер в «сыром» виде (как в env). */
  const stdioServer = {
    transport: 'stdio',
    command: 'docker',
    args: ['run', '-i', '--rm', 'mcp/filesystem', '/data'],
  };

  it('принимает stdio с command/args, args по умолчанию пустой массив', () => {
    const parsed = McpServerConfigSchema.parse(stdioServer);

    expect(parsed).toMatchObject({
      transport: 'stdio',
      command: 'docker',
      args: ['run', '-i', '--rm', 'mcp/filesystem', '/data'],
      enabled: true,
    });
    expect(isStdioServerConfig(parsed)).toBe(true);

    const minimal = McpServerConfigSchema.parse({
      transport: 'stdio',
      command: 'node',
    });

    expect(minimal).toMatchObject({ args: [], enabled: true });
  });

  it('command обязателен; url/headers/tokenEnv в stdio запрещены (.strict)', () => {
    expect(
      McpServerConfigSchema.safeParse({ transport: 'stdio' }).success,
    ).toBe(false);
    // Пустая/пробельная команда — не команда.
    expect(
      McpServerConfigSchema.safeParse({ transport: 'stdio', command: '   ' })
        .success,
    ).toBe(false);
    // Смешивать транспорты нельзя: `url` в stdio-конфиге — ошибка схемы.
    expect(
      McpServerConfigSchema.safeParse({
        transport: 'stdio',
        command: 'docker',
        url: 'http://localhost:3010/mcp',
      }).success,
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({
        ...stdioServer,
        tokenEnv: 'MCP_SECURED_TOKEN',
      }).success,
    ).toBe(false);
  });

  it('stdio запрещён без MCP_ENABLE_STDIO=true', () => {
    expect(() => parseMcpServersConfig({ local: stdioServer })).toThrow(
      /MCP_ENABLE_STDIO/,
    );

    expect(
      parseMcpServersConfig(
        { local: stdioServer },
        { enableStdio: true },
      ),
    ).toMatchObject({ local: { command: 'docker' } });
  });

  it('denylist: оболочки и разрушительные команды отвергаются на старте', () => {
    const forbidden = [
      'sh',
      'bash',
      'cmd',
      'cmd.exe',
      'C:\\Windows\\System32\\cmd.exe',
      '/bin/sh',
      'powershell',
      'pwsh',
      'rm',
      'mkfs',
      'mkfs.ext4',
      'format',
      'del',
      'taskkill',
      'shutdown',
    ];

    for (const command of forbidden) {
      expect(() => assertStdioCommandAllowed(command)).toThrow(/запрещена/);
      expect(() =>
        parseMcpServersConfig(
          { bad: { transport: 'stdio', command } },
          { enableStdio: true },
        ),
      ).toThrow(/запрещена/);
    }
  });

  it('denylist не мешает обычным MCP-командам и абсолютным путям', () => {
    for (const command of [
      'docker',
      'node',
      'npx',
      '/usr/local/bin/mcp-server',
      'C:\\tools\\mcp-server.exe',
    ]) {
      expect(() => assertStdioCommandAllowed(command)).not.toThrow();
    }

    expect(() => assertStdioCommandAllowed('   ')).toThrow(/пустая/);
  });

  it('аргументы — только массив; метасимволы внутри остаются строкой', () => {
    expect(
      McpServerConfigSchema.safeParse({
        transport: 'stdio',
        command: 'docker',
        args: 'run -i',
      }).success,
    ).toBe(false);
    // `shell: true` нигде не включается, поэтому это просто аргумент.
    expect(
      McpServerConfigSchema.safeParse({
        transport: 'stdio',
        command: 'docker',
        args: ['run; rm -rf /'],
      }).success,
    ).toBe(true);
  });
});

describe('mcp.config — чтение env (v0.11 S6)', () => {
  it('readIntegerConfig: число, строка, fallback и границы', () => {
    /** Минимальный `ConfigService` для проверки чтения значений. */
    const get = (values: Record<string, unknown>): ConfigService =>
      ({
        get: <T>(key: string): T | undefined => values[key] as T | undefined,
      }) as unknown as ConfigService;

    expect(readIntegerConfig(get({ X: 5000 }), 'X', 100, 1, 10_000)).toBe(5000);
    expect(readIntegerConfig(get({ X: '250' }), 'X', 100, 1, 10_000)).toBe(250);
    expect(readIntegerConfig(get({}), 'X', 100, 1, 10_000)).toBe(100);
    expect(readIntegerConfig(get({ X: -5 }), 'X', 100, 1, 10_000)).toBe(1);
    expect(readIntegerConfig(get({ X: 999_999 }), 'X', 100, 1, 10_000)).toBe(
      10_000,
    );
  });

  it('readBooleanConfig: только true/строка "true" включают флаг', () => {
    expect(readBooleanConfig(true)).toBe(true);
    expect(readBooleanConfig('true')).toBe(true);
    expect(readBooleanConfig('false')).toBe(false);
    expect(readBooleanConfig(false)).toBe(false);
    expect(readBooleanConfig(undefined)).toBe(false);
    expect(readBooleanConfig('1')).toBe(false);
  });

  it('fromJSONSchema доступен в используемой версии Zod (проверка контракта)', () => {
    const schema = z.fromJSONSchema({
      type: 'object',
      properties: { q: { type: 'string' } },
      required: ['q'],
    });

    expect(schema.safeParse({ q: 'x' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });
});
