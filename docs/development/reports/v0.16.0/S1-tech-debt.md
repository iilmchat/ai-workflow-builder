---
title: "S1: Tech Debt Sprint (история, статусы, контракты, MCP)"
date: 2026-11-02
version: v0.16.0
steps: [S1]
status: accepted
related_ki: [KI-534, KI-541, KI-542, KI-545, KI-548, KI-549, KI-550, KI-551]
related_adr: []
---

# Отчёт S1 — Tech Debt Sprint (v0.16.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **105 passed / 3 skipped
(108 файлов), 1560 passed / 18 skipped**, `pnpm --dir web test` — **52/52
файлов, 462/462 тестов**, `pnpm --dir web build` — **exit 0**, `pnpm lint` —
**0 errors / 2 warnings** (преэкзистующие, `openai-images.provider.spec.ts`).
Смоук: keyset-API — **24/24**, UI в реальном Chrome — **25/25**, MCP WARN —
**1 предупреждение с именами без значений** (§ 4).

**Точка старта.** HEAD `6942d1b` («feat(v0.15.0): Web Search Expansion
(Bing, Brave)»), CI зелёный. Источник — `docs/KNOWN_ISSUES.md` (KI-541, 542,
545, 548, 534), правила — `docs/development/RULES.md` v1.10.0.

**Закрыто:** KI-534, KI-541, KI-542, KI-545, KI-548. **Новые:** KI-549,
KI-550, KI-551 (ограничения keyset-пагинации, § 6).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/runs/dto/run-history.dto.spec.ts](../../../../src/runs/dto/run-history.dto.spec.ts) *(new)* | 108 | 10 тестов курсора: encode/decode round-trip (включая µs), base64url, отказ мусору (не base64/JSON, невалидные uuid/дата), совместимость со старым ms-курсором, `RunHistoryCursorSchema`, query-схема (`limit` дефолт, `cursor` опционален, `offset` отброшен) |
| [docs/development/reports/v0.16.0/S1-tech-debt.md](S1-tech-debt.md) *(new)* | — | этот отчёт |

### 1.2 Изменённые файлы

| Файл | +/− | Что |
|---|---:|---|
| [src/runs/dto/run-history.dto.ts](../../../../src/runs/dto/run-history.dto.ts) | +151/−14 | `RunSummary.cursor`; `RunHistoryResponse.nextCursor`; `RunHistoryCursor`; `encodeRunHistoryCursor`/`decodeRunHistoryCursor` (base64url JSON `{c,i}`, где `c` — ISO с микросекундами, а не JS Date); `RunHistoryCursorSchema`; query-схема: `cursor` вместо `offset` |
| [src/runs/runs.service.ts](../../../../src/runs/runs.service.ts) | +95/−21 | Keyset-фильтр `(created_at, id) < (cursor.createdAt, cursor.id)` по `::timestamptz`, порядок `created_at DESC, id DESC`; µs-точность через `to_char(... 'US')`; выборка `limit + 1` → `nextCursor`; защита от невалидной даты; `cursor` в каждом `RunSummary` |
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +134/−15 | Ожидания `cursor`/`nextCursor`; `limit + 1`; µs-точность курсора; невалидная дата курсора → 400; offset больше не вызывается; «есть следующая страница» и «ровно limit → null» |
| [src/runs/runs.controller.ts](../../../../src/runs/runs.controller.ts) | +21/−6 | Декодирует `query.cursor` и передаёт `RunHistoryCursor` в сервис; JSDoc под keyset |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +41/−9 | `nextCursor` в ответе; `cursor` доходит до сервиса; мусорный курсор → 400; `offset` больше не валидируется |
| [src/runs/dto/api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +80/−3 | `RunSummary.cursor`, `RunHistoryResponse.nextCursor`; новые DTO web-search в `DTO_SOURCES`/`ENUM_SOURCES`; проверки «ключей в ответе нет» |
| [src/web-search/web-search.interface.ts](../../../../src/web-search/web-search.interface.ts) | +10/−0 | `WebSearchProviderNameSchema` (`z.enum`) — источник enum-домена для контракт-гейта (KI-548) |
| [src/mcp/mcp-client.service.ts](../../../../src/mcp/mcp-client.service.ts) | +31/−1 | `buildStdioEnv(serverName, config)` собирает ненайденные имена allowlist и пишет WARN один раз на сервер (`warnedMissingAllowlist`), только имена |
| [src/mcp/mcp-client.service.spec.ts](../../../../src/mcp/mcp-client.service.spec.ts) | +52/−0 | Тест KI-534: WARN содержит сервер и опечатку, не содержит найденное имя и значения, переподключение не дублирует |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +35/−15 | `RunSummarySchema.cursor`, `RunHistoryResponseSchema.nextCursor`; `fetchWorkflowRunsAsync(workflowId, limit, cursor?)` |
| [web/src/lib/api.spec.ts](../../../../web/src/lib/api.spec.ts) | +11/−8 | URL `?limit=20` и `?limit=5&cursor=…`; `nextCursor` в разборе |
| [web/src/components/RunHistoryModal.tsx](../../../../web/src/components/RunHistoryModal.tsx) | +142/−67 | Keyset-UI: `nextCursor`, кнопка «Загрузить ещё» с дописыванием/дедупликацией, отдельная ошибка догрузки, счётчик «Показано N из M»; клик пишет `?runId=` (`setRunIdInUrl`) и зовёт `restoreRunAsync(id, { preserveRunIdInUrl: true })` (KI-541); статусы из `status.*` |
| [web/src/components/RunHistoryModal.spec.tsx](../../../../web/src/components/RunHistoryModal.spec.tsx) | +162/−65 | 13 тестов: первая страница, keyset-догрузка по курсору, дедупликация (меж- и внутристраничная), ошибка догрузки+retry, футер во время загрузки, границы длительности, клик+`?runId=`+preserve, закрытия, пустая история |
| [web/src/stores/workflow.ts](../../../../web/src/stores/workflow.ts) | +38/−7 | `RestoreRunOptions.preserveRunIdInUrl`; терминальный запуск сохраняет/восстанавливает `?runId=`; `loadWorkflowAsync` на F5 использует флаг (KI-541) |
| [web/src/stores/workflow.spec.ts](../../../../web/src/stores/workflow.spec.ts) | +28/−0 | 2 теста preserve-режима: параметр сохраняется, а при его отсутствии — выставляется |
| [web/src/components/TopBar.tsx](../../../../web/src/components/TopBar.tsx) | +6/−6 | Статусы из `status.*`, `status.attempt` (KI-545) |
| [web/src/components/RunResultPanel.tsx](../../../../web/src/components/RunResultPanel.tsx) | +9/−9 | Статусы узла/запуска из `status.*`, `skipped` → `status.skipped` |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +12/−21 | Удалены `run.status.*`, `run.status.node.*`, `history.status.*`, `node.status.skipped`, `history.prev/next/page`; добавлены `status.*` и ключи keyset-UI |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +12/−21 | То же по-английски (паритет проверяет `i18n.spec.ts`) |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +46/−3 | Зеркала `WebSearchProvidersResponse`/`WebSearchProviderInfo`, enum-домены, негативная проверка «нет `apiKey`/`token`»; `RunHistoryResponse.nextCursor` |
| [web/src/components/TopBar.spec.tsx](../../../../web/src/components/TopBar.spec.tsx) | +35/−3 | Мок истории (`nextCursor: null`, вызов без offset); тест суффикса попытки «Выполняется (попытка 2/3)» (KI-545) |
| [docs/development/api-contract.json](../../../../docs/development/api-contract.json) | +8/−4 | `RunSummary.cursor`, `RunHistoryResponse.nextCursor`, `WebSearchProvidersResponse`, `WebSearchProviderInfo`, два enum-домена web-search |
| [docs/KNOWN_ISSUES.md](../../../../docs/KNOWN_ISSUES.md) | +86/−16 | KI-534/541/542/545/548 → Fixed с разделами «Реализовано»; новые KI-549/550/551; сводка пересчитана по grep |
| [docs/CHANGELOG.md](../../../../docs/CHANGELOG.md) | +34/−0 | `[Unreleased] → Fixed` (5 KI) и `Documented` (3 новых KI) со ссылкой на отчёт |
| [docs/development/reports/README.md](../../../../docs/development/reports/README.md) | +1/−0 | Строка отчёта v0.16.0 S1 |
| [README.md](../../../../README.md) | +14/−10 | История: `?cursor=`, keyset, «Загрузить ещё», F5 после клика |

**Итого:** tracked-файлы — **+1294 / −324**; новые файлы — **1 файл /
108 строк** (этот отчёт не входит). Вместе: **+1402 / −324**. Крупнейшие:
`RunHistoryModal.tsx` (+142/−67), `run-history.dto.ts` (+151/−14),
`RunHistoryModal.spec.tsx` (+162/−65).

Артефакты смоука (gitignored, не deliverable): `.smoke/v016-cdp-helpers.mjs`,
`.smoke/v016-s1-history-keyset-smoke.mjs/.json`,
`.smoke/v016-s1-history-ui-smoke.mjs/.json`,
`.smoke/v016-s1-history-keyset.png`, `.smoke/v016-s1-mcp-warn.log`,
`.smoke/v016-s1-mcp-warn-smoke.json`.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** (exit 0) · `pnpm typecheck` — **0**
(exit 0) · `pnpm test` — **105 passed / 3 skipped (108 файлов), 1560 passed /
18 skipped** (46.2 с) · `pnpm --dir web test` — **52/52 файлов, 462/462
тестов** · `pnpm --dir web build` — **exit 0** (`tsc -b` + Vite, `✓ built in
309ms`) · `pnpm lint` — **0 errors / 2 warnings** (оба —
`src/media/providers/openai-images.provider.spec.ts`, преэкзистующие) ·
`pnpm test:e2e` — **1/1** (bootstrap `AppModule` с новым графом).

Прирост к HEAD: backend **+1 файл / +16 тестов** (keyset-DTO 10, сервис +2,
MCP +1, контракт +3; часть тестов изменена), web **+13 тестов** (RunHistoryModal
+3 нетто при переписанных кейсах, store +2, TopBar +1, api-contract +1,
остальное — изменённые ожидания).
Целевые прогоны после финальных правок: backend `src/runs` + MCP +
`src/web-search` — **299 passed / 21 файл**; web RunHistoryModal + TopBar + api +
api-contract + store + i18n — **82 passed / 6 файлов**. `pnpm test:e2e` —
**1/1 passed** (bootstrap `AppModule` с новым DI-графом).

---

## 3. Диагностика

### 3.1 `total`-навигация зацикливала «Загрузить ещё» — исправлено `nextCursor`

Первая версия keyset-UI определяла «есть ещё» как `runs.length < total`.
Смоук показал сценарий: между первым и вторым запросом появляется новый запуск,
`total` становится 26, а старых страниц ровно 25 — кнопка «Загрузить ещё»
остаётся навсегда, каждый клик возвращает пустую страницу. Исправлено на
сервере: `SELECT ... LIMIT limit + 1`; лишняя строка — признак «есть ещё»,
`nextCursor` = курсор последнего **видимого** элемента либо `null`. UI теперь
ориентируется только на `nextCursor`, `total` оставлен счётчиком
«Показано N из M». Тесты: сервис («nextCursor, когда строк больше limit»),
DTO/contract, UI (догрузка/конец). Это улучшение по сравнению с буквальной
формулировкой задачи («cursor последнего элемента»), обосновано в § 7.1.

### 3.2 Ложный «зелёный» в CDP-смоуке

Первый прогон UI-смоука показал `FAIL «Запуск · Завершён»` и `FAIL TopBar и
панель совпадают`, хотя после F5 всё было верно. Причина — predicate смоука
ждал только `includes('Запуск')`, а до ответа `restoreRunAsync` панель рисует
«Запуск · не запускался». Product-бага нет: predicate ужесточён до
`includes('Запуск') && includes('Завершён')` (RULES 4.33 — фиксировать состояние
«до/после», а не частичное совпадение). После правки — 25/25.

### 3.3 PK-коллизия в keyset-смоуке

Keyset-смоук сначала вставлял запуски с детерминированными uuid
(`00000000-…-0001`). Повторный прогон падал на `workflow_runs_pkey`, потому что
id — PK и уже занят запусками предыдущего прогона. Исправлено: id —
`randomUUID`, порядок задаётся уникальным `created_at`. Смоук стал
идемпотентным (24/24 на финальных прогонах).

### 3.4 `offset` удалён — breaking change API

`RunHistoryQuerySchema` больше не знает `offset`; Zod отбрасывает неизвестный
параметр, поэтому старый клиент `?offset=40` молча получает первую страницу.
Внутренний UI и тесты обновлены, но внешние интеграции могли использовать
параметр. Это осознанный шаг (задача: «замени offset на cursor»), зафиксирован
KI-550: в следующем миноре — deprecated-алиас с WARN или 400 с подсказкой.
Старые `.smoke/v014-s1-history-smoke.mjs` и `.smoke/v014-s2-cdp-smoke.mjs` —
gitignored артефакты прошлых сессий, их не правил.

### 3.5 Единый неймспейс статусов меняет тексты TopBar

В TopBar статусы были «Создаётся…», «Выполняется…», «Готово», в панели —
«ожидает», «выполняется», «завершён», в истории — «Ожидает», «Выполняется»,
«Завершён». Единый `status.*` выбран по «нейтральной» формулировке:
«Ожидает»/«Выполняется»/«Завершён»/«Ошибка»/«Отменён»/«Пропущен». Поэтому
кнопка Run теперь говорит «Завершён» вместо «Готово» и не добавляет «…» к
`pending/running`. Это и есть цель KI-545 (единый источник), но изменение
видимое — отражено в § 5. Суффикс попытки сохранён: `status.attempt`
(`«Выполняется (попытка 2/3)»`).

### 3.6 Enum-домен web-search без дублирования литералов

`WebSearchProviderInfo.name` и `WebSearchProvidersResponse.defaultProvider`
имеют один домен `tavily|bing|brave`. Чтобы контракт-гейт не дублировал
литералы, в `web-search.interface.ts` добавлена `WebSearchProviderNameSchema`
(`z.enum(WEB_SEARCH_PROVIDER_NAMES)`), и backend-spec читает значения из
`options`; web-spec — из своего `WebSearchProviderNameSchema`. Поля обоих
ответов читаются компилятором TypeScript (TS-интерфейсы), как и остальные
interface-DTO контракта.

### 3.7 MCP WARN: где и сколько раз

Предупреждение ставится в `buildStdioEnv`, то есть **после** проверки обоих
источников значения (`env` сервера в `MCP_SERVERS` приоритетнее окружения
backend'а). Набор `warnedMissingAllowlist` не даёт дублировать строку при
переподключении. WARN появляется только при первом подключении сервера: если
stdio-сервер в конфигурации есть, но к нему ни разу не обращались, строки в
логе не будет — это тот же класс, что KI-535 (WARN не на старте); в задаче
требовался WARN «при подключении», поэтому поведение соответствует.

### 3.8 Посторонний untracked-каталог `docs/development/v1.0/`

В рабочем дереве появился untracked `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md`
(0.5 КБ), которого не было на старте сессии. Я его не создавал и не менял;
это внешний артефакт (вероятно, подготовка v1.0 другим процессом). В отчётный
diff не включаю, в коммит он не попадёт (коммитов нет).

### 3.9 RULES 3.20: сводка KI пересчитана grep'ом

После закрытия пяти KI и заведения трёх новых: **539** записей `### KI-`
(включая шаблон KI-001), статусы — Fixed 242, Fixed (частично) 1, Open 275,
Documented 14, Documented (не воспроизводится) 1, Planned 1, Deferred 1,
Won't Fix 4; сумма = 539. Проверка маркеров: 540 строк с `**Статус:**` (539
записей + одна pre-existing строка KI-476, где маркер упомянут в описании),
минус 1 = 539.

### 3.10 i18n-паритет

Удалено 15 ключей (`run.status.*` — 7, `run.status.node.*` — 5,
`history.status.*` — 5, `node.status.skipped` — 1, `history.prev/next/page` —
3; часть пересекается по смыслу) и добавлено 13 (`status.*` — 8,
`history.loaded/load_more/load_more_failed/end` — 4, `status.label` входит в 8).
Оба файла (`ru.json`/`en.json`) синхронны, паритет проверяет
`web/src/i18n/i18n.spec.ts`.

### 3.11 Веб-сборка после правки контракта

`RunHistoryResponseSchema` получила `nextCursor` — web-сборка и
`api-contract.spec.ts` падали бы при рассинхроне с backend; гейт сработал на
обеих сторонах (backend-spec читает интерфейс, web-spec — Zod-зеркало), поэтому
правка JSON + трёх схем прошла одним шагом.

### 3.12 Микросекундная точность курсора (найдено verifier'ом) — исправлено

Verifier нашёл реальный latent-баг: `RunHistoryCursor.createdAt` был JS `Date`,
а `workflow_runs.created_at` — `timestamptz` с микросекундами. `Date` терял µs,
поэтому фильтр `created_at = cursor.createdAt` не совпадал с настоящей строкой,
и tie-break по `id` не срабатывал: два запуска в одной миллисекунде могли дать
пропуск на второй странице (существующие данные verifier'а: 76/235 строк с
суб-миллисекундной точностью). Исправлено:

- `RunHistoryCursor.createdAt` — **строка** ISO-8601 с µs, а не `Date`;
- SQL-выборка дополнительно отдаёт `to_char(created_at AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` (`cursorCreatedAt`);
- фильтр сравнивает `created_at < $cursor::timestamptz` / `=` (без JS-`Date`);
- `decodeRunHistoryCursor` принимает 1–6 дробных цифр (старые ms-курсоры
  совместимы) и валидирует реальность даты;
- регрессия закреплена unit-тестом (курсор `.500900Z` не превращается в
  `.500Z`) и ключевым смоуком: два запуска в одной миллисекунде, page1 →
  cursor → page2 находит второй (в старом коде page2 была пустой).

Заодно исправлены nits verifier'а: README теперь показывает
`{ runs, nextCursor, total }`; футер модалки скрыт во время первой загрузки
(не «Показано 0 из 0 / дальше нет»); `seen.add` не даёт задублировать запись
внутри одной страницы; добавлены тесты на `status.attempt`, границу
«ровно limit → nextCursor=null» и отсутствие футера при загрузке.

---

## 4. Smoke

### 4.1 Keyset-пагинация на реальном backend — 24/24

**Окружение:** Windows 11, Node 24.21.0, pnpm 12.11.2; PostgreSQL 5433 и Redis
6379 в Docker (healthy); backend `node dist/main` на `127.0.0.1:3000`
(`AUTH_DISABLED=false`). Скрипт: `.smoke/v016-s1-history-keyset-smoke.mjs`,
отчёт: `.smoke/v016-s1-history-keyset-smoke.json`.

**Сценарий:** регистрация; workflow с 25 запусками, вставленными напрямую в БД
(уникальные `created_at`); страница 1 `limit=10`; вставка нового запуска;
страницы 2–3 по курсору; повторный курсор; `offset`; битый cursor;
`limit=0`; без токена.

**Результат: 24/24, 0 падений.**

| Проверка | Факт |
|---|---|
| page1 | 10 строк в порядке `createdAt DESC`, `total=25`, `nextCursor` есть и равен `cursor` последней строки |
| page2 после вставки нового запуска | ровно следующие 10 старых; новый запуск **не** попал; `total=26` |
| page3 | оставшиеся 5; `nextCursor=null` |
| повтор того же курсора | те же 5 (идемпотентность) |
| первая страница после вставки | первый — новый запуск, дальше 9 прежних (сдвига окна нет) |
| валидация | мусорный `cursor` → 400, `limit=0` → 400, без токена → 401 |
| legacy `offset=10` | 200 и та же первая страница (параметр игнорируется) |
| микросекундная точность | два запуска в одной миллисекунде (`.500900Z` и `.500100Z`): page1 = новый, курсор сохранил `.500900`, page2 вернул старый по id-tie-break |

```json
{
  "total": 25,
  "page1": 10,
  "page2": 10,
  "page3": 5,
  "newestAfterInsert": "b487e650-818c-4087-924b-a337f57f3166",
  "micros": {
    "cursor": "2026-11-02T14:00:00.500900Z",
    "page2": ["…старший запуск той же миллисекунды…"]
  }
}
```

Главное: вставка нового запуска между страницами не дала ни дубля, ни пропуска —
именно то, что чинил KI-542. Отдельно проверена µs-точность: старый JS-`Date`
курсор (`.500Z`) на второй странице вернул бы пусто, новый (`.500900Z`) вернул
соседний запуск той же миллисекунды.

### 4.2 UI истории в реальном Chrome (CDP) — 25/25

**Окружение:** тот же backend на :3000 + Vite dev на `127.0.0.1:5173` +
Chrome `--headless=new`, CDP-порт 9223, окно 1440×900. Скрипт:
`.smoke/v016-s1-history-ui-smoke.mjs` (+ общие CDP-хелперы
`.smoke/v016-cdp-helpers.mjs`), отчёт:
`.smoke/v016-s1-history-ui-smoke.json`, скриншот:
`.smoke/v016-s1-history-keyset.png`.

**Сценарий:** регистрация и 25 запусков в БД; вход через `/login` (нативный
setter + `input`); `/?workflowId=…`; открыть «Историю»; проверить первую
страницу; «Загрузить ещё»; клик по запуску; F5; консоль.

**Результат: 25/25.**

| Блок | Проверки |
|---|---|
| Первая страница | 20 строк, «Показано 20 из 25», «Всего: 25», кнопка «Загрузить ещё» есть, «конца» нет, порядок = API |
| Догрузка | 25 строк, `unique=25` (дублей нет), порядок = API, кнопка исчезла, «Дальше запусков нет», «Показано 25 из 25» |
| Статусы | бейдж истории «Завершён»; TopBar после клика — «Завершён»; панель — «Запуск · Завершён» (единый `status.*`, KI-545) |
| Клик | модалка закрыта, панель результата `[data-result-panel="run"]`, URL содержит `runId=<id>` (KI-541) |
| F5 | панель восстановлена, `?runId=` сохранился |
| Консоль | 0 console.error, 0 исключений страницы, 0 неожиданных network-ошибок (1 ожидаемый 401 `/auth/refresh` до логина) |

Ключевой фрагмент фактов:

```json
{
  "modalPage1": { "rows": 20, "loadedText": "Показано 20 из 25", "loadMore": true },
  "modalPage2": { "rows": 25, "unique": 25, "loadedText": "Показано 25 из 25", "loadMore": false, "end": true },
  "afterClick": {
    "panelTitle": "Запуск · Завершён",
    "urlAfterClick": "http://127.0.0.1:5173/?workflowId=…&runId=…",
    "badgeText": "Завершён"
  },
  "afterReload": { "panelTitle": "Запуск · Завершён", "url": "…&runId=…" }
}
```

### 4.3 MCP WARN для allowlist — 1 строка, имена только

**Окружение:** второй инстанс backend на `:3001` с env
`MCP_ENABLED=true`, `MCP_ENABLE_STDIO=true`,
`MCP_STDIO_ENV_ALLOWLIST=MCP_SMOKE_PRESENT,MCP_SMOKE_TYPO`,
`MCP_SMOKE_PRESENT=from-env`; `MCP_SERVERS` — stdio-сервер `node -e
"process.exit(1)"` (команда проходит denylist, но подключение падает — для
WARN достаточно вызова). Запрос `GET /mcp/servers` с JWT. Отчёт:
`.smoke/v016-s1-mcp-warn-smoke.json`, лог: `.smoke/v016-s1-mcp-warn.log`.

```
WARN [McpClientService] MCP-сервер 'local': имена из MCP_STDIO_ENV_ALLOWLIST
не найдены ни в env сервера, ни в окружении: MCP_SMOKE_TYPO — переменные не
будут переданы stdio-процессу (KI-534)
```

Проверено: WARN ровно 1; упомянута только отсутствующая `MCP_SMOKE_TYPO`
(найденная `MCP_SMOKE_PRESENT` — нет); значения (`from-env`) в лог не попали;
`GET /mcp/servers` отработал (200, `enabled: true`, сервер со статусом `error`),
то есть WARN не уронил каталог.

### 4.4 Честные оговорки

1. **UI-смоук — dev-окружение:** Vite dev + headless Chrome, не production
   bundle; данные 25 запусков вставлены в БД напрямую (детерминированные
   `created_at`/статусы), а не прогнаны движком. Это даёт контроль над
   пагинацией, но не проверяет реальное выполнение графа.
2. **MCP-сервер фиктивный:** проверен WARN до/при попытке spawn; успешного
   MCP-handshake нет (процесс сразу завершается). Для KI-534 (диагностика
   имён allowlist) этого достаточно; подключение к настоящему серверу — вне
   среза.
3. **`pnpm test:e2e` прогнан отдельно — 1/1 passed.** Изменений в bootstrap
   нет, но гейт подтверждает, что `AppModule` поднимается с новым DI-графом.
4. Артефакты `.smoke/*` gitignored, в репозиторий не входят. Старые
   смоук-скрипты v0.14 используют `offset` и после KI-542 неактуальны; они —
   ignored-артефакты прошлых сессий, в CI не входят.

---

## 5. Что не так

1. **KI-549 (🟢 Low, Documented):** `RunSummary.cursor` дублирует
   `RunHistoryResponse.nextCursor`. UI использует только `nextCursor`; курсор
   элемента оставлен для диагностики/точечной догрузки, но два поля кодируют
   одно и то же и провоцируют неверный путь навигации. Кандидат на удаление в
   v1.0.
2. **KI-550 (🟢 Low, Documented):** `offset` удалён без deprecation-окна. Старый
   клиент `?offset=40` молча получает первую страницу (Zod отбрасывает
   параметр) — тихая деградация данных. Нужен deprecated-алиас или 400.
3. **KI-551 (🟢 Low, Documented):** `total` может опережать загруженный список,
   если при открытой модалке появился новый запуск: «Показано 25 из 26» +
   «Дальше запусков нет». Связано с KI-543 (нет real-time). В v0.16 S1 текст
   конца изменён на «Дальше запусков нет», чтобы не утверждать полноту списка.
4. **KI-540 не закрыт:** keyset-запрос по-прежнему без индекса
   `(workflow_id, created_at DESC, id DESC)` — на большой истории будет seq
   scan. Задача v0.16 S1 не включала миграцию; keyset решает корректность, но
   не скорость.
5. **KI-543/544/537 остаются:** нет real-time обновления истории, нет причины
   падения в списке, права истории уже, чем у просмотра запуска. Срез их не
   касался.
6. **Breaking change API:** удаление `offset` (см. § 3.4). Версия REST-контракта
   не поднималась (`version: 1`), потому что формат JSON не менялся, но набор
   query-параметров — да.
7. **Тексты статусов изменились:** TopBar теперь «Ожидает»/«Выполняется»/
   «Завершён» вместо «Создаётся…»/«Выполняется…»/«Готово». Это цель KI-545, но
   пользовательская копия изменилась без отдельного UX-ревью.
8. **MCP WARN только при подключении:** если stdio-сервер сконфигурирован, но
   не используется, оператор не увидит предупреждение (тот же класс, что
   KI-535). Задача требовала WARN «при подключении» — поведение соответствует.
9. **Курсор непрозрачен, но не подписан:** base64url JSON можно собрать вручную
   и задать любую позицию. Это не уязвимость (данные и так доступны editor'у,
   направление ограничено `created_at/id`), но «непрозрачность» — соглашение,
   а не защита. В KI не выделял: доступа к чужим workflow курсор не даёт.
10. **В рабочем дереве появился untracked `docs/development/v1.0/`** — не мой
    артефакт, в diff не входит (§ 3.8). Если он не нужен — удалить отдельно.
11. **Старые `.smoke/v014-*` не обновлены под cursor** — они gitignored и не
    входят в CI, но при ручном прогоне дадут ложные падения (offset → первая
    страница).
12. **Покрытие смоука ограничено срезом:** unit-тесты + два реальных смоука
    (API и browser) + `pnpm test:e2e` (1/1); полноценного e2e-сценария
    «история → запуск → F5» в CI нет, он проверен CDP-скриптом вручную
    (gitignored).
13. **Найдено verifier'ом и исправлено до финальных гейтов:** потеря
    µs-точности в курсоре (latent-баг keyset, § 3.12) и nits — README не
    показывал `nextCursor`; футер модалки врал «Показано 0 из 0 / дальше нет»
    во время загрузки; `seen` не пополнялся при дедупликации внутри страницы;
    не было тестов на `status.attempt`, границу «ровно limit» и футер при
    загрузке. Всё перечисленное исправлено в этом же срезе.

---

## 6. Новые KI

Добавлены в `docs/KNOWN_ISSUES.md` (формат реестра соблюдён; сводка статусов
пересчитана grep'ом, § 3.9):

| KI | Приоритет | Статус | Суть | Файлы |
|---|---|---|---|---|
| **KI-549** | 🟢 Low | Documented | `RunSummary.cursor` дублирует `nextCursor`; UI использует только `nextCursor`, второе поле — кандидат на удаление в v1.0 | `src/runs/dto/run-history.dto.ts`, `web/src/lib/api.ts`, `web/src/components/RunHistoryModal.tsx` |
| **KI-550** | 🟢 Low | Documented | `offset` удалён без deprecation-окна: старый клиент молча получает первую страницу; нужен deprecated-алиас или 400 | `src/runs/dto/run-history.dto.ts`, `src/runs/runs.controller.ts` |
| **KI-551** | 🟢 Low | Documented | «Показано N из M» может опережать список при новом запуске во время открытой модалки; связано с KI-543 | `web/src/components/RunHistoryModal.tsx` |

Закрытия: **KI-534, KI-541, KI-542, KI-545, KI-548 → Fixed**; у каждого в
реестре есть раздел «Реализовано в v0.16 S1» с описанием решения.

---

## 7. Обоснование решений

### 7.1 Keyset `(created_at, id)` + `limit + 1`/`nextCursor` + µs

Пагинация должна быть стабильной при вставках: `created_at DESC, id DESC`
даёт полный порядок (id — вторичный ключ при совпадении дат), а условие
`(created_at, id) < (cursor.createdAt, cursor.id)` — строго следующий элемент.
`LIMIT limit + 1` — единственный способ честно сказать «страниц больше нет»,
не доверяя `total`, который меняется при вставках. Рассматривал keyset только
на `created_at` — при совпадении меток он терял бы/дублировал строки (ровно та
же проблема, что у offset). Условие записано через `or/and` с
`::timestamptz`-кастом, а не row-comparison SQL: план тот же,
`or/and` проще читать и не требует ручного `sql`-фрагмента для всего условия.

**µs-точность — не деталь, а часть корректности.** `timestamptz` хранит
микросекунды, а JS `Date` — только миллисекунды; если положить `Date` в курсор,
сравнение `created_at = cursor.createdAt` перестаёт совпадать, и tie-break по
`id` не работает (verifier воспроизвёл на двух строках в одной миллисекунде).
Поэтому курсор несёт ISO-строку, которую отдаёт `to_char(... 'US')` в том же
SELECT, а фильтр приводит её к `timestamptz` на стороне PostgreSQL. Старые
ms-курсоры декодер принимает — совместимость при деплое без ожидания
перезагрузки страниц. Оговорка: у старого `.123Z`-курсора сравнение остаётся
ms-lossy (на границе деплоя одна страница может пропустить соседа в той же
миллисекунде); новые курсоры всегда несут 6 цифр, и это разовое окно.

### 7.2 `RunSummary.cursor` сохранён, хотя UI его не использует

Задача явно требовала «обнови `RunSummary`», поэтому курсор элемента оставлен.
Он полезен для диагностики и точечной догрузки («дай всё после этого запуска»),
но навигация UI идёт по `nextCursor` (KI-549 — зафиксированная избыточность).
Удалять поле до мажорного релиза не стал: это было бы второе ломающее
изменение контракта в одном срезе.

### 7.3 Кнопка «Загрузить ещё», а не бесконечный скролл

Задача допускала оба варианта. Кнопка: доступна с клавиатуры (Tab+Enter),
тривиально тестируется в jsdom и CDP, не требует IntersectionObserver и не
плодит запросы при скролле. Догрузка дописывает страницу и дедуплицирует по
`id`; ошибка догрузки показывается отдельно, не затирая уже загруженный список.

### 7.4 F5: `preserveRunIdInUrl`, а не отдельный `?historyRunId=`

Альтернатива — новый параметр для истории. Но тогда `loadWorkflowAsync`
пришлось бы учить двум параметрам, а ссылки после F5 стали бы «двойными».
Флаг в `restoreRunAsync` минимален: поведение по умолчанию не меняется
(живой запуск после `run_completed` по-прежнему чистит URL — иначе F5
подписывался бы на завершённый запуск), а история и загрузка по URL сохраняют
параметр. Клик в модалке делает `replaceState` сразу (`setRunIdInUrl`) — шанс
на восстановление есть даже до ответа `restoreRunAsync`.

### 7.5 Один неймспейс `status.*` вместо трёх групп

Статусы — одна доменная сущность: run и node различаются только наличием
`skipped`. Отдельные `run.status.*`/`history.status.*` разъезжались по текстам
(«Готово»/«завершён»/«Завершён»). Свёл к `status.*` и выбрал нейтральные
подписи; `status.attempt` остался параметризованным, `status.label` заменяет
`history.status_label`. Удаление `history.prev/next/page` — следствие перехода
на keyset (страницы больше не считаются).

### 7.6 Контракт-гейт через Zod-схему домена

Контракт KI-352 сравнивает **состав полей**, а enum-домены (KI-440) требуют
источника значений. Для web-search backend-ответы — TS-интерфейсы, у них нет
runtime-домена. Добавлять отдельный `literal-union`-тип значило бы дублировать
`WEB_SEARCH_PROVIDER_NAMES`. `z.enum(WEB_SEARCH_PROVIDER_NAMES)` в
`web-search.interface.ts` — runtime-источник, который уже используется env и
узлом; спеки читают `options` (backend) и своё зеркало (web). Проверки
«в ответе нет `apiKey`/`token`» добавлены явно, чтобы контракт не закрепил
утечку.

### 7.7 WARN в `buildStdioEnv`, а не в `parseStdioEnvAllowlist`

`parseStdioEnvAllowlist` не знает ни окружения, ни per-server `env` — она видит
только строку. Место, где известны оба источника значения, — `buildStdioEnv`
перед созданием транспорта. WARN по именам (не значениям) и один раз на сервер:
это операторская диагностика, а не поток на каждое переподключение. Дублирование
`Set`-а по образцу `warnedNonDocker` сохраняет единый стиль логов.

### 7.8 Тесты: контрактные границы и поведение

Курсор тестируется и как чистая функция (round-trip, мусор), и через схему
(400), и через сервис (SQL-ветки, `limit + 1`, невалидная дата). UI-тесты
проверяют следствия (`nextCursor` → догрузка/конец), а не внутренние состояния.
Контракт проверяется с обеих сторон, чтобы правка JSON не могла «подогнать»
одну сторону. MCP WARN — тест на факт одного предупреждения и отсутствие
значений (RULES 5.1).

### 7.9 Смоук: реальный API + реальный браузер

Keyset-смоук проверяет главный сценарий KI-542 на живой PostgreSQL: вставка
нового запуска между страницами. CDP-смоук даёт то, чего нет в jsdom: реальный
Vite-прокси, JWT-сессию, Tailwind-рендер, `innerText`, F5 и адресную строку.
MCP-смоук проверяет лог живого backend'а, а не только unit-мок логгера.
Ограничения (данные в БД напрямую, фиктивный MCP-процесс) описаны в § 4.4, а не
выданы за полное e2e.

### 7.10 Процесс

Ни одного `git add`/`git commit` не выполнено (жёсткое правило задачи);
`git add -A` не использовался. Итоговый diff — только фича и документация;
предсуществующих правок в дереве не было (кроме появившегося внешнего
untracked `docs/development/v1.0/`, § 3.8). Код и тесты проверены независимым
verifier-агентом: первый аудит — **PASS WITH NITS** (0 blocker, 0 major),
найденный µs-баг и nits исправлены до финальных прогонов (§ 3.12); повторный
аудит delta — **PASS** (гейты перепроверены независимо). Смоуки — 24/24, 25/25
и WARN-1.
