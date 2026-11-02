---
title: "S1: Organizations DB & Auth (мультитенантность, v1.0.0)"
date: 2026-11-02
version: v1.0.0
steps: [S1]
status: accepted
related_ki: [KI-552, KI-553, KI-554, KI-555, KI-556, KI-557, KI-558]
related_adr: [0001]
---

# Отчёт S1 — Organizations DB & Auth (v1.0.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **106 passed / 4 skipped
(110 файлов), 1576 passed / 22 skipped** без `DATABASE_URL`; с `DATABASE_URL` —
**110/110 файлов, 1596 passed / 2 skipped**, `pnpm test:parity` — **11/11**,
`pnpm test:e2e` — **1/1**, `pnpm lint` — **0 errors / 2 warnings**
(преэкзистующие). Смоук на живом приложении — **9/9** проверок
(регистрация → org в БД → JWT с `orgId`; login; `/auth/me`; workflow с
`organization_id`; legacy-JWT → 401; refresh восстанавливает сессию;
`AUTH_DISABLED` → демо-организация).

**Точка старта.** HEAD `b790588` («feat(v0.16.0): Tech Debt Sprint»), CI
зелёный. Источник — `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md` § 3.1/§ 4,
правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** таблица `organizations`; `organization_id` в `users` и
`workflows`; миграция `0014_heavy_iron_patriot.sql` + идемпотентный backfill
существующих данных; `orgId` в JWT, создание организации при регистрации,
извлечение `orgId` guard'ом; `organization_id` пишется при создании/импорте
workflow. **Новые KI:** KI-552..558 (§ 6).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы (код)

| Файл | Строк | Что |
|---|---:|---|
| [src/db/migrations/backfill-organizations.ts](../../../../src/db/migrations/backfill-organizations.ts) *(new)* | 199 | `backfillOrganizationsAsync(executor)`: демо-организация с детерминированным id, персональные организации `Personal Workspace - {email}` (с `NOT EXISTS`), привязка users и workflow, DO-блок с понятной ошибкой при остатке NULL, `SET NOT NULL`; идемпотентен, пустые таблицы — штатный проход |
| [src/db/migrations/backfill-organizations.spec.ts](../../../../src/db/migrations/backfill-organizations.spec.ts) *(new)* | 327 | Интеграционный тест (`skipIf(!DATABASE_URL)`) на scratch-схеме в транзакции: создание/привязка, идемпотентность 2-го прогона, пустые `users`/`workflows` → 0 организаций, NOT NULL; `public` не блокируется |
| [src/auth/guards/jwt-auth.guard.spec.ts](../../../../src/auth/guards/jwt-auth.guard.spec.ts) *(new)* | 161 | 8 кейсов guard'а: `AUTH_DISABLED` → `DEMO_ORG_ID`, валидный токен → `request.user` c `orgId`, legacy/пустой `orgId` → 401, нет/не-Bearer/битый токен → 401 |
| [drizzle/0014_heavy_iron_patriot.sql](../../../../drizzle/0014_heavy_iron_patriot.sql) *(new)* | 18 | `CREATE TABLE organizations`; `ADD COLUMN organization_id` **nullable** (NOT NULL включает backfill) + FK `ON DELETE CASCADE` + 2 индекса |
| [drizzle/meta/0014_snapshot.json](../../../../drizzle/meta/0014_snapshot.json) *(new)* | 989 | Снимок Drizzle (10 таблиц): `organizations`, NOT NULL/FK/индексы `organization_id` — соответствует `schema.ts` |
| [docs/development/adr/0001-organizations-migration-strategy.md](../../adr/0001-organizations-migration-strategy.md) *(new)* | 80 | ADR: nullable → backfill в `migrate.ts` → NOT NULL, инвалидация legacy-JWT |

### 1.2 Изменённые файлы

| Файл | +/− | Что |
|---|---:|---|
| [src/db/schema.ts](../../../../src/db/schema.ts) | +76/−22 | `organizations` (id uuid PK defaultRandom, name text NOT NULL, created_at timestamptz NOT NULL defaultNow) + `Organization`/`NewOrganization`; `users.organizationId` и `workflows.organizationId` uuid NOT NULL FK→organizations `ON DELETE CASCADE`; индексы `users_organization_id_idx`/`workflows_organization_id_idx`; JSDoc о мультитенантности |
| [src/db/schema.spec.ts](../../../../src/db/schema.spec.ts) | +101/−1 | Новый describe: метаданные `organizations`; для users/workflows — имя/тип/NOT NULL FK-цель/cascade/индекс через `getTableConfig`; `expectTypeOf` для `Organization`/`User`/`Workflow`/`NewWorkflow` |
| [src/db/schema-parity.spec.ts](../../../../src/db/schema-parity.spec.ts) | +3/−1 | `REQUIRED_TABLE_NAMES` += `organizations` (обязательных таблиц — шесть) |
| [drizzle/meta/_journal.json](../../../../drizzle/meta/_journal.json) | +7/−0 | Запись миграции 0014 |
| [migrate.ts](../../../../migrate.ts) | +27/−1 | После `migrate()`: `BEGIN` → `backfillOrganizationsAsync(client)` → `COMMIT`, `ROLLBACK` при ошибке, release клиента, короткий итог в лог (KI-205 — без пароля в логах) |
| [src/auth/auth.service.ts](../../../../src/auth/auth.service.ts) | +34/−9 | `registerAsync`: pre-check email снаружи, затем одна транзакция «organization → user с organizationId»; `generateAccessTokenAsync` кладёт `orgId: user.organizationId` |
| [src/auth/auth.service.spec.ts](../../../../src/auth/auth.service.spec.ts) | +121/−21 | Мок транзакции с двумя INSERT'ами; имя организации `Personal Workspace - {email}`; `organizationId` у пользователя; `signAsync` c `orgId` для register/login/rotate; прежние кейсы сохранены |
| [src/auth/guards/jwt-auth.guard.ts](../../../../src/auth/guards/jwt-auth.guard.ts) | +29/−7 | `AUTH_DISABLED` → `{sub, email, orgId: DEMO_ORG_ID}`; после `verifyAsync` отказ при отсутствии/пустом `orgId` («Токен устарел…») |
| [src/auth/interfaces/jwt-payload.ts](../../../../src/auth/interfaces/jwt-payload.ts) | +7/−0 | Обязательный `orgId: string` + JSDoc (DESIGN § 3.1/§ 4) |
| [src/auth/auth.constants.ts](../../../../src/auth/auth.constants.ts) | +9/−0 | `DEMO_ORG_ID = '00000000-0000-0000-0000-000000000002'` (создаётся backfill'ом) |
| [src/auth/auth.controller.spec.ts](../../../../src/auth/auth.controller.spec.ts) | +16/−1 | Payload с `orgId`; HTTP-кейс «legacy-токен без orgId → 401» |
| [src/workflow/workflow.service.ts](../../../../src/workflow/workflow.service.ts) | +18/−2 | `createAsync(dto, userId, organizationId)` / `importAsync(...)` пишут `organizationId` (фильтрация — S2) |
| [src/workflow/workflow.service.spec.ts](../../../../src/workflow/workflow.service.spec.ts) | +31/−1 | `baseWorkflow.organizationId`; третий аргумент и значения INSERT'а; новый тест `importAsync` |
| [src/workflow/workflow.controller.ts](../../../../src/workflow/workflow.controller.ts) | +4/−3 | create/import передают `user.orgId` |
| [src/workflow/workflow.controller.spec.ts](../../../../src/workflow/workflow.controller.spec.ts) | +10/−5 | Фикстуры с `orgId`/`organizationId`, ожидания вызова сервиса с третьим аргументом |
| [src/templates/templates.controller.ts](../../../../src/templates/templates.controller.ts) | +3/−1 | `instantiate` передаёт `user.orgId` в `importAsync` |
| [src/templates/templates.controller.spec.ts](../../../../src/templates/templates.controller.spec.ts) | +6/−3 | Ожидание третьего аргумента `DEMO_ORG_ID` |
| [src/documents/document-templates.controller.spec.ts](../../../../src/documents/document-templates.controller.spec.ts) | +2/−2 | `USER` c `orgId` |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +2/−2 | `USER` c `orgId` |
| [src/runs/runs.service.spec.ts](../../../../src/runs/runs.service.spec.ts) | +2/−0 | `baseWorkflow.organizationId` |
| [src/workflow/workflow-collaborators.spec.ts](../../../../src/workflow/workflow-collaborators.spec.ts) | +4/−0 | `baseWorkflow.organizationId` |
| [src/vector/vector-store.integration.spec.ts](../../../../src/vector/vector-store.integration.spec.ts) | +15/−1 | Организация в `beforeAll`, `organizationId` в workflow, удаление в `afterAll` |
| [src/media/media-storage.integration.spec.ts](../../../../src/media/media-storage.integration.spec.ts) | +15/−1 | То же |

**Итого по коду:** **23 изменённых файла, +542 / −84**; новые файлы кода —
**5 файлов / 1694 строки** (`0014` SQL 18 + snapshot 989 + guard-spec 161 +
backfill 199 + backfill-spec 327). Документация (не входит в счёт кода):
`docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `docs/development/reports/README.md`,
ADR-0001 и этот отчёт.

Артефакты смоука (gitignored, не deliverable): `.smoke/v100-s1-orgs-smoke.mjs`
+ `.json`, `.smoke/v100-s1-refresh-smoke.mjs` + `.json`.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm build:migrate` | exit 0; `dist/migrate.js`, `dist/src/db/migrations/backfill-organizations.js`, `dist/src/auth/auth.constants.js` на месте (Docker-путь) |
| `node dist/migrate.js` (повторно) | exit 0: «✅ Миграции применены / ✅ Организации: backfill выполнен, organization_id заполнен, NOT NULL включён» — идемпотентно |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (без `DATABASE_URL`) | **106 passed / 4 skipped (110 файлов); 1576 passed / 22 skipped (1598)**, 21.6 с |
| `pnpm test` (с `DATABASE_URL`) | **110/110 файлов; 1596 passed / 2 skipped (1598)**, 22.9 с — DB-спеки (parity, backfill, vector, media) выполнились |
| `pnpm test:parity` | **11/11** (KI-298: схема ↔ живой PostgreSQL, включая `organizations` и NOT NULL `organization_id`) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с новым DI-графом) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`src/media/providers/openai-images.provider.spec.ts`), не связаны с S1 |
| oxlint changed files (по командам) | auth-скоуп 17 файлов — 0/0; db-скоуп 8 файлов — 0/0 |

Прирост к v0.16.0 S1: backend **+1 passed-файл** (guard-spec) и **+1 skipped-файл**
(backfill-spec без БД), **+16 passed-тестов** без БД; с БД добавились 20
DB-тестов (parity 11 + backfill 3 + vector 5 + media 1 — ранее skipped).
2 оставшихся skipped с `DATABASE_URL` — `openai-images.integration.spec.ts`
(`skipIf` без реального ключа провайдера), к S1 не относятся.

Проверка «чистой БД» (CI-путь, DB-командой): временная БД
`workflow_builder_fresh_check` → `pnpm db:migrate` ×2 → 15 миграций,
`organizations=1` (демо), `users=1` (демо, org `000…002`), `workflows=0`,
NULL-строк 0; вторая попытка идемпотентна; временная БД удалена.

---

## 3. Диагностика (миграция данных)

### 3.1 `ADD COLUMN ... NOT NULL` без DEFAULT упал бы на непустой БД

Локальная БД на старте: **69 users / 160 workflows**, 14 применённых миграций.
`drizzle-kit generate` сгенерировал `ADD COLUMN "organization_id" uuid NOT NULL`
— на существующих строках это гарантированный fail. Поэтому SQL миграции вручную
изменён на nullable (с русским комментарием в файле), а NOT NULL включает
backfill после заполнения. Снимок Drizzle при этом соответствует `schema.ts`;
итоговое состояние БД после полного `pnpm db:migrate` совпадает со схемой —
это проверяет parity-гейт (11/11).

### 3.2 Дублирование константы демо-организации (найдено на ревью Lead)

Параллельная работа дала два литерала `00000000-0000-0000-0000-000000000002`:
`DEMO_ORG_ID` в `src/auth/auth.constants.ts` (auth-скоуп) и
`DEMO_ORGANIZATION_ID` в backfill-модуле (db-скоуп). После ревью Lead:
единственный источник — `auth.constants.ts`, backfill импортирует `DEMO_ORG_ID`,
дубль удалён; имена `DEMO_ORGANIZATION_NAME` выводится из `DEMO_USER_EMAIL`.

### 3.3 Пустые таблицы создавали демо-организацию

Первая версия backfill вставляла организацию демо-пользователя безусловно:
на пустых `users` это противоречит требованию «если `users` пусты, скрипт просто
завершается» и оставляло бы «осиротевшую» организацию. Исправлено:
`INSERT ... SELECT ... WHERE EXISTS (SELECT 1 FROM users WHERE id = <DEMO_USER_ID>)`.
Тест пустых таблиц теперь утверждает `organizations = []` и NOT NULL.

### 3.4 Идемпотентность при частичном прогоне

Сценарий «организация создана, пользователь не привязан» (сбой между шагами,
повторный прогон) обработан двумя механизмами: `NOT EXISTS` по имени
`Personal Workspace - {email}` не даёт создать дубль, а шаг привязки
переиспользует существующую организацию по имени. Демо-пользователь
привязывается через `organization_id IS DISTINCT FROM DEMO_ORG_ID`, поэтому
даже после частичного/legacy-состояния он детерминированно принадлежит демо-
организации (на неё рассчитывает `AUTH_DISABLED`). Проверено тестом
идемпотентности: второй прогон не меняет набор организаций и привязки.

### 3.5 «Осиротевшие» workflow не переприсваиваются молча

В локальной БД осиротевших workflow нет (проверено SQL: `left join users` → 0).
Но backfill не пытается угадать владельца: DO-блок считает строки с NULL после
заполнения и `RAISE EXCEPTION` с количеством (без PII), транзакция откатывается,
NOT NULL не включается. Это осознанно не покрыто «позитивным» тестом — для
сценария нужны данные с нарушенной ссылкой `workflow.user_id`, которых в схеме
быть не может (у `workflows.user_id` исторически нет FK, поэтому проверка
остаётся страховкой); механика проверена конструкцией и прогоном на реальных
69/160 строках.

### 3.6 Кросс-скоупная ошибка typecheck на промежуточном состоянии

При параллельной работе `npx tsc -p tsconfig.spec.json` падал ровно одной
ошибкой `src/db/schema.spec.ts(202,71)` (типизация `IndexConfig.columns`),
пока db-команда не завершила правку. Итоговый `pnpm typecheck` — 0.

### 3.7 Тестовый прогон «с БД»: ловушка PowerShell

Первый прогон «с `DATABASE_URL`» фактически прошёл без переменной: в PowerShell
`(Get-Content .env | Where-Object {...})[0]` для единственной строки вернул
**первый символ строки**, а не строку, — `$env:DATABASE_URL` не выставился, и
DB-спеки остались skipped (`1576 passed / 22 skipped`). Перезапуск с
`@(...)[0]` дал ожидаемые `110/110 файлов, 1596 passed / 2 skipped`. Разница
чисел — диагностический признак; в отчёт вошли только результаты второго
прогона.

### 3.8 Версия/расположение backfill-модуля и Docker

`tsconfig.migrate.json` (`rootDir: "."`) компилирует `migrate.ts` вместе с
импортом `./src/db/migrations/backfill-organizations.js` в
`dist/src/db/migrations/...`; `Dockerfile` копирует весь `/app/dist`, поэтому
`docker-entrypoint.sh` (`node dist/migrate.js`) видит новый модуль. Проверено
`pnpm build:migrate` + `node dist/migrate.js` (exit 0). Полная сборка Docker-
образа не запускалась (см. § 5).

### 3.9 Prettier на HEAD не чист

`prettier --check` на HEAD имеет расхождения в преэкзистующих файлах, поэтому
форматирование не применялось (не хотим несвязанных диффов); действующие гейты
— `oxlint` и `tsc`.

---

## 4. Smoke (живое приложение)

Окружение: PostgreSQL 17 (pgvector) на `127.0.0.1:5433/workflow_builder`, Redis
на `127.0.0.1:6379`, приложение — `node dist/main.js` (порт 3000,
`AUTH_DISABLED=false`), затем второй инстанс на порту 3001 с
`AUTH_DISABLED=true`. Старт приложения: только ожидаемые WARN «ключ не задан»
для Replicate/FAL/OpenAI Images/Tavily/Bing/Brave (ключей нет в `.env`), ошибок
DI/схемы нет; шаблоны загружены 3/3.

### 4.1 Регистрация → организация → JWT с `orgId`

`POST /auth/register` (`smoke-s1-…@example.com`) → **201**. Payload access-JWT:

```
{
  "sub": "bc6f6f02-cbfe-490b-bcdf-9f228d1f3973",
  "email": "smoke-s1-1793629081035@example.com",
  "orgId": "0fcffb37-075a-473b-8709-1f6a2d8a68f8"
}
```

Проверка БД: `organizations.name = "Personal Workspace - smoke-s1-…@example.com"`,
`users.organization_id = orgId`. **PASS**.

### 4.2 Login → тот же `orgId`; `/auth/me` → 200

`POST /auth/login` → 200, payload нового access содержит тот же
`orgId = 0fcffb37-…`; `GET /auth/me` с Bearer → 200, `email` совпал. **PASS**.

### 4.3 Создание workflow пишет `organization_id` из токена

`POST /workflow` (Bearer) → **201**, в БД
`workflows.organization_id = 0fcffb37-…`, `workflows.user_id` = пользователь из
токена. **PASS**.

### 4.4 Legacy-JWT без `orgId` и токен с пустым `orgId` → 401

Токен, подписанный `JWT_SECRET` вручную с payload `{sub,email,iat,exp}` (как
старый клиент), → **401** «Токен устарел, войдите заново: в нём нет организации»;
токен с `"orgId": ""` → **401**. **PASS ×2**.

### 4.5 Восстановление сессии через refresh (старый клиент)

`POST /auth/refresh` с httpOnly `refresh_token`-cookie, полученной при
регистрации → **200**, новый access-JWT содержит тот же
`orgId = 0ca69689-ca55-4545-953a-2b9d26575084`. То есть старый клиент без
`orgId` в access-токене восстанавливает сессию без пароля. **PASS**
(`.smoke/v100-s1-refresh-smoke.json`).

### 4.6 `AUTH_DISABLED=true`: демо-пользователь и демо-организация

Инстанс на 3001, `POST /workflow` **без Authorization** → **201**; в БД
`organization_id = 00000000-0000-0000-0000-000000000002`,
`user_id = 00000000-0000-0000-0000-000000000001`; организация
`00000000-0000-0000-0000-000000000002` существует и называется
`Personal Workspace - system@workflow-builder.local`. Workflow удалён после
проверки. **PASS**.

### 4.7 Уборка и состояние БД после смоука

Организации, созданные смоуком, удалены (`ON DELETE CASCADE` снял
пользователей, workflow, refresh-токены): после смоука снова
`users=69, workflows=160, organizations=69`, NULL `organization_id` — 0/0.

---

## 5. Что не так

1. **DESIGN § 3.1 шире постановки:** там `organization_id` ещё в
   `document_templates` и `workflow_runs`; в S1 по заданию сделаны только
   `users` и `workflows`. Изоляция документов/истории пока идёт через
   `workflow_id` и проверку владельца. → KI-552 (Planned, S2).
2. **Фильтрации по арендатору ещё нет** — это S2 по плану: `orgId` пишется в
   БД и токен, но `WorkflowService.findAllAsync`/прочие выборки по-прежнему
   ограничены user/participant. Пользователи одной организации (когда появятся
   команды) пока не видят графы друг друга.
3. **`UserPublic` / `GET /auth/me` не отдают `orgId`** — клиенту нужен tenant
   для будущих настроек команды; сейчас его можно получить только из JWT. →
   KI-555 (Planned, S5).
4. **Guard проверяет только непустой `orgId`**, не сверяя его с БД
   (существование организации/членство) — подделать подпись нельзя, но
   исключённый из организации пользователь сохранит доступ до истечения
   access-токена (24 ч). → KI-554.
5. **Все старые access-JWT дают 401** до refresh/повторного входа; UI-обработка
   «401 → refresh → редирект» не сделана (web — S5, токен для web непрозрачен,
   поэтому код фронтенда не менялся). → KI-553.
6. **Гонка регистрации с одинаковым email** осталась преэкзистующей: pre-check
   вне транзакции, второй параллельный запрос упадёт на unique-constraint →
   500 вместо 409. S1 улучшил только атомарность «org + user». → KI-557 (Open).
7. **NOT NULL включается скриптом, а не SQL-миграцией:** прямой
   `drizzle-kit migrate`/`db:push` в обход `pnpm db:migrate` оставит колонки
   nullable (snapshot при этом считает их NOT NULL); в CI это поймает
   parity-гейт. Эксплуатационное правило — только `pnpm db:migrate`. → KI-556.
8. **`SET NOT NULL` берёт `ACCESS EXCLUSIVE`** на `users`/`workflows`;
   в Docker/CI миграция идёт до старта приложения — это ок, но долгая транзакция
   во время миграции заблокирует DDL. Операционное замечание (не KI).
9. **`organizations.name` не уникален** (осознанно, описано в JSDoc): имена двух
   арендаторов могут совпасть; идемпотентность backfill'а держится на шаблоне
   `Personal Workspace - {email}` и `NOT EXISTS`, а не на constraint. Пока
   переименования организаций в API нет — риска нет; при появлении S5
   переименований шаблон/idempotency нужно перепроверить.
10. **CASCADE организации удаляет пользователей и workflow** — политика
    удаления арендатора продуктом не определена (API удаления нет). → KI-558.
11. **Связность слоёв:** `src/db/migrations/backfill-organizations.ts`
    импортирует `DEMO_USER_ID`/`DEMO_ORG_ID`/`DEMO_USER_EMAIL` из
    `src/auth/auth.constants.ts` (DB → auth). Это даёт единственный источник
    истины для детерминированных id, но переименование экспортов ломает
    `pnpm build:migrate`. Нейтральный модуль констант не выделяли, чтобы не
    расширять скоуп S1.
12. **Полная сборка Docker-образа не запускалась** (нет необходимости для S1):
    проверены `pnpm build` + `pnpm build:migrate` + `node dist/migrate.js`,
    т.е. все шаги entrypoint'а, кроме самого `docker build`.
13. **E2E-покрытие auth отсутствует** (в репо один bootstrap e2e-тест); auth
    покрыт сервисными/controller-спеками, guard-спекой и живым смоуком —
    отдельный e2e на register/login не заводили (не было в постановке).
14. **Локальная dev-БД изменена навсегда:** применена миграция 0014 и созданы
    69 персональных организаций для существующих пользователей. Это ожидаемый
    результат `pnpm db:migrate`; чистая БД проверена отдельно (временная
    scratch-БД, § 2).

---

## 6. Новые KI

Всего **7**: KI-552..558 (сводка реестра пересчитана grep'ом, RULES 3.20:
**546** записей, сумма по статусам = 546).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-552](../../../KNOWN_ISSUES.md) | 🟡 Medium | Planned (S2) | `document_templates`/`workflow_runs` без `organization_id` (DESIGN § 3.1) |
| [KI-553](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Старые access-JWT без `orgId` → 401 до refresh/повторного входа |
| [KI-554](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Guard доверяет `orgId` из токена без проверки членства в БД |
| [KI-555](../../../KNOWN_ISSUES.md) | 🟢 Low | Planned (S5) | `UserPublic`/`/auth/me` не отдают `orgId` |
| [KI-556](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | NOT NULL включается backfill-скриптом; обход `pnpm db:migrate` оставит nullable |
| [KI-557](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Гонка регистрации с одинаковым email → 500 вместо 409 (преэкзистующая) |
| [KI-558](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `ON DELETE CASCADE` организации: политика удаления не определена |

Закрытых KI в S1 нет (срез — фундамент, а не фикс). Обновлены
`docs/KNOWN_ISSUES.md` (раздел v1.0.0 + сводка) и `docs/CHANGELOG.md`
(`[Unreleased]`: Added/Changed/Security/Documented + ссылка на отчёт).

---

## 7. Обоснование решений

### 7.1 Почему nullable-миграция + backfill в `migrate.ts`, а не всё в SQL

Единственная альтернатива — `ADD COLUMN ... NOT NULL DEFAULT <что-то>`: DEFAULT
пришлось бы потом снимать, а «что-то» пришлось бы вычислять на каждую строку,
чего DDL не умеет. Порядок «данные → ограничение» в одной SQL-миграции тоже
возможен (Postgres DDL транзакционен), но тогда backfill нельзя покрыть
интеграционным тестом на scratch-схеме без дублирования SQL, а проект уже
применяет миграции только через `migrate.ts` (RULES 3.10, Docker entrypoint,
CI step `Apply migrations`). Компромисс и его ограничение зафиксированы в
ADR-0001 и KI-556. Снимок Drizzle оставлен соответствующим `schema.ts`
(NOT NULL), чтобы `db:generate` в будущем не показывал ложных изменений.

### 7.2 Почему у демо-организации детерминированный UUID

`AUTH_DISABLED=true` (dev/CI) подставляет системного пользователя в guard без
запроса в БД — по аналогии с `DEMO_USER_ID` из миграции 0004. Детерминированный
`DEMO_ORG_ID = 000…002` позволяет guard'у положить реальный, существующий
`orgId` без лишнего SELECT и делает backfill идемпотентным по id. Значение
живёт в `auth.constants.ts`, backfill его импортирует (единый источник истины).

### 7.3 Почему регистрация — транзакция

`INSERT organizations` + `INSERT users` — связанные записи (RULES 4.22): сбой
между ними оставил бы пользователя без арендатора, а организацию — сиротой.
Pre-check email оставлен снаружи как чтение (транзакция не нужна), но
существующую гонку не прячем — она заведена в KI-557, а не замолчана.

### 7.4 Почему старые JWT отвергаются, а не «достраиваются»

Вариант «если `orgId` нет — молча подставить демо-организацию/найти по `sub`»
опасен: (а) лишний SELECT на каждый запрос до истечения старых токенов;
(б) неявное поведение скрывает несовместимость payload; (в) DESIGN § 4 прямо
объявляет инвалидацию. Действующая refresh-cookie даёт бесшовный путь
восстановления (проверено смоуком 4.5), поэтому 401 — не «выкидывание», а явный
контракт. UI-обработка — S5 (KI-553).

### 7.5 Почему guard не ходит в БД за членством

Guard — горячий путь всех запросов; проверка членства на каждый запрос — это
+1 SELECT и отдельная точка отказа. Токен подписан нашим `JWT_SECRET`,
TTL — 24 ч; управление командой (и исключение из организации) появится не
раньше S5, поэтому до тех пор достаточно проверки формы payload. Ограничение
зафиксировано в KI-554, чтобы S2/S5 не полагались на этот компромисс слепо.

### 7.6 Почему `organizationId` — аргумент `createAsync`, а не SELECT по `userId`

Владелец и арендатор уже есть в проверенном токене; передача аргументом
сохраняет один запрос на создание workflow, совпадает с существующим паттерном
`userId` из токена (KI-204) и не даёт клиенту подменить организацию. Альтернатива
«сервис сам читает `users.organization_id`» добавила бы скрытую зависимость от
БД и второй источник истины. Фильтрация чтений по `orgId` — S2, поэтому
`createAsync`/`importAsync` меняли минимально (третий аргумент + INSERT).

### 7.7 Почему тест backfill'а — scratch-схема, а не транзакция на `public`

`SET NOT NULL` и DDL на `public.users`/`public.workflows` берут
`ACCESS EXCLUSIVE` и теоретически могут блокировать параллельные тесты
(parity/vector/media), которые тоже ходят в `public`. Scratch-схема + `SET LOCAL
search_path` + одна транзакция с откатом дают полную изоляцию, не трогают
данные приложения и не оставляют мусора после падения. Пустые `users` —
отдельный кейс, потому что именно он проверяет требование постановки.

### 7.8 Почему web не менялся

Frontend не декодирует JWT (access-токен — непрозрачная строка в заголовке),
поэтому `orgId` в payload для него невидим и не требует зеркал контракта.
Единственное последствие — 401 у старых сессий, для которого UI-логика
запланирована в S5 (KI-553), а восстановление уже работает через refresh.

### 7.9 Почему не обновляли DESIGN § 8 и не расширяли скоуп

DESIGN § 8 («Решения») — раздел для ревью дизайна, а не для журнала реализации;
принятые технические решения по миграции/JWT вынесены в ADR-0001 и этот отчёт,
чтобы не переписывать Draft-документ задним числом. `document_templates`/
`workflow_runs` из DESIGN § 3.1 сознательно не добавлялись: постановка S1
ограничивает срез `users` + `workflows`, а неполный срез закрывается KI-552 и
планом S2.

### 7.10 Почему обновлялись фикстуры в несвязанных спеках

`Workflow.organizationId` — новое обязательное поле: TypeScript (`pnpm
typecheck` по `tsconfig.spec.json`) не пропускает литералы `Workflow`/`User` без
него. Поэтому 7 спек-файлов получили `organizationId`/`orgId` в фикстурах — это
механическое следствие NOT NULL-схемы, без изменения проверяемого поведения.
