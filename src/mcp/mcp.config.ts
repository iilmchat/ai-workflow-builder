/**
 * Конфигурация MCP-адаптера: Zod-схемы и чтение env (v0.11 S6, DESIGN § 3.2.1).
 *
 * `MCP_SERVERS` хранится в env строкой JSON. Разбор и валидация выполняются
 * **на старте** (при создании `McpServerRegistry`): битый JSON при
 * `MCP_ENABLED=true` — fail-fast, при `false` — предупреждение и пустой
 * реестр (DESIGN § 4.3). Так выключенная фича не ломает приложение.
 */
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { MCP_SERVER_NAME, MCP_TOKEN_ENV_PATTERN } from './mcp.types.js';

/**
 * URL MCP-сервера: только `http`/`https`.
 *
 * Приватные адреса разрешены осознанно: MCP-серверы часто живут во внутренней
 * Docker-сети (`mcp-filesystem`, `mcp-playwright`), а URL — операторская
 * конфигурация, а не пользовательский ввод (DESIGN § 3.2.8).
 */
const httpUrl = z.url({ protocol: /^https?$/ });

/**
 * Zod-схема одного MCP-сервера (DESIGN § 3.2.1).
 *
 * `tokenEnv` — **имя** переменной окружения с bearer-токеном: сам токен в JSON
 * не попадает и в логи/API не утекает (RULES 5.1/5.2).
 */
export const McpServerConfigSchema = z.object({
  /** Транспорт: Streamable HTTP или устаревший SSE. `stdio` в v0.11 не поддержан. */
  transport: z.enum(['http', 'sse']),
  /** URL MCP-endpoint'а (http/https). */
  url: httpUrl,
  /** Имя env-переменной с bearer-токеном; значение читается при подключении. */
  tokenEnv: z
    .string()
    .regex(
      MCP_TOKEN_ENV_PATTERN,
      'tokenEnv должен быть именем переменной окружения (A-Z, 0-9, _)',
    )
    .optional(),
  /** Несекретные заголовки (`User-Agent` и т.п.), до 512 символов каждый. */
  headers: z.record(z.string(), z.string().max(512)).optional(),
  /** Включён ли сервер (default true). Выключенный сервер не подключается. */
  enabled: z.boolean().default(true),
});

/** Валидированная конфигурация одного MCP-сервера. */
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Zod-схема реестра `MCP_SERVERS`: объект «имя сервера → конфигурация».
 *
 * Имена проверяются регуляркой, поэтому значение из env не может подсунуть
 * ключ с пробелами/юникодом в имя инструмента агента.
 */
export const McpServersSchema = z.record(
  z
    .string()
    .regex(
      MCP_SERVER_NAME,
      'имя MCP-сервера должно соответствовать ^[a-z][a-z0-9_-]{0,23}$',
    ),
  McpServerConfigSchema,
);

/** Валидированный реестр MCP-серверов. */
export type McpServersConfig = z.infer<typeof McpServersSchema>;

/**
 * Приводит неизвестную ошибку к тексту.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Проверяет, что значение — обычный объект (не массив/`null`).
 *
 * @param value - значение типа `unknown`
 * @returns `true`, если значение читается как `Record<string, unknown>`
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Разбирает и валидирует реестр MCP-серверов.
 *
 * Принимает как строку JSON из env (штатный путь), так и уже разобранный
 * объект (удобно в тестах и при повторном использовании конфигурации).
 * Пустая строка трактуется как `{}` (DESIGN § 4.3, KI-084-класс ошибок).
 *
 * @param raw - сырое значение `MCP_SERVERS` (`string`/`object`/`undefined`)
 * @returns валидированный реестр (может быть пустым)
 * @throws Error если строка не является JSON или реестр не соответствует схеме
 */
export function parseMcpServersConfig(raw: unknown): McpServersConfig {
  if (raw === undefined || raw === null) {
    return {};
  }

  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    const text = raw.trim();

    if (text.length === 0) {
      return {};
    }

    try {
      parsed = JSON.parse(text);
    } catch (error: unknown) {
      throw new Error(`MCP_SERVERS: некорректный JSON (${toMessage(error)})`);
    }
  }

  if (!isPlainRecord(parsed)) {
    throw new Error(
      'MCP_SERVERS: ожидается JSON-объект «имя сервера → конфигурация»',
    );
  }

  const result = McpServersSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`MCP_SERVERS: ${z.prettifyError(result.error)}`);
  }

  return result.data;
}

/**
 * Читает целочисленную настройку из `ConfigService` с границами.
 *
 * Env-схема уже валидирует диапазоны (RULES 4.5), но клиент может собираться в
 * тестах с «сырым» `ConfigService`; поэтому значение дополнительно приводится
 * к числу и зажимается в границы, а не роняет цикл агента.
 *
 * @param config - конфигурация Nest
 * @param key - имя переменной окружения
 * @param fallback - значение по умолчанию
 * @param min - нижняя граница
 * @param max - верхняя граница
 * @returns целое число в диапазоне `[min, max]`
 */
export function readIntegerConfig(
  config: ConfigService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = config.get<unknown>(key);
  const numeric =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim().length > 0
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(numeric), min), max);
}

/**
 * Читает строгий boolean из `ConfigService`.
 *
 * После `EnvSchema` флаг приходит boolean; в тестах — та же форма. Строка
 * `'true'` допускается только как явное значение (RULES 4.35: `'false'` не
 * должно превращаться в `true`).
 *
 * @param value - сырое значение флага
 * @returns `true` только для boolean `true` или строки `'true'`
 */
export function readBooleanConfig(value: unknown): boolean {
  return value === true || value === 'true';
}
