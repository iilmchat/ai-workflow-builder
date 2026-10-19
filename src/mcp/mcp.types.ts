/**
 * Общие типы и константы MCP-адаптера (v0.11 S6, DESIGN § 3.2).
 *
 * Здесь нет ни одного runtime-импорта из SDK: модуль импортируют и агент
 * (`agent.types.ts`), и Zod-схема узла (`node-executors.ts`), и тесты. SDK
 * подключается только в `mcp-client.service.ts`, чтобы типы/константы можно
 * было использовать без поднятия клиента.
 */

/**
 * Допустимое имя MCP-сервера (DESIGN § 3.2.1).
 *
 * Ограничение lowercase + цифры/`_`/`-` нужно не для красоты: имя сервера
 * становится частью имени инструмента (`mcp__<server>__<tool>`), а имена
 * инструментов в протоколе агента — плоские строки без пробелов и заглавных
 * букв (так их ожидают модели и провайдеры).
 */
export const MCP_SERVER_NAME = /^[a-z][a-z0-9_-]{0,23}$/;

/**
 * Имя env-переменной с bearer-токеном сервера.
 *
 * В JSON `MCP_SERVERS` хранится **имя** переменной, а не её значение:
 * реестр серверов попадает в конфиг-дампы и логи, секрет должен жить
 * отдельно (RULES 5.1/5.2, DESIGN § 3.2.1).
 */
export const MCP_TOKEN_ENV_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Максимальная длина имени MCP-инструмента в протоколе агента (DESIGN § 3.2.4). */
export const MCP_AGENT_TOOL_NAME_MAX = 64;

/** Максимум символов описания MCP-инструмента в системном промпте (DESIGN § 3.2.5). */
export const MCP_TOOL_DESCRIPTION_MAX = 500;

/**
 * Жёсткий потолок MCP-инструментов на один agent-узел (DESIGN § 3.2.5).
 *
 * Zod-схема узла не читает `ConfigService`, поэтому использует константу;
 * env `MCP_MAX_TOOLS_PER_NODE` может быть меньше, но не больше (валидация на
 * старте). Runtime-проверка меньшего значения — в `AgentService`.
 */
export const MCP_MAX_TOOLS_PER_NODE_LIMIT = 20;

/** Максимум страниц каталога при пагинации (защита от зацикленного сервера). */
export const MCP_CATALOG_MAX_PAGES = 50;

/** Значение по умолчанию для лимита инструментов одного сервера. */
export const MCP_MAX_TOOLS_PER_SERVER_DEFAULT = 200;

/** Значение по умолчанию для максимума символов результата инструмента. */
export const MCP_MAX_RESULT_CHARS_DEFAULT = 4_000;

/** Значение по умолчанию TTL каталога, мс. */
export const MCP_CATALOG_TTL_MS_DEFAULT = 60_000;

/** Значение по умолчанию таймаута подключения, мс. */
export const MCP_CONNECT_TIMEOUT_MS_DEFAULT = 10_000;

/** Значение по умолчанию таймаута MCP-вызова, мс. */
export const MCP_REQUEST_TIMEOUT_MS_DEFAULT = 30_000;

/** Версия клиента в `Implementation` MCP (RULES 1.11: версия из окружения). */
export const MCP_CLIENT_VERSION = process.env.npm_package_version ?? '0.0.0';

/** Имя клиента в `Implementation` MCP. */
export const MCP_CLIENT_NAME = 'workflow-builder';

/** Транспорт MCP-сервера: Streamable HTTP или устаревший SSE (DESIGN § 3.2.1). */
export type McpTransportKind = 'http' | 'sse';

/** Ссылка узла на MCP-инструмент: имя сервера + имя инструмента (DESIGN § 3.2.5). */
export interface McpToolRef {
  /** Имя сервера из операторского env-реестра `MCP_SERVERS`. */
  readonly server: string;
  /** Имя инструмента в каталоге сервера. */
  readonly tool: string;
}

/**
 * Аннотации MCP-инструмента (DESIGN § 3.2.4, § 3.3.2).
 *
 * Это **подсказки** сервера, а не гарантии: используются только для
 * retry-политики и UI-бейджей, решение о вызове принимает модель.
 */
export interface McpToolAnnotations {
  /** Человекочитаемый заголовок инструмента. */
  readonly title?: string;
  /** Инструмент только читает данные (side effect отсутствует). */
  readonly readOnlyHint?: boolean;
  /** Инструмент может изменять внешние данные. */
  readonly destructiveHint?: boolean;
  /** Повторный вызов с теми же аргументами идемпотентен. */
  readonly idempotentHint?: boolean;
  /** Инструмент работает с внешним миром (открытый набор ресурсов). */
  readonly openWorldHint?: boolean;
}

/**
 * Нормализованное описание MCP-инструмента из `tools/list`.
 *
 * `inputSchema` остаётся `unknown`: JSON Schema — внешние данные, и её
 * преобразование в Zod живёт в `mcp-tool.adapter.ts` (RULES 1.17).
 */
export interface McpToolDescriptor {
  /** Имя инструмента на сервере (то, что уходит в `tools/call`). */
  readonly name: string;
  /** Заголовок для UI (если сервер его отдал). */
  readonly title?: string;
  /** Описание для системного промпта и UI. */
  readonly description?: string;
  /** JSON Schema аргументов инструмента. */
  readonly inputSchema: unknown;
  /** Аннотации сервера (readOnly/destructive/idempotent). */
  readonly annotations?: McpToolAnnotations;
}
