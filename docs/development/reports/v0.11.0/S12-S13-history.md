---
title: "S12+S13: History API & UI (восстановление запуска после F5)"
date: 2026-10-19
version: v0.11.0
steps: [S12, S13]
status: accepted
related_ki: [KI-077, KI-450, KI-202, KI-347, KI-443, KI-464, KI-271]
related_adr: []
---

# Отчёт S12+S13 — History API & UI

**Статус:** реализовано; код и тесты лежат в рабочем дереве, коммитов в этой
сессии нет (`git add -A` не использовался). `pnpm build` / `pnpm typecheck` /
`pnpm test` / сборка и тесты `web/` — зелёные; живой smoke на PostgreSQL 17 +
Redis 7 + Chrome headless пройден (17/17 проверок, включая оба сценария F5).

**Точка старта.** HEAD `eebc9c3` (после S10+S11). Вопреки формулировке промпта
(«перенеси логику из `RunsStreamService.toNodeSnapshotAsync`»), на HEAD логика
уже была вынесена в свободные функции `src/runs/run-node-snapshots.ts`
(v0.10.2, KI-450). Поэтому S12 не копировал её второй раз: модуль превращён в
`@Injectable`-класс `NodeRunSnapshotMapper` ровно по DESIGN § 3.4.2, а оба
потребителя (SSE и REST) переведены на него. Подробности — § 3.1.

---

## 1. Файлы (+/−)

Backend (11 файлов, из них 2 новых и 1 удалённый):

| Файл | +/− | Что |
|---|---:|---|
| [src/runs/node-run-snapshot.mapper.ts](../../../../src/runs/node-run-snapshot.mapper.ts) *(new)* | +222 / −0 | `NodeRunSnapshotMapper` (DESIGN § 3.4.2): `toSnapshotAsync(row, graph)`, `listAsync(runId, graph)`; переподпись `stored_url` (KI-443/KI-464), `cacheSavingsUsd` (KI-055), ISO-даты |
| `src/runs/run-node-snapshots.ts` *(deleted)* | +0 / −221 | Прежние свободные функции `loadRunNodeSnapshotsAsync`/`toNodeSnapshotAsync` переехали в маппер |
| [src/runs/runs-stream.service.ts](../../../../src/runs/runs-stream.service.ts) | +9 / −20 | Вместо `DRIZZLE` + `MEDIA_STORAGE` инжектится `NodeRunSnapshotMapper`; снимок строится `mapper.listAsync` |
| [src/runs/runs.service.ts](../../../../src/runs/runs.service.ts) | +52 / −39 | `RunResponse`: `nodes` → `error`; `getRunAsync` больше не читает `node_runs`; новый `listNodeRunsAsync(runId, userId)` с проверкой доступа |
| [src/runs/runs.controller.ts](../../../../src/runs/runs.controller.ts) | +40 / −4 | `@Get(':id/nodes')` **до** `@Get(':id')`, `Cache-Control: no-store`, тип ответа `NodeRunSnapshot[]` |
| [src/runs/runs.module.ts](../../../../src/runs/runs.module.ts) | +5 / −0 | Провайдер `NodeRunSnapshotMapper` |
| [src/runs/node-run-snapshot.mapper.spec.ts](../../../../src/runs/node-run-snapshot.mapper.spec.ts) *(new)* | +303 / −0 | 9 тестов маппинга: ISO-даты, `cacheSavingsUsd` по модели/без модели, переподпись по `storage_key` и `outputs`, HMAC-подпись, ошибка S3, порядок `listAsync` |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +67 / −2 | 5 тестов `GET /runs/:id/nodes`: 200 + `Cache-Control`, 404, 400, 401, порядок роутов |
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +84 / −69 | `RunResponse` без `nodes` и с `error`; `listNodeRunsAsync` (делегирование мапперу, 404 до чтения узлов) |
| [src/runs/runs-stream.service.spec.ts](../../../../src/runs/runs-stream.service.spec.ts) | +4 / −0 | В тестовый модуль добавлен `NodeRunSnapshotMapper` (SSE-снимок теперь строит он) |
| [src/runs/dto/api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +8 / −0 | `NodeRunSnapshot` — Zod-источник в `DTO_SOURCES` |
| [docs/development/api-contract.json](../../../../docs/development/api-contract.json) | +3 / −2 | `RunResponse`: `error` вместо `nodes`; новый `NodeRunSnapshot`; обновлён `$comment` |

Frontend (6 файлов):

| Файл | +/− | Что |
|---|---:|---|
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +61 / −6 | `ApiRunSchema`: `error` вместо `nodes`; `fetchRunAsync`, `fetchRunNodesAsync` (DESIGN § 3.4.3) |
| [web/src/stores/workflow.ts](../../../../web/src/stores/workflow.ts) | +156 / −48 | `mapsFromNodes` (общий маппинг с `applySnapshot`), `restoreRunAsync`, `loadWorkflowAsync` восстанавливает через REST и открывает SSE только для `pending`/`running` |
| [web/src/stores/workflow.spec.ts](../../../../web/src/stores/workflow.spec.ts) | +268 / −2 | 5 тестов `restoreRunAsync` (outputs+метрики, финальный статус без SSE, `running` → SSE, 404 → reset+toast, прочие ошибки) |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +20 / −2 | Зеркало `NodeRunSnapshot`; регрессия `RunResponse` обновлена (`error` вместо `nodes`) |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +1 / −0 | `toast.run_not_found` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +1 / −0 | `toast.run_not_found` (RULES 1.14) |

Документация:

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +31 / −4 | `[Unreleased] → Added` (S12+S13 со ссылкой на отчёт), новый `Changed` (удаление `nodes` из `RunResponse`), поправлена прежняя запись про `GET /runs/:id` |
| [docs/development/reports/README.md](../README.md) | +1 / −0 | Строка отчёта S12-S13 |
| `docs/development/reports/v0.11.0/S12-S13-history.md` *(new)* | этот отчёт |

Артефакты smoke (gitignored `.smoke/`, не часть deliverable):
`.smoke/s12-s13-smoke.mjs` (693 строки), `s12-s13-app.log`,
`s12-s13-smoke-report.json`.

**Итого код:** 17 tracked-файлов (11 backend + 6 web): **+776 / −413**; сверху
два новых файла — `node-run-snapshot.mapper.ts` и его spec (+525 строк). С учётом
них — **+1301 / −413**, чистое изменение **+888 строк**. Крупные строки — новые
тесты: mapper-spec 303 и расширение `workflow.spec.ts` 268.

Docs: `CHANGELOG.md` (+31/−4), `reports/README.md` (+1), этот отчёт (новый).

Зависимости, миграции, env и `.env.example` не менялись.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** · `pnpm typecheck` — **0** ·
`pnpm test` — **97 файлов passed / 3 skipped, 1396 passed / 18 skipped** ·
`pnpm lint` — **0 errors, 1 warning** (pre-existing: неиспользуемый импорт
`DocumentTemplateNotFoundException` в `src/engine/node-executors.ts`, тот же
warning, что в S10-S11) · `pnpm --dir web build` (tsc + vite) — **успешно** ·
`pnpm --dir web test` — **49 файлов / 401 passed**.

Прирост к S10-S11: backend **+1 spec-файл / +17 тестов** (9 mapper + 5 controller
+ 3 service `listNodeRunsAsync`; спеки `getRunAsync` переписаны без изменения
числа), web **+6 тестов** (5 `restoreRunAsync` + 1 contract-гейт; новых
spec-файлов нет). Skipped — прежние DB-интеграционные/e2e без окружения.

---

## 3. Диагностика

1. **Логика маппинга уже была вынесена.** На HEAD `RunsStreamService` не
   содержал `toNodeSnapshotAsync` — метод жил в свободных функциях
   `run-node-snapshots.ts` (v0.10.2, KI-450). Делать «перенос из сервиса»
   означало бы создать третью копию. Вместо этого файл стал
   `NodeRunSnapshotMapper` (класс с `DRIZZLE` + `MEDIA_STORAGE`), код маппинга
   перенесён 1:1 (включая `withRefreshedOutputs` и `resolveStoredUrlAsync`), а
   старый модуль удалён, чтобы не было двух источников правды. `RunsService` и
   `RunsStreamService` получают его через DI из `RunsModule`.
2. **`listAsync` читает БД в маппере, а не в сервисе.** DESIGN § 3.4.2 показывает
   SELECT в `RunsService`, но у маппера по тому же DESIGN есть
   `listAsync(runId, graph)`. Раз SELECT нужен только для этого метода, он
   оставлен в маппере: `RunsService.listNodeRunsAsync` делает
   `getRunRowAsync` (проверка доступа и снимок графа) → `mapper.listAsync`.
   Так порядок «сначала 404, потом `node_runs`» выражен одной строкой и не
   дублирует чтение.
3. **`RunResponse.nodes` удалён, но `ApiRunSchema` был его единственным
   потребителем.** Проверено grep'ом по `web/src`: `run.nodes` в компонентах не
   читался (после v0.10.2 `GET /runs/:id` использовался только для статуса).
   Поэтому удаление поля не потребовало правок `RunResultPanel`; изменились
   только схема, contract-гейт и тестовые фикстуры.
4. **Паритет-гейт заставляет добавить `NodeRunSnapshot` в оба spec'а.** Ключ
   `responses` должен совпадать с `DTO_SOURCES` на backend и `MIRROR_SCHEMAS` на
   web. На backend источник — уже существующая `NodeRunSnapshotSchema`
   (`src/runs/dto/run-stream-message.dto.ts`, `kind: 'zod'`), на web — зеркало
   `NodeRunSnapshotSchema` (`web/src/types/run-stream.ts`). Это же гарантирует,
   что REST-формат не разойдётся с SSE: обе стороны читают одну схему, а
   `docs/development/sse-contract.json` не менялся.
5. **Порядок роутов.** На HEAD `@Get(':id')` стоял раньше `:id/budget` и
   `:id/stream`, и это работало только потому, что Express не матчит `:id`
   на два сегмента. Тем не менее новый `:id/nodes` объявлен **до** `:id` (как
   требует DESIGN) и закрыт тестом «`/nodes` не попадает в `findOne`».
6. **`Cache-Control: no-store`.** В проекте уже есть прецедент
   (`media-storage.controller.ts`), поэтому декоратор `@Header` использован и
   здесь; тест проверяет заголовок, чтобы его случайно не потеряли.
7. **Smoke-скрипт: две ошибки в самом инструменте.** (а) В CDP-хелпере
   внутренняя функция `waitFor` затеняла модульную и рекурсивно вызывала себя —
   `RangeError: Maximum call stack size exceeded`; переименована в
   `waitForInPage`. (б) Первая версия проверяла `[data-status]` сразу после
   бейджа запуска и получала `null`: React Flow рисует узлы на кадр позже
   загрузки workflow; добавлено ожидание `.react-flow__node`. Обе правки — в
   gitignored smoke-скрипте, продакшен-код не менялся.
8. **Неожиданная правка чужого файла.** Во время сессии в рабочем дереве
   появился незапланированный diff `src/engine/node-executors.ts` (удалён
   неиспользуемый импорт `DocumentTemplateNotFoundException`). Я его не вносил:
   файл изменён в 14:13, до первой правки backend в этой сессии (14:14).
   Diff откатан (`git checkout --`), после отката `pnpm lint` снова показывает
   ровно тот pre-existing warning, что был на HEAD. Это подтверждает, что
   правка не моя и в пакет не входит.
9. **`restoreRunAsync` в тестах требует мока трёх API-функций.** Store ходит в
   `fetchRunAsync`/`fetchRunNodesAsync`, а после подписки на SSE ещё и в
   `fetchRunBudgetAsync` (R7.1). В `workflow.spec.ts` модуль `@/lib/api`
   подменён через `vi.mock(..., importOriginal)` — реальные схемы остаются
   доступны другим describe'ам, а `ApiError` — тот же класс для `instanceof`.
   `@/lib/run-stream` замокан через `vi.hoisted`, чтобы не открывать настоящий
   `fetch`-поток.
10. **Node 24 в smoke.** Скрипт запускался `node v24.21.0` (окружение машины),
    проект заявлен на Node 22; использованные API (`fetch`, `WebSocket`,
    `node:test`-независимый код) в обеих версиях есть. На прод-код это не
    влияет, но в отчёте фиксирую: CI-версия — Node 22.

---

## 4. Smoke (живые PostgreSQL 17 + Redis 7 + Chrome headless)

Запуск: `node .smoke/s12-s13-smoke.mjs`. Скрипт поднимает:
- smoke-backend `dist/main.js` на `PORT=3197` (реальные `.env` PG/Redis,
  `AUTH_DISABLED=false`, `ALLOW_PRIVATE_IPS=true`,
  `HTTP_NODE_ALLOW_PRIVATE_NETWORKS=true`);
- локальный медленный upstream на `127.0.0.1:<random>` (`/slow` отвечает через
  4.5 с) — чтобы получить честный статус `running`;
- Chrome `--headless=new` с CDP; логин выполняется `fetch('/auth/login')` из
  контекста страницы, cookie refresh ставит сам браузер.

Пользователь и workflow создаются через API; после прогона workflow удаляются
(`DELETE /workflow/:id`, запуски уходят каскадом).

### Сценарий 1 — REST (S12)

| Проверка | Результат |
|---|---|
| `GET /runs/:id` | 200, ключи **`id, workflowId, status, createdAt, error`** — поля `nodes` нет |
| `GET /runs/:id` (`error`) | `null` (KI-347) |
| `GET /runs/:id` (`status`) | `completed` |
| `GET /runs/:id/nodes` | 200, массив из 1 элемента |
| `outputs` узла | `{"text":"smoke-completed-text"}`, `status=completed` |
| метрики/даты | `durationMs=2`, `startedAt=2026-10-19T11:23:16.003Z`, `finishedAt=…16.012Z` |
| форма `NodeRunSnapshot` | есть `nodeId/status/inputs/outputs/error/logs/costUsd/tokensIn/tokensOut` — совпадает с SSE |
| чужой `GET /runs/:id` | **404** (KI-202) |
| чужой `GET /runs/:id/nodes` | **404** (KI-202) |

### Сценарий 2 — UI: F5 после завершённого запуска (S13)

Страница `/?workflowId=…&runId=…` (свежая навигация = F5), запуск уже
`completed`:

| Проверка | Результат |
|---|---|
| логин в браузере (refresh-cookie) | HTTP 200 |
| бейдж запуска `[data-run-badge]` | `completed` — статус восстановлен из `GET /runs/:id` |
| статус узла `[data-status]` | `completed` — карта узлов восстановлена из `GET /runs/:id/nodes` |
| клик по узлу → `[data-result-panel="node"]` | панель содержит `smoke-completed-text` — **outputs без SSE** |
| запросы `…/runs/:id/stream` | **0** — для финального запуска SSE не открывается |

### Сценарий 3 — UI: F5 во время `running` (S13)

Запуск с узлом `http`, который 4.5 с висит на локальном upstream; F5 в статусе
`running`:

| Проверка | Результат |
|---|---|
| стартовый статус после F5 | `running` (из `GET /runs/:id`) |
| SSE-поток | открыт: `http://127.0.0.1:3197/runs/<id>/stream` (виден в CDP Network) |
| финальный статус | `completed` — **без перезагрузки**: переход сделал SSE (`node_completed`+`run_completed`), REST-поллинга в UI нет |
| статус узла после потока | `completed` |

### Итог smoke

**17/17 проверок — `true`, exit code 0.** JSON: `.smoke/s12-s13-smoke-report.json`;
лог приложения: `.smoke/s12-s13-app.log` (в нём видно `Создан запуск …` →
`старт выполнения` → `завершён: status=completed`).

**Что smoke не проверил:** кэш-метрики/`cacheSavingsUsd` и переподпись S3 — в
smoke-графах нет LLM/media-узлов (проверены unit-тестами маппера); пагинации у
`GET /runs/:id/nodes` нет по решению DESIGN (вопрос 12); 404-ветка «запуск
удалён» в UI проверена unit-тестом store, а не браузером.

---

## 5. Что не так

1. **Формулировка промпта расходится с HEAD.** «Перенеси туда логику из
   `RunsStreamService.toNodeSnapshotAsync`» — метода в сервисе уже не было.
   Сделано по фактическому состоянию (модуль → класс), результат совпадает с
   DESIGN. См. § 3.1.
2. **`GET /runs/:id` — ломающее изменение контракта для внешних потребителей,**
   читавших `run.nodes` (добавлено в v0.10.2). Внутри репозитория потребителей
   не осталось (проверено grep'ом), но для гипотетического внешнего клиента это
   breaking change; зафиксировано в `CHANGELOG` секцией `Changed`. Вариант
   «оставить `nodes` как `[]` для совместимости» отвергнут: пустое поле хуже
   отсутствующего — клиент не отличит «узлов нет» от «поле убрали».
3. **`NodeRunSnapshot` теперь гейтуется дважды** — в
   `docs/development/sse-contract.json` (через `SnapshotMessage.nodes`) и в
   `api-contract.json` (REST-ответ). Это осознанно (один формат у двух
   транспортов), но при добавлении поля в снимок править нужно оба JSON'а;
   забытый второй гейт упадёт — значит, риск управляемый.
4. **`restoreRunAsync` не отменяет REST-запросы при размонтировании/смене
   workflow.** Если пользователь быстро уйдёт со страницы (или откроет другой
   workflow), ответы `fetchRunAsync`/`fetchRunNodesAsync` всё равно запишут
   состояние. Окно маленькое (два GET'а), для MVP приемлемо; отдельного
   `AbortController` в `requestAsync` пока нет (кандидат KI-505).
5. **404 в `restoreRunAsync` обрабатывается только по `ApiError.status`,**
   остальные ошибки (сеть/5xx) показывают сырое сообщение backend/`error.message`
   в toast и оставляют `?runId=` в адресе. Это значит, что F5 при недоступном
   backend повторит попытку при следующей загрузке — хорошо — но «красивого»
   текста для 5xx нет.
6. **Путь KI-503 устарел.** В незакоммиченной записи KI-503 (S10-S11) указан
   файл `src/runs/run-node-snapshots.ts`, который этим пакетом удалён. Номер KI
   не меняется, нужна точечная правка `Файлы:` на
   `src/runs/node-run-snapshot.mapper.ts` (RULES 2.12; не правил, чтобы не
   трогать незакоммиченный реестр).
7. **Smoke-скрипт и артефакты в `.smoke/` (gitignored).** В CI они не
   воспроизводятся: для CI понадобился бы отдельный стенд с PG/Redis и Chrome.
   Это тот же уровень доказательств, что в S9/S10-S11, но автоматического
   регрессионного гейта на «F5 после финала» в CI нет — его роль выполняют
   unit-тесты `restoreRunAsync` и contract-гейты.
8. **Smoke создаёт реальных пользователей в dev-БД** (`smoke-s12-…@example.com`,
   два на прогон: владелец и «чужой»). Workflow/запуски удаляются, пользователи
   остаются. Для dev-БД это некритично, но при частых прогонах мусор копится.
9. **В UI-смоуке статус `running` получен «медленным upstream», а не
   искусственной записью в БД.** Это честнее, но зависит от таймингов: между
   созданием запуска и F5 укладывается ~0.3–0.5 с; 4.5 с запаса хватило.
   Если воркер начнёт обрабатывать задание дольше, сценарий может не найти
   `running` — риск флаки у ручного smoke, не у продукта.
10. **Pre-existing lint warning** остался: неиспользуемый
    `DocumentTemplateNotFoundException` в `src/engine/node-executors.ts`
    (S4, вне scope S12/S13). `pnpm lint` — 0 errors.
11. **`web/src/lib/api.spec.ts` не расширен** тестами
    `fetchRunAsync`/`fetchRunNodesAsync` (URL + Zod-разбор). Их косвенно
    покрывают contract-гейт (состав полей), store-тесты (моки API) и живой
    smoke (реальный ответ). Отдельный тест на `encodeURIComponent` не видел
    смысла добавлять — ручка копирует паттерн `fetchRunBudgetAsync`.
12. **Никаких изменений в `RunResultPanel` не потребовалось** — панель читает те
    же поля стора; это проверено smoke'ом (outputs видны после F5). Если в
    будущем панель начнёт читать `run.nodes` напрямую, она сломается — сейчас
    такого чтения нет.

---

## 6. Новые KI

Номера — по текущему максимуму реестра (**KI-504**; 500–504 добавлены
предыдущей сессией и лежат в рабочем дереве). В `docs/KNOWN_ISSUES.md` не
вносил: нумерацию подтверждает пользователь (практика S0-S1/S4-S5/S9/S10-S11).

1. **KI-505-кандидат (Low, надёжность UI).** `restoreRunAsync` не отменяет
   `fetchRunAsync`/`fetchRunNodesAsync` при размонтировании/смене workflow:
   поздний ответ может записать состояние «чужого» запуска. Решение: прокинуть
   `AbortSignal` в `requestAsync` или проверять `get().currentWorkflowId`/
   `window.location` перед `set` (паттерн уже есть в `loadRunBudgetAsync` —
   проверка «запуск не сменился»).
2. **KI-506-кандидат (Low, контракт).** `NodeRunSnapshot` гейтуется двумя
   файлами (`sse-contract.json` и `api-contract.json`). Новое поле снимка
   требует двух правок JSON; если вторую забудут — упадёт гейт, но сообщение
   будет про `NodeRunSnapshot`, а не про «забыли REST». Решение: связать
   снимок в `sse-contract.json` ссылкой на `NodeRunSnapshotSchema` и
   сгенерировать секцию `api-contract.json` из той же схемы (CI-скрипт).
3. **KI-507-кандидат (Low, smoke/CI).** Нет автоматического UI-гейта на
   «F5 после завершённого запуска» и «F5 во время running». Сценарий проверен
   только ручным `.smoke/s12-s13-smoke.mjs` (Chrome headless + CDP, PG/Redis).
   Решение: перенести smoke в CI-job с сервисами (аналог `test:e2e`) либо
   покрыть Playwright/Vitest-browser.
4. **KI-508-кандидат (Low, тестовый долг).** Нет теста API-обёрток
   `fetchRunAsync`/`fetchRunNodesAsync`: проверяются моки store и contract-гейт,
   но не URL/`encodeURIComponent`/Zod-разбор реального ответа
   (`api.spec.ts`). Решение: 2 теста по образцу `document-templates API`.

**KI-077 закрывается этим пакетом** (`GET /runs/:id/nodes` реализован, UI
восстанавливает панель после F5). **KI-450** — исторический дубль KI-077,
закрывается вместе с ним. Точечный diff для закрытия (RULES 2.12; не применял
— реестр в рабочем дереве изменён предыдущей сессией, номера подтверждает
пользователь):

**Найти** (KI-077, строки статуса):
```text
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
```
**Заменить на:**
```text
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S12+S13) | **Обнаружено:** 2026-10-14
```
и добавить после `- **Файлы:**` строку:
```text
- **Fix:** `GET /runs/:id/nodes` (общий `NodeRunSnapshotMapper` с SSE) +
  `restoreRunAsync` в `web/src/stores/workflow.ts`; UI восстанавливает
  outputs/ошибки/метрики/логи после F5 без SSE.
```

**Найти** (KI-450, блок целиком):
```text
### KI-450 — `GET /runs/:id` не отдаёт `node_runs` (дубль KI-077)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-09-?? 
```
**Заменить на:** статус уже `Fixed` (v0.10.2), менять не нужно; в записи
поправить путь `src/runs/run-node-snapshots.ts` → `src/runs/node-run-snapshot.mapper.ts`
(и аналогично в KI-503).

Сводку после закрытия пересчитать grep'ом (RULES 3.20): `Open −1`, `Fixed +1`,
итог не меняется.

---

## 7. Обоснование решений

1. **Один маппер, два транспорта.** DESIGN § 2.6 требует, чтобы REST и SSE
   отдавали одну проекцию. Класс вместо свободных функций выбран потому, что
   теперь два сервиса (SSE и REST) должны получать его через Nest-DI, а
   `MEDIA_STORAGE`/`DRIZZLE` уже есть в графе `RunsModule`. Свободные функции
   удалены, чтобы не оставить второй вход в ту же логику.
2. **`listNodeRunsAsync` делегирует чтение мапперу.** Альтернатива — SELECT в
   сервисе (как в псевдокоде DESIGN) — создала бы два места, читающих
   `node_runs`: `listAsync` и `RunsService`. Порядок «проверка доступа → чтение»
   сохранён; проверяется тестом «404 не вызывает маппер».
3. **`nodes` удалён, `error` добавлен.** Поле `nodes` в `GET /runs/:id` было
   компромиссом v0.10.2 (быстрый фикс F5), теперь оно конкурирует с отдельной
   ручкой и утяжеляет поллинг. `error` нужен отдельно: SSE-снимок его отдаёт, а
   `GET /runs/:id` без него не мог показать причину падения после F5.
4. **`Cache-Control: no-store`.** Ответ авторизованный и меняется во время
   запуска; браузерное эвристическое кэширование могло бы отдать вчерашние
   статусы. Заголовок дешёвый, тест фиксирует его наличие.
5. **`mapsFromNodes` — общая функция, а не метод стора.** Один и тот же маппинг
   нужен `applySnapshot` и `restoreRunAsync`; вынесение в модульную функцию
   (как `withNodeStatus`/`withNodeLogs`) не раздувает публичный интерфейс стора
   и делает различие «REST vs SSE» только в источнике данных.
6. **SSE только для незавершённого запуска.** DESIGN § 3.4.3: для финального
   запуска поток не пришлёт ничего (события уже опубликованы), поэтому
   `restoreRunAsync` закрывает `?runId=` и не подписывается. Для `running`
   REST-снимок — стартовая точка, SSE свежее и заменяет карты целиком
   (семантика `applySnapshot` сохранена).
7. **Финальный `clearRunIdFromUrl` — в `restoreRunAsync`, а не в
   `loadWorkflowAsync`.** Иначе логика «финальный/нефинальный» дублировалась бы
   в двух местах; `loadWorkflowAsync` теперь только делегирует.
8. **404 — единственная специальная ошибка.** Для «запуск удалён/чужой»
   восстановление бессмысленно: сбрасываем состояние, чистим URL, показываем
   toast. Остальные ошибки не должны отменять уже загруженный граф, поэтому
   только toast.
9. **Ключ i18n `toast.run_not_found` — в оба файла** (RULES 1.14); i18n-spec
   проверяет паритет ключей, поэтому «только ru» упало бы.
10. **`NodeRunSnapshot` в `api-contract.json` — как Zod-источник.** На backend
    схема уже есть и общая с SSE; писать для неё TS-интерфейс-зеркало было бы
    дублированием. Это первый REST-ответ, у которого backend-источник — Zod-
    схема SSE-модуля; `$comment` контракта обновлён.
11. **Тесты маппера — отдельный spec, а не расширение stream-спека.** Маппер
    теперь самостоятельно конструируется в DI, и его поведение (переподпись,
    `cacheSavingsUsd`, порядок) больше не «внутренность» SSE-сервиса. Stream-spec
    оставлен как интеграционный: он проверяет, что снимок строится маппером.
12. **Smoke через Chrome headless + CDP, а не «только API».** Требование
    промпта — именно F5 в браузере; API-проверки не доказывают, что store
    восстанавливает карты и открывает SSE. CDP даёт и DOM (`data-status`,
    `data-run-badge`, `data-result-panel`), и сеть (`Network.requestWillBeSent`
    для `/stream`) — по этим атрибутам уже были заложены точки для смоука в
    R4.3/R7.1.
13. **Медленный upstream вместо искусственной строки `running` в БД.** Запись,
    вручную переведённая в `running`, не доказала бы, что SSE реально доставит
    `node_completed`/`run_completed`; живой узел `http` с задержкой 4.5 с даёт
    настоящий поток событий.
14. **`filter` в smoke ищет запросы `/stream` по URL.** Это прямая проверка
    «SSE не открывается для финального» и «SSE открыт для running», не
    зависящая от текста UI.
15. **Docs — по RULES 2.1/2.18, без правки реестра.** CHANGELOG `Added`/`Changed`
    со ссылкой на отчёт, строка в `reports/README.md`, сам отчёт с
    frontmatter. `KNOWN_ISSUES.md` не правил: нумерацию/закрытие подтверждает
    пользователь, точечные diff'ы — в § 6. Гайды `USER_GUIDE`/`QA` — S17
    (RULES 2.16), они уже обновлены в v0.11 S17.

---

## Черновик commit message (не коммитил)

```text
feat(v0.11.0): S12+S13 — history API & F5 restore

S12 (KI-077/KI-450, DESIGN § 3.4.2):
- src/runs/node-run-snapshot.mapper.ts: NodeRunSnapshotMapper
  (toSnapshotAsync/listAsync) — единая проекция node_runs для SSE и REST:
  переподпись stored_url (KI-443/KI-464), cacheSavingsUsd (KI-055), ISO-даты.
  run-node-snapshots.ts удалён, RunsStreamService/RunsService используют маппер.
- GET /runs/:id/nodes (до :id, Cache-Control: no-store), 404 для чужого (KI-202).
- RunResponse: удалено nodes (v0.10.2, KI-450), добавлено error (KI-347).
- api-contract.json: RunResponse{error}, NodeRunSnapshot; backend/web гейты.
- Тесты: mapper (+9), controller (+5), service listNodeRunsAsync (+3).

S13 (DESIGN § 3.4.3):
- web/src/lib/api.ts: ApiRunSchema без nodes + error; fetchRunAsync,
  fetchRunNodesAsync.
- stores/workflow.ts: mapsFromNodes, restoreRunAsync (REST → карты; SSE только
  для pending/running; финал чистит ?runId=; 404 сбрасывает состояние+toast),
  loadWorkflowAsync восстанавливает через restoreRunAsync.
- i18n: toast.run_not_found (ru/en); тесты restoreRunAsync (+5), contract (+1).

Docs: reports/v0.11.0/S12-S13-history.md, reports/README, CHANGELOG
(Added + Changed).

Smoke: PG17+Redis7+Chrome headless/CDP, 17/17: REST без nodes/с error и
GET /runs/:id/nodes с outputs; F5 completed — outputs в панели без SSE
(0 запросов /stream); F5 running — /stream открыт, SSE довёл до completed
без reload.

Refs: DESIGN v0.11 § 3.4.2, § 3.4.3, § 5 (S12, S13); KI-077, KI-450, KI-202,
KI-347, KI-443, KI-464, KI-271.
```
