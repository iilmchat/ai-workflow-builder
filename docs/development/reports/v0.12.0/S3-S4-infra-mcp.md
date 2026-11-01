---
title: "S3+S4: SafeHttpClient Binary (KI-525) + MCP stdio Transport (KI-526)"
date: 2026-11-02
version: v0.12.0
steps: [S3, S4]
status: accepted
related_ki: [KI-525, KI-526, KI-528, KI-529, KI-530, KI-531, KI-532]
related_adr: []
---

# Отчёт S3+S4 — SafeHttpClient Binary & MCP stdio

**Статус:** реализовано; код лежит в рабочем дереве, коммитов в этой сессии нет
(`git add -A` не использовался, `git add` не вызывался вовсе). `pnpm build` —
**0 errors / 0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **102 файла
passed / 3 skipped, 1472 passed / 18 skipped**, `pnpm lint` — **0 errors /
2 warnings** (оба — преэкзистующие на HEAD, см. § 5.1). Smoke: **10/10** на
локальном HTTP-сервере и **7/7** на mock-MCP через `stdio`.

**Точка старта.** HEAD `bc7f89a` («docs: create DESIGN v0.12 …»), версия
`0.11.1`, последний KI-реестра на входе — KI-525 (DESIGN v0.12 § 1.1).
В рабочем дереве с 01:26 параллельно работала **сессия S1+S2 (PDF)**: она
меняла `src/documents/**`, `src/engine/**`, `package.json`/`pnpm-lock.yaml`,
`nest-cli.json`, `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`,
`docs/development/reports/README.md`, `web/src/i18n/**` и завела **KI-527**
(PDF-таблицы). S3+S4 эти файлы **не трогал** (кроме одной строки в
`reports/README.md`, см. § 1); из-за параллельной сессии дважды были
транзиентные падения `typecheck`/`build` — подробности и доказательства в § 3.1.

---

## 1. Файлы (+/−)

### 1.1 Backend — S3 (SafeHttpClient Binary, KI-525)

| Файл | +/− | Что |
|---|---:|---|
| [src/common/http/safe-http.client.ts](../../../../src/common/http/safe-http.client.ts) | +161/−12 | Общий приватный `executeAsync` (адрес → pinned `Agent` → редиректы → лимит), `fetchAsync` стал обёрткой над ним; новый `fetchBufferAsync` (`SafeHttpBufferResponse`); `readBodyLimitedAsync` → `readBufferLimitedAsync` (байты, не строка); `discardBodyAsync` — гасит `RequestAbortedError` от `undici` (KI-528); `DiscardableBody` |
| [src/common/http/safe-http.client.spec.ts](../../../../src/common/http/safe-http.client.spec.ts) | +199/−0 | +10 тестов: 256 байт байт-в-байт, `Content-Type`/его отсутствие, 4xx как данные, лимит и «ровно по лимиту», SSRF (3 адреса), безопасный/запрещённый редирект, `maxRedirects: 0`, регресс `discardBodyAsync` |
| [src/media/providers/openai-images.provider.ts](../../../../src/media/providers/openai-images.provider.ts) | +86/−46 | `httpClient` в конструкторе; `downloadToolImageAsync` через `fetchBufferAsync` (`maxRedirects: 0`, `maxResponseBytes` 25 МБ, маппинг `ResponseTooLarge`/`SsrfBlocked`/таймаута); удалён ранний `Content-Length`-чек (лимит теперь на потоке) |
| [src/media/providers/provider-http.ts](../../../../src/media/providers/provider-http.ts) | +74/−15 | `buildHttpErrorFromBody` (status+headers+текст) и общий `buildHttpErrorStatus`; `buildHttpErrorAsync`/`readErrorTextAsync` переписаны на них — `retryable`/`Retry-After` одинаковы для `fetch`- и `Buffer`-путей |
| [src/media/providers/openai-images.provider.spec.ts](../../../../src/media/providers/openai-images.provider.spec.ts) | +215/−51 | Заглушка `SafeHttpClient` (`stubHttpClient`), проверка контракта вызова (URL/method/Accept/30 с/`maxRedirects: 0`/25 МБ), 404 через `buildHttpErrorFromBody`, +3 теста маппинга ошибок клиента |
| [src/media/providers/openai-images.integration.spec.ts](../../../../src/media/providers/openai-images.integration.spec.ts) | +9/−5 | Конструктор с `new SafeHttpClient()` (3 места) |
| [src/media/media.module.ts](../../../../src/media/media.module.ts) | +7/−0 | Провайдер `SafeHttpClient` для `OpenAiImagesProvider` |

### 1.2 Backend — S4 (MCP stdio, KI-526)

| Файл | +/− | Что |
|---|---:|---|
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +21/−0 | `MCP_ENABLE_STDIO` — strict enum `'true'/'false'` → boolean, default `false` (RULES 4.35); JSDoc о RCE-природе флага |
| [src/mcp/mcp.config.ts](../../../../src/mcp/mcp.config.ts) | +198/−5 | `discriminatedUnion('transport', …)`; `McpStdioServerConfigSchema` (`strictObject`: `command`, `args`, `enabled`); `isStdioServerConfig`; `assertStdioCommandAllowed` + denylist (оболочки, `rm/mkfs/format/…`); `parseMcpServersConfig(raw, { enableStdio })` — fail-fast и denylist на старте |
| [src/mcp/mcp-server.registry.ts](../../../../src/mcp/mcp-server.registry.ts) | +15/−3 | Читает `MCP_ENABLE_STDIO` и передаёт в разбор; лог «stdio разрешён/выключен» |
| [src/mcp/mcp-client.service.ts](../../../../src/mcp/mcp-client.service.ts) | +278/−9 | `StdioClientTransport` (`command`/`args`, `stderr: 'pipe'`, без shell); `stdioPid` в состоянии; stderr → Pino (построчно, обрезка 512 симв., уровень `debug`); shutdown: `SIGTERM` → `client.close()` → `SIGKILL` выжившим с проверкой `kill(pid, 0)`; `McpConfigurationException` при `MCP_ENABLE_STDIO=false` и на denylist (повторная проверка) |
| [src/mcp/mcp.types.ts](../../../../src/mcp/mcp.types.ts) | +2/−2 | `McpTransportKind` += `'stdio'` |
| [src/mcp/dto/mcp-servers.dto.ts](../../../../src/mcp/dto/mcp-servers.dto.ts) | +8/−2 | `McpTransportSchema` += `'stdio'` (иначе `GET /mcp/servers` падал бы на stdio-сервере при `Zod.parse`) |
| [.env.example](../../../../.env.example) | +12/−4 | `MCP_ENABLE_STDIO=false`, пример stdio-сервера, предупреждение о RCE и denylist |
| [docs/development/api-contract.json](../../../development/api-contract.json) | +1/−1 | enum `McpServerSummary.transport`: `["http","sse","stdio"]` |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +7/−2 | Зеркало enum'а для web-гейта паритета (см. § 3.6) |

### 1.3 Тесты S4

| Файл | +/− | Что |
|---|---:|---|
| [src/mcp/mcp.config.spec.ts](../../../../src/mcp/mcp.config.spec.ts) | +142/−4 | +6 тестов stdio: валидный конфиг/`args` default, `command` обязателен, `url`/`tokenEnv` запрещены, гейт по флагу, denylist (15 команд), «args — только массив», `assertStdioCommandAllowed` |
| [src/mcp/mcp-client.service.spec.ts](../../../../src/mcp/mcp-client.service.spec.ts) | +198/−1 | Фейки `FakeStdioTransport`/`FakeStderr` (без импортов в `vi.hoisted`); мок `client/stdio.js`; +4 теста: command/args без shell, stdio запрещён, denylist, stderr в лог, SIGTERM→SIGKILL |
| [src/mcp/mcp.controller.spec.ts](../../../../src/mcp/mcp.controller.spec.ts) | +6/−2 | `Partial<McpHttpServerConfig>` — типобезопасно для union-конфигурации |
| [src/config/env.schema.spec.ts](../../../../src/config/env.schema.spec.ts) | +18/−2 | default `MCP_ENABLE_STDIO=false`; строгий разбор `'true'/'false'/''/'1'` |

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| `docs/development/reports/v0.12.0/S3-S4-infra-mcp.md` *(new)* | — | этот отчёт |
| [docs/development/reports/README.md](../README.md) | +1 | строка отчёта S3-S4 |

**Итого по моим файлам:** 20 изменённых tracked-файлов — **+1657 / −166**,
плюс новый отчёт. Крупнейшие изменения — `mcp-client.service.ts` (+278),
`mcp.config.ts` (+198), `safe-http.client.spec.ts` (+199),
`mcp-client.service.spec.ts` (+198), `openai-images.provider.spec.ts`
(+215/−51).

**Не мои файлы в том же рабочем дереве** (S1+S2 PDF): `package.json`,
`pnpm-lock.yaml`, `nest-cli.json`, `src/documents/**`, `src/engine/**`,
`src/media/media-storage.integration.spec.ts`, `docs/CHANGELOG.md`,
`docs/KNOWN_ISSUES.md`, `web/src/i18n/{en,ru}.json`,
`docs/development/reports/v0.12.0/S1-S2-pdf.md`. Ни один из них я не менял;
`docs/CHANGELOG.md` и `docs/KNOWN_ISSUES.md` (закрытие KI-525/526, записи
KI-528…532) сознательно оставлены S5 — их прямо сейчас правит S1+S2, и две
параллельные записи в один файл дали бы конфликт.

Артефакты smoke (gitignored, не deliverable): `.smoke/s34-http-smoke.ts`,
`.smoke/mock-mcp-server.mjs`, `.smoke/s34-mcp-smoke.ts`,
`.smoke/s34-http-smoke.json`, `.smoke/s34-mcp-smoke.json`, лог-файлы.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** · `pnpm typecheck` — **0** ·
`pnpm test` — **102 файла passed / 3 skipped (105), 1472 passed / 18 skipped
(1490)** · `pnpm lint` — **0 errors / 2 warnings** (преэкзистующие, § 5.1) ·
`pnpm --dir web exec vitest run src/lib/api-contract.spec.ts` — **7/7**.

Прирост к HEAD `bc7f89a`: **+1 spec-файл** (их `pdf-renderer.service.spec.ts`)
и **+33 активных теста** (1472 − 1439). Из них **+23 — мои S3+S4**
(`safe-http.client` 28→38, `mcp.config` 12→18, `mcp-client.service` 19→23,
`env.schema` 66→67, `openai-images.provider` 23→25); остальные **+10** —
параллельная S1+S2 (PDF). Skipped — прежние DB/e2e без окружения.

---

## 3. Диагностика

### 3.1 Параллельная сессия S1+S2 в том же рабочем дереве

На старте `git status` показывал только `?? RELEASE_NOTES.md`. К 01:26 в дереве
появились `src/documents/assets/`, `src/documents/pdf-renderer.service.ts`,
`package.json` с `pdfkit` и правки `src/engine/*`. Дважды мои гейты падали **не
из-за моих файлов**:

1. **01:29, `pnpm typecheck`:**
   `src/engine/document-generation-executor.spec.ts(188,3): error TS2741:
   Property 'pdfRenderer' is missing…` — их deps уже требовали `pdfRenderer`,
   а их spec ещё нет.
2. **01:37, `pnpm build`:**
   `src/documents/pdf-renderer.service.ts(191,30): error TS7006: Parameter
   'index' implicitly has an 'any' type` (+ ещё 2 ошибки в том же файле) — их
   незавершённая правка.

Оба раза через 1–3 минуты их код починился, и повторный прогон дал 0. Это не
«падение гейта S3+S4», а следствие общего рабочего дерева; в отчёте фиксирую
факт, чтобы при разборе CI-истории не искать несуществующую регрессию. Файлы
S1+S2 я не трогал и не откатывал (RULES 3.8 — искать причины, а не затирать).

### 3.2 Реальный дефект `SafeHttpClient.discardAsync` (нашёл smoke)

Smoke на локальном сервере упал **не** на моём коде, а в существующем пути
редиректа:

```
RequestAbortedError [AbortError]: Request aborted
    at BodyReadable._destroy (undici/lib/api/readable.js:87:13)
    at Object.discardAsync (dist/common/http/safe-http.client.js:68:27)
```

Причина — в `undici` 8: `BodyReadable._destroy(err)` при `!err &&
!this._readableState.endEmitted` сам создаёт `RequestAbortedError` и эмитит
его событием `error`; слушателя нет → uncaught exception → падение процесса.
В юнит-тестах транспорт подменён фейком с `discardAsync: () => Promise.resolve()`,
поэтому дефект не проявлялся ни разу. В продакшене он срабатывал бы на
**каждом** редиректе узла `http`/`http_request` и на теле, превысившем лимит.

Исправление: `discardBodyAsync` ставит `body.on('error', …)` **до**
`body.destroy()`. Порядок важен: `_destroy` вызывает колбэк через `setImmediate`,
когда поток ещё не «использован», и без подписки ошибка успевает стать
uncaught. На это добавлен регресс-тест с `EventEmitter`, который эмитит `error`
из `destroy()` (без фикса тест падает). Заведён **KI-528** (Fixed).

### 3.3 TypeScript: `Object.entries().filter()` не сужает union

После перехода `McpServerConfig` на `discriminatedUnion` конструкция

```ts
const stdio = Object.entries(data).filter(([, c]) => isStdioServerConfig(c));
for (const [, c] of stdio) assertStdioCommandAllowed(c.command); // TS2339
```

не компилируется: `filter` без type predicate не сужает tuple, и `c` остаётся
union'ом. Заменено на `if (isStdioServerConfig(config))` внутри цикла —
навигация по типу и одна проверка.

### 3.4 `Partial<McpServerConfig>` в `mcp.controller.spec.ts`

`Partial` над union'ом распределяется по ветвям, и спред `{ transport: 'http',
url, … …overrides }` дал тип `{ transport: 'http' | 'stdio'; … }`, несовместимый
с union'ом. Хелпер перетипизирован на `Partial<McpHttpServerConfig>`: все тесты
контроллера используют HTTP/SSE, а stdio на форму ответа не влияет.

### 3.5 `vi.hoisted` и импорты

Фейк stdio-транспорта нуждался в `stderr`-потоке. `PassThrough` из
`node:stream` внутри `vi.hoisted` недоступен: `vi.hoisted` выполняется **до**
инициализации импортов (TDZ). Написан минимальный `FakeStderr` с `on/write/end`
внутри того же hoisted-блока — без импортов, с сохранением контракта
`data/end/error`.

### 3.6 Паритет API-контракта: enum `transport`

`GET /mcp/servers` возвращает `transport` из `McpTransportSchema`, а
`McpServersResponseSchema.parse` в контроллере **падает**, если значение не
входит в enum. Без `'stdio'` любой stdio-сервер ломал бы ручку каталога
целиком (не только свой элемент). Добавление значения потребовало
синхронной правки трёх мест, иначе краснеют оба гейта:

1. `src/mcp/dto/mcp-servers.dto.ts` (backend-схема);
2. `docs/development/api-contract.json` (`enums["McpServerSummary.transport"]`);
3. `web/src/lib/api.ts` (Zod-зеркало).

Проверено: backend `src/runs/dto/api-contract.spec.ts` — 12/12, web
`src/lib/api-contract.spec.ts` — 7/7.

### 3.7 `Zod`: `.trim().min(1)` для `command`

Проверено тестом, что `command: '   '` отвергается схемой (Zod v4 применяет
trim до последующих проверок), а не только `assertStdioCommandAllowed`. От
двойной защиты не отказался: схема отвечает за форму, denylist — за смысл.

### 3.8 Сборка «молчит»

`nest build` при успехе не печатает ничего (ни «0 errors», ни «0 warnings»).
Для отчёта это означает: отсутствие вывода + exit 0 = успех; при ошибках
`tsc` печатает `Found N error(s)` и `nest build` возвращает 1.

### 3.9 CRLF в спеке

Блок теста дописывался через PowerShell `Add-Content`, который на Windows
пишет CRLF; файл нормализован в LF (`.gitattributes: * text=auto eol=lf`),
чтобы диф не показывал ложные изменения всего файла.

### 3.10 Порядок shutdown и `pid`

SDK не отдаёт `ChildProcess`, только `transport.pid`. Поэтому PID пишется в
`ServerState` сразу после `client.connect()` и **обнуляется** при
`onclose`/`markDisconnected`/ошибке connect: иначе PID-reuse мог бы привести к
убийству чужого процесса. `isPidAlive` (`process.kill(pid, 0)`) вызывается
непосредственно перед `SIGKILL`.

---

## 4. Smoke

Окружение: Windows 11, Node `v24.21.0`, запуск `pnpm exec tsx` **из исходников**
(`src/**`), не из `dist` — так smoke не зависит от чужой сборки S1+S2, а
проверяет тот же код, что и тесты. Сервер/процессы — только локальные.

### 4.1 `fetchBufferAsync` на локальном HTTP-сервере — 10/10

Команда: `pnpm exec tsx .smoke/s34-http-smoke.ts` (сервер `127.0.0.1:<random>`,
`allowPrivateNetworks: true` для разрешённых проверок).

```json
{
  "smoke": "v0.12 S3 — SafeHttpClient.fetchAsync/fetchBufferAsync (локальный сервер)",
  "baseUrl": "http://127.0.0.1:57576",
  "checks": [
    {
      "name": "SSRF: 127.0.0.1 блокируется без allowPrivateNetworks",
      "passed": true,
      "error": "SsrfBlockedException",
      "message": "SSRF: запрос к '127.0.0.1' запрещён — резолвится в приватный адрес 127.0.0.1"
    },
    {
      "name": "fetchBufferAsync: 256 байт без искажений, image/png, status 200",
      "passed": true,
      "bytes": 256,
      "byteEqual": true,
      "contentType": "image/png",
      "status": 200,
      "error": null
    },
    {
      "name": "fetchBufferAsync: без Content-Type отдаётся пустая строка",
      "passed": true,
      "contentType": ""
    },
    {
      "name": "fetchBufferAsync: превышение maxResponseBytes — ResponseTooLarge",
      "passed": true,
      "error": "SafeHttpResponseTooLargeException",
      "message": "SafeHttp: тело ответа превышает лимит 1024 байт"
    },
    {
      "name": "fetchBufferAsync: тело ровно по лимиту проходит",
      "passed": true,
      "bytes": 256
    },
    {
      "name": "fetchBufferAsync: безопасный редирект даёт финальный URL и байты",
      "passed": true,
      "finalUrl": "http://127.0.0.1:57576/image.png",
      "bytes": 256,
      "error": null
    },
    {
      "name": "fetchBufferAsync: maxRedirects 0 — TooManyRedirects",
      "passed": true,
      "error": "TooManyRedirectsException"
    },
    {
      "name": "fetchBufferAsync: редирект на 169.254.169.254 блокируется",
      "passed": true,
      "error": "SsrfBlockedException",
      "message": "SSRF: редирект с 'http://127.0.0.1:57576/redirect-metadata' к '169.254.169.254' запрещён — резолвится в приватный адрес 169.254.169.254"
    },
    {
      "name": "fetchBufferAsync: 404 возвращается со статусом и телом",
      "passed": true,
      "status": 404,
      "body": "{\"error\":{\"message\":\"not found\"}}",
      "error": null
    },
    {
      "name": "fetchAsync: текстовое тело разбирается как JSON",
      "passed": true,
      "body": "{\"ok\":true}",
      "status": 200
    }
  ],
  "summary": { "total": 10, "passed": 10, "failed": 0 }
}
```

Что доказывает прогон: байты тела не проходят через UTF-8 (256 значений байта
вернулись `byteEqual: true`); лимит отсекает поток, а не «обрезает» результат;
`Content-Type` без заголовка — `''`, а не `undefined`; редирект в metadata
блокируется и на втором хопе; 404 — это данные для вызывающего кода, а не
исключение; текстовый `fetchAsync` после рефакторинга не изменился.

### 4.2 Mock-MCP через `stdio` — 7/7

Команда: `pnpm exec tsx .smoke/s34-mcp-smoke.ts`. `.smoke/mock-mcp-server.mjs` —
настоящий дочерний процесс (JSON-RPC 2.0 по stdin/stdout, `initialize` →
`tools/list` → `tools/call`), который сам пишет свой PID в файл.

```json
{
  "smoke": "v0.12 S4 — MCP stdio (mock-сервер как дочерний процесс)",
  "mock": "D:\\Projects\\AI\\workflow-builder\\.smoke\\mock-mcp-server.mjs",
  "checks": [
    {
      "name": "stdio: рукопожатие и tools/list через дочерний процесс",
      "passed": true,
      "tools": "echo"
    },
    {
      "name": "stdio: tools/call возвращает результат",
      "passed": true,
      "text": "echo:привет"
    },
    {
      "name": "stdio: дочерний процесс запущен (PID из mock-сервера)",
      "passed": true,
      "pid": 14224
    },
    {
      "name": "stdio: stderr процесса пишется в лог с пометкой сервера",
      "passed": true,
      "sample": ["MCP-сервер 'mock' stderr: [mock-mcp] started pid=14224"]
    },
    {
      "name": "stdio: onApplicationShutdown завершает дочерний процесс (нет orphan)",
      "passed": true,
      "pid": 14224,
      "aliveAfterShutdown": false
    },
    {
      "name": "stdio: MCP_ENABLE_STDIO=false отвергает stdio-сервер на старте",
      "passed": true,
      "message": "Некорректная конфигурация MCP: MCP_SERVERS: stdio-транспорт запрещён (серверы: mock) — включите MCP_ENABLE_STDIO=true (DESIGN § 3.3.1)"
    },
    {
      "name": "stdio: denylist отвергает sh -c на старте",
      "passed": true,
      "message": "Некорректная конфигурация MCP: stdio: команда 'sh' запрещена — оболочки и разрушительные утилиты в MCP-сервере не поддерживаются (DESIGN § 3.3.3)"
    }
  ],
  "summary": { "total": 7, "passed": 7, "failed": 0 }
}
```

Лог smoke (stdout, до JSON):

```
[Nest] LOG [McpServerRegistry] MCP включён: серверов в реестре — 1, stdio разрешён
[Nest] LOG [McpClientService] MCP-сервер 'mock': stdio-процесс C:\Program Files\nodejs\node.exe (аргументов: 2)
[Nest] LOG [McpClientService] MCP-сервер 'mock' подключён (транспорт: stdio)
[Nest] LOG [McpClientService] MCP-сервер 'mock': каталог получен, инструментов — 1
[Nest] LOG [McpClientService] MCP mock/echo: вызов выполнен за 6 мс
```

Что доказывает прогон: сервер запускается как реальный процесс (`process.execPath`
+ скрипт, без оболочки), рукопожатие MCP проходит, `tools/call` возвращает
результат, `stderr` попадает в лог с пометкой сервера, а после
`onApplicationShutdown` PID **мёртв** (`aliveAfterShutdown: false`) — orphan'а
нет. Предохранители проверены на том же стенде: без флага — ошибка старта,
`sh -c` — отказ по denylist'у.

### 4.3 Что smoke **не** покрывает

- Реальный внешний DNS/TLS: проверялся `127.0.0.1` (pinning-код общий, но
  rebinding-сценарий проверяется юнит-тестом с мок-резолвером).
- Реальный сторонний MCP-сервер (`@modelcontextprotocol/server-filesystem`):
  mock повторяет протокол, но не чужую реализацию.
- Linux/macOS: `SIGTERM`/`SIGKILL` на Windows проверены косвенно (процесс
  завершился), POSIX-семантика не гонялась.

---

## 5. Что не так

1. **`pnpm lint` — 2 предупреждения, но они не мои.** Оба —
   `typescript(no-base-to-string)` на `String(edit?.formData?.get('prompt'))` в
   `openai-images.provider.spec.ts`; проверено `git show
   HEAD:src/media/providers/openai-images.provider.spec.ts` — строки были на
   HEAD. Ошибок 0. Гейт `lint` в задании не требовался, поэтому не «чинил» их в
   чужом стиле.
2. **Полный web-гейт не прогнан.** Изменён только `web/src/lib/api.ts` (enum),
   проверен `api-contract.spec.ts` (7/7); `pnpm --dir web build`/`test` целиком
   не запускались, чтобы не конкурировать с S1+S2 (она правит `web/src/i18n`).
   Риск низкий: `McpTransportSchema` в UI нигде не разбирается ветвлением по
   значению — только Zod-валидация ответа (проверено `grep`).
3. **`content-length`-чек в провайдере удалён.** Раньше он отсекал «объявлено
   30 МБ» до чтения; теперь лимит держит клиент на потоке. Сервер, который
   врёт в `Content-Length` (объявляет больше, отдаёт меньше), больше не получает
   ошибку — это осознанно: лимит про фактические байты, а не про заголовок.
4. **`MCP_ENABLE_STDIO=true` сам по себе MCP не включает.** При
   `MCP_ENABLED=false` реестр пуст, а stdio-конфиг игнорируется с WARN. Это
   сохранённое поведение v0.11 (выключенная фича не ломает старт), но
   оператору легко перепутать два флага — в `.env.example` оба стоят рядом с
   пояснением.
5. **У stdio-сервера нет `env`.** SDK передаёт только «безопасное» окружение
   (`getDefaultEnvironment`) + явный `env` из параметров, а поля `env` в
   `MCP_SERVERS` нет. Значит, серверы, которым нужен токен (GitHub, БД),
   запустить нельзя, не положив секрет в JSON (RULES 5.1 запрещает). Это
   **KI-529**, осознанное ограничение объёма S4.
6. **Изоляции stdio-процесса нет.** Нет `cwd`, лимитов памяти/CPU, таймаута
   жизни, контейнера; denylist — эвристика (обходится, например,
   `node -e "..."`). Реальная защита — выключенный по умолчанию флаг и
   рекомендация `docker run` (DESIGN § 3.3.3). **KI-530**.
7. **`process.kill(pid, 0)` на Windows может вернуть `EPERM`** (чужой процесс),
   и `isPidAlive` трактует это как «мёртв» → `SIGKILL` не отправится. Для
   собственного дочернего процесса это маловероятно, но окно есть. **KI-532**.
8. **stderr пишется на уровне `debug`.** Это осознанно (шум `npx`, возможные
   пользовательские данные в аргументах — RULES 5.9), но при
   `LOG_LEVEL=info` диагностика «почему сервер не стартовал» видна только по
   тексту `McpUnavailableException` (ошибка `spawn`/таймаут connect), а не по
   stderr. Компромисс зафиксирован в JSDoc константы.
9. **`maxRedirects: 0` для входного изображения.** Сохранил прежнюю семантику
   `redirect: 'error'`, но теперь редирект даёт `TooManyRedirectsException`
   («Превышен лимит редиректов (0)») вместо сетевой ошибки `fetch`. Текст
   ошибки в провайдере обобщён («не удалось скачать входное изображение»), так
   что наружу это не утекает.
10. **Ошибка SSRF в провайдере обезличена.** `SsrfBlockedException` превращается
    в «ведёт на запрещённый адрес» без хоста/IP: иначе URL из графа попадал бы
    в текст ошибки узла (RULES 5.1). Диагностика — в логе клиента.
11. **Параллельная сессия S1+S2.** Дважды ломала `typecheck`/`build` (см. § 3.1);
    также она уже заняла **KI-527** (PDF-таблицы), поэтому мои новые KI
    начинаются с **528**, а не с 526. Номера KI-526 (MCP stdio) и KI-525
    (pinning) формально остаются `Open` в реестре — их закроет S5.
12. **`reports/README.md` правится двумя сессиями.** На момент записи в нём уже
    была строка S1-S2 со ссылкой на ещё не созданный файл. Я добавил только
    свою строку; если S1+S2 перезапишет файл из своего буфера, строку S3-S4
    нужно будет вернуть (S5).
13. **`docs/CHANGELOG.md` и `docs/KNOWN_ISSUES.md` не обновлены** — намеренно
    (RULES 3.17/2.18 обычно требуют, но файлы правит параллельная сессия;
    две одновременные записи = конфликт). Готовые тексты — § 6.
14. **Smoke запускался из `src` через `tsx`, а не из `dist`.** Причина — чужая
    незавершённая сборка в тот момент; плюс: проверен ровно тот код, что
    тестируется. После финального `pnpm build` расхождение исключено (сборка
    зелёная, `dist` содержит те же файлы).

---

## 6. Новые KI

Ниже — записи в формате `docs/KNOWN_ISSUES.md` (вставка в реестр — S5; нумерация
согласована с уже занятым KI-527).

### KI-528 — `SafeHttpClient.discardAsync` ронял процесс на редиректе (`undici` 8)

- **Приоритет:** 🔴 High | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `src/common/http/safe-http.client.ts`,
  `src/common/http/safe-http.client.spec.ts`
- **Описание:** `undiciTransportAsync.discardAsync` вызывал
  `response.body.destroy()` без слушателя `error`. В `undici` 8
  `BodyReadable._destroy` на непрочитанном теле создаёт
  `RequestAbortedError` и эмитит его; необработанное событие — uncaught
  exception и падение процесса. Срабатывало на каждом редиректе узла `http` и
  на теле, превысившем `maxResponseBytes`; юнит-тесты не ловили, потому что
  транспорт подменён фейком с пустым `discardAsync`.
- **Исправление:** введён `discardBodyAsync(body)`: `body.on('error', …)` **до**
  `body.destroy()`; `discardAsync` транспорта делегирует ему. Регресс-тест —
  `EventEmitter`, эмитящий `error` из `destroy()`. Обнаружено smoke'ом S3
  (10 проверок, редирект).

### KI-529 — MCP `stdio`: нет способа передать серверу env-переменные

- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp.config.ts`, `src/mcp/mcp-client.service.ts`
- **Описание:** `StdioClientTransport` получает только
  `command`/`args`; `env` не задаётся, и SDK передаёт процессу лишь
  `getDefaultEnvironment()`. Серверы, которым нужен токен (`GITHUB_TOKEN`,
  строка подключения к БД), запустить нельзя, не положив секрет в
  `MCP_SERVERS` (RULES 5.1 запрещает). Нужен непрозрачный для логов механизм:
  allowlist имён переменных (`MCP_STDIO_ENV_ALLOWLIST`) или чтение из env
  оператора по префиксу, с маскированием значений.
- **Предлагаемое решение:** v0.13 — `MCP_STDIO_ENV_ALLOWLIST=GITHUB_TOKEN,…`;
  значения берутся из окружения процесса, в JSON/логи не попадают.

### KI-530 — MCP `stdio`: нет изоляции процесса, denylist — эвристика

- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp.config.ts`, `src/mcp/mcp-client.service.ts`
- **Описание:** stdio-сервер запускается с правами backend'а: нет `cwd`, лимитов
  памяти/CPU/времени жизни, нет обязательного контейнера. Denylist запрещает
  оболочки и разрушительные утилиты, но обходится (`node -e "…"`, `docker run
  --privileged`). DESIGN § 3.3.3 признаёт это «простейшим denylist'ом», но в
  коде нет ни предупреждения при старте, ни документации для оператора о
  `docker run`.
- **Предлагаемое решение:** v0.13 — обязательный `cwd` внутри
  `./data/mcp/{server}`, лимиты `MCP_STDIO_MAX_*`, предупреждение в лог при
  `MCP_ENABLE_STDIO=true` и `command !== 'docker'`, раздел в USER_GUIDE.

### KI-531 — UI не различает `stdio`-транспорт MCP-сервера

- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/lib/api.ts`, `web/src/components/nodes/AgentNode.tsx`
- **Описание:** backend-контракт `GET /mcp/servers` теперь отдаёт
  `transport: 'stdio'`, web-зеркало обновлено, но UI не показывает транспорт
  (нет бейджа/подписи) и i18n-строк для него. Пользователь не отличает
  локальный процесс от HTTP-сервера в каталоге узла `agent`.
- **Предлагаемое решение:** бейдж `LOCAL` в списке серверов + строки
  `mcp.transport.stdio` в обоих i18n-файлах; проверить полным web-гейтом.

### KI-532 — `isPidAlive` трактует `EPERM` как «процесс мёртв»

- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp-client.service.ts`
- **Описание:** `process.kill(pid, 0)` при `EPERM` (процесс существует, но
  недоступен) попадает в `catch` → `false` → `SIGKILL` не отправляется,
  возможен orphan. Для собственного дочернего процесса на Windows/Unix
  маловероятно, но семантику стоит развести: `ESRCH` — мёртв, `EPERM` — жив.
- **Предлагаемое решение:** `isPidAlive` различает `code === 'ESRCH'` и
  остальные ошибки (консервативно считать живым).

---

## 7. Обоснование решений

1. **Один `executeAsync` на два метода, а не копия защиты.** Требование было
   «добавь `fetchBufferAsync` с тем же `Agent`». Копия цикла редиректов/лимита
   неизбежно разошлась бы с `fetchAsync` при следующей правке (как раз класс
   KI-434/435). Вынес тело запроса в приватный `executeAsync`, а `fetchAsync`
   и `fetchBufferAsync` стали двумя представлениями одного результата: текст
   (`toString('utf8')`) и байты. Тесты обоих путей и smoke это подтверждают.

2. **`fetchBufferAsync` возвращает больше, чем `{ buffer, contentType }`.**
   Контракт задания — `{ buffer, contentType }`; тип
   `SafeHttpBufferResponse` добавляет `status`, `ok`, `headers`, `finalUrl`.
   Провайдеру нужен статус, чтобы отличить 404 от 200 и построить
   `retryable`-ошибку без второго запроса. Возврат более широкого типа
   контракту не противоречит (structural typing), а «второй метод ради
   статуса» раздвоил бы API.

3. **`contentType` — сырой заголовок, без нормализации.** Провайдер сам решает,
   что делать с `image/png; charset=binary` (`readToolImageMime` режет по `;`).
   Нормализация в клиенте сделала бы его непригодным для JSON-ответов ошибок,
   где `charset` важен.

4. **Провайдер сохраняет `assertSafeToolInputUrl`.** Это дешёвый предфильтр:
   отсекает `localhost`/metadata/приватные IP-литералы **до** DNS-резолва и
   даёт пользователю понятный текст. Полная защита (pinning, повторная
   проверка редиректов, лимит) — в клиенте. Двойная проверка здесь уместна:
   цена — несколько сравнений строк.

5. **`maxRedirects: 0` для входного файла.** Прежний код использовал
   `redirect: 'error'`, то есть редиректы не поддерживались вообще. Разрешить
   цепочку значило бы расширить поверхность (чужой файл на втором хосте) без
   запроса от пользователя. `SafeHttpClient` блокирует приватный `Location` и
   при лимите 0, так что семантика сохранена в строгую сторону.

6. **Удалён ранний `Content-Length`-чек.** После перехода на потоковый лимит
   он стал бесполезен (тело уже прочитано) и вреден: сервер, объявивший
   большую длину, но отдавший маленькое тело, получал бы ошибку при валидном
   файле. Лимит по фактическим байтам — то, что требует DESIGN § 3.2.2.

7. **`buildHttpErrorFromBody` вместо конструирования `Response`.** Собирать
   `new Response(buffer, …)` только чтобы переиспользовать `buildHttpErrorAsync`,
   — подделка объекта ради типа. Вместо этого выделил общую сборку ошибки
   (`status` + `headers` + извлечённый текст), и оба пути (`fetch`- и
   `Buffer`-) используют её: `retryable` и `Retry-After` не могут разойтись
   (KI-040 — цена повторного платного вызова).

8. **`discriminatedUnion`, а не «одна схема с опциональными полями».** С
   плоской схемой `url?: string; command?: string` клиент обязан сам проверять
   `url !== undefined` перед `new URL`, и TypeScript не помогает. Union даёт
   `config.command` без проверок в stdio-ветке и `config.url` в HTTP-ветке,
   а `strictObject` запрещает смешивать транспорты (`url` в stdio, `command` в
   http) — иначе конфигурация «полу-рабочая», и ошибка вылезала бы в рантайме.

9. **Гейт `MCP_ENABLE_STDIO` — в `parseMcpServersConfig`, а не в Zod-схеме.**
   Схема должна оставаться чистой функцией формы; флаг — политика. Поэтому
   `parseMcpServersConfig(raw, { enableStdio })`, а `McpServerRegistry` читает
   флаг из `ConfigService` (RULES 4.6). Дополнительно клиент проверяет флаг
   ещё раз при создании транспорта: конфигурация могла быть подменена после
   старта, а запуск процесса — не та операция, где достаточно одной проверки.

10. **Denylist — на разборе и на подключении.** На разборе — fail-fast с
    понятным текстом оператору; на подключении — защита от подмены конфигурации
    в рантайме. Проверка — по basename без `.exe/.cmd/.bat/.ps1` и с
    префиксом `mkfs`, чтобы `C:\Windows\System32\cmd.exe` и `mkfs.ext4` не
    проходили. Это эвристика (KI-530), но она закрывает очевидные катастрофы
    без иллюзии песочницы.

11. **`args` — массив, `shell` нигде не включается.** `StdioClientTransport`
    вызывает `spawn(command, args, { shell: false })`; перевод конфигурации в
    строку команды (`sh -c`) запрещён и denylist'ом. Метасимволы внутри
    аргумента (`run; rm -rf /`) остаются строкой — это и проверяет тест.

12. **`stderr: 'pipe'` + построчная обрезка.** `pipe` даёт PassThrough сразу,
    поэтому ранние строки (ошибка `npx`, отсутствующий файл) не теряются до
    `start()`. Обрезка 512 символов и уровень `debug` — компромисс: stderr
    полезен для диагностики, но не должен ни забивать INFO-лог, ни уносить
    пользовательские данные целиком (RULES 5.9).

13. **Shutdown: `SIGTERM` → `close()` → `SIGKILL`.** `SIGTERM` до закрытия
    потоков даёт серверу шанс снять ресурсы; `client.close()` закрывает `stdin`
    и (в SDK) сам эскалирует до `SIGKILL` с таймаутами 2 с; финальный `SIGKILL`
    добивает выживших. Проверка `kill(pid, 0)` перед `SIGKILL` — защита от
    PID-reuse: за время закрытия PID мог достаться чужому процессу. PID
    обнуляется при любом разрыве транспорта, чтобы старый номер не «дожил» до
    следующего shutdown.

14. **`MCP_ENABLE_STDIO` — строгий boolean с default `false`.** `z.coerce.boolean()`
    превратил бы `'false'` в `true` (RULES 4.35) и молча открыл бы запуск
    процессов — цена ошибки здесь несопоставима с удобством. Пустая строка —
    «не задано» (KI-084), а не ошибка старта.

15. **`stdio` добавлен в `McpTransportSchema` и в оба гейта контракта.** Без
    этого `McpServersResponseSchema.parse` в контроллере падал бы на любом
    stdio-сервере, и ручка каталога отдавала бы 500 вместо списка. Правка
    синхронная (backend DTO + `api-contract.json` + web-зеркало), иначе
    краснеют оба паритет-гейта (KI-440-класс).

16. **Отчёт и `reports/README.md` — единственные docs-правки.** CHANGELOG и
    KNOWN_ISSUES оставлены S5: их правит параллельная S1+S2, а правила
    требуют точечных diff'ов на эти файлы при закрытии KI (RULES 2.12), а не
    прозы. Тексты KI-528…532 готовы в § 6 и вставляются как есть.
