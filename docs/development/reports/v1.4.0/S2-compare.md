---
title: "S2: History Comparison — сравнение двух запусков (v1.4.0)"
date: 2026-11-08
version: v1.4.0
steps: [S2]
status: accepted
related_ki: [KI-638, KI-639, KI-640]
related_adr: []
---

# Отчёт S2 — History Comparison (v1.4.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **124 passed (128 файлов),
1939 passed / 24 skipped (1963)**, `pnpm test:parity` — **13/13**,
`pnpm test:e2e` — **1/1**, web — **55 файлов / 508 тестов**, `pnpm --dir web build`
— success (392 модуля). Смоук на живом приложении — **9/9 PASS**: два запуска
одного workflow (3 и 2 узла), diff outputs, узел только в первом запуске,
дельты, чужой 404, невалидный uuid 400.

**Точка старта.** HEAD `7800cb9` («feat(v1.4.0): S1 — Cancel Run»), CI зелёный,
`package.json` = `1.3.0`. Источник — `docs/development/v1.4/DESIGN_V140_FEATURES.md`
§ 3.2, правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** `GET /runs/:id1/compare/:id2` (JWT, owner/editor для обоих
запусков), `RunsService.compareRunsAsync` (объединение `node_runs` по `nodeId`,
`status1/2`, `duration1/2`, `cost1/2`, `outputsDiff {changed, onlyRun1,
onlyRun2}` с лимитом 100 КБ, `totalDiff` — дельты `run2 − run1`), контракт
`RunCompareResponse`/`NodeDiff`/`RunCompareTotalDiff`, `RunCompareModal`
(side-by-side таблица, красный/зелёный), чекбоксы двух запусков и кнопка
«Сравнить» в `RunHistoryModal`, i18n `compare.*`. Новые ограничения —
KI-638..640.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/runs/dto/run-compare.dto.ts](../../../../src/runs/dto/run-compare.dto.ts) *(new)* | 89 | `NodeDiff`, `RunCompareTotalDiff`, `RunCompareResponse`, `MAX_COMPARE_DIFF_BYTES = 100 КБ`; JSDoc о `null` для отсутствующего узла и разделении валют |
| [web/src/components/RunCompareModal.tsx](../../../../web/src/components/RunCompareModal.tsx) *(new)* | 550 | модалка сравнения: загрузка/ошибка/retry, шапка двух запусков, суммарные дельты, `<table>` nodeId/status/duration/cost/diff, подсветка better/worse |
| [web/src/components/RunCompareModal.spec.tsx](../../../../web/src/components/RunCompareModal.spec.tsx) *(new)* | 177 | 3 теста: таблица и diff outputs, подсветка статусов, ошибка + retry |
| [web/src/lib/run-status-meta.ts](../../../../web/src/lib/run-status-meta.ts) *(new)* | 62 | общий словарь `RUN_STATUS_META`/`NODE_RUN_STATUS_META` (вынесен из RunHistoryModal: история и сравнение не расходятся в иконках/цветах) |
| [docs/development/reports/v1.4.0/S2-compare.md](S2-compare.md) *(new)* | — | этот отчёт (7 разделов, RULES 2.15/2.18) |

Артефакты смоука (gitignored, `.smoke/`): `v140-s2-compare-smoke.mjs` (354
строки — регистрация, два запуска, PATCH графа, 9 проверок, уборка),
`v140-s2-compare-smoke.json` (111 строк), `v140-s2-backend.log`.

### 1.2 Production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/runs/runs.service.ts](../../../../src/runs/runs.service.ts) | +303/−1 | `compareRunsAsync` (Promise.all двух `getRunRowAsync(..., 'editor')`, один `SELECT node_runs` по `inArray`, объединение узлов, diff outputs, суммы), `buildOutputsDiff`, `truncateDiff`, `buildNodeDiff`, `sumNodeCost` |
| [src/runs/runs.controller.ts](../../../../src/runs/runs.controller.ts) | +54/−1 | `GET /runs/:id1/compare/:id2`, `CompareRunsParamSchema` (два uuid, отдельные сообщения), `Cache-Control: no-store` |
| [src/runs/dto/index.ts](../../../../src/runs/dto/index.ts) | +1/−0 | реэкспорт `run-compare.dto.js` |
| [web/src/components/RunHistoryModal.tsx](../../../../web/src/components/RunHistoryModal.tsx) | +99/−51 | чекбоксы выбора (id, максимум 2), кнопка «Сравнить» (disabled без пары), `comparePair`, вложенная `RunCompareModal`, Escape не закрывает обе модалки; локальный словарь статусов заменён импортом `RUN_STATUS_META` |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +86/−0 | `NodeDiffSchema`, `RunCompareTotalDiffSchema`, `RunCompareResponseSchema`, `compareRunsAsync` |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +18/−0 | `compare.*`, `history.select_run`, `history.compare`, `history.compare_hint` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +18/−0 | те же ключи (RULES 1.14) |

**Итого production:** **+1280/−53** (включая новые файлы 89+550+62 строк).

### 1.3 Тесты

| Файл | +/− | Прирост |
|---|---:|---|
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +215/−1 | +4 теста: полное сравнение (diff, дельты, суммы, only-run узел), editor-доступ к обоим, 404 без чтения `node_runs`, обрезка 100 КБ |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +67/−0 | +4 теста: 200 + access + no-store, 404, 400 (оба uuid), 401 |
| [src/runs/dto/api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +64/−0 | `RunCompareResponse`/`NodeDiff`/`RunCompareTotalDiff` в `DTO_SOURCES`, отдельный тест состава |
| [web/src/components/RunHistoryModal.spec.tsx](../../../../web/src/components/RunHistoryModal.spec.tsx) | +64/−2 | +1 тест: выбор двух запусков, disabled третьего, открытие сравнения и вызов API |
| [web/src/components/RunCompareModal.spec.tsx](../../../../web/src/components/RunCompareModal.spec.tsx) | 177 *(new)* | +3 теста |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +48/−0 | зеркала трёх DTO + отдельный тест сравнения |

**Итого тесты:** **+635/−3**, **+14 тестов** (backend +9: 4+4+1;
web +5: 3+1+1).

### 1.4 Документация и контракт

| Файл | +/− | Что |
|---|---:|---|
| [docs/development/api-contract.json](../../../api-contract.json) | +4/−1 | `RunCompareResponse`, `NodeDiff`, `RunCompareTotalDiff`; обновлён `$comment` |
| [README.md](../../../../README.md) | +7/−0 | пункт «Сравнение запусков (v1.4.0 S2)» |
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +13/−0 | `[Unreleased] → Added`: S2, ссылка на отчёт, KI-638..640 |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +49/−24 | KI-638..640, удалены три кратких дубля KI-635..637 из S1-коммита, сводка пересчитана: 627 записей, `Documented 55` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | строка v1.4.0 S2 |

**Итого документация/контракт:** +74/−25 плюс этот отчёт.

**Общий итог (tracked `git diff --numstat`):** **+1111/−81**; новые
untracked-файлы — **878 строк** (`run-compare.dto.ts` 89, `RunCompareModal.tsx`
550, его spec 177, `run-status-meta.ts` 62), плюс этот отчёт. С учётом новых
файлов — **+1989/−81**. Смоук-артефакты gitignored.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` | **124 passed / 4 skipped (128 файлов)**, **1939 passed / 24 skipped (1963)**, ~35 с |
| `pnpm test:parity` | **13/13** |
| `pnpm test:e2e` | **1/1** (`AppModule` bootstrap) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — преэкзистующие `openai-images.provider.spec.ts` (чужие файлы) |
| `pnpm --dir web build` | success, **392 modules** (было 390), `tsc -b` + Vite |
| `pnpm --dir web test` | **55 файлов / 508 тестов passed** (было 54/503) |
| Целевой backend-прогон | 3 файла / **93 теста** (`runs.service`, `runs.controller`, `runs.dto/api-contract`) |
| Смоук (живое приложение) | **9/9 PASS, 0 FAIL** |

Скипнутые 24 теста — преэкзистующие DB/интеграционные (`schema-parity` без
`--env-file`, `media-storage.integration`, `vector-store.integration`,
`backfill-organizations`, OpenAI Images без ключа). Миграций в S2 нет:
изменения — только API/UI/контракт.

---

## 3. Диагностика

### 3.1 Сколько запросов делает сравнение

`compareRunsAsync`:
1. `Promise.all` двух `getRunRowAsync(id, access, 'editor')`; каждый — один
   `SELECT workflow_runs` плюс **два** подзапроса в
   `accessibleWorkflowIdsSubquery` (`EXISTS` участника + сам `SELECT
   workflows`), итого 6 `select`-вызовов в моке;
2. один `SELECT node_runs` по `inArray(runId, [id1, id2])` с `ORDER BY
   node_id`.

Итого **7** `db.select`-вызовов на сравнение. Тест
`чужой/несуществующий…` фиксирует, что при 404 седьмой запрос (node_runs) не
выполняется: доступ проверяется до чтения outputs.

### 3.2 Объединение узлов, а не пересечение

`nodeIds` — `Set` из `nodeId` всех строк обоих запусков, отсортированный
`localeCompare`. Узел, который был только в одном запуске (граф изменился или
первый запуск остановился раньше), получает `status2: null`,
`duration2: null`, `cost2: null` — это различие, а не повод его скрыть. В
смоуке run2 создан после `PATCH` графа без `n3`, и `n3` честно попал в
`nodeDiffs` с `status1='completed'`, `status2=null`.

### 3.3 Формат `outputsDiff`

Полная копия двух outputs раздувала бы ответ и плохо читалась. Выбран
структурированный diff:

```json
{
  "changed": { "text": { "run1": "first", "run2": "first-v2" } },
  "onlyRun1": {},
  "onlyRun2": {}
}
```

Ключи сортируются, значения — исходные JSONB-значения. Если outputs равны
(`isDeepStrictEqual`), поле `outputsDiff` **отсутствует**, и UI пишет
«Различий нет». Так клиент не путает «diff пустой» и «diff не считался».

### 3.4 Лимит 100 КБ и обрезка по UTF-8

`truncateDiff` проверяет `Buffer.byteLength`, а режет строку бинарным поиском
по границе code units так, чтобы `text.slice(0, low) + marker` уложился в
100 КБ. Маркер `… [diff обрезан: лимит 100 КБ]` **входит** в лимит. Простой
`Buffer.subarray` мог бы разрезать многобайтовый символ и дать лишние байты
замены; для кириллицы/эмодзи это реально. Тест подаёт 200 КБ текста и
проверяет `<= MAX_COMPARE_DIFF_BYTES` и наличие пометки.

### 3.5 Третий контрактный DTO: `RunCompareTotalDiff`

В промпте минимально требовались `RunCompareResponse` и `NodeDiff`. Поля
`durationMs`/`costUsd`/`costRub` лежат во вложенном `totalDiff`; без отдельного
DTO они выпадали бы из field-level гейта. Добавлен `RunCompareTotalDiff` в
`api-contract.json`, backend-`DTO_SOURCES` и web-`MIRROR_SCHEMAS` — теперь все
три уровня ответа сравнения сверяются одинаково (RULES 2.14/4.15, KI-352).

### 3.6 `RunSummary.cursor` в ответе сравнения

`run1`/`run2` переиспользуют `RunSummary` истории — это единственная готовая
проекция с датами, длительностью и суммами. Побочный эффект — поле `cursor`
(keyset-пагинация) в ответе сравнения, где навигация не нужна. Вынесено в
KI-640; отдельный `RunCompareSummary` потребовал бы нового DTO и правок
гейта, что больше scope S2, чем польза.

### 3.7 Семантика подсветки

`NODE_RUN_STATUS_META` даёт иконку/цвет/подпись, `statusRank` — «что лучше»:
`completed > running > pending > skipped > failed > cancelled > null`.
Длительность и стоимость сравниваются как «меньше — лучше». Ячейка «лучше» —
зелёная, «хуже» — красная, равные — нейтральные. Для статусов при равенстве
показывается обычный бейдж статуса (не зелёный фон), чтобы одинаковые строки
не выглядели «победившими».

### 3.8 Ложный FAIL первого смоука

Первый прогон дал 8/9: проверка №5 искала `'middle-v2'` в diff узла `n1`,
хотя `n2` — отдельный узел. Это ошибка smoke-скрипта, а не API: diff `n1`
корректно содержал `first`/`first-v2`. Проверка исправлена, повторный прогон —
9/9. Урок: assertions смоука должны адресовать конкретный `nodeId`, а не
«где-то в ответе».

### 3.9 Дубли KI-635..637 в S1-коммите

На HEAD `7800cb9` `docs/KNOWN_ISSUES.md` содержал **627** заголовков `### KI-`
при **624** уникальных номерах: после подробных записей KI-635..637 шли три
кратких дубля. Сводка при этом утверждала 624. Дубли удалены в S2 (подробные
записи сохранены), после чего добавлены KI-638..640 — снова **627** записей,
номера уникальны. Сводка пересчитана grep'ом (RULES 3.20).

### 3.10 Инфраструктура и порт

Для миграций/смоука подняты ранее остановленные контейнеры
`workflow-builder-db`/`workflow-builder-redis` (`docker start`), backend —
`node dist/main.js` на **3101** (`PORT=3101`, `AUTH_DISABLED=false`), чтобы не
занимать 3000. После прогона backend и контейнеры остановлены.

### 3.11 Escape и две модалки

`RunHistoryModal` и `RunCompareModal` слушают `Escape` на `window`. История
проверяет `comparePair === null` и при открытом сравнении не закрывается;
сравнение закрывает только себя. Иначе одно нажатие закрывало бы обе модалки
(и пользователь терял бы список).

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder`, Redis
`127.0.0.1:6379`, backend — `node dist/main.js` на **3101**,
`AUTH_DISABLED=false`. Скрипт: `.smoke/v140-s2-compare-smoke.mjs`; прогон
**9/9 PASS, 0 FAIL**, артефакт `.smoke/v140-s2-compare-smoke.json`.

**Сценарий.** Регистрация owner и foreign. Workflow из трёх `text`-узлов
(`n1 → n2 → n3`, значения `first/middle/last`) → **run1**. `PATCH /workflow/:id`
меняет значения на `first-v2/middle-v2` и удаляет `n3` → **run2** (два узла).
Оба запуска завершаются `completed`. Затем `GET
/runs/:id1/compare/:id2`, проверка структуры, `Cache-Control`, чужой доступ и
невалидный uuid.

| # | Проверка | Факт |
|---|---|---|
| 1 | Первый запуск | `completed` за **56 мс** |
| 2 | Второй запуск | `completed` за **54 мс** |
| 3 | `GET /runs/:id1/compare/:id2` | **200**, `Cache-Control: no-store` |
| 4 | `run1`/`run2` и узлы | `run1=1f0357db-…`, `run2=96b2f39a-…`, `nodeDiffs=[n1,n2,n3]` |
| 5 | `outputsDiff` n1 | `changed.text.run1="first"`, `run2="first-v2"` |
| 6 | Узел n3 только в run1 | `status1=completed`, `status2=null`, `cost2=null`, `onlyRun1.text="last"` |
| 7 | `totalDiff` | `durationMs=-11`, `costUsd=0`, `costRub=0` (дельты `run2 − run1`) |
| 8 | Чужой пользователь | **404** (`Запуск … не найден`) |
| 9 | Невалидный uuid | **400** (`id1 должен быть валидным UUID`) |

**Фрагмент `outputsDiff` n1 (из ответа):**

```json
{
  "changed": {
    "text": {
      "run1": "first",
      "run2": "first-v2"
    }
  },
  "onlyRun1": {},
  "onlyRun2": {}
}
```

**Фрагмент n3:**

```json
{
  "nodeId": "n3",
  "status1": "completed",
  "status2": null,
  "outputsDiff": "{\n  \"changed\": {},\n  \"onlyRun1\": {\n    \"text\": \"last\"\n  },\n  \"onlyRun2\": {}\n}",
  "duration1": 1,
  "duration2": null,
  "cost1": 0,
  "cost2": null
}
```

**Уборка.** Обе smoke-организации удалены каскадом
(`DELETE FROM organizations WHERE id = $1`); workflow/запуски/`node_runs`
ушли вместе с ними. Backend остановлен, контейнеры DB/Redis возвращены в
`Exited`.

**UI-уровень.** Живого CDP-смоука не было: `RunCompareModal` проверен 3
тестами (таблица, подсветка, ошибка/retry), `RunHistoryModal` — тестом выбора
двух запусков и открытия сравнения. Браузерный смоук (CDP + скриншот) —
кандидат на S4.

---

## 5. Что не так

1. **Рублёвая стоимость media-узла не видна в поузловом diff (KI-638, 🟢
   Low).** `cost1`/`cost2` — только USD; media-узлы с `cost_rub` показываются
   как `$0.0000`, хотя `totalDiff.costRub` считается правильно. Пользователь
   может решить, что узел был бесплатным.
2. **Лимит 100 КБ — на один `outputsDiff`, не на ответ (KI-639, 🟢 Low).**
   Граф из сотен узлов с большими outputs может отдать десятки мегабайт;
   лимита на весь `RunCompareResponse` нет.
3. **`run1`/`run2` содержат `cursor` (KI-640, 🟢 Low).** Поле keyset-истории
   в сравнении не нужно; это цена переиспользования `RunSummary`.
4. **Нет виртуализации таблицы.** `RunCompareModal` рендерит все
   `nodeDiffs` сразу. Для графа 1000+ узлов DOM будет тяжёлым; лимит здесь не
   помогает, потому что ограничивает размер строки, а не число строк.
5. **Сравнение не ограничено терминальными запусками.** `compareRunsAsync`
   не проверяет `status`: можно сравнить `running`/`pending` запуски. Это
   осознанно (diff доступен сразу), но `totalDiff.durationMs` тогда `null`, а
   `nodeDiffs` меняется между запросами.
6. **`RunCompareModal` запрашивает данные при каждом открытии.** Кэша нет:
   повторное открытие той же пары — ещё один запрос к БД. Для модалки это
   нормально, но при частом переключении — лишняя нагрузка.
7. **`RunCompareModal` — 550 строк.** Компонент получился большим: форматтеры,
   тон/ранг, шапка, таблица. Дробить на `RunCompareTable`/`RunCompareHeader`
   в S2 не стали, чтобы не плодить файлы; при следующем UI-срезе стоит вынести.
8. **`outputsDiff` — JSON-строка, а не структура.** UI не может, например,
   свернуть отдельные изменённые ключи без парсинга JSON. Плюс — контракт
   простой, минус — гибкость; структурированный diff — задача при
   необходимости.
9. **`status1`/`status2` — `NodeRunStatus` (включая `skipped`), а не
   `RunStatus`.** Это правильно для узлов, но контракт `NodeDiff` не имеет
   enum-домена в `api-contract.json`: значения статусов не гейтятся
   enum-секцией (в отличие от `RunResponse.status`). Причина — nullable-поля;
   при желании можно добавить отдельный enum для не-null значений.
10. **Смоук-скрипт gitignored.** `.smoke/` не попадает в репозиторий;
    воспроизвести прогон можно только на машине с DB/Redis и backend'ом.
11. **Первый смоук дал 8/9 из-за ошибки проверки**, а не API (см. § 3.8).
    После исправления — 9/9; скрипт не перезапускался на «старом» ответе.
12. **Дубли KI-635..637 в S1-коммите.** Удалены; сводка пересчитана. Это
    исправление чужого docs-дефекта в рамках S2 (RULES 3.20), а не новая
    функциональность.
13. **`pnpm lint` — 2 преэкзистующих warning'а** в
    `openai-images.provider.spec.ts` (чужие файлы). Новых warning'ов нет.
14. **Коммитов нет.** Изменено 17 файлов + 4 новых исходника + отчёт
    (untracked). `git add -A` не использовался.
15. **`RunHistoryModal` немного потяжелел**: чекбоксы и футер с двумя
    действиями. На узких экранах (KI-628) футер может переполняться; это
    существующий долг TopBar/истории, отдельный KI не заводился.

---

## 6. Новые KI

Всего **3** новых записи (KI-638..640), все — 🟢 Low / Documented. Реестр
пересчитан grep'ом (RULES 3.20): **627** записей, 627 статусов, номера
уникальны; `Documented` = 55. Дополнительно удалены три кратких дубля
KI-635..637, оставшиеся в S1-коммите.

| KI | Приоритет | Статус | Тема |
|---|---|---|---|
| [KI-638](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Рублёвая стоимость media-узла не видна в поузловом diff (`cost1/2` — только USD) |
| [KI-639](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Лимит 100 КБ действует на один `outputsDiff`, а не на весь ответ сравнения |
| [KI-640](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `RunCompareResponse.run1/run2` содержат лишний `cursor` keyset-пагинации |

Закрытых KI в S2 нет: это новая функциональность.

---

## 7. Обоснование решений

1. **`GET /runs/:id1/compare/:id2`, а не `POST /runs/compare`.** Сравнение —
   чистое чтение, поэтому GET идемпотентен, кэшируется на уровне прокси (мы
   ставим `no-store` из-за авторизованных данных) и не требует body. Путь
   повторяет DESIGN § 3.2 буквально.
2. **Доступ `editor` для обоих запусков.** Сравнение отдаёт outputs — тот же
   класс данных, что история узлов (`GET /runs/:id/nodes`), которая требует
   `editor` (R7.6). Проверять одного владельца и «второй тоже свой» отдельным
   запросом значило бы два разных правила доступа; `getRunRowAsync(...,
   'editor')` даёт единый 404 на чужой/`viewer`.
3. **Переиспользование `RunSummary`.** UI уже умеет форматировать эту
   проекцию (даты, длительность, USD/RUB), поэтому `run1`/`run2` — те же
   поля. Дублировать DTO ради удаления `cursor` — лишний контракт; цена
   зафиксирована в KI-640.
4. **Объединение `node_runs`, а не пересечение.** Различие «узел был только в
   одном запуске» — самое важное при сравнении упавшего и успешного прогона.
   Пересечение скрыло бы именно его.
5. **`null` для отсутствующего узла, а не `0`.** «Узла не было» и «узел
   выполнился за 0 мс бесплатно» — разные факты; `null` позволяет UI показать
   «—» и не врать.
6. **Структурированный diff `{changed, onlyRun1, onlyRun2}`.** Полные копии
   outputs в два раза больше и не отвечают на вопрос «что изменилось».
   Структура также даёт стабильный порядок ключей и позволяет UI в будущем
   рендерить не только `<pre>`.
7. **Лимит 100 КБ на строку diff.** DESIGN § 7 прямо просит лимит на diff;
   строка — единица, которую видит пользователь. Обрезка с явной пометкой
   лучше, чем молчаливый обрезанный JSON. Глобальный бюджет — KI-639.
8. **Обрезка по UTF-8, а не по длине `String`.** Кириллица/эмодзи занимают
   больше одного байта; `Buffer.subarray` мог бы разрезать символ. Бинарный
   поиск по code units + проверка `Buffer.byteLength` даёт точный лимит.
9. **`totalDiff` — дельты `run2 − run1`, а не два набора чисел.** UI
   показывает «насколько второй отличается от первого»; знак и цвет
   (красный рост / зелёный снижение) читаются сразу. Для `durationMs`
   `null`, если хотя бы один запуск не завершён: вычитать «неизвестно»
   нельзя.
10. **Стоимость узла — USD, сумма — USD+RUB.** DESIGN § 3.2 говорит
    «сравнение по costUsd»; валюты не смешиваются (RULES 4.23), рублёвая
    сумма живёт в `totalDiff.costRub`. Ограничение видимости media-узлов —
    KI-638.
11. **`Promise.all` для двух запусков.** Запуски независимы; последовательное
    чтение удвоило бы задержку без пользы (RULES 4.17).
12. **Один `SELECT node_runs` на оба запуска.** `IN (id1,id2)` + `ORDER BY
    node_id` дешевле двух запросов и сразу даёт детерминированный порядок
    таблицы; суммы считаются в памяти по тем же строкам, без отдельного
    агрегата.
13. **`RunCompareTotalDiff` добавлен в контракт.** Без него три поля
    `totalDiff` не покрывались field-level гейтом; S2 получил полный паритет
    (backend ↔ JSON ↔ web) вместо «двух из трёх».
14. **Общий `run-status-meta.ts`.** История и сравнение должны показывать
    один статус одинаково. Импорт словаря из `RunHistoryModal` создал бы
    цикл (`History → Compare → History`), поэтому словарь вынесен в `lib` —
    и заодно удалён 48-строчный дубль.
15. **Выбор запусков — в `RunHistoryModal`, а не в `RunCompareModal`.**
    Модалка сравнения получает готовые `runId1`/`runId2` и не знает про
    список/историю. Это позволяет открыть её из другого места (например,
    будущей страницы сравнения) без переделки.
16. **Порядок выбора задаёт порядок колонок.** Первый выбранный — `run1`,
    второй — `run2`, поэтому «эталон → новый» можно направить в нужную
    сторону. Хранятся id, а не объекты: догрузка/перезагрузка страницы не
    сбрасывает выбор.
17. **Третий чекбокс disabled, а не «заменяет первый».** Пользователь явно
    снимает выбор, чтобы поменять пару; скрытая замена первого была бы
    неожиданной. Кнопка «Сравнить» всегда видна, но disabled без пары — не
    прыгает по высоте.
18. **Escape-слои.** История не закрывается, пока открыто сравнение; иначе
    одно нажатие уничтожало бы обе модалки и контекст. Проверка — в
    `useEffect` истории по `comparePair`.
19. **Ошибка сравнения — отдельный retry.** Запрос идёт при открытии; сеть
    может упасть. `reloadKey` перезапускает эффект, не закрывая модалку, —
    пользователь не теряет выбор.
20. **Тесты — на fake DB с фиксированной последовательностью `select`.**
    `compareRunsAsync` делает 7 запросов (6 доступа + node_runs); тест
    фиксирует и положительный путь, и «при 404 node_runs не читается».
    Реальная БД в юнит-тесте не нужна: схема и миграции покрыты
    `schema-parity`/e2e.
21. **Смоук — два запуска одного workflow с `PATCH` между ними.** Это
    воспроизводит реальный сценарий «граф изменился» и даёт и diff outputs, и
    узел только в первом запуске без ручных вставок в БД.
22. **Дубли KI удалены, а не «оставлены до релиза».** Сводка S1 утверждала
    624 при 627 заголовках — ровно класс ошибки, который RULES 3.20 требует
    ловить grep'ом. Исправление заняло одну правку и вернуло реестр в
    согласованное состояние; S2-записи добавлены уже поверх чистых 624.
23. **Отчёт — 7 разделов без сокращения (RULES 2.15), сохранён в
    `reports/v1.4.0/` (RULES 2.18).** Ссылка — в `CHANGELOG.md`;
    `reports/README.md` обновлён строкой S2.
