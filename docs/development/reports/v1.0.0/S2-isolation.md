---
title: "S2: Workflow Isolation (мультитенантность, v1.0.0)"
date: 2026-11-02
version: v1.0.0
steps: [S2]
status: accepted
related_ki: [KI-559, KI-560, KI-561, KI-562, KI-563, KI-564]
related_adr: [0002]
---

# Отчёт S2 — Workflow Isolation (v1.0.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **106 passed / 4 skipped
(110 файлов), 1602 passed / 22 skipped** без `DATABASE_URL`; с `DATABASE_URL` —
**110/110 файлов, 1622 passed / 2 skipped**, `pnpm test:parity` — **11/11**,
`pnpm test:e2e` — **1/1**, `pnpm lint` — **0 errors / 2 warnings**
(преэкзистующие). Смоук на живом приложении — **8/8** проверок: два
пользователя в разных организациях, матрица **13/13** маршрутов чужого
workflow → 404, кросс-организационный инвайт → 404, публичная share-ссылка →
200 без auth, инвайт/чтение/экспорт/запуск внутри одной организации → 2xx,
демо-workflow (81) не протекают в список.

**Точка старта.** HEAD `1e293d3` («feat(v1.0.0): S1 — Organizations DB &
Auth»), CI зелёный. Источник — `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md`
§ 3.1 (S2: изоляция), правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** во всех методах `WorkflowService` (13 публичных +
вспомогательные), `RunsService`/`RunsController`/`RunsHistoryController`/
`RunsStreamService`, `DocumentTemplatesService`/Controller и lookup
`sub_workflow` добавлена изоляция по `organizationId` из access-токена; введён
`WorkflowAccess { userId, orgId }` + `toWorkflowAccess(user)`; кросс-организационные
инвайты запрещены, список участников фильтруется по организации; публичная
share-ссылка оставлена capability-моделью. **Новые KI:** KI-559..564 (§ 6).

---

## 1. Файлы (+/−)

Все изменения — в существующих файлах (новых файлов кода нет: схема БД и
API-контракт в S2 не меняются — колонки добавлены в S1).

### 1.1 Production

| Файл | +/− | Что |
|---|---:|---|
| [src/workflow/workflow-access.ts](../../../../src/workflow/workflow-access.ts) | +84/−27 | `WorkflowAccess { userId, orgId }`, `toWorkflowAccess(user)`; `workflowAccessFilter`/`workflowAccessListFilter`/`workflowOwnerFilter`/`accessibleWorkflowIdsSubquery` получили `workflows.organization_id = orgId`; JSDoc об изоляции |
| [src/workflow/workflow.service.ts](../../../../src/workflow/workflow.service.ts) | +137/−102 | Все 13 публичных методов + `findOwnerAsync`/`build*Filter` принимают `WorkflowAccess`; `findAll/findOne/export/update/remove/share/collaborators` — org-scoped; участники фильтруются по организации; инвайт требует ту же организацию (иначе 404); `findSharedAsync` намеренно без org-фильтра |
| [src/workflow/workflow.controller.ts](../../../../src/workflow/workflow.controller.ts) | +62/−26 | `toWorkflowAccess(user)` во всех 13 маршрутах; JSDoc об источнике контекста (только токен) |
| [src/runs/runs.service.ts](../../../../src/runs/runs.service.ts) | +58/−33 | `createRunAsync`/`getRunAsync`/`listNodeRunsAsync`/`getRunRowAsync`/`listRunsAsync` — `WorkflowAccess`; запуск — `workflowAccessFilter(..., 'editor')`; запуски — `accessibleWorkflowIdsSubquery(access)`; история — org-scoped editor |
| [src/runs/runs.controller.ts](../../../../src/runs/runs.controller.ts) | +29/−18 | Оба контроллера (`RunsController`, `RunsHistoryController`) передают `toWorkflowAccess(user)` (create/nodes/run/budget/stream/история) |
| [src/runs/runs-stream.service.ts](../../../../src/runs/runs-stream.service.ts) | +22/−14 | `assertRunExistsAsync`/`streamAsync`/`consumeAsync` проносят `access` до `getRunRowAsync` (SSE не открывается для чужого run) |
| [src/documents/document-templates.service.ts](../../../../src/documents/document-templates.service.ts) | +26/−18 | `list/create/getFile/delete` — `WorkflowAccess`; `assertWorkflowAccessAsync` через org-scoped `workflowAccessFilter`; 404/403 семантика сохранена |
| [src/documents/document-templates.controller.ts](../../../../src/documents/document-templates.controller.ts) | +25/−10 | `toWorkflowAccess(user)` на всех 4 маршрутах |
| [src/engine/node-executors.ts](../../../../src/engine/node-executors.ts) | +48/−13 | `SubWorkflowAccess { userId, orgId }`; `SubWorkflowLookup.findOneAsync(id, access?)`; `SubWorkflowContext.rootOrgId`; `executeSubWorkflowNode` 404 при `null` owner/org и грузит подграф только с access-объектом |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +26/−16 | `findRootUserIdAsync` → `findRootAccessAsync` (userId + organizationId одним join); контекст получает `rootUserId`/`rootOrgId`; при ошибке чтения — оба `null` (fail-closed) |
| [src/templates/templates.controller.ts](../../../../src/templates/templates.controller.ts) | +4/−2 | `instantiate` передаёт `toWorkflowAccess(user)` в `importAsync` |

**Итого production:** **11 файлов, +521 / −279**.

### 1.2 Тесты

| Файл | +/− | Что |
|---|---:|---|
| [src/workflow/workflow-access.spec.ts](../../../../src/workflow/workflow-access.spec.ts) | +30/−16 | org-условие в SQL всех 5 хелперов (параметры/`organization_id`) |
| [src/workflow/workflow.service.spec.ts](../../../../src/workflow/workflow.service.spec.ts) | +79/−25 | Все вызовы — объект; SQL-проверки org для list/findOne/update/export/remove; новый describe `exportAsync`; «без access — без фильтра» сохранено/проверено |
| [src/workflow/workflow.controller.spec.ts](../../../../src/workflow/workflow.controller.spec.ts) | +24/−15 | Ожидания `{userId, orgId}`; новый тест «сервис вернул null (чужая org) → 404» |
| [src/workflow/workflow-collaborators.spec.ts](../../../../src/workflow/workflow-collaborators.spec.ts) | +102/−20 | Список участников фильтрует `users.organization_id`; кросс-организационный инвайт → `NotFoundException` без INSERT; e2e-ожидания с org-объектом |
| [src/workflow/workflow-share.spec.ts](../../../../src/workflow/workflow-share.spec.ts) | +68/−13 | Owner-filter с org на create/revoke; новый тест «`findSharedAsync` — только `share_token`, без organization_id» (публичный доступ не сломан) |
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +207/−32 | Access во всех вызовах; org в WHERE/workflow-подзапросе; кросс-org create/get/listRuns → 404 |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +30/−10 | Точные `{userId, orgId}` на всех маршрутах; cross-org 404 |
| [src/runs/runs-stream.service.spec.ts](../../../../src/runs/runs-stream.service.spec.ts) | +62/−19 | Access проносится до `getRunRowAsync`; чужой run → 404 на assert и в потоке |
| [src/documents/document-templates.service.spec.ts](../../../../src/documents/document-templates.service.spec.ts) | +227/−24 | Access во всех вызовах; org в WHERE; кросс-org list/create/getFile/delete → 404 |
| [src/documents/document-templates.controller.spec.ts](../../../../src/documents/document-templates.controller.spec.ts) | +49/−4 | `{userId, orgId}` в вызовах; cross-org delete → 404 |
| [src/engine/node-executors.spec.ts](../../../../src/engine/node-executors.spec.ts) | +28/−4 | `rootOrgId` в контексте; `findOneAsync` с объектом; новый кейс `rootOrgId: null` → 404 без lookup |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +52/−8 | Join отдаёт `organizationId`; ожидание `{userId, orgId}`; новый кейс «owner/org не определён → подграф 404, lookup не вызван» |
| [src/templates/templates.controller.spec.ts](../../../../src/templates/templates.controller.spec.ts) | +5/−6 | `importAsync(artifact, {userId, orgId})` |

**Итого тесты:** **13 файлов, +963 / −196**.

**Всего по коду:** **24 файла, +1484 / −475**, +26 passed-тестов. Документация
(не входит в счёт кода): `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`
(+KI-559..564 и удаление дублей), `docs/development/adr/0002-*.md`,
`docs/development/reports/README.md`, этот отчёт.

Артефакт смоука (gitignored): `.smoke/v100-s2-isolation-smoke.mjs` +
`.smoke/v100-s2-isolation-smoke.json`.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (без `DATABASE_URL`) | **106 passed / 4 skipped (110 файлов); 1602 passed / 22 skipped (1624)**, 22.8 с |
| `pnpm test` (с `DATABASE_URL`) | **110/110 файлов; 1622 passed / 2 skipped**, 23.2 с — parity/backfill/vector/media выполнились |
| `pnpm test:parity` | **11/11** (KI-298; схема не менялась — гейт подтверждает отсутствие дрейфа) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с новым DI-графом) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`src/media/providers/openai-images.provider.spec.ts`) |
| oxlint changed files (по командам) | workflow — 0/0, runs+documents — 0/0, engine+templates — 0/0 |

Прирост к S1: **+26 passed-тестов** (1602−1576 без БД; 1622−1596 с БД);
2 оставшихся skipped с `DATABASE_URL` — `openai-images.integration.spec.ts`
(`skipIf` без реального ключа), к S2 не относятся. Новых миграций/гейтов нет:
S2 — только код (+ тесты), схема БД и API-контракт не менялись.

Проверка внешних контрактов: `docs/development/api-contract.json` не менялся
(форма ответов та же, меняются только коды доступа 200/201 → 404 для чужого
tenant'а), web-тесты не запускались осознанно — frontend не декодирует org и
уже обрабатывает 404 как «не найдено» (S2 UI-изменений не требует).

---

## 3. Диагностика

### 3.1 Семантика: org + user-level access, а не «вся организация»

DESIGN § 2.1 говорит о командах и ролях (owner/admin/member/viewer), но ролей
ещё нет: `workflow_collaborators` остаётся единственным механизмом точечного
доступа. Выбран компромисс **«организация AND (владелец | участник)»**:
изоляция закрывает утечку по uuid и через инвайты, при этом не расширяет
неявно права (все члены организации не начинают видеть все графы до появления
ролей). Альтернатива «org-only» отклонена до S5 — иначе S2 сам вводит
team-wide видимость без модели прав. Зафиксировано в ADR-0002, ограничение —
KI-563.

### 3.2 Найдена дыра в инвайте участника

Исходный `inviteCollaboratorAsync` проверял только существование пользователя
по uuid — владелец workflow мог пригласить пользователя **любой** организации,
создав кросс-тенантную строку. Исправлено: выборка целевого пользователя
дополнена `users.organization_id = access.orgId`; «нет пользователя» и «другая
организация» дают одинаковый 404 (нет user enumeration). Покрыто двумя тестами
(services + collaborators spec) и смоуком (кросс-организационный инвайт → 404).

### 3.3 PII в списке участников

Строки `workflow_collaborators`, созданные до S2, после бэкфилла S1 указывают
на пользователей чужих организаций. Доступ они уже не дают (org-предикат), но
`GET /workflow/:id/collaborators` отдавал бы их email. Добавлен фильтр
участников по `users.organization_id = access.orgId`: чужая PII не утекает,
владелец видит только «своих». Строки остаются в БД (на dev-БД — 1) — это
зафиксировано в KI-560 (нужна миграция-аудит в S5).

### 3.4 `sub_workflow` грузил подграф без проверки организации

Движок передавал в `WorkflowService.findOneAsync` только `rootUserId`: граф
другой организации с известным uuid мог быть загружен как подграф (проверялся
лишь владелец/участник). Теперь `findRootAccessAsync` читает `userId` **и**
`organizationId` корневого workflow одним join'ом; `SubWorkflowContext`
получает `rootOrgId`. Если owner или org не определён — 404, lookup не
вызывается (fail-closed, непроверенного пути не осталось). Покрыто unit-тестом
(node-executors) и тестом движка (lookup не вызывается при `null`).

### 3.5 Тестовая стратегия: SQL-shape против мок-БД + живой смоук

Юнит-спеки на мок-БД не могут выполнить SQL, поэтому наличие org-предиката
доказывается разбором `SQL.queryChunks`/`Param.value` (helper
`sqlContainsValue`). Это дешёвый регресс-гейт на «предикат потерян», но тесты
зависят от приватных структур drizzle-orm — вынесено в KI-562. Поведенческая
проверка выполнена живым смоуком на реальной БД (§ 4); DB-интеграционный spec
изоляции не добавлялся (в этом срезе он дублировал бы смоук).

### 3.6 Уборка смоука упала на FK — новый KI

Все 8 проверок смоука прошли, но первый прогон упал **в уборке**:
`DELETE FROM organizations` вернул ошибку
`violates foreign key constraint workflow_collaborators_invited_by_users_id_fk`
(23503). Причина: `invited_by` ссылается на `users.id` без CASCADE, а порядок
каскадов org→users/org→workflows не гарантирован. Скрипт исправлен (сначала
удаляются строки участников, затем организации), повторный прогон — чисто.
Это не баг S2, а будущая проблема «удаление организации» — KI-559 (вместе с
политикой удаления, KI-558).

### 3.7 Параллельная работа: промежуточные ошибки компиляции

Три команды меняли пересекающиеся контракты (WorkflowService ↔ RunsService ↔
engine/templates). На промежуточных состояниях `tsc -p tsconfig.spec.json`
показывал до 55 ошибок в чужих файлах; после завершения всех трёх — **0**.
Финальный `pnpm typecheck` и полный `pnpm test` прогонялись только на итоговом
дереве.

### 3.8 Необязательный `access` во внутренних методах

`findAllAsync/findOneAsync/updateAsync/removeAsync/createRunAsync/getRunAsync/
listNodeRunsAsync/getRunRowAsync` сохранили `access?` для совместимости
внутренних вызовов/тестов; все HTTP-пути всегда передают
`toWorkflowAccess(user)`. Риск: будущий внутренний вызов без `access` обойдёт
изоляцию — задокументировано в KI-561 (сделать обязательным/dev-assert).

### 3.9 Дефекты реестра KI на HEAD — исправлены в docs-проходе

В закоммиченном S1 состоянии `docs/KNOWN_ISSUES.md` содержал два дубля:
блок KI-552..558 в кратком виде (7 записей) после подробного блока, и вторую
копию KI-527. Из-за этого `grep '^### KI-'` давал 553 записи вместо 546, а
номера KI повторялись. В S2-проходе дубли удалены, реестр пересчитан grep'ом
(RULES 3.20): **551** запись, 551 строка статуса, номера уникальны
(242 Fixed + 1 Fixed(частично) + 277 Open + 21 Documented + 1 Documented(не
воспроизводится) + 4 Planned + 1 Deferred + 4 Won't Fix). Это чисто docs-фикс,
кода не касается; упомянут в § 5.

---

## 4. Smoke (живое приложение)

Окружение: PostgreSQL 17 (pgvector) `127.0.0.1:5433/workflow_builder`, Redis
`127.0.0.1:6379`, приложение — `node dist/main.js` (порт 3000,
`AUTH_DISABLED=false`). Старт чистый (только ожидаемые WARN «ключ не задан» для
media/web-search провайдеров), шаблоны 3/3. Скрипт:
`.smoke/v100-s2-isolation-smoke.mjs`.

### 4.1 Два пользователя — две организации

`POST /auth/register` ×2 → 201; `orgId` в JWT различаются:
`2aa6d549-da81-4b3f-9d95-04dca734dddb` (A) и
`debfcf0a-caa3-4e6d-b1f7-8972e605a9ab` (B). **PASS**.

### 4.2 Список workflow org-scoped

A создал workflow `86caaee0-…`; B создал `4c210b65-…`. `GET /workflow`:
A видит только свой, B — только свой. В списках нет ни одного из **81**
workflow демо-организации `000…002` (`AUTH_DISABLED`). **PASS**.

### 4.3 Матрица 404: B → workflow A (13 маршрутов)

`GET /workflow/:id`; `PATCH`; `DELETE`; `GET …/export`; `POST …/share`;
`DELETE …/share`; `GET …/collaborators`; `POST …/collaborators`;
`PATCH …/collaborators/:userId`; `DELETE …/collaborators/:userId`;
`GET …/runs`; `GET …/document-templates`; `POST /runs {workflowId}` — **все
13 → 404** (не 403: существование не раскрывается). **PASS**.

### 4.4 Кросс-организационный инвайт

A приглашает B (`role: editor`) до переноса организации → **404**
«Пользователь … не найден» (тот же ответ, что для несуществующего). **PASS**.

### 4.5 Публичная share-ссылка не сломана

A выпускает `POST /workflow/:id/share` → 200; **без Authorization**
`GET /workflow/share/:token` → 200, возвращает граф A. Org-фильтр к публичному
доступу не применяется (capability по токену). **PASS**.

### 4.6 Одна организация: инвайт, чтение, экспорт, запуск

Прямой SQL-правкой dev-БД B переведён в organization A, выполнен повторный
`POST /auth/login` (в токене уже orgId A). Затем:

- `POST …/collaborators` A → B (`editor`) → **201**;
- `GET /workflow` B → видит workflow A; свой прежний workflow, оставшийся в
  организации org B, **не видит** (workflow принадлежит организации, а не
  пользователю);
- `GET /workflow/:id` → **200**, `GET …/export` → **200**;
- `POST /runs {workflowId A}` → **201**, движок завершил пустой граф
  (`status=completed, узлов 0`).

**PASS** (4 проверки). Это доказывает, что изоляция не «выключила»
коллаборацию внутри организации.

### 4.7 Уборка и состояние БД

Первый прогон: все проверки PASS, но уборка упала на FK (KI-559, § 3.6).
Скрипт исправлен (удаление `workflow_collaborators` до организаций), повторный
прогон — `cleanup.organizationsDeleted = 2`, ошибок нет. После смоука БД
вернулась к исходному состоянию: **users=69, workflows=160, organizations=69,
workflow_collaborators=1** (та самая legacy кросс-орг строка, KI-560).

---

## 5. Что не так

1. **Совместная работа между организациями невозможна до S5** (KI-563): S1
   дал каждому пользователю личную организацию, S2 разрешает коллаборацию
   только внутри неё. API создания организации/приглашения в неё появится в S5,
   поэтому сейчас два пользователя не могут вместе работать над графом
   (в смоуке same-org путь проверен прямой SQL-правкой `users.organization_id`).
   Это осознанное следствие изоляции, но продуктово заметное.
2. **Legacy кросс-организационные участники** (в dev-БД — 1 строка) доступа не
   дают и скрыты из списка, но остаются в БД; миграции-аудита нет (KI-560).
   Владелец при знании uuid всё ещё может удалить/сменить роль такой строки —
   эндпоинты по `participantId` не проверяют организацию участника.
3. **Семантика org + user-level access** консервативнее, чем «все члены
   организации видят графы организации»: роли организации (DESIGN § 2.1) не
   реализованы, поэтому team-wide видимость не вводилась. В S5, возможно,
   придётся ослабить фильтр — тогда это будет осознанное изменение (ADR-0002).
4. **Удаление организации падает на FK** `workflow_collaborators.invited_by`
   (23503) — воспроизведено смоуком при уборке (KI-559). API удаления нет,
   но политику/порядок удаления нужно решить вместе с KI-558 (S5).
5. **Необязательный `WorkflowAccess`** оставляет внутренние методы без фильтра
   (KI-561): компилятор не заставит будущий внутренний вызов передать access.
6. **SQL-shape тесты зависят от приватных структур drizzle-orm**
   (`queryChunks`/`Param.value`) — brittleness на обновление ORM (KI-562);
   поведенческий DB-интеграционный spec изоляции не добавлен (есть e2e-бутстрап
   и живой смоук).
7. **Нет DB-инварианта «организация workflow = организация владельца»**
   (KI-564): держится только на том, что оба поля приходят из одного токена.
8. **Публичная share-ссылка обходит org-фильтр by design** (явное требование
   S2): владелец токена может отдать граф наружу независимо от организации.
   Модель capability прежняя (R6.2.1); отзыв токена работает.
9. **Media-файлы `/media/file/:runId/:fileName`** защищены HMAC-подписью, а не
   org-проверкой (R7.8/KI-415) — pre-existing capability-модель, S2 её не
   меняет; ссылка подписана на `storageKey`, т.е. фактически на runId.
10. **Stale `orgId` в JWT после смены организации**: до 24 ч старый access-токен
    несёт прежнюю организацию (в смоуке после переноса B потребовался повторный
    login). Это ожидаемое следствие KI-554 (guard не сверяет членство в БД);
    API смены организации пока нет.
11. **`sub_workflow` при неудачном определении owner/org** валит только узлы
    подграфа (404), остальной граф исполняется — прежнее поведение движка
    (сбой прав одного узла не роняет run, RULES 4.16/4.18), не регресс S2.
12. **Проверки изоляции в web отсутствуют** — frontend не изменился (нет
   org-концепции до S5); 404 для чужих объектов UI уже показывает как
   «не найдено». E2E-сценарий изоляции на уровне UI не заводился.
13. **Prettier на HEAD не чист** — форматирование не применялось (как и в
    предыдущих сессиях), гейты — `oxlint` и `tsc`.
14. **Docs-дефект HEAD (исправлен):** дубли KI-552..558 и KI-527 в
    `docs/KNOWN_ISSUES.md`; реестр пересчитан (551 запись, номера уникальны,
    сводка по grep). К коду отношения не имеет, но искажало статистику KI.

---

## 6. Новые KI

Всего **6**: KI-559..564 (реестр пересчитан grep'ом, RULES 3.20: **551**
запись, сумма по статусам = 551).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-559](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Удаление организации падает на FK `workflow_collaborators.invited_by` (23503) |
| [KI-560](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Legacy кросс-организационные участники не дают доступа и скрыты, но не чистятся |
| [KI-561](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Необязательный `WorkflowAccess` оставляет внутренние методы без фильтра |
| [KI-562](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | SQL-shape тесты изоляции зависят от приватных структур drizzle-orm |
| [KI-563](../../../KNOWN_ISSUES.md) | 🟡 Medium | Planned (S5) | Совместная работа между организациями недоступна до S5 (все в личных org) |
| [KI-564](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Нет DB-инварианта «организация workflow = организация владельца» |

Закрытых KI в S2 нет; KI-552 (S1, Planned S2) **переведён в Deferred**:
`document_templates` и `workflow_runs` изоляция получила через `workflow_id`
(org-scoped проверка workflow), но отдельных колонок `organization_id` в них
по-прежнему нет — денормализация отложена до запросов «всё по организации»
(S5/backlog), в задании S2 такой миграции не было. Обновлены
`docs/CHANGELOG.md` (`[Unreleased]`: Added/Changed/Security/Documented) и
`docs/KNOWN_ISSUES.md` (раздел S2 + сводка + удаление дублей).

---

## 7. Обоснование решений

### 7.1 Почему «организация AND (владелец | участник)», а не org-only

DESIGN § 2.1 описывает роли организации, но в S2 их ещё нет. Org-only фильтр
означал бы, что любой член организации видит **все** графы организации — это
новое правило доступа, вводимое «попутно», без модели ролей и UI управления
командой. Выбранный вариант сохраняет существующую семантику (владелец +
явные участники) и добавляет к ней арендатора: утечек между tenant'ами нет,
права не расширяются. Если S5 введёт роли, ослабление фильтра будет отдельным
осознанным решением (ADR-0002, KI-563).

### 7.2 Почему `WorkflowAccess`-объект и `toWorkflowAccess`

Пара строк `(userId, orgId)` позволяет забыть третий аргумент при добавлении
нового метода — и получить тихую дыру. Объект делает отсутствие orgId ошибкой
компиляции, а `toWorkflowAccess(user)` — единственную точку сборки контекста из
токена: `orgId` физически не может прийти из body/query. Все 13 маршрутов
`WorkflowController` и остальные контроллеры используют один и тот же helper.

### 7.3 Почему 404, а не 403

Политика проекта (KI-202): чужой объект неотличим от несуществующего, иначе
пользователь может перебором uuid выяснять, что существует в других
организациях. Для tenant-изоляции это тем важнее; 403 оставлен только там, где
это существующая семантика ролей (`viewer` на изменяющих ручках документов,
где workflow уже виден пользователю).

### 7.4 Почему публичный share не фильтруется по org

Прямое требование постановки S2: «`WorkflowShareController` (публичный доступ)
— проверка по orgId не применяется (там доступ по токену)». Это capability-
модель R6.2.1: знание токена и есть доступ; org-фильтр сломал бы все существующие
share-ссылки и публичную read-only страницу. Отзыв токена (`DELETE …/share`)
остаётся у владельца в его организации и защищён org-scoped owner-фильтром.

### 7.5 Почему инвайт — только внутри организации и с 404

Кросс-организационный инвайт создавал бы строку, которая после S2 всё равно не
даёт доступа (org-предикат), но раскрывал бы существование пользователя чужого
tenant'а и оставлял мусор в БД. Проверка организации в SQL-выборке целевого
пользователя закрывает и то, и другое; одинаковый 404 не даёт перечислять
пользователей. Список участников фильтруется по той же причине (PII).

### 7.6 Почему `sub_workflow` получил `rootOrgId`, а не отдельный запрос

Движок уже делает join `workflow_runs → workflows` для владельца — добавление
`organizationId` в ту же проекцию бесплатно (0 лишних запросов) и не вносит
расхождений «владелец из одного запроса, организация из другого». Fail-closed
(`null` → 404) выбран вместо «загрузить без проверки»: цена — узел подграфа
падает при проблеме чтения, но данные чужого tenant'а не утекают (RULES 4.18).

### 7.7 Почему не менялись схема и API-контракт

Колонки `organization_id` в `workflows`/`users` добавлены в S1; S2 — это
изменение предикатов доступа, а не формы данных/ответов. Поэтому нет миграции,
`api-contract.json` не меняется, parity-гейт остаётся зелёным. Меняются только
коды ответов для «чужого» (200/201 → 404) — это и есть целевое поведение,
задокументированное в CHANGELOG.

### 7.8 Почему оставлен необязательный `access` и заведён KI

`findAllAsync`/`findOneAsync`/… исторически поддерживают вызов без
пользователя (внутренние/тестовые сценарии, движок до S2). Сделать параметр
обязательным — значит добавить internal-вариант API или прокидывать фиктивный
access в тестах, что расширило бы диффом S2. Компромисс: все HTTP-пути
передают access, риск будущего внутреннего вызова без фильтра зафиксирован в
KI-561 (сделать обязательным или dev-assert — отдельная задача).

### 7.9 Почему тесты проверяют SQL, а не только делегирование

Юнит-тесты на мок-БД проверяют, что сервис передал `access` в предикат, но не
что предикат содержит `organization_id`. Чтобы регресс «предикат потерян» был
пойман дёшево, спеки разбирают SQL (`queryChunks`/`Param.value`). Это
компромисс между скоростью и достоверностью; brittleness зафиксирован в
KI-562, поведенческая достоверность — живым смоуком на реальной БД.

### 7.10 Почему docs-проход включил чистку реестра KI

На HEAD (S1-коммит) в `KNOWN_ISSUES.md` оказались дубли: краткий блок
KI-552..558 и вторая копия KI-527 — `grep` давал 553 записи вместо 546, номера
повторялись. RULES 3.20 требует считать сводку только по grep, поэтому без
чистки любая цифра в отчёте/CHANGELOG была бы ложной. Дубли удалены, реестр
пересчитан (551 запись, уникальные номера, сводка сходится); новый раздел S2
добавлен в хронологическом месте.
