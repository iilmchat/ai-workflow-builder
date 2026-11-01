# DESIGN v0.13 — MCP Hardening & UI Polish

**Файл:** `docs/development/v0.13/DESIGN_V013_FEATURES.md`
**Версия:** 1.0 (2026-11-02)
**Статус:** Approved
**Закрывает:** KI-529, KI-530, KI-531, KI-532

## 1. Контекст

После релиза v0.12.0 (PDF, MCP stdio, SafeHttpClient Binary) осталось 4 технических долга (Low/Medium), связанных с MCP stdio и UI.

## 2. Что делаем

1. **KI-529 (Medium): Env для stdio.** Разрешить передавать безопасные env-переменные (токены) в дочерний процесс.
2. **KI-530 (Medium): Изоляция stdio.** Запускать процесс в изолированной папке (`./data/mcp/{serverName}`) и ограничить права.
3. **KI-531 (Low): UI-бейдж.** Показать в `AgentNode` бейдж `LOCAL`, если сервер использует `stdio`.
4. **KI-532 (Low): isPidAlive.** Различать `ESRCH` (мертв) и `EPERM` (жив, но нет прав).

## 3. Технические срезы

### 3.1 MCP stdio Env Allowlist (KI-529)
- Env: `MCP_STDIO_ENV_ALLOWLIST="GITHUB_TOKEN,OPENAI_API_KEY"` (через запятую).
- В `McpStdioServerConfigSchema` добавить поле `env?: Record<string, string>`.
- В `mcp-client.service.ts` при создании `StdioClientTransport` передавать `env: { ...process.env, ...config.env }`, но **только** ключи из allowlist.

### 3.2 MCP stdio Isolation (KI-530)
- Env: `MCP_STDIO_CWD="./data/mcp"` (default). Создавать папку `{MCP_STDIO_CWD}/{serverName}`, если её нет.
- В `StdioClientTransport` передавать `cwd: join(MCP_STDIO_CWD, serverName)`.
- Добавить WARN в лог, если `MCP_ENABLE_STDIO=true` и `command !== 'docker'` (рекомендовать Docker).

### 3.3 UI Badge (KI-531)
- В `AgentNode.tsx` в списке серверов добавить бейдж `LOCAL` (i18n `node.agent.mcp.transport.stdio`), если `transport === 'stdio'`.

### 3.4 isPidAlive EPERM (KI-532)
- В `mcp-client.service.ts` изменить `isPidAlive`: ловить ошибку `kill(pid, 0)`. Если `code === 'ESRCH'` — false (мертв). Если `code === 'EPERM'` — true (жив, но нельзя убить). Иначе — false.

## 4. Совместимость
- Старые конфиги (без `env`, с абсолютными путями) продолжат работать.

## 5. План работ
- S1: MCP stdio (env, isolation, isPidAlive) + UI Badge + тесты.
- S2: Релиз v0.13.0 (docs, CHANGELOG, тег).
