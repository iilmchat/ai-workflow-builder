/**
 * DTO ответа `GET /mcp/servers` (v0.11 S8, DESIGN § 3.2.6).
 *
 * Zod-схемы, а не TS-интерфейсы: ответ уходит в UI, и его форма должна
 * проверяться на backend-границе (RULES 1.17). Кроме того, паритет-гейт
 * `src/runs/dto/api-contract.spec.ts` читает состав полей из `shape` схемы,
 * поэтому REST-контракт не может разъехаться с `docs/development/api-contract.json`
 * молча (KI-352).
 *
 * **Секреты в DTO отсутствуют по построению.** Здесь нет ни `url`, ни
 * `headers`, ни `tokenEnv`: DESIGN § 3.2.6 и RULES 5.1 запрещают отдавать
 * URL/заголовки/токены в API. Схема — единственное место, где форма ответа
 * описана, поэтому «добавить URL для удобства» нельзя, не сломав паритет-гейт.
 */
import { z } from 'zod';

/**
 * Аннотации инструмента для UI-бейджей (DESIGN § 3.2.7).
 *
 * Это те же подсказки сервера, что использует retry-политика агента, но
 * `inputSchema` в ответ API не попадает: UI не собирает аргументы, а размер
 * ответа с JSON Schema десятков инструментов был бы неоправданно большим.
 */
export const McpToolSummarySchema = z.object({
  /** Имя инструмента на сервере (то, что уходит в `tools/call`). */
  name: z.string(),
  /** Заголовок для UI, если сервер его отдал. */
  title: z.string().optional(),
  /** Описание инструмента (может быть длинным — UI обрезает сам). */
  description: z.string().optional(),
  /** Инструмент только читает данные (`RO`). */
  readOnlyHint: z.boolean().optional(),
  /** Инструмент может изменять внешние данные (`DESTR`). */
  destructiveHint: z.boolean().optional(),
  /** Повторный вызов идемпотентен (`IDEM`). */
  idempotentHint: z.boolean().optional(),
});

/** Инструмент MCP-сервера в ответе API. */
export type McpToolSummary = z.infer<typeof McpToolSummarySchema>;

/**
 * Статус сервера в ответе API.
 *
 * - `ok` — каталог получен (возможно, пустой);
 * - `error` — подключиться/получить каталог не удалось (узел при этом
 *   сохраняется — запуск упадёт preflight'ом с понятным текстом);
 * - `disabled` — сервер выключен в `MCP_SERVERS` (`enabled=false`) и не
 *   подключается.
 */
export const McpServerStatusSchema = z.enum(['ok', 'error', 'disabled']);

/** Статус MCP-сервера. */
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

/** Транспорт MCP-сервера (`http` — Streamable HTTP, `sse` — устаревший SSE). */
export const McpTransportSchema = z.enum(['http', 'sse']);

/** Транспорт MCP-сервера. */
export type McpTransport = z.infer<typeof McpTransportSchema>;

/**
 * Сервер в ответе `GET /mcp/servers`.
 *
 * `error` — безопасный текст без URL/заголовков/токенов: причина подключения
 * может содержать host из `ECONNREFUSED`, поэтому детали остаются в
 * server-side логах, а в API уходит обобщённое сообщение (DESIGN § 3.2.6,
 * RULES 5.1).
 */
export const McpServerSummarySchema = z.object({
  /** Имя сервера из операторского реестра `MCP_SERVERS`. */
  name: z.string(),
  /** Транспорт сервера. */
  transport: McpTransportSchema,
  /** Статус подключения/каталога. */
  status: McpServerStatusSchema,
  /** Безопасный текст ошибки; только при `status: 'error'`. */
  error: z.string().optional(),
  /** Инструменты сервера; при `error`/`disabled` — пустой массив. */
  tools: z.array(McpToolSummarySchema),
});

/** MCP-сервер в ответе API. */
export type McpServerSummary = z.infer<typeof McpServerSummarySchema>;

/**
 * Ответ `GET /mcp/servers` (DESIGN § 3.2.6).
 *
 * При `MCP_ENABLED=false` возвращается `{ enabled: false, maxToolsPerNode,
 * servers: [] }` со статусом 200: выключенная фича — не ошибка, UI просто не
 * рисует секцию MCP-инструментов.
 */
export const McpServersResponseSchema = z.object({
  /** Включён ли MCP-адаптер (`MCP_ENABLED`). */
  enabled: z.boolean(),
  /** Действующий лимит инструментов на узел (env может быть меньше потолка 20). */
  maxToolsPerNode: z.number().int(),
  /** Серверы реестра в порядке объявления в `MCP_SERVERS`. */
  servers: z.array(McpServerSummarySchema),
});

/** Ответ `GET /mcp/servers`. */
export type McpServersResponse = z.infer<typeof McpServersResponseSchema>;
