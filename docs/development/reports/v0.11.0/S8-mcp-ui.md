---
title: "S8: MCP API & UI — GET /mcp/servers и выбор инструментов в AgentNode"
date: 2026-10-19
version: v0.11.0
steps: [S8]
status: accepted
related_ki: [KI-518, KI-520, KI-521, KI-522]
related_adr: []
---

# Отчёт S8 — MCP API & UI

> **Статус артефакта.** Отчёт сгенерирован по итогам сессии dsh S8. Коммитов
> нет (запрещено условием), `git add -A` не использовался; все правки лежат в
> рабочем дереве поверх HEAD `0f02f8f` (`docs(release): prepare v0.11.0`),
> тег `v0.11.0` на момент сессии **не выставлен** (`git describe` —
> `v0.10.1-21-g0f02f8f`), поэтому KI-518 закрыт «до тега».

**Ветка:** `main` · **HEAD на момент сессии:** `0f02f8f`
**Правила:** RULES v1.10.0 · **Источник:** DESIGN v0.11 § 3.2.6 (API),
§ 3.2.7 (UI), § 3.2.9 (тесты), § 5 (S8)

## 1. Файлы (+/−)

**Новые — backend:**

| Файл | Строк | Назначение |
|---|---:|---|
| [mcp-servers.dto.ts](../../../../src/mcp/dto/mcp-servers.dto.ts) | +103 | Zod-DTO `McpServersResponse`, `McpServerSummary`, `McpToolSummary`, `McpServerStatus`, `McpTransport` (без URL/заголовков/токенов) |
| [mcp.controller.ts](../../../../src/mcp/mcp.controller.ts) | +209 | `@Controller('mcp')`, `GET /mcp/servers` под `JwtAuthGuard`: `MCP_ENABLED=false` → 200 с пустым списком, `Promise.allSettled` по серверам, безопасный текст ошибки, лимит из env |
| [mcp.controller.spec.ts](../../../../src/mcp/mcp.controller.spec.ts) | +308 | 7 тестов: disabled/enabled, ошибка одного сервера, `enabled=false` сервера, отсутствие утечек, дефолт/мусор лимита |

**Новые — документация:**

| Файл | Строк | Назначение |
|---|---:|---|
| [S8-mcp-ui.md](S8-mcp-ui.md) | +этот файл | отчёт сессии (7 разделов, RULES 2.18) |

**Изменённые (наш вклад):**

| Файл | +/− | Что |
|---|---:|---|
| [mcp.module.ts](../../../../src/mcp/mcp.module.ts) | +10/−3 | `imports: [AuthModule]`, `controllers: [McpController]` |
| [app.module.ts](../../../../src/app.module.ts) | +6/−0 | импорт `McpModule` в `AppModule` (HTTP-ручка каталога) |
| [api-prefixes.json](../../../../api-prefixes.json) | +1/−0 | префикс `mcp` — SPA-fallback + Vite-прокси из единого реестра |
| [api-prefixes.spec.ts](../../../../src/common/api-prefixes.spec.ts) | +3/−2 | `mcp` в ожидаемых префиксах (теперь 9), комментарии |
| [api-contract.json](../../../development/api-contract.json) | +6/−1 | `McpServersResponse`/`McpServerSummary`/`McpToolSummary` + enum-домены `status`/`transport`, `$comment` |
| [api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +35/−0 | три Zod-DTO в `DTO_SOURCES`, два enum-домена в `ENUM_SOURCES` |
| [api.ts](../../../../web/src/lib/api.ts) | +71/−0 | Zod-зеркала MCP-ответа, `fetchMcpServersAsync(): GET /mcp/servers` |
| [workflow.ts](../../../../web/src/stores/workflow.ts) | +48/−0 | `mcpServers`/`mcpServersLoaded`/`mcpServersError`, `loadMcpServersAsync` (кэш на сессию) |
| [agent-node-fields.ts](../../../../web/src/lib/agent-node-fields.ts) | +130/−0 | `clampMcpToolsLimit`, `validateMcpToolRefs`, `isMcpToolSelected`, `toggleMcpTool` |
| [AgentNode.tsx](../../../../web/src/components/nodes/AgentNode.tsx) | +185/−0 | секция «MCP-инструменты»: серверы/инструменты, чекбоксы → `data.mcpTools`, бейджи, предупреждение, лимит, disabled при ошибке, data-атрибуты |
| [AgentNode.spec.tsx](../../../../web/src/components/nodes/AgentNode.spec.tsx) | +211/−6 | мок `fetchMcpServersAsync`, каталог-фикстура, 4 новых теста (disabled/выбор/ошибка/лимит) |
| [api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +49/−1 | три MCP-зеркала + проверка enum-доменов и отсутствия секретных полей |
| [api-prefixes.spec.ts](../../../../web/src/lib/api-prefixes.spec.ts) | +1/−1 | `mcp` в негативной проверке ручного списка Vite |
| [ru.json](../../../../web/src/i18n/ru.json) | +8/−0 | `node.agent.mcp.*`: статусы, ошибка сервера, предупреждение, лимит |
| [en.json](../../../../web/src/i18n/en.json) | +8/−0 | то же на английском (паритет ключей) |
| [CHANGELOG.md](../../../CHANGELOG.md) | +15/−2 | MCP API/UI в `[0.11.0]`, ссылка на отчёт S8 |
| [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +79/−16 | KI-518 → Fixed; новые KI-520/521/522; сводка пересчитана по grep (510) |
| [USER_GUIDE.md](../../../user_guide/USER_GUIDE.md) | +28/−18 | секция MCP: UI-выбор, бейджи, лимит, ошибки сервера; ограничение 9 актуализировано; версия 1.3 |
| [MANUAL_TESTING_GUIDE.md](../../../qa/MANUAL_TESTING_GUIDE.md) | +94/−28 | MCP-01 через UI, новые MCP-03/MCP-04, селекторы, ручка API, приёмка и метрики; версия 1.3, 139 кейсов |
| [README.md](../../../../README.md) | +10/−9 | MCP S6–S8, метрики 1424/417, KI-522/510, 3 Open High |
| [docs/README.md](../../../README.md) | +5/−5 | метрики 1424/417, KI-522/510, 3 Open High, статус DESIGN |
| [RELEASES.md](../../RELEASES.md) | +8/−8 | ожидаемые метрики 1424/417 |
| [reports/README.md](../README.md) | +1/−0 | строка отчёта S8 |

**Итого:** 3 новых backend-файла (**+620** строк), 1 новый отчёт (**+313**
строк), 23 изменённых файла (**+1012/−100** по `git diff --numstat`). Новых
зависимостей, миграций и env-переменных нет.

## 2. Build / test

`pnpm build` 0/0 · `pnpm --dir web build` 0/0 · `pnpm typecheck` 0 · `pnpm lint` 0 warnings/0 errors · `pnpm test` **1424 passed / 18 skipped (103 файла: 100 passed, 3 skipped)** · `pnpm --dir web test` **417 passed (50 файлов)** · `node .smoke/check-md-links.mjs` по 9 изменённым docs — **153 ссылки, 0 проблем**.

## 3. Диагностика

- **`JwtAuthGuard` в unit-тесте.** `@UseGuards(JwtAuthGuard)` заставляет Nest
  инстанцировать guard при `Test.createTestingModule`, поэтому в тест
  контроллера добавлен провайдер `JwtService` (как в `runs.controller.spec.ts`):
  без него `Test.createTestingModule` падал «Nest can't resolve dependencies».
- **`MCP_ENABLED=false` и `maxToolsPerNode`.** DESIGN § 3.2.6 в тексте
  показывает `{ enabled: false, servers: [] }`, но TS-интерфейс и контракт
  требуют `maxToolsPerNode`. Отдаём поле всегда (`{enabled:false,
  maxToolsPerNode:20, servers:[]}`) — иначе UI-зеркало и паритет-контракт
  разошлись бы; это зафиксировано тестом.
- **Текст ошибки сервера.** Причина подключения (`ECONNREFUSED <host>:<port>`,
  `fetch failed`) содержит host — то есть фактически URL, который DESIGN
  § 3.2.6 запрещает отдавать. В ответ API уходит обобщённое
  «не удалось получить каталог инструментов», полная причина — в WARN-лог
  `McpController`; тест проверяет отсутствие host/порта/`tokenEnv`/токена в
  сериализованном ответе.
- **Сервер с `enabled=false`** не подключается и получает `status:'disabled'`
  (не `error`): это состояние конфигурации, а не сбой сети; UI показывает
  «выключен администратором».
- **`Promise.allSettled`.** Штатная ошибка сервера гасится внутри
  `describeServerAsync` (чтобы вернуть `error` с именем сервера), а rejected-
  ветка `allSettled` остаётся защитой от непредвиденного throw при маппинге;
  падение одного сервера не роняет ручку — проверено тестом.
- **Почему префикс не правился в `web/src/lib/api-prefixes.ts` и
  `API_ROUTE_PATTERN`.** С v0.10.2 (KI-472) единственный источник —
  `api-prefixes.json`; backend строит RegExp из него
  (`src/common/api-prefixes.ts`), web читает тот же файл. Правка только JSON —
  иначе вернули бы два списка (класс KI-299/072/472). Расхождение промпта с
  архитектурой зафиксировано в § 5 и как KI-522.
- **Кэш каталога в сторе.** Секцию рисует каждый agent-узел, поэтому
  `GET /mcp/servers` кэшируется в `workflow.ts` по флагу `mcpServersLoaded`
  (как `llmModels`): N узлов не дают N запросов.
- **Saved refs сверх env-лимита.** `toggleMcpTool` валидирует текущий набор по
  жёсткому потолку 20, а env-лимит применяет только к добавлению: уже
  сохранённые ссылки не исчезают из графа при первом клике; в UI выбранные
  инструменты остаются снимаемыми при достигнутом лимите.
- **`api-contract.json` читается двумя гейтами:** backend-спек читает Zod
  `shape` трёх DTO, web-спек — их зеркала из `web/src/lib/api.ts`. Добавлены
  enum-домены `McpServerSummary.status`/`transport` (KI-440-механизм).
- **Проверка формата `ui`-контракта:** три MCP-DTO добавлены в
  `docs/development/api-contract-drafts.json` ранее (S0); после активации в
  основном контракте черновик не чистился — см. § 5.

## 4. Smoke

### 4.1 Сборка и реальный запуск без MCP (по умолчанию)

`pnpm build` → `dist/`; `.env` без `MCP_*` (дефолты `MCP_ENABLED=false`,
`MCP_SERVERS='{}'`). Запуск:

```powershell
$env:PORT='3999'; $env:AUTH_DISABLED='true'; node --env-file=.env dist/main
```

Фрагмент лога старта:

```text
[InstanceLoader] McpModule dependencies initialized +0ms
[RoutesResolver] McpController {/mcp}: +0ms
[RouterExplorer] Mapped {/mcp/servers, GET} route +0ms
[NestApplication] Nest application successfully started +1ms
```

`GET http://127.0.0.1:3999/mcp/servers`:

```json
{"enabled":false,"maxToolsPerNode":20,"servers":[]}
```

- HTTP **200**, `Content-Type: application/json; charset=utf-8` — пустой
  список при выключенном MCP (требование промпта).
- `Accept: text/html` на тот же путь → **тот же JSON** (префикс исключён из
  SPA-fallback, а не отдаёт `index.html`).
- `GET /mcp/ghost` с `Accept: text/html` → **404 JSON** (не SPA).
- Процесс остановлен, порт 3999 освобождён.

### 4.2 Реальный запуск с включённым MCP и недоступным сервером

Env: `MCP_ENABLED=true`,
`MCP_SERVERS={"mock":{"transport":"http","url":"http://127.0.0.1:6553/mcp","tokenEnv":"SMOKE_MCP_TOKEN"}}`,
`SMOKE_MCP_TOKEN=smoke-secret-token`, `MCP_CONNECT_TIMEOUT_MS=1000`.

`GET /mcp/servers`:

```json
{"enabled":true,"maxToolsPerNode":20,"servers":[{"name":"mock","transport":"http","status":"error","error":"не удалось получить каталог инструментов","tools":[]}]}
```

Проверки утечек по сырому телу ответа: `LEAK_URL=False`, `LEAK_PORT=False`,
`LEAK_TOKEN=False`, `LEAK_TOKENENV=False`. Серверный лог (полная причина
остаётся только здесь):

```text
WARN [McpClientService] MCP-сервер 'mock': ошибка транспорта — fetch failed
WARN [McpController] MCP-сервер 'mock': подключение/каталог упали — MCP-сервер 'mock' недоступен: не удалось подключиться: fetch failed
```

Ручка ответила **200** за счёт `Promise.allSettled`/try-catch, процесс жив;
после проверки остановлен, порт освобождён.

### 4.3 Собранный UI

В собранном чанке `web/dist/assets/AgentNode-*.js` присутствуют маркеры
секции: `data-agent-mcp-server`, `data-agent-mcp-tool`, `data-agent-mcp-limit`,
`node.agent.mcp.title`, `node.agent.mcp.serverError`,
`node.agent.mcp.destructiveWarning` — все `True`. Основной чанк
`index-*.js` 157.15 kB (gzip 41.04), лимит 500 kB не превышен.

**Ограничение smoke:** браузерного (CDP) прогона выбора чекбоксов не было —
в сессии нет браузерного инструмента; UI проверен компонентными тестами
jsdom (4 новых теста) и наличием маркеров в собранном бандле.

## 5. Что не так

1. **Промпт S8 ссылался на устаревшие точки правки.** Он требовал
   `{ prefix: 'mcp' }` в `web/src/lib/api-prefixes.ts` и `API_ROUTE_PATTERN` в
   `app.module.ts`, хотя с v0.10.2 единственный источник — `api-prefixes.json`.
   Сделано по фактической архитектуре; расхождение — **KI-522**.
2. **`[Unreleased]` пуст, запись S8 добавлена в `[0.11.0]`.** Тег `v0.11.0`
   не выставлен (HEAD — release-prep коммит), а KI-518 требует закрытия «до
   тега»; поэтому MCP API/UI описан в существующей секции `[0.11.0]`, а
   прежняя фраза «S8 не входит» заменена. Если релиз уже опубликован в другом
   окружении, запись нужно перенести в `[Unreleased]`.
3. **S17-release/S17-docs-sync утверждают, что S8 отсутствует.** Это
   исторические отчёты-снимки (RULES 2.15), их не переписываем; актуальное
   состояние — этот отчёт, CHANGELOG и KI-518.
4. **Ссылки `data.mcpTools` вне каталога не видны в UI** (переименованный/
   удалённый инструмент): пользователь не может снять такую ссылку, а она
   считается в лимите. Заведено **KI-520** (Medium).
5. **Лимит `MCP_MAX_TOOLS_PER_NODE` читается в двух местах** — в
   `McpController` (ответ API) и `AgentService` (проверка запуска). Сейчас
   значения совпадают, но при правке clamp/дефолта разойдутся. Заведено
   **KI-521** (Low).
6. **`api-contract-drafts.json` не чистится при активации DTO.** MCP-записи
   были черновиком S0 и теперь продублированы в основном контракте;
   `DocumentTemplateSummary` аналогично остался в черновике после S3. Это не
   ломает гейты, но черновик перестаёт быть «черновиком».
7. **UI не показывает обрезанный каталог.** `MCP_MAX_TOOLS_PER_SERVER`
   ограничивает каталог (по умолчанию 200), но API/UI об этом не сообщают:
   если сервер отдал больше, часть инструментов просто отсутствует в списке
   (серверный WARN есть). Отдельного KI не заводил: поведение документировано
   в `McpClientService` как защита от зацикленного сервера, UI-индикатор —
   возможное улучшение.
8. **`GET /mcp/servers` не кэширует статус ошибки и ходит в сеть на каждый
   cache-miss.** Каталог кэшируется TTL (`MCP_CATALOG_TTL_MS`), а неуспешное
   подключение переподключается при следующем запросе UI (после перезагрузки
   страницы/монтирования узла). Для операторской диагностики это скорее плюс;
   для «лежащего» сервера — лишние connect-попытки, ограниченные таймаутом.
9. **SSE-транспорт в UI-смоуке не поднимался.** Enabled-смоук — Streamable
   HTTP к недоступному порту; SSE проверен только unit-тестами клиента (S6) и
   `transport: 'sse'` в фикстуре UI-теста.
10. **Авторизация в смоуке — `AUTH_DISABLED=true`.** Проверено, что ручка под
    `JwtAuthGuard` (импорт `AuthModule`, guard в декораторе); отдельный прогон
    «без токена → 401» не делался, потому что на этом инстансе auth выключен.
11. **Токен/URL смоука — фиктивные.** Реальный MCP-сервер с `tokenEnv` в этой
    сессии не поднимался (S6-S7 уже проверяли реальный SDK-сервер); здесь
    важна была форма ответа API и отсутствие утечек.
12. **Правки в `docs/user_guide` и `docs/qa` больше, чем «одна ручка».** Без
    них гайды продолжали бы утверждать, что UI/каталога нет (KI-518), то есть
    стали бы ложными сразу после закрытия KI. Изменения точечные, но объёмные
    (ссылки на кейсы/селекторы/метрики).

## 6. Новые KI

**KI-520 — MCP-ссылки вне каталога не видны в UI узла `agent` (Medium, Open).**
Файлы: `web/src/components/nodes/AgentNode.tsx`,
`web/src/lib/agent-node-fields.ts`. UI рисует только инструменты из
`GET /mcp/servers`: переименованный/удалённый на сервере инструмент остаётся
в `data.mcpTools`, но не отображается — снять его нельзя, а лимит его
считает; запуск падает preflight'ом. Решение: группа «нет в каталоге» с
кнопкой снятия (или очистка с уведомлением).

**KI-521 — Действующий лимит MCP читается независимо в двух местах (Low, Open).**
Файлы: `src/mcp/mcp.controller.ts`, `src/agent/agent.service.ts`,
`src/mcp/mcp.config.ts`. `MCP_MAX_TOOLS_PER_NODE` читается в контроллере и в
`AgentService`; сейчас значения совпадают, но при изменении clamp/дефолта
разойдутся (UI покажет один лимит, запуск проверит другой). Решение: общий
провайдер настроек MCP.

**KI-522 — Промпт S8 ссылался на устаревшие точки правки API-префиксов (Low, Documented).**
Файлы: `docs/development/PROMPT_CURRENT.md`, RULES § 2.17. Промпт требовал
правки `web/src/lib/api-prefixes.ts` и `API_ROUTE_PATTERN`, хотя источник
правды с v0.10.2 — `api-prefixes.json` (KI-472). Дословное выполнение
вернуло бы дубль списка. Решение: актуализировать промпт при следующей правке
системных инструкций.

Других дефектов не выявлено; наблюдения § 5 — by design, исторические
артефакты или ограничения окружения.

## 7. Обоснование решений

- **Контроллер, а не сервис каталога.** Вся логика получения каталога уже в
  `McpClientService` (кэш TTL, connect-mutex); контроллер только читает
  конфиг, спрашивает клиент и маппит в DTO. Отдельный сервис добавил бы слой
  без поведения и усложнил бы DI-граф `McpModule`.
- **Zod-DTO на backend и на web, а не TS-интерфейсы.** Это позволяет
  паритет-гейту читать поля из `shape` (как у `ExportWorkflowDto`/SSE) и
  валидировать внешний ответ на границе (RULES 1.17). Для web это ещё и
  единый источник правды для UI-типов (`McpServersResponse`).
- **Три отдельных DTO в контракте.** `api-contract.json` описывает только
  top-level поля, поэтому вложенные структуры заведены отдельными ключами
  (`McpServerSummary`, `McpToolSummary`) — иначе состав вложенных полей не
  проверялся бы вовсе.
- **Секреты исключены по построению.** В DTO нет `url`/`headers`/`tokenEnv`,
  `inputSchema` тоже не отдаётся; текст ошибки обобщён, потому что причина
  подключения содержит host. Это одновременно и security-требование
  (RULES 5.1, DESIGN § 3.2.8), и защита от случайного расширения контракта:
  добавление URL потребует правки DTO + JSON + двух спеков.
- **`enabled=false` сервера → `disabled`, а не `error`.** Выключенный сервер
  не является сбоем: UI должен показать «выключен администратором», а не
  красную ошибку. Подключение при этом не выполняется (нет лишних сетевых
  попыток).
- **Максимально тонкая UI-логика.** Чистые функции выбора
  (`validateMcpToolRefs`/`toggleMcpTool`/`isMcpToolSelected`) вынесены в
  `agent-node-fields.ts` и переиспользуют `MCP_MAX_TOOLS_PER_NODE_LIMIT` из
  `types/graph.ts`; компонент отвечает только за рендер. Это даёт тестируемую
  границу и повторяет паттерн `validateAgentTools`/`toggleAgentTool`.
- **Лимит: блокируем только добавление.** Уже выбранные инструменты (в том
  числе сохранённые в графе при большем env-лимите) должны сниматься;
  блокировать их значило бы запереть пользователя в состоянии, которое
  backend всё равно отклонит на запуске (S7, п. 8 отчёта S6-S7). Поэтому
  disabled — только у невыбранных чекбоксов при достигнутом лимите.
- **Каталог кэшируется в сторе, а не в компоненте.** Секцию рисует каждый
  agent-узел; локальный `useEffect`-fetch дал бы N одинаковых запросов.
  Подход повторяет `llmModels` и не требует нового контекста/провайдера.
- **Сервер в `error` не блокирует сохранение узла.** Это прямо требует DESIGN
  § 3.2.7: узел сохраняется, запуск упадёт preflight'ом с понятной ошибкой;
  UI лишь гасит чекбоксы и показывает причину.
- **`data-agent-mcp-server`/`data-agent-mcp-tool`** — те же smoke-контракты,
  что `data-agent-tool`: значения `server` и `server:tool`, чтобы будущая
  автоматизация могла найти конкретную пару без парсинга DOM.
- **i18n — оба языка сразу.** Новые ключи добавлены в `ru.json` и `en.json`
  (включая статусы сервера и предупреждение); существующий тест паритета
  ключей ловит расхождение.
- **Документация обновлена вместе с кодом.** KI-518 закрыт, CHANGELOG и
  `reports/README.md` получили ссылку на отчёт (RULES 2.1/2.18); USER_GUIDE и
  QA-гайд больше не утверждают, что UI отсутствует (RULES 2.16), метрики
  пересчитаны по фактическим прогонам (RULES 3.20/3.21).
