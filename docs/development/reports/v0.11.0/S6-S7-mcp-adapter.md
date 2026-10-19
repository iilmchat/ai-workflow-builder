---
title: "S6+S7: MCP Adapter Core & Agent Integration"
date: 2026-10-19
version: v0.11.0
steps: [S6, S7]
status: accepted
related_ki: [KI-483]
related_adr: []
---

# Отчёт S6+S7 — MCP Adapter Core & Agent Integration

> **Статус артефакта.** Отчёт сгенерирован по итогам сессии dsh S6+S7.
> Пакет впоследствии закоммичен Lead'ом отдельно (`31e35d0 feat(v0.11.0):
> S2+S3 & S6+S7 — Document Core/API and MCP Adapter`); сам dsh коммитов не
> делал и `git add` не использовал.

**Ветка:** `main` · **HEAD на момент сессии:** `6c8577a` (v0.11 S0+S1)
**Правила:** RULES v1.10.0 · **Источник:** DESIGN v0.11 § 3.2, § 3.3.2, § 4.4, § 5 (S6, S7)

## 1. Файлы (+/−)

**Новые — `src/mcp/`:**

| Файл | Строк | Назначение |
|---|---:|---|
| [mcp.types.ts](../../../../src/mcp/mcp.types.ts) | +115 | константы/типы (`MCP_SERVER_NAME`, лимиты, `McpToolRef`, `McpToolDescriptor`, `McpToolAnnotations`) |
| [mcp.errors.ts](../../../../src/mcp/mcp.errors.ts) | +134 | `McpDisabled`, `McpConfiguration`, `McpUnavailable`, `McpToolNotFound`, `McpToolCall` |
| [mcp.config.ts](../../../../src/mcp/mcp.config.ts) | +184 | Zod-схемы `McpServerConfigSchema`/`McpServersSchema`, парсинг `MCP_SERVERS`, чтение env с границами |
| [mcp-server.registry.ts](../../../../src/mcp/mcp-server.registry.ts) | +147 | реестр «имя → конфигурация», fail-fast/warn-политика, `hasServer`-основа |
| [mcp-client.service.ts](../../../../src/mcp/mcp-client.service.ts) | +787 | connect-mutex, HTTP/SSE-транспорты, каталог с пагинацией/TTL/лимитом, `list_changed`, reconnect, таймауты, shutdown, `prepareAsync`/`listToolsAsync`/`callToolAsync` |
| [mcp-tool.adapter.ts](../../../../src/mcp/mcp-tool.adapter.ts) | +300 | `buildMcpToolName` (+sha256-хвост), JSON Schema → Zod, `normalizeToolResult`, `createAgentTool` |
| [mcp.module.ts](../../../../src/mcp/mcp.module.ts) | +19 | Nest-модуль, экспорт клиента/реестра/адаптера (контроллер — S8) |

**Новые тесты:**

| Файл | Строк | Покрытие |
|---|---:|---|
| [mcp.config.spec.ts](../../../../src/mcp/mcp.config.spec.ts) | +151 | JSON/пустая строка/битый JSON/имена/URL/`tokenEnv`, чтение env |
| [mcp-client.service.spec.ts](../../../../src/mcp/mcp-client.service.spec.ts) | +575 | connect-mutex, пагинация, TTL, `list_changed`, reconnect после `onclose` и после сбоя вызова, таймауты, `tokenEnv`, disabled/unknown, shutdown, реестр |
| [mcp-tool.adapter.spec.ts](../../../../src/mcp/mcp-tool.adapter.spec.ts) | +269 | имя >64/коллизии, fallback Zod, `isError`, image/audio/resource, truncate, валидация аргументов |

**Изменённые (наш вклад):**

| Файл | +/− | Что |
|---|---:|---|
| [agent.types.ts](../../../../src/agent/agent.types.ts) | +59/−4 | `AgentTool.name: string` + MCP-hints, `AgentNodeData.mcpTools`, `AgentRunException` |
| [agent.service.ts](../../../../src/agent/agent.service.ts) | +401/−159 | preflight, `resolveToolsAsync`, MCP-описания в промпте, untrusted-правило, `isSideEffectingTool`, retry-guard |
| [agent.service.spec.ts](../../../../src/agent/agent.service.spec.ts) | +336/−10 | MCP-only узел, preflight fail без LLM, side-effect → non-retryable, read-only → retry, normalize, классификатор |
| [agent.integration.spec.ts](../../../../src/agent/agent.integration.spec.ts) | +17/−3 | моки MCP-границ |
| [node-executors.ts](../../../../src/engine/node-executors.ts) | +99/−67 | схема `agent`: `mcpTools`, `tools` default `[]`, superRefine (часть diff — Task A: перенос ошибок в `errors.ts`) |
| [agent-node-executor.spec.ts](../../../../src/engine/agent-node-executor.spec.ts) | +50/−3 | MCP-only узел валиден, дубли MCP-инструментов отвергаются, `mcpTools: []` в ожидании |
| [runs.module.ts](../../../../src/runs/runs.module.ts) | +4/−0 | импорт `McpModule` |
| [package.json](../../../../package.json) | +4/−0 | `@modelcontextprotocol/sdk ^1.32.1` (+3 строки Task A) |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | +196/−0 | SDK 1.32.1 + зависимости Task A |

Smoke-артефакт: `.smoke/mcp-smoke.mjs` (~190 строк, `.smoke/` в `.gitignore`).

## 2. Build / test

`pnpm build` 0/0 · `pnpm typecheck` 0 · `pnpm test` **1330 passed / 18 skipped (95 files: 92 passed, 3 skipped)** · `pnpm lint` **0 warnings / 0 errors**.

## 3. Диагностика

- `pnpm add @modelcontextprotocol/sdk@^1.32.1` → установлен **1.32.1**, lock обновлён; supply-chain policy пройдена.
- Сверены реальные типы SDK: `listChanged.tools.onChanged(error, items)`, `RequestOptions.timeout`, `redirectPolicy: 'same-origin'`, `McpServer.registerTool` — API совпадает с DESIGN § 3.2.3.
- `callTool()` в SDK возвращает union `CallToolResult | CompatibilityCallToolResult`; добавлена runtime-проверка `content[]` и `McpToolCallException` на неподдерживаемую compatibility-форму (RULES 1.17).
- `AgentTool.name` стал `string` → `readLlmCallUsage(toolName: AgentToolName)` пришлось расширить до `string` (иначе `TS2345`).
- Task A в это время перенёс `NodeDataValidationException` из `node-executors.ts` в `engine/errors.ts`; импортирую класс из `errors.js` (лёгкая зависимость, без цикла).
- Из-за `.default([])` в схеме `agent` парсинг теперь добавляет `mcpTools: []` — обновлён `agent-node-executor.spec.ts` (точное сравнение аргументов `runAgentAsync`).
- При shutdown SDK штатно рвёт SSE-поток (`AbortError`) — WARN понижены до DEBUG при `shuttingDown`, чтобы не шуметь в логах остановки.
- В тестах адаптера `MCP_MAX_RESULT_CHARS` зажимается нижней границей env (500) — ожидание теста приведено к валидному env-диапазону.
- Найден off-by-one в DESIGN § 3.2.4 (см. § 6).

## 4. Smoke

### 4.1 Реальный mock-MCP (Streamable HTTP) → наш клиент

Поднят настоящий `McpServer` SDK на loopback со StreamableHTTP-транспортом, к нему подключён **собранный** `dist/mcp/*` (не моки): preflight, каталог, `AgentTool`, вызов, ошибки, shutdown.

```json
{
  "steps": ["connect+preflight: ok, tools=3", "shutdown: ok"],
  "tools": [
    { "name": "read_file",  "annotations": { "readOnlyHint": true, "idempotentHint": true } },
    { "name": "write_file", "annotations": { "destructiveHint": true } },
    { "name": "fail",       "annotations": null }
  ],
  "toolName": "mcp__mock__read_file",
  "toolDescription": "MCP-инструмент сервера 'mock': Reads a file from the mock workspace",
  "readOnlySideEffect": false,
  "writeSideEffect": true,
  "result": "mock content of hello.txt",
  "validationError": { "name": "McpToolCallException", "message": "Некорректные аргументы MCP-инструмента 'mcp__mock__read_file': ... expected string, received undefined" },
  "toolError": { "name": "McpToolCallException", "message": "mock tool failure" },
  "catalogAfterInvalidate": 3,
  "disabledError": { "name": "McpDisabledException", "message": "MCP-адаптер отключён: MCP_ENABLED=false. Включите MCP и задайте MCP_SERVERS, чтобы использовать MCP-инструменты" }
}
```

Это подтверждает: connect + каталог, префикс имён, hints→retry-политика, `isError` как tool-ошибка, truncate/валидация, инвалидация каталога, shutdown, disabled-путь.

### 4.2 Локальный запуск приложения без `MCP_SERVERS`

`$env:PORT=3999; node --env-file=.env dist/main` (`.env` без MCP-переменных → дефолты `MCP_ENABLED=false`, `MCP_SERVERS={}`):

```text
[InstanceLoader] McpModule dependencies initialized +3ms
...
[NestApplication] Nest application successfully started +1ms
```

Ни одного WARN/ERROR от MCP, `GET /auth/me` → **401** (API жив, JWT-гард работает), процесс остановлен, порт 3999 освобождён. Падения без MCP-конфигурации нет.

## 5. Что не так

1. **DESIGN § 3.2.4 содержит off-by-one**: `slice(0, 64 - 9) + '__' + 8 hex` = **65** символов при заявленном лимите 64. Реализован контракт лимита (54 + 10 = 64), отклонение зафиксировано как KI (см. § 6).
2. **Docs на момент генерации отчёта не обновлялись**: `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `docs/development/v0.11/DESIGN_V011_FEATURES.md` правились параллельным Task A; записи для docs приведены в § 6 и должны вноситься отдельным docs-шагом (RULES 2.1/3.17/2.18).
3. **`GET /mcp/servers`, UI узла, i18n** — вне scope S6/S7 (S8), поэтому `api-prefixes.json`/`app.module.ts` не менял.
4. **Compatibility-форма ответа `tools/call`** (`{ toolResult }`) не поддержана: это ответ старого/нестандартного сервера, нормализовать его в текст нельзя — вызов падает `McpToolCallException` с понятным текстом. Для штатного SDK-пути не проявляется.
5. **SSE-транспорт проверен только unit-тестом** (фейковый транспорт); end-to-end smoke был по Streamable HTTP. TLS/боевой SSE-сервер не поднимался.
6. **Токен в smoke не проверялся end-to-end** (только unit: `Authorization: Bearer`, отсутствие `tokenEnv` → `McpConfigurationException`).
7. **Preflight MCP не ретраится**: недоступный сервер → узел `failed` сразу (так задумано DESIGN § 3.2.5), transient-сбой MCP-сервера не лечится повтором узла.
8. **`MCP_MAX_TOOLS_PER_NODE` < 20 проверяется только на запуске**: узел можно сохранить с 20 MCP-инструментами при env-лимите 5 — запуск упадёт `NodeDataValidationException` (by design; S8-UI будет ограничивать по `maxToolsPerNode` из API).
9. **Классификация MCP side-effect доверяет аннотациям сервера**: «злой»/некорректный сервер может поставить `readOnlyHint: true` на пишущий инструмент и обойти retry-guard. Это задокументированная модель доверия (DESIGN § 3.2.8: MCP-сервер — доверенный компонент, изоляция на уровне контейнера/прав).
10. **Заголовки `headers` в конфиге** валидируются только как строки ≤512; невалидное имя заголовка проявится как ошибка connect, а не как ошибка старта.
11. Вокруг файлов пакета в `git status` лежали незакоммиченные правки Task A — при коммите нужно разделять пакеты (selective add по файлам), `git add -A` запрещён.

## 6. Новые KI

**KI-483 — DESIGN § 3.2.4: формула имени MCP-инструмента даёт 65 символов при лимите 64 (Low, Fixed в v0.11.0 S7).**

- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.11.0 (S7) — `buildMcpToolName` использует `MCP_AGENT_TOOL_NAME_MAX - 10`; тест фиксирует длину 64 и несовпадение двух длинных имён.
- **Файлы:** `src/mcp/mcp-tool.adapter.ts`, `src/mcp/mcp-tool.adapter.spec.ts`
- **Описание:** псевдокод `raw.slice(0, MCP_AGENT_TOOL_NAME_MAX - 9) + '__' + sha256[0..8]` даёт 55 + 2 + 8 = 65 символов, то есть превышает объявленный лимит имени инструмента в протоколе агента на 1 символ; на части провайдеров/валидаторов это может отклонить вызов.
- **Решение:** префикс обрезается до 54 символов (54 + 2 + 8 = 64); sha256-хвост сохранён, коллизии маловероятны (2⁻³² на пару), уникальность сервер+инструмент сохраняется.
- **Связанные:** DESIGN v0.11 § 3.2.4, v0.11 S7.

Других дефектов не выявлено; наблюдения из § 5 — by design/out of scope, не KI.

## 7. Обоснование решений

- **Разделение registry/client/adapter.** Реестр не ходит в сеть (только env-конфигурация, fail-fast), клиент владеет жизненным циклом соединений, адаптер — единственное место, знающее протокол MCP (`mcp__`, JSON Schema, `content[]`). `AgentService` работает с обычными `AgentTool`.
- **Connect-mutex + отдельный mutex загрузки каталога.** Параллельные узлы не создают N соединений и N пагинаций; второй ждёт тот же Promise. Это прямо требует DESIGN § 3.2.3.
- **Реконнект не только по `onclose`/`onerror`.** Добавлен сброс соединения при любом throw из `callTool`/`listTools`: SDK не всегда зовёт `onclose` на таймауте/сбросе сокета, иначе клиент мог бы «навсегда» остаться в мёртвом состоянии. Это дословно реализует «транспортный сбой одного вызова не убивает клиент навсегда».
- **`listChanged` с `autoRefresh: false`.** Не хотим скрытого повторного `tools/list` внутри обработчика уведомления; инвалидируем кэш и обновляем лениво на следующем вызове.
- **Токен читается по имени `tokenEnv` в момент connect.** В `MCP_SERVERS` и логах секрета нет (RULES 5.1/5.2); отсутствие переменной — `McpConfigurationException` только этого сервера, а не падение приложения.
- **Приватные URL разрешены, `SafeHttpClient` не используется.** MCP-серверы — операторская доверенная конфигурация (часто внутренняя Docker-сеть); защита — allowlist env + `redirectPolicy: 'same-origin'` + URL только из env (DESIGN § 3.2.3, § 3.2.8).
- **Preflight до первого LLM-вызова.** Платить за цикл, который не сможет вызвать запрошенный инструмент, нельзя; неизвестный сервер дополнительно отсекается как `NodeDataValidationException` до подключения. Выключенный MCP даёт `McpDisabledException` с инструкцией.
- **Retry-guard.** Побочный эффект фиксируется **до** вызова (консервативно: даже упавший посреди POST не должен повторяться). Retryable `LlmProviderException` пробрасывается только если эффектов не было; `AgentIterationLimitException`/`BudgetExceededException` сохраняют прежний контракт (их не оборачиваю, чтобы не сломать движок/тесты); остальное — non-retryable `AgentRunException`.
- **Классификация нативных инструментов** соответствует таблице DESIGN § 3.3.2; MCP — `readOnlyHint` → чтение, `idempotentHint && !destructiveHint` → условно чтение, без аннотаций → побочный эффект.
- **Имя инструмента**: формат `mcp__<server>__<tool>`; лимит 64 соблюдён ценой отступления от псевдокода (KI-483). Описание MCP схлопывается в одну строку и обрезается до 500 символов; в системный промпт добавляется правило про недоверенный контент — только для узлов с MCP, чтобы не менять промпт нативных агентов.
- **JSON Schema → Zod** через `z.fromJSONSchema` с fallback на `z.record(...)`: экзотическая схема сервера не должна делать узел незапускаемым, а аргументы от модели всё равно валидируются на границе (RULES 1.17).
- **Результат**: `structuredContent` предпочтительнее текста; image/audio/resource → `[type omitted]` (в текстовом протоколе агента vision нет); всё обрезается `MCP_MAX_RESULT_CHARS`; `isError` — tool-ошибка в транскрипт, а не падение узла (модель меняет стратегию).
- **Схема узла**: `tools` default `[]` + `mcpTools` default `[]`, проверка «сумма ≥ 1», дублей нативных и пар «сервер+инструмент», жёсткий потолок 20.
- **Тесты**: SDK замокан (никакой сети), плюс отдельный smoke с настоящим SDK-сервером — покрывают и наш код, и совместимость с реальным протоколом.

## Коммит-сообщение пакета

Предложено в сессии (фактически пакет закоммичен Lead'ом в `31e35d0` вместе с S2+S3):

```text
feat(v0.11.0): S6+S7 — MCP Adapter Core and Agent Integration

- MCP core (src/mcp): Zod-схемы MCP_SERVERS, реестр серверов,
  McpClientService (connect-mutex, Streamable HTTP/SSE, каталог с
  пагинацией и TTL, tools/list_changed, reconnect, таймауты,
  OnApplicationShutdown), ошибки MCP.
- MCP agent integration: McpToolAdapter (mcp__server__tool с sha256-
  хвостом, JSON Schema → Zod, нормализация content/structuredContent),
  preflight в AgentService до первого LLM-вызова, MCP-only узлы,
  системное правило про недоверенный контент, side-effect retry-guard
  (AgentRunException, non-retryable), readOnly/idempotent-аннотации.
- AgentNodeData.mcpTools, AgentTool.name → string, Zod-схема узла agent
  (tools/mcpTools, лимит 20, дубли).
- Зависимость @modelcontextprotocol/sdk ^1.32.1.
- Тесты: config/client/adapter + MCP-сценарии AgentService; smoke с
  реальным mock-MCP.

Refs: DESIGN v0.11 § 3.2, § 3.3.2, § 4.4, § 5 (S6, S7)
```
