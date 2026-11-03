---
title: "S5: UI «Команда и аудит» (v1.0.0)"
date: 2026-11-03
version: v1.0.0
steps: [S5]
status: accepted
related_ki: [KI-554, KI-555, KI-563, KI-573, KI-583, KI-584, KI-585, KI-586, KI-587, KI-588, KI-589, KI-590, KI-591]
related_adr: [0005]
---

# Отчёт S5 — UI «Команда и аудит» (v1.0.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**120 passed (120 файлов), 1756 passed / 2 skipped (1758)**, `pnpm --dir web
build` — exit 0, `pnpm --dir web test` — **53 passed (53 файла), 476 passed**,
`pnpm test:parity` — **13/13**, `pnpm test:e2e` — **1/1**, `pnpm lint` —
**0 errors / 2 warnings** (оба преэкзистующие,
`openai-media`/`openai-images.provider.spec.ts`). Смоук на живом приложении:
API — **32/32**, CDP UI в headless Chrome — **18/18**.

**Точка старта.** HEAD `fb92420` («feat(v1.0.0): S4 — Prometheus Metrics»), CI
зелёный. Источник — `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md` § 2.1/§ 3.2,
правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** публичный профиль с организацией и ролью (KI-555); ручки команды
`GET /admin/members` и `POST /admin/members/invite`; таблица
`organization_invitations` (миграция `0016`) и «сжигание» приглашения при
регистрации (KI-563); действие `member.invite` в аудите; UI-модалка «Команда и
аудит» с вкладками «Участники»/«Аудит» и кнопкой 👥 в TopBar (KI-573);
расширение REST-контракта (6 ответов + 3 домена ролей); ADR-0005.
**Закрыто KI:** KI-555, KI-563, KI-573 — полностью, KI-554 — частично (для
`/admin/members*`). **Новые KI:** KI-583..591 (§ 6).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы — production

| Файл | Строк | Что |
|---|---:|---|
| [src/organizations/dto/member.dto.ts](../../../../src/organizations/dto/member.dto.ts) *(new)* | 75 | DTO команды: `OrganizationMemberSummary`, `OrganizationInvitationSummary`, `OrganizationMembersResponse`; Zod `InviteMemberSchema` (email + `INVITABLE_USER_ROLES`) |
| [src/organizations/org-members.service.ts](../../../../src/organizations/org-members.service.ts) *(new)* | 179 | `listAsync` (участники + приглашения по организации из БД), `inviteAsync` (409 на занятый email/повтор, `onConflictDoNothing` против гонки), `resolveOrganizationIdAsync`, нормализация email |
| [src/organizations/org-members.controller.ts](../../../../src/organizations/org-members.controller.ts) *(new)* | 84 | `@Controller('admin/members')`: `GET` (JwtAuthGuard, `Cache-Control: no-store`), `POST invite` (JwtAuthGuard + OrgOwnerGuard, 201) |
| [src/organizations/org-members.module.ts](../../../../src/organizations/org-members.module.ts) *(new)* | 21 | Модуль: `AuthModule` (guard/JWT) + `AuditModule` (OrgOwnerGuard) |
| [drizzle/0016_numerous_gambit.sql](../../../../drizzle/0016_numerous_gambit.sql) *(new)* | 14 | Таблица `organization_invitations`: PK, FK CASCADE, CHECK роли, UNIQUE `(organization_id, email)`, индекс по `email` |
| [drizzle/meta/0016_snapshot.json](../../../../drizzle/meta/0016_snapshot.json) *(new, generated)* | 1234 | Снимок Drizzle для миграции (создан `pnpm db:generate`) |
| [web/src/types/organization.ts](../../../../web/src/types/organization.ts) *(new)* | 31 | `OrgRoleSchema` (`owner/admin/member/viewer`), `InvitableOrgRoleSchema` (`admin/member/viewer`) |
| [web/src/lib/org-api.ts](../../../../web/src/lib/org-api.ts) *(new)* | 119 | Зеркала `GET /admin/members`, `POST /admin/members/invite` + Zod-схемы, `fetchOrganizationMembersAsync`, `inviteMemberAsync` |
| [web/src/lib/audit-api.ts](../../../../web/src/lib/audit-api.ts) *(new)* | 81 | Зеркала `GET /admin/audit`: `AuditLogSchema`, `AuditLogsResponseSchema`, `fetchAuditLogsAsync(limit, cursor)` с keyset |
| [web/src/components/TeamPage.tsx](../../../../web/src/components/TeamPage.tsx) *(new)* | 878 | Модалка «Команда и аудит»: вкладки, состав, приглашения, форма инвайта, таблица аудита с keyset-пагинацией, ролевой гейт owner/admin |

**Итого production:** **10 файлов / 2716 строк** (из них 1482 — код, 1234 —
сгенерированный снимок Drizzle).

### 1.2 Новые файлы — тесты

| Файл | Строк | Тестов | Что |
|---|---:|---:|---|
| [src/organizations/org-members.service.spec.ts](../../../../src/organizations/org-members.service.spec.ts) *(new)* | 289 | 7 | список по организации из БД, порядок, инвайт, 409 (email занят/повтор), нормализация, 401 |
| [src/organizations/org-members.controller.spec.ts](../../../../src/organizations/org-members.controller.spec.ts) *(new)* | 314 | 14 | supertest: 200/201/400/403/409, `Cache-Control`, guard'ы, контракт ответов |
| [web/src/components/TeamPage.spec.tsx](../../../../web/src/components/TeamPage.spec.tsx) *(new)* | 515 | 11 | вкладки, список, роли, приглашение (успех/ошибка/невалидный email), аудит, keyset «Загрузить ещё», гейт owner vs member |

**Итого тестов:** **3 файла / 1118 строк / 32 теста.**

### 1.3 Изменённые файлы

| Файл | +/− | Что |
|---|---:|---|
| [src/auth/auth.service.ts](../../../../src/auth/auth.service.ts) | +72/−8 | `UserPublic.organizationId` + `role`; `registerAsync` потребляет приглашение (создание пользователя в org пригласившего + удаление приглашения в транзакции) |
| [src/db/schema.ts](../../../../src/db/schema.ts) | +76/−0 | `INVITABLE_USER_ROLES`/`InvitableUserRole`; таблица `organizationInvitations` + типы |
| [src/app.module.ts](../../../../src/app.module.ts) | +5/−0 | Импорт `OrgMembersModule` |
| [src/audit/audit.constants.ts](../../../../src/audit/audit.constants.ts) | +11/−2 | Код действия `member.invite` + маршрут `POST /admin/members/invite` |
| [src/audit/audit.module.ts](../../../../src/audit/audit.module.ts) | +3/−1 | `OrgOwnerGuard` экспортируется для команды |
| [src/runs/dto/api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +73/−0 | 6 новых DTO и 3 enum-домена в backend-гейте |
| [src/auth/auth.controller.spec.ts](../../../../src/auth/auth.controller.spec.ts) | +23/−3 | Ожидания `UserPublic` с orgId/role |
| [src/auth/auth.service.spec.ts](../../../../src/auth/auth.service.spec.ts) | +124/−5 | Регистрация по приглашению, поля профиля, нормальное сидирование org |
| [src/audit/audit.interceptor.spec.ts](../../../../src/audit/audit.interceptor.spec.ts) | +2/−0 | Ожидание `member.invite` в таблице действий |
| [src/common/http-throttle.spec.ts](../../../../src/common/http-throttle.spec.ts) | +4/−0 | Учёт новой ручки в перечне контроллеров |
| [drizzle/meta/_journal.json](../../../../drizzle/meta/_journal.json) | +7/−0 | Запись миграции `0016` |
| [web/src/components/TopBar.tsx](../../../../web/src/components/TopBar.tsx) | +30/−0 | Кнопка 👥 «Команда» (`data-topbar-team`) + модалка |
| [web/src/components/TopBar.spec.tsx](../../../../web/src/components/TopBar.spec.tsx) | +66/−0 | Кнопка видна/скрыта, открывает диалог, гейты |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +57/−0 | `team.*`, `audit.*` (включая `audit.action.*`), `topbar.team` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +57/−0 | Зеркало EN (паритет ключей обязателен) |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +73/−0 | 6 новых зеркал + enum-домены ролей |
| [web/src/lib/auth-api.ts](../../../../web/src/lib/auth-api.ts) | +12/−1 | `AuthUserSchema` + `organizationId`/`role` |
| [web/src/stores/auth.ts](../../../../web/src/stores/auth.ts) | +15/−1 | `AuthUser` + orgId/role |
| [web/src/lib/api.spec.ts](../../../../web/src/lib/api.spec.ts) | +10/−1 | Фикстуры пользователя с orgId/role |
| [web/src/stores/auth.spec.ts](../../../../web/src/stores/auth.spec.ts) | +3/−0 | Фикстура пользователя |

**Итого по изменённым:** **20 файлов, +723 / −22** (production — 10 файлов,
тесты — 10). **Всего по коду:** 33 файла, **+3323 / −22** (включая новый
код/тесты и сгенерированный снимок отдельной строкой выше).

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +45/−0 | `[Unreleased]`: Added (S5), Changed (`UserPublic`), Fixed (KI-555/573/554-част.), Documented (ограничения команды) |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +167/−65 | Раздел S5 (KI-583..591), закрытие KI-554/555/563/573, сводка 578; удалены 9 дублирующих блоков KI-574..582 (дефект HEAD) |
| [docs/development/api-contract.json](../../api-contract.json) | +10/−1 | 6 ответов + 3 enum-домена, пояснение в `$comment` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | Строка S5 в реестре отчётов |
| [README.md](../../../../README.md) | +8/−0 | Раздел «Организации и команда»: `/auth/me`, `/admin/members*`, `/admin/audit`, кнопка 👥 «Команда» |
| [docs/development/adr/0005-organization-invitations.md](../../adr/0005-organization-invitations.md) *(new)* | 72 | ADR: приглашения по email без таблицы членства, потребление при регистрации, org из БД |
| этот отчёт *(new)* | — | 7 разделов по RULES 2.15/2.18 |

Артефакты смоука (gitignored, `.smoke/`): `v100-s5-team-api-smoke.mjs`
(389 строк), `v100-s5-team-ui-smoke.mjs` (412 строк), `v100-s5-team-api-smoke.json`,
`v100-s5-team-ui-smoke.json`, `v100-s5-team-ui.png`.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **120 passed (120 файлов), 1756 passed / 2 skipped (1758)**, 27.5 с |
| `pnpm test:parity` | **13/13** (новая таблица `organization_invitations` видна в information_schema) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с `OrgMembersModule`) |
| `pnpm --dir web build` | **exit 0** (`tsc -b` + `vite build`, 636 мс) |
| `pnpm --dir web test` | **53 passed (53 файла), 476 passed**, 22 с |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |

Прирост к S4 (с `DATABASE_URL`): root **+2 тест-файла, +25 тестов**
(1731→1756 passed, skipped 2→2); web **+1 файл, +13 тестов** (TeamPage 11 +
TopBar 2). Миграция `0016` применена к локальной БД (`pnpm db:migrate`);
`pnpm db:generate` новых изменений после миграции не находит.

---

## 3. Диагностика

### 3.1 Контракт — три места, которые нельзя разъехать

Новые ответы гейтятся `docs/development/api-contract.json`: ключи `responses`
обязаны совпадать **одновременно** с `MIRROR_SCHEMAS` web-spec'а и
`DTO_SOURCES` backend-spec'а, а `enums` — с `ENUM_SOURCES`. Поэтому в один пакет
вошли: JSON (6 ответов, 3 enum), `src/runs/dto/api-contract.spec.ts`
(`interface`-источники: `UserPublic` → `auth.service.ts`,
`Organization*` → `organization/dto/member.dto.ts`, `AuditLog*` →
`audit/dto/audit.dto.ts`) и `web/src/lib/api-contract.spec.ts` (зеркала
`AuthUserSchema`/`OrgMemberSchema`/`OrgInvitationSchema`/
`OrganizationMembersResponseSchema`/`AuditLogSchema`/`AuditLogsResponseSchema`).
Гейт поймал бы и добавление, и удаление поля на любой стороне; поля проверяются
именами, значения enum — `OrgRoleSchema.options` / `InvitableOrgRoleSchema.options`.

### 3.2 Миграция `organization_invitations` и parity-гейт

Таблица добавляется миграцией `0016_numerous_gambit.sql` (`pnpm db:generate`
создал SQL + `meta/0016_snapshot.json` + запись в `_journal.json`). Локально
применена `pnpm db:migrate`; `pnpm test:parity` прошёл **13/13** — в S4 было
12/12, новый тест появился за счёт таблицы в списке parity-гейта. В CI миграции
применяются шагом `Apply migrations` до `pnpm test` (RULES 3.19), поэтому
DB-гейт зелёный и без ручных действий.

### 3.3 Организация — из БД, а не из токена (KI-554)

`GET /admin/members` и `POST /admin/members/invite` получают только `user.sub`;
`OrgMembersService.resolveOrganizationIdAsync` читает `users.organization_id`, а
`OrgOwnerGuard` — `users.role`. Это осознанное закрытие KI-554 именно для
чувствительных операций команды: access-токен живёт 24 часа, и после переезда
пользователя в другую организацию (когда он появится, KI-583) `orgId` в токене
устарел бы. `GET /admin/audit` (S3) остался на `orgId` из токена — остаток
вынесен в KI-587, чтобы не менять контракт S3 в UI-срезе.

### 3.4 Потребление приглашения — в транзакции и «самое старое»

`AuthService.registerAsync` ищет приглашение **до** транзакции (чтение), но
создание пользователя и удаление приглашения выполняются внутри одной
транзакции с созданием организации (RULES 4.22). Порядок `created_at ASC,
id ASC` детерминирован: если email пригласили несколько организаций, побеждает
самое старое приглашение. Это зафиксировано в KI-588: остальные строки остаются
ожидающими и не действуют.

### 3.5 Аудит приглашения и его fire-and-forget-природа

`AuditInterceptor` пишет `member.invite` только после успешного обработчика
(`tap`), без ожидания ответа. Поэтому оба смоука **поллят** журнал, а не читают
его сразу после HTTP-201 (KI-567): API-смоук ждёт появления записи до 15 с,
UI-смоук — строку `[data-team-audit-action="member.invite"]` до 20 с. В metadata
попадают `{ body: { role, email }, path, method, statusCode }`; пароль/токены
интерсептор вырезает, email остаётся осознанно (KI-589).

### 3.6 Единственный упавший тест интеграции: нативная валидация формы

`TeamPage.spec.tsx` («не отправляет приглашение с некорректным email») падал:
форма с `<input type="email">` в jsdom проходит HTML5-валидацию на клик по
`submit`, `submit`-событие не наступает, и наш Zod-валидатор не выполняется —
пользователь не увидел бы локализованное сообщение. Исправление — атрибут
`noValidate` на форме (валидация уже своя, Zod): поведение одинаково в браузере
и в jsdom, сообщение `team.invite.invalid_email` показывается. После правки web
suite зелёный (476/476).

### 3.7 i18n: 57 ключей × 2 языка, `audit.action.*` с fallback

Добавлены `team.*`, `audit.*` (включая `audit.action.<код>` для всех значений
`AUDIT_ACTIONS` + `http.post/patch/delete`) и `topbar.team`. Паритет `ru`/`en`
проверяется `i18n.spec.ts` (набор ключей + непустые значения). Для действия,
которого ещё нет в переводах (новый код backend'а), UI показывает **сырой код**
с подсказкой `audit.unknown_action` — журнал не превращается в «Неизвестное
действие» и не теряет информацию.

### 3.8 Ролевой гейт UI: owner|admin, а не «только owner»

Постановка просила вкладку «Аудит» «только для owner» и кнопку «Пригласить»
«если роль owner». Фактическая авторизация backend'а — `OrgOwnerGuard`, который
пускает **owner и admin** (S3, DESIGN § 3.2). UI скрывает вкладку/кнопку для
`member`/`viewer`, но показывает их `admin`: иначе администратор организации не
увидел бы разрешённый ему журнал. Это осознанное расхождение с текстом
постановки (см. § 5/§ 7.5), а не недоделка.

### 3.9 Реестр KI: дефект HEAD и пересчёт по grep

На HEAD `docs/KNOWN_ISSUES.md` содержал **9 дублирующих кратких блоков**
KI-574..582: `### KI-` строк было 578 при 569 уникальных номерах, статусов —
579 (плюс inline-упоминание `**Статус:**` в описании KI-476). Сводка S4
утверждала 569/569, то есть расходилась с файлом (класс KI-497). В docs-проходе
S5 дубли удалены, реестр пересчитан grep'ом (RULES 3.20): **578 записей,
578 статусов, номера уникальны, сумма по статусам = 578**
(245 Fixed + 2 Fixed(частично) + 282 Open + 38 Documented + 1 Documented(не
воспроизводится) + 4 Planned + 2 Deferred + 4 Won't Fix).

### 3.10 Ход сессии: два субагента завершились аварийно на гейтах

Работа была разбита на backend и frontend (disjoint write-scopes, общий
контракт из § 1). Оба субагента записали весь код и тесты, но их прогоны
завершились аварийно на этапе финальных гейтов (frontend — сразу после
`web build`, на `web test`; backend — между `build` и `typecheck`). Lead
проверил состояние рабочего дерева, самостоятельно прогнал все гейты,
исправил единственный упавший тест (§ 3.6), выполнил смоук API+UI и оформил
документацию. Потерь кода нет: все файлы из § 1 на месте, гейты воспроизведены
на HEAD рабочего дерева.

### 3.11 `OrgMembersModule` и экспорт `OrgOwnerGuard`

`OrgOwnerGuard` жил в `AuditModule` и не экспортировался. Дублировать его в
новом модуле значило бы держать две политики «owner/admin» — вместо этого
`AuditModule` теперь экспортирует guard, а `OrgMembersModule` импортирует
`AuditModule` (и `AuthModule` ради `JwtAuthGuard`). `AppModule` подключает
`OrgMembersModule` рядом с `AuditModule`; порядок интерсепторов не менялся.

### 3.12 Преэкзистующие предупреждения не трогали

`pnpm lint` даёт 2 warning'а в `src/media/providers/openai-images.provider.spec.ts`
(`no-base-to-string` на `formData.get(...)`), `prettier` на HEAD не чист —
массового переформатирования не делали (как и в прошлых сессиях; гейты —
`oxlint` и `tsc`).

---

## 4. Smoke (живое приложение)

Окружение: PostgreSQL 17 (pgvector) `127.0.0.1:5433/workflow_builder`, Redis
`127.0.0.1:6379`, backend — `node dist/main.js` (порт 3000; в логе
`OrgMembersModule initialised`, маршруты `{ /admin/members, GET }` и
`{ /admin/members/invite, POST }`), frontend — `pnpm --dir web dev` (5173),
Chrome headless через CDP (порт 9223). Миграция `0016` применена до старта.
Скрипты: `.smoke/v100-s5-team-api-smoke.mjs`, `.smoke/v100-s5-team-ui-smoke.mjs`.

### 4.1 API — 32/32 PASS

| Блок | Проверки |
|---|---|
| Профиль (KI-555) | регистрация → `user.organizationId` (uuid) и `role=owner`; `GET /auth/me` → те же `organizationId` и `role=owner` |
| `GET /admin/members` | 200; `Cache-Control: no-store`; владелец в списке; приглашений 0; без токена — 401 |
| Валидация инвайта | `role=owner` → 400; битый email → 400; занятый email → 409 |
| Успешный инвайт | 201; email `Smoke-S5-Invitee-…@Example.COM` нормализован в нижний регистр; `invitedBy` = владелец, `role=member`; повторный инвайт → 409; приглашение видно в `invitations` |
| Регистрация по приглашению (KI-563) | новый пользователь создан в организации пригласившего, `role=member`; `GET /auth/me` — та же организация; список участников: 2 человека, приглашений 0 |
| Права | участнику `GET /admin/members` → 200; `POST /admin/members/invite` → 403; `GET /admin/audit` → 403 |
| Аудит (KI-573/566) | владельцу 200, `Cache-Control: no-store`, запись `member.invite` с автором/организацией, metadata без пароля, журнал только своей организации |
| Уборка | `delete from organizations` (каскад) — 1 организация удалена |

### 4.2 UI — 18/18 PASS (headless Chrome, реальный Vite-dev + backend)

| Шаг | Факт |
|---|---|
| Вход через UI | регистрация владельца через API, логин формой `/login`, появился TopBar |
| Кнопка «Команда» | текст `👥 Команда` |
| Открытие модалки | `[data-team-modal]`, заголовок «Команда и аудит» |
| Вкладка «Участники» (по умолчанию) | `aria-selected=true`; 1 строка — владелец; бейдж роли `owner`; пометка «вы»; «Ожидают регистрации» пусто |
| Вкладка «Аудит» | доступна владельцу (`[data-team-tab-audit]`) |
| Приглашение | форма → email `smoke-s5-ui-invitee-…`, роль `viewer` → 201; «Приглашение отправлено: …»; форма закрыта; строка появилась в «Ожидают регистрации» (перезапрос списка) |
| Журнал аудита (ленивая загрузка) | строка `member.invite`; подпись «Приглашение в организацию»; пользователь — email владельца; «Показано 1 из 1», «Всего: 1» |
| Возврат на «Участники» | приглашение и участники на месте |
| Escape | снимок «до»: модалка есть → «после»: модалки нет (RULES 4.33) |
| Ошибки | `pageErrors=[]`, `consoleErrors=[]` (лог-ошибки браузера — пусто) |

Скриншот: `.smoke/v100-s5-team-ui.png` (вкладка «Аудит»: таблица
дата/пользователь/действие/ресурс, строка `member.invite`, футер keyset).

### 4.3 Уборка и состояние БД

Организации обоих смоуков удалены (по 1 на прогон, каскад снимает
пользователей, приглашения и журнал; `workflow_collaborators` не было — обход
KI-559 не потребовался). Состояние БД после прогонов: **users=69, orgs=69,
organization_invitations=0, audit_logs=0** (как до S5). Сервер и Vite
остановлены перед финальными гейтами (RULES 3.14).

---

## 5. Что не так

1. **Приглашение работает только для новых email** (KI-583): существующего
   пользователя нельзя добавить в команду — 409. Это главное продуктовое
   ограничение S5.
2. **Письма не отправляются** (KI-584): приглашение — строка в БД, приглашённый
   узнаёт о нём вне продукта. UI честно пишет «Приглашение отправлено: email»,
   но доставки нет.
3. **Нет управления участниками** (KI-586): смена роли и удаление из
   организации отсутствуют — только приглашение.
4. **UI аудита без фильтров** (KI-585): есть только лента с keyset-пагинацией.
5. **`GET /admin/audit` по-прежнему доверяет `orgId` из токена** (KI-587):
   KI-554 закрыт частично; после переезда пользователя журнал старой
   организации был бы виден до истечения токена.
6. **Несколько организаций могут пригласить один email** (KI-588): при
   регистрации «сжигается» только самое старое приглашение, остальные висят
   ожидающими и не действуют.
7. **Email приглашённого — в metadata аудита в открытом виде** (KI-589):
   осознанно (смысл записи), но retention журнала не определён (KI-565).
8. **Список команды без пагинации/поиска** (KI-590): для крупных организаций
   лишний трафик и длинный DOM; роль остаётся глобальной (KI-570).
9. **«Команда» — модалка без deep-link** (KI-591): после F5 окно закрыто,
   ссылку на вкладку «Аудит» отправить нельзя.
10. **Постановка расходится с реализацией в трёх местах, и это осознанно:**
    (а) `GET /auth/me` на HEAD **не** отдавал `orgId`/`role`, хотя постановка
    утверждала «в S1/S3 уже сделано» — исправлено (KI-555); (б) роль вкладки
    «Аудит»/кнопки «Пригласить» — `owner|admin`, а не «только owner», чтобы не
    расходиться с `OrgOwnerGuard` backend'а; (в) роли команды —
    `owner/admin/member/viewer` из `users.role`, а не `owner/editor/viewer` из
    постановки: `editor/viewer` — роли **workflow**-участника (`workflow_collaborators`),
    у организации другая модель (DESIGN § 2.1). Задача «добавь
    `GET /workflow/:id/collaborators`» не требовала правок: ручка есть с S2 и уже
    отдаёт `role` + `email` (проверено существующим `collaborator.dto.spec.ts` и
    контрактом).
11. **Дефект документации HEAD (исправлен):** 9 дублирующих блоков KI-574..582
    и inline-упоминание `**Статус:**`, из-за которых `grep` давал 578 записей/579
    статусов при сводке 569. Реестр пересчитан и сходится (§ 3.9).
12. **Субагенты завершились аварийно на финальных гейтах** (§ 3.10): код и
    тесты были записаны полностью, Lead довёл проверку, починил один тест и
    оформил смоук/доки. На результат это не повлияло, но процесс-риск зафиксирован.
13. **Преэкзистующие `oxlint`-warnings и нечистый `prettier`** не трогали
    (вне scope S5, как и в прошлых сессиях).
14. **Нет E2E-теста «приглашение → регистрация → доступ к чужому workflow»**:
    same-org коллаборация покрыта API-смоуком, но полноценный сценарий «два
    пользователя в одной организации работают над одним workflow» — кандидат в
    KI-590/583 при появлении управления ролями.

---

## 6. Новые KI

Всего **9**: KI-583..591 (реестр пересчитан grep'ом, RULES 3.20: **578**
записей, 578 статусов, номера уникальны).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-583](../../../KNOWN_ISSUES.md) | 🟡 Medium | Open | Приглашение не переносит уже зарегистрированного пользователя в организацию (409) |
| [KI-584](../../../KNOWN_ISSUES.md) | 🟡 Medium | Documented | Приглашения не доставляются письмом — нет SMTP/транспорта |
| [KI-585](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | В UI аудита нет фильтров по действию/пользователю/дате |
| [KI-586](../../../KNOWN_ISSUES.md) | 🟡 Medium | Planned (v1.1) | Нет смены роли и удаления участника из организации |
| [KI-587](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | `GET /admin/audit` всё ещё фильтрует по `orgId` из токена |
| [KI-588](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Несколько организаций могут пригласить один email; «сжигается» только самое старое |
| [KI-589](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Email приглашённого хранится в metadata аудита в открытом виде |
| [KI-590](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Список команды без пагинации/поиска; роль не привязана к членству |
| [KI-591](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | «Команда» — модалка без deep-link и восстановления после F5 |

**Закрытые KI:** KI-555 (Fixed, `UserPublic`/`/auth/me` с `organizationId` и
`role`), KI-563 (Fixed, приглашение в организацию + регистрация по приглашению),
KI-573 (Fixed, UI аудита), KI-554 (Fixed частично — для `/admin/members*`;
остаток KI-587).

Сводка реестра: **245 Fixed + 2 Fixed(частично) + 282 Open + 38 Documented +
1 Documented(не воспроизводится) + 4 Planned + 2 Deferred + 4 Won't Fix =
578**. Обновлены `docs/CHANGELOG.md` (Added/Changed/Fixed/Documented),
`docs/KNOWN_ISSUES.md` (раздел S5 + закрытие KI + сводка + удаление дублей
HEAD), `docs/development/api-contract.json`, `README.md`, `reports/README.md`,
ADR-0005.

---

## 7. Обоснование решений

### 7.1 Почему отдельная таблица приглашений, а не «приглашённые пользователи»

Создать `users`-строку заранее нельзя: нет `password_hash`, а «заглушечный»
пользователь сломал бы уникальность email и вход. Переписать
`users.organization_id` существующему пользователю — значит потерять его
workflow: графы привязаны к прежней организации (S2), и после смены арендатора
он не увидит свои данные. Поэтому приглашение — самостоятельная сущность с
адресом и ролью, а «вступление» происходит в момент регистрации, когда
пользователь создаётся сразу в нужной организации. Альтернатива
`organization_members` (полноценное членство) выходит за S5: она меняет модель
ролей (KI-570) и требует политики переноса workflow — это отдельный срез
(KI-583/586).

### 7.2 Почему «сжигание» приглашения при регистрации, а не отдельный accept-эндпоинт

Приглашённый ещё не аутентифицирован, поэтому «принять приглашение» пришлось бы
делать либо до регистрации (по токену из письма — письма нет, KI-584), либо
после (лишний шаг, требующий UI выбора организации). Регистрация и так создаёт
организацию; заменить «создать личную» на «вступить в пригласившую» — одна
транзакция, ноль новых экранов и детерминированный результат. Цена — привязка к
email (совпадает с приглашением по email) и невозможность пригласить уже
зарегистрированного (KI-583).

### 7.3 Почему организация резолвится из БД (KI-554), а не из токена

Токен живёт 24 часа. Как только появится смена организации/исключение
(следующие срезы), `orgId` в токене станет устаревшим, и «список команды» или
«приглашение» могли бы уйти в чужой арендатор. Роль приглашающего уже читалась
из БД в `OrgOwnerGuard` (S3, ради немедленного отзыва прав). Для команды
использован тот же принцип: вход — только `sub`, организация — из строки
`users`. Стоимость — один дополнительный SELECT на запрос; для
административных ручек это приемлемо. Остаток с аудитом (KI-587) оставлен
осознанно: правка S3-контракта в UI-срезе расширила бы поверхность.

### 7.4 Почему `GET /admin/members` доступен всем, а инвайт — только owner/admin

Состав команды — не секрет для её членов (email коллег нужен и `member`, и
`viewer`: например, чтобы понимать, кто автор запуска в аудите). Инвайт же
меняет состав организации — это административное действие, поэтому
`OrgOwnerGuard` (`owner`/`admin`, 403 остальным), переиспользованный из
`AuditModule`. Два guard'а на одном контроллере — не дублирование политики, а
явное различие двух операций.

### 7.5 Почему UI показывает аудит/инвайт для `owner` и `admin`

Постановка говорит «только owner», но backend авторизует `owner|admin`
(`OrgOwnerGuard`, DESIGN § 3.2). Скрывать от администратора разрешённую ему
ручку — значит ломать его рабочий сценарий; показывать `member` — предлагать
гарантированный 403. Принцип проекта (KI-397): UI не предлагает действие,
которое backend гарантированно отклонит, и не скрывает разрешённое. Поэтому
`MANAGEMENT_ROLES = {owner, admin}` — и вкладка «Аудит», и кнопка «Пригласить».
Расхождение с текстом постановки зафиксировано в § 5/§ 7.5, а не «заметено».

### 7.6 Почему роли команды — `owner/admin/member/viewer`, а не `owner/editor/viewer`

`owner/editor/viewer` — роли **участника workflow** (`workflow_collaborators`,
R7.6): они дают права на конкретный граф. Роли организации — из DESIGN § 2.1:
`owner` (владелец), `admin` (управление командой), `member` (создание
workflow), `viewer` (просмотр); они уже живут в `users.role` с S3 и в CHECK БД.
Смешать два словаря значило бы сломать audit-гейт (`OrgOwnerGuard`) и
`api-contract` (домен `CollaboratorResponse.role`). Поэтому UI команды
использует домен `USER_ROLES`, а `editor` остаётся только у workflow-участников.

### 7.7 Почему модалка, а не отдельная страница

Постановка допускает модалку «по аналогии с History». Команда — контекст
аккаунта, а не графа: уходить со страницы редактора ради списка участников
значит терять несохранённый граф (страница не защищена от навигации), а
`TopBar` уже держит такие модалки (`Load`, `Share`, `History`). Модалка
переиспользует готовые паттерны (Escape/фон/✕, `z-40`), не требует роутинга и
не ломает существующие тесты `App`. Цена — нет deep-link (KI-591).

### 7.8 Почему keyset-пагинация аудита, а не offset

`GET /admin/audit` с S3 отдаёт непрозрачный курсор (`createdAt` с µs + `id`) и
`nextCursor`, посчитанный выборкой `limit + 1`. Журнал пополняется на каждом
мутирующем запросе, поэтому offset-окно сдвигалось бы и давало дубли/пропуски —
ровно то, что KI-542 уже исправил в истории запусков. UI повторяет проверенный
подход `RunHistoryModal`: догрузка по `nextCursor`, дедупликация по `id`,
источник истины о наличии страниц — курсор, а не `total`.

### 7.9 Почему контракт расширен, а не «схемы на месте»

Проект держит REST-контракт гейтом (KI-352): без записи в
`api-contract.json` обе стороны могли бы молча разойтись в составе полей
(класс KI-350/352). Новые ответы команды и аудита — первые REST-зеркала после
S4, и добавлять их «мимо» гейта значило бы плодить исключения. Заодно в
контракт попал `UserPublic` — именно он закрывает KI-555 наблюдаемым способом:
если одна из сторон забудет `organizationId`/`role`, CI упадёт.

### 7.10 Почему `member.invite` в аудите, а не fallback `http.post`

Таблица маршрутов аудита (`AUDIT_ACTIONS`) — единственный источник кодов
действий; без записи приглашение попало бы в журнал как `http.post`, и владелец
не отличил бы его от любого другого POST. Это ровно тот ручной список, который
KI-568 считает хрупким; S5 не решает KI-568 (паритет-тест маршрутов — отдельная
задача), но не усугубляет его: новый маршрут добавлен в таблицу сразу и покрыт
spec'ом.

### 7.11 Почему приглашение проверяет занятый email с 409, а не «тихо приглашает»

Приглашение на зарегистрированный email не может быть выполнено (перенос не
поддержан, KI-583). Молчаливое «приглашение отправлено» было бы ложью: строка
повисла бы в ожидающих, а регистрация по этому email уже невозможна. Честный
409 с текстом «перенос между организациями не поддерживается» отправляет
владельца к ограничению, а не в тупик. Гонка двух инвайтов закрыта
`ON CONFLICT DO NOTHING` + `.returning()` (KI-400): 409, а не 500.

### 7.12 Почему смоук — два скрипта (API и CDP), а не один

API-сценарий доказывает серверную половину (права, 409/403, нормализация,
потребление приглашения, запись аудита) и работает без браузера — его можно
повторять в CI-подобном окружении. CDP-сценарий проверяет только то, что не
видно unit-тестам: реальный React в браузере, открытие модалки, переключение
вкладок, ленивую загрузку аудита и Escape-закрытие (снимок «до»/«после»,
RULES 4.33). Разделение даёт независимую диагностику: падение UI не прячет
API-результаты, и наоборот.
