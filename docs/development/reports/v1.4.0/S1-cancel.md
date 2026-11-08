---
title: "S1: Cancel Run — отмена запуска workflow (v1.4.0)"
date: 2026-11-08
version: v1.4.0
steps: [S1]
status: accepted
related_ki: [KI-635, KI-636, KI-637]
related_adr: []
---

# Отчёт S1 — Cancel Run (v1.4.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **124 passed (128 файлов),
1930 passed / 24 skipped (1954)**, `pnpm test:parity` — **13/13**,
`pnpm test:e2e` — **1/1**, web — **54 файла / 503 теста**, `pnpm --dir web build`
— success. Смоук на живом приложении — **9/9 PASS**: отмена `running`-запуска
принята за 25 мс, движок остановился на 1-м из 400 узлов, SSE принёс
`run_completed status=cancelled final=true`, повторная отмена — 409, чужой
пользователь — 404.

**Точка старта.** HEAD `b661194` («docs: create DESIGN v1.4»), CI зелёный,
`package.json` = `1.3.0`. Источник — `docs/development/v1.4/DESIGN_V140_FEATURES.md`
§ 3.1, правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** миграция `0019_plain_kang.sql` (`workflow_runs.cancelled_at`),
`POST /runs/:id/cancel` (JWT, owner/editor), `RunsService.cancelRunAsync`
(pending → `cancelled` + удаление job; running → только `cancelled_at`;
терминальные → 409; чужие/viewer → 404), `RunCancelledException` и проверки
`cancelled_at` перед каждым уровнем/узлом (включая подграфы),
`markRunRunningAsync` не перезаписывает отменённый запуск, `RunsProcessor`
закрывает запуск `cancelled` и **не** пробрасывает исключение (job → completed,
retry нет), SSE `run_completed` принимает `status: 'cancelled'`, в `TopBar` —
кнопка «Отменить» при `running`. Новые ограничения — KI-635..637.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [drizzle/0019_plain_kang.sql](../../../../drizzle/0019_plain_kang.sql) *(new)* | 1 | `ALTER TABLE "workflow_runs" ADD COLUMN "cancelled_at" timestamp with time zone;` — сгенерирован `pnpm db:generate`, не написан вручную (RULES 3.10) |
| [drizzle/meta/0019_snapshot.json](../../../../drizzle/meta/0019_snapshot.json) *(new)* | 1313 | снимок схемы Drizzle, 34 950 байт; сгенерирован вместе с миграцией |
| [docs/development/reports/v1.4.0/S1-cancel.md](S1-cancel.md) *(new)* | — | этот отчёт (7 разделов, RULES 2.15/2.18) |

Артефакты смоука (gitignored, `.smoke/`): `v140-s1-cancel-smoke.mjs` (384
строки — регистрация, длинный граф, SSE-читатель, 9 проверок, уборка),
`v140-s1-cancel-smoke.json` (105 строк, 9 проверок), `v140-s1-backend.log`
(120 строк). Первый вариант смоука на 800 узлах получил 413 (см. § 3.2);
рабочий прогон — 400 узлов.

### 1.2 Production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/db/schema.ts](../../../../src/db/schema.ts) | +15/−4 | `workflowRuns.cancelledAt` (`timestamp with time zone`, nullable); `TERMINAL_WORKFLOW_RUN_STATUSES` расширен `cancelled`; JSDoc |
| [src/engine/errors.ts](../../../../src/engine/errors.ts) | +48/−0 | `RunCancelledException` (non-retryable: `retryable = false`, без `provider`), `isRunCancelledError` |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +121/−2 | `assertRunNotCancelledAsync` перед каждым уровнем/узлом (корень и подграфы); обнаружение `RunCancelledException` в `allSettled` и немедленный проброс; `markRunRunningAsync` — pre-read + UPDATE с `status != 'cancelled' AND cancelled_at IS NULL`; планировочный `catch` не превращает отмену в `failed` |
| [src/runs/runs.service.ts](../../../../src/runs/runs.service.ts) | +202/−7 | `cancelRunAsync` (editor-доступ, 404/409, pending/running, гонка `pending→running`), `removeQueuedJobAsync` (`getJob(runId)` + fallback `getJobs`), `jobId = run.id` при постановке; `getRunRowAsync(..., minimumRole)`; `CancelRunResponse` |
| [src/runs/runs.controller.ts](../../../../src/runs/runs.controller.ts) | +27/−1 | `POST /runs/:id/cancel` (JWT, `toWorkflowAccess`, 200) |
| [src/runs/runs.processor.ts](../../../../src/runs/runs.processor.ts) | +59/−1 | `catch` `RunCancelledException` → `markRunCancelledAsync` + `run_completed` (`cancelled`, `final: true`) без проброса; `publishRunCompletedAsync` принимает `cancelled` |
| [src/workflow/workflow-access.ts](../../../../src/workflow/workflow-access.ts) | +11/−1 | `accessibleWorkflowIdsSubquery(db, access, minimumRole = 'viewer')` — отмена запрашивает `editor`, чтение остаётся `viewer` |
| [web/src/components/TopBar.tsx](../../../../web/src/components/TopBar.tsx) | +73/−1 | кнопка «Отменить» (`data-topbar-cancel-run`, только `running`), `isCancelling`, `handleCancelRun`, сброс по финальному статусу |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +40/−0 | `CancelRunResponseSchema` (`z.literal('cancelled')`), `cancelRunAsync(runId)` |
| [web/src/types/run-stream.ts](../../../../web/src/types/run-stream.ts) | +5/−2 | `run_completed.status` — `completed \| failed \| cancelled` (зеркало backend) |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +3/−0 | `topbar.cancel_run`, `.cancelling`, `.error` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +3/−0 | те же ключи (RULES 1.14) |

**Итого production:** **+607/−19**. Плюс сгенерированная миграция (1 строка) и
snapshot (1313 строк) — без ручного кода.

### 1.3 Тесты

| Файл | +/− | Прирост |
|---|---:|---|
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +128/−7 | +8 тестов: pending (status/cancelled_at/finished_at + remove job), running (только cancelled_at), 3 терминальных статуса (409), чужой (404), editor-роль, сбой Redis не отменяет отмену; обновлено ожидание `jobId` и `accessibleWorkflowIdsSubquery(..., 'viewer')` |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +78/−2 | +3 теста: флаг до старта (ни одного узла), отмена между уровнями (A выполнен, B — нет), `status='cancelled'` не перезаписывается; fake DB читает строку `workflow_runs` |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +54/−1 | +5 тестов: 200 + access, 404, 409, 400 uuid, 401 без токена |
| [src/runs/runs.processor.spec.ts](../../../../src/runs/runs.processor.spec.ts) | +23/−1 | +1 тест: `RunCancelledException` → 200-эффект (resolve), `status='cancelled'`, `run_completed cancelled/final=true` |
| [src/runs/dto/run-event.dto.spec.ts](../../../../src/runs/dto/run-event.dto.spec.ts) | +10/−0 | `run_completed` со `status: 'cancelled'` валиден |
| [src/db/schema.spec.ts](../../../../src/db/schema.spec.ts) | +6/−2 | терминальные статусы — `completed/failed/cancelled` (тип и рантайм) |
| [src/runs/runs-stream.service.spec.ts](../../../../src/runs/runs-stream.service.spec.ts) | +2/−0 | `WorkflowRun.cancelledAt: null` в тестовой строке |
| [web/src/components/TopBar.spec.tsx](../../../../web/src/components/TopBar.spec.tsx) | +70/−0 | +3 теста: кнопка видна при `running` и вызывает API, скрыта при `pending/completed/failed/cancelled`, ошибка снимает «Отмена...» |

**Итого тесты:** **+371/−13**, **+20 тестов** (backend +17, web +3).

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [README.md](../../../../README.md) | +7/−0 | пункт «Отмена запуска (v1.4.0 S1)» в разделе «Выполнение» |
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +19/−0 | `[Unreleased] → Added`: S1, ссылка на отчёт, KI-635..637 |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +63/−14 | KI-635..637 (Documented), сводка пересчитана: 624 записи, `Fixed 270`, `Documented 52` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | строка v1.4.0 S1 |

**Итого документация:** +90/−14 плюс этот отчёт.

**Общий итог по `git diff --numstat` (tracked):** **+1075/−46**; untracked:
SQL-миграция (1), snapshot (1313), отчёт. Смоук-артефакты — gitignored.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm db:generate` | `0019_plain_kang.sql` + `meta/0019_snapshot.json` |
| `pnpm db:migrate` | applied (PostgreSQL 17 `127.0.0.1:5433/workflow_builder`), backfill организаций выполнен |
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` | **124 passed / 4 skipped (128 файлов)**, **1930 passed / 24 skipped (1954)**, 34.6 с |
| `pnpm test:parity` | **13/13** |
| `pnpm test:e2e` | **1/1** (`AppModule` bootstrap) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — преэкзистующие `openai-images.provider.spec.ts` (чужие файлы) |
| `pnpm --dir web build` | success, 390 modules, `tsc -b` + Vite |
| `pnpm --dir web test` | **54 файла / 503 теста passed** |
| Целевой прогон после финальной правки | 4 файла / **186 тестов passed** (`runs.service`, `runs.controller`, `runs.processor`, `execution-engine`) |
| Смоук (живое приложение) | **9/9 PASS, 0 FAIL** |

Скипнутые 24 теста — преэкзистующие DB/интеграционные (`schema-parity` без
`--env-file`, `media-storage.integration`, `vector-store.integration`,
`backfill-organizations`, OpenAI Images без ключа). `pnpm test:parity` с
`DATABASE_URL` — зелёный.

---

## 3. Диагностика

### 3.1 Инфраструктура была остановлена

На старте проверки `127.0.0.1:5433` и `127.0.0.1:6379` были закрыты:
контейнеры `workflow-builder-db`/`workflow-builder-redis` существовали, но
находились в `Exited (0) 2 days ago`. Для миграции и смоука они подняты
`docker start` (не `compose up`), после прогона остановлены. `pnpm db:migrate`
применил 0019 и выполнил backfill организаций.

### 3.2 Первый смоук: 413 `request entity too large`

Скрипт на **800** text-узлах отправил `POST /workflow` с телом **117 864**
байта, лимит Express body-parser — **102 400** байт (`PayloadTooLargeError` в
`v140-s1-backend.err.log`, `limit: 102400`, `length: 117864`). Это не дефект
S1: тело графа — известное ограничение транспорта. Для смоука уменьшено до
**400** узлов (~59 КБ); окно выполнения осталось достаточным, чтобы отмена
пришла в `running` (103 мс до `running`, 25 мс на `cancel`).

### 3.3 Fake DB движка: выборка строки `workflow_runs`

До S1 тестовый двойник БД (`execution-engine.service.spec.ts`) отвечал только
на `node_runs`-запросы. Новые `SELECT status, cancelled_at FROM workflow_runs`
и `SELECT cancelled_at` потребовали ветки `if (table === workflowRuns)` в
`select().from().where().limit()`. Без неё движок получал бы строки
`node_runs` и «не видел» отмену. `FakeRun` получил `cancelledAt`, начальное
значение `null`.

### 3.4 `TERMINAL_WORKFLOW_RUN_STATUSES` — не только DTO

`RunEventSchema.run_completed.status` был `z.enum(['completed','failed'])` из
`TERMINAL_WORKFLOW_RUN_STATUSES`. Чтобы SSE-событие отмены проходило
валидацию на обеих границах (публикация и чтение), константа расширена
`cancelled`. Это же значение уже было в `WORKFLOW_RUN_STATUSES`,
`RunStatusSchema` (web) и `api-contract.json`, поэтому REST-контракт
`RunResponse.status` не изменился. Web-зеркало
`web/src/types/run-stream.ts` пришлось расширить отдельно — иначе Zod на
клиенте отбросил бы событие `cancelled` как невалидное, и UI завис бы в
`running` (ровно класс KI-271).

### 3.5 Гонка `pending → running`

`cancelRunAsync` читает строку, затем делает UPDATE с условием
`status = <прочитанный>`. Если worker успел перевести `pending` в `running`,
UPDATE не трогает строку; сервис перечитывает её и выставляет `cancelled_at`
уже как для `running`. Для `running`-ветки UPDATE тоже условный; если строка
успела стать терминальной, `returning()` пуст → перечитывание → **409**, а не
ложный 200 «отменили». Окончательный арбитр — `cancelled_at`: движок
проверяет его независимо от гонки.

### 3.6 `jobId = run.id` и fallback-поиск

`queue.add` теперь получает `{ jobId: run.id }` — отмена `pending` находит
задание прямым `queue.getJob(runId)`. Для заданий, поставленных до
обновления (у них id сгенерировал BullMQ), остаётся fallback: перебор
`waiting/delayed/prioritized` по `data.runId`. Без fallback после деплоя
старое pending-задание нельзя было бы удалить, и отменённый запуск всё равно
начал бы выполняться (движок бы остановился, но только после первого узла).

### 3.7 Почему `cancelled` — не статус сразу для `running`

Если бы `cancelRunAsync` для `running` сразу писал `status='cancelled'`,
`RunsProcessor`/SSE потеряли бы представление о том, что процесс ещё
выполняет узел: `RunsStreamService` закрывает поток только по
`run_completed`, а `RunsProcessor` guard `run.status !== 'pending'` перестал
бы отличать «ещё жив» от «уже отменён». Поэтому для `running` пишется только
флаг, а статус `cancelled` ставит процессор после остановки. Для `pending`
процесса ещё нет — статус ставится сразу, job удаляется.

### 3.8 Дополнительный SELECT на каждый узел

`assertRunNotCancelledAsync` — отдельный `SELECT cancelled_at` перед каждым
узлом и уровнем. Это +1 запрос на узел (у `text`-узла было ~5 запросов,
стало ~6). Альтернатива — держать флаг в памяти worker'а и обновлять его
через Redis pub/sub — потребовала бы нового канала и рассинхронизации; для
v1.4.0 S1 выбран честный SELECT. Стоимость зафиксирована в § 5, п. 6.

### 3.9 Проверка отсутствия dev-сервера

Порт 3000 из `.env` не использовался: backend для смоука поднят на **3101**
(`PORT=3101`, `AUTH_DISABLED=false`), чтобы не столкнуться с чужим
контейнером/процессом. `EADDRINUSE` не возникал; `dist/` пересобран перед
финальным прогоном.

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder` (миграция 0019
применена), Redis `127.0.0.1:6379`, backend — `node dist/main.js` на **3101**,
`AUTH_DISABLED=false`, реальный JWT. Скрипт:
`.smoke/v140-s1-cancel-smoke.mjs`; прогон **9/9 PASS, 0 FAIL**,
`generatedAt = 2026-11-08T16:53:15Z` (артефакт
`.smoke/v140-s1-cancel-smoke.json`).

**Сценарий.** Регистрация owner и foreign, создание workflow из 400
`text`-узлов (цепочка `n0 → n1 → … → n399`, ~59 КБ), `POST /runs`, сразу
открывается SSE-поток, ожидание `running`, `POST /runs/:id/cancel`, ожидание
финала, проверка БД (`workflow_runs`, `node_runs`), повторная отмена, отмена
чужим пользователем, `GET /runs/:id`.

| # | Проверка | Факт |
|---|---|---|
| 1 | Запуск дошёл до `running` | `running` за **103 мс** |
| 2 | `POST /runs/:id/cancel` | **200** `{ status: 'cancelled' }`, **25 мс** |
| 3 | Финальный статус | **`cancelled`** через **62 мс** после cancel |
| 4 | SSE `run_completed` | `{ type: 'run_completed', status: 'cancelled', attemptsMade: 0, attempts: 3, final: true, finishedAt: '2026-11-08T16:53:15.448Z' }` |
| 5 | БД `workflow_runs` | `status=cancelled`, `cancelled_at=2026-11-08T16:53:15.418Z`, `finished_at=2026-11-08T16:53:15.442Z` |
| 6 | Движок остановился | в графе **400** узлов, строк `node_runs` — **1** (`completed=1`) |
| 7 | Повторная отмена | **409** `{ message: 'Запуск … уже завершён (status=cancelled) — отмена невозможна' }` |
| 8 | Чужой пользователь | **404** `{ message: 'Запуск … не найден' }` |
| 9 | `GET /runs/:id` | **200** `{ status: 'cancelled', error: null }` |

**SSE-фрагмент (из потока):**

```json
{
  "type": "run_completed",
  "runId": "d143b447-9ba3-4b3b-bfa0-22d3f49a65f5",
  "status": "cancelled",
  "attemptsMade": 0,
  "attempts": 3,
  "final": true,
  "finishedAt": "2026-11-08T16:53:15.448Z"
}
```

**Лог backend (ключевые строки):**

```text
[RunsService] Запуск d143b447-…: запрошена отмена во время выполнения
[RunsProcessor] Запуск d143b447-… отменён — выполнение остановлено
```

**Уборка.** Обе smoke-организации удалены каскадом
(`DELETE FROM organizations WHERE id = $1`), пользователи/workflow/запуски/
`node_runs` ушли вместе с ними; проверено по `runTag` (`smoke-v140-s1-…`).
Backend остановлен, контейнеры DB/Redis возвращены в прежнее состояние
(`Exited`).

**UI-уровень.** Отдельного CDP-смоука в этой сессии не было: кнопка проверена
`TopBar.spec.tsx` (3 теста — видимость при `running`, вызов API, скрытие при
`pending/completed/failed/cancelled`, сброс «Отмена...» при ошибке) и ручной
проверкой вёрстки. Живой браузерный смоук — кандидат на S4 (релиз) вместе с
`data-topbar-cancel-run`.

---

## 5. Что не так

1. **Отмена не прерывает уже выполняющийся узел (KI-635, 🟢 Low).**
   `AbortSignal` в `LlmNodeExecutor`/`MediaNodeExecutor`/`AgentService` не
   передаётся. Для `text`-узла окно микроскопическое, для LLM/media — секунды
   и минуты; платный вызов доигрывается. В смоуке между `cancel` и
   `run_completed` 62 мс только потому, что граф был из `text`-узлов.
2. **Отмена `pending` не публикует `run_completed` (KI-636, 🟢 Low).**
   Процессор — единственный, кто публикует событие, но задание уже удалено из
   BullMQ. Второй таб, открывший SSE на `pending`, не получит финал; штатный
   UI v1.4.0 S1 кнопку для `pending` не показывает, поэтому сценарий не
   основной.
3. **UI не отменяет `pending` (KI-637, 🟢 Low).** По DESIGN кнопка видна
   только при `running`. API умеет `pending`, но пользователь не может
   отменить запуск, пока он в очереди.
4. **Лимит тела 100 КБ.** Первый смоук на 800 узлах упал 413
   (`117 864 > 102 400`). Для графов такого размера нужен другой способ
   создания (загрузка из файла/несколько запросов) — это ограничение не S1,
   но оно проявилось.
5. **`getRunRowAsync` получил третий параметр `minimumRole`.** Все прежние
   вызовы сохранили поведение (`viewer`), но три существующих теста пришлось
   обновить: они проверяли точный вызов `accessibleWorkflowIdsSubquery` с
   двумя аргументами. Это изменение тестового контракта, а не API.
6. **+1 SELECT на узел.** Проверка `cancelled_at` перед каждым узлом — это
   дополнительный запрос к `workflow_runs`; для графа из 400 `text`-узлов
   смоук показал 1 строку `node_runs`, но в обычном прогоне цена — +N
   запросов. Кэш/Redis-флаг не вводились (см. § 7, п. 9).
7. **`run_completed` теперь может быть `cancelled`.** Старые сборки web
   (до этого коммита) отбросили бы событие Zod-схемой и остались бы в
   `running`; монорепо обновляется целиком, но внешние клиенты SSE должны
   обновить enum. Зафиксировано как изменение контракта в § 7, п. 5.
8. **`markRunRunningAsync` читает строку отдельным SELECT.** Это нужно, чтобы
   отличить «отменён» от «строки нет» и вернуть `RunCancelledException`.
   UPDATE с `returning()` мог бы обойтись без pre-read, но тогда пустой
   результат неотличим от отсутствия строки без второй проверки.
9. **Смоук-скрипт не в git.** `.smoke/` gitignored; в отчёте и § 4 он указан,
   но воспроизвести прогон можно только на машине с поднятыми DB/Redis.
10. **`pnpm` в окружении — 12.14.0 при `packageManager: pnpm@12.11.2`.**
    Локальные прогоны шли на 12.14.0; CI берёт версию из `packageManager`.
    На результат не влияет, но расхождение версий стоит держать в голове
    (RULES 6.10).
11. **`drizzle/meta/0019_snapshot.json` — 1313 строк/35 КБ.** Это штатный
    артефакт `drizzle-kit generate`; в обзоре diff он выглядит шумно, но
    коммитится вместе с миграцией.
12. **Коммитов нет.** Все изменения — в рабочем дереве: 25 изменённых файлов,
    3 untracked (`0019_plain_kang.sql`, `0019_snapshot.json`, этот отчёт;
    `.smoke/` — gitignored). `git add -A` не использовался.
13. **`pnpm lint` — 2 преэкзистующих warning'а** в
    `openai-images.provider.spec.ts` (чужие файлы, не трогали). Новых
    warning'ов нет.
14. **Гонка двух одновременных `cancel`.** Оба запроса могут вернуть 200 и
    оба выставить `cancelled_at` (последний перезапишет время). Для
    идемпотентной отмены это безвредно, но точное «время первого нажатия» не
    гарантируется; отдельный KI не заводился — поведение осознанно
    идемпотентное.
15. **`finished_at` для `running`-отмены ставит процессор, а не сервис.**
    Поэтому `cancel`-ответ приходит раньше, чем `finished_at`; UI не должен
    считать запуск завершённым по 200 (это явно описано в JSDoc
    `cancelRunAsync` и в `handleCancelRun`).

---

## 6. Новые KI

Всего **3** новых записи (KI-635..637), все — 🟢 Low / Documented. Реестр
пересчитан grep'ом (RULES 3.20): **624** записи, 624 статуса, номера
уникальны; `Fixed` = 270 (исправлена старая сводка: стояло 269),
`Documented` = 52.

| KI | Приоритет | Статус | Тема |
|---|---|---|---|
| [KI-635](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Отмена не прерывает уже выполняющийся узел — cooperative cancel, нет `AbortSignal` |
| [KI-636](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Отмена `pending`-запуска не публикует SSE `run_completed` |
| [KI-637](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | UI не позволяет отменить `pending`-запуск (кнопка только при `running`) |

Закрытых KI в этом срезе нет: S1 — новая функциональность, а не фикс
реестра.

---

## 7. Обоснование решений

1. **Флаг `cancelled_at`, а не «убить процесс».** HTTP-запрос не имеет доступа
   к worker'у и не должен управлять его жизненным циклом: `SIGKILL` оставил бы
   `node_runs` в `running` и аренду живой. Флаг в БД — единственный
   межпроцессный контракт «остановись», который переживает рестарт и
   виден всем инстансам (DESIGN § 3.1 прямо это предполагает).
2. **Для `running` статус не меняется сразу.** `RunsStreamService` закрывает
   SSE только по `run_completed` с `final: true`; `RunsProcessor` guard
   `status !== 'pending'` защищает от повторной доставки. Если бы сервис
   писал `status='cancelled'` во время выполнения, поток и guard потеряли бы
   признак «процесс ещё жив». Финальный статус пишет процессор — он знает,
   что движок действительно остановился.
3. **Для `pending` статус меняется сразу.** Процесса ещё нет, ждать нечего;
   удаление job'а делает отмену дешёвой и исключает выполнение. Это же
   требование DESIGN.
4. **`cancelled` добавлен в `TERMINAL_WORKFLOW_RUN_STATUSES`, а не в локальный
   enum.** Константа — единый источник для `RunEventSchema`, `RunStatus` и
   паритет-гейта. Локальный литерал в DTO разошёлся бы с БД при следующем
   статусе (RULES 4.15, KI-353).
5. **SSE `run_completed` — единственный канал финала.** UI уже умеет
   обрабатывать `run_completed` (KI-060/KI-070) и закрывать поток по `final`.
   Отдельное событие `run_cancelled` потребовало бы правок store, контракта
   SSE и тестов ради того же результата. Расширение enum — минимальная
   совместимая правка (старые события `completed`/`failed` остаются
   валидными).
6. **`RunCancelledException` — отдельный non-retryable класс.** Если бы
   отмена шла как обычная ошибка узла, движок применил бы к ней
   `isRetryableProviderError`/`isRetryableNodeError` и мог бы повторить
   платный вызов. У класса нет `provider` и `retryable: true`, поэтому
   повторы исключены структурно; `RunsProcessor` ловит его **до** общего
   `catch` и возвращает управление без проброса — BullMQ не делает retry.
7. **Проверки перед уровнем и узлом.** Уровень — дешёвая точка «не начинать
   волну узлов»; узел — точка «не начинать новый платный вызов». Проверка
   только на уровне оставляла бы окно, в котором весь уровень (несколько
   LLM-узлов) стартует после отмены.
8. **Подграфы проверяются отдельно.** `sub_workflow` — часть того же запуска
   и может содержать десятки узлов; без проверки в `executeSubWorkflowGraphAsync`
   отмена корня не остановила бы подграф. Сигнал отмены из подграфа
   поднимается через `allSettled` и не превращается в `failed`.
9. **+1 SELECT, а не Redis pub/sub.** Кэш флага в памяти worker'а нужно
   инвалидировать между инстансами; для этого понадобился бы новый канал,
   подписка и обработка пропущенных сообщений. SELECT по PK `workflow_runs`
   — предсказуемая цена и нулевая рассинхронизация; оптимизация — отдельная
   задача (KI-635 частично пересекается по цене, но не по механизму).
10. **`getRunRowAsync(..., minimumRole)` вместо нового метода.**
    `accessibleWorkflowIdsSubquery` уже умел роль, но жёстко `viewer`.
    Параметр с дефолтом `viewer` сохраняет все существующие вызовы и даёт
    отмене `editor` без дублирования SQL. Альтернатива — отдельный
    `getRunRowForCancelAsync` — копировала бы условие доступа.
11. **Сигнатура `cancelRunAsync(id, access)`, а не `(id, userId)`.** В
    v1.0.0 S2 доступ к workflow/runs фильтруется ещё и по
    `organization_id`; `WorkflowAccess` структурно гарантирует наличие
    `orgId`. Принимать только `userId` значило бы либо потерять
    мультитенантность, либо делать второй запрос за организацией. `userId`
    входит в `access` и проверяется тем же подзапросом (owner/editor).
12. **`jobId = run.id` + fallback.** Прямой id делает отмену O(1), но
    задания, поставленные до релиза, его не имеют. Fallback-перебор — только
    по трём «невыполняющимся» состояниям, чтобы не удалить активный job
    (удаление active job'а всё равно не остановило бы выполнение; для этого
    и нужен флаг).
13. **Условные UPDATE + перечитывание.** `status = expected` не даёт
    перезаписать строку, которую worker уже перевёл в `running` или
    завершил. Перечитывание после пустого `returning()` даёт честный 409
    вместо 200, который ничего не сделал.
14. **UI: локальный `isCancelling`, без поля в store.** Состояние нужно
    только шапке и живёт до финала. Вынос в store добавил бы поле, которое
    никто, кроме TopBar, не читает, и риск рассинхрона при `resetRunState`.
    Сброс по `runStatus !== 'running'` привязывает индикатор к реальному
    статусу, а не к таймеру.
15. **Кнопка только при `running`.** Это буквальное требование DESIGN § 3.1
    и одновременно защита от 409: для `pending`/терминальных статусов кнопка
    либо не нужна, либо гарантированно получит ошибку. Ограничение вынесено
    в KI-637 как UX-долг, а не спрятано.
16. **Миграция только через `drizzle-kit generate`.** Ручной SQL разошёлся
    бы со snapshot и `schema-parity`; сгенерированный `0019` — единственная
    точка изменения схемы (RULES 3.10). `cancelled_at` nullable — старые
    запуски не требуют backfill (DESIGN § 4).
17. **Тесты движка — с расширением fake DB, а не с реальной БД.** Юнит-тесты
    движка быстрые и детерминированные; DB-интеграция уже покрыта
    `schema-parity` и e2e. Fake DB теперь отвечает на `workflow_runs` так же,
    как на `node_runs`, и проверяет именно остановку по флагу.
18. **Отчёт — 7 разделов без сокращения (RULES 2.15) и сохранён в
    `reports/v1.4.0/` (RULES 2.18).** Ссылка добавлена в `CHANGELOG.md`;
    `reports/README.md` обновлён строкой S1.
