/**
 * Адаптер MCP-инструментов в `AgentTool` (v0.11 S7, DESIGN § 3.2.4).
 *
 * MCP-инструменты не становятся отдельным типом узла: они добавляются в цикл
 * `agent` как динамические `AgentTool`. Здесь живут три чистые функции
 * (имя, JSON Schema → Zod, нормализация результата) и сборка самого
 * инструмента — без них `AgentService` пришлось бы знать детали протокола MCP.
 */
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AgentTool } from '../agent/agent.types.js';
import { McpClientService } from './mcp-client.service.js';
import { readIntegerConfig } from './mcp.config.js';
import { McpToolCallException } from './mcp.errors.js';
import {
  MCP_AGENT_TOOL_NAME_MAX,
  MCP_MAX_RESULT_CHARS_DEFAULT,
  MCP_TOOL_DESCRIPTION_MAX,
  type McpToolAnnotations,
  type McpToolDescriptor,
} from './mcp.types.js';

/**
 * Строит уникальное имя инструмента для протокола агента.
 *
 * Формат — `mcp__<server>__<tool>` (DESIGN § 3.2.4): префикс отделяет MCP от
 * нативных имён (`http_request`), сервер — от коллизий между серверами. Если
 * строка длиннее лимита, хвост заменяется коротким sha256-хэшем: обрезать
 * произвольно нельзя — два разных инструмента станут неразличимы.
 *
 * @param server - имя MCP-сервера
 * @param tool - имя инструмента на сервере
 * @returns имя для `AgentTool` (не длиннее {@link MCP_AGENT_TOOL_NAME_MAX})
 */
export function buildMcpToolName(server: string, tool: string): string {
  const raw = `mcp__${server}__${tool}`;

  if (raw.length <= MCP_AGENT_TOOL_NAME_MAX) {
    return raw;
  }

  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  // Суффикс `__<8 hex>` занимает 10 символов. В DESIGN § 3.2.4 стоит
  // `MCP_AGENT_TOOL_NAME_MAX - 9`, но тогда итоговая длина — 65 при лимите 64
  // (off-by-one в псевдокоде). Держим контракт лимита: 54 + 10 = 64.
  const prefixLength = MCP_AGENT_TOOL_NAME_MAX - 10;

  return `${raw.slice(0, prefixLength)}__${hash}`;
}

/**
 * Преобразует JSON Schema аргументов MCP в Zod-схему.
 *
 * Аргументы приходят от модели, то есть являются внешними данными (RULES 1.17);
 * Zod 4 умеет строить схему из JSON Schema. Если сервер отдал невалидную или
 * слишком экзотическую схему, используется `z.record(...)`: принимаем объект и
 * валидируем только на стороне сервера — это лучше, чем падать на старте.
 *
 * @param inputSchema - JSON Schema из `tools/list` (внешние данные)
 * @returns Zod-схема аргументов
 */
export function toZodSchema(inputSchema: unknown): z.ZodType<unknown> {
  try {
    return z.fromJSONSchema(
      inputSchema as Parameters<typeof z.fromJSONSchema>[0],
    );
  } catch {
    return z.record(z.string(), z.unknown());
  }
}

/**
 * Обрезает текст до лимита с явной пометкой.
 *
 * @param text - исходный текст
 * @param maxChars - максимум символов
 * @returns текст не длиннее `maxChars` + суффикс пометки
 */
function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}… (truncated)`;
}

/**
 * Обрезает JSON-значение до лимита.
 *
 * Маленькое значение возвращается как есть (структурированный результат
 * полезен в шаге), большое — строкой с пометкой, иначе `node_runs.logs`
 * раздуется (DESIGN § 3.2.4).
 *
 * @param value - JSON-значение
 * @param maxChars - максимум символов
 * @returns исходное значение либо обрезанная JSON-строка
 */
function truncateJson(value: unknown, maxChars: number): unknown {
  const json = JSON.stringify(value);

  if (json === undefined) {
    return null;
  }

  return json.length <= maxChars ? value : truncateText(json, maxChars);
}

/**
 * Извлекает текст из блоков результата (для текста tool-ошибки).
 *
 * @param result - результат `tools/call`
 * @returns склеенный текст `text`-блоков
 */
function extractText(result: CallToolResult): string {
  return result.content
    .filter(
      (block): block is Extract<typeof block, { type: 'text' }> =>
        block.type === 'text',
    )
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Нормализует результат MCP-инструмента для транскрипта агента.
 *
 * MCP возвращает `content[]` (text/image/audio/resource) и опциональный
 * `structuredContent`. В транскрипт кладётся только текст: vision-контракта в
 * текстовом протоколе агента нет, изображения/аудио/ресурсы заменяются
 * пометкой (DESIGN § 3.2.4). `isError: true` — это tool-ошибка, а не падение
 * узла: модель увидит текст и сможет сменить стратегию.
 *
 * @param result - результат `tools/call`
 * @param maxChars - максимум символов в ответе
 * @returns текст либо структурированный JSON (обрезанный при необходимости)
 * @throws McpToolCallException если сервер вернул `isError: true`
 */
export function normalizeToolResult(
  result: CallToolResult,
  maxChars: number = MCP_MAX_RESULT_CHARS_DEFAULT,
): unknown {
  if (result.isError === true) {
    const text = extractText(result);

    throw new McpToolCallException(
      text.length > 0
        ? truncateText(text, maxChars)
        : 'MCP-инструмент вернул ошибку без текста',
    );
  }

  if (result.structuredContent !== undefined) {
    return truncateJson(result.structuredContent, maxChars);
  }

  const text = result.content
    .map((block) =>
      block.type === 'text' ? block.text : `[${block.type} omitted]`,
    )
    .join('\n');

  return truncateText(text, maxChars);
}

/**
 * Схлопывает и обрезает описание MCP-инструмента для системного промпта.
 *
 * Переводы строк в описании ломают структуру списка инструментов, поэтому они
 * схлопываются в пробелы; длина ограничена 500 символами (DESIGN § 3.2.5).
 *
 * @param server - имя сервера (для подписи)
 * @param descriptor - описание инструмента
 * @returns однострочное описание не длиннее {@link MCP_TOOL_DESCRIPTION_MAX}
 */
export function buildMcpToolDescription(
  server: string,
  descriptor: McpToolDescriptor,
): string {
  const collapsed = (descriptor.description ?? '').replace(/\s+/g, ' ').trim();
  const text =
    collapsed.length > 0
      ? `MCP-инструмент сервера '${server}': ${collapsed}`
      : `MCP-инструмент сервера '${server}'`;

  return text.length <= MCP_TOOL_DESCRIPTION_MAX
    ? text
    : `${text.slice(0, MCP_TOOL_DESCRIPTION_MAX)}…`;
}

/**
 * Переносит аннотации MCP в поля `AgentTool` для retry-политики.
 *
 * @param annotations - аннотации сервера (подсказки, не гарантии)
 * @returns набор hint-полей `AgentTool`
 */
function toHintFields(
  annotations: McpToolAnnotations | undefined,
): Pick<
  AgentTool,
  'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint'
> {
  return {
    ...(annotations?.readOnlyHint === undefined
      ? {}
      : { readOnlyHint: annotations.readOnlyHint }),
    ...(annotations?.destructiveHint === undefined
      ? {}
      : { destructiveHint: annotations.destructiveHint }),
    ...(annotations?.idempotentHint === undefined
      ? {}
      : { idempotentHint: annotations.idempotentHint }),
    ...(annotations?.openWorldHint === undefined
      ? {}
      : { openWorldHint: annotations.openWorldHint }),
  };
}

/**
 * Проверяет, что распарсенные аргументы — JSON-объект.
 *
 * @param value - значение типа `unknown`
 * @returns `true`, если значение читается как `Record<string, unknown>`
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Собирает `AgentTool` для одного MCP-инструмента.
 *
 * `executeAsync` валидирует аргументы Zod-схемой (внешние данные от модели,
 * RULES 1.17), вызывает `tools/call` с таймаутом и нормализует результат.
 * Ошибки не проглатываются: `AgentService` превращает их в tool-шаг.
 */
@Injectable()
export class McpToolAdapter {
  /** Максимум символов результата в транскрипте (env `MCP_MAX_RESULT_CHARS`). */
  private readonly maxResultChars: number;

  /**
   * @param client - MCP-клиент (вызовы `tools/call`)
   * @param config - конфигурация приложения (лимит длины результата)
   */
  constructor(
    private readonly client: McpClientService,
    config: ConfigService,
  ) {
    this.maxResultChars = readIntegerConfig(
      config,
      'MCP_MAX_RESULT_CHARS',
      MCP_MAX_RESULT_CHARS_DEFAULT,
      500,
      20_000,
    );
  }

  /**
   * Создаёт `AgentTool` из описания MCP-инструмента.
   *
   * @param server - имя MCP-сервера (из env-реестра)
   * @param descriptor - описание инструмента из каталога
   * @returns инструмент для цикла агента
   */
  createAgentTool(server: string, descriptor: McpToolDescriptor): AgentTool {
    const inputSchema = toZodSchema(descriptor.inputSchema);
    const name = buildMcpToolName(server, descriptor.name);
    const maxResultChars = this.maxResultChars;

    return {
      // DESIGN § 3.2.5: `AgentTool.name` — `string`, потому что имена MCP
      // динамические; `AgentToolName` остаётся типом нативных инструментов.
      name,
      description: buildMcpToolDescription(server, descriptor),
      inputSchema,
      ...toHintFields(descriptor.annotations),
      executeAsync: async (input: unknown): Promise<unknown> => {
        const parsed = inputSchema.safeParse(input ?? {});

        if (!parsed.success) {
          throw new McpToolCallException(
            `Некорректные аргументы MCP-инструмента '${name}': ` +
              z.prettifyError(parsed.error),
            { server, tool: descriptor.name },
          );
        }

        const args = isPlainRecord(parsed.data) ? parsed.data : {};
        const result = await this.client.callToolAsync(
          server,
          descriptor.name,
          args,
        );

        return normalizeToolResult(result, maxResultChars);
      },
    };
  }
}
