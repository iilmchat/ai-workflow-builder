import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it, vi } from 'vitest';
import type { AgentToolContext } from '../agent/agent.types.js';
import { McpClientService } from './mcp-client.service.js';
import { McpToolCallException } from './mcp.errors.js';
import {
  McpToolAdapter,
  buildMcpToolDescription,
  buildMcpToolName,
  normalizeToolResult,
  toZodSchema,
} from './mcp-tool.adapter.js';
import type { McpToolDescriptor } from './mcp.types.js';

/**
 * Контекст выполнения инструмента для тестов MCP-адаптера.
 *
 * MCP-инструменту контекст не нужен (он ходит только в `McpClientService`),
 * поэтому поля не заполняются — приведение типа документирует это намерение.
 */
const TOOL_CONTEXT = {} as AgentToolContext;

/**
 * Собирает текстовый результат `tools/call`.
 *
 * @param text - текст единственного `text`-блока
 * @returns результат в форме SDK
 */
function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  } as CallToolResult;
}

/**
 * Собирает адаптер с моком MCP-клиента (RULES 4.13).
 *
 * @param callToolAsync - реализация `McpClientService.callToolAsync`
 * @param env - значения env для `ConfigService`
 * @returns адаптер и мок клиента
 */
async function createHarness(
  callToolAsync = vi.fn(() => Promise.resolve(textResult('ok'))),
  env: Record<string, unknown> = {},
): Promise<{
  adapter: McpToolAdapter;
  callToolAsync: ReturnType<typeof vi.fn>;
}> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      McpToolAdapter,
      { provide: McpClientService, useValue: { callToolAsync } },
      {
        provide: ConfigService,
        useValue: {
          get: <T>(key: string): T | undefined => env[key] as T | undefined,
        },
      },
    ],
  }).compile();

  return { adapter: moduleRef.get(McpToolAdapter), callToolAsync };
}

/** Описание MCP-инструмента для тестов адаптера. */
const READ_FILE: McpToolDescriptor = {
  name: 'read_file',
  title: 'Read file',
  description: 'Reads a file from the workspace',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

describe('buildMcpToolName (v0.11 S7)', () => {
  it('короткое имя — mcp__server__tool', () => {
    expect(buildMcpToolName('filesystem', 'read_file')).toBe(
      'mcp__filesystem__read_file',
    );
  });

  it('длинное имя обрезается и получает sha256-хвост', () => {
    const server = 'verylongservername';
    const tool = 'x'.repeat(100);
    const name = buildMcpToolName(server, tool);

    expect(name).toHaveLength(64);
    expect(name).toMatch(/^mcp__verylongservername__x+__[0-9a-f]{8}$/);
    // Два разных длинных имени не должны схлопнуться в одно.
    expect(name).not.toBe(buildMcpToolName(server, `${tool}y`));
  });
});

describe('toZodSchema (v0.11 S7)', () => {
  it('преобразует JSON Schema в рабочую Zod-схему', () => {
    const schema = toZodSchema(READ_FILE.inputSchema);

    expect(schema.safeParse({ path: 'a.txt' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('невалидная схема сервера → fallback z.record (принимает объект)', () => {
    const schema = toZodSchema(42);

    expect(schema.safeParse({ anything: 1 }).success).toBe(true);
    expect(schema.safeParse('not-an-object').success).toBe(false);
  });
});

describe('normalizeToolResult (v0.11 S7)', () => {
  it('маленький structuredContent возвращается как объект', () => {
    const result = {
      content: [],
      structuredContent: { files: ['a.txt'] },
    } as CallToolResult;

    expect(normalizeToolResult(result, 1000)).toEqual({ files: ['a.txt'] });
  });

  it('большой structuredContent обрезается строкой', () => {
    const result = {
      content: [],
      structuredContent: { text: 'x'.repeat(100) },
    } as CallToolResult;
    const normalized = normalizeToolResult(result, 20);

    expect(typeof normalized).toBe('string');
    expect(normalized).toContain('(truncated)');
  });

  it('image/audio/resource заменяются пометкой, text остаётся', () => {
    const result = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        { type: 'audio', data: 'BBBB', mimeType: 'audio/mpeg' },
        {
          type: 'resource',
          resource: { uri: 'file:///a.txt', text: 'resource body' },
        },
      ],
    } as CallToolResult;

    expect(normalizeToolResult(result, 4000)).toBe(
      'hello\n[image omitted]\n[audio omitted]\n[resource omitted]',
    );
  });

  it('длинный текст обрезается до лимита', () => {
    const normalized = normalizeToolResult(textResult('x'.repeat(50)), 10);

    expect(normalized).toBe(`${'x'.repeat(10)}… (truncated)`);
  });

  it('isError: true — McpToolCallException с текстом сервера', () => {
    const result = {
      content: [{ type: 'text', text: 'File not found' }],
      isError: true,
    } as CallToolResult;

    expect(() => normalizeToolResult(result, 4000)).toThrow(
      McpToolCallException,
    );
    expect(() => normalizeToolResult(result, 4000)).toThrow('File not found');
  });

  it('isError без текста — понятная ошибка', () => {
    const result = { content: [], isError: true } as CallToolResult;

    expect(() => normalizeToolResult(result, 4000)).toThrow(
      /ошибку без текста/,
    );
  });
});

describe('buildMcpToolDescription (v0.11 S7)', () => {
  it('схлопывает переводы строк и подписывает сервером', () => {
    const description = buildMcpToolDescription('filesystem', {
      ...READ_FILE,
      description: 'Line one\n\nLine two',
    });

    expect(description).toBe(
      "MCP-инструмент сервера 'filesystem': Line one Line two",
    );
  });

  it('обрезает длинное описание до 500 символов', () => {
    const description = buildMcpToolDescription('filesystem', {
      ...READ_FILE,
      description: 'y'.repeat(1000),
    });

    expect(description.length).toBeLessThanOrEqual(501);
    expect(description.endsWith('…')).toBe(true);
  });
});

describe('McpToolAdapter.createAgentTool (v0.11 S7)', () => {
  it('собирает AgentTool: имя, описание, hints и JSON Schema → Zod', async () => {
    const { adapter } = await createHarness();
    const tool = adapter.createAgentTool('filesystem', READ_FILE);

    expect(tool.name).toBe('mcp__filesystem__read_file');
    expect(tool.description).toContain('Reads a file');
    expect(tool.readOnlyHint).toBe(true);
    expect(tool.idempotentHint).toBe(true);
    // `destructiveHint` сервер не отдал — поля нет, а не `undefined`-ключ.
    expect(tool.destructiveHint).toBeUndefined();
    expect(tool.inputSchema.safeParse({ path: 'a.txt' }).success).toBe(true);
  });

  it('executeAsync валидирует аргументы и вызывает tools/call', async () => {
    const callToolAsync = vi.fn(() => Promise.resolve(textResult('content')));
    const { adapter } = await createHarness(callToolAsync);
    const tool = adapter.createAgentTool('filesystem', READ_FILE);

    await expect(
      tool.executeAsync({ path: 'a.txt' }, TOOL_CONTEXT),
    ).resolves.toBe('content');
    expect(callToolAsync).toHaveBeenCalledWith('filesystem', 'read_file', {
      path: 'a.txt',
    });
  });

  it('невалидные аргументы — tool-ошибка без вызова сервера', async () => {
    const callToolAsync = vi.fn(() => Promise.resolve(textResult('ok')));
    const { adapter } = await createHarness(callToolAsync);
    const tool = adapter.createAgentTool('filesystem', READ_FILE);

    await expect(tool.executeAsync({}, TOOL_CONTEXT)).rejects.toBeInstanceOf(
      McpToolCallException,
    );
    expect(callToolAsync).not.toHaveBeenCalled();
  });

  it('результат-картинка превращается в placeholder', async () => {
    const callToolAsync = vi.fn(() =>
      Promise.resolve({
        content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
      } as CallToolResult),
    );
    const { adapter } = await createHarness(callToolAsync);
    const tool = adapter.createAgentTool('filesystem', READ_FILE);

    await expect(
      tool.executeAsync({ path: 'a.txt' }, TOOL_CONTEXT),
    ).resolves.toBe('[image omitted]');
  });

  it('лимит MCP_MAX_RESULT_CHARS применяется к результату', async () => {
    const callToolAsync = vi.fn(() =>
      Promise.resolve(textResult('x'.repeat(600))),
    );
    const { adapter } = await createHarness(callToolAsync, {
      MCP_MAX_RESULT_CHARS: 500,
    });
    const tool = adapter.createAgentTool('filesystem', READ_FILE);

    await expect(
      tool.executeAsync({ path: 'a.txt' }, TOOL_CONTEXT),
    ).resolves.toBe(`${'x'.repeat(500)}… (truncated)`);
  });
});
