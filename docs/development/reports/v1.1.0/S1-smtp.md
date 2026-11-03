---
title: "S1: SMTP и письма-приглашения (v1.1.0)"
date: 2026-11-03
version: v1.1.0
steps: [S1]
status: accepted
related_ki: [KI-584, KI-592, KI-593, KI-594, KI-595, KI-596, KI-597, KI-598]
related_adr: [0006]
---

# Отчёт S1 — SMTP и письма-приглашения (v1.1.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**121 passed (121 файл), 1776 passed / 2 skipped (1778)**, `pnpm --dir web
build` — exit 0, `pnpm --dir web test` — **53 passed (53 файла), 478 passed**,
`pnpm test:parity` — **13/13**, `pnpm test:e2e` — **1/1**, `pnpm lint` —
**0 errors / 2 warnings** (оба преэкзистующие,
`openai-images.provider.spec.ts`). Смоук на живом приложении — **18/18**:
без SMTP (WARN + `emailSent: false`), с mock-SMTP (письмо реально получено),
с недоступным SMTP (ERROR + `emailSent: false`, приглашение в БД).

**Точка старта.** HEAD `ce88a56` («docs: create DESIGN v1.1»), после релиза
v1.0.0, CI зелёный. Источник — `docs/development/v1.1/DESIGN_V110_FEATURES.md`
§ 3.1, правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** зависимость `nodemailer` (+ `@types/nodemailer`); `SmtpEnvSchema`
(`SMTP_HOST/PORT/USER/PASS/FROM/SECURE` + `APP_PUBLIC_URL`); новый
`src/email/` (`EmailService` best-effort, HTML+text шаблон, маскирование email
в логах, `EmailModule`); `OrgMembersService.inviteAsync` отправляет письмо после
создания приглашения; `POST /admin/members/invite` отдаёт `emailSent`
(`InviteMemberResponse` + паритет-гейт); UI различает «письмо отправлено» и
«создано, но письмо не отправлено». **Закрыто KI:** KI-584.
**Новые KI:** KI-592..598 (§ 6). ADR-0006.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/email/email.service.ts](../../../../src/email/email.service.ts) *(new)* | 212 | `EmailService`: `createTransport` по env, таймауты 10/10/20 с, `sendInvitationAsync(to, orgName, inviteLink): Promise<boolean>` (никогда не бросает), `buildInvitationLink`, `isConfigured`, WARN-фолбэк без `SMTP_HOST`, маскирование email в логах |
| [src/email/email.templates.ts](../../../../src/email/email.templates.ts) *(new)* | 158 | Чистые функции шаблона: `sanitizeHeaderValue` (CR/LF → пробел, header injection), `escapeHtml`, `buildInvitationSubject/Text/Html` (кнопка «Присоединиться», копирайт) |
| [src/email/email.module.ts](../../../../src/email/email.module.ts) *(new)* | 15 | `EmailModule`: provider + export `EmailService` (`ConfigModule` глобальный) |
| [src/email/email.service.spec.ts](../../../../src/email/email.service.spec.ts) *(new)* | 286 | 15 тестов: мок `nodemailer`, fallback без SMTP и с пустым `SMTP_HOST`, auth/timers/secure, отправка (subject/html/text), сбой SMTP, маскирование email, шаблоны (экранирование/санитизация) |
| [docs/development/adr/0006-smtp-invitations.md](../../adr/0006-smtp-invitations.md) *(new)* | 84 | ADR: опциональный SMTP, best-effort, `emailSent`, `APP_PUBLIC_URL`, шаблон как отдельный модуль, ограничения (KI-592..598) |

**Итого нового кода:** **4 файла / 671 строка** (production — 3 файла / 385,
тесты — 1 файл / 286). Артефакт смоука (gitignored):
`.smoke/v110-s1-smtp-smoke.mjs` — 654 строки, отчёт
`.smoke/v110-s1-smtp-smoke.json`, логи `.smoke/v110-s1-no-smtp.log`,
`.smoke/v110-s1-mock-smtp.log`.

### 1.2 Изменённые файлы — код и конфигурация

| Файл | +/− | Что |
|---|---:|---|
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +66/−0 | `SmtpEnvSchema` (+ `SmtpEnv` type): `SMTP_*`, `APP_PUBLIC_URL`; строгий `SMTP_SECURE` (RULES 4.35), пустые значения = «не заданы» (KI-084); влит в `EnvSchema` через `.shape` |
| [src/config/env.schema.spec.ts](../../../../src/config/env.schema.spec.ts) | +61/−0 | 4 теста: дефолты, строгий boolean, порт/диапазон, `APP_PUBLIC_URL` (http(s), пусто → дефолт) |
| [src/organizations/dto/member.dto.ts](../../../../src/organizations/dto/member.dto.ts) | +26/−0 | `InviteMemberResponse` — приглашение + `emailSent` (плоский интерфейс: гейт не разворачивает `extends`) |
| [src/organizations/org-members.service.ts](../../../../src/organizations/org-members.service.ts) | +47/−14 | `EmailService` в конструкторе; `resolveActorAsync` (org id + name через `innerJoin`); после INSERT — `sendInvitationAsync` + `buildInvitationLink`; ответ с `emailSent` |
| [src/organizations/org-members.service.spec.ts](../../../../src/organizations/org-members.service.spec.ts) | +65/−5 | Заглушка `EmailService`, `innerJoin` в цепочке Drizzle, проверки вызова письма/ссылки, `emailSent:false`, «письмо не уходит при 409/401» |
| [src/organizations/org-members.controller.ts](../../../../src/organizations/org-members.controller.ts) | +6/−4 | Тип ответа `InviteMemberResponse`, JSDoc про best-effort письмо |
| [src/organizations/org-members.controller.spec.ts](../../../../src/organizations/org-members.controller.spec.ts) | +7/−3 | `InviteMemberResponse` с `emailSent`, проверка проброса поля в теле 201 |
| [src/organizations/org-members.module.ts](../../../../src/organizations/org-members.module.ts) | +4/−2 | `imports: [AuthModule, AuditModule, EmailModule]` |
| [src/runs/dto/api-contract.spec.ts](../../../../src/runs/dto/api-contract.spec.ts) | +9/−0 | `InviteMemberResponse` в `DTO_SOURCES` |
| [web/src/lib/org-api.ts](../../../../web/src/lib/org-api.ts) | +22/−6 | `InviteMemberResponseSchema` (`.extend({ emailSent })`), `inviteMemberAsync` возвращает его |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +22/−0 | Зеркало `InviteMemberResponse` + тест «emailSent в контракте» |
| [web/src/components/TeamPage.tsx](../../../../web/src/components/TeamPage.tsx) | +13/−4 | Разные сообщения при `emailSent: true/false` |
| [web/src/components/TeamPage.spec.tsx](../../../../web/src/components/TeamPage.spec.tsx) | +46/−2 | Фикстура `INVITE_RESPONSE`, тест «письмо не отправлено» (новый ключ i18n) |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +1/−0 | `team.invite.success_no_email` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +1/−0 | То же для EN (паритет ключей) |
| [.env.example](../../../../.env.example) | +14/−0 | Блок SMTP: переменные, дефолты, строгий `SMTP_SECURE`, `APP_PUBLIC_URL` |
| [package.json](../../../../package.json) | +2/−0 | `nodemailer ^10.3.1`, `@types/nodemailer ^8.0.2` |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | +19/−0 | Lockfile зависимостей |

**Итого по изменённым:** **18 файлов, +431 / −40**. **Всего по коду:**
**+1102 / −40** (671 новый + 431 изменённый).

### 1.3 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +39/−0 | `[Unreleased]`: Added (S1), Changed (`InviteMemberResponse`), Fixed (KI-584), Documented (ограничения KI-592..598) |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +120/−56 | KI-584 → Fixed + Fix-абзац; раздел S1 (KI-592..598); сводка 585; удалены 9 дублирующих блоков KI-583..591 (дефект HEAD) |
| [docs/development/api-contract.json](../../api-contract.json) | +1/−0 | Ответ `InviteMemberResponse` — `emailSent` в контракте |
| [docs/development/reports/README.md](../README.md) | +1/−0 | Строка S1 в реестре отчётов |
| [README.md](../../../../README.md) | +14/−8 | Раздел «Организации и команда»: SMTP, env-переменные, `emailSent`, поведение без SMTP |
| [docs/development/adr/0006-smtp-invitations.md](../../adr/0006-smtp-invitations.md) *(new)* | 84 | ADR-0006 |
| этот отчёт *(new)* | — | 7 разделов по RULES 2.15/2.18 |

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **121 passed (121 файл), 1776 passed / 2 skipped (1778)**, 30.1 с |
| `pnpm test:parity` | **13/13** (схема БД в S1 не менялась) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с `EmailModule`/`OrgMembersModule`) |
| `pnpm --dir web build` | **exit 0** (`tsc -b` + `vite build`, 317 мс) |
| `pnpm --dir web test` | **53 passed (53 файла), 478 passed**, 20.8 с |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |

Прирост к HEAD v1.0.0: root **+1 тест-файл, +20 тестов** (120→121 файл,
1756→1776 passed, skipped 2→2); web **+2 теста** (476→478). Новая миграция не
нужна — S1 не меняет схему БД (`drizzle/` без изменений).

---

## 3. Диагностика

### 3.1 Смоук поймал реальный баг: пустой `SMTP_HOST` считался настроенным

`validateEnv` возвращает `{ ...config, ...parsed }`: пустая строка из `.env`
(KI-084) остаётся в исходном `config`, даже если Zod-схема превратила её в
`undefined`. Первая версия `EmailService` проверяла только
`host === undefined`, поэтому при `SMTP_HOST=` создавался транспорт, и
nodemailer шёл на `localhost:587` (первый прогон смоука: `ERROR
[EmailService] connect ECONNREFUSED 127.0.0.1:587` вместо WARN). Исправление —
`readOptionalString`: пустая/пробельная строка = «не задано»; то же применено к
`SMTP_USER/PASS/FROM` и `APP_PUBLIC_URL`, иначе `from`/ссылка были бы пустыми.
Добавлены 3 unit-теста, включая `SMTP_HOST: ''`; повторный смоук — WARN и
`emailSent: false` (18/18).

### 3.2 `nodemailer` — CJS без bundled-типов; ESM-импорт проверен

Пакет 10.3.1 не отдаёт декларации типов, `@types/nodemailer` — отдельный пакет
(8.0.2, отстаёт на два мажора — KI-598). Импорт `import { createTransport }
from 'nodemailer'` в ESM-проекте (`module: nodenext`) проверен на живом
Node: Node's cjs-module-lexer распознаёт именованный экспорт, `typeof
createTransport === 'function'`. Альтернатива `import * as nodemailer` тоже
работает, но оставлен именованный импорт — он читается лучше и совпадает с
`@types`.

### 3.3 `SMTP_SECURE`: строгий boolean, а не `z.coerce.boolean()`

RULES 4.35 прямо запрещает `z.coerce.boolean()`: строка `'false'` стала бы
`true`, и письмо ушло бы по implicit-TLS на порт 587. Схема использует
`z.union([z.boolean(), z.enum(['true','false'])])` + `transform`, как
`TRUST_PROXY`/`SANDBOX_ENABLED`; `''` → дефолт `false`. Тесты проверяют
`'true'/'false'/boolean/'yes'/'1'/''` и отсутствие регресса
(`'false'` не становится `true`).

### 3.4 Транспорт создаётся один раз и уважает «нет auth»

`createTransport` вызывается в конструкторе (nodemailer держит пул соединений),
а не на каждое письмо. `auth` передаётся только когда заданы И `SMTP_USER`, И
`SMTP_PASS`: локальный mock-SMTP в смоуке не получает пустые креды, а
провайдеры без аутентификации не отваливаются на `AUTH`. Таймауты
(`connectionTimeout` 10 с, `greetingTimeout` 10 с, `socketTimeout` 20 с)
ограничивают синхронную отправку (KI-592).

### 3.5 Best-effort: письмо не может сломать приглашение

`EmailService.sendInvitationAsync` ловит любую ошибку транспорта и возвращает
`false` (ERROR в лог, без исключения); `OrgMembersService.inviteAsync` не
оборачивает вызов в try/catch и всегда возвращает приглашение с `emailSent`.
Приглашение — строка БД, письмо — уведомление: 201 сохраняется при
ненастроенном, недоступном и «сломанном» SMTP (DESIGN V110 § 3.1).

### 3.6 Строки шаблона и PII в логах

Тема письма — «Приглашение в организацию {orgName}», имя организации
санитизируется (`sanitizeHeaderValue`: CR/LF и управляющие коды → пробел,
защита от header injection) и экранируется в HTML (`escapeHtml`). Email
приглашённого в логах маскируется (`a***@example.com`, RULES 5.9), пароль
SMTP не попадает в лог даже в тексте ошибки (RULES 5.3); в лог пишутся только
факт отправки и причина отказа. HTML+text части — антиспам-фильтры и клиенты
без HTML.

### 3.7 Контракт: `emailSent` — отдельный DTO, а не «расширение»

`InviteMemberResponse` = поля приглашения + `emailSent`; группа
`OrganizationInvitationSummary` (список) не меняется, потому что статуса письма
в БД нет (KI-597). Добавление прошло все три точки гейта: JSON-контракт,
backend-spec (`DTO_SOURCES`, TS-интерфейс) и web-зеркало
(`InviteMemberResponseSchema` через `.extend`); иначе падает паритет-тест.
Интерфейс объявлен «плоским»: backend-гейт не разворачивает `extends`.

### 3.8 `APP_PUBLIC_URL`: новая env, а не `Host` из запроса

Backend исторически не знает публичный домен (share-ссылки относительные,
`ShareTokenDto.shareUrl`), а письму нужен абсолютный URL. Брать `Host` из
запроса нельзя — host-header injection; поэтому база задаётся явно
(`APP_PUBLIC_URL`, default `http://localhost:3000`, где приложение раздаёт SPA и
API), а ссылка собирается как `${base}/login?invite=<uuid приглашения>`.
Идентификатор непрозрачен и не содержит email; параметр пока информационный
(KI-594).

### 3.9 Смоук: mock-SMTP, MIME и QP

Mock-сервер написан на `node:net` без зависимостей: EHLO (multi-line),
MAIL FROM/RCPT TO, DATA с dot-unstuffing, QUIT; письмо складывается в массив.
По ходу исправлены три ошибки самого смоука (не продукта): (1) тема кодируется
не base64, а Q-encoding и разбивается на encoded-words по 75 символов —
понадобился декодер B+Q и правило RFC 2047 «пробелы между соседними
encoded-words игнорируются» (иначе «Пригла шание»); (2) folded-заголовки нужно
разворачивать; (3) в quoted-printable `=` кодируется как `=3D`, поэтому ссылку
проверяем на декодированном теле (`/login?invite=3D<uuid>` → `/login?invite=<uuid>`).
Сам продукт был корректен: письмо принято, тема/получатель/отправитель/ссылка
на месте.

### 3.10 Реестр KI: дублирующие блоки на HEAD

На HEAD `docs/KNOWN_ISSUES.md` содержал **9 кратких дублирующих блоков**
KI-583..591 (587 заголовков при 578 уникальных номерах), из-за чего сводка
569/578 расходилась с grep. Дубли удалены (RULES 3.20), реестр пересчитан:
после закрытия KI-584 и заведения KI-592..598 — **585 записей, 585 статусов,
номера уникальны, сумма по статусам = 585**. Причина повтора зафиксирована:
доки-шаг после релиза снова добавляет краткие копии уже подробных KI — процесс
нужно поправить (кандидат на KI при следующем docs-проходе).

### 3.11 UI: честное сообщение вместо «письмо отправлено»

`TeamPage` при `emailSent: true` показывает «Приглашение отправлено: {email}»,
при `false` — новый ключ `team.invite.success_no_email` («создано, но письмо не
отправлено: SMTP не настроен или недоступен»). Ключ добавлен в оба языка
(паритет проверяется `i18n.spec.ts`), форма закрывается, список
перезапрашивается в обоих случаях — приглашение реально появилось в
«Ожидают регистрации».

### 3.12 Синхронная отправка и таймауты

`inviteAsync` ждёт `sendInvitationAsync` (outbox/очереди в S1 не вводились по
постановке): запрос владельца включает время SMTP-диалога. Компенсация —
таймауты и ранний WARN без конфигурации; цена и варианты вынесены в KI-592
(BullMQ уже есть в проекте). `emailSent: true` означает «SMTP принял письмо»,
а не «доставлено» — асинхронные баунсы провайдера продукту не видны (KI-597).

---

## 4. Smoke (живое приложение)

Окружение: PostgreSQL 17 `127.0.0.1:5433/workflow_builder`, backend —
`node dist/main.js` (порт 3000), mock-SMTP — `node:net` на `127.0.0.1:2525`.
Скрипт: `.smoke/v110-s1-smtp-smoke.mjs` (3 сценария, 2 запуска приложения).

### 4.1 Без SMTP (`SMTP_HOST=` пустой)

| Проверка | Факт |
|---|---|
| `POST /admin/members/invite` → 201 | `{ email, role, invitedBy, invitedAt, emailSent: false }` |
| Письмо не отправлено | `emailSent: false`; приглашение видно в `GET /admin/members` → `invitations` |
| WARN в логе | `WARN [EmailService] SMTP не настроен (SMTP_HOST не задан): приглашение для s***@example.com создано, но письмо не отправлено` |
| PII в логе | полного email приглашённого нет (только маска) |

### 4.2 С mock-SMTP (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=2525`, `SMTP_FROM=invites@example.test`)

| Проверка | Факт |
|---|---|
| `POST /admin/members/invite` → 201, `emailSent: true` | приглашение + `emailSent: true` |
| Письмо получено mock-сервером | 6451 байт, реальный SMTP-диалог |
| Тема | `Приглашение в организацию Personal Workspace - smoke-s6-smtp-…@example.com` |
| Получатель/отправитель | `To: smoke-s6-smtp-invitee-…@example.com`, `From: invites@example.test` |
| Ссылка | `/login?invite=62956a0f-0844-4408-8e21-d444fee686ed` |
| Логи | `LOG [EmailService] Письмо-приглашение отправлено: s***@example.com (…)` |

### 4.3 SMTP настроен, но недоступен (сервер закрыт)

| Проверка | Факт |
|---|---|
| `POST /admin/members/invite` → 201 | приглашение создано, `emailSent: false` |
| ERROR в логе | `ERROR [EmailService] Не удалось отправить письмо-приглашение (s***@example.com): connect ECONNREFUSED 127.0.0.1:2525` |
| Уборка | удалено 2 организации (каскад: пользователи, приглашения, аудит) |

### 4.4 Состояние БД после смоука

**users=69, orgs=69, organization_invitations=0, audit_logs=0** — как до S1
(в S1 схема БД не менялась). Серверы остановлены до финальных гейтов
(RULES 3.14); в `.smoke/` остались логи и JSON-отчёт прогона.

---

## 5. Что не так

1. **Отправка синхронна**: SMTP-задержка входит в latency `POST
   /admin/members/invite` (до таймаутов 10/20 с), серия приглашений —
   последовательная; очереди/outbox нет (KI-592).
2. **Нет ретраев и статуса доставки**: при временном сбое письмо теряется,
   `emailSent: false` виден только в ответе; повторить отправку ручки нет, а
   повторный инвайт того же email → 409 (KI-593).
3. **`emailSent: true` ≠ «доставлено»**: это «SMTP принял»; асинхронные баунсы
   провайдера продукту не видны, статус в БД не пишется (KI-597).
4. **Ссылка `?invite=<uuid>` не используется UI**: `LoginPage` параметр не
   читает, регистрация по-прежнему «сжигает» приглашение по email; переход по
   ссылке не предзаполняет email и не переключает форму (KI-594).
5. **Шаблон только русский** (DESIGN V110 § 6): у пользователя нет locale,
   EN-участник получит русское письмо (KI-595).
6. **Нет отдельного rate limit** на приглашения: только общий throttler
   300/мин на IP; owner/admin может использовать домен продукта для спама,
   SMTP-провайдеры за это блокируют (KI-596).
7. **Версии `nodemailer` 10.3.1 и `@types/nodemailer` 8.0.2 различаются
   мажорно**: типы отстают, будущий breaking change может не отловиться
   сборкой (KI-598).
8. **Первый прогон смоука нашёл баг пустого `SMTP_HOST`** (см. § 3.1):
   продукт пытался отправлять на `localhost:587` вместо WARN. Исправлено,
   покрыто unit-тестом; второй прогон — 18/18. Это подтверждает ценность
   смоука на живом приложении: unit-тесты с мок-конфигом такого не видели.
9. **Ошибки отправки не аудируются**: `member.invite` пишется интерсептором при
   успешном POST, а неудачная отправка письма (ERROR) в журнал аудита не
   попадает — только в технический лог (связано с KI-593/569).
10. **`emailSent` в списке приглашений отсутствует** (KI-597): после F5
    владелец не видит, отправлено ли письмо; `OrganizationInvitationSummary` не
    расширялся осознанно (нет колонки в БД, миграция — вне S1).
11. **Реестр KI снова содержал дубли** (587 заголовков / 578 уникальных):
    исправлено (§ 3.10), но процесс docs-шага, который их создаёт, не
    изменён — риск повтора в следующих релизах.
12. **Prettier на HEAD не чист, `oxlint` — 2 преэкзистующих warning'а**:
    массового переформатирования не делали (как и в прошлых сессиях; гейты —
    `oxlint` и `tsc`).
13. **Смоук-скрипт содержит собственный MIME-декодер** (Q/B, folded-заголовки,
    QP): это тест-код, а не библиотека. При росте числа сценариев письма
    (шаблоны EN/RU) его стоит вынести в `nodemailer`-совместимый парсер или
    переиспользовать `mailparser` (новых зависимостей ради смоука не вводили).

---

## 6. Новые KI

Всего **7**: KI-592..598 (реестр пересчитан grep'ом, RULES 3.20: **585**
записей, 585 статусов, номера уникальны).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-592](../../../KNOWN_ISSUES.md) | 🟡 Medium | Open | Отправка письма синхронна: SMTP-задержка входит в HTTP-запрос |
| [KI-593](../../../KNOWN_ISSUES.md) | 🟡 Medium | Documented | Нет ретраев и статуса доставки письма |
| [KI-594](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Параметр `?invite=<uuid>` не используется UI |
| [KI-595](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Шаблон письма только на русском |
| [KI-596](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Нет отдельного rate limit на отправку приглашений |
| [KI-597](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `emailSent` не хранится в БД, статус письма не виден после F5 |
| [KI-598](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `nodemailer` 10.3.1 и `@types/nodemailer` 8.0.2 — мажорное расхождение |

**Закрытые KI:** KI-584 (Fixed — письма отправляются через SMTP; fallback с
WARN и `emailSent: false` сохранён).

Сводка реестра: **246 Fixed + 2 Fixed(частично) + 285 Open + 41 Documented +
1 Documented(не воспроизводится) + 4 Planned + 2 Deferred + 4 Won't Fix =
585**. Обновлены `docs/CHANGELOG.md` (Added/Changed/Fixed/Documented),
`docs/KNOWN_ISSUES.md` (KI-584 Fixed + раздел S1 + сводка + удаление дублей),
`docs/development/api-contract.json`, `README.md`, `.env.example`,
`reports/README.md`, ADR-0006.

---

## 7. Обоснование решений

### 7.1 Почему SMTP опционален, а письмо — best-effort

Приглашение — это строка `organization_invitations`, письмо — уведомление.
Если сделать SMTP обязательным, любая инсталляция без почты теряет командную
работу (а она работает через «сжигание» приглашения при регистрации), а
недоступность внешнего провайдера превращала бы успешный инвайт в 500. DESIGN
V110 § 3.1 прямо требует fallback: WARN + приглашение в БД. Поэтому
`EmailService` возвращает `boolean`, никогда не бросает, а `emailSent` в ответе
честно сообщает клиенту, что письмо не ушло.

### 7.2 Почему `emailSent` — отдельный DTO, а не поле в списке приглашений

Список (`GET /admin/members`) строится из строк `organization_invitations`, где
статуса отправки нет. Если добавить `emailSent` в `OrganizationInvitationSummary`,
пришлось бы либо врать (`true` для всех), либо тянуть статус из ниоткуда. Поэтому
он появляется только в ответе на инвайт — единственном месте, где результат
отправки известен; расширение списка потребует колонок в БД (KI-597) и
миграции, что вне S1.

### 7.3 Почему `APP_PUBLIC_URL`, а не `Host`/`Origin` запроса

Письму нужен абсолютный URL, а backend намеренно не знает публичный домен
(share-ссылки относительные). Собирать URL из `Host` — классический
host-header injection (письмо с вредоносной ссылкой уйдёт от имени продукта) и
ломается за reverse proxy. Явная env с безопасным дефолтом даёт
предсказуемость и настраивается под прод; цена — одна дополнительная
переменная в `.env.example`.

### 7.4 Почему ссылка по uuid приглашения, а не по email

Email — PII: он попал бы в URL, логи прокси/браузера и Referer. `id`
приглашения непрозрачен, уникален и не раскрывает адрес; он же позволит в
следующих срезах превратить ссылку в capability (проверка существования/
истечения, предзаполнение email — KI-594). Сейчас параметр информационный: вход
всё равно идёт на `/login`, а регистрация «сжигает» приглашение по email — так
работает S5-механика.

### 7.5 Почему `SMTP_SECURE` — строгий union, а не `z.coerce.boolean()`

`z.coerce.boolean()` возвращает `true` для любой непустой строки, включая
`'false'`: флаг молча включал бы implicit TLS на порту 587, и письма не уходили
бы без понятной причины (класс KI-084/RULES 4.35). Union `boolean |
'enum(true,false)'` + transform даёт однозначный разбор, а тест фиксирует
негативный кейс (`'false'` остаётся `false`).

### 7.6 Почему шаблон — отдельный модуль чистых функций

`email.templates.ts` не знает про транспорт и `ConfigService`: тема, HTML и
text собираются из `orgName`/`inviteLink`, поэтому экранирование, санитизация
заголовка и структура шаблона тестируются без SMTP (и без сети). Это же место
расширять под EN/RU, когда появится locale (KI-595). HTML+text обе части —
требование доставляемости: письмо только с HTML чаще попадает в спам.

### 7.7 Почему `nodemailer`, а не провайдерский SDK/HTTP API

Постановка S1 прямо требует `nodemailer`; он одинаково работает с любым
SMTP-провайдером (SendGrid/SES/Postmark/Yandex/Mail.ru) без привязки к
вендору, поддерживает TLS/STARTTLS и таймауты. Провайдерские API (SES/SendGrid
SDK) дали бы лучший статус доставки/баунсы, но это отдельный срез (KI-593/597)
и новая зависимость; для v1.1.0 достаточно стандартного SMTP + честного
`emailSent`.

### 7.8 Почему таймауты именно 10/10/20 секунд

`connectionTimeout`/`greetingTimeout` 10 с отсекают зависший SMTP раньше, чем
пользователь решит, что интерфейс сломался; `socketTimeout` 20 с допускает
медленную передачу небольшого письма (~6 КБ). Синхронность — известная цена
(KI-592), но при выносе в очередь таймауты останутся теми же уже для воркера.
Без них недоступный SMTP держал бы запрос дефолтные 2 минуты nodemailer.

### 7.9 Почему менять контракт `InviteMemberResponse` безопасно

Поле аддитивное: старые клиенты, не знающие `emailSent`, продолжают работать
(лишнее поле игнорируется), а web-зеркало обновлено в том же коммите, и
паритет-гейт (`api-contract.json` ↔ backend-spec ↔ web-зеркало) не даст
сторонам разойтись. Изменение видно в CHANGELOG в секции `Changed`, а не
`Added`, потому что это расширение существующего ответа.

### 7.10 Почему логи маскируют email, а не пишут целиком

Лог приглашения — технический, полный адрес в нём не нужен ни для отладки
отправки, ни для поддержки, зато это PII (RULES 5.9). Маска
`a***@example.com` позволяет сопоставить запись с приглашением, но не
раскрывает адресную базу при доступе к логам/экспорту. Ошибка провайдера
логируется текстом без пароля и без полного адреса.

### 7.11 Почему отправка идёт после INSERT, а не в транзакции

Письмо — внешний побочный эффект, который нельзя откатить транзакцией БД
(отправленное письмо не «вернёшь»). Если отправлять до INSERT и письмо уйдёт, а
INSERT упадёт, приглашённый получит ссылку, которая никуда не ведёт. Порядок
«сначала приглашение (единственная точка правды), затем письмо» даёт
консистентность: при любом сбое письма приглашение остаётся валидным, а
`emailSent: false` сигнализирует о проблеме.

### 7.12 Почему смоук — три сценария, а не один

Каждый сценарий проверяет свою ветку контракта: без SMTP — WARN + fallback
(главное требование постановки); с mock-SMTP — реальный SMTP-диалог и шаблон
(unit-тесты мокают nodemailer и не видят MIME); с недоступным SMTP — ветку
ошибки отправки и сохранение приглашения. Разделение дало независимую
диагностику: баг пустого `SMTP_HOST` проявился именно в первом сценарии, а
MQ-ошибки декодирования — только во втором, и не «зашумляли» третий.
