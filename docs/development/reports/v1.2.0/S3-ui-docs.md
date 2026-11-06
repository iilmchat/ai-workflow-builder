---
title: "S3: UI & Docs — индикатор GPU и emailQueued (v1.2.0)"
date: 2026-11-06
version: v1.2.0
steps: [S3]
status: accepted
related_ki: [KI-618, KI-622, KI-626, KI-627, KI-628]
related_adr: []
---

# Отчёт S3 — UI & Docs (v1.2.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**127 passed (127 файлов), 1901 passed / 2 skipped (1903)**, `pnpm test:parity` —
**13/13**, `pnpm test:e2e` — **1/1**, `pnpm lint` — **0 errors / 2 warnings**
(оба преэкзистующие, `openai-images.provider.spec.ts`), web-пакет —
**54 файла / 499 тестов passed**, `pnpm --dir web build` — **0 ошибок**.
Смоук на живом приложении — **18/18 PASS**: `GET /llm/health` online/offline,
`emailQueued: true`, задание в BullMQ, зелёная/серая точка `GPU: online/offline`
и сообщение «Приглашение отправлено (в очереди)» в реальном UI (CDP).

**Точка старта.** HEAD `bb8e4ff` («feat(v1.2.0): S2 — SMTP Retry (BullMQ
queue)»), CI зелёный. Источник — DESIGN V120 § 3.4, KI-618, KI-622; правила —
`docs/development/RULES.md` v1.10.0.

**Сделано:** `GET /llm/health` (`{ local: { available, lastCheck },
routerEnabled }`, `LlmHealthService.getLastCheckAt()`,
`LlmRouterService.isEnabled()`); индикатор GPU в `TopBar` (опрос при
монтировании и раз в 30 с, зелёная/серая точка, `data-gpu-status`); `emailQueued`
в `InviteMemberResponse` и тексты `TeamPage` по нему; i18n (ru/en); README
(разделы «LLM Router» и «SMTP Retry», актуальная таблица «Статус проекта»);
паритет-контракт `api-contract.json` + оба гейта. **KI-618 и KI-622 закрыты.**
Новые ограничения — KI-626..628.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/llm/dto/llm-health.dto.ts](../../../../src/llm/dto/llm-health.dto.ts) *(new)* | 35 | `LocalLlmHealth`/`LlmHealthResponse` — контракт `GET /llm/health` с русским JSDoc |
| [docs/development/reports/v1.2.0/S3-ui-docs.md](S3-ui-docs.md) *(new)* | — | этот отчёт (7 разделов, RULES 2.15/2.18) |

Артефакты смоука (gitignored, `.smoke/`): `v120-s3-ui-smoke.mjs` (21.6 КБ —
mock LM Studio + backend + CDP), `v120-s3-ui-smoke.json` (18 проверок),
`v120-s3-backend.log`, `v120-s3-ui-online.png`, `v120-s3-ui-invite.png`,
`v120-s3-ui-offline.png`.

### 1.2 Backend — production

| Файл | +/− | Что |
|---|---:|---|
| [src/llm/llm.controller.ts](../../../../src/llm/llm.controller.ts) | +38/−5 | DI `LlmHealthService`/`LlmRouterService`; `@Get('health')`; JSDoc |
| [src/llm/llm-health.service.ts](../../../../src/llm/llm-health.service.ts) | +30/−1 | `lastCheckedAt` + `getLastCheckAt()` (ISO/`''`), обновление в `applyResult` |
| [src/llm/llm-router.service.ts](../../../../src/llm/llm-router.service.ts) | +14/−0 | `isEnabled()` — текущий `LLM_ROUTER_ENABLED` |
| [src/organizations/dto/member.dto.ts](../../../../src/organizations/dto/member.dto.ts) | +16/−10 | `emailQueued: boolean`; `emailSent` — всегда `false` (совместимость) |
| [src/organizations/org-members.service.ts](../../../../src/organizations/org-members.service.ts) | +13/−6 | результат `queueInvitationAsync` → `emailQueued` |
| [src/organizations/org-members.controller.ts](../../../../src/organizations/org-members.controller.ts) | +3/−3 | JSDoc ответа инвайта |
| [docs/development/api-contract.json](../../../api-contract.json) | +1/−1 | `InviteMemberResponse`: добавлен `emailQueued` (список отсортирован) |

**Итого backend production:** +115/−26 (без нового DTO; с DTO — +150/−26).

### 1.3 Backend — тесты

| Файл | +/− | Что |
|---|---:|---|
| [src/llm/llm.controller.spec.ts](../../../../src/llm/llm.controller.spec.ts) | +89/−1 | моки health/router; 5 тестов `/llm/health` (online, unknown, unavailable, routerEnabled=false, делегирование) |
| [src/llm/llm-health.service.spec.ts](../../../../src/llm/llm-health.service.spec.ts) | +38/−0 | `getLastCheckAt`: `''` до проверки, ISO после успешной/неуспешной |
| [src/llm/llm-router.service.spec.ts](../../../../src/llm/llm-router.service.spec.ts) | +22/−0 | `isEnabled()`: true/false/не задана |
| [src/organizations/org-members.service.spec.ts](../../../../src/organizations/org-members.service.spec.ts) | +9/−3 | `emailQueued: true`; тест Redis-сбоя → `emailQueued: false` |
| [src/organizations/org-members.controller.spec.ts](../../../../src/organizations/org-members.controller.spec.ts) | +5/−3 | фикстура + assertion `emailQueued` в 201 |

**Итого backend-тесты:** +163/−7. Прирост: **+10 тестов** (1891 → 1901 passed).

### 1.4 Web — production

| Файл | +/− | Что |
|---|---:|---|
| [web/src/components/TopBar.tsx](../../../../web/src/components/TopBar.tsx) | +75/−1 | индикатор GPU: опрос при mount + `setInterval(30_000)`, `cancelled`/`clearInterval`, точка + текст + `data-gpu-status` |
| [web/src/components/TeamPage.tsx](../../../../web/src/components/TeamPage.tsx) | +10/−6 | выбор сообщения по `emailQueued`, JSDoc |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +50/−0 | `LlmHealthResponseSchema`, `fetchLlmHealthAsync()` |
| [web/src/lib/org-api.ts](../../../../web/src/lib/org-api.ts) | +16/−10 | `emailQueued` в зеркале контракта, JSDoc |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +4/−2 | `topbar.gpu.*`; новые тексты `team.invite.success*` |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +4/−2 | то же (набор ключей совпадает) |

**Итого web production:** +159/−21.

### 1.5 Web — тесты

| Файл | +/− | Что |
|---|---:|---|
| [web/src/components/TopBar.spec.tsx](../../../../web/src/components/TopBar.spec.tsx) | +142/−4 | +5 тестов: online, ошибка→offline, `available:false`, повтор через 30 с, unmount без setState |
| [web/src/components/TeamPage.spec.tsx](../../../../web/src/components/TeamPage.spec.tsx) | +45/−8 | фикстура `emailQueued`; тест `false` → «письмо не отправлено»; новый `true` → «(в очереди)» |
| [web/src/lib/api-contract.spec.ts](../../../../web/src/lib/api-contract.spec.ts) | +9/−4 | зеркало ответа инвайта: оба поля, контракт |

**Итого web-тесты:** +196/−16. Прирост: **+6 тестов** (493 → 499 passed).

### 1.6 Документация

| Файл | +/− | Что |
|---|---:|---|
| [README.md](../../../../README.md) | +38/−7 | разделы «LLM Router» и «SMTP Retry»; организация/приглашения — очередь и `emailQueued`; таблица «Статус проекта» актуализирована (было v0.11.1/1439/419/513) |
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +14/−0 | `[Unreleased] → Added`: S3, ссылка на отчёт, KI-618/KI-622, ограничения |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +69/−35 | KI-618/KI-622 → Fixed; KI-626..628; удалены дубли KI-622..625; сводка 615 |
| [docs/development/reports/README.md](../README.md) | +1/−0 | строка v1.2.0 S3 |

**Итого документация:** +122/−42 плюс этот отчёт.

### 1.7 Точечный diff по закрытию KI (RULES 2.12)

**`docs/KNOWN_ISSUES.md` — KI-618**

```text
Найти:  - **Приоритет:** 🟢 Low | **Статус:** Planned | **Обнаружено:** 2026-11-06
Заменить: - **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.2.0 (S3) | **Обнаружено:** 2026-11-06
```

**`docs/KNOWN_ISSUES.md` — KI-622**

```text
Найти:  - **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-06
Заменить: - **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.2.0 (S3) | **Обнаружено:** 2026-11-06
```

**`docs/KNOWN_ISSUES.md` — дубли KI-622..625**

```text
Найти:  секцию «### KI-622 — `emailSent` всегда `false`» … «### KI-625 — Без SMTP_HOST job делает 3 попытки»
Заменить: (удалено; подробные записи KI-622..625 остались выше)
```

**`docs/KNOWN_ISSUES.md` — сводка**

```text
Найти:  | Fixed | 263 | … | **Итого** | **612** |
Заменить: | Fixed | 265 | Fixed (частично) | 8 | Open | 283 | Documented | 49 | … | **Итого** | **615** |
```

**`docs/CHANGELOG.md`**

```text
Найти:  ### Added
Заменить: ### Added
           - **Индикатор GPU и `emailQueued` (v1.2.0 S3, DESIGN V120 § 3.4;
             KI-618, KI-622)** ([отчёт](development/reports/v1.2.0/S3-ui-docs.md)): …
```

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **127 passed (127 файлов), 1901 passed / 2 skipped (1903)**, 58.2 с |
| `pnpm test:parity` | **13/13** |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule`) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — преэкзистующие (`openai-images.provider.spec.ts`) |
| `pnpm --dir web test` | **54 passed (54 файла), 499 passed (499)**, 57 с |
| `pnpm --dir web build` | exit 0, `tsc -b` + Vite, **0 ошибок**, 505 мс |
| Смоук (живое приложение) | **18/18 PASS, 0 FAIL** |

Прирост к HEAD (S2, 1891 passed): backend **+10 тестов**, web **+6 тестов**.
Скипнутые 2 теста — прежние `openai-images.integration` (нет ключа Images,
`skipIf`). Миграций S3 не добавляет.

**Диагностическая деталь гейта.** Первый прогон `pnpm test` дал 1 падение —
`src/db/schema-parity.spec.ts` («users.token_version отсутствует в БД»).
Это состояние локальной БД (не применена миграция `0018_daffy_triathlon.sql`
из v1.1.0 S5), а не код S3: в CI шаг `Apply migrations` идёт до тестов
(RULES 3.19). После `pnpm db:migrate` гейт зелёный (1901 passed, 13/13 parity,
1/1 e2e). Факт зафиксирован в § 5.

---

## 3. Диагностика

### 3.1 `lastCheck`: пустая строка и ISO

`lastCheck` обновляется в `applyResult`, то есть **после завершённой проверки**
(успешной или нет). Если локальный провайдер не сконфигурирован
(`findLocalProvider() === undefined`), `checkAsync` выходит до `applyResult`, и
`lastCheck` остаётся `''`: «проверок не было» — честнее, чем подставлять время
запуска. UI использует только `available`, поэтому пустая строка на индикатор
не влияет; контракт ручки описан в JSDoc DTO.

### 3.2 Почему `available` — boolean, а не статус

`getStatus()` возвращает `unknown | available | unavailable` (DESIGN V120
§ 3.2). Задача S3 фиксирует ответ `{ local: { available: boolean, ... } }`,
поэтому `unknown` и `unavailable` сворачиваются в `false` — для индикатора
«GPU online/offline» это одно состояние. Различие видно по `lastCheck` и
логам; если оператору понадобится трёхзначный статус, поле можно расширить
(`status`) без ломки `available`.

### 3.3 `GET /llm/health` вне auth-guard

У `LlmController` нет `JwtAuthGuard` и для `GET /llm/models`: SPA — внутренний
клиент, а глобального guard'а в `AppModule` нет (только `ThrottlerGuard`).
KI-618 в решении упоминал «под auth», но менять модель доступа `/llm/models`
в S3 не стали: это отдельное решение. Новый риск зафиксирован как KI-626.

### 3.4 `GET /llm/health` не в field-level паритет-гейте

`api-contract.json` покрывает REST-ответы, но `Llm*`/`Media*` зеркала
намеренно вне KI-352 (KI-357). Добавление `LlmHealthResponse` в контракт
расширило бы scope гейта (нужны записи в обоих spec'ах и JSON), а задача S3
требовала обновить контракт только для `InviteMemberResponse`. Решение
задокументировано как KI-627 с готовым планом расширения.

### 3.5 Почему `emailQueued`, а не изменение `emailSent`

`emailSent` — поле контракта v1.1.0; клиенты и паритет-гейт его знают.
Менять смысл поля повторно (сейчас всегда `false`) или удалять его — ломать
совместимость. Поэтому `emailSent` оставлен как «доставка не подтверждена»,
а новый `emailQueued` несёт ровно то, что знает HTTP-ответ: задание
поставлено в BullMQ (`true`) или очередь/Redis недоступна (`false`).
`queueInvitationAsync` уже возвращал `boolean` — API просто пробрасывает его.

### 3.6 `getStatus()` vs `getLastCheckAt()` в контроллере

Постановка S3 требовала использовать `getStatus()`. Он отдаёт только статус,
поэтому для `lastCheck` добавлен отдельный геттер: контроллер вызывает оба,
не дублируя логику и не читая приватное поле. `isEnabled()` в
`LlmRouterService` добавлен по той же причине — `enabled` был приватным.

### 3.7 Chrome в смоуке: относительный `--user-data-dir`

Первый прогон смоука упал на `CDP endpoint Chrome (30000 мс)`: профиль
передавался относительным путём (`.smoke/v120-s3-chrome`), и headless Chrome
не создавал его (каталог остался пустым). После замены на абсолютный путь
(`resolve(...)`) и очистки профиля перед запуском CDP поднялся. Это дефект
смоук-скрипта, не продукта; в отчёте — чтобы не повторять.

### 3.8 Дубли KI-622..625 в реестре

На HEAD `bb8e4ff` в `docs/KNOWN_ISSUES.md` было **616** заголовков `### KI-`
при **612** уникальных номерах: после подробных записей S2 шла вторая секция
с краткими дублями KI-622..625. Отчёт S2 утверждал «дублей номеров нет» —
фактически они были (заголовки не совпадали с подсчётом уникальных). В S3
краткие дубли удалены, подробные оставлены; сводка пересчитана grep'ом
(RULES 3.20): 615 записей, 615 статусов, номера уникальны.

### 3.9 TopBar переполняется на 1424 px

CDP-скриншоты показывают схлопнутую колонку имени и вертикальный копирайт.
Проверка в живом DOM: логотип загружается (`logo.svg` 200, naturalWidth 239,
рендер 21.9×24), шапка `height: 56`, `scrollY: 0` — значит дело не в логотипе,
а в переполнении однострочного flex. Проблема была и до S3
(`.smoke/v100-s5-team-ui.png`), индикатор добавляет ~70 px и усугубляет её.
Заведён KI-628; фикс — отдельная UI-задача (адаптивные подписи/перенос).

### 3.10 Почему прогон смоука перезапускает backend

Индикатор offline нужно увидеть в реальном UI, а healthcheck переходит в
`unavailable` только после 3 неудач подряд (до 90 с). Поэтому фаза 2
останавливает mock LM Studio и перезапускает backend: первый же пинг при
старте даёт `available: false`, страница перезагружается и индикатор
показывает offline. Это быстрее и детерминированнее ожидания порога.

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder` (миграции
применены), Redis `127.0.0.1:6379`, backend — `node dist/main.js` на **3100**
(3000 занят сторонним контейнером `ai-project-monitoring-frontend`, SPA
отдаётся тем же backend'ом из `web/dist`), mock LM Studio — `127.0.0.1:3098`.
Env смоука: `LLM_ROUTER_ENABLED=true`, `LLM_ROUTER_FALLBACK_MODEL=gpt-4o-mini`,
`LMSTUDIO_BASE_URL=http://127.0.0.1:3098/v1`,
`LMSTUDIO_MODELS=mock-local-model`, `BULLMQ_PREFIX=smoke-v120-s3`,
`SMTP_HOST=''` (письмо в очередь ставится, но не отправляется). Скрипт
`.smoke/v120-s3-ui-smoke.mjs`; итог **18/18 PASS, 0 FAIL**,
`generatedAt = 2026-11-06T09:37:18.757Z` (финальный прогон).

### 4.1 Healthcheck API

| Проверка | Факт |
|---|---|
| `GET /llm/health` (LM Studio поднят) | `{"local":{"available":true,"lastCheck":"2026-11-06T09:37:10.635Z"},"routerEnabled":true}` |
| `lastCheck` | ISO-8601, `Date.parse` валиден |
| Пинги mock `/v1/models` | 2 (каталог провайдеров + healthcheck при старте) |
| `GET /llm/models` | 200, `lmstudio:mock-local-model` в списке |
| `GET /llm/health` (LM Studio выключен, backend перезапущен) | `{"local":{"available":false,"lastCheck":"2026-11-06T09:37:17.609Z"},"routerEnabled":true}` |

### 4.2 `emailQueued` и очередь

| Проверка | Факт |
|---|---|
| `POST /admin/members/invite` | **201** |
| `emailQueued` | **true** |
| `emailSent` | **false** |
| BullMQ `email-invitations` (prefix `smoke-v120-s3`) | `waiting 0 / active 0 / delayed 1 / completed 0 / failed 4` — задание этого прогона в `delayed` (backoff после неудачной попытки без SMTP); `failed` — хвосты предыдущих smoke-прогонов/ретраев (KI-625), проверка `jobsTotal > 0` пройдена |
| SMTP-поведение | письмо не отправлено (SMTP намеренно не настроен), приглашение в БД; 3 попытки воркера — ожидаемо |

### 4.3 UI: индикатор GPU

| Проверка | Факт |
|---|---|
| `[data-gpu-status]` при поднятом LM Studio | `online` |
| Текст | `GPU: online` |
| Точка | `bg-green-500` (зелёная) |
| После выключения LM Studio + перезапуска backend | `data-gpu-status="offline"`, текст `GPU: offline`, точка `bg-slate-400` |
| Консоль/страница | 0 consoleErrors, 0 pageErrors; 1 logError — `401` на `/auth/refresh` при первой загрузке до логина (ожидаемо: AuthProvider пробует refresh без cookie) |

Скриншоты: `.smoke/v120-s3-ui-online.png` (зелёная точка + форма), 
`.smoke/v120-s3-ui-invite.png` (приглашение и сообщение «(в очереди)»),
`.smoke/v120-s3-ui-offline.png` (серая точка).

### 4.4 UI: emailQueued

| Проверка | Факт |
|---|---|
| Вход через UI (форма `/login`) | успешный, TopBar загрузился |
| Модалка «Команда» → форма приглашения | открылась |
| `POST /admin/members/invite` из UI | 201 |
| Сообщение | «Приглашение отправлено (в очереди): smoke-s3-ui-invitee-…@example.com» |
| Список «Ожидают регистрации» | приглашение появилось (2 строки: API + UI) |

### 4.5 Уборка

Организация смоука удалена каскадом (`DELETE FROM organizations … RETURNING
id`, `rowCount=1`), очередь smoke-префикса очищена, backend/mock/Chrome
остановлены; порты 3100/3098/9223 освобождены. Артефакты —
`.smoke/v120-s3-ui-smoke.json` (18 проверок), `.smoke/v120-s3-backend.log`,
три PNG — все gitignored.

---

## 5. Что не так

1. **`GET /llm/health` доступен без аутентификации (KI-626, 🟢 Low).**
   У контроллера нет guard'а (как и у `GET /llm/models`); KI-618 предполагал
   «под auth». Ответ не содержит секретов, но раскрывает инфраструктурное
   состояние анонимному клиенту. Осознанно оставлено ради совместимости с
   текущей моделью доступа SPA.
2. **`GET /llm/health` не покрыт паритет-гейтом (KI-627, 🟢 Low).** Новый
   REST-ответ не описан в `api-contract.json` (LLM-зеркала вне KI-352/KI-357);
   состав полей сверяется только Zod-парсингом в рантайме и смоуком.
3. **TopBar переполняется при ширине ~1424 px (KI-628, 🟢 Low).** Проблема
   преэкзистующая (видна на скриншоте v1.0.0 S5), но индикатор GPU добавляет
   ~70 px и делает переполнение заметнее: input имени обрезается, копирайт
   переносится по буквам. Отдельная UI-задача.
4. **`lastCheck = ''` при не сконфигурированном локальном провайдере.** Это
   следует из решения «обновлять только в `applyResult`»; для UI безразлично,
   но внешний потребитель контракта должен трактовать `''` как «проверок не
   было», а не как ошибку. Задокументировано в DTO.
5. **Живой сценарий `emailQueued: false` не проверен смоуком.** Чтобы получить
   `false`, нужен недоступный Redis: останавливать общий dev-Redis ради смоука
   не стали. Путь покрыт юнит-тестом `org-members.service.spec.ts`
   («очередь недоступна» → `emailQueued: false`, `emailSent: false`) и
   типизирован в контракте; UI-текст для `false` проверен компонентным тестом.
6. **Первый `pnpm test` упал на `schema-parity`.** Локальная БД отставала на
   миграцию `0018` (`users.token_version`). После `pnpm db:migrate` — зелёный
   прогон. В CI миграции применяются до тестов (RULES 3.19), так что это не
   регрессия кода; но локальный гейт без миграций красный.
7. **`pnpm lint` — 2 преэкзистующих warning'а** в
   `openai-images.provider.spec.ts` (чужие файлы, не трогали).
8. **Дубли KI-622..625 в реестре.** На HEAD было 616 заголовков при 612
   уникальных номерах (вторая секция кратких дублей). Удалены; отчёт S2
   ошибочно утверждал, что дублей нет.
9. **README «Статус проекта» был устаревшим.** До S3: `v0.11.1`, 1439
   backend-тестов, 419 frontend, KI-525/513. Актуализирован по факту HEAD:
   `v1.1.0 (v1.2.0 в разработке)`, 1901/499 тестов, KI-628/615. Версия в
   `package.json` — по-прежнему `1.1.0`; поднять её — шаг S4 (релиз).
10. **`USER_GUIDE.md` / `MANUAL_TESTING_GUIDE.md` не обновлялись.** DESIGN
    V120 § 3.4 упоминает USER_GUIDE, но RULES 2.16 делает гайды release-gate
    (`vX.Y.Z`), то есть S4. В S3 ограничились README по постановке. В гайде
    также остались устаревшие с v1.1 фрагменты (приглашение по UUID) — это
    отдельная задача S4, а не регрессия S3.
11. **Смоук-артефакты содержат «провал» первого прогона.** В `backend.log`
    видны три неудачные попытки job'а (SMTP не настроен) — ожидаемое поведение
    KI-625, а не ошибка S3; `emailQueued: true` при этом корректен.
12. **CDP-смоук зависит от Chrome и свободных портов 3100/3098/9223.** На этой
    машине 3000 занят сторонним контейнером, поэтому SPA отдавалась тем же
    backend'ом на 3100 (без Vite-прокси) — это проверяет прод-путь
    `ServeStaticModule`, но не dev-прокси.
13. **`failed: 4` в `getJobCounts` на первом чтении.** Это хвосты предыдущих
    smoke-прогонов (job'ы 1–4) и ретраев без SMTP; проверка смоука — наличие
    задания (`jobsTotal > 0`) и `emailQueued: true` из HTTP-ответа. Очередь
    после смоука очищена.
14. **Коммитов нет.** Все изменения — в рабочем дереве; `git status` показывает
    modified + один untracked `src/llm/dto/`. Согласно постановке, коммит
    делает человек/следующий шаг.

---

## 6. Новые KI

Всего **3** новых записи (KI-626..628), KI-618 и KI-622 закрыты. Реестр
пересчитан grep'ом (RULES 3.20): **615** записей, 615 статусов, номера
уникальны; дубли KI-622..625 удалены.

| KI | Приоритет | Статус | Тема |
|---|---|---|---|
| [KI-626](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `GET /llm/health` без auth-guard |
| [KI-627](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `GET /llm/health` не в field-level паритет-гейте |
| [KI-628](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | TopBar переполняется на ширине ~1424 px (преэкзистующее, усилено индикатором) |

Закрыты: [KI-618](../../../KNOWN_ISSUES.md) (healthcheck наружу → `GET
/llm/health` + индикатор) — **Fixed**; [KI-622](../../../KNOWN_ISSUES.md)
(`emailSent` не отличает «в очереди» от «не поставлено» → `emailQueued`) —
**Fixed**.

---

## 7. Обоснование решений

1. **`emailQueued` отдельным полем, а не переиспользование `emailSent`.**
   Контракт v1.1.0 (`emailSent`) уже в паритет-гейте и у клиентов; менять его
   смысл третий раз или удалять — ломать совместимость. `emailQueued` —
   ровно то, что знает HTTP-ответ: `queue.add` вернул `true/false`.
   `emailSent` оставлен как «доставка не подтверждена» (всегда `false`),
   чтобы старые клиенты не падали.
2. **Текст по `emailQueued`, а не по `emailSent`.** `emailSent` теперь
   константа, поэтому выбор сообщения по нему всегда давал бы одну ветку.
   `TeamPage` переключён на `emailQueued`; тексты обновлены в обоих языках,
   устаревшее упоминание «SMTP не настроен» убрано (ложно: очередь может
   стоять и быть недоступной).
3. **`GET /llm/health` — плоский объект без `{ success, data }`.** Как у
   `GET /llm/models`: ручка внутренняя для SPA, формат ошибок остаётся
   глобальным (`HttpExceptionFilter`), RULES 1.6 не нарушен.
4. **`available` — только `status === 'available'`.** `unknown` и
   `unavailable` для индикатора одинаково «офлайн»; трёхзначный статус можно
   добавить позже отдельным полем, не ломая `available`.
5. **`lastCheck` — ISO-строка, `''` при отсутствии проверок.** Постановка
   требует `string`; ISO совместим с JSON/`Date.parse`. Пустая строка —
   честный маркер «проверок не было» (локальный провайдер не настроен),
   а не подставленное время старта.
6. **Последняя проверка обновляется и при неудаче.** «Последняя проверка» —
   это завершившийся пинг, независимо от исхода; иначе при выключенном
   LM Studio `lastCheck` «замирал» бы на последнем успехе и вводил в
   заблуждение.
7. **Healthcheck не зависит от `LLM_ROUTER_ENABLED`.** Уже зафиксировано в
   S1 (DESIGN § 3.4): статус нужен индикатору, даже если роутер выключен.
   `routerEnabled` отдаётся рядом, чтобы UI/оператор видел, влияет ли GPU на
   маршрутизацию.
8. **Ручка без auth-guard — сохранение текущей модели доступа.** `GET
   /llm/models` тоже публичный; добавлять guard только на health — значит
   создать непоследовательную политику. Риск зафиксирован KI-626, чтобы
   решение было явным, а не случайным.
9. **Health не добавлен в `api-contract.json`.** Гейт KI-352/KI-357 намеренно
   не покрывает `Llm*`/`Media*`; расширение требует правок обоих spec'ов и JSON
   и выходит за постановку S3 («обнови контракт для `emailQueued`»). План —
   KI-627.
10. **TopBar: опрос 30 с, немедленный первый запрос, ошибка → offline.**
    Период совпадает с backend-healthcheck (`LLM_HEALTH_INTERVAL_MS`): чаще —
    нет новых данных, реже — индикатор отстаёт после восстановления LM Studio.
    Ошибка запроса — не уведомление, а offline: healthcheck фоновый.
11. **Начальное состояние — offline.** До первого ответа backend'а о GPU
    ничего не известно; показывать зелёный «по умолчанию» — обещать
    недоступное. Серая точка на долю секунды — осознанный компромисс.
12. **`data-gpu-status` — контракт для смоука.** Атрибут позволяет проверять
    индикатор без хрупких CSS-селекторов и текста (текст зависит от языка);
    смоук проверил и атрибут, и текст, и класс точки.
13. **i18n: переиспользованы ключи `team.invite.success*`.** Новых ключей для
    email не вводили — изменили значения (очередь вместо «отправлено»);
    набор ключей ru/en остался одинаковым, i18n-паритет зелёный. Для GPU
    добавлены два новых ключа `topbar.gpu.online/offline`.
14. **README: два новых h3-раздела вместо правки «Быстрого старта».** Задача
    просила разделы «LLM Router» и «SMTP Retry»; они встроены в «Возможности»
    (h3), где уже живут подсистемы, а не в инструкцию по установке. Заодно
    актуализирована таблица «Статус проекта» — иначе README противоречил HEAD.
15. **`USER_GUIDE` оставлен на S4.** RULES 2.16 — release gate: перед
    `v1.2.0` гайды обязательны; делать их в S3 вместе с README означало бы
    дважды править один и тот же раздел. Зафиксировано в § 5, п. 10.
16. **Смоук перезапускает backend, а не ждёт 90 с.** Порог «3 неудачи»
    детерминированно проверен юнит-тестами; для UI-индикатора важно показать
    оба состояния в реальном браузере. Перезапуск даёт offline сразу.
17. **Диагностические скрипты удалены.** `v120-s3-header-check.mjs` и
    `v120-s3-db-cleanup.mjs` использовались для проверки логотипа/переполнения
    и уборки БД; после получения фактов удалены (RULES 3.13). Основной
    smoke-скрипт и артефакты оставлены в `.smoke/` как воспроизводимый
    артефакт отчёта (gitignored).
