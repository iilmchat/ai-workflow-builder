import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  McpServerConfigSchema,
  McpServersSchema,
  parseMcpServersConfig,
  readBooleanConfig,
  readIntegerConfig,
} from './mcp.config.js';

/**
 * Конфигурация MCP (v0.11 S6, DESIGN § 3.2.9).
 *
 * Проверяется граница «env → валидированный реестр» (RULES 1.17): битый JSON,
 * невалидные имена/URL/транспорт, `tokenEnv` и пустая строка. Это дешёвые
 * тесты без сети и без Nest-модуля.
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
        transport: 'stdio',
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
