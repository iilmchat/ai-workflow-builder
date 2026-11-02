---
title: "S1: Run History API (GET /workflow/:id/runs)"
date: 2026-11-02
version: v0.14.0
steps: [S1]
status: accepted
related_ki: [KI-537, KI-538, KI-539, KI-540]
related_adr: []
---

# Отчёт S1 — Run History API

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались вовсе, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **102 файла passed /
3 skipped, 1492 passed / 18 skipped** (+14 тестов к HEAD), `pnpm --dir web test`
— **50/50, 425/425** (+1 тест), `pnpm --dir web exec tsc -b` — **0**,
`pnpm lint` — **0 errors / 2 warnings** (оба преэкзистующие, см. § 5.7).
Smoke на локальной PostgreSQL 5433 + реальном `node dist/main` — **39/39**.

**Точка старта.** HEAD `dc90c1c` («feat(v0.13.0): MCP Hardening & UI»),
версия `0.13.0`, CI v0.13.0 зелёный. Источник — `docs/development/v0.14/
DESIGN_V014_FEATURES.md` (v1.0, § 3.1), правила — `docs/development/RULES.md`
v1.10.0. Репозиторий фактически лежит в `C:\Projects\AI\ai-workflow-builder`;
путь `D:\Projects\AI\workflow-builder` из промпта не существует (см. § 5.4).

---

## 1. Файлы (+/−)

### 1.1 Backend (API)

| Файл | +/− | Что |
|---|---:|---|
| [src/runs/dto/run-history.dto.ts](../../../../src/runs/dto/run-history.dto.ts) *(new)* | +90/−0 | `RunSummary`, `RunHistoryResponse` (TS-интерфейсы — контракт читает их AST), `DEFAULT_RUN_HISTORY_LIMIT = 20`, `MAX_RUN_HISTORY_LIMIT = 100`, `RunHistoryQuerySchema`/`RunHistoryQueryDto` (`z.coerce` для `limit`/`offset`) |
| [src/runs/runs.service.ts](../../../../src/runs/runs.service.ts) | +196/−2 | `listRunsAsync(workflowId, userId, limit, offset)` — проверка доступа owner/editor → `count(*)` → страница `createdAt DESC, id DESC` → суммы `node_runs` только для id страницы; `toRunSummary` (durationMs, costUsd/costRub), локальный `toAmount`; интерфейсы `RunHistoryRow`/`RunCostRow` |
| [src/runs/runs.controller.ts](../../../../src/runs/runs.controller.ts) | +58/−0 | `RunsHistoryController` (`@Controller('workflow/:id/runs')`, `@Get()`, `@Header('Cache-Control','no-store')`, `JwtAuthGuard`, Zod на param+query) |
| [src/runs/runs.module.ts](../../../../src/runs/runs.module.ts) | +5/−2 | регистрация `RunsHistoryController` в `RunsModule` |
| [src/runs/dto/index.ts](../../../../src/runs/dto/index.ts) | +1/−0 | реэкспорт `run-history.dto.js` |

### 1.2 Контракт и тесты (backend)

| Файл | +/− | Что |
|---|---:|---|
| [docs/development/api-contract.json](../../../../docs/development/api-contract.json) | +5/−2 | `RunHistoryResponse ["runs","total"]`, `RunSummary` (8 полей), enum `RunSummary.status` (домен `WORKFLOW_RUN_STATUSES`); `$comment` дополнен новыми TS-интерфейсами |
| [src/runs/dto/api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +40/−0 | `RUN_HISTORY_DTO_PATH`, DTO-источники `RunHistoryResponse`/`RunSummary` (AST-разбор интерфейсов), enum-источник `RunSummary.status`; регрессия «история не отдаёт snapshot/inputs/outputs/error» |
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +238/−1 | +6 тестов `listRunsAsync`: формат/агрегаты, 404 без чтения истории, пустая страница + `total`, отсутствие `node_runs` → 0, clamp `limit`/`offset`, неотрицательный `durationMs`; хелпер `stubSelects` под 5 вызовов builder'а; spy-мок `workflowAccessFilter` пиннит роль `editor` |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +106/−3 | +7 тестов `RunsHistoryController`: 200 + форма, `limit`/`offset` из query, 404 чужого, 400 uuid/limit/offset, 401 без токена, отсутствие коллизий маршрутов |

### 1.3 Web (зеркала контракта)

| Файл | +/− | Что |
|---|---:|---|
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +43/−0 | `RunSummarySchema` (+ `ApiRunSummary`), `RunHistoryResponseSchema` (+ `ApiRunHistoryResponse`), JSDoc; fetch-функция не добавлялась — это S2 |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +26/−1 | зеркала в `MIRROR_SCHEMAS`, регрессия «поля = контракт, enum статусов = контракт» |

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [README.md](../../../../README.md) | +6/−0 | пункт «История запусков (v0.14 S1)» в разделе «Выполнение» |
| [docs/CHANGELOG.md](../../../../docs/CHANGELOG.md) | +9/−0 | запись `[Unreleased] → Added` со ссылкой на отчёт |
| [docs/KNOWN_ISSUES.md](../../../../docs/KNOWN_ISSUES.md) | +49/−0 | KI-537..KI-540 |
| [docs/development/reports/README.md](../README.md) | +1/−0 | строка отчёта v0.14.0 S1 |
| [docs/development/reports/v0.14.0/S1-history-api.md](S1-history-api.md) *(new)* | — | этот отчёт |

**Итого:** 14 изменённых tracked-файлов — **+783 / −11**, плюс два новых файла
(`run-history.dto.ts` +90, отчёт). Крупнейшие: `runs.service.ts` (+196/−2),
`runs.service.spec.ts` (+238/−1), `runs.controller.spec.ts` (+106/−3).

Артефакты smoke (gitignored, не deliverable): `.smoke/v014-s1-history-smoke.mjs`,
`.smoke/v014-s1-history-smoke.json`, `.smoke/check-indexes.mjs`.
`docs/development/v0.14/` был untracked ещё до сессии (DESIGN-документ) — я его
не создавал и не трогал.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** (exit 0) · `pnpm typecheck` — **0**
(exit 0) · `pnpm test` — **102 passed / 3 skipped (105 файлов), 1492 passed /
18 skipped (1510)** · `pnpm --dir web test` — **50/50, 425/425** ·
`pnpm --dir web exec tsc -b` — **exit 0** · `pnpm lint` — **0 errors /
2 warnings** (преэкзистующие, § 5.7) · smoke — **39/39** (§ 4).
Прирост к HEAD: **+14 backend-тестов** (`runs.service` 14→20,
`runs.controller` 19→26, `api-contract` 12→13) и **+1 web-тест** (425/425).

---

## 3. Диагностика

### 3.1 Маршрут и место контроллера

DESIGN § 3.1 требует `GET /workflow/:id/runs`, а задача — «добавь в
`RunsController` `@Get()`». В Nest у класса один `@Controller`-префикс, поэтому
`RunsController` (префикс `/runs`) физически не может отдать `/workflow/...`.
Импортировать `RunsService` в `WorkflowController` нельзя: `RunsModule` уже
импортирует `WorkflowModule`, обратный импорт дал бы цикл. Решение — второй
класс `RunsHistoryController` **в том же файле** `runs.controller.ts`, в том же
`RunsModule`, с префиксом `workflow/:id/runs`. Поведение и тесты — ровно те,
что просили; расхождение с буквой «в RunsController» объяснено в § 7.1.

### 3.2 Тестовый двойник Drizzle и EXISTS-подзапрос (6 падений → зелёный)

Первая версия тестов `listRunsAsync` падала: мок `db.select` получал ответы не
в том порядке. Причина — `workflowAccessFilter` строит `EXISTS`-подзапрос
участника через **свой** `db.select()`; это второй вызов builder'а внутри
`where`, который не ожидается через `await`, но в моке занимает ответ. Хелпер
`stubSelects` теперь вставляет пустую заглушку после батча проверки доступа:
`[доступ, EXISTS, count, страница, суммы]` — 5 вызовов вместо 4. Заодно тесты
закрепили, что при 404 история не читается (только доступ + подзапрос), а на
пустой странице агрегат `node_runs` не выполняется.

### 3.3 Откуда берётся `durationMs`

`workflow_runs` не хранит `duration_ms`. `started_at` пишет
`ExecutionEngineService.markRunRunningAsync` при переходе в `running` (а не
просто дата создания), `finished_at` — `finishRunAsync`. Поэтому
`durationMs = max(0, finished_at − started_at)`, `null` пока `finished_at` нет.
Отрицательная разница (рассинхрон часов приложения/БД) приводится к 0, чтобы UI
не показывал «−5 мс». Ограничение: у запусков, упавших **до**
`markRunRunningAsync`, `started_at` = времени создания (DEFAULT now()) — см.
KI-539.

### 3.4 Стоимость запуска — агрегат по `node_runs`

`cost_usd`/`cost_rub` есть только у `node_runs`, поэтому стоимости считаются
`coalesce(sum(...), 0) GROUP BY run_id` **только для id текущей страницы**
(`IN (...)`); `total` берётся отдельным `count(*)`. Почему не один join с
`GROUP BY`: при `LIMIT/OFFSET` пришлось бы группировать всю историю, а на
пустой странице `total` терялся бы. Почему стоимости — `number`, не `null`:
запуск без строк `node_runs` тратит 0, UI не должен различать «нет данных» и
«ноль» (в отличие от `durationMs`, где `null` = «ещё не завершён»).

### 3.5 Контракт требует web-зеркало, хотя S1 — backend

`api-contract.spec.ts` (backend) и `web/src/lib/api-contract.spec.ts` требуют
**точного равенства ключей** `responses` с JSON. Добавить `RunHistoryResponse`/
`RunSummary` только на backend значило бы оставить web-spec красным. Поэтому
зеркала добавлены сразу (Zod-схемы в `web/src/lib/api.ts`), хотя UI-потребитель
появится в S2 — это дешевле, чем рассинхрон контракта (класс KI-352).

### 3.6 Smoke-окружение

На старте сессии Docker Desktop был выключен, Postgres 5433/Redis 6379 — не
слушали. Поднял Docker Desktop; контейнеры `workflow-builder-db`,
`workflow-builder-redis` (в `docker-compose.yml` `restart: unless-stopped`)
стартовали сами. `pnpm db:migrate` — «✅ Миграции применены» (схема уже
актуальна). Smoke шёл против собранного `node dist/main` на `127.0.0.1:3000`
с `AUTH_DISABLED=false` (реальная JWT-регистрация двух пользователей).

### 3.7 Мелочи прогона

`pnpm typecheck` при первом вызове сам докачал 17 пакетов (`pdfkit` и
`@types/pdfkit`) — `node_modules` был неполным, lockfile не изменился
(`pnpm-lock.yaml` в `git status` отсутствует). `pnpm build` при успехе молчит
(`nest build`), критерий — exit 0. Root-`vitest` исключает `web/**` (KI-137) —
web гоняется отдельно.

---

## 4. Smoke: `GET /workflow/:id/runs` на локальной БД

**Окружение:** PostgreSQL 17 (pgvector) `127.0.0.1:5433/workflow_builder`
(Docker, healthy) · Redis 7 `127.0.0.1:6379` · backend `node dist/main`
(`127.0.0.1:3000`, `AUTH_DISABLED=false`) · Node 24.21.0 · pnpm 12.11.2.
Скрипт: `.smoke/v014-s1-history-smoke.mjs` (fetch + `pg`), запуск
`node --env-file=.env`, отчёт `.smoke/v014-s1-history-smoke.json`.

**Сценарий.** 1) `POST /auth/register` двух реальных пользователей A и B;
2) `POST /workflow` от A (workflow с пустым графом); 3) три запуска вставлены в
`workflow_runs` (completed / failed / pending; `started_at`/`finished_at`
разные, у pending `NULL`) и два `node_runs` с `cost_usd = 0.012345` и
`cost_rub = 25.5`; 4) проверки API.

**Результат: 39/39 проверок.** Ключевые:

| # | Проверка | Результат |
|---|---|---|
| 1 | `GET /workflow/:id/runs` → 200, `total = 3`, 3 элемента, порядок `createdAt DESC` | ✅ |
| 2 | `Cache-Control: no-store` | ✅ `no-store` |
| 3 | completed: `durationMs = 2000`, `costUsd = 0.012345`, `costRub = 0`, `createdAt` ISO | ✅ |
| 4 | failed: `durationMs = 3500`, `costRub = 25.5`, `costUsd = 0` | ✅ |
| 5 | pending: `startedAt/finishedAt/durationMs = null`, `costUsd = 0` | ✅ |
| 6 | `RunSummary` — ровно 8 контрактных полей (без snapshot/inputs/outputs/error) | ✅ |
| 7 | `?limit=2&offset=1` → `[failed, completed]`, `total = 3`; `offset=10` → `runs: []`, `total = 3` | ✅ |
| 8 | чужой workflow → **404**; participant `viewer` → **404** | ✅ |
| 9 | participant `editor` (после PATCH роли) → **200**, `total = 3` | ✅ |
| 10 | невалидный uuid → 400; `limit=0` → 400; `limit=101` → 400; без токена → 401 | ✅ |

**Реальный ответ (фрагмент, `.smoke/v014-s1-history-smoke.json`):**

```json
{
  "runs": [
    {
      "id": "466e6b92-d4b7-47e1-983e-36ebde55fd5d",
      "status": "pending",
      "createdAt": "2026-11-02T09:10:00.000Z",
      "startedAt": null,
      "finishedAt": null,
      "durationMs": null,
      "costUsd": 0,
      "costRub": 0
    },
    {
      "id": "0c1c60e3-3c61-45a3-95dd-9d2dd70cab66",
      "status": "failed",
      "createdAt": "2026-11-02T09:05:00.000Z",
      "startedAt": "2026-11-02T09:05:01.000Z",
      "finishedAt": "2026-11-02T09:05:04.500Z",
      "durationMs": 3500,
      "costUsd": 0,
      "costRub": 25.5
    },
    {
      "id": "6886e79d-85e4-492d-8084-85953fd68e35",
      "status": "completed",
      "createdAt": "2026-11-02T09:00:00.000Z",
      "startedAt": "2026-11-02T09:00:01.000Z",
      "finishedAt": "2026-11-02T09:00:03.000Z",
      "durationMs": 2000,
      "costUsd": 0.012345,
      "costRub": 0
    }
  ],
  "total": 3
}
```

**Честная оговорка:** запуски вставлены в БД напрямую (а не прогнаны движком),
чтобы детерминированно проверить агрегаты/длительности; путь «движок пишет
`workflow_runs`/`node_runs`» остаётся покрыт существующими спеками движка.
Строка `pending` вставлена с `started_at = NULL` намеренно — проверить
`durationMs: null`. У **реального** `pending`-запуска из `POST /runs`
`started_at` непустой (`DEFAULT now()`, KI-539), поэтому smoke-проверка
`pending.startedAt = null` синтетическая: она проверяет контракт на `NULL`, а не
поведение планировщика. Данные smoke остались в локальной БД (dev-окружение, не
prod).

---

## 5. Что не так

1. **KI-537 (🟡 Medium):** `GET /workflow/:id/runs` требует `editor`, а
   `GET /runs/:id`/`GET /runs/:id/nodes` доступны `viewer` — наблюдатель видит
   запуск по прямой ссылке, но не видит список истории (404). Так в ТЗ S1;
   требует продуктового решения в S2.
2. **KI-538 (🟡 Medium):** в `workflow_runs` нет `duration_ms`/`cost_usd`/
   `cost_rub`; история считает длительность из дат и агрегирует стоимости
   отдельным запросом по `node_runs` — нет фильтра/сортировки по стоимости и
   лишний агрегат на каждый запрос.
3. **KI-539 (🟢 Low):** `workflow_runs.started_at` имеет `DEFAULT now()`;
   у запусков, упавших до `markRunRunningAsync`, `durationMs` включает ожидание
   в очереди.
4. **KI-540 (🟡 Medium):** нет индекса `workflow_runs(workflow_id,
   created_at DESC)` — история и `count(*)` идут seq scan; FK-индекс в
   PostgreSQL не создаётся автоматически. Нужна миграция в v0.15.
5. **Промпт S1 указывает несуществующий путь** `D:\Projects\AI\workflow-builder`;
   фактический репозиторий — `C:\Projects\AI\ai-workflow-builder` (cwd сессии).
   На работу не влияет, но в промптах лучше ссылаться на cwd.
6. **DESIGN § 3.1 не перечисляет `createdAt`** в `RunSummary`, а промпт S1
   требует; включил `createdAt` (он же вторичный ключ сортировки). DESIGN стоит
   обновить при ревью.
7. **`pnpm lint` — 2 warning'а**, оба в
   `src/media/providers/openai-images.provider.spec.ts`
   (`typescript(no-base-to-string)`); файлы не мои, на HEAD те же — не трогал.
8. **UI истории ещё нет** — это S2 (`RunHistoryModal`), в S1 только API и
   web-зеркала контракта. `l10n`-строки не добавлялись.
9. **Первый `pnpm typecheck` докачал 17 пакетов** (неполный `node_modules`);
   lockfile не изменился, но в чистом окружении CI это не повторится.

---

## 6. Новые KI

Все четыре — новые записи в `docs/KNOWN_ISSUES.md` (формат реестра соблюдён):

| KI | Приоритет | Суть | Файлы |
|---|---|---|---|
| **KI-537** | 🟡 Medium | Права на историю (`editor`) уже, чем на чтение запуска (`viewer`) — 404 в списке при доступном запуске | `src/runs/runs.service.ts`, `src/runs/runs.controller.ts` |
| **KI-538** | 🟡 Medium | Нет денормализованных длительности/стоимости запуска: `duration_ms`/`cost_usd`/`cost_rub` только в `node_runs`; история агрегирует на каждый запрос | `src/runs/runs.service.ts`, `src/engine/execution-engine.service.ts`, `src/db/schema.ts` |
| **KI-539** | 🟢 Low | `started_at DEFAULT now()` — у запусков, упавших до старта, длительность включает ожидание в очереди | `src/db/schema.ts`, `src/runs/runs.service.ts` |
| **KI-540** | 🟡 Medium | Нет индекса `workflow_runs(workflow_id, created_at DESC)` → seq scan истории и `count(*)` | `src/db/schema.ts`, `drizzle/` |

Закрытий существующих KI в этой сессии нет: S1 — аддитивная фича.

---

## 7. Обоснование решений

### 7.1 Второй контроллер в `runs.controller.ts`, а не метод в `RunsController`

Контракт маршрута из DESIGN — `/workflow/:id/runs`, а `RunsController` уже
имеет префикс `/runs`; один класс — один префикс в Nest. `WorkflowController`
не подходит: ему понадобился бы `RunsService`, а `RunsModule` уже импортирует
`WorkflowModule` (циклическая зависимость). Поэтому `RunsHistoryController`
объявлен рядом в `runs.controller.ts` и зарегистрирован в `RunsModule` — он
переиспользует `RunsService` и `JwtAuthGuard`, не расширяя публичный контракт
`WorkflowController`.

### 7.2 Права — owner/editor, чужой = 404

Требование задачи («проверка прав owner/editor») реализовано тем же
`workflowAccessFilter(db, workflowId, userId, 'editor')`, что и запуск
(`createRunAsync`): поведение однородно, роль читается одним SQL-условием,
`viewer`/чужой/несуществующий workflow неотличимы — 404 (KI-202, не 403).
Расхождение с read-ручками запуска зафиксировано как KI-537, а не спрятано.
Сама роль `editor` **пиннится тестом**: `runs.service.spec.ts` оборачивает
`workflowAccessFilter` pass-through spy-моком и проверяет четвёртый аргумент
(`'editor'`), иначе подмена на `viewer`/owner-only осталась бы незамеченной —
мок Drizzle SQL не исполняет, а viewer→404/editor→200 в smoke не входит в CI.

### 7.3 Запросы: доступ → count → страница → суммы

- **Доступ первым:** при 404 в `workflow_runs`/`node_runs` не ходим (KI-202).
- **`total` отдельно:** `LIMIT/OFFSET` не даёт общего числа, а на пустой
  странице `total` должен остаться известным.
- **Агрегат только по id страницы:** `IN (ids) GROUP BY run_id` не считает
  суммы всей истории; индекса `node_runs(run_id, node_id)` хватает для
  префиксного поиска по `run_id`.
- **Сортировка `createdAt DESC, id DESC`:** при равных `created_at` (запуски в
  одну миллисекунду) без вторичного ключа порядок «плавает» и пагинация может
  терять/дублировать строки.

### 7.4 `RunSummary` — TS-интерфейс, а не Zod-схема ответа

Контрактный гейт (KI-352) умеет читать поля и из `ZodObject.shape`, и из AST
TS-интерфейса; менять формат `RunResponse`-семейства (интерфейсы) на Zod —
отдельная задача KI-358. Выбрал интерфейс, чтобы не увеличивать срез S1: поля
описаны один раз в `run-history.dto.ts`, гейт читает их компилятором, а
web-зеркала — Zod-схемами (их сторона и так Zod).

### 7.5 `durationMs` — null для незавершённых, стоимости — 0

`durationMs: null` отличает «запуск ещё идёт» от «мгновенный запуск» и не
требует магии `-1`; `costUsd/costRub: number` (0 без `node_runs`) — потому что
ноль трат и отсутствие узлов для UI одно и то же. Обе трактовки закреплены
тестами.

### 7.6 Валидация на двух границах

`RunHistoryQuerySchema` (Zod) на контроллере даёт 400 с понятным текстом и
применяет дефолты (`20`/`0`). В сервисе — вторая, дешёвая граница
(`Math.min/max`), потому что `listRunsAsync` — публичный метод сервиса: вызов в
обход контроллера с `limit = 10_000` вытянул бы всю историю, а отрицательный
`offset` уронил бы SQL. Это соответствует RULES 1.17 (валидация на границе) и
не дублирует Zod-сообщения.

### 7.7 `createdAt` в `RunSummary`, хотя DESIGN § 3.1 его не перечисляет

Промпт S1 включает `createdAt` в список полей, и он же нужен UI: сортировка
истории и подпись «когда запущен» без него потребовали бы второго источника.
Поле добавлено в контракт и в оба зеркала; DESIGN § 3.1 стоит синхронизировать
(§ 5.6).

### 7.8 `Cache-Control: no-store` и отсутствие UI в этом срезе

Ответ авторизованный и меняется по мере выполнения запусков — кэш запрещён, как
у `GET /runs/:id/nodes`. UI (`RunHistoryModal`, клик → `fetchRunNodesAsync`) —
S2 по плану DESIGN; в S1 добавлены только web-зеркала контракта, чтобы
`web/src/lib/api-contract.spec.ts` остался зелёным (KI-352).

### 7.9 Процесс

Ни одного `git add`/`git commit` не выполнено (жёсткое правило задачи);
рабочее дерево оставлено с untracked `run-history.dto.ts` и изменёнными
tracked-файлами. Smoke-артефакты — в `.smoke/` (gitignored). Код, контракт,
отчёт и арифметика +/− проверены независимым verifier-агентом (read-only,
targeted-гейты: typecheck, 59/59 backend, 425/425 web, lint); его замечания
(пиннинг роли `editor`, слипшиеся строки в spec, JSDoc `startedAt`, формулировка
§ 7.3) исправлены до финального ответа. Финальные гейты и diff перепроверены
Лидом (см. § 2).
