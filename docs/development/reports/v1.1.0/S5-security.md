---
title: "S5: Отзыв access-токена, организация из БД в write-путях, маскировка email (v1.1.0)"
date: 2026-11-05
version: v1.1.0
steps: [S5]
status: accepted
related_ki: [KI-589, KI-601, KI-605, KI-614, KI-615, KI-616]
related_adr: [0010]
---

# Отчёт S5 — Security Polish (v1.1.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**122 passed (122 файла), 1848 passed / 2 skipped (1850)**, `pnpm test:parity` —
**13/13**, `pnpm test:e2e` — **1/1**, `pnpm --dir web build` — exit 0,
`pnpm --dir web test` — **54 passed (54 файла), 493 passed**, `pnpm lint` —
**0 errors / 2 warnings** (оба преэкзистующие,
`openai-images.provider.spec.ts`). Смоук на живом приложении — **16/16**:
удалённый участник старым access-токеном получает 401 на чтение и запись,
`token_version` инкрементится, новый вход работает, email в аудите замаскирован.

**Точка старта.** HEAD `a66a53a` («feat(v1.1.0): S4 — Metrics Improvement»),
CI зелёный. Источник — DESIGN V110 § 3.5, KI-589/KI-601/KI-605, правила —
`docs/development/RULES.md` v1.10.0.

**Сделано:** `users.token_version` (миграция 0018) и `ver` в access-токене;
`JwtAuthGuard` сверяет организацию и версию с БД на каждом запросе; удаление
участника инкрементит версию в транзакции; `WorkflowService.createAsync`/
`importAsync` принимают `userId` и резолвят организацию из `users`;
`AuditInterceptor` использует сверенный payload и маскирует email в
`member.invite`/`member.remove`. **Закрыто KI:** KI-589, KI-601, KI-605.
**Новые KI:** KI-614..616 (§ 6). ADR-0010. Смоук 16/16.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [drizzle/0018_daffy_triathlon.sql](../../../../drizzle/0018_daffy_triathlon.sql) *(new)* | 1 | `ALTER TABLE users ADD COLUMN token_version integer DEFAULT 0 NOT NULL` |
| [test/helpers/jwt-auth-db.stub.ts](../../../../test/helpers/jwt-auth-db.stub.ts) *(new)* | 60 | Общая заглушка `DRIZZLE` для HTTP-спеков: guard читает `organization_id`/`token_version` |
| [docs/development/adr/0010-token-version-and-write-path-org.md](../../adr/0010-token-version-and-write-path-org.md) *(new)* | 78 | ADR-0010: token_version, сверка в guard, организация в write-путях, маскировка |
| Этот отчёт *(new)* | — | 7 разделов по RULES 2.15/2.18 |

**Итого нового кода/тестов:** 1 строка SQL + 60 строк тестового helper'а.
Артефакты смоука (gitignored, `.smoke/`): `v110-s5-security-smoke.mjs` — 351
строка, `.json` — 97, `v110-s5-backend.log`.

### 1.2 Изменённые файлы — production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/auth/guards/jwt-auth.guard.ts](../../../../src/auth/guards/jwt-auth.guard.ts) | +65/−6 | SELECT `organization_id`/`token_version` по `sub`; 401 при отсутствии пользователя, смене организации или версии; payload с актуальным `orgId` |
| [src/auth/interfaces/jwt-payload.ts](../../../../src/auth/interfaces/jwt-payload.ts) | +12/−3 | Поле `ver` (версия access-токена), документация legacy-токенов |
| [src/auth/auth.service.ts](../../../../src/auth/auth.service.ts) | +5/−1 | `ver: user.tokenVersion` в payload; JSDoc |
| [src/organizations/org-members.service.ts](../../../../src/organizations/org-members.service.ts) | +9/−2 | Инкремент `token_version` в транзакции удаления участника |
| [src/db/schema.ts](../../../../src/db/schema.ts) | +9/−0 | `users.token_version` (integer NOT NULL DEFAULT 0) + JSDoc |
| [src/workflow/workflow.service.ts](../../../../src/workflow/workflow.service.ts) | +49/−13 | `createAsync`/`importAsync` принимают `userId`; `resolveAccessAsync` из `users`; 401 без пользователя; JSDoc |
| [src/workflow/workflow.controller.ts](../../../../src/workflow/workflow.controller.ts) | +7/−6 | `create`/`importAsync` передают `user.sub`, а не `toWorkflowAccess` |
| [src/templates/templates.controller.ts](../../../../src/templates/templates.controller.ts) | +3/−5 | `instantiate` передаёт `user.sub`; импорт `toWorkflowAccess` удалён |
| [src/audit/audit.interceptor.ts](../../../../src/audit/audit.interceptor.ts) | +115/−12 | Маскировка email для `member.invite`/`member.remove`; JSDoc про org из БД и PII |
| [src/audit/audit.service.ts](../../../../src/audit/audit.service.ts) | +6/−4 | JSDoc `AuditEntry`: организация сверена с БД, email маскируется |

**Итого по production:** **+280 / −52**.

### 1.3 Изменённые файлы — тесты и helper'ы

| Файл | +/− | Что |
|---|---:|---|
| [src/auth/guards/jwt-auth.guard.spec.ts](../../../../src/auth/guards/jwt-auth.guard.spec.ts) | +134/−8 | Заглушка DRIZZLE; 12 тестов: org/version mismatch → 401, нет пользователя → 401, legacy без `ver` → 0, AUTH_DISABLED без БД |
| [src/workflow/workflow.service.spec.ts](../../../../src/workflow/workflow.service.spec.ts) | +40/−7 | 2 новых теста: org из БД (не из аргумента), 401 без пользователя; create/import по `userId` |
| [src/audit/audit.interceptor.spec.ts](../../../../src/audit/audit.interceptor.spec.ts) | +81/−1 | 4 теста маскировки: body, строка/вложенность, `member.remove`, негативный для `workflow.create` |
| [src/auth/auth.service.spec.ts](../../../../src/auth/auth.service.spec.ts) | +20/−4 | `tokenVersion` в фикстуре; `ver: 0` в payload; тест `ver=7` |
| [src/organizations/org-members.service.spec.ts](../../../../src/organizations/org-members.service.spec.ts) | +3/−0 | Ожидание инкремента `tokenVersion` при удалении |
| [src/audit/admin-audit.controller.spec.ts](../../../../src/audit/admin-audit.controller.spec.ts) | +16/−18 | Стаб guard'а отдаёт org/version; stale org теперь 401 до сервиса |
| [src/organizations/org-members.controller.spec.ts](../../../../src/organizations/org-members.controller.spec.ts) | +13/−5 | Стаб guard'а отдаёт org/version |
| [src/workflow/workflow.controller.spec.ts](../../../../src/workflow/workflow.controller.spec.ts) | +13/−8 | `createAsync`/`importAsync` получают `sub`; `ver` в USER |
| [src/templates/templates.controller.spec.ts](../../../../src/templates/templates.controller.spec.ts) | +7/−5 | `importAsync` получает `sub` |
| [src/audit/org-owner.guard.spec.ts](../../../../src/audit/org-owner.guard.spec.ts) | +6/−1 | `ver` в payload |
| [src/organizations/org-owner-only.guard.spec.ts](../../../../src/organizations/org-owner-only.guard.spec.ts) | +6/−1 | `ver` в payload |
| [src/runs/runs.controller.spec.ts](../../../../src/runs/runs.controller.spec.ts) | +8/−1 | `ver` в USER + DRIZZLE для guard |
| [src/auth/auth.controller.spec.ts](../../../../src/auth/auth.controller.spec.ts) | +2/−0 | DRIZZLE-заглушка для guard |
| [src/common/http-throttle.spec.ts](../../../../src/common/http-throttle.spec.ts) | +2/−0 | DRIZZLE-заглушка для guard |
| [src/documents/document-templates.controller.spec.ts](../../../../src/documents/document-templates.controller.spec.ts) | +2/−0 | DRIZZLE-заглушка для guard |
| [src/mcp/mcp.controller.spec.ts](../../../../src/mcp/mcp.controller.spec.ts) | +2/−0 | DRIZZLE-заглушка для guard |
| [src/workflow/workflow-collaborators.spec.ts](../../../../src/workflow/workflow-collaborators.spec.ts) | +3/−0 | DRIZZLE-заглушка для HTTP-модуля |
| [src/workflow/workflow-share.spec.ts](../../../../src/workflow/workflow-share.spec.ts) | +3/−0 | DRIZZLE-заглушка для HTTP-модуля |

**Итого по тестам:** **+361 / −59** (+ helper 60 строк).

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +60/−0 | `[Unreleased]`: Added (S5), Changed (`ver`/write-пути), Security (KI-601/605/589), Fixed (KI-601/605/589), Documented (KI-614..616) |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +92/−48 | KI-589/601/605 → Fixed (S5), раздел S5 (KI-614..616), удалены 5 дублей KI-609..613, сводка 603 |
| [README.md](../../../../README.md) | +5/−1 | Auth: `ver`, сверка с БД, write-пути из БД |
| [docs/development/reports/README.md](../README.md) | +1/−0 | Строка S5 в реестре отчётов |
| [docs/development/adr/0010-token-version-and-write-path-org.md](../../adr/0010-token-version-and-write-path-org.md) *(new)* | 78 | ADR-0010 |
| этот отчёт *(new)* | — | 7 разделов |

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **122 passed (122 файла), 1848 passed / 2 skipped (1850)**, 51.7 с |
| `pnpm test:parity` | **13/13** (миграция 0018 применена) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule`) |
| `pnpm --dir web build` | **exit 0** (`tsc -b` + `vite build`) |
| `pnpm --dir web test` | **54 passed (54 файла), 493 passed** |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |
| Смоук (живое приложение) | **16/16 PASS**, 0 FAIL |

Прирост к HEAD (S4): root **+11 тестов** (1837→1848 passed, файлов 122→122:
+4 guard, +2 workflow, +4 interceptor, +1 auth); web не менялся (493, 54
файла). Миграция 0018 — только `ADD COLUMN token_version DEFAULT 0`, backfill
не нужен (DEFAULT заполняет существующие строки).

---

## 3. Диагностика

### 3.1 Почему `token_version`, а не только сверка `orgId`

Альтернатива из постановки — на каждом запросе проверять, что `user.sub`
существует и его `orgId` совпадает с токеном. Она закрывает переезд, но не
даёт **управляемого отзыва**: нельзя отозвать токен, не меняя организацию
(например, при компрометации или logout). `token_version` — тот же один SELECT,
но добавляет явную операцию «отозвать все access-токены пользователя»:
`UPDATE users SET token_version = token_version + 1`. Поэтому выбрана версия,
а сверка `orgId` оставлена как дополнительное условие в том же запросе
(defense in depth): даже если будущий код изменит организацию без инкремента,
устаревший токен не пройдёт.

### 3.2 Что именно проверяет `JwtAuthGuard`

После проверки подписи и наличия `orgId`:

```
SELECT organization_id, token_version FROM users WHERE id = payload.sub LIMIT 1
```

- нет строки → 401 «Пользователь не найден»;
- `organization_id !== payload.orgId` → 401;
- `payload.ver` (или 0 для legacy) `!== token_version` → 401;
- иначе `request.user = { ...payload, orgId: current.organizationId, ver: current.tokenVersion }`.

Один SELECT на запрос; он же даёт актуальную организацию для всех
последующих guard'ов и write-путей. Ошибки не раскрывают, что именно не
совпало: клиент получает «Сессия недействительна, войдите заново».

### 3.3 Отзыв при удалении участника

`OrgMembersService.removeMemberAsync` в той же транзакции, что перенос графов,
участия, создание личной организации и отзыв refresh-токенов, выполняет:

```sql
UPDATE users
SET organization_id = <personal>, role = 'owner', token_version = token_version + 1
WHERE id = <target>
```

Порядок не менялся: сначала графы, затем пользователь. После коммита старый
access-токен B не проходит ни по организации (она другая), ни по версии
(инкремент). Смоук подтверждает 401 на `/auth/me`, `GET /workflow`,
`GET /admin/audit`, `POST /workflow`.

### 3.4 Организация в write-путях: две границы

1. **HTTP-граница:** `JwtAuthGuard` сверяет org/version с БД и кладёт в
   `request.user` актуальную организацию. Поэтому `AuditInterceptor`,
   `toWorkflowAccess` и все остальные write-пути используют БД-значение, даже
   если код не менялся.
2. **Сервисная граница:** `WorkflowService.createAsync`/`importAsync` больше
   не принимают `WorkflowAccess` — только `userId`, и сами читают
   `users.organization_id` (401, если строки нет). Это защищает прямой вызов
   сервиса (внутренние сценарии/тесты) от подложенной организации. Контроллеры
   `workflow`/`templates` передают `user.sub`; `importAsync` делегирует в
   `createAsync`, поэтому путь записи один.

`AuditInterceptor` отдельный SELECT не делает: его `organizationId` —
`request.user.orgId`, уже сверенный guard'ом. Это осознанно: иначе каждый
мутирующий запрос давал бы второй SELECT (guard + interceptor) при том же
результате.

### 3.5 Маскировка email

Для `member.invite` и `member.remove` metadata рекурсивно обходится
(`maskEmailsDeep`): строки заменяются по regex, локальная часть сжимается до
первого символа + `***`, домен сохраняется. Маска идемпотентна
(`a***@example.com` → `a***@example.com`), применяется к `body`, `params`,
вложенным объектам/массивам, глубина ограничена 8. Для остальных действий
metadata не меняется: email там может быть нужен для расследования
(политика зафиксирована в KI-616 как ограничение).

### 3.6 Legacy-токены без `ver`

`JwtPayload.ver` обязателен в типе, но токены, выпущенные до S5, его не
содержат. Guard трактует отсутствие как `0` — DEFAULT колонки, поэтому
массового разлогина при деплое нет. После первого инкремента версии (удаление
участника) такие токены перестают проходить; устаревший `orgId` отклоняется
сразу, независимо от `ver`. Это компромисс: совместимость с текущими
сессиями vs немедленная инвалидация всех старых токенов; выбран первый, потому
что org-сверка уже закрывает главный вектор.

### 3.7 Почему пришлось править 18 спеков

`JwtAuthGuard` получил третью зависимость — `DRIZZLE`. HTTP-спеки контроллеров
собирают `TestingModule` без `AppModule`, поэтому глобальный `DbModule` им
недоступен: Nest падал с «can't resolve dependencies of JwtAuthGuard
(JwtService, ConfigService, ?)». Добавлен общий helper
`test/helpers/jwt-auth-db.stub.ts` (`jwtAuthDbProvider`) с «тогдабельной»
цепочкой SELECT; он отдаёт фиксированную строку `users` (по умолчанию
демо-организация, версия 0). Для спеков с настоящей проверкой токена
(`admin-audit`, `org-members`) обновлены собственные стабы, чтобы guard видел
`organizationId`/`tokenVersion`. Всего изменены 18 спеков: helper добавлен в
9 HTTP-модулей, два стаба обновлены, в остальных — `ver` в payload и
ожидания `sub`. Это механическая, но необходимая цена централизованной
проверки в guard'е.

### 3.8 Дефекты реестра на HEAD S4

На HEAD `a66a53a` в реестре было **608 заголовков при 603 уникальных номерах**:
краткие копии KI-609..613 снова появились после docs-шага S4 (подробные записи
уже были). Дубли удалены; реестр пересчитан grep'ом (RULES 3.20): **603
записи, 603 статуса, номера уникальны**. Сводка: Fixed 260,
Fixed (частично) 6, Open 285, Documented 42,
Documented (не воспроизводится) 1, Planned 3, Deferred 2, Won't Fix 4.

### 3.9 Почему старый S3-тест аудита изменён

`admin-audit.controller.spec.ts` проверял, что при устаревшем `orgId` сервис
получает `sub` и читает новую организацию (S3-поведение: 200 + пустой журнал).
С S5 guard отклоняет такой токен **до** контроллера (401), поэтому тест
переписан: `expect(401)` и `service.listAsync` не вызывается. Это не регресс,
а усиление: раньше удалённый видел пустой журнал, теперь не проходит вообще.

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder` (миграция 0018
применена), Redis `127.0.0.1:6379`, backend — `node dist/main.js` на **3100**
(3000 занят сторонним Grafana-контейнером). Скрипт
`.smoke/v110-s5-security-smoke.mjs` (351 строка). Итог: **16/16 PASS, 0 FAIL**;
`generatedAt = 2026-11-04T22:06:07.183Z`, `ownerOrgId =
ace77aa5-76f9-4c33-b635-1581f3441dd5`, `personalOrgId =
713a20e4-e52d-4ea1-a252-a00fc9f2d600` (обе организации удалены).

### 4.1 До удаления

| Проверка | Факт |
|---|---|
| B вошёл в организацию A | `role=member`, `organizationId=A` |
| `users` B | организация A, `token_version=0` |
| B создаёт workflow | 201, `organizationId=A` (токен валиден) |
| `member.invite` в журнале A | есть |
| Email в `metadata.body` | `s***@example.com`, полного адреса нет |

### 4.2 После удаления (KI-601/KI-605)

| Запрос старым токеном B | Факт |
|---|---|
| `GET /auth/me` | **401** |
| `GET /workflow` | **401** |
| `GET /admin/audit` | **401** |
| `POST /workflow` (write) | **401** — workflow в A не создан |
| `users` B в БД | личная организация, `token_version=1` |
| Токен A | продолжает работать, `POST /workflow` → 201 в A |
| Журнал A | содержит `member.remove`, полного email B нет |

### 4.3 Новый вход B

| Проверка | Факт |
|---|---|
| `POST /auth/login` | 200, `organizationId=personal`, `role=owner` |
| `POST /workflow` новым токеном | 201, `organizationId=personal` |
| `GET /admin/audit` новым токеном | 200, все записи личной организации |
| Уборка | организации smoke удалены; `smoke-s5-%` — 0 |

### 4.4 Сервер

Остановлен после смоука (RULES 3.14); порт 3100 освобождён.
Лог — `.smoke/v110-s5-backend.log`, JSON —
`.smoke/v110-s5-security-smoke.json` (оба gitignored).

---

## 5. Что не так

1. **Logout не отзывает access-токен (KI-614, 🟢 Low).** `POST /auth/logout`
   отзывает refresh и чистит cookie, но access живёт до TTL. Инкремент
   `token_version` на logout отозвал бы все сессии пользователя (все
   устройства), а не текущую; blacklist `jti` в Redis не вводился.
2. **SELECT в БД на каждый запрос (KI-615, 🟢 Low).** Guard читает
   org/version; `OrgOwnerGuard`/`OrgOwnerOnlyGuard` читают роль вторым
   запросом. Это цена немедленного отзыва; кэш не вводился, чтобы не
   создавать окно устаревания.
3. **Маскировка email не универсальна (KI-616, 🟢 Low).** Включена для
   `member.invite`/`member.remove`; `collaborator.invite` по-прежнему пишет
   email в metadata. Политика «маскировать везде» не зафиксирована в RULES.
4. **`token_version` отзывает все сессии сразу.** Нет «выйти на одном
   устройстве»: инкремент глобальный. Для по-сессионного отзыва нужен `jti`
   + storage.
5. **Legacy-токены без `ver` остаются валидными до первого инкремента.**
   Это осознанная совместимость; полная инвалидация потребовала бы обязательного
   `ver` и массового разлогина при деплое.
6. **Нет endpoint'а «отозвать сессии» для пользователя/админа.** Механизм
   есть, но наружу не выставлен; сейчас используется только при удалении
   участника.
7. **`AUTH_DISABLED=true` обходит проверку БД.** Демо-пользователь фиксирован;
   режим запрещён в production (KI-213), поэтому это не дыра, но тесты/дев
   работают без сверки версии.
8. **`WorkflowService.resolveAccessAsync` дублирует чтение `users`, которое
   уже сделал guard.** Для `POST /workflow` это второй SELECT; осознанно —
   вторая граница сервиса (RULES 1.17), но на высоком RPS это ещё один
   round-trip (см. KI-615).
9. **Тестовый helper `jwtAuthDbProvider` добавлен во все HTTP-спеки, включая
   модули с `AUTH_DISABLED=true`, где SELECT не выполняется.** Безвредно, но
   создаёт дублирующий провайдер `DRIZZLE` в модулях, где уже есть настоящий
   стаб; порядок провайдеров проверен тестами, но хрупок.
10. **Полного integration-теста «удалённый B → 401» в `pnpm test` нет.**
    Guard покрыт unit-тестами (org/version/no-user), удаление — сервисным
    тестом (инкремент), а сквозной сценарий проверен смоуком. Для CI-гейта
    без живого сервера это осознанно.
11. **`pnpm lint` — 2 преэкзистующих warning'а** в
    `openai-images.provider.spec.ts` (не наши файлы); массовое
    переформатирование не делали.
12. **Реестр KI на HEAD S4 снова содержал 5 дублей** KI-609..613 после
    docs-шага (608 заголовков при 603 уникальных). Удалены, сводка
    пересчитана: 603/603.
13. **`pnpm test` без `DATABASE_URL` пропускает DB-спеки**; в этом прогоне
    (с `DATABASE_URL`) пропущены только 2 теста `openai-images.integration`
    (нет ключа Images, `skipIf`). Это свойство конфига, не регресс.

---

## 6. Новые KI

Всего **3**: KI-614..616. Реестр пересчитан grep'ом (RULES 3.20): **603**
записи `### KI-`, 603 статуса, номера уникальны (было 608 заголовков при 603
уникальных — удалены 5 кратких дублей KI-609..613).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-614](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Logout не отзывает access-токен: глобальный `token_version` затронул бы все сессии |
| [KI-615](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | `JwtAuthGuard` делает SELECT в БД на каждый аутентифицированный запрос |
| [KI-616](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Email маскируется только в `member.invite`/`member.remove`, не в `collaborator.invite` |

**Закрытые KI:** KI-589 (Fixed — маскировка email), KI-601 (Fixed — отзыв
access-токена), KI-605 (Fixed — org из БД в write-путях).
**Исправлено в реестре по ходу:** удалены 5 дублей KI-609..613.

Сводка: **Fixed 260 + Fixed (частично) 6 + Open 285 + Documented 42 +
Documented (не воспроизводится) 1 + Planned 3 + Deferred 2 + Won't Fix 4 =
603**. Обновлены `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `README.md`,
`reports/README.md`, ADR-0010.

---

## 7. Обоснование решений

### 7.1 Почему `token_version`, а не только проверка `orgId`

Проверка «orgId совпадает с БД» уже закрывает удаление из организации, но не
даёт управляемого отзыва: при компрометации токена/устройства нельзя
инвалидировать сессии, не меняя организацию. `token_version` — стандартный
механизм с той же ценой (один SELECT), но с явной операцией отзыва. Сверка
`orgId` оставлена в том же SELECT как страховка от будущих путей, меняющих
организацию без инкремента.

### 7.2 Почему проверка в `JwtAuthGuard`, а не в каждом сервисе

Guard — единственная точка, через которую проходят все аутентифицированные
HTTP-запросы. Проверка в сервисах означала бы дублирование в каждом методе и
риск забыть новый. Guard также обновляет `request.user.orgId`, поэтому
существующие `toWorkflowAccess`-пути автоматически получают БД-организацию.
Сервисная граница `WorkflowService` добавлена дополнительно для прямых вызовов
(вторая граница), а не вместо guard'а.

### 7.3 Почему `ver` опционален для legacy-токенов

Обязательный `ver` при деплое инвалидировал бы все текущие сессии (массовый
разлогин). Так как устаревший `orgId` уже отклоняется сверкой с БД, риск от
legacy-токена без `ver` ограничен: он валиден только пока организация и версия
(0) совпадают, то есть для пользователя, который не переезжал и не был удалён.
После первого инкремента версии такой токен перестаёт работать. Это
компромисс «совместимость без потери главного вектора».

### 7.4 Почему `WorkflowService` резолвит организацию сам, если guard уже сделал это

Guard защищает HTTP, но `WorkflowService` — публичный сервис, который могут
вызвать внутренние сценарии/тесты. Передача `WorkflowAccess` из контроллера
оставляла возможность подложить пару `(userId, orgId)` в обход guard'а.
Сигнатура `createAsync(dto, userId)` делает такую ошибку невозможной, а
`resolveAccessAsync` — вторая граница (RULES 1.17). Цена — дополнительный
SELECT только на создание/импорт, а не на каждый запрос.

### 7.5 Почему интерсептор не делает свой SELECT

`request.user.orgId` уже сверен guard'ом с БД и обновлён. Второй SELECT в
интерсепторе дал бы тот же результат за дополнительный round-trip на каждый
мутирующий запрос. Задача допускала «использовать уже резолвленный» — это тот
случай. Если интерсептор когда-нибудь навесят без guard'а, `request.user` будет
undefined, и запись не создастся (как и раньше).

### 7.6 Почему маскируются только два действия

Постановка S5 назвала `member.invite` и `member.remove`. Расширение на все
действия могло бы сломать расследования (email — часть смысла записи «кто кого
пригласил», KI-589) и потребовало бы продуктовой политики. Поэтому маскировка
точечная, а `collaborator.invite` и прочие места вынесены в KI-616 с
предложением единой политики.

### 7.7 Почему для спеков сделан общий helper, а не отключение проверки в guard

Отключать проверку в тестах (флаг/`NODE_ENV`) — значит тестировать не тот код,
который работает в продакшене. Helper даёт настоящему guard'у настоящий SELECT
(через заглушку Drizzle), поэтому HTTP-спеки проверяют и DI, и ветки 401. Цена —
18 изменённых спеков; это механическая правка, зафиксированная в § 3.7.

### 7.8 Почему смоук — API, а не CDP

Все изменения S5 серверные (guard, транзакция удаления, write-пути, metadata
аудита); UI не менялся. API-смоук проверяет именно их: 401 старым токеном на
четырёх ручках, инкремент версии в БД, новый вход и маскировку email. CDP
проверял бы то же через браузер, но дороже; UI-сценарий TeamPage не затрагивался.

### 7.9 Почему отчёт выводится целиком

RULES 2.15/2.18: краткий отчёт скрывает детали. В S5 важны и остатки
(KI-614..616), и объяснение выбора `token_version` vs org-сверки, и цена
18 изменённых спеков. Полный отчёт сохранён в
`docs/development/reports/v1.1.0/S5-security.md` и выведен в чат целиком.
