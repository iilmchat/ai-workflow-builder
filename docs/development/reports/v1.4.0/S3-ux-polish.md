---
title: "S3: UX Polish — адаптивный TopBar, recovery-пинг LM Studio, outbox email (v1.4.0)"
date: 2026-11-08
version: v1.4.0
steps: [S3]
status: accepted
related_ki: [KI-623, KI-628, KI-632, KI-641, KI-642, KI-643, KI-644, KI-645]
related_adr: []
---

# Отчёт S3 — UX Polish (v1.4.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **124 passed (128 файлов),
1948 passed / 25 skipped (1973)**, `pnpm test:parity` — **14/14**,
`pnpm test:e2e` — **1/1**, web — **55 файлов / 511 тестов**, `pnpm --dir web
build` — success (392 модуля). Смоук на живом приложении — **39/39 PASS**:
CDP TopBar 30/30 (1920/1680/1440/1280/1024), LM Studio recovery 4/4, email
outbox 5/5.

**Точка старта.** HEAD `96d2cb8` («feat(v1.4.0): S2 — History Comparison»),
CI зелёный, `package.json` = `1.3.0`, `drizzle` — 19 миграций. Источник —
`docs/development/v1.4/DESIGN_V140_FEATURES.md` § 3.3, правила —
`docs/development/RULES.md` v1.10.0.

**Сделано:** адаптивный `TopBar` (KI-628) — копирайт/GPU-текст/индикатор
«грязного» графа скрываются до 1440 px, подписи второстепенных кнопок — до
1760 px, колонка имени зафиксирована `shrink-0`, группа действий получила
`min-w-0 overflow-x-auto`; `LlmHealthService` (KI-632) пингует LM Studio каждые
5 с, пока статус `unavailable`, и после успеха перезапускает обычный интервал
30 с; email-очередь (KI-623) переведена на outbox-таблицу `email_outbox`
(миграция `0020`), в Redis уходит только `{ outboxId }`, воркер читает payload
из БД и обновляет `status`/`attempts`. Новые ограничения — KI-641..645.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/email/email-outbox.service.ts](../../../../src/email/email-outbox.service.ts) *(new)* | 116 | `EmailOutboxService`: `createAsync`, `findByIdAsync`, `registerAttemptAsync` (атомарный `attempts + 1`), `markSentAsync`, `markFailedAsync`; SQL изолирован от воркера |
| [drizzle/0020_overrated_steve_rogers.sql](../../../../drizzle/0020_overrated_steve_rogers.sql) *(new)* | 12 | `CREATE TABLE email_outbox` (7 колонок, CHECK на статус, индекс `(status, created_at)`) |
| [drizzle/meta/0020_snapshot.json](../../../../drizzle/meta/0020_snapshot.json) *(new, generated)* | 1399 | снапшот Drizzle для миграции `0020` |
| [docs/development/reports/v1.4.0/S3-ux-polish.md](S3-ux-polish.md) *(new)* | — | этот отчёт (7 разделов, RULES 2.15/2.18) |

Артефакты смоука (gitignored, `.smoke/`): `v140-s3-lmstudio-mock.mjs` (92
строки — mock LM Studio с управлением `POST /__mode` и журналом пингов),
`v140-s3-topbar-smoke.mjs` (420 строк — логин, 5 ширин, 30 проверок, 2
скриншота), `v140-s3-ux-polish.json` (JSON-отчёт), `v140-s3-topbar-1440.png`,
`v140-s3-topbar-1280.png`.

### 1.2 Production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/db/schema.ts](../../../../src/db/schema.ts) | +68/−0 | `EMAIL_OUTBOX_STATUSES`, `emailOutbox` (`id`, `to`, `org_name`, `invite_link`, `status`, `created_at`, `attempts`), `EmailOutboxRow`/`NewEmailOutboxRow`, CHECK и индекс |
| [src/email/email.service.ts](../../../../src/email/email.service.ts) | +43/−6 | инъекция `EmailOutboxService`; `queueInvitationAsync` — INSERT в outbox → `queue.add({ outboxId })`; ошибка Redis помечает строку `failed`; PII в лог не пишется |
| [src/email/email.processor.ts](../../../../src/email/email.processor.ts) | +159/−20 | чтение строки по `outboxId`, Zod-валидация payload из БД, `registerAttemptAsync`, `markSentAsync`/`markFailedAsync` на последней попытке, идемпотентность по `status='sent'` |
| [src/email/email.queue.ts](../../../../src/email/email.queue.ts) | +28/−15 | `EmailInvitationJobData = { outboxId }`; `EmailInvitationJobSchema` (uuid), `EmailInvitationPayloadSchema` (to/orgName/inviteLink для строки БД) |
| [src/email/email.module.ts](../../../../src/email/email.module.ts) | +5/−1 | провайдер `EmailOutboxService` |
| [src/llm/llm-health.service.ts](../../../../src/llm/llm-health.service.ts) | +91/−49 | `LLM_HEALTH_UNAVAILABLE_RETRY_MS = 5_000`, `unavailableTimer`, `scheduleUnavailableRetry`, `clearUnavailableTimer`, `startInterval` (перезапуск 30 с после успеха) |
| [web/src/components/TopBar.tsx](../../../../web/src/components/TopBar.tsx) | +47/−18 | `ActionLabel`, `shrink-0`, адаптивная ширина input, скрытие копирайта/GPU-текста/индикатора, `overflow-x-auto` + `[&>*]:shrink-0`; все `data-*` сохранены |

### 1.3 Тесты

| Файл | +/− | Прирост |
|---|---:|---|
| [src/llm/llm-health.service.spec.ts](../../../../src/llm/llm-health.service.spec.ts) | +45/−57 | 3 теста вместо 3 старых: 5-секундные пинги при `unavailable`, отсутствие цикла после успеха, `stop()` снимает оба таймера, ручной `checkAsync` не создаёт таймеров |
| [src/email/email.processor.spec.ts](../../../../src/email/email.processor.spec.ts) | +105/−14 | 10 тестов: чтение из БД, `attempts`, `failed` только на последней попытке, идемпотентность, битый payload/строка, ошибка БД |
| [src/email/email.queue.spec.ts](../../../../src/email/email.queue.spec.ts) | +81/−12 | 10 тестов: job без PII, outbox-failed при ошибке Redis, ошибка INSERT, Zod `outboxId`/payload |
| [src/email/email.service.spec.ts](../../../../src/email/email.service.spec.ts) | +11/−0 | заглушка outbox в конструкторе |
| [src/db/schema.spec.ts](../../../../src/db/schema.spec.ts) | +47/−0 | +1 тест: колонки/дефолты/типы `email_outbox`, статусы |
| [web/src/components/TopBar.spec.tsx](../../../../web/src/components/TopBar.spec.tsx) | +92/−2 | +3 теста: копирайт скрыт до 1440 px и `truncate`, подписи скрыты до 1760 px, input/группа действий не сжимаются |

**Итого production:** **+441/−109**. **Итого тесты:** **+381/−85**, **+9
тестов** (backend +6: 10−5 processor, 10−7 queue, +1 schema; web +3).

### 1.4 Документация и контракт

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +31/−0 | `[Unreleased]`: S3 в `Added`, `Changed`, `Fixed`, `Documented` |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +115/−30 | KI-623/628/632 → `Fixed`; KI-641..645; KI-624 → `Documented`; удалены дубли KI-638..640; сводка пересчитана: **632 записи**, `Fixed 272`, `Documented 58` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | строка v1.4.0 S3 |
| [drizzle/meta/_journal.json](../../../../drizzle/meta/_journal.json) | +7/−0 | запись миграции `0020` |

**Общий итог (tracked `git diff --numstat`):** **+976/−224**; новые
untracked-файлы — **1527 строк** (`email-outbox.service.ts` 116, миграция 12,
снапшот 1399), плюс этот отчёт. С учётом новых файлов — **+2503/−224**.
Смоук-артефакты gitignored.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` | **124 passed / 4 skipped (128 файлов)**, **1948 passed / 25 skipped (1973)**, ~51 с |
| `pnpm test:parity` | **14/14** (после `pnpm db:migrate`) |
| `pnpm test:e2e` | **1/1** (`AppModule` bootstrap) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — преэкзистующие `openai-images.provider.spec.ts` (чужие файлы, не трогали) |
| `pnpm --dir web build` | success, **392 modules** (`tsc -b` + Vite) |
| `pnpm --dir web test` | **55 файлов / 511 тестов passed** (было 55/508, +3 KI-628) |
| Целевой backend-прогон | 5 файлов / **63 теста** (`llm-health`, `email.service`, `email.queue`, `email.processor`, `db/schema`) |
| `pnpm db:generate` | миграция `0020_overrated_steve_rogers.sql` создана |
| `pnpm db:migrate` | `0020` применена, backfill организаций — OK |

Скипнутые 25 тестов — преэкзистующие DB/интеграционные (`schema-parity` без
`--env-file`, `media-storage.integration`, `vector-store.integration`,
`backfill-organizations`, OpenAI Images без ключа). Один новый skipped —
`schema-parity` в обычном `pnpm test` (как и раньше); отдельный
`pnpm test:parity` — 14/14.

---

## 3. Диагностика

### 3.1 Дубли KI-638..640 и испорченная строка в KNOWN_ISSUES

На HEAD S2 в реестре было **630** заголовков `### KI-`, но **627** уникальных
номеров: KI-638, KI-639 и KI-640 присутствовали дважды — подробные записи
(строки 10071–10110) и краткие дубли из S1-коммита (10112–10128). В одном из
дублей строка описания была испорчена: `...показываются как ## Сводка по
статусам.0000.` — заголовок сводки попал внутрь текста. Сводка S2 при этом
утверждала «дублей номеров нет».

**Исправлено:** три кратких дубля удалены (подробные записи KI-638..640
сохранены), заголовок `## Сводка по статусам` восстановлен, сводка
пересчитана grep'ом (RULES 3.20).

### 3.2 KI-624 помечен Fixed, но ручки resend нет

KI-624 («Нет повторной постановки/переотправки приглашения») имел статус
`Fixed | Исправлено в: v1.2.0 (S3)`, но в коде нет ни `resend`-ручки, ни
outbox-добирания: `POST /admin/members/invitations/:id/resend` отсутствует,
`org-members.controller.ts` его не объявляет. Поиск `resend|requeue` по `src/`
не дал совпадений. Статус исправлен на `Documented`; в KI-641 добавлено, что
повторная отправка `failed`-строки по-прежнему ручная.

### 3.3 Tailwind `min-[1440px]:inline` вычисляется как `block`

Первый CDP-прогон показал `display: block` у подписей на широких экранах,
хотя класс — `min-[1440px]:inline`. Причина не в Tailwind: `span` — flex-item
внутри `<button class="flex">`, а CSS blockifies inline-level flex items,
поэтому computed `display` = `block`. Это не баг разметки; тест и смоук
исправлены на ожидание `block` для видимой подписи.

### 3.4 Порог 1440 px для подписей кнопок вызывал переполнение на 1440 px

При первом варианте (`ActionLabel` — `min-[1440px]:inline`) на ширине 1440 px
подписи появлялись одновременно с копирайтом, и группа действий требовала
**1324 px** при доступных **1041 px** (CDP: `actionsScrollWidth=1324`,
`actionsClientWidth=1041`) — кнопки уходили в скрытую прокрутку. Замеры на
1680 px (1281 доступно, 1324 нужно) и 1920 px (1324/1324) показали, что
подписи помещаются только около 1760 px. Порог изменён на `min-[1760px]`:
на 1440/1280 подписи скрыты, на 1920 — видны; CDP 30/30.

### 3.5 CDP-смоук подключался к закешированному бандлу

После пересборки web первый повторный прогон показал старые классы: Chrome
держал ранее загруженный `index-*.js`. В смоук добавлен `Page.navigate` на
`/login` перед логином — теперь проверяется свежий бандл, отдаваемый backend
с `web/dist`.

### 3.6 Окружение смоука

- Postgres (5433) и Redis (6379) не были запущены — подняты
  `docker compose up -d db redis`; миграция `0020` применена.
- Порт 3000 занят чужим приложением (`ai-project-monitoring-frontend`), поэтому
  backend запущен на **3101** (`PORT=3101`).
- Реальный LM Studio на `127.0.0.1:8034` отвечает 401 на `GET /models`;
  для смоука поднят mock на `127.0.0.1:1240/v1` с управлением доступностью.
- Mock SMTP — `.smoke/v120-s2-mock-smtp.mjs` (2525, control 3096), режим
  `accept`.
- Headless Chrome 157, CDP 9222, профиль `.tmp/chrome-s3`.

### 3.7 Прочее

- `EmailProcessor` сначала логировал номер попытки из `attempts` БД (в тесте —
  1), а тест ожидал `attemptsMade + 1` (3). Лог переведён на
  `job.attemptsMade + 1`; счётчик `attempts` в БД по-прежнему увеличивается
  отдельно и может отличаться при ручном перезапуске.
- `LlmProviderFactory` при старте с mock LM (503) пишет WARN и всё равно
  регистрирует `lmstudio` в списке провайдеров — healthcheck продолжил пинги,
  это ожидаемое поведение (KI-621-контекст).
- `pnpm lint` — 2 преэкзистующих warning'а в `openai-images.provider.spec.ts`
  (`String(formData.get(...))`), файлы не наши; новых warning'ов нет.

---

## 4. Smoke

**Стенд:** backend `http://127.0.0.1:3101` (собранный `dist/main` + `web/dist`),
PostgreSQL `127.0.0.1:5433`, Redis `127.0.0.1:6379`, mock SMTP 2525/3096, mock
LM Studio 1240, headless Chrome 157 (CDP 9222). Пользователь
`s3-smoke-1794161369001@example.com` (owner личной организации
`d524ab9e-156f-464b-86b9-aa701cd37313`).

### 4.1 TopBar — CDP, 30/30 PASS

Скрипт: `.smoke/v140-s3-topbar-smoke.mjs`; JSON:
`.smoke/v140-s3-ux-polish.json`; скриншоты:
[1440 px](../../../../.smoke/v140-s3-topbar-1440.png),
[1280 px](../../../../.smoke/v140-s3-topbar-1280.png).

| Ширина | `docScrollWidth` | input | Копирайт | Подписи кнопок | actions client/scroll | Header |
|---:|---:|---:|---|---|---:|---:|
| 1920 | 1920 | 256 px | `block` | `block` | 1324 / 1324 | 56 px |
| 1680 | 1680 | 256 px | `block` | `none` | 902 / 902 | 56 px |
| 1440 | 1440 | 256 px | `block` | `none` | 902 / 902 | 56 px |
| 1280 | 1280 | 256 px | `none` | `none` | 902 / 902 | 56 px |
| 1024 | 1024 | 224 px | `none` | `none` | 714 / 902 (scroll) | 56 px |

Проверки на каждой ширине: нет переполнения страницы (`docScrollWidth <=
innerWidth`), поле имени не обрезано (`inputRight <= innerWidth`, ширина ≥100),
копирайт виден ровно с 1440 px, подписи — ровно с 1760 px, шапка не
переполнена (`headerScrollWidth <= headerWidth`), высота 56 px. Итог —
**30/30 PASS**. На 1024 px группа действий скроллится внутри
`overflow-x-auto` (см. KI-642), но страница и шапка не переполняются.

Скриншот 1440 px: копирайт «© 2026 RuChating (iilmchat) · v1.3.0» под именем,
подписи второстепенных кнопок скрыты (иконки), «Сохранить»/«Запустить» —
с текстом, `GPU: online` — с текстом.

### 4.2 LM Studio recovery — 4/4 PASS

Mock LM (`/v1/models` → 503/200) + `GET /llm/health` (JWT). Журнал пингов mock:

| Время (MSK) | Доступность | Событие |
|---|---|---|
| 21:09:18.224 | false | `LlmProviderFactory` при старте |
| 21:09:18.316 | false | первый healthcheck |
| 21:09:48.301 | false | обычный тик 30 с (неудача №2) |
| 21:10:18.308 | false | обычный тик 30 с (неудача №3 → `unavailable`) |
| 21:10:23.321 | **true** | внеочередной пинг **+5.013 с** после `unavailable` |
| 21:10:53.330 | true | следующий пинг **+30.009 с** после успеха |

`GET /llm/health` до: `{"local":{"available":false,"lastCheck":
"2026-11-08T18:10:18.309Z"},"routerEnabled":false}`; после:
`{"local":{"available":true,"lastCheck":"2026-11-08T18:10:23.322Z"},
"routerEnabled":false}`. Mock переключён в `available` в 21:10:21.129 —
статус стал `available` через **2.4 с** (на ближайшем 5-секундном пинге).
Проверки: (1) `unavailable` достигнут на 3-й неудаче; (2) внеочередной пинг
через 5 с; (3) восстановление обнаружено ≤5 с; (4) следующий пинг через 30 с,
5-секундного цикла после успеха нет — **4/4**.

`routerEnabled: false` — особенность окружения смоука: `LLM_ROUTER_ENABLED` не
включён; на healthcheck это не влияет.

### 4.3 Email outbox — 5/5 PASS

1. `POST /admin/members/invite` (`invitee-s3@example.com`, `role=member`) →
   **201**, `emailSent: false`, `emailQueued: true`; HTTP-ответ не ждёт SMTP.
2. `email_outbox`: `id=d2b654e7-42a0-444c-bf25-3bdf226bdf99`,
   `status=sent`, `attempts=1`, `org_name=Personal Workspace - s3-smoke-…`,
   `invite_link=http://127.0.0.1:3101/login?invite=037901fa-…`.
3. Redis (BullMQ, prefix `workflow-runs`): job `id=1`, `name=send-invitation`,
   `data={"outboxId":"d2b654e7-…"}`, `opts.attempts=3` — **ни email, ни
   orgName, ни inviteLink в Redis нет**.
4. Mock SMTP: `attempts=1`, `accepted=1`, `rejected=0`, получатель
   `invitee-s3@example.com`, в письме — та же ссылка `?invite=037901fa-…` и
   название организации.
5. `email_outbox` не содержит других строк с этим `outboxId`; повторной
   отправки нет.

Проверки: 201 + `emailQueued`; строка БД `sent/attempts=1`; Redis без PII;
SMTP принял письмо со ссылкой; job с `attempts: 3` — **5/5**.

**Итого смоук: 30 + 4 + 5 = 39/39 PASS, 0 FAIL.**

---

## 5. Что не так

1. **TopBar на 1024 px.** Полного переполнения нет, но группа действий
   скроллится: `actionsClientWidth=714`, `actionsScrollWidth=902`. Кнопки
   Export/Import/History/Team/Share доступны только после горизонтальной
   прокрутки, а скроллбар скрыт (`[scrollbar-width:none]`). Это осознанный
   fallback, но discoverability страдает — KI-642.
2. **`email_outbox` не очищается.** Строки `sent`/`failed` с email,
   `org_name` и одноразовой ссылкой копятся бессрочно; cron/retention нет,
   ручки переотправки нет (KI-624 так и не закрыт) — KI-641.
3. **Outbox не транзакционный.** INSERT приглашения и INSERT outbox/`queue.add`
   — разные операции без общей транзакции; падение между ними оставляет
   приглашение без письма — KI-643.
4. **`invite_link` в БД — plaintext.** KI-623 убрал PII из Redis, но
   одноразовый секрет остался в `email_outbox.invite_link`; шифрования
   at-rest нет — KI-644.
5. **Возможен дубль письма.** `markSentAsync` вызывается после `sendMail`; при
   сбое UPDATE BullMQ повторит job, статус останется `pending`, письмо уйдёт
   второй раз (at-least-once) — KI-645.
6. **Подписи второстепенных кнопок скрыты на 1440/1680 px.** Остаются иконки
   с `title`/`aria-label`; это соответствует требованию «не переполняться», но
   визуально кнопки Export/Import/History/Team/Share менее очевидны. Порог
   1760 px выбран по замерам, а не по «красивой» границе 1440.
7. **`GPU: online`** на 1440 px ещё с текстом, на 1280 px — только точка.
   Порог 1440 px выбран по ширине, но на границе 1439/1440 поведение
   скачкообразное (как у любого медиазапроса).
8. **`routerEnabled: false`** в смоуке — проверялся только `local.available`;
   полный путь роутера (GPU → облако) в S3 не менялся и не смоукился.
9. **`LlmHealthService` pings in-memory.** При нескольких backend-инстансах
   каждый пингует LM Studio сам (известное KI-620); 5-секундный режим
   увеличивает нагрузку пропорционально числу инстансов, пока провайдер
   недоступен.
10. **`email_outbox.status='failed'` при ошибке `queue.add`** выставляется
    сразу, хотя job не создавался; ручного retry нет — строка остаётся
    «мёртвой» до SQL-вмешательства.
11. **Тесты не проверяют реальный Tailwind CSS.** `TopBar.spec.tsx`
    проверяет классы (`hidden`, `min-[1440px]:block`), а не вычисленный
    `display`: jsdom не применяет media queries. Фактический `display`
    проверен CDP-смоуком (30/30), но unit-тест сам по себе не поймает
    регресс в CSS-порядке.
12. **Смоук-скрипты содержат тестовые креды** (`s3-smoke-…`,
    `SmokePass123!`). Они лежат в gitignored `.smoke/`, в git не попадают, но
    при копировании в другой репозиторий их нужно менять.
13. **Снапшот миграции — 1399 строк.** `drizzle/meta/0020_snapshot.json`
    большой; это нормальный артефакт drizzle-kit, но diff шумный.
14. **`README.md` не обновлялся.** S3 не меняет API/установку/пользовательские
    сценарии; outbox — внутренняя архитектура. Обновление README не требуется
    по RULES 2.3.
15. **Версия в `package.json` осталась `1.3.0`.** S3 — не релиз; версия и
    `[Unreleased] → [1.4.0]` — шаг S4.

---

## 6. Новые KI

| KI | Приоритет | Статус | Суть |
|---|---|---|---|
| KI-641 | 🟢 Low | Documented | `email_outbox` не очищается (нет retention/cron) и не имеет ручной переотправки `failed`; PII и одноразовые ссылки копятся в БД |
| KI-642 | 🟢 Low | Documented | TopBar на <1280 px: группа действий уходит в скрытую горизонтальную прокрутку (`714/902` на 1024 px); нужен overflow-меню «⋯» |
| KI-643 | 🟢 Low | Documented | Outbox не транзакционен с приглашением: падение между INSERT приглашения и INSERT outbox/`queue.add` оставляет приглашение без письма |
| KI-644 | 🟡 Medium | Documented | `email_outbox.invite_link` (одноразовый секрет) хранится в БД в открытом виде; нужно шифрование или хранение `invitation_id` вместо ссылки |
| KI-645 | 🟢 Low | Documented | При сбое `markSentAsync` после принятого SMTP письма BullMQ повторит job и отправит письмо второй раз (at-least-once) |

Дополнительно: **KI-624** возвращён из `Fixed` в `Documented` — ручки
повторной отправки в коде нет, прежний статус был выставлен ошибочно.
Дубли KI-638..640 в `KNOWN_ISSUES.md` удалены (не новые KI, а cleanup
реестра).

---

## 7. Обоснование решений

### 7.1 Почему полный outbox, а не «просто убрать orgName»

Постановка допускала упрощённый вариант: убрать `orgName` из payload и
оставить `{ to, inviteLink }`. От него отказались: email и ссылка-приглашение
— это PII и одноразовый секрет, и они остались бы в Redis на срок
`removeOnComplete`/`removeOnFail` (сутки/неделю). Outbox убирает из Redis
**весь** payload, оставляя только uuid строки, и заодно даёт статус
доставки/`attempts`, которых у снимка в Redis не было. Цена — одна миграция и
`EmailOutboxService`; это меньше, чем кажется: таблица из 7 колонок, SQL
изолирован в одном сервисе, воркер стал тестируемым без BullMQ.

### 7.2 Почему в Redis только `{ outboxId }`

UUID строки не является PII и не позволяет восстановить email/ссылку без
доступа к БД. Воркер при повторе после рестарта читает актуальную строку из
БД, а не снимок из Redis; повреждённый/устаревший job с несуществующим
`outboxId` становится `UnrecoverableError`, а не `sendMail` с `undefined`.

### 7.3 Почему `EmailOutboxService`, а не SQL прямо в `EmailService`

`EmailService` уже держит SMTP-транспорт и fallback-контракт «никогда не
бросает»; добавление Drizzle-цепочек в него смешало бы две ответственности и
усложнило бы unit-тесты (пришлось бы мокать `db.select().from().where()`).
Отдельный сервис даёт маленький интерфейс (`createAsync`, `findById`,
`registerAttempt`, `markSent`, `markFailed`) и позволяет тестировать воркер
заглушкой, а не фейковой БД. Это же разделение позволяет позже заменить
таблицу/шифрование (KI-644) без правок воркера.

### 7.4 Почему `pending` / `sent` / `failed`, а не `sending`

`pending` покрывает и «ждёт воркера», и «между повторами BullMQ»; `failed`
выставляется только на последней попытке (или при ошибке `queue.add`), иначе
UI/оператор видели бы `failed` у письма, которое ещё будет повторено. Статус
`sending` (claim) напрашивается для exactly-once, но требует условного UPDATE
и обработки «зависших» claim'ов — это отдельное решение (KI-645), а не
побочный эффект S3.

### 7.5 Почему `attempts` увеличивается атомарным SQL

`UPDATE ... SET attempts = attempts + 1 ... RETURNING attempts` не теряет
попытку при двух параллельных воркерах/повторной доставке, в отличие от
«прочитали — прибавили — записали». Номер для лога берётся из
`job.attemptsMade + 1` (номер попытки BullMQ), а не из БД: после ручного
перезапуска они могут разойтись, и лог должен отражать попытку job'а.

### 7.6 Почему 5-секундный пинг **при** `unavailable`, а не после восстановления

KI-632 — про задержку **обнаружения** восстановления: старый KI-621-механизм
пинговал через 5 с уже **после** перехода `unavailable → available`, но сам
переход ждал очередного 30-секундного тика. Поэтому 5-секундный таймер
перенесён в состояние `unavailable`: пока LM Studio выключен, каждый
неудачный пинг планирует следующий через 5 с, а первый успешный — снимает
таймер. Это ровно «внеочередной пинг через 5 секунд, а не жди 30» из
постановки.

### 7.7 Почему после успеха обычный интервал **перезапускается**

Требование: «если пинг успешен — верни `available` и запланируй обычный тик
(30 сек)». Если просто оставить старый `setInterval`, следующий пинг мог бы
прийти через 1–29 с (в зависимости от фазы интервала), и проверка «после
успеха следующий пинг через 30 с» была бы недетерминированной. Поэтому
`startInterval()` пересоздаёт интервал от момента успеха: смоук показал
+30.009 с. Бесконечного 5-секундного цикла нет: `unavailableTimer` живёт
только пока статус `unavailable`, успех его очищает, а новый планируется
только при повторной деградации.

### 7.8 Почему порог подписей — 1760 px, а не 1440

Замеры CDP: на 1440 px с подписями группе действий нужно 1324 px при
доступных 1041 px; на 1680 px — 1324 при 1281; на 1920 px — 1324 при 1324.
То есть подписи помещаются только чуть выше 1680 px. Порог 1760 px — запас
~40 px на разные шрифты/локали; на 1440 px подписи скрыты, копирайт виден,
действия занимают 902 px из 1041. Это компромисс в пользу «не переполняться»
вместо «показать текст любой ценой».

### 7.9 Почему копирайт скрыт до 1440 px, а не просто `truncate`

`truncate` без скрытия всё равно занимает ~200 px; на 1280 px этого места нет
— именно копирайт вместе с подписями кнопок давал переполнение в KI-628.
Скрытие до 1440 px убирает ~200 px на узких экранах, а `truncate` +
`whitespace-nowrap` гарантирует, что на 1440 px и шире текст не переносится
по одной букве. Полная форма копирайта остаётся в `title` (RULES 1.12),
`data-app-version` — в DOM всегда (контракт CDP).

### 7.10 Почему `shrink-0` на колонке имени и адаптивная ширина input

Исходный баг: `flex min-w-0 flex-col` сжимался сильнее, чем `input w-64`,
поэтому input «вылезал»/обрезался. `shrink-0` запрещает колонке сжиматься, а
`w-32 sm:w-48 lg:w-56 xl:w-64` уменьшает её на узких экранах (128/192/224/256
px). Это сохраняет поле редактируемым на всех проверенных ширинах (CDP:
input 256 px на 1280/1440, 224 px на 1024) и не отнимает место у действий.

### 7.11 Почему прокрутка действий, а не скрытие кнопок

Скрывать Export/Import/History/Team/Share на узких экранах — значит убирать
функции; `overflow-x-auto` сохраняет все действия, а `[&>*]:shrink-0` не
даёт кнопкам сплющиться. На 1280/1440 прокрутка не нужна вообще; на 1024 она
остаётся аварийным fallback'ом и зафиксирована как KI-642. Страница и шапка
при этом не переполняются (`docScrollWidth == innerWidth`), что и было
жёстким требованием.

### 7.12 Почему сохранены все `data-*`-атрибуты

`data-app-version`, `data-gpu-status`, `data-run-status`,
`data-topbar-*`, `data-dirty-indicator`, `data-share-button` — контракт
CDP-смоуков и e2e. Скрытие элементов — только CSS (`hidden`/`md:block`), DOM
не меняется: смоук находит кнопку даже с иконкой без текста, а
`aria-label`/`title` остаются на кнопках. Это же позволило не переписывать
существующие тесты TopBar.

### 7.13 Почему не менялся API/контракт

Outbox — внутренняя деталь email-подсистемы: `POST /admin/members/invite`
по-прежнему отвечает `InviteMemberResponse` с `emailSent`/`emailQueued`.
Поэтому `api-contract.json`, web-зеркала и README не трогались; изменился
только payload задания в Redis, который не является публичным контрактом.

### 7.14 Почему исправлены дубли KI и статус KI-624

RULES 3.20 требует, чтобы сводка совпадала с grep'ом: при 630 заголовках и
627 уникальных номерах сумма статусов не сходилась. Удаление трёх кратких
дублей KI-638..640 и возврат KI-624 в `Documented` — не «уборка ради
уборки»: без этого нельзя честно записать «632 записи» и `Fixed 272`.
Исправление документировано в разд. 3.1/3.2 и в `CHANGELOG.md`.
