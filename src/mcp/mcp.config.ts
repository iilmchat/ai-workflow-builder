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
 * Оболочки, запуск которых как MCP-сервера запрещён (DESIGN v0.12 § 3.3.3).
 *
 * `sh -c "<что угодно>"` / `cmd /c ...` — это ровно тот путь, который DESIGN
 * запрещает: вместо MCP-сервера оператор получал бы произвольную команду.
 * `args` при этом остаётся массивом, а не строкой, поэтому `command` — всегда
 * ровно один исполняемый файл.
 */
const FORBIDDEN_STDIO_COMMANDS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'csh',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
  'wsl',
]);

/**
 * Утилиты, запуск которых как MCP-сервера бессмысленен и опасен
 * (DESIGN v0.12 § 3.3.3: «простейший denylist»).
 *
 * Это не полноценная песочница — от произвольной программы защищает только
 * выключенный по умолчанию `MCP_ENABLE_STDIO` и docker-изоляция; denylist
 * отсекает очевидные катастрофы (удаление файлов, форматирование диска,
 * выключение машины).
 */
const DESTRUCTIVE_STDIO_COMMANDS: ReadonlySet<string> = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'dd',
  'diskpart',
  'format',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'kill',
  'killall',
  'taskkill',
]);

/**
 * Приводит команду к виду для denylist: basename без оболочного расширения.
 *
 * `C:\Windows\System32\cmd.exe` → `cmd`, `/usr/bin/docker` → `docker`,
 * `mkfs.ext4` → `mkfs.ext4` (разбирается префиксом отдельно).
 *
 * @param command - команда из конфигурации сервера
 * @returns нижний регистр basename без `.exe/.com/.cmd/.bat/.ps1`
 */
function stdioCommandBase(command: string): string {
  const trimmed = command.trim();
  const last = trimmed.split(/[\\/]/u).pop() ?? trimmed;

  return last.toLowerCase().replace(/\.(?:exe|com|cmd|bat|ps1)$/u, '');
}

/**
 * Проверяет, что `stdio`-команда не является оболочкой или разрушительной
 * утилитой (DESIGN v0.12 § 3.3.3).
 *
 * Проверка вызывается дважды: при разборе `MCP_SERVERS` на старте (fail-fast,
 * понятная ошибка оператору) и при создании транспорта (защита от конфигурации,
 * подменённой после старта).
 *
 * @param command - исполняемый файл из `MCP_SERVERS`
 * @throws Error если команда запрещена или пуста
 */
export function assertStdioCommandAllowed(command: string): void {
  const base = stdioCommandBase(command);

  if (base.length === 0) {
    throw new Error('stdio: пустая команда в MCP_SERVERS');
  }

  if (
    FORBIDDEN_STDIO_COMMANDS.has(base) ||
    DESTRUCTIVE_STDIO_COMMANDS.has(base) ||
    base.startsWith('mkfs')
  ) {
    throw new Error(
      `stdio: команда '${command}' запрещена — оболочки и разрушительные ` +
        'утилиты в MCP-сервере не поддерживаются (DESIGN § 3.3.3)',
    );
  }
}

/**
 * Zod-схема одного MCP-сервера с HTTP-транспортом (DESIGN § 3.2.1).
 *
 * `tokenEnv` — **имя** переменной окружения с bearer-токеном: сам токен в JSON
 * не попадает и в логи/API не утекает (RULES 5.1/5.2).
 */
const McpHttpServerConfigSchema = z.object({
  /** Транспорт: Streamable HTTP или устаревший SSE. */
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

/** Конфигурация MCP-сервера с HTTP-транспортом. */
export type McpHttpServerConfig = z.infer<typeof McpHttpServerConfigSchema>;

/**
 * Zod-схема одного MCP-сервера с `stdio`-транспортом (v0.12 S4, KI-526).
 *
 * Поля намеренно минимальны: `command` + `args` + `enabled`. `url`,
 * `tokenEnv` и `headers` здесь запрещены (`.strict()`), чтобы конфигурация не
 * смешивала два транспорта и не унесла токен в JSON. `args` — **массив**, а не
 * строка: `shell: true` нигде не включается, поэтому кавычки/пайпы внутри
 * аргумента не интерпретируются (DESIGN § 3.3.3). Оболочки и разрушительные
 * команды отсекаются {@link assertStdioCommandAllowed} при разборе реестра.
 */
const McpStdioServerConfigSchema = z.strictObject({
  /** Транспорт: запуск локального процесса MCP-сервера. */
  transport: z.literal('stdio'),
  /** Исполняемый файл (basename или абсолютный путь); без оболочки. */
  command: z.string().trim().min(1).max(512),
  /** Аргументы процесса (максимум 128 штук по 1024 символа). */
  args: z.array(z.string().max(1024)).max(128).default([]),
  /** Включён ли сервер (default true). Выключенный сервер не подключается. */
  enabled: z.boolean().default(true),
});

/** Конфигурация MCP-сервера с `stdio`-транспортом. */
export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfigSchema>;

/**
 * Zod-схема одного MCP-сервера (DESIGN § 3.2.1, v0.12 S4 § 3.3.1).
 *
 * `discriminatedUnion`, а не «одна схема со всеми опциональными полями»:
 * так `command` обязателен ровно для `stdio`, `url` — ровно для `http`/`sse`,
 * и TypeScript сужает тип в клиенте без ручных проверок на `undefined`.
 */
export const McpServerConfigSchema = z.discriminatedUnion('transport', [
  McpHttpServerConfigSchema,
  McpStdioServerConfigSchema,
]);

/** Валидированная конфигурация одного MCP-сервера. */
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

/**
 * Сужает конфигурацию до `stdio`-сервера.
 *
 * @param config - валидированная конфигурация сервера
 * @returns `true`, если сервер запускается локальным процессом
 */
export function isStdioServerConfig(
  config: McpServerConfig,
): config is McpStdioServerConfig {
  return config.transport === 'stdio';
}

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
 * Опции разбора реестра `MCP_SERVERS`.
 *
 * Вынесены отдельным аргументом, а не читаются из `process.env`: схема должна
 * оставаться чистой функцией (её используют и тесты, и `McpServerRegistry`,
 * который получает флаг из `ConfigService` — RULES 4.6).
 */
export interface ParseMcpServersOptions {
  /**
   * Разрешён ли `stdio`-транспорт (`MCP_ENABLE_STDIO=true`, default false).
   *
   * При `false` сервер с `transport: 'stdio'` — ошибка конфигурации: запуск
   * локального процесса не должен включаться «за компанию» с HTTP-адаптером
   * (DESIGN v0.12 § 3.3.3).
   */
  readonly enableStdio?: boolean;
}

/**
 * Разбирает и валидирует реестр MCP-серверов.
 *
 * Принимает как строку JSON из env (штатный путь), так и уже разобранный
 * объект (удобно в тестах и при повторном использовании конфигурации).
 * Пустая строка трактуется как `{}` (DESIGN § 4.3, KI-084-класс ошибок).
 *
 * @param raw - сырое значение `MCP_SERVERS` (`string`/`object`/`undefined`)
 * @param options - флаги разбора (`enableStdio`, см. {@link ParseMcpServersOptions})
 * @returns валидированный реестр (может быть пустым)
 * @throws Error если строка не является JSON, реестр не соответствует схеме,
 *   есть `stdio`-сервер при `enableStdio !== true` или его команда запрещена
 */
export function parseMcpServersConfig(
  raw: unknown,
  options: ParseMcpServersOptions = {},
): McpServersConfig {
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

  const stdioServers = Object.entries(result.data).filter(([, config]) =>
    isStdioServerConfig(config),
  );

  if (stdioServers.length === 0) {
    return result.data;
  }

  if (options.enableStdio !== true) {
    // Fail-fast, а не «пропустить сервер»: оператор явно описал stdio-сервер,
    // и молча его игнорировать — хуже, чем сказать, что флаг выключен.
    throw new Error(
      `MCP_SERVERS: stdio-транспорт запрещён (серверы: ${stdioServers
        .map(([name]) => name)
        .join(', ')}) — включите MCP_ENABLE_STDIO=true (DESIGN § 3.3.1)`,
    );
  }

  for (const [, config] of Object.entries(result.data)) {
    if (isStdioServerConfig(config)) {
      assertStdioCommandAllowed(config.command);
    }
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
