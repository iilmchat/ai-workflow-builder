---
title: "S2: SMTP Retry — очередь писем-приглашений (v1.2.0)"
date: 2026-11-06
version: v1.2.0
steps: [S2]
status: accepted
related_ki: [KI-622, KI-623, KI-624, KI-625]
related_adr: [0012]
---

# Отчёт S2 — SMTP Retry (v1.2.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**127 passed (127 файлов), 1891 passed / 2 skipped (1893)**, `pnpm test:parity` —
**13/13**, `pnpm test:e2e` — **1/1**, `pnpm lint` — **0 errors / 2 warnings**
(оба преэкзистующие, `openai-images.provider.spec.ts`). Смоук на живом
приложении — **18/18**: приглашение отвечает за 23 мс, job в очереди с
`attempts: 3`, первый SMTP-ответ 451 → повтор через 5 с → 250; при трёх
отказах job уходит в `failed`, приглашение остаётся в БД.

**Точка старта.** HEAD `fa06d7d` («feat(v1.2.0): S1 — LLM Router +
Healthcheck»), CI зелёный. Источник — DESIGN V120 § 3.3, правила —
`docs/development/RULES.md` v1.10.0. На входе в `docs/KNOWN_ISSUES.md` снова
были краткие дубли KI-617..621 (613 заголовков при 608 уникальных) — удалены,
подробные записи оставлены (§ 3.9).

**Сделано:** очередь BullMQ `email-invitations` (`attempts: 3`, exponential
backoff 5000, `removeOnComplete`/`removeOnFail`); `EmailService.queueInvitationAsync`
(постановка job) + `EmailProcessor` (`@Processor`, `WorkerHost`, Zod-валидация
payload, `UnrecoverableError`); `OrgMembersService.inviteAsync` больше не ждёт
SMTP и возвращает `emailSent: false`; контракт `InviteMemberResponse` сохранён.
**Новые KI:** KI-622..625 (§ 6). ADR-0012.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/email/email.queue.ts](../../../../src/email/email.queue.ts) *(new)* | 105 | Имя очереди/job, `EmailInvitationJobSchema` (Zod), `EMAIL_INVITATION_JOB_OPTIONS`, `createEmailQueueOptions` |
| [src/email/email.processor.ts](../../../../src/email/email.processor.ts) *(new)* | 97 | `@Processor('email-invitations')`, `WorkerHost`: Zod → `sendInvitationAsync` → throw при `false` |
| [src/email/email.queue.spec.ts](../../../../src/email/email.queue.spec.ts) *(new)* | 166 | 7 тестов: постановка job, опции, ошибка Redis, схема payload |
| [src/email/email.processor.spec.ts](../../../../src/email/email.processor.spec.ts) *(new)* | 113 | 5 тестов: вызов сервиса, `false` → throw, исключение, битый payload |
| Этот отчёт *(new)* | — | 7 разделов по RULES 2.15/2.18 |

**Итого нового production-кода:** 202 строки (2 файла).
**Итого новых тестов:** 279 строк (2 файла).

Артефакты смоука (gitignored, `.smoke/`): `v120-s2-mock-smtp.mjs` — 225 строк
(SMTP + control HTTP), `v120-s2-smtp-smoke.mjs` — 425, `.json` — 140,
backend-лог — 117.

### 1.2 Изменённые файлы — production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/email/email.service.ts](../../../../src/email/email.service.ts) | +81/−12 | Инъекция `Queue`, `queueInvitationAsync`; `sendInvitationAsync` — отправка для воркера; логи без `orgName` |
| [src/email/email.module.ts](../../../../src/email/email.module.ts) | +22/−2 | `BullModule.registerQueueAsync`, провайдер `EmailProcessor` |
| [src/organizations/org-members.service.ts](../../../../src/organizations/org-members.service.ts) | +16/−11 | `queueInvitationAsync` вместо `sendInvitationAsync`; `emailSent: false`; JSDoc |
| [src/organizations/dto/member.dto.ts](../../../../src/organizations/dto/member.dto.ts) | +12/−7 | JSDoc `emailSent`: всегда `false` с S2 (KI-622) |
| [src/organizations/org-members.controller.ts](../../../../src/organizations/org-members.controller.ts) | +6/−4 | JSDoc: 201 — приглашение создано, письмо асинхронно |

**Итого по production:** **+137 / −36** (без нового кода).

### 1.3 Изменённые файлы — тесты

| Файл | +/− | Что |
|---|---:|---|
| [src/email/email.service.spec.ts](../../../../src/email/email.service.spec.ts) | +29/−11 | Заглушка `Queue` в конструкторе; хелпер `createService` |
| [src/organizations/org-members.service.spec.ts](../../../../src/organizations/org-members.service.spec.ts) | +18/−16 | `queueInvitationAsync` вместо `sendInvitationAsync`; `emailSent: false`; тест ошибки очереди |
| [src/organizations/org-members.controller.spec.ts](../../../../src/organizations/org-members.controller.spec.ts) | +5/−5 | Фикстура `emailSent: false`, проверка ответа |

**Итого по тестам:** **+331 / −32** (включая 279 строк новых спеков).

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +17/−0 | `[Unreleased] → Added`: S2, ссылка на отчёт, KI-593 частично, ограничения KI-622..625 |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +79/−37 | Новые KI-622..625; KI-593 → Fixed (частично); удалены краткие дубли KI-617..621; сводка 612 |
| [docs/development/adr/0012-email-invitations-queue.md](../../adr/0012-email-invitations-queue.md) *(new)* | 74 | ADR-0012: очередь, payload, retry, контракт `emailSent` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | Строка v1.2.0 S2 |
| Этот отчёт *(new)* | — | 7 разделов |

Новых env-переменных нет: очередь использует существующие `REDIS_URL`,
`BULLMQ_PREFIX`, `REDIS_QUEUE_DB`; SMTP — прежние `SMTP_*`.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **127 passed (127 файлов), 1891 passed / 2 skipped (1893)**, 30.5 с |
| `pnpm test:parity` | **13/13** |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с воркером email) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |
| Смоук (живое приложение) | **18/18 PASS**, 0 FAIL |

Прирост к HEAD (S1, 125 файлов / 1879 passed): root **+2 файла, +12 тестов**
(1879→1891; 125→127). Раскладка: `email.queue.spec` +7,
`email.processor.spec` +5. Скипнутые 2 теста — прежние
`openai-images.integration` (нет ключа Images, `skipIf`). Миграций нет:
очередь и payload — рантайм-состояние, схема БД не менялась.

---

## 3. Диагностика

### 3.1 Почему BullMQ-очередь, а не outbox-таблица

DESIGN § 3.3 прямо называет BullMQ. Инфраструктура уже есть: `BullModule.forRootAsync`
в `AppModule`, Redis, изоляция инстансов через `BULLMQ_PREFIX`/`REDIS_QUEUE_DB`
(KI-387). Outbox-таблица потребовала бы миграции, cron/поллера и нового
состояния в БД — это больше кода и ещё один источник истины. Очередь даёт
retry/backoff/`failed`-состояние «из коробки» и не трогает схему.
Ограничение: payload хранится в Redis, а не в БД (KI-623).

### 3.2 Почему `queueInvitationAsync` и `sendInvitationAsync` — разные методы

В постановке была развилка: «`sendInvitationAsync` больше не отправляет, а
ставит в очередь» и одновременно «`EmailProcessor` вызывает
`sendInvitationAsync` (старый метод, который реально отправляет)». Совместить
это в одном методе нельзя: воркер вызвал бы сам себя и поставил бы новую job.

Решение: **два метода с явными именами**:
- `queueInvitationAsync(to, orgName, inviteLink): Promise<boolean>` — продюсер,
  делает `queue.add` и возвращает «поставлено/нет»;
- `sendInvitationAsync(to, orgName, inviteLink): Promise<boolean>` — прежний
  метод, реальный SMTP-вызов, вызывается только `EmailProcessor`.
Контракт `sendInvitationAsync` («никогда не бросает») сохранён — на нём
держатся его тесты и логика fallback; `false` превращает в исключение уже
воркер.

### 3.3 Почему `false` от сервиса превращается в `throw`

BullMQ считает job успешным, если `process()` завершился без исключения.
`sendInvitationAsync` по контракту возвращает `false` при сбое SMTP и не
бросает. Если бы процессор просто вернул `false`, job попал бы в `completed`,
и письмо потерялось бы без повторов. Поэтому в `EmailProcessor`:

```
const sent = await sendInvitationAsync(...);
if (!sent) throw new Error('SMTP не принял письмо-приглашение');
```

Это единственная точка, где «мягкий» контракт сервиса преобразуется в retry
BullMQ. Тест `false → throw` фиксирует поведение.

### 3.4 Почему опции задания заданы дважды

`EMAIL_INVITATION_JOB_OPTIONS` указаны и в `defaultJobOptions` очереди, и в
`queue.add`. Первое нужно, чтобы задания, поставленные другим кодом/вручную,
тоже получили retry; второе — чтобы поведение не зависело от того, как
зарегистрирована очередь (и было видно в тесте/смоуке). BullMQ мержит
per-job опции поверх default, конфликта нет.

### 3.5 Почему payload — снимок, а не id приглашения

Job может выполниться после рестарта backend'а, когда строка приглашения уже
не нужна для формирования письма. Снимок `{ to, orgName, inviteLink }`:
- не требует от воркера доступа к БД и `APP_PUBLIC_URL`;
- переживает рестарт в Redis;
- позволяет валидировать данные Zod'ом на границе (RULES 1.17).

Минус — PII и ссылка-приглашение лежат в Redis (KI-623). Воркер не логирует
email/orgName; `EmailService` маскирует email и больше не пишет `orgName` в
лог (у личной организации он содержит email владельца).

### 3.6 Почему `emailSent` всегда `false`, а не `emailQueued`

Постановка допускала `emailQueued`, но рекомендовала не менять контракт:
`InviteMemberResponse` проверяется backend- и web-гейтами
(`api-contract.spec.ts`), а UI уже читает `emailSent`. Поэтому поле оставлено,
но с S2 оно означает «письмо ещё не доставлено синхронно» и всегда `false`.
Это осознанная деградация смысла: API не отличает «в очереди» от «не
поставлено», UI показывает «письмо не отправлено» — KI-622. Добавление
`emailQueued`/`emailStatus` вынесено в S3 (UI & Docs), чтобы не ломать
контракт внутри S2.

### 3.7 Почему `orgName` убран из логов

Личная организация называется `Personal Workspace - <email>`; строка
`orgName` в логе — это PII (RULES 5.9). В v1.1.0 S1 `sendInvitationAsync` писал
`(${orgName})`; в S2 добавление второго лога (постановка в очередь) удвоило бы
утечку. Оба сообщения теперь содержат только маскированный email; `orgName`
остаётся в payload (нужен для письма) и в БД.

### 3.8 Почему очередь использует общий prefix/db с workflow-runs

`BULLMQ_PREFIX`/`REDIS_QUEUE_DB` — механизм изоляции инстансов (KI-387):
dev/smoke/prod на одном Redis не должны забирать чужие задания. Для email
очереди он нужен по той же причине: smoke-письмо не должно уйти воркеру
dev-инстанса. `createEmailQueueOptions` читает те же переменные, а дефолты
(`workflow-runs`, `0`) совпадают с env-схемой.

### 3.9 Реестр KI: снова краткие дубли

На HEAD `fa06d7d` в `docs/KNOWN_ISSUES.md` было **613** заголовков `### KI-`
при 608 уникальных номерах: после docs-шага S1 снова появились краткие копии
KI-617..621 (полные записи уже были). Дубли удалены, подробные оставлены.
Пересчёт grep'ом: 608/608 до S2, после добавления KI-622..625 — **612**
записей, 612 статусов, номера уникальны. Сводка пересобрана по факту, а не по
памяти (RULES 3.20).

### 3.10 Смоук: MIME пришлось декодировать

Mock SMTP получает письмо от nodemailer как `multipart/alternative`:
text-часть — base64, HTML — quoted-printable. Проверять сырую строку на
`/login?invite=` нельзя: в quoted-printable `=` кодируется как `=3D`, а
base64-текст содержит переносы. Поэтому smoke декодирует text/plain-часть
(`decodeTextPart`) и проверяет ссылку/имя организации уже в UTF-8. Это
диагностическая деталь, а не баг продукта.

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder` (миграции
применены), Redis `127.0.0.1:6379`, backend — `node dist/main.js` на **3100**,
mock SMTP — `127.0.0.1:2525`, control HTTP — `127.0.0.1:3096`.
Env смоука: `SMTP_HOST=127.0.0.1`, `SMTP_PORT=2525`, `SMTP_SECURE=false`,
`SMTP_FROM=smoke@example.test`, `BULLMQ_PREFIX=smoke-v120-s2`,
`APP_PUBLIC_URL=http://127.0.0.1:3100`. Скрипт
`.smoke/v120-s2-smtp-smoke.mjs`; итог **18/18 PASS, 0 FAIL**,
`generatedAt = 2026-11-06T00:16:01.220Z`.

### 4.1 HTTP не ждёт SMTP

| Проверка | Факт |
|---|---|
| `POST /admin/members/invite` | 201 за **23 мс** |
| `emailSent` в ответе | `false` |
| Приглашение в БД | 1 строка, роль `member` |
| SMTP в этот момент | режим `fail-first`, первый ответ 451 |

### 4.2 Задание в очереди

| Проверка | Факт |
|---|---|
| Очередь | `email-invitations`, prefix `smoke-v120-s2` |
| Job name | `send-invitation` |
| `job.opts.attempts` | **3** |
| `job.opts.backoff` | `{ type: 'exponential', delay: 5000 }` |
| Payload | `to` = приглашённый, `orgName` = имя организации из БД, `inviteLink` = `.../login?invite=<uuid>` |

### 4.3 Retry: 451 → 250

| Проверка | Факт |
|---|---|
| Первая попытка | 451 `Try later` (mock SMTP) |
| Вторая попытка | через 5 с, 250 `OK: queued` |
| Итог job | `completed`, `attemptsMade = 2` (одна неудача + успех) |
| Письмо | text/plain содержит ссылку и имя организации; получатель = приглашённый |

### 4.4 Исчерпание попыток: три отказа

| Проверка | Факт |
|---|---|
| SMTP | режим `reject`, все попытки 4xx |
| Второе приглашение | 201, `emailSent: false` |
| Job | `failed`, `attemptsMade = 3` |
| SMTP | 3 попытки, 3 отказа, 0 принято |
| Приглашение в БД | осталось (письмо не отменило приглашение) |

### 4.5 Логи

В `EmailService` при постановке: `Письмо-приглашение поставлено в очередь
email-invitations: i***@example.com` (email маскируется, `orgName` не
пишется). В `EmailProcessor` — `Задание 1: письмо-приглашение отправлено
(попытка 2)` и ERROR на неудачных попытках. Промптов/PII в логах нет.

### 4.6 Уборка

Организация smoke удалена каскадом, очередь очищена (`obliterate`), backend и
mock SMTP остановлены; порты 3100/2525/3096 освобождены. Артефакты:
`.smoke/v120-s2-smtp-smoke.json` (140 строк), `.smoke/v120-s2-backend.log`,
`.smoke/v120-s2-mock-smtp.log` — все gitignored.

---

## 5. Что не так

1. **`emailSent` больше не различает «в очереди» и «не поставлено»
   (KI-622, 🟡 Medium).** Ответ всегда `false`; UI показывает «письмо не
   отправлено», даже если оно уже доставлено или стоит в очереди. Контракт
   v1.1.0 сохранён, но его смысл деградировал; исправление — S3
   (`emailQueued`/`emailStatus`).
2. **UI-текст временно неточен.** `TeamPage` при `emailSent: false` пишет
   «приглашение создано, но письмо не отправлено» — теперь это не факт, а
   неизвестность. Менять UI в S2 не стали (S3 — UI & Docs), но это видимое
   поведение.
3. **PII и ссылка-приглашение лежат в Redis (KI-623, 🟢 Low).** Payload
   содержит email, `orgName` (у личной организации — email владельца) и
   `inviteLink` с uuid приглашения. `removeOnComplete` (100/24 ч) и
   `removeOnFail` (500/7 дней) ограничивают окно, но не убирают его.
4. **Нет повторной постановки/переотправки (KI-624, 🟢 Low).** Если
   `queue.add` упал или job исчерпал попытки, приглашение остаётся без письма;
   повторный `POST invite` даёт 409, ручки resend нет.
5. **Без `SMTP_HOST` job всё равно делает 3 попытки (KI-625, 🟢 Low).**
   `sendInvitationAsync` сразу возвращает `false`, процессор бросает ошибку,
   BullMQ ждёт 5 и 10 с и пишет три ERROR — хотя конфигурация не изменится до
   рестарта.
6. **Нет метрик очереди.** Глубина `email-invitations`, число failed/delayed,
   время доставки не экспортируются в Prometheus; состояние видно только в
   Redis/логах. Для S2 не требовалось, но для эксплуатации это пробел (кандидат
   в KI следующей сессии).
7. **Один воркер в процессе backend'а.** `@Processor` без `concurrency`:
   письма обрабатываются последовательно. Для приглашений это нормально
   (объём мал), но при массовой рассылке понадобится `concurrency`/отдельный
   процесс.
8. **Smoke проверяет mock SMTP, а не реальный провайдер.** Реальные 4xx/5xx,
   STARTTLS и auth не проверялись: в окружении нет SMTP-провайдера. Мок
   покрывает протокол DATA и retry-семантику, но не TLS/auth.
9. **`job.attemptsMade` после успеха равен 2, а не 1.** BullMQ считает
   количество обработок, включая успешную; «одна неудача» видна по
   `attemptsMade = 2` и счётчику SMTP (1 reject + 1 accept). Это не баг, но
   легко прочитать неверно — зафиксировано в § 4.3.
10. **Контракт `InviteMemberResponse` не расширен.** Добавление
    `emailQueued`/`emailStatus` сломало бы `api-contract.spec.ts` и web-тест;
    вынесено в S3 вместе с UI (KI-622).
11. **`pnpm lint` — 2 преэкзистующих warning'а** в
    `openai-images.provider.spec.ts` (чужие файлы); массовое переформатирование
    не делали.
12. **Реестр KI снова содержал дубли.** На HEAD `fa06d7d` — 613 заголовков при
    608 уникальных (краткие копии KI-617..621 после docs-шага S1). Удалены,
    сводка пересчитана: 612 после KI-622..625.
13. **Путь репозитория в постановке (`C:\Projects\AI\ai-workflow-builder`) не
    существует.** Работа велась в фактическом checkout
    `D:\Projects\AI\workflow-builder` (cwd сессии); все пути в отчёте — от него.
14. **Первый прогон смоука упал на проверке MIME** (искали ссылку в сыром
    quoted-printable/base64). Это дефект смоук-скрипта, не продукта; исправлен
    декодированием text/plain-части (§ 3.10). Организация первого прогона
    удалена вручную после исправления.

---

## 6. Новые KI

Всего **4**: KI-622..625. Реестр пересчитан grep'ом (RULES 3.20): **612**
записей `### KI-`, 612 строк статуса, номера уникальны. На входе было 608
уникальных (613 заголовков — удалены 5 кратких дублей KI-617..621).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-622](../../../KNOWN_ISSUES.md) | 🟡 Medium | Open | `emailSent` всегда `false`: API/UI не отличают «в очереди» от «не поставлено» |
| [KI-623](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Email/orgName/inviteLink хранятся в Redis payload job |
| [KI-624](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Нет resend/повторной постановки после сбоя очереди или `failed` job |
| [KI-625](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Без `SMTP_HOST` job делает 3 бессмысленные попытки |

Сводка: **Fixed 263 + Fixed (частично) 7 + Open 285 + Documented 46 +
Documented (не воспроизводится) 1 + Planned 4 + Deferred 2 + Won't Fix 4 =
612**. **Закрыто частично:** KI-593 (ретраи в очереди; статус доставки и
resend остались — KI-622/624). Обновлены `docs/CHANGELOG.md`,
`docs/KNOWN_ISSUES.md`, `docs/development/reports/README.md`; добавлен
ADR-0012.

---

## 7. Обоснование решений

### 7.1 Почему BullMQ, а не синхронная отправка с ретраями в HTTP

Ретраи внутри HTTP-запроса означали бы, что клиент ждёт 5+10 секунд при
недоступном SMTP и получает 500/таймаут; при обрыве соединения неизвестно,
ушло ли письмо. Очередь разрывает эти состояния: приглашение фиксируется в
БД, job — в Redis, HTTP отвечает сразу, а доставка становится фоновой.
BullMQ уже есть в проекте, поэтому цена — только регистрация очереди.

### 7.2 Почему продюсер и воркер разведены по методам

Один метод «поставь в очередь или отправь» невозможно вызывать из воркера:
он бы снова поставил job. Разделение `queueInvitationAsync` (продюсер) и
`sendInvitationAsync` (SMTP) делает поток данных однонаправленным:
HTTP → очередь → воркер → SMTP. Имена отражают роль, а старый метод сохранил
свой тестируемый контракт.

### 7.3 Почему `sendInvitationAsync` оставлен «мягким», а `throw` — в воркере

Если бы сервис начал бросать исключения, сломались бы его тесты и все
вызывающие, а HTTP-путь (если его когда-нибудь вернут) получил бы 500 вместо
`emailSent: false`. Воркер — правильное место для жёсткой семантики: именно
он знает, что `false` означает «повторить». Это сохраняет оба контракта.

### 7.4 Почему `attempts: 3` и exponential 5000

Три попытки — требование DESIGN. Паузы 5 и 10 секунд переживают короткий
рестарт SMTP/сети, но не держат job часами; суммарное окно ~15 с. Для
«долгого» SMTP-сбоя после трёх попыток job остаётся в `failed` с payload —
можно разобрать вручную (пока нет resend, KI-624).

### 7.5 Почему payload — снимок с Zod-валидацией

Воркер не должен зависеть от схемы БД/`APP_PUBLIC_URL`: снимок делает job
самодостаточным. Zod на границе защищает от задания, созданного старой
версией кода или повреждённого в Redis; `UnrecoverableError` не тратит три
попытки на данные, которые не изменятся. Плата — PII в Redis (KI-623).

### 7.6 Почему `emailSent` не заменён на `emailQueued`

Гейты `api-contract.spec.ts` и web-тест фиксируют поля `InviteMemberResponse`;
добавление поля в S2 потребовало бы синхронной правки web-контракта и UI —
это S3. В S2 контракт сохранён, а честность семантики принесена в жертву:
`emailSent: false` означает «пока не доставлено», а не «не поставлено»
(KI-622). Так S2 остаётся серверным срезом без UI-регрессий.

### 7.7 Почему очередь использует общий `BULLMQ_PREFIX`

Изоляция инстансов (KI-387) уже решает проблему «smoke-письмо попало в
dev-очередь». Использовать отдельный префикс для email значило бы, что
оператор должен синхронизировать две переменные; общий префикс — одно
пространство ключей на инстанс, как у workflow-runs.

### 7.8 Почему `orgName` убран из логов, но остался в payload

Письму нужно имя организации (тема/текст), поэтому в payload он обязателен.
В логах же он не нужен для диагностики, а у личной организации содержит
email владельца — PII. Маскирование email уже есть; убрать `orgName` из
сообщений проще, чем маскировать произвольный текст с email внутри.

### 7.9 Почему тесты на моках, а не на реальном SMTP

CI не имеет SMTP-провайдера. `email.queue.spec` проверяет постановку job и
опции без Redis (mock `Queue`), `email.processor.spec` — вызов сервиса и
преобразование `false` в throw, `org-members.service.spec` — что HTTP-путь
вызывает `queueInvitationAsync`. Реальный SMTP-путь (DATA, 451, retry)
проверяет смоук с mock SMTP; настоящий провайдер в сессии недоступен.

### 7.10 Почему отчёт выводится целиком

RULES 2.15/2.18: краткий отчёт скрывает детали. В S2 важны и компромисс с
`emailSent` (KI-622), и PII в Redis (KI-623), и найденный дефект MIME в
смоуке, и повторное появление дублей KI. Полный отчёт сохранён в
`docs/development/reports/v1.2.0/S2-smtp-retry.md` и выведен в чат целиком.
