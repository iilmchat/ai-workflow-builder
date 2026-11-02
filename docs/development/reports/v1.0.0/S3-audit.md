---
title: "S3: Audit Logs (журнал действий, v1.0.0)"
date: 2026-11-02
version: v1.0.0
steps: [S3]
status: accepted
related_ki: [KI-565, KI-566, KI-567, KI-568, KI-569, KI-570, KI-571, KI-572, KI-573]
related_adr: [0003]
---

# Отчёт S3 — Audit Logs (v1.0.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **111 passed / 4 skipped
(115 файлов), 1679 passed / 23 skipped (1702)** без `DATABASE_URL`; с
`DATABASE_URL` — **115/115 файлов, 1700 passed / 2 skipped**,
`pnpm test:parity` — **12/12**, `pnpm test:e2e` — **1/1**, `pnpm lint` —
**0 errors / 2 warnings** (преэкзистующие). Смоук на живом приложении —
**8/8**: мутации пишут `audit_logs` (create/update/run.start/share/delete),
GET не логируется, `GET /admin/audit` — 200 для owner с keyset-пагинацией,
403 для `member`, изоляция по организации, `/auth/*` не аудируется; уборка
удалила 2 организации, БД вернулась к 69 users / 69 orgs / 160 workflows /
0 audit-строк.

**Точка старта.** HEAD `f3ba912` («feat(v1.0.0): S2 — Workflow Isolation»),
CI зелёный. Источник — `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md`
§ 2.2/§ 3.2, правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** таблица `audit_logs` + миграция `0015_short_risque.sql`; роль
пользователя `users.role` (`owner|admin|member|viewer`) с backfill `owner` для
существующих; глобальный `AuditInterceptor` (только успешные
`POST`/`PATCH`/`DELETE`, действие по URL+методу, санитизированная metadata);
`AuditService` (запись + keyset-чтение по организации);
`GET /admin/audit` под `JwtAuthGuard` + `OrgOwnerGuard` (owner/admin).
**Новые KI:** KI-565..573 (§ 6).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/audit/audit.constants.ts](../../../../src/audit/audit.constants.ts) *(new)* | 147 | `AUDIT_ACTIONS` (13 кодов), `AuditAction`, `resolveAuditAction(method, path)` — таблица метод+regex → действие, нормализация пути, fallback `http.<method>` |
| [src/audit/audit.service.ts](../../../../src/audit/audit.service.ts) *(new)* | 238 | `AuditEntry`; `recordAsync` — INSERT в `audit_logs`; `listAsync(access, limit, cursor?)` — org-scoped keyset (`created_at DESC, id DESC`, µs-курсор через `to_char`, `count(*)`, `limit+1`, `nextCursor`) |
| [src/audit/audit.interceptor.ts](../../../../src/audit/audit.interceptor.ts) *(new)* | 335 | Глобальный `NestInterceptor`: только POST/PATCH/DELETE; skip `/auth/*` и запросов без `request.user`; действие по URL+методу; `resourceId` из ответа `.id` (uuid) ?? `params.id`; metadata `{method,path,params,body,statusCode}` с санитизацией секретов (на любой глубине), depth 8, лимит 16 KiB; запись только после успеха; ошибки аудита — только `Logger.warn` |
| [src/audit/audit.module.ts](../../../../src/audit/audit.module.ts) *(new)* | 29 | `controllers: [AdminAuditController]`, `providers: [AuditService, OrgOwnerGuard]`, `exports: [AuditService]`, `imports: [AuthModule]` |
| [src/audit/org-owner.guard.ts](../../../../src/audit/org-owner.guard.ts) *(new)* | 78 | `OrgOwnerGuard`: роль из `users.role` по `user.sub`; owner/admin — доступ, member/viewer — 403, нет пользователя/строки — 401 |
| [src/audit/admin-audit.controller.ts](../../../../src/audit/admin-audit.controller.ts) *(new)* | 73 | `GET /admin/audit` (`@UseGuards(JwtAuthGuard, OrgOwnerGuard)`), Zod-query (`limit`, `cursor`), keyset-ответ, `Cache-Control: no-store` |
| [src/audit/dto/audit.dto.ts](../../../../src/audit/dto/audit.dto.ts) *(new)* | 209 | `AuditLogSummary`/`AuditLogsResponse`/`AuditQueryDto`; cursor base64url `{c,i}` с µs-ISO и проверкой реальности даты, `AuditCursorSchema`, лимиты 20/100 |
| [src/audit/audit.interceptor.spec.ts](../../../../src/audit/audit.interceptor.spec.ts) *(new)* | 446 | 30 тестов: маппинг действий, skip GET/`/auth`/без user, санитизация, `resourceId`, ошибка обработчика → нет записи, сбой аудита → ответ цел |
| [src/audit/audit.service.spec.ts](../../../../src/audit/audit.service.spec.ts) *(new)* | 415 | 13 тестов: INSERT-значения, org-фильтр + параметры курсора, `nextCursor`/`total`, пустая страница, границы `limit` |
| [src/audit/admin-audit.controller.spec.ts](../../../../src/audit/admin-audit.controller.spec.ts) *(new)* | 293 | 12 тестов supertest: owner/admin 200, member/viewer 403 без вызова сервиса, 401 без/битого токена, курсор доходит в сервис, 400 на мусор/лимиты |
| [src/audit/org-owner.guard.spec.ts](../../../../src/audit/org-owner.guard.spec.ts) *(new)* | 165 | 8 тестов: owner/admin true, member/viewer 403, 401 без user/строки, WHERE по `sub` |
| [src/audit/dto/audit.dto.spec.ts](../../../../src/audit/dto/audit.dto.spec.ts) *(new)* | 112 | 12 тестов: cursor round-trip µs, негативные кейсы base64/JSON/даты, query-схема |
| [drizzle/0015_short_risque.sql](../../../../drizzle/0015_short_risque.sql) *(new)* | 21 | `CREATE TABLE audit_logs` + FK/index + `users.role` + CHECK; `UPDATE users SET role='owner'` (backfill существующих) |
| [drizzle/meta/0015_snapshot.json](../../../../drizzle/meta/0015_snapshot.json) *(new)* | 1114 | Снимок Drizzle (11 таблиц), соответствует `schema.ts` |

### 1.2 Изменённые файлы

| Файл | +/− | Что |
|---|---:|---|
| [src/db/schema.ts](../../../../src/db/schema.ts) | +83/−2 | `USER_ROLES`/`UserRole`; `users.role` text NOT NULL default `member` + CHECK `users_role_check`; таблица `audit_logs` (7 колонок, 2 FK CASCADE, индекс `audit_logs_org_created_id_idx`), типы `AuditLog`/`NewAuditLog` |
| [src/db/schema.spec.ts](../../../../src/db/schema.spec.ts) | +143/−2 | Новый describe: `users.role` (тип/default/CHECK) и `audit_logs` (колонки, FK targeted/cascade, nullable `resource_id`, jsonb default, индекс, TS-типы) |
| [src/auth/auth.service.ts](../../../../src/auth/auth.service.ts) | +5/−1 | `registerAsync` создаёт создателя организации с `role: 'owner'` |
| [src/auth/auth.service.spec.ts](../../../../src/auth/auth.service.spec.ts) | +9/−2 | `baseUser.role='owner'`; INSERT пользователя проверяется с `role: 'owner'` |
| [src/app.module.ts](../../../../src/app.module.ts) | +13/−1 | Импорт `AuditModule`; глобальный `{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }` |
| [api-prefixes.json](../../../../api-prefixes.json) | +1/−0 | Префикс `admin` (SPA-fallback/Vite-proxy подхватывают автоматически) |
| [src/common/api-prefixes.spec.ts](../../../../src/common/api-prefixes.spec.ts) | +9/−4 | Ожидаемый список контроллеров + `admin` (11), self-maintaining length-assert |
| [drizzle/meta/_journal.json](../../../../drizzle/meta/_journal.json) | +7/−0 | Запись миграции 0015 |

**Итого по коду:** **8 изменённых файлов, +270 / −12**; новые файлы —
**14 файлов / 3675 строк** (12 `src/audit/*` = 2540 строк: production 1109,
спеки 1431; SQL 21 + snapshot 1114). Всего затронуто **22 файла**.
Документация (не входит в счёт кода): `docs/CHANGELOG.md`,
`docs/KNOWN_ISSUES.md` (KI-565..573 + сводка), `docs/development/adr/0003-*.md`,
`docs/development/reports/README.md`, этот отчёт.

Артефакт смоука (gitignored): `.smoke/v100-s3-audit-smoke.mjs` +
`.smoke/v100-s3-audit-smoke.json`.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (без `DATABASE_URL`) | **111 passed / 4 skipped (115 файлов); 1679 passed / 23 skipped (1702)**, 26.8 с |
| `pnpm test` (с `DATABASE_URL`) | **115/115 файлов; 1700 passed / 2 skipped (1702)**, 28.8 с |
| `pnpm test:parity` | **12/12** (KI-298; +1 автотест на новую таблицу `audit_logs`) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с `AuditModule`/APP_INTERCEPTOR) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |
| oxlint changed files (по командам) | 0 warnings / 0 errors в каждом скоупе |

Прирост к S2: **+5 тест-файлов** (audit interceptor/service/controller/guard/dto),
**+77 passed-тестов** без БД (1679−1602) и **+78** с БД (1700−1622); skipped
без БД +1 (параity-тест новой таблицы). 2 оставшихся skipped с `DATABASE_URL` —
`openai-images.integration.spec.ts` (`skipIf` без ключа), к S3 не относятся.

Миграция применяется штатным `pnpm db:migrate` (drizzle + backfill
организаций, он идемпотентен): миграция 0015 + данные; parity подтверждает, что
фактическая БД совпадает со схемой (12 тестов, включая `audit_logs` и
`users.role`).

---

## 3. Диагностика

### 3.1 Миграция роли: DEFAULT `member` + backfill `owner`

`ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'member'` безопасен на
непустой БД и сразу заполняет существующие строки значением `member`. Но в S3
все 69 существующих пользователей — единственные члены своих личных
организаций (бэкфилл S1), то есть владельцы; иначе `GET /admin/audit` был бы
недоступен никому. Поэтому миграция 0015 после DDL выполняет
`UPDATE users SET role='owner'` (в файле — комментарий с обоснованием).
DEFAULT `member` оставлен как безопасный дефолт для будущих участников (S5), а
`registerAsync` ставит `owner` явно. CHECK `users_role_check` дублирует enum на
уровне БД (RULES 1.17). Проверено: `69 owner / 0 non-owner`, parity 12/12.

### 3.2 Fire-and-forget аудита: гонка в первом смоуке

Запись стартует в `tap(next)` после успешного обработчика и **не задерживает
ответ** (`void this.auditAsync(...)`). Первая версия смоука читала `audit_logs`
сразу после HTTP-ответа и была нестабильной: INSERT мог ещё выполняться.
Смоук исправлен — добавлен поллинг `waitForAuditAsync(orgId, expectedCount)` и
сравнение набора действий (порядок INSERT'ов не гарантирован), поэтому
результат детерминирован. Это не баг реализации, а следствие выбранного
best-effort контракта — задокументировано в KI-567; гарантированный аудит
потребует transactional outbox.

### 3.3 DI глобального интерсептора

`APP_INTERCEPTOR` зарегистрирован в `AppModule` через `useClass`, а
`AuditInterceptor` зависит от `AuditService`. Чтобы Nest разрешил зависимость,
`AuditService` экспортируется из `AuditModule` (`exports: [AuditService]`), а
сам `AuditModule` импортирует `AuthModule` ради `AdminAuditController`
(JwtAuthGuard/JwtService). Старт приложения подтверждает порядок:
`AuditModule dependencies initialized` до `AppModule`; циклических импортов нет.

### 3.4 Login/Register не попадают в аудит — и это ожидаемо

`POST /auth/register|login|refresh|logout` пропускаются явно
(`/auth/*`-pattern): на `register/login` `request.user` ещё не существует
(guard их не защищает), а тело содержит пароль/refresh-токен. Смоук проверил:
строк с `auth.*`/`http.post` в журнале — **0**. DESIGN § 2.2 требует аудит
Login — это закрывается сервисным вызовом в S5 (KI-566), а не интерсептором;
отдельно нужен аудит неудачных входов (KI-569).

### 3.5 Не-мутирующие POST не шумят в журнале

`POST /engine/validate|sort|plan` — POST, но не мутируют. `EngineController` не
закрыт `JwtAuthGuard`, поэтому `request.user` отсутствует и интерсептор их
пропускает (правило «нет автора — нет записи»). Проверенного списка
«не-мутирующих POST» в коде нет: если движковые ручки когда-нибудь закроют
guard'ом, они начнут писаться как fallback `http.post` (см. KI-568 о
паритет-тесте маршрутов).

### 3.6 Сверка таблицы действий с контроллерами

13 правил покрывают все мутирующие ручки, существующие в S3: workflow
(create/import/update/delete/share/unshare), collaborators
(invite/update/remove), document templates (create/delete), templates
instantiate, run.start. `GET`-ручки (export, history, список) не аудируются.
Неизвестный маршрут даёт fallback `http.<method>` — запись не теряется, но код
действия неинформативен; автотеста паритета «маршруты ↔ таблица» нет
(KI-568).

### 3.7 Санитизация metadata

Тело копируется (оригинальный `request.body` не мутируется), ключи по regex
`password|token|secret|api[_-]?key|authorization|cookie` удаляются на любой
глубине, глубина обхода ограничена 8, JSON длиннее 16 KiB заменяется
`{truncated: true, bytes}`. `resourceId` берётся из тела ответа (`.id`), иначе
из `params.id`, и обязан быть uuid — иначе `null` (колонка uuid; мусор из
ответа не должен ронять запись). Смоук подтвердил набор ключей metadata:
`body`, `method`, `params`, `path`, `statusCode` — и наличие `body.name` у
`workflow.create`.

### 3.8 Найденное ограничение: в metadata может попасть пользовательский промпт

Тело `POST/PATCH /workflow` содержит `nodes`/`edges`, то есть промпты узлов.
Санитизация удаляет только секретные ключи, но не пользовательский контент, —
это противоречит духу RULES 5.9 («пользовательские промпты — не логировать
целиком»). Постановка S3 прямо требовала сохранять тело (без секретов),
поэтому поведение оставлено, риск зафиксирован в KI-572: в S5 для крупных
сущностей хранить хэш/сводку (размер, изменённые поля, число узлов), а не тело.

### 3.9 Мелкие правки по ревью Lead

- В JSDoc `schema.ts` была ссылка на несуществующий `src/audit/audit-actions.ts`;
  фактический модуль — `src/audit/audit.constants.ts`, ссылка исправлена.
- Команда audit-api отформатировала свои 2 файла `prettier --write` (остальной
  HEAD не prettier-clean, массового переформатирования не было — как и в
  предыдущих сессиях).
- Промежуточные `tsc` в параллельной работе давали ошибки в чужих файлах;
  финальные `pnpm build`/`pnpm typecheck` — 0.

---

## 4. Smoke (живое приложение)

Окружение: PostgreSQL 17 (pgvector) `127.0.0.1:5433/workflow_builder`, Redis
`127.0.0.1:6379`, приложение — `node dist/main.js` (порт 3000,
`AUTH_DISABLED=false`). Старт чистый: `AuditModule` инициализирован, новый
маршрут `{ /admin/audit, GET }` замаплен, только ожидаемые WARN
media/web-search провайдеров. Скрипт: `.smoke/v100-s3-audit-smoke.mjs`.

### 4.1 Регистрация и создание workflow

A зарегистрирован (`role='owner'`): `userId=cd94e872-4c91-41b9-b997-ac90679b288e`,
`orgId=3c3fd574-3a98-43a2-b998-f07402b35114`. `POST /workflow` → 201;
в `audit_logs` появилась строка `action=workflow.create`,
`resource_id=0859b7d3-14ba-4f2a-a21a-5b568e04f0b3`, `user_id`/`organization_id`
совпали с токеном, metadata-ключи `[body, method, params, path, statusCode]`,
`metadata.body.name` — имя из запроса. **PASS**.

### 4.2 GET-запросы не журналируются

До/после `GET /workflow/:id` и `GET /workflow` — количество строк в
`audit_logs` неизменно (1). **PASS**.

### 4.3 Полный набор действий

`PATCH /workflow/:id` (200), `POST /runs` (201), `POST /workflow/:id/share`
(200), `DELETE /workflow/:id` (204). В журнале организации A — 5 строк:
`workflow.create`, `workflow.update`, `run.start`, `workflow.share`,
`workflow.delete`; у `run.start` `resource_id` = id запуска из ответа. **PASS**.

### 4.4 `GET /admin/audit` — owner, keyset-пагинация

`GET /admin/audit?limit=2` → **200**, `{logs, nextCursor, total}`:
`total=5`, страница 1 — `[workflow.delete, workflow.share]`, `nextCursor` —
строка; по `?cursor=…` страница 2 — `[run.start, workflow.update]`. Порядок
`created_at DESC, id DESC` (сначала новые). **PASS**.

### 4.5 Обычный участник — 403

Пользователь B зарегистрирован, роль переведена в `member` (SQL, т.к. API
управления ролями в S3 нет), повторный login → `GET /admin/audit` → **403**
«Недостаточно прав: требуется владелец организации». **PASS**.

### 4.6 Изоляция журнала по организации

B (member) создаёт workflow — в журнале его организации появляется строка
(смоук дожидается записи). `GET /admin/audit?limit=100` от A возвращает только
логи org A (5 строк), ни одной строки org B. **PASS**.

### 4.7 `/auth/*` не аудируется

После регистраций/логинов в `audit_logs` нет строк `auth.*`/`http.post`
(`count=0`). **PASS**.

### 4.8 Уборка

Удалены обе организации (каскад снял пользователей, workflow, запуски и
audit-строки) — `organizationsDeleted=2`, ошибок нет. Состояние БД после
смоука: **users=69, orgs=69, workflows=160, audit_logs=0, non-owner=0** (как до
S3).

---

## 5. Что не так

1. **`/auth/*` не аудируется** (login/register/refresh/logout), хотя DESIGN § 2.2
   перечисляет Login: в интерсепторе нет автора, тело — секрет. Нужен сервисный
   аудит в S5 (KI-566).
2. **Неудачные мутации (4xx/5xx) не журналируются** — нет аудита попыток
   доступа, отказов прав, брутфорса (KI-569). Для security-журнала это заметный
   пробел.
3. **Best-effort запись**: при падении процесса между ответом и INSERT действие
   теряется; аудит не входит в транзакцию операции (KI-567). Гарантированный
   аудит = outbox, отдельная задача.
4. **Retention/immutability не определены**: CASCADE удаляет журнал вместе с
   организацией; приложение не делает UPDATE/DELETE, но БД не защищена от них;
   срока хранения/архива нет (KI-565).
5. **Metadata может содержать пользовательские промпты/графы** (до 16 KiB):
   санитизация удаляет только секретные ключи, но не PII-контент (KI-572,
   RULES 5.9). Постановка S3 требовала сохранять тело — это осознанный
   компромисс до S5.
6. **Таблица route→action ручная**, без паритет-теста с контроллерами:
   переименование ручки молча даёт `http.<method>` (KI-568). Не-мутирующие
   `POST /engine/*` сейчас не шумят только потому, что у `EngineController` нет
   guard'а; появится guard — начнут попадать как `http.post`.
7. **Роль глобальна для пользователя** (`users.role`), а не членство в
   организации; при multi-org (S5) модель потребует
   `organization_members`/org-scoped ролей (KI-570). Guard читает роль из БД на
   каждый запрос `/admin/audit` — осознанно (немедленный отзыв прав), но это
   +1 SELECT на запрос.
8. **UI аудита нет** — только API; страница «Команда и Аудит» по плану S5
   (KI-573). Фильтров по действию/пользователю/дате в API тоже нет: только
   keyset-пагинация всей организации.
9. **`total` — отдельный `count(*)` на каждый запрос страницы**; на большом
   журнале каждая страница платит за подсчёт (KI-571; тот же подход, что в
   истории запусков).
10. **Аудит покрывает только HTTP-мутации**: внутренние действия (исполнение
    узлов, MCP-вызовы, генерация документов, фоновые задания) в журнал не
    попадают — DESIGN § 2.2 перечисляет действия на уровне API, но для
    «полного» аудита этого мало (кандидат на расширение в S5).
11. **Нет фильтра по арендатору для platform-admin**: `GET /admin/audit`
    всегда ограничен организацией из токена; кросс-арендаторский доступ
    (если появится) потребует отдельной роли/ручки.
12. **Удаление пользователя/организации стирает его аудит** — часть KI-565;
    для compliance-сценариев это может быть неприемлемо.
13. **Нет e2e-теста** на сквозной сценарий «мутация → строка журнала» в
    Playwright/UI; покрытие — unit/controller-спеки + живой смоук.
14. **`AUTH_DISABLED=true`** (dev/CI) пишет аудит от демо-пользователя/демо-
    организации — в dev это ожидаемо, но smoke/dev-мусор в журнале dev-БД
    возможен.
15. **Prettier на HEAD не чист** — массового переформатирования не делали
    (как и в прошлых сессиях), гейты — `oxlint` и `tsc`.

---

## 6. Новые KI

Всего **9**: KI-565..573 (реестр пересчитан grep'ом, RULES 3.20: **560**
записей, 560 статусов, номера уникальны).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-565](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Retention/immutability `audit_logs` не определены; CASCADE удаляет журнал с арендатором |
| [KI-566](../../../KNOWN_ISSUES.md) | 🟡 Medium | Planned (S5) | Мутирующие `/auth/*` (login/register/refresh/logout) не аудируются |
| [KI-567](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Аудит fire-and-forget: потеря при падении процесса, не в транзакции операции |
| [KI-568](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Таблица route→action ручная, без паритет-теста с контроллерами |
| [KI-569](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Неудачные (4xx/5xx) мутации не журналируются |
| [KI-570](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `users.role` глобален, не членство в организации; S5 → org-scoped роли |
| [KI-571](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `total` в `GET /admin/audit` — отдельный `count(*)` на каждый запрос |
| [KI-572](../../../KNOWN_ISSUES.md) | 🟡 Medium | Planned (S5) | Metadata аудита может содержать пользовательские промпты/графы (PII) |
| [KI-573](../../../KNOWN_ISSUES.md) | 🟢 Low | Planned (S5) | UI аудита отсутствует (только API) |

Закрытых KI в S3 нет (новый срез). Сводка реестра: 242 Fixed +
1 Fixed(частично) + 277 Open + 27 Documented + 1 Documented(не
воспроизводится) + 6 Planned + 2 Deferred + 4 Won't Fix = **560**.
Обновлены `docs/CHANGELOG.md` (`[Unreleased]`: Added/Changed/Security/
Documented) и `docs/KNOWN_ISSUES.md` (раздел S3 + сводка).

---

## 7. Обоснование решений

### 7.1 Почему глобальный интерсептор, а не аудит в каждом сервисе

Постановка S3 требует interceptor, и это архитектурно оправдано: один
провайдер покрывает все текущие и будущие мутирующие HTTP-ручки без правок
сервисов, а действие/автор/арендатор собираются в одном месте. Альтернатива
(вызовы `AuditService.recordAsync` в каждом методе) дала бы точные доменные
события и гарантию записи, но потребовала бы правок десятков методов, риск
«забыли вызвать» и связывание аудита с бизнес-логикой. Цена централизации —
route→action таблица и fire-and-forget (KIs 567/568); для login-аудита всё
равно нужен сервисный вызов (KI-566), то есть модель гибридная.

### 7.2 Почему пишутся только успешные мутации

`tap(next)` вызывается только при успешном результате обработчика: журнал
фиксирует **состоявшиеся действия**, а не попытки. Это соответствует
формулировке DESIGN § 2.2 («все действия: Login, CreateWorkflow, …» — это
действия, а не отказы) и не засоряет журнал 400/404 от UI. Аудит отказов —
отдельное требование безопасности (KI-569), для него нужен `catchError`/
фильтр; смешивать оба режима в одном месте без политики было бы хуже.

### 7.3 Почему запись best-effort (fire-and-forget)

Аудит — вспомогательная подсистема: недоступность журнала не должна ломать
создание workflow или запуск (RULES 4.18). Ожидание INSERT'а добавило бы
латентность к каждой мутации и связало бы доступность API с доступностью
аудита. Поэтому: `void` + `try/catch` + `Logger.warn`, ответ не задерживается и
не меняется. Гарантированный аудит (outbox/транзакция) — отдельное решение,
которое стоит принимать только при явном compliance-требовании (KI-567).

### 7.4 Почему роль owner/admin в `users`, а не отдельная таблица ролей

Ролей организации в продукте ещё нет (S5), а `GET /admin/audit` нужно закрыть
уже в S3. Минимальная модель: одно поле `users.role` с CHECK и миграционным
backfill'ом `owner` для существующих (каждый — единственный член личной
организации) + `owner` при регистрации. Это даёт работающий owner-guard без
преждевременного проектирования membership-таблицы; ограничение
зафиксировано в KI-570, в S5 роль переедет в `organization_members`.

### 7.5 Почему guard читает роль из БД, а не из токена

`JwtPayload` не расширяли ролью: изменение payload снова инвалидировало бы
все токены (как в S1), а роль — изменяемое состояние, которое не должно жить
24 часа в токене. Чтение по PK (`users.id`) — один дешёвый индексный SELECT на
запрос админ-ручки; зато отзыв прав немедленный. Кэш/материализация роли
понадобятся только при реальной нагрузке на журнал.

### 7.6 Почему metadata ограничена и санитизируется

Журнал не должен становиться вторым хранилищем секретов: тела запросов могут
содержать пароли (теоретически), токены, ключи. Санитайзер вырезает
чувствительные ключи на любой глубине, ограничивает глубину (дерево не должно
ронять рекурсию) и размер (16 KiB — защита от тел-загрузок и больших графов).
Компромисс по PII-контенту (промпты в `nodes`) зафиксирован в KI-572: S5
заменит тело на сводку/хэш для крупных сущностей.

### 7.7 Почему `resource_id` — из ответа, а не только из URL

Для создания id генерирует БД и он есть только в ответе (`workflow.create`,
`run.start`, `document_template.create`); для update/delete — обычно в
`params.id`. Приоритет «ответ → params» покрывает оба случая одной функцией.
Значение валидируется как uuid: колонка uuid, и мусор (например, slug
шаблона) не должен ронять INSERT, теряя запись; тогда `resource_id = null`, а
полные params остаются в metadata.

### 7.8 Почему курсор аудита — отдельная копия, а не переиспользование runs

Формат курсора (`base64url({c: µs-ISO, i: uuid})`) совпадает с историей
запусков намеренно — одинаковый клиентский паттерн и µs-точность. Но
переиспользовать `run-history.dto.ts` напрямую нельзя: audit-DTO не должен
зависеть от модуля `runs` (иначе аудит тянет домен запусков, а изменение
формата истории ломает админ-API). Копия небольшая, изолирована и покрыта
своими тестами.

### 7.9 Почему backfill роли — `UPDATE ... SET role='owner'` для всех

В S1 каждый существующий пользователь получил личную организацию и был её
единственным членом; в S2 коллаборация возможна только внутри организации, а
API создания/приглашения в организацию нет. Значит, все 69 существующих
пользователей — владельцы (owner) по факту, и `UPDATE` для всех корректен.
Альтернатива «оставить member и разрешить аудит всем» противоречит
требованию «только owner», а «выбрать одного админа» — произвольна и создала бы
скрытую привилегию.

### 7.10 Почему `/auth/*` пропускается, а не аудируется в интерсепторе

На `register/login` `request.user` отсутствует (guard не защищает эти ручки),
а в теле — пароль/refresh-токен: интерсептору нечего записать в NOT NULL
`user_id` и опасно писать тело. `refresh/logout` требуют cookie/токена, а не
access-payload. Правильное место — `AuthService` после успешной аутентификации
(там есть пользователь и организация), это S5-задача (KI-566), и она же
закроет «Login» из DESIGN § 2.2.

### 7.11 Почему `audit_logs` с CASCADE и без retention

Для S3 важно было не усложнять удаление арендатора (его политика ещё не
определена — KI-558): CASCADE согласован с `users`/`workflows` и не оставляет
FK-ошибок (в отличие от `workflow_collaborators.invited_by`, KI-559).
Compliance-требования (журнал должен переживать удаление арендатора, быть
неизменяемым, храниться N лет) в S3 не ставились — они зафиксированы в
KI-565, чтобы решение принималось осознанно в S5, а не «по умолчанию».

### 7.12 Почему `admin` добавлен в `api-prefixes.json`

Единый реестр префиксов (KI-472) — источник истины для SPA-fallback backend'а и
Vite-proxy. Новый контроллер `@Controller('admin/audit')` без записи в реестре
получал бы HTML-fallback в dev/prod-сборке вместо JSON (класс KI-072/120/299).
Добавление `admin` в JSON автоматически закрывает и spec-паритет (11
контроллер-префиксов), и проксирование — правок в web-коде не требуется.
