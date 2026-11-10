# Известные проблемы IIChatTools AI Workflow Builder

Файл ведётся с версии 0.1.0 (октябрь 2026).
Формат: `KI-XXX` — название, приоритет, статус, файлы.

Приоритеты: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
Статусы: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved

---

## v0.1.0 — Initial scaffold (2026-10-12)

> На старте проекта реестр пуст. Все проблемы, найденные при разработке,
> добавляются сюда с номерами `KI-001`, `KI-002`, ...

### KI-400 — Гонка duplicate-invite → 500
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/workflow/workflow.service.ts` (`inviteCollaboratorAsync`)
- **Описание:** Проверка «уже участвует» и INSERT не в транзакции. Два
  параллельных запроса могут оба пройти pre-check, второй упадёт на PK
  constraint (500) вместо 409.
- **Решение:** ловить unique_violation (23505) → throw `ConflictException`.
- **Связанные:** KI-197.

---

### KI-297 — Устаревший комментарий и мёртвый null-fallback в `findSharedAsync`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/workflow.service.ts`
- **Описание:** Комментарий «В Drizzle-схеме createdAt без .notNull()»
  неверен — схема объявляет `.notNull()`, а после KI-293-fix колонка
  NOT NULL и в БД. Выражение `found.createdAt ?? new Date()` —
  недостижимая ветка.
- **Решение:** удалить комментарий и `?? new Date()`.
- **Связанные:** KI-293, KI-296.

---

### KI-294 — `ImportWorkflowSchema.name` без `.max(200)`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/dto/export-workflow.dto.ts`
- **Описание:** `CreateWorkflowSchema.name` ограничивает 200 символами,
  `ImportWorkflowSchema.name` — только `.min(1)`. Импорт может создать
  запись, несовместимую с лимитом `POST /workflow`.
- **Решение:** `.max(200)` в обеих схемах.
- **Связанные:** KI-108.

---

### KI-500 — Двойной retry SDK + движок (High)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.11.1 (S1) — отчёт
  [S1-hardening.md](development/reports/v0.11.1/S1-hardening.md).
- **Файлы:** `src/llm/providers/openai-compatible.provider.ts`,
  `src/llm/providers/anthropic.provider.ts`, спеки провайдеров, фабрики и
  движка.
- **Описание:** OpenAI/Anthropic SDK повторяют 429/5xx сами (`maxRetries=2`),
  движок — до 3 раз. Worst case — 9 upstream-вызовов/оплат на узел.
- **Fix:** оба SDK создаются с `maxRetries: 0`; повторы остаются только у
  движка (`NODE_RETRY_MAX_ATTEMPTS`) и видны в `node_runs.logs`. Smoke с
  локальным upstream 429: ровно 1 HTTP-запрос на каждый провайдер.
- **Связанные:** KI-036, KI-042, KI-104, KI-523.

---

### KI-592 — Отправка письма синхронна: SMTP-задержка входит в HTTP-запрос
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S3) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`,
  `src/email/email.service.ts`
- **Описание:** `inviteAsync` ждёт `sendInvitationAsync` внутри
  `POST /admin/members/invite`; очередь/outbox в v1.1.0 S1 не вводились
  (DESIGN V110 § 3.1 их не требует). При медленном SMTP владелец ждёт до
  таймаута (`connectionTimeout` 10 с, `socketTimeout` 20 с), серия приглашений
  отправляется последовательно, а недоступный провайдер напрямую увеличивает
  latency административной ручки. Приглашение при этом уже в БД — страдает
  только время ответа.
- **Решение:** вынести отправку в BullMQ-очередь (в проекте уже есть Redis +
  BullMQ): 201 сразу с `emailSent: 'queued'` (изменение контракта
  `InviteMemberResponse`, потребует синхронизации web-зеркала), ретраи и
  статус доставки; либо оставить синхронно, но ограничить таймаут 3–5 с.
- **Связанные:** KI-584, KI-593, KI-567.

### KI-529 — MCP `stdio`: нет способа передать env-переменные
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.13.0 (S1) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp.config.ts`, `src/mcp/mcp-client.service.ts`
- **Описание:** Серверы, которым нужен токен (GitHub, БД), нельзя запустить без записи секрета в JSON.
- **Решение:** `MCP_STDIO_ENV_ALLOWLIST` в v0.13.

### KI-423 — POST /auth/register и /auth/refresh без строгого лимита
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/auth/auth.controller.ts`
- **Описание:** Строгий лимит есть только у login.
- **Решение:** `@Throttle` для register (3/час) и refresh (30/мин).

---

### KI-098 — Vision-возможности GPTunnel объявляются вручную
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `.env.example` (пример `GPTUNNEL_MODELS`)
- **Описание:** Пользователь сам решает, что писать в env. Если
  указать `text` для vision-модели — UI не покажет badge `[V]`,
  хотя вызов с картинкой сработал бы.
- **Решение:** данные, не баг. Возможна проверка через curl при
  обновлении env.
- **Связанные:** KI-094.

---

### KI-412 — S3 media storage: заглушка без загрузки
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 — реализован `S3MediaStorage` (PutObjectCommand).
- **Дополнено в:** v0.10.2 — S3 SDK грузится лениво (`src/media/s3-sdk.ts`);
  при отсутствии пакета или конфигурации хранилище откатывается на `local`,
  не роняя старт процесса.
- **Fix:** добавлен `@aws-sdk/client-s3`; `S3MediaStorage` скачивает результат
  и кладёт объект `PutObjectCommand` (`S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
  ключи из env). Без ключей/бакета `createMediaStorage` откатывается на
  `local`, а сбой S3/upstream возвращает `null` (узел живёт на ссылке
  провайдера). Тесты — мок `S3Client.send`.
- **Файлы:** `src/media/media-storage.service.ts`, `package.json`
- **Остаток:** закрытый бакет и TTL объектов S3 — KI-425, KI-426.
- **Связанные:** KI-362, KI-413.

---

### KI-533 — Глобальный `MCP_STDIO_ENV_ALLOWLIST` отдаёт все env всем серверам
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp-client.service.ts`
- **Описание:** Allowlist один на процесс. При двух stdio-серверах каждый получает все разрешённые переменные, даже если они нужны только одному.
- **Решение:** per-server `envAllowlist` в `MCP_SERVERS`.

### KI-064 — `run_completed` публикуется только процессором (скрытый контракт)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/runs/runs.processor.ts`
- **Описание:** Любой другой вызов `executeAsync` (локальный прогон,
  будущий «Run in-process», интеграционный тест) **не опубликует**
  `run_completed`, и SSE-клиент повиснет.
- **Решение:** либо задокументировать инвариант «`executeAsync`
  всегда вызывается процессором», либо вернуть публикацию в executor
  через явный `onComplete`, вызываемый **после** try/catch.
  (Callback внутри try/catch не работает — `final` ещё неизвестен;
  см. KI-060 в отчёте.)
- **Статус-кво:** инвариант зафиксирован в JSDoc обеих сторон.
- **Когда чинить:** при появлении второго вызывающего `executeAsync`.
- **Связанные:** KI-060 (закрыт).

---

### KI-478 — Узел `http` уязвим к SSRF (High)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.10.2 — узел `http` использует общий
  `fetchWithSsrfGuardAsync` (`src/common/utils/network-safety.ts`):
  блокировка приватных, loopback, link-local (включая metadata
  `169.254.169.254`) и служебных IPv4/IPv6, DNS-резолв с проверкой всех
  адресов, `redirect: 'manual'` с проверкой каждого `Location`. Аварийное
  выключение — `ALLOW_PRIVATE_IPS=true` (default `false`).
- **Файлы:** `src/engine/node-executors.ts`,
  `src/common/utils/network-safety.ts`,
  `src/engine/execution-engine.service.ts`, `.env.example`
- **Описание:** `executeHttpNode` вызывает `fetch` напрямую: нет проверки схемы
  и приватных IPv4/IPv6, нет блокировки metadata-адресов и нет
  `redirect: 'manual'`. В отличие от `http_request` (KI-409), где
  `assertPublicHttpUrlAsync` уже стоит, узел `http` может обратиться к
  internal-сервису или metadata-endpoint (`169.254.169.254`), а также уйти на
  приватный адрес по цепочке redirect'ов.
- **Решение:** использовать общий `SafeHttpClient` из DESIGN v0.11 § 3.5:
  резолв + блокировка приватных диапазонов, `redirect: 'manual'` с повторной
  проверкой каждого `Location`, pinning IP. Для доверенных инсталляций —
  явный env-флаг (DESIGN v0.11 § 7.7, вопрос 7).
- **Связанные:** KI-409, KI-434, KI-435, DESIGN v0.11 § 1.2/§ 3.5.

---

### KI-398 — `GET /workflow` не включает collaborative workflows
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.2 — `findAllAsync` отдаёт collaborative workflows с
  `accessRole` (`workflowAccessRoleExpression`).
- **Файлы:** `src/workflow/workflow.service.ts` (`findAllAsync`)
- **Описание:** Пользователь видит в списке только свои workflow. Чтобы
  открыть чужой workflow как участник — только прямая ссылка `?workflowId=`.
- **Решение:** расширить `findAllAsync` через `OR EXISTS` (как в
  `buildAccessFilter`); отдавать `accessRole` в ответе.
- **Связанные:** KI-197, KI-397.

---

### KI-399 — Collaborators-ответ без владельца
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.2 — owner первой строкой в списке участников
  (`WorkflowParticipantRole`; в `workflow_collaborators` владелец не пишется).
- **Файлы:** `src/workflow/workflow.service.ts`,
  `src/workflow/dto/collaborator.dto.ts`
- **Описание:** DESIGN § 3.6 обещает «owner + participants», API отдаёт
  только участников (`workflow_collaborators`). UI определяет owner по
  `workflow.userId`.
- **Решение:** добавить owner-строку с `role='owner'` (расширить enum) или
  зафиксировать в DESIGN, что owner приходит из `workflow.userId`.
- **Связанные:** DESIGN v0.9 § 3.6.

---

### KI-591 — «Команда» — модалка без deep-link и без восстановления после F5
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S3) | **Обнаружено:** 2026-11-03
- **Файлы:** `web/src/components/TopBar.tsx`, `web/src/components/TeamPage.tsx`
- **Описание:** `TeamPage` — локальное состояние `TopBar` (`isTeamOpen`), как у
  `ShareModal`/`LoadModal`. Ссылку на модалку или конкретную вкладку (`?team=1`,
  `?team=audit`) отправить нельзя, после F5 окно закрыто. У истории запусков
  deep-link есть (`?runId=`), у команды — нет.
- **Решение:** добавить URL-параметр `team` (`members|audit`) по аналогии с
  `syncWorkflowUrlParam` и открывать модалку из него при загрузке.
- **Связанные:** KI-541, KI-542.

## v1.1.0 — SMTP & Invitations (S1, 2026-11-03)

### KI-196 — Медиа-инструменты (upscale, bg-removal, lipsync, 3D, motion)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.9.0 (R7.1) — пять операций `image_tool`:
  upscale / bg-removal / chromakey / trim / lipsync.
- **Fix:** узел `image_tool` реализован, операции имеют Zod-схемы,
  маршрутизацию и UI (`ImageToolNode`). Остаток — 3D-сцена и
  motion-ролик — не входил в R7.1 и вынесен в отдельный KI-475.
- **Файлы:** `src/media/image-tool.ts`,
  `web/src/components/nodes/ImageToolNode.tsx`
- **Историческое описание:** GPTunnel: Photoshop / Видеоредактор /
  3D-сцена / Моушн-ролик / Удалить фон / Липсинк / Апскейл / Хромакей /
  Обрезка. В v0.9.0 закрыты пять операций, 3D/Motion остались за срезом.
- **Решение:** отдельные узлы-инструменты под каждый тип (для каждого
  — свой payload, могут использовать image-input).
- **Связанные:** KI-128, KI-105, KI-181, KI-475.

---

### KI-119 — Пустой каталог media блокирует Run с некорректным текстом
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/TopBar.tsx`
- **Описание:** Если `GET /media/models → []` (провайдер не
  сконфигурирован) или запрос упал, `findImageNodesWithoutModel`
  вернёт все image-узлы, и Run заблокируется с сообщением «Выберите
  image-модель в узлах». Текст вводит в заблуждение: выбрать неоткуда.
- **Решение:** различать «каталог пуст/не загружен» и «модель не
  выбрана» разными сообщениями.
- **Связанные:** KI-074.

---

### KI-155 — Frontend не может тестировать компоненты
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.9.2 — `web/vitest.config.ts`: `environment: 'jsdom'`,
  алиас `@`, `include` для `.tsx` и `setupFiles` (`@testing-library/jest-dom`).
- **Файлы:** `web/vitest.config.ts`
- **Описание:** `environment: 'node'`, `include` без `.tsx` и отсутствие алиаса
  `@/` делают невозможным импорт любого компонента в тест: `@/…` не резолвится
  (проверено — `Cannot find package '@/i18n'`), а `@/i18n` вдобавок обращается к
  `document` на этапе импорта (`ReferenceError: document is not defined`).
  Поэтому чистая логика вроде форматтеров не покрывается, а регрессы вроде
  KI-151 ловятся только глазами.
- **Решение:** добавить в `web/vitest.config.ts` алиас `@` (как в
  `vite.config.ts`), расширить `include` на `.tsx` и перейти на
  `environment: 'jsdom'`; чистые функции держать в `web/src/lib/*`.
- **Когда чинить:** v0.8 (инфраструктура тестов).
- **Связанные:** KI-068, KI-161.

---

### KI-130 — capabilities в реестре: расхождение DESIGN и реализации
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (docs-only)
- **Файлы:** `docs/development/v0.7/DESIGN_UI_SLICES.md` (§ 2)
- **Описание:** В DESIGN § 2 набор был `{ persistence, externalState }`,
  в реализации R5.1 — `{ externalState, userConfig }`. Критерий
  `userConfig` не определён: у `llm` стоит `false`, у
  `image_generation` — `true`, хотя оба требуют выбора модели.
  Попутно DESIGN § 5.1 (4 категории без `media`) противоречил
  § 5.2 (5 с `media`) — § 5.1 исправлен.
- **Fix:** Канонический набор — `{ externalState, userConfig }`
  (§ 2 DESIGN). Определения: `externalState` — узел хранит внешнее
  состояние (БД, индекс, память); `userConfig` — узел требует
  конфигурации пользователя до запуска (выбор модели, endpoint).
  Противоречие § 5.1/§ 5.2 убрано.
- **Связанные:** KI-128, KI-129.

---

### KI-231 — Multi-tab не координирует refresh-rotation
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/lib/api.ts` (`refreshSessionAsync`)
- **Описание:** Single-flight `refreshPromise` защищает **внутри
  одного таба** (и StrictMode double-effect), но **не между
  табами**. При F5 в двух табах одновременно — оба делают
  `POST /auth/refresh` с одной cookie; первый ротирует, второй
  получает 401 (revoked) и выбрасывает пользователя на /login.
- **Решение:** `BroadcastChannel` (или `navigator.locks`) для
  координации rotation между табами; альтернатива — backend
  rotation с grace-окном.
- **Когда чинить:** v0.8.x (multi-tab — реальный use-case).
- **Связанные:** KI-201, KI-224.

---

### KI-545 — Статус запуска называется по-разному в TopBar и панели результата
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/TopBar.tsx`, `web/src/components/RunResultPanel.tsx`,
  `web/src/components/RunHistoryModal.tsx`, `web/src/i18n/ru.json`
- **Описание:** Один и тот же статус `completed` показывается как «Готово» в
  кнопке Run (TopBar, `run.status.completed`), как «завершён» в заголовке панели
  результата (`runResultPanel` использует узельные подписи `run.status.node.*`)
  и как «Завершён» в бейдже истории (`history.status.*`). Найдено CDP-смоуком S2:
  после клика по завершённому запуску панель показывает «Запуск · завершён», а
  кнопка Run — «Готово». Поведение корректно, расходится только текст.
- **Решение:** вынести подписи статусов запуска в одну группу i18n
  (`run.status.*`) и использовать её в TopBar, панели результата и истории;
  для узлов оставить `run.status.node.*`. Косметика — при следующей правке i18n.
- **Реализовано в v0.16 S1:** единый неймспейс `status.*`
  (`pending`/`running`/`completed`/`failed`/`cancelled`/`skipped`, плюс
  `status.label` и `status.attempt`). Дубли `run.status.*`,
  `run.status.node.*`, `history.status.*` и `node.status.skipped` удалены из
  `ru.json`/`en.json`; TopBar, RunResultPanel и RunHistoryModal используют один
  набор подписей («Ожидает», «Выполняется», «Завершён», «Ошибка», «Отменён»).
  TopBar для `pending`/`running` больше не добавляет «…»/«Создаётся…» — текст
  тот же, что в остальных местах.

### KI-594 — Параметр `?invite=<uuid>` в письме не используется UI
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/email/email.service.ts`,
  `web/src/components/auth/LoginPage.tsx`
- **Описание:** ссылка в письме ведёт на `/login?invite=<uuid приглашения>`
  (непрозрачный id, email в URL не попадает), но `LoginPage` query-параметр не
  читает: регистрация «сжигает» приглашение по email (`registerAsync`), а сам
  uuid нигде не проверяется и не истекает. Ссылка работает как ориентир
  («зарегистрируйтесь»), но не как capability: переход по ней не предзаполняет
  email и не переключает форму на регистрацию.
- **Решение:** читать `?invite=`, переключать страницу в режим регистрации и
  предзаполнять email (запросив приглашение по id), показывать «приглашение
  недействительно/истекло»; для чувствительных сценариев — одноразовый
  токен-хэш вместо uuid.
- **Связанные:** KI-563, KI-588, KI-584.

### KI-015 — В `workflow_runs` нет `created_at`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `4ea0fb4`)
- **Файлы:** `src/db/schema.ts`, `src/runs/runs.service.ts`,
  `src/runs/dto/create-run.dto.ts` (RunResponse)
- **Описание:** Колонки `created_at` в `workflow_runs` нет. `RunResponse.createdAt`
  мапится из `started_at` (nullable) — семантически неверно: «когда создан»
  ≠ «когда запущен». UI (R4) получит nullable-дату и не сможет показать
  «создан X назад».
- **Возможные решения:**
  1. Добавить `created_at` в схему (миграция) — правильно.
  2. Переименовать поле в API в `startedAt` и не притворяться, что это
     «время создания».
- **Когда чинить:** в R2 (миграция) или до R4 (переименование в API).
- **Связанные:** KI-014.
- **Fix:** `created_at timestamptz NOT NULL DEFAULT now()` + backfill
  из `started_at`. Миграция `drizzle/0001_flippant_lockjaw.sql`.

---

### KI-438 — Пустой `audioUrl` у lipsync не блокирует Run
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `web/src/lib/image-tool-node.ts`
- **Описание:** `isAudioUrlInvalid` считает пустое значение **нейтральным**
  (красная рамка на новом узле `lipsync` была бы ложной ошибкой), поэтому
  узел без аудио запускается: Run уходит на backend, а `lipsync` падает уже в
  прогоне. Требование «аудио обязательно» проверяет только backend (KI-369),
  UI блокирует лишь неверный формат ссылки — нет ни подсказки, ни disabled Run.
- **Решение:** блокировать Run (или явно подсвечивать поле) для операции
  `lipsync`, пока `audioUrl` пуст, не трогая форматную валидацию KI-424.
- **Связанные:** KI-369, KI-424.

---

### KI-372 — бюджет: фиксированный курс + нулевая оценка LLM
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/runs/cost-budget.service.ts`, `src/config/env.schema.ts`
- **Описание:** `WORKFLOW_RUN_USD_RUB_RATE` — фиксированный (дефолт 100),
  не живой курс; при его устаревании эффективный рублёвый потолок
  смещается. Оценка LLM-вызова = 0 (стоимость неизвестна до ответа
  провайдера) → для LLM проверяется только уже потраченное; для media —
  цена модели из каталога.
- **Решение:** живой курс (или ручная настройка) + оценка LLM по длине
  промпта и прайсу модели.
- **Связанные:** KI-048, DESIGN v0.9 § 2.6, § 3.7.

---

### KI-459 — `rawContent` попадал в `node_runs.outputs` узла `web_search` (High)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10 S2
- **Файлы:** `src/engine/node-executors.ts`, `src/engine/web-search-executor.spec.ts`
- **Описание:** контракт `WebSearchResult` содержит необязательный
  `rawContent` — полный текст страницы. Если провайдер его возвращает,
  сериализация результата в `node_runs.outputs` раздувала строку и JSONB,
  а SSE-событие `node_completed` несло мегабайты текста в UI. Для LLM этот
  текст не нужен: узел отдаёт готовый `text` из топ-N сниппетов.
- **Решение:** исполнитель копирует только `{ title, url, snippet }` и
  формирует `{ results, text }`; `text` дополнительно обрезается до 2 МБ
  (UTF-8) с пометкой. Покрыто тестом «не пропускает rawContent».
- **Связанные:** DESIGN v0.10 § 3.1.2/§ 3.1.3.

---

### KI-489 — Причина ошибки загрузки/удаления шаблона не показывается
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/components/nodes/DocumentGenNode.tsx`
- **Описание:** При сбое API показывается generic-текст («Не удалось загрузить шаблон»), хотя backend отдаёт конкретный `message`. Пользователь не понимает, в чем дело (413, 400, 403).
- **Решение:** выводить `error.message` из ответа API.

---

### KI-151 — Стоимость в USD показывается сырой строкой `numeric(10,6)`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `58d5672`)
- **Файлы:** `web/src/components/RunResultPanel.tsx` (`formatMetrics`)
- **Описание:** `formatMetrics` подставлял значение как есть:
  `parts.push(\`$${metrics.costUsd}\`)`. Backend отдаёт `numeric(10,6)`, поэтому
  локальная модель показывала `$0.000000` вместо `$0.00`, а проприетарная —
  `$0.010500` вместо `$0.01`. Для рублей аналогичная проблема была уже решена
  функцией `formatRub`, для долларов аналога не было.
- **Fix:** добавлена `formatUsd` по образцу `formatRub` (с защитой от нечислового
  значения, чтобы не получить `$NaN`); `formatMetrics` использует её.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-148, KI-150.

---

### KI-351 — 401-шум в консоли при заходе гостем
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/components/auth/AuthProvider.tsx`
- **Описание:** Проба `/auth/me` до логина даёт error в консоль; косметика.
- **Решение:** глушить 401 без сессии (или логировать debug).
- **Связанные:** KI-327.

---

### KI-608 — UI не предотвращает `from > to`: 400 показывается как ошибка загрузки
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S5) | **Обнаружено:** 2026-11-04
- **Файлы:** `web/src/components/TeamPage.tsx`, `src/audit/dto/audit.dto.ts`
- **Описание:** даты `from`/`to` независимы; если пользователь выбрал
  `from` позже `to`, backend отвечает 400 «from не может быть позже to», а UI
  показывает общий текст `audit.load_failed` и прячет список. Понятной
  подсказки «дата „с“ позже даты „по“» нет, как и автокоррекции границ.
- **Решение:** валидировать диапазон на клиенте (подсветка поля + сообщение),
  ограничить `min`/`max` у `<input type="date">` или менять вторую границу при
  выборе первой.
- **Связанные:** KI-585.

## v1.1.0 — Metrics Improvement (S4, 2026-11-04)

### KI-144 — web/ — самостоятельный пакет, но zod «одалживал» из корня
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/package.json`, `pnpm-workspace.yaml` (не содержит
  `packages`)
- **Описание:** `web/` — самостоятельный пакет (свой lockfile,
  нет `packages` в `pnpm-workspace.yaml`), но Node/TS резолвят
  модули вверх по дереву, поэтому `zod` находился в корневом
  `node_modules`. Это делало зависимости web неявными (см. KI-142).
  Сейчас zod объявлен в обоих местах (корень 4.6.6, web 4.6.7) —
  две копии, два lockfile-резолва.
- **Решение (архитектурное):** включить `web/` в общий workspace
  (`pnpm-workspace.yaml` → `packages: ['web']`) — одна версия
  зависимостей, один lockfile. ИЛИ явно оставить как есть
  (документировать «два независимых пакета»).
- **Когда чинить:** при следующей правке workspace.
- **Связанные:** KI-142, KI-005.

---

### KI-109 — Конфликт портов 5433: контейнер и локальная служба PostgreSQL
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.8.0e (R6.6.1, коммит 12ff041)
- **Fix:** Templates + Export/Import.
- **Связанные:** KI-108, KI-291..295.
- **Файлы:** `docker-compose.yml`, `postgresql.conf` (локальная служба)
- **Описание:** Порт 5433 занят **двумя** серверами: контейнер
  проекта (`0.0.0.0:5433` + `[::]:5433`) и Windows-служба
  `postgresql-x64-17` (`127.0.0.1:5433` + `[::1]:5433`). Node `pg`
  подключается к `127.0.0.1:5433`, попадает в **локальную** службу
  (там нет роли `workflow`) и получает `ECONNRESET`. Локальный
  запуск backend **невозможен**, пока конфликт не разрешён.
- **Решение (выбрано):** остановить локальную службу
  (`Stop-Service postgresql-x64-17`) + `StartupType Manual`.
  Альтернативы: сменить порт локальной службы на 5434 в
  `postgresql.conf`.
- **Когда чинить:** сейчас, блокер локали.
- **Связанные:** KI-009.

---

### KI-282 — condition: `evaluated` теряет типы
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-executors.ts`
- **Описание:** Числовые операции (`>`, `<`) отдают приведённые значения
  (`left: 5`), `===`/`includes` — исходные (`left: '5'`). По `evaluated`
  нельзя восстановить, был ли операнд строкой или числом.
- **Решение:** добавить `leftType`/`rightType` при появлении UI-панели
  условия (R6.5.2).

---

### KI-272 — `onFatalError` потока не снимает «выполняется»
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts`
  (`startRunAsync.onFatalError`)
- **Описание:** После 3 ошибок подряд подписка закрыта, `runError`
  заполнен, но `runStatus` остаётся `pending`/`running` →
  `isRunActive` держит кнопку Run заблокированной, бейдж
  «Выполняется…» без потока.
- **Решение:** в `onFatalError` выставлять `runStatus: 'failed'`
  (или отдельный статус «поток прерван») вместе с тостом.
- **Связанные:** KI-268, KI-060.

---

### KI-511 — `dark:`-вариант Tailwind не привязан к классу `.dark` (Low)
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/styles/theme.css`, `web/index.html`
- **Описание:** тема переключается классом `.dark` на `<html>` (inline-script +
  `useTheme`), но в `theme.css` нет
  `@custom-variant dark (&:where(.dark, .dark *));`. Поэтому `dark:`-утилиты
  Tailwind v4 следуют `prefers-color-scheme`, а не переключателю темы:
  на машине с тёмной ОС они сработают «сами», на светлой — не сработают даже
  при `.dark` на `<html>`. Сейчас `dark:`-классов в проекте нет (S16 обошёлся
  токенами), но это ловушка для следующей правки: визуально проверенная на
  тёмной ОС тема развалится у пользователя.
- **Решение:** либо добавить `@custom-variant dark`, чтобы `dark:` читал
  `.dark`, либо явно запретить `dark:` в RULES/DESIGN и продолжать через
  токены. Тест: `prefers-color-scheme: light` + `<html class="dark">`.
- **Связанные:** KI-448, KI-509.

---

### KI-460 — у `web_search` не было контракта портов: `text` не доходил до LLM (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10 S2
- **Файлы:** `src/engine/node-ports.ts`, `src/engine/node-ports.spec.ts`
- **Описание:** `NODE_PORT_CONTRACT` не содержал `web_search`. При связи
  `web_search → llm` планировщик взял бы дефолт `inferDefaultOutputPort`
  (`output`) или `null` из `handleIdToOutputPort('search-output', 'web_search')`,
  и зависимый узел прочитал бы несуществующий `outputs.output` вместо
  `outputs.text` — ровно ловушка KI-301/KI-368. Внешне граф выглядел бы
  корректным, а LLM падал бы с «не задан prompt».
- **Решение:** добавлен контракт `search-output → text`, вход
  `text-input → prompt`; type-aware резолвер проверяется тестом.
- **Связанные:** KI-301, KI-368, DESIGN v0.10 § 3.1.3.

---

### KI-036 — Падение узла не ретраится (attempts: 3 не срабатывает)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `cbc347c`)
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/runs/runs.processor.ts`
- **Описание:** `executeAsync` при падении узла **возвращает**
  `status='failed'` (не бросает). BullMQ видит успешное завершение
  `process(job)` → `attempts: 3` из KI-016 **не срабатывает**.
  Транзиентная ошибка LLM (429 / 500 / таймаут) убивает весь run
  без повторов.
- **Решение:** node-level retry с backoff, **или** явный `throw`
  после `finishRunAsync('failed')` (тогда сработает `attempts`, но
  вернётся KI-031 — дубли `node_runs`).
- **Когда чинить:** микро-шаг перед R4.
- **Связанные:** KI-016, KI-031, KI-037.
- **Fix:** `LlmProviderException.retryable` (классификация 429/5xx/
  таймаут/сеть vs 400/401/403/404) в `src/llm/provider-errors.ts`.
  Node-level retry до 3 попыток (500ms × 2^(n−1)) только для
  retryable. После исчерпания — `throw` наружу → BullMQ job retry.
- **Остаток:** KI-040 (job-level retry сейчас no-op из-за guard'а
  KI-023 в процессоре).

---

### KI-046 — Job-level replay переигрывает ВЕСЬ граф, включая уже завершённые узлы
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `7be74d1`)
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Каждый job-retry (KI-040) заново вызывает всех
  предшественников, в том числе **LLM-узлы** → повторные **платные**
  вызовы. В smoke dsh узел A выполнился 3 раза (в БД скрыто UPSERT'ом).
- **Возможные решения:**
  1. Кэш по узлу: переиспользовать `node_runs` со `status='completed'`
     и совпадающими `inputs`.
  2. Сброс только поддерева упавшего узла.
- **Когда чинить:** до R4 (главный источник неожиданного расхода).
- **Связанные:** KI-036, KI-040, KI-048.
- **Fix:** `findReusableNodeRunAsync(runId, nodeId, inputs)` —
  SELECT `node_runs`; если `status='completed'` **и**
  `isDeepStrictEqual(inputs)` — вернуть сохранённые `outputs`.
  Проверка **перед** UPSERT → при попадании в кэш строка не
  перезаписывается вовсе. +8 тестов, включая интеграционный
  A→B→C (только C переигрывается, `llmExecutor` вызван один раз).
- **Остаток:** KI-049 (reused не видны в SSE), KI-050 (deep-equal
  дорогой на больших inputs), KI-051 (кэш в одном runId).

---

### KI-321 — Гейт не сверяет length/order/constraints
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/db/schema-parity.spec.ts`
- **Описание:** Сверяются data_type / is_nullable / default /
  numeric_precision,scale. **Не сверяются:** varchar(n), timestamp(p),
  ordinal_position, лишние таблицы в `public`, PK/FK/unique/индексы/CHECK.

---

### KI-160 — В узле Image Generation нет поля для промпта
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `474a93f`)
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`,
  `web/src/types/graph.ts`
- **Описание:** Узел умел выбрать модель и `aspect_ratio`, но промпт приходил
  только по связи от Text/LLM-узла. Задать его прямо в узле было невозможно —
  одиночный узел генерации оказывался незапускаемым.
- **Fix:** добавлена `<textarea>` для `data.prompt` с плейсхолдером и
  авто-ресайзом (KI-169) и сохранением курсора (KI-157); при генерации промпт из
  узла приоритетнее входа только если вход пуст (см. KI-166).
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-154, KI-166, KI-169.

---

### KI-110 — WSL2 Docker proxy (wslrelay.exe) рвёт idle TCP
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.0b.2.3 (коммит `<hash>`)
- **Файлы:** `src/db/db.module.ts`, `src/redis/redis.module.ts`
- **Описание:** Docker Desktop с WSL2 backend проксирует TCP через
  `wslrelay.exe`. Он закрывает idle-соединения непредсказуемо (раньше,
  чем `pg.Pool`/`ioredis` ожидают). Node переиспользует мёртвый сокет →
  `Connection terminated unexpectedly` на первом запросе после паузы,
  `ECONNABORTED` в логах Redis.
- **Fix:** `pg.Pool` — `idleTimeoutMillis: 5_000`,
  `maxLifetimeSeconds: 30`, `connectionTimeoutMillis: 5_000`.
  `ioredis` — `keepAlive: 10_000`, ограниченный `retryStrategy`.
- **Альтернатива (не использована):** Docker Desktop → Hyper-V backend
  (пропадёт wslrelay); смена порта 5433 → 5434.
- **Связанные:** KI-099.

---

### KI-403 — фильтрованный HNSW recall на масштабе
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/db/schema.ts`, `src/vector/vector-store.service.ts`
- **Описание:** HNSW-индекс работает, но фильтр (`workflow_id`,
  `collection`) уходит в btree+Sort при малом количестве строк. На масштабе
  (KI-360) — риск низкого recall, нужен `hnsw.ef_search` tuning
  или частичные индексы.
- **Решение:** мониторинг `EXPLAIN` + метрики recall при росте.
- **Связанные:** KI-360, R7.4a.

---

### KI-442 — S3 streaming-загрузка не ретраится
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.4
- **Файлы:** `src/media/media-storage.service.ts`
- **Описание:** после KI-427 `Body` у `PutObjectCommand` — одноразовый поток
  (`Readable.fromWeb(...).pipe(counter)`). Любой SDK-ретрай (сеть, 5xx,
  таймаут) повторяет запрос с уже прочитанным потоком: второй `PutObject`
  уходит с пустым или частично прочитанным телом
  (`ERR_STREAM_PREMATURE_CLOSE`), поэтому транзиентный сбой на большом
  видео теряет результат целиком.
- **Возможные решения:**
  1. `maxAttempts: 1` для потоковой загрузки + повтор на уровне узла с
     перечитыванием источника.
  2. Multipart (`@aws-sdk/lib-storage`) с повторной отправкой только
     упавшей части.
  3. Временный файл на диске — поток перечитываем, память не растёт (откат
     части KI-427).
- **Связанные:** KI-427, KI-412, KI-425.

---

### KI-227 — `meAsync` мёртвый + alias `@/` в vitest
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/lib/auth-api.ts`, `web/vitest.config.ts`
- **Описание:** `meAsync` не используется. Alias `@/` в
  `web/vitest.config.ts` не настроен — тесты компонентов (jsdom,
  KI-155) не заведутся.
- **Решение:** убрать `meAsync` или задействовать; alias — вместе
  с KI-155.
- **Когда чинить:** при работе над KI-155.
- **Связанные:** KI-155.

---

### KI-336 — `RUN_STATUSES` не знает skipped
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.4 (коммит `ac665b1`)
- **Файлы:** `src/db/schema.ts`, `src/engine/execution-engine.service.ts`
- **Описание:** Движок пишет `node_runs.status='skipped'` (text без CHECK), но тип колонки — `RunStatus`; локальный NodeRunStatus + приведение.
- **Решение:** добавить `skipped` в `RUN_STATUSES` (миграция) или отдельный тип статуса узла.
- **Связанные:** KI-288.
- **Fix:** выбран вариант (b) — `WORKFLOW_RUN_STATUSES` (без skipped)
  + `NODE_RUN_STATUSES = [...WORKFLOW_RUN_STATUSES, 'skipped']`;
  типы `RunStatus` / `NodeRunStatus`; `node_runs.status` →
  `$type<NodeRunStatus>()`. Удалены локальный `type NodeRunStatus`
  и `toNodeRunColumnStatus(... as RunStatus)` в engine. `RUN_STATUSES`
  оставлен `@deprecated`-псевдонимом (0 потребителей после `87455f2`
  — удаление в v0.8.5). Миграция НЕ создаётся: колонка `text` без
  CHECK (подтверждено `pnpm db:generate` + `pg_constraint`).
- **Остаток:** KI-353.
- **Связанные:** KI-288, KI-337, KI-347.

---

### KI-606 — Список действий в UI-фильтре аудита захардкожен
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S5) | **Обнаружено:** 2026-11-04
- **Файлы:** `web/src/lib/audit-api.ts`, `src/audit/audit.constants.ts`
- **Описание:** `AUDIT_ACTION_FILTER_OPTIONS` повторяет backend `AUDIT_ACTIONS`
  плюс fallback `http.post|patch|delete`. Новое действие backend'а появится в
  журнале (и отфильтруется вручную через query), но не в селекте UI, пока
  список не обновят. DESIGN V110 § 3.3 допускал оба варианта (отдельный API или
  хардкод); выбран хардкод, чтобы не плодить DTO и паритет-гейт ради
  статического массива.
- **Решение:** при накоплении действий — ручка `GET /admin/audit/actions`,
  возвращающая `AUDIT_ACTIONS` (плюс fallback), и селект грузится с неё;
  либо генерация списка из i18n-ключей `audit.action.*`.
- **Связанные:** KI-585, KI-568.

### KI-202 — GET /runs/:id и SSE не проверяют владельца
- **Приоритет:** 🔴 Critical | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0b (коммит `4b1c149`)
- **Fix:** `getRunAsync(id, userId?)` и `runs-stream.service` — subquery
  owner через `workflows.user_id`; чужой run → 404 (не 403, не
  раскрывать существование). `RunsController` передаёт `user.sub` в
  оба эндпоинта. +3 теста.
- **Файлы:** `src/runs/runs.controller.ts`, `src/runs/runs.service.ts`,
  `src/runs/runs-stream.service.ts`
- **Описание:** После R6.1a `RunsController` закрыт `JwtAuthGuard`,
  но `GET /runs/:id` и `GET /runs/:id/stream` **не проверяют
  принадлежность запуска пользователю**. Зная uuid чужого run,
  аутентифицированный пользователь прочитает его (и SSE-поток).
  Проверка есть только на `POST /runs` (через `createRunAsync(dto,
  userId)` + фильтр по `workflows.user_id`).
- **Решение:** join `workflow_runs → workflows.user_id` в
  `getRunAsync` и в `runs-stream.service`; 404 при чужом
  (не раскрывать существование).
- **Когда чинить:** R6.1.x (сразу после R6.1b).
- **Связанные:** KI-201, KI-203.

---

### KI-597 — `emailSent` не хранится в БД: список приглашений не знает статус письма
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/db/schema.ts`,
  `src/organizations/org-members.service.ts`
- **Описание:** `emailSent` возвращается только в ответе `POST
  /admin/members/invite`; `GET /admin/members` отдаёт у приглашений лишь
  `email`/`role`/`invitedAt`. После перезагрузки страницы или входа с другого
  устройства владелец не может отличить «письмо ушло» от «только строка в
  БД», а `emailSent: true` означает лишь «SMTP принял», не «доставлено».
- **Решение:** поля `email_sent`/`email_error`/`email_sent_at` в
  `organization_invitations` (миграция), вернуть их в
  `OrganizationInvitationSummary` (контракт + web-зеркало), показывать статус
  в секции «Ожидают регистрации» и дать кнопку повторной отправки (KI-593).
- **Связанные:** KI-593, KI-590.

### KI-161 — Позицию курсора нельзя проверить в CI
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/hooks/use-preserve-cursor.ts`
- **Описание:** Баг KI-157 воспроизводится и проверяется только через реальные
  CDP-события (`Input.dispatchKeyEvent`) в браузере: jsdom не реализует
  поведение курсора при перезаписи значения, поэтому юнит-тест «на курсор» в
  принципе не поймает регресс.
- **Решение:** добавить в CI отдельный Playwright/CDP-сценарий «ввод в
  середину» (покроет TopBar и будущие поля) либо принять ручную проверку.
- **Когда чинить:** при настройке e2e в CI.
- **Связанные:** KI-155, KI-157.

---

### KI-212 — Сообщение коммита `88f53e4` содержит ошибочный «KI-106»
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** git history (коммит `88f53e4`)
- **Описание:** Коммит `88f53e4` (`feat(auth): users + JWT auth
  (R6.1a, KI-106)`) содержит ошибочную ссылку на KI-106 (в реестре =
  идемпотентность media). Правильная ссылка — KI-201. Переписывать
  историю (`--amend`, `git filter-repo`) не будем (RULES § 6.6 —
  только `--force-with-lease` при согласовании; для публичной main —
  нежелательно).
- **Решение:** аннотировать через `git notes add 88f53e4 -m
  "KI-106 -> KI-201"`; `git push origin refs/notes/commits`.
  Перенумерация уже отражена в `[Unreleased] → ### Fixed`.
- **Когда чинить:** docs-коммит R6.1a (git notes — сразу после push
  docs).
- **Связанные:** KI-201, KI-209.

---

### KI-558 — `ON DELETE CASCADE` организации удаляет пользователей и workflow
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`
- **Описание:** по RULES 4.26 `users.organization_id` и
  `workflows.organization_id` объявлены с `ON DELETE CASCADE`: удаление
  арендатора удаляет его учётные записи и графы. API/UI удаления организаций в
  S1 нет, но политика «что происходит с пользователями при удалении
  организации» продуктом ещё не определена.
- **Решение:** до появления управления организациями (S5) определить политику:
  soft-delete арендатора, перенос владельца или запрет удаления при наличии
  пользователей; при необходимости — `RESTRICT` вместо `CASCADE`.
- **Связанные:** RULES 4.26, DESIGN v1.0 § 2.1, S5.

---

## v1.0.0 — Workflow Isolation (S2, 2026-11-02)

### KI-230 — Нет unit-тестов на `ProtectedRoute` / `App`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/auth/ProtectedRoute.tsx`,
  `web/src/App.tsx`
- **Описание:** Регрессия `?workflowId=` (KI-228) ловится только
  CDP-смоуком; unit-тестов нет — нужен jsdom (KI-155).
- **Решение:** после KI-155 — тесты на редирект и сохранение search.
- **Когда чинить:** вместе с KI-155.
- **Связанные:** KI-155, KI-228.

---

### KI-344 — KI-318 закрыт наполовину
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `package.json`, `vitest.config.ts`
- **Описание:** Обычный `pnpm test` без DATABASE_URL молча скипает паритет-гейт (6 skipped); `test:parity` явный, но опционален.
- **Решение:** `failIfNoDatabase`-режим в CI либо обязательный шаг `test:parity`.
- **Связанные:** KI-318.

---

### KI-145 — Каталог узлов: a11y неполный
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/NodeCatalogPopover.tsx`
- **Описание:** `role="dialog"` без `listbox`/`option`/
  `aria-activedescendant` — скринридер не узнаёт, какая строка
  выбрана (выбор только визуальный через `data-selected`).
  После закрытия фокус не возвращается на кнопку «+». Нет focus
  trap внутри поповера.
- **Решение:** combobox/listbox-паттерн (`role="listbox"`,
  `role="option"`, `aria-selected`, `aria-activedescendant`) +
  возврат фокуса на переключатель.
- **Когда чинить:** v0.7.x или v0.8 (a11y-аудит).
- **Связанные:** KI-127, KI-136.

---

### KI-406 — RouterAI: `DEFAULT_EMBEDDING_MODEL` не существует у провайдера
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 (коммит `1c36901`) — `resolveEmbeddingModel` в
  фабрике: bare-id получает префикс `openai/` у RouterAI.
- **Файлы:** `src/llm/llm-provider.factory.ts`,
  `src/llm/llm-registry.service.ts`
- **Описание:** RouterAI отвергает `text-embedding-3-small` (400) — нужен
  `openai/text-embedding-3-small`. При RouterAI первым в очереди провайдеров
  все vector-узлы (R7.4a) и agent-tools (R7.4b) падают.
- **Решение:** `resolveEmbeddingModel` по провайдеру.
- **Связанные:** KI-402, KI-128.

---

### KI-300 — `workflows.version` не инкрементируется при PATCH
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.2 (коммит `8163b73`)
- **Fix:** `updateAsync` — инкремент только при изменении
  `nodes`/`edges` (`isDeepStrictEqual`); метаданные (name/description)
  version не меняют. `sql\`${workflows.version} + 1\`` атомарно. +6 тестов.
- **Остаток:** KI-322..325.
- **Связанные:** KI-200, KI-322..325.
- **Файлы:** `src/workflow/workflow.service.ts` (`updateAsync`),
  `web/src/components/nodes/SubWorkflowNode.tsx`
- **Описание:** `updateAsync` не трогает колонку `version`, поэтому
  снимок версии в `sub_workflow.version` не устаревает, а
  warning «есть новая версия» в UI **недостижим** в обычной работе
  (в смоуке — только через ручной UPDATE в БД).
- **Решение:** инкрементировать `version` при содержательном PATCH
  (не на каждый «selected: false»).
- **Связанные:** KI-200, DESIGN v0.8 § 5.5.

---

### KI-018 — Разнобой типов времени в таблицах
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/schema.ts`, `drizzle/`
- **Описание:** `workflow_runs.created_at` — `timestamptz`, а
  `started_at`/`finished_at` — `timestamp without time zone`. Та же
  картина в `workflows.created_at/updated_at`, `node_runs`.
  Сравнения и сериализация будут расходиться.
- **Решение:** отдельная миграция — привести всё к `timestamptz`.
- **Когда чинить:** до R4 (UI начнёт показывать даты).
- **Связанные:** KI-015.

---

### KI-096 — Env-список моделей описывает только входные модальности
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-provider.factory.ts`, `.env.example`
- **Описание:** Формат `id:text+vision` задаёт `inputModalities`,
  а `outputModalities` жёстко `['text']` (`ENV_LIST_OUTPUT`).
  Для media-провайдера (v0.6.0b.2 — CreativeLab) понадобится
  расширение формата, например `id:in>out`. Сейчас image-модели
  попали бы в группу «Другое».
- **Решение:** расширить парсер до `id:in1+in2>out1+out2`.
- **Когда чинить:** в v0.6.0b.2.
- **Связанные:** KI-092.

---

### KI-302 — Кэш списка workflow в узле `sub_workflow` не инвалидируется
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `c6edf91` + `df4f3f0`)
- **Файлы:** `web/src/components/nodes/SubWorkflowNode.tsx`
- **Описание:** Модульный кэш на вкладку — workflow, созданный в этой
  же вкладке, появляется в селекте только после F5.
- **Решение:** инвалидация по событию/эффекту.
- **Fix:** `web/src/lib/workflow-list-cache.ts` (TTL 5 с + revision +
  `inflightSeq` против гонки); инвалидация в `saveWorkflowAsync` (create +
  update, коммит `df4f3f0`), `importWorkflowAsync`,
  `instantiateTemplateAsync`, `deleteWorkflowAsync`; подписка через
  `useSyncExternalStore` обновляет смонтированные селекты sub_workflow
  без F5. CDP: создание в этой вкладке видно без reload (E-1); 4 узла на
  Save → 1 запрос (E-3, дедупликация); удаление → select сохраняется, DOM
  не remount (E-2).
- **Связанные:** KI-200, KI-332.

---

### KI-338 — `condition`: непройденная ветка не помечается skipped
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-executors.ts`, `src/engine/execution-engine.service.ts`
- **Описание:** Маршрутизация true/false не реализована; обе ветки выполняются.
- **Решение:** после KI-288 пометить непройденную ветку skipped вместо выполнения.
- **Связанные:** KI-288.

---

### KI-066 — У run-аренды нет heartbeat
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S9) | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/db/schema.ts`
- **Описание:** `lockDuration` BullMQ продлевается автоматически,
  пока воркер жив. Аренда в БД (`started_at` + `RUN_STALE_THRESHOLD_MS`)
  **не продлевается**. Легитимно долгий запуск (граф из многих узлов
  × таймаут LLM 60 с легко даёт >5 мин) перешагнёт порог, оставаясь
  живым; тогда повторная доставка job'а увидит «зависший» запуск и
  выполнит граф параллельно с работающим воркером → дубли
  LLM-вызовов и расходов. С `concurrency > 1` вероятность растёт.
- **Решение:** heartbeat — продление `started_at` по ходу
  выполнения, или отдельная колонка `lease_expires_at` с обновлением.
- **Когда чинить:** до прод-нагрузки.
- **Связанные:** KI-032, KI-023, KI-046.

---

### KI-093 — Возможности модели видны только у LLM-узла
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`
- **Описание:** V/IMG бейджи рисует только `LLMNode`. `TextNode` и
  `ImageGenNode` их не показывают (у них нет выбора модели — до
  v0.6.0b).
- **Решение:** переиспользовать `badgesForModel` при появлении
  выбора модели у других узлов.
- **Когда чинить:** v0.6.0b.
- **Связанные:** —

---

### KI-499 — Нет проверки markdown-ссылок в CI
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `.github/workflows/ci.yml`
- **Описание:** Битые ссылки (как в docs/README.md) живут незамеченными. Линк-чекер есть в `.smoke/`, но не в CI.
- **Решение:** перенести скрипт в `scripts/` и добавить docs-only CI-шаг.

---

### KI-312 — Vite 8 `configLoader: 'native'` требует расширения в импорте
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Файлы:** `web/tsconfig.node.json`, `web/vite.config.ts`
- **Описание:** Vite 8 предупреждает, если `vite.config.ts` импортирует
  `./src/lib/api-prefixes` без расширения. Нарушает RULES 3.6
  («0 warnings»).
- **Fix:** импорт с `.ts` + `allowImportingTsExtensions: true`.
- **Связанные:** KI-072.

---

### KI-062 — `APIConnectionError` классифицируется как неповторяемая
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/provider-errors.ts`
- **Описание:** SDK Anthropic при сетевом сбое отдаёт
  `APIConnectionError` без системного `code` (`ECONNREFUSED` и
  т.п.), поэтому `isRetryableProviderError` возвращает `false` и
  node-level retry (KI-036) не срабатывает. В smoke KI-040 это
  привело к тому, что узел не повторялся, а job переигрывался
  целиком.
- **Решение:** классифицировать `APIConnectionError` / аналогичные
  «сетевые» SDK-ошибки как `retryable: true` (по имени класса
  ошибки, а не только по `code`).
- **Когда чинить:** до R4 или в R4.2.
- **Связанные:** KI-036, KI-040.

---

### KI-501 — Одноимённые guard'ы `isRetryableProviderError`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.11.1 (S1) | **Обнаружено:** 2026-10-19
- **Файлы:** `src/llm/provider-errors.ts`, `src/common/errors/retryable-provider.error.ts`
- **Описание:** Два экспорта с одинаковым именем и разной сигнатурой.
- **Решение:** переименовать SDK-классификатор в `isRetryableSdkError`.

---

### KI-044 — `lint-staged` установлен, но не сконфигурирован
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `package.json`, `.husky/pre-commit`
- **Описание:** `lint-staged` в `devDependencies`, но нет конфига и
  вызова в `pre-commit`. Пакет не используется.
- **Решение:** добавить `lint-staged.config.js` (прогонять `oxlint --fix`
  на staged-файлах) и вызвать `npx lint-staged` в `pre-commit`.
- **Когда чинить:** при следующей правке hook'а.
- **Связанные:** —

---

### KI-101 — Ошибки upstream не различаются по `code` в теле
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/media/providers/creativelab.provider.ts`
- **Описание:** GPTunnel отдаёт HTTP-статус (401 на неверный ключ).
  Поле `code` в теле используется только как часть Zod-схемы. Если
  CreativeLab отдаёт свои коды ошибок в `code` при 200 — они не
  интерпретируются.
- **Решение:** проверить формат ошибок при реальном ключе и при
  необходимости добавить разбор (`code: 3` — unknown field,
  `code: 21` — deprecated, `code: 23` — idempotency conflict,
  `code: 25` — bad input).
- **Когда чинить:** при работе с настоящим ключом.
- **Связанные:** KI-097.

---

### KI-049 — Переиспользованные узлы не видны в потоке событий
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/run-events.service.ts`,
  `src/engine/execution-engine.service.ts`
- **Описание:** При молчаливом переиспользовании (KI-046) клиент SSE,
  подключившийся к `run:<runId>` **в середине** job-retry, не получит
  `node_completed` для узлов, отработавших в прошлой попытке.
- **Решение для R4:** гидратировать начальное состояние из БД
  (`GET /runs/:id` + `node_runs`) и трактовать поток как **дельты**.
  Альтернатива — публиковать `node_reused` (расширение контракта
  `RunEventSchema`).
- **Когда чинить:** R4 (SSE-эндпоинт).
- **Связанные:** KI-046.

---

### KI-305 — Асимметрия пустого подграфа
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/engine/node-executors.ts`
- **Описание:** Подграф из 0 узлов → `{ result: {} }` (успех),
  подграф только из `comment` → ошибка «Граф содержит только
  аннотации, нечего выполнять» (валидатор плана). Непоследовательно.
- **Связанные:** KI-200, KI-266.

---

### KI-146 — Каталог: подсветка выбора не прокручивается и не отличима от hover
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/NodeCatalogPopover.tsx`
- **Описание:** Нет `scrollIntoView` при навигации стрелками;
  `data-[selected=true]:bg-muted` совпадает с `hover:bg-muted`.
  При 10+ узлах (v0.8) курсор уедет за пределы списка, «текущий»
  узел не отличим от наведённого.
- **Решение:** `scrollIntoView({ block: 'nearest' })` в эффекте
  на `selectedIndex` + обводка для активной строки
  (`ring-1 ring-primary`).
- **Когда чинить:** v0.8 (вместе с ростом каталога).
- **Связанные:** KI-127, KI-145.

---

### KI-006 — `imageUrl` рендерится в `<img>` без валидации схемы URL
- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** Task 3
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Если `data.imageUrl` придёт с бэкенда/LLM, поле вставится
  в `<img src="...">` без проверки. `data:image/svg+xml` может содержать
  скрипты. Нужна валидация: `http(s):` или `data:image/(png|jpeg|webp|gif);`
  + `onError` заглушка.
- **Когда чинить:** до того, как image-generation провайдеры начнут
  возвращать реальные URL.
- **Связанные:** KI-003.

---

### KI-127 — Каталог узлов с категориями
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `aae027f`); ранее — v0.6.1
  (частично, коммит `990e705`) — скелет `NODE_CATEGORIES` /
  `NodeCategory` + `category` у каждой записи реестра. Скелет готов.
- **Файлы:** `web/src/lib/node-registry.ts`,
  `web/src/types/graph.ts`, `web/src/components/Toolbar.tsx`
- **Описание:** Меню добавления узла — плоский список из 3 кнопок.
  При росте числа узлов (v0.8: http, condition, output, video, audio,
  sub-workflow) плоский список станет неудобным. У референсов
  (GPTunnel, n8n, ComfyUI) — иерархия: категории + подкатегории
  ("Ввод и заметки", "Аудио", "Апскейл", "Инструменты").
- **Возможные решения:**
  1. Реестр узлов с `category: NodeCategory` +
     `subcategory?: string`; меню строится из реестра.
  2. Отдельный JSON-манифест каталога.
- **Требования:**
  - Категории (использовать **кодовые** имена типов, чтобы не
    разъезжаться с KI-121/KI-123): `input` (`text`), `ai` (`llm`,
    `image_generation`, будущий `video_generation`), `tools`
    (`http`, `code`), `output` (`save`, `webhook`).
  - Меню — поповер с секциями, поиск по названию (как у GPTunnel).
- **Когда чинить:** — (закрыто, v0.7.0).
- **Fix:** `web/src/components/NodeCatalogPopover.tsx` (новый) —
  поповер каталога: секции из `NODE_REGISTRY` по `category`,
  порядок из `NODE_CATEGORIES`, только непустые секции.
  Поиск (i18n-aware), клавиатура (↑/↓ по кругу, Enter, Esc, `/`,
  клик вне). `Toolbar`: кнопка «+» (`data-catalog-toggle`).
  9 ключей `catalog.*` (ru/en 93/93).
- **Остаток:** KI-145 (a11y — listbox/aria-activedescendant/
  возврат фокуса), KI-146 (scrollIntoView + подсветка выбора).
- **Связанные:** KI-121, KI-128, KI-145, KI-146.
- **Связанные:** KI-121, KI-128.

---

### KI-103 — `MediaProviderException` не различает, какой провайдер упал
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/media/media-provider.interface.ts`
- **Описание:** Исключение содержит только строку `[creativelab] ...`.
  Когда media-провайдеров станет несколько, для диагностики
  понадобится отдельное поле `provider`.
- **Решение:** добавить поле `provider` (как `retryable`).
- **Когда чинить:** при появлении второго провайдера.- **Связанные:** KI-095.

---

### KI-021 — У `node_runs` нет `created_at`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/schema.ts`
- **Описание:** В отличие от `workflow_runs` (после KI-015), у `node_runs`
  нет `created_at` — только `started_at`/`finished_at`. Решить до R4:
  нужен ли столбцу «создан».
- **Когда чинить:** до R4.
- **Связанные:** KI-015, KI-018.

---

### KI-122 — `nodeDataFromApi` для image-узла теряет `model` / `aspectRatio`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.1 (коммит `990e705`)
- **Файлы:** `web/src/stores/workflow.ts` (`nodeDataFromApi`)
- **Описание:** Функция возвращает только `kind`, `label`, `imageUrl`,
  хотя `ImageGenNodeData` (после v0.6.0b.2.3) содержит ещё `model`
  и `aspectRatio`. При Load эти поля **не переносятся** из API в стор —
  у загруженного workflow селект модели и aspect_ratio окажутся
  пустыми (модель подставится только у нового узла из `mediaModels[0]`).
- **Решение:** добавить перенос `model`/`aspectRatio` в `nodeDataFromApi`.
- **Когда чинить:** — (закрыто, v0.6.1).
- **Fix:** `nodeDataFromApi` переносит `model` и `aspectRatio` для
  `image_generation` (тип-проверка через `typeof … === 'string'`).
  Подтверждено smoke: `di` и `16:9` переживают Save → F5 → Load
  (проверено SQL-запросом к `nodes->2->data`).
- **Остаток:** `data.label` удалён из `NodeData` целиком — заголовок
  узла берётся из реестра (`nodeLabelOf`). `data.label` в старых
  workflow в БД исчезнет после первого Save.
- **Связанные:** KI-069, KI-129.

---

### KI-379 — KI-370 не закрыт, дублирование маршрутизации
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/media/media-node-executor.service.ts`,
  `src/media/media-registry.service.ts`
- **Описание:** `MediaNodeExecutor.resolveToolTargetAsync` /
  `findModelPriceRubAsync` сами перебирают `MEDIA_PROVIDERS`. Публичный
  `resolveByModelAsync` в реестре готов (R7.3), но правка исполнителя
  требует прогона R7.1-смоука.
- **Решение:** переезд в R7.2 с прогоном CDP-смоука R7.1.
- **Связанные:** KI-370, KI-371.

---

### KI-255 — `structuredClone` в `duplicateNodes` упадёт на несериализуемых полях
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/lib/graph-edit.ts`
- **Описание:** `cloneNodesForDuplicate` использует `structuredClone`
  на `data` узла. Если однажды появится несериализуемое поле
  (функция, `Symbol`, DOM-узел) — клон упадёт.
- **Решение:** fallback на JSON-clone или проверка полей.
- **Связанные:** KI-191.

---

### KI-428 — Cron-очистка media покрыта только unit-тестами
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/media/media-cleanup.service.spec.ts`
- **Описание:** Проверены логика удаления и регистрация расписания (моки fs и
  Queue), но нет интеграционного теста «Redis + BullMQ + реальный каталог»:
  `upsertJobScheduler` и фактический запуск воркера не проверяются.
- **Решение:** integration-тест с `REDIS_URL` (как media-storage.integration).
- **Связанные:** KI-413, KI-362.

---

### KI-565 — Политика retention/immutability `audit_logs` не определена
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`
- **Описание:** `audit_logs.user_id` и `audit_logs.organization_id` объявлены с
  `ON DELETE CASCADE`: удаление пользователя/организации стирает и журнал этого
  арендатора (включая историю до удаления). Срок хранения/очистка (retention),
  архивирование и DB-level append-only не заданы: «только запись» обеспечивается
  приложением (`AuditService` не делает UPDATE/DELETE), но SQL-доступ может
  изменить строки. DESIGN § 2.2 требует только запись действий, политика
  хранения — открытый вопрос.
- **Решение:** до S5 определить retention (например, N месяцев + архив),
  добавить регламент/плановую очистку; для неизменяемости — отдельная роль БД
  без UPDATE/DELETE или хэш-цепочка записей; решить, должны ли аудит-строки
  переживать удаление арендатора (`SET NULL` + nullable вместо CASCADE).
- **Связанные:** KI-558, DESIGN v1.0 § 2.2, S5.

### KI-388 — `durationSec`/`aspectRatio` в DESIGN § 3.2 не совпадают с каталогом; узел без модели не показывает поля
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `docs/development/v0.9/DESIGN_V09_FEATURES.md` (§ 3.2),
  `src/media/media-node-executor.service.ts`, `web/src/components/nodes/*GenNode.tsx`
- **Описание:** DESIGN обещает 3–10 с (video) и 15–120 с (music), каталог даёт
  enum-и: `kling-v2-5` {5,10}, `kling-v4` до 30, `grom-zvuk` вернул `duration:240`.
  Схемы узлов валидируют «разумное окно» (1–60 / 1–300), точный набор — каталог.
  Плюс: узел, добавленный из каталога до загрузки моделей, остаётся с пустым
  селектом и без полей параметров (backend дефолт подставляет); в TopBar нет
  пред-чека модели для новых узлов (`kind:'image'`/`'llm'` только).
- **Решение:** обновить DESIGN § 3.2 по факту каталога; автоподстановка дефолтной
  модели после загрузки каталога; пред-чек моделей новых узлов в TopBar.
- **Связанные:** KI-361, KI-367, KI-369.

---

### KI-284 — Вставка compare в связь теряет операнды
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/stores/workflow.ts` (`addNodeOnEdge`),
  `src/engine/node-ports.ts`
- **Описание:** `addNodeOnEdge` ставит новому узлу `targetHandle: null`.
  `compare` без контракта → движок берёт ключ входа из `sourceHandle`
  (`text`) → `inputs.text`, а `executeCompareNode` читает `a`/`b` →
  узел падает. Смоуком не проверено (вне A/B/C/D/E), но код-путь
  очевиден.
- **Решение:** закрыть вместе с KI-278/279 либо проставлять в
  `addNodeOnEdge` первый `target`-хендл нового типа.
- **Связанные:** KI-278, KI-279, KI-035.

---

### KI-381 — серверной идемпотентности нет у Replicate/FAL/OpenAI
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/media/providers/*.provider.ts`
- **Описание:** у CreativeLab есть `code: 23` (`idempotency_key`), у прямых
  провайдеров такого поля нет. Клиентская карта `idempotencyKey` → `taskId`
  живёт в памяти: рестарт backend / второй инстанс дубль не поймают.
- **Решение:** Redis-ключ рядом с `node_runs`.
- **Связанные:** KI-106, KI-298.

---

### KI-462 — `document_gen` не проверяет лимит 500 блоков (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Запланировано:** v0.10.x
- **Файлы:** `src/engine/node-executors.ts`, `src/documents/document.service.ts`
- **Описание:** DESIGN v0.10 § 3.2.3 ограничивает документ не только размером
  контента (1 МБ) и файла (10 МБ), но и числом блоков (≤ 500). Исполнитель S6
  проверяет первые два лимита, а число блоков — нет: `DocumentService` не
  отдаёт `DocumentModel` наружу, и проверка потребовала бы второго разбора
  Markdown/JSON перед рендером.
- **Решение:** добавить в `DocumentService` публичный `countBlocks`/рендер по
  готовой модели (`generateDocxFromModelAsync`) либо проверку внутри
  `renderAsync`; исполнитель будет бросать `NodeDataValidationException`.
- **Связанные:** KI-458 (в задании S6 этим номером назван лимит 10 МБ; в
  реестре KI-458 — про `PGVECTOR_ENABLED`), DESIGN v0.10 § 3.2.3.

---

### KI-455 — `PGVECTOR_ENABLED` отсутствовал в env (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 (S0)
- **Файлы:** `src/config/env.schema.ts`, `.env.example`,
  `src/engine/execution-engine.service.ts`, `src/engine/errors.ts`
- **Описание:** флаг `PGVECTOR_ENABLED` был только в DESIGN v0.9/v0.10, но не
  в `EnvSchema`: выключить vector/memory-узлы без отката релиза было нельзя.
- **Решение:** добавлена `VectorEnvSchema` с default `true` и строгим разбором
  (`'false'` — это `false`, а не непустая строка), переменная внесена в
  `.env.example`. `ExecutionEngineService` читает флаг через `ConfigService` и
  при `false` бросает `VectorDisabledException` до обращения к pgvector.
- **Тесты:** `env.schema.spec.ts` (default/строки/мусор), `errors.spec.ts`,
  `execution-engine.service.spec.ts` (disabled-путь).

---

### KI-317 — Spec-файлы не проходят type-check ни на одном шаге
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `ca21f30`)
- **Файлы:** `package.json`, `tsconfig.build.json`, `.github/workflows/ci.yml`
- **Описание:** `tsconfig.build.json` исключает `**/*spec.ts`; vitest
  не type-check'ает; `oxlint --type-aware` — не `tsc`. На HEAD —
  26 ошибок типов в 11 spec-файлах, «зелёный CI» их не видит.
- **Решение:** `"typecheck": "tsc -p tsconfig.spec.json --noEmit"` +
  шаг в CI; разово починить 26 ошибок.
- **Fix:** `tsconfig.spec.json` (`extends tsconfig.json`, `noEmit`,
  `types: [node, vitest/globals]`, `include: src/**/*.spec.ts`,
  `test/**/*.spec.ts`); `"typecheck": "tsc -p tsconfig.spec.json --noEmit"`;
  шаг Typecheck в CI (job build, до Apply migrations). Починены 23 ошибки
  типов в 11 spec-файлах (дополнены фикстуры: inputModalities/
  outputModalities, shareToken, priceInput/priceInputUnit; типизированы
  моки). Продовый src/** не тронут — только *.spec.ts.
- **Остаток:** KI-343 (e2e не покрыт), KI-346 (drizzle/** вне typecheck).
- **Связанные:** KI-298, KI-318.

---

### KI-320 — Паритет-гейт требует ручного маппинга типов колонок
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/db/schema-parity.spec.ts`
- **Описание:** `PG_DATA_TYPE_BY_COLUMN_TYPE` покрывает 6 типов +
  `PgTimestamp`; новый тип (varchar, bigint, double precision, date,
  массив, enum, `timestamp({mode:'string'})`) валит гейт сообщением
  «тип Drizzle 'X' не сопоставлен».
- **Решение:** расширять карту вместе с новым типом колонки.

---

### KI-039 — Неконфигурированные провайдеры попадают в `listModels()`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/llm/llm-registry.service.ts`,
  `src/llm/providers/*.provider.ts`
- **Описание:** `listModels()` возвращает 4 модели, даже если ключ
  есть только у одного провайдера. UI покажет недоступные модели.
- **Решение:** добавить `isConfigured` провайдеру и фильтровать
  список для UI.
- **Когда чинить:** R4 (вместе с UI выбора модели).
- **Связанные:** —
- **Fix:** `ILlmProvider.isConfigured` (геттер `client !== null`);
  `listModels()` фильтрует неконфигурированные. `resolveByModel`
  **не** фильтрует — маршрутизация ≠ готовность; ошибка
  «API_KEY не задан» всплывает на `generateAsync`, не подменяется
  на «модель не поддерживается». +4 теста.
- **Остаток:** KI-056 (`GET /llm/models` эндпоинт — R4),
  KI-057 (смена ключа не подхватывается), KI-058
  (`isConfigured` = «ключ задан», не «работает»).

---

### KI-172 — Версия модели Yandex захардкожена (`latest`)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/llm/llm-provider.factory.ts`
- **Описание:** `YANDEX_MODEL_VERSION = 'latest'` — константа. Переключиться на
  ветку `rc`/`deprecated` или конкретную версию можно только правкой кода. Для
  YandexGPT 32k документация указывает только ветку `rc`.
- **Решение:** поддержать синтаксис версии в id модели (`yandexgpt-32k/rc`) или
  env-переменную.
- **Когда чинить:** при добавлении моделей Yandex с нестандартной версией.
- **Отменяет:** KI-174 (env-формат `YANDEX_MODELS` решит версию
  через id модели: `yandexgpt-32k/rc`).
- **Связанные:** KI-159, KI-174.

---

### KI-383 — дублирование USD_RUB_RATE
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/runs/cost-budget.service.ts`, `src/config/env.schema.ts`
- **Описание:** R7.1 ввёл `WORKFLOW_RUN_USD_RUB_RATE` (бюджет), R7.3 —
  `MEDIA_USD_RUB_RATE` (каталог). Оба — про перевод USD↔RUB; два источника
  курса → рассинхрон при ручной правке.
- **Решение:** слить в единую env (например, `USD_RUB_RATE`) при следующей
  правке env-схемы.
- **Связанные:** KI-372.

---

### KI-435 — SSRF: DNS rebinding между проверкой и fetch
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S14) | **Обнаружено:** 2026-10-18
- **Файлы:** `src/common/http/safe-http.client.ts`, `src/agent/agent-tools.ts`
- **Описание:** адрес резолвился один раз в проверке, а `fetch` резолвил имя
  повторно. При TTL=0 злоумышленник отдаёт публичный IP на первом запросе и
  приватный на втором.
- **Решение:** `SafeHttpClient` на `undici`: **один** `dns.lookup` с проверкой
  всех адресов и pinning выбранного IP через `Agent({ connect: { lookup } })`
  (TLS SNI и `Host` остаются исходными); `redirect: 'manual'` с перепроверкой
  каждого `Location`. Прежние `fetchWithSsrfGuardAsync`/`assertPublicHttpUrlAsync`
  удалены. Отчёт: [S14-S15-security-infra.md](development/reports/v0.11.0/S14-S15-security-infra.md).
- **Связанные:** KI-409, KI-434, KI-478.

---

### KI-016 — Очередь BullMQ без `defaultJobOptions`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `4ea0fb4`)
- **Файлы:** `src/runs/runs.module.ts` (`BullModule.registerQueue`)
- **Описание:** У очереди `workflow-runs` нет `defaultJobOptions` —
  нет `attempts`, `backoff`, `removeOnComplete`, `removeOnFail`. Упавший
  job (в R2/R3 — реальный LLM-вызов) **не ретраится** и копится в Redis
  бесконечно.
- **Fix:** в `registerQueue({ name, defaultJobOptions: {
    attempts: 3, backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 }, removeOnFail: { count: 500 },
  }})`.
- **Когда чинить:** в R2, до подключения реального executor'а.
- **Связанные:** —
- **Fix:** `defaultJobOptions` — attempts: 3, backoff: exponential 2000ms,
  removeOnComplete (count 100, age 24ч), removeOnFail (count 500, age 7д).

---

### KI-156 — `LMSTUDIO_MODELS` содержит id без префикса издателя
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `29f4e19`)
- **Файлы:** `.env.example`
- **Описание:** В шаблоне стояло `LMSTUDIO_MODELS=qwen2.5-coder-7b-instruct`, а
  LM Studio объявляет модель как `qwen/qwen2.5-coder-7b-instruct` (с префиксом
  издателя). Провайдер показывал модель в селекте, но вызов уходил с
  несуществующим id и падал.
- **Fix:** `.env.example` приведён к реальным id с модальностями:
  `qwen/qwen2.5-coder-7b-instruct:text,qwen/qwen2.5-vl-7b:text+vision`, и
  добавлена подсказка сверять список через `GET /v1/models`.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-088, KI-097.

---

### KI-253 — Хэш графа считается на любом изменении стора
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`,
  `web/src/lib/graph-hash.ts`
- **Описание:** `computeGraphHash` пересчитывается на изменение
  любого поля стора (включая `runStatus`, `nodeMetrics` при SSE).
  Для больших графов — лишняя работа.
- **Решение:** мемоизация по `(nodes, edges)` через `useMemo` или
  отдельный срез стора.
- **Связанные:** KI-195.

---

### KI-236 — `workflows.createdAt/updatedAt` без `.notNull()` в схеме
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (Пакет 3, коммит 4a214f7)
- **Fix:** колонки приведены к
  `timestamp(..., { withTimezone: true }).notNull().defaultNow()`.
- **Файлы:** `src/db/schema.ts` (`workflows`),
  `src/workflow/workflow.service.ts` (`findSharedAsync`)
- **Описание:** Drizzle-типы `Date | null` (в БД `NOT NULL DEFAULT
  now()`), из-за чего в коде появляются fallback-и вида
  `?? new Date()` — маскируют реальную схему.
- **Решение:** `.notNull()` на колонках в Drizzle-схеме (миграция не
  нужна — БД уже NOT NULL); убрать `??` из кода.
- **Когда чинить:** v0.8.x (вместе с KI-018 — типы времени).
- **Связанные:** KI-018.

---

### KI-094 — Yandex: `text+vision` не подтверждён документацией
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-provider.factory.ts` (YANDEX_MODELS)
- **Описание:** Для `qwen3.6-35b-a3b/latest` указано
  `inputModalities: ['text', 'vision']` по ТЗ без подтверждения.
  Если vision нет, UI покажет бейдж `[V]` **ошибочно**.
- **Решение:** проверить живьём при наличии ключа Yandex, при
  необходимости — поправить одну строку.
- **Когда чинить:** при первом вызове Yandex.
- **Связанные:** —

---

### KI-092 — Группировка в UI знает только text / vision
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/lib/llm-models.ts`
- **Описание:** `groupLlmModelsForSelect` раскладывает по «Текст» и
  «Текст + Vision», всё прочее — в «Другое». Для
  image-generation / audio / video / embedding **своих групп нет**.
- **Решение:** при появлении image-провайдера (v0.6.0b) добавить
  группу «Генерация изображений».
- **Когда чинить:** v0.6.0b.
- **Связанные:** KI-094.

---

### KI-072 — Префиксы API для Vite-прокси перечисляются вручную
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.8.1 (коммит 39b6851)
- **Fix:** единый реестр `web/src/lib/api-prefixes.ts`; Vite proxy
  генерируется из реестра; тест-паритет backend (`@Controller` ⊆
  реестр) и frontend (fetch-литералы ⊆ реестр). Структурный фикс
  для серии KI-299/072/120.
- **Связанные:** KI-120, KI-299, KI-308..313.
- **Исправлено в:** v0.4.0
- **Файлы:** `web/vite.config.ts`, `web/src/lib/api.ts`
- **Описание:** Забытый `/llm` в proxy → `GET /llm/models` уходил
  в dev-сервер и получал 404, UI молча показывал пустой список
  моделей (ошибка только в консоли). В R4.2 этот 404 ошибочно
  списали на favicon.
- **Решение:** единый префикс (`/api`) **или** один список
  префиксов, из которого генерируется и прокси, и пути в
  `lib/api.ts` — тогда новый эндпоинт нельзя «забыть».
- **Когда чинить:** R4.3b или перед прод.
- **Связанные:** KI-071.
- **Fix:** favicon встроен SVG data-URI в `web/index.html`.

---

### KI-186 — Хоткеи: расширенный список
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.1 + R6.4b.2b, коммиты e923384 + 2efe3f3)
- **Fix:** закрыты S/H/F/M/Tab/C/Shift+C/Ctrl+D/Ctrl+Z/Ctrl+Shift+Z.
  Приоритет `ctrl+*` → `shift+*` → одиночные (R6.4b.1). Найден и
  исправлен баг `matchesHotkey` (см. KI-274) — из-за него `ctrl+*`
  биндинги не срабатывали вообще.
- **Остаток:** KI-273 (Ctrl+A/C/V/S, Ctrl+Shift+Backspace → v0.8.x).
- **Связанные:** KI-187, KI-188, KI-190, KI-191, KI-273, KI-274.
- **Fix (R6.4b.1, коммит `e923384`):** ✅ Ctrl+D, S (cursor),
  H (hand), F (fit view), M (minimap), Tab (каталог). useHotkeys
  переписан на обратно-совместимый API (HotkeyBinding + allow).
- **Fix (R6.4b.2b):** Ctrl+Z / Ctrl+Shift+Z (undo/redo) — см.
  коммит R6.4b.2b.
- **Остаток:** Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+S / Ctrl+Shift+Backspace
  → **KI-273** (отложено в v0.8.x, не критично).
- **Связанные:** KI-187, KI-188, KI-190, KI-191, KI-273.
- **Связанные:** KI-187, KI-188, KI-190, KI-191.
- **Файлы:** `web/src/components/Canvas.tsx`, `web/src/hooks/use-hotkeys.ts`
- **Описание:** У GPTunnel полный список: Tab (добавить узел),
  S (курсор), H (рука), F (вписать), C (комментарий), Shift+C
  (показать/скрыть), Ctrl+A (выделить всё), Ctrl+C/V (копи/паст),
  Ctrl+D (дублировать), Delete, Ctrl+Shift+Backspace (очистить),
  Ctrl+Z (отменить), Ctrl+Shift+Z (повторить), Ctrl+S (сохранить).
  У нас — только React Flow default + Delete/Backspace.
- **Решение:** централизованный хук `useHotkeys` с приоритетом
  (не срабатывать в input/textarea).
- **Когда чинить:** v0.8 (Canvas UX).
- **Связанные:** KI-162, KI-185, KI-191.

---

### KI-585 — В UI аудита нет фильтров по действию/пользователю/дате
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S3) | **Обнаружено:** 2026-11-03
- **Файлы:** `web/src/components/TeamPage.tsx`, `src/audit/dto/audit.dto.ts`,
  `src/audit/audit.service.ts`
- **Описание:** вкладка «Аудит» показывает только ленту (keyset-пагинация,
  «Загрузить ещё»); фильтров нет, хотя KI-573 в решении упоминал фильтры.
  На большом журнале нужное действие ищется листанием. Серверная фильтрация
  также требует индексов под `(organization_id, action, created_at)`.
  **Уточнение S2:** на HEAD этот KI был ошибочно помечен «Fixed в v1.1.0 (S1)»;
  S1 занимался SMTP и фильтров не добавлял, в UI их нет — статус возвращён в
  `Open` (фильтры — срез S3 по DESIGN V110 § 3.3).
- **Решение:** расширить `AuditQuerySchema` (`action`, `userId`, `from`/`to`),
  добавить индексы и контролы в UI; `total` при фильтрах считать по тому же
  предикату (KI-571).
- **Fix (v1.1.0 S3):** `GET /admin/audit` принимает `action` (точный код),
  `userId` (uuid автора), `from`/`to` (границы `created_at` включительно;
  `YYYY-MM-DD` — UTC-сутки, полный ISO-8601 — момент). `AuditService.listAsync`
  добавляет те же условия в `WHERE` страницы **и** `count(*)`, поэтому `total`
  описывает отфильтрованный журнал; keyset-курсор работает вместе с фильтрами.
  Мусорные `action`/`userId`/даты и `from > to` — 400 от `ZodValidationPipe`.
  Миграция `0017_kind_gorilla_man.sql` добавляет индексы
  `audit_logs_org_action_created_id_idx` и `audit_logs_org_user_created_id_idx`.
  UI: селекты действия и автора, два `<input type="date">`, «Сбросить»; смена
  любого фильтра перезапрашивает первую страницу, «Загрузить ещё» передаёт те
  же фильтры. i18n — `audit.filter.*`, `audit.empty_filtered` (ru/en).
- **Связанные:** KI-573, KI-571, KI-606, DESIGN V110 § 3.3.

### KI-014 — jsonb-колонки без `$type<T>()` (RULES 4.11)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `4ea0fb4`)
- **Файлы:** `src/db/schema.ts` (`workflows.nodes`, `workflows.edges`,
  `workflow_runs.snapshot`, `workflow_runs.inputs/outputs`,
  `node_runs.inputs/outputs/logs`)
- **Описание:** jsonb-колонки не типизированы через `$type<T>()` — читаются
  как `unknown`. В R1 `snapshot = { nodes, edges }` копируется как есть,
  но в R2 executor начнёт **читать** snapshot и упрётся в отсутствие типа.
- **Fix:** `$type<{ nodes: NodeDto[]; edges: EdgeDto[] }>()` в схеме +
  Zod-валидация на границе чтения (RULES § 1.17).
- **Когда чинить:** в R2, до реализации `ExecutionEngineService`.
- **Связанные:** KI-003 (executionMap), KI-015.
- **Fix:** `$type<T>()` на всех jsonb (`src/db/schema.ts`) +
  `GraphSnapshotDto` (`src/engine/dto/graph-snapshot.dto.ts`).

---

### KI-505 — `restoreRunAsync` не отменяет REST-запросы
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/stores/workflow.ts`
- **Описание:** При быстрой смене workflow поздний ответ `fetchRunAsync` может записать состояние «чужого» запуска.
- **Решение:** прокинуть `AbortSignal` в `requestAsync` или проверять `currentWorkflowId` перед `set`.

---

### KI-244 — Anthropic-модели захардкожены в провайдере
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/llm/providers/anthropic.provider.ts`
- **Описание:** Список моделей — `readonly models` в классе (литералом).
  Из-за этого `defaultMaxTokens` / `supportsReasoning` для них задать
  нельзя: env-список не предусмотрен (в отличие от GPTunnel / LM
  Studio), лимит всегда падает на константу 1024 или явный
  `options.maxTokens`. Для Claude с extended thinking это блокер.
- **Решение:** env-список (`ANTHROPIC_MODELS`) или явные дефолты для
  встроенных моделей (`claude-opus-4` → 4096, `claude-sonnet-4` →
  4096, с поддержкой `:reasoning`).
- **Когда чинить:** v0.8.x — при подключении Anthropic extended
  thinking (KI-193 остаток).
- **Связанные:** KI-193, KI-245.

---

### KI-065 — У воркера очереди нет `concurrency`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/runs/runs.processor.ts`, `src/config/env.schema.ts`,
  `src/runs/runs.worker-options.ts`
- **Описание:** Дефолт `@Processor`/`WorkerHost` — `concurrency: 1`.
  Один медленный запуск блокировал все остальные (head-of-line
  blocking). Подтверждено в smoke KI-060.
- **Fix:** `WORKFLOW_RUNS_CONCURRENCY` (default 5),
  `WORKFLOW_RUNS_LOCK_DURATION_MS` (default 300_000),
  `WORKFLOW_RUNS_MAX_STALLED_COUNT` (default 2) — через
  `WorkerEnvSchema` в `env.schema.ts`. Декоратор `@Processor`
  читает env в момент загрузки модуля (вне DI), значения
  валидируются Zod **до** передачи в BullMQ. Smoke:
  `concurrency=2 → max simultaneously running = 2`.
- **Остаток:** KI-067 (concurrency глобальный, нет fairness;
  дефолт 5 без нагрузочного теста).

---

### KI-419 — ThrottlerGuard не учитывает reverse proxy
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.2 — env `TRUST_PROXY` + `app.set('trust proxy', …)`
  (`src/main.ts`), по умолчанию выключено (см. KI-441).
- **Файлы:** `src/app.module.ts`, `src/main.ts`
- **Описание:** Без `trust proxy` за nginx все клиенты имеют один IP (лимит 5/мин на всех).
- **Решение:** env `TRUST_PROXY` + `app.set('trust proxy', ...)`.
- **Связанные:** KI-206, KI-234.

---

### KI-027 — Run-level inputs игнорируются
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.service.ts`, `src/engine/execution-engine.service.ts`
- **Описание:** `createRunAsync` пишет `inputs = {}`, executor читает только
  snapshot. Пользовательские входные значения запуска некуда передать.
- **Решение:** контракт `POST /runs { workflowId, inputs }` + прокидывание
  в узлы-источники.
- **Когда чинить:** R3 (до реальных LLM-вызовов).
- **Связанные:** —

---

### KI-471 — Prod-compose с dev-`.env` падал на `COOKIE_SECURE=false` (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 Docker
- **Файлы:** `docker-compose.prod.yml`, `src/config/env.schema.ts`
- **Описание:** `docker-compose.prod.yml` задаёт `NODE_ENV=production`, а
  `env_file: .env` приносит dev-значение `COOKIE_SECURE=false`. Схема
  `env.schema.ts` fail-fast запрещает `false` в production (security), поэтому
  контейнер перезапускался с
  `COOKIE_SECURE=false недопустим в production`. Аналогично будет отвергнут
  `AUTH_DISABLED=true`.
- **Решение:** в `environment` prod-compose добавлен явный
  `COOKIE_SECURE: "true"`. Это корректно только за HTTPS/reverse proxy; при
  локальном HTTP refresh-cookie не установится. Для локальной проверки
  использовать dev-compose или HTTPS-туннель.
- **Связанные:** —.

---

### KI-573 — UI аудита отсутствует (только API)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.0.0 (S5) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/admin-audit.controller.ts`, `web/src/` (нет страницы)
- **Описание:** S3 даёт только `GET /admin/audit` (keyset-пагинация); страницы
  «Команда и Аудит» нет — по плану DESIGN v1.0 § 5 она входит в срез S5.
  Сейчас журнал доступен только через API/инструменты.
- **Решение:** в S5 — UI-страница настроек: фильтры по действию/пользователю/
  дате, список с пагинацией, доступ только owner/admin; контракт API уже готов
  (`AdminAuditController`, `api-prefixes.json` prefix `admin`).
- **Fix (S5):** вкладка «Аудит» в модалке «Команда и аудит»
  (`web/src/components/TeamPage.tsx`): таблица «дата / пользователь / действие /
  ресурс», подписи действий из `audit.action.*` с fallback на сырой код,
  keyset-пагинация «Загрузить ещё» по `nextCursor`, доступ только owner/admin.
  Фильтры по действию/пользователю/дате не делали — KI-585.
- **Связанные:** DESIGN v1.0 § 3.2/§ 5, KI-571, KI-585.

---

## v1.0.0 — Prometheus Metrics (S4, 2026-11-03)

### KI-173 — `pickDefaultMediaModel` не учитывает `deprecated`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/lib/media.ts`
- **Описание:** Если приоритетная модель (`flux-schnell`) помечена
  `deprecated: true`, helper всё равно её выбирает. Поле есть в схеме
  `MediaModelInfo`, но при выборе игнорируется.
- **Решение:** пропускать `deprecated === true`, предпочитать
  `deprecationRedirectTo` при наличии.
- **Когда чинить:** когда CreativeLab начнёт помечать модели снятыми.
- **Связанные:** KI-154.

---

### KI-175 — Yandex: модели всегда `text` (нет `V`-бейджа)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.2-pre (коммит `ed945cd`)
- **Файлы:** `src/llm/llm-provider.factory.ts` (`YANDEX_MODELS`)
- **Описание:** v0.7.1 пометил все Yandex-модели как `text` только.
  Но `qwen3.6-35b-a3b/latest` — **мультимодальная** (UI Yandex AI
  Studio: «Работа с текстом и изображениями», «Понять визуальный
  контент»). Vision-модель не покажет badge `[V]` в селекте.
- **Fix:** модальности задаются суффиксом в `YANDEX_MODELS`
  (`…qwen3.6-35b-a3b/latest:text+vision`) через общий парсер
  `parseModalities`; в smoke `/llm/models` отдаёт
  `inputModalities: ['text','vision']`, UI показывает badge `[V]`.
- **Когда чинить:** — (закрыто, v0.7.2-pre)
- **Связанные:** KI-159, KI-174.

### KI-588 — Несколько организаций могут пригласить один email; «сжигается» только самое старое приглашение
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/db/schema.ts`, `src/auth/auth.service.ts`
- **Описание:** уникальность объявлена на `(organization_id, email)`, поэтому
  организации A и B могут выписать приглашения на один адрес. При регистрации
  `registerAsync` берёт **самое старое** приглашение (порядок `created_at ASC,
  id ASC`), «сжигает» его и создаёт пользователя в этой организации; остальные
  строки остаются «ожидающими» навсегда (видны в UI только своей организации) и
  не действуют — это осознанный детерминированный выбор, но неявный для
  пользователя.
- **Решение:** при регистрации удалять/помечать отклонёнными все приглашения
  этого email; либо ввести приглашение со статусом `pending/accepted/declined`
  и экран выбора организации.
- **Связанные:** KI-563, KI-583.

### KI-575 — `/metrics` без аутентификации: требование к периметру
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/metrics/metrics.controller.ts`
- **Описание:** ручка открыта (Prometheus не умеет JWT); в экспозиции агрегаты (маршруты, статусы, типы узлов, модели, стоимость), без пользовательских данных. Защита — только сетевая; на ручку действует общий `ThrottlerGuard` (300 req/min).
- **Решение:** в S6/ops задокументировать: `/metrics` не публиковать наружу, доступ только из scrape-сети (ingress/reverse-proxy allowlist).

### KI-252 — Узлы из Toolbar не попадают на сетку 8×8
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts` (`addNode`, `addNodeOnEdge`)
- **Описание:** `snapToGrid` работает только при перетаскивании;
  новые узлы из Toolbar встают в центр вьюпорта с дробными
  координатами (например, `y: 200.5`) — выглядят «не по сетке».
- **Решение:** округлять `position` до `snapGrid` при `addNode` и
  `addNodeOnEdge`.
- **Связанные:** KI-189.

---

### KI-203 — Нет FK workflows.user_id → users.id
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/db/schema.ts`, `drizzle/`
- **Описание:** После R6.1a `workflows.user_id` — uuid NOT NULL, но
  **без foreign key** на `users.id`. Удаление пользователя →
  dangling `user_id` (колонка «висит» на несуществующем id). Нет
  политики ON DELETE.
- **Решение:** `.references(() => users.id, { onDelete: 'cascade' })`
  в schema; миграция. Политика: **cascade** (удаление пользователя →
  удалить его workflows) — для MVP.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201, KI-202.

---

### KI-492 — Дублирование контракта `document_gen` frontend ↔ backend
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/types/graph.ts`, `src/engine/node-executors.ts`
- **Описание:** Схема узла описана дважды (Zod на бэке, TS-типы на фронте), нет shared-типов (связано с KI-358).
- **Решение:** вынести общие контракты в `shared/` при появлении монорепы.

---

### KI-215 — `refresh_tokens` не чистится
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/db/schema.ts`, `src/runs/` (repeatable job)
- **Описание:** Истёкшие и отозванные строки `refresh_tokens` копятся —
  нет периодической очистки по `expires_at`.
- **Решение:** repeatable BullMQ job (раз в сутки) + индекс на
  `expires_at`.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201.

---

### KI-045 — Husky-файл `.husky/_/` не в `.gitignore` (проверить)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `.gitignore`, `.husky/_/`
- **Описание:** Husky 9 **сам** создаёт `.husky/_/.gitignore` с содержимым
  `*` при `pnpm install` (через `prepare`). Это **правильно** — `.husky/_/`
  не коммитится. Но проверить, что `.gitignore` в корне **не** перезаписывает
  это поведение.
- **Проверка:** `git check-ignore .husky/_/pre-commit` → должен вернуть путь.
- **Когда чинить:** при следующей правке `.gitignore`.
- **Связанные:** —

---

### KI-493 — Гонка повторного `startAsync` и тика
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/runs/run-lease.service.ts`
- **Описание:** Если `startAsync` вызван дважды (например, при рестарте), старый таймер может сработать после `stop`, вызвав лишний `renewAsync`.
- **Решение:** проверять `#timers.has(runId)` перед обновлением.

---

### KI-191 — Дублировать узел (Ctrl+D)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts`, `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel: Ctrl+D дублирует выделенные узлы (с offset).
  У нас — нет.
- **Решение:** store.duplicateNodes(ids) с offset +15/+15; hotkey.
- **Когда чинить:** v0.8.
- **Связанные:** KI-186.

---

### KI-068 — У фронтенда нет тестовой инфраструктуры и lint-скрипта (частично)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `web/package.json`, `.github/workflows/ci.yml`
- **Описание:** В `web/package.json` нет ни `vitest`, ни `lint`-скрипта.
  Root-lint смотрит только `src/` + `test/`, поэтому `web/` в CI
  **не проверяется** вообще. Единственная проверка фронта — `pnpm build`
  (`tsc -b && vite build`) плюс ручной CDP-smoke.
- **Решение:** завести `vitest` (+ jsdom) и lint-скрипт для web/;
  включить в CI (KI-005).
- **Когда чинить:** R4.3-prep или отдельный шаг.
- **Связанные:** KI-005.
- **Исправлено в:** v0.7.0 (частично, коммит `ea5571e`) —
  `vitest` + `i18n.spec.ts` (паритет ключей, 2/2), скрипты
  `test`/`test:watch` в `web/package.json`. Остаётся: `lint`-скрипт
  в web/, покрытие больше тестов.

---

### KI-254 — После Ctrl+D панель результата переключается на копию
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts` (`duplicateNodes`)
- **Описание:** `duplicateNodes` снимает выделение с исходных и
  выделяет копии; `selectedNodeId` переключается на первую копию —
  панель результата показывает «пустой» узел.
- **Решение:** не менять `selectedNodeId` (оставить фокус на
  оригинале), либо явно решить обратное.
- **Связанные:** KI-191.

---

### KI-519 — Ожидаемые метрики в `RELEASES.md` не сверяются с фактом
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `docs/development/RELEASES.md`
- **Описание:** В чек-листе релиза были зашиты ожидания `1001`/`339` тестов,
  хотя на HEAD v0.11.0 фактические — `1417`/`412`. Числа живут отдельно от
  прогонов и разъезжаются при каждом пакете; `pnpm build`/`test` при этом
  зелёные, поэтому расхождение не видно.
- **Решение:** в S17 числа обновлены; на будущее — не дублировать метрики в
  чек-листе (ссылаться на отчёт/CI) либо генерировать их из прогона. Связано с
  KI-498 (дублирование метрик в README/docs/PROMPT) и KI-497 (сводка KI).

---

### KI-225 — Неточный маппинг 400 в LoginPage
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/auth/LoginPage.tsx`
- **Описание:** `400` от backend показывается как «не удалось
  связаться с сервером» — неточно.
- **Решение:** различать `400` и сетевую ошибку.
- **Когда чинить:** при UX-полировке.
- **Связанные:** KI-201.

---

### KI-005 — Frontend не покрыт CI (частично закрыт)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Запланировано:** v0.3.1
- **Файлы:** `.github/workflows/ci.yml`
- **Описание:** CI собирает только backend (`pnpm build` + `pnpm test`).
  Frontend `web/` не проверяется — сломанный TypeScript или Vite-build
  пройдёт незамеченным.
- **Fix:** добавить в `.github/workflows/ci.yml` новый job:
  - `working-directory: web`
  - `pnpm install --frozen-lockfile`
  - `pnpm build` (tsc -b + vite build)
  - (опционально) `pnpm lint` — после добавления ESLint/oxlint в web
- **Не блокер:** пока web маленький. Добавить вместе с Task 2 или Task 3.
- **Исправлено в:** v0.7.0 (частично, коммит `ea5571e`) — CI job
  `web`: `pnpm install --frozen-lockfile` + `pnpm build` + `pnpm test`.
  Линт в web-job пока не добавлен (нет скрипта `pnpm lint` в
  `web/package.json`) — остаётся открытым.

---

### KI-059 — Нет сигнала «попытки job'а исчерпаны»
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/runs/runs-stream.service.ts`,
  `src/runs/runs.processor.ts`
- **Описание:** После `run_completed(failed)` поток намеренно
  остаётся открытым (KI-040 может переиграть запуск), но когда
  BullMQ потратил все attempts, клиент об этом не узнаёт и держит
  соединение до отключения страницы. R4.2 не отличит «упал, сейчас
  retry» от «упал окончательно».
- **Решение:** добавить `attemptsMade`/`attempts` в
  `run_completed` (из `job` в процессоре) либо отдельное событие
  `run_exhausted`.
- **Когда чинить:** R4.2 (до UI-подсветки финального провала).
- **Связанные:** KI-040.
- **Fix:** `run_completed` несёт `attemptsMade`/`attempts` (из job
  в процессоре, KI-059). `isFinalCompletion` в `runs-stream.service`:
  `completed` — финал; `failed` + `attemptsMade >= attempts - 1` —
  финал; `attempts=null` — поток остаётся открытым. +7 тестов.
- **Остаток:** KI-060 (эвристика ломается на детерминированных
  провалах — цикл в графе), KI-061 (причина провала недоступна).

---

### KI-013 — `process.env` читается напрямую в обход `ConfigService`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/db.module.ts` (`DATABASE_URL`), `src/main.ts` (`PORT`)
- **Описание:** RULES § 4.6 требует читать env только через
  `ConfigService`. Сейчас `DbModule` и `main.ts` используют `process.env.X`
  напрямую — смешение подходов после добавления `ConfigModule` в R1.
- **Fix:** рефакторинг `DbModule.forRootAsync` на `ConfigService`,
  `main.ts` — `app.get(ConfigService).get('PORT')`.
- **Когда чинить:** рефакторинг при случае, не блокер.
- **Связанные:** KI-011.

---

### KI-576 — `agent_step_duration_seconds` без status/error label
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/agent/agent.service.ts`, `src/metrics/metrics.service.ts`
- **Описание:** по контракту S4 у метрики только label `model`; неуспешные LLM-шаги не записываются. Error-rate и latency отказов агента по метрикам не построить.
- **Решение:** в S5 добавить `agent_step_errors_total{model,reason}` или label `status` (правка контракта метрики и дашбордов).
- **Fix (v1.1.0 S4):** у `agent_step_duration_seconds` появился label `status`
  (`success`/`error`). В `AgentService` вызов LLM обёрнут в `try/catch`:
  успешный шаг пишется как `success`, ошибка — как `error`, после чего
  пробрасывается в retry-guard. Ошибки больше не смешиваются с нормальными
  шагами; дашборд считает их через
  `rate(agent_step_duration_seconds_count{status="error"}[5m])`. Тесты:
  `agent.service.spec.ts` (success/error), `metrics.service.spec.ts` (серии),
  смоук — реальный запуск с mock-LLM 500.
- **Связанные:** KI-574, KI-577, KI-581, KI-610.

### KI-512 — Тёмная тема: рамка `pending`-узла почти не видна (Low)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/styles/theme.css`,
  `web/src/components/nodes/BaseNode.tsx`
- **Описание:** `pending` — единственный статус без нового токена рамки:
  DESIGN § 3.6 оставил существующий `--color-node-pending` (тёмная тема —
  `slate-700`). На фоне `--color-node-bg-pending` = `slate-900` контраст рамки
  по CDP-смоуку S16 — 1.72:1 (в светлой теме `slate-200` на белом — ~1.3:1):
  контур карточки де-факто не читается. Для остальных статусов контраст
  рамки 3.1–8.4:1.
- **Решение:** добавить `--color-node-border-pending` (`slate-400` светлая /
  `slate-600` тёмная) и использовать в `STATUS_BORDER.pending`; либо осознанно
  принять нейтральный вид «не запускался».
- **Связанные:** KI-448, KI-445 (контраст миникарты — та же семья проблем).

---

### KI-346 — `typecheck` не покрывает drizzle/** и корневые скрипты
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `tsconfig.spec.json`, `tsconfig.build.json`, `drizzle/**`
- **Описание:** `migrate.ts`, `drizzle.config.ts` вне tsconfig.build.json и tsconfig.spec.json.
- **Решение:** отдельный tsconfig для скриптов и drizzle.
- **Связанные:** KI-317.

---

### KI-323 — TOCTOU: два конкурентных PATCH → `version +2`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/workflow.service.ts`
- **Описание:** Решение об инкременте по SELECT до UPDATE; сам
  инкремент атомарный (lost update невозможен), но два конкурентных
  PATCH с одинаковым payload дадут +2.
- **Решение:** транзакция либо `CASE WHEN nodes IS DISTINCT FROM …`.
- **Связанные:** KI-300, RULES 4.22.

---

### KI-158 — Миникарта теряется на тёмном фоне
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `474a93f`)
- **Файлы:** `web/src/styles/theme.css`
- **Описание:** Очертания узлов на миникарте были едва различимы, особенно в
  тёмной теме: маска (`--color-canvas-mask`) составляла 10% (в тёмной теме —
  `white 10%`, что «выбеливало» узлы вместо затемнения), а у самой миникарты не
  было рамки, и она сливалась с холстом.
- **Fix:** маска усилена до `color-mix(in oklab, black 30%, transparent)` в
  светлой теме и `black 60%` в тёмной; миникарте добавлены рамка, скругление и
  тень; контур узлов миникарты чуть плотнее.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-134, KI-167.

---

### KI-315 — Публичная share-страница не получает `fitViewOptions`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.2 (коммит `a32023f`)
- **Fix:** `<ReactFlow fitViewOptions={FIT_VIEW_OPTIONS} fitView />`
  (`web/src/lib/fit-view-options.ts`). CDP-замер (Text Y=−5000):
  zoom 0.154905, оба узла в кадре; до фикса — 0.5, оба за кадром.
- **Файлы:** `web/src/components/ShareViewPage.tsx`
- **Описание:** Булев `fitView` идёт через store-fitViewOptions (у
  страницы их нет) → `minZoom = 0.5` (дефолт). Граф с большим
  разбросом на публичном просмотре останется без узлов в кадре.
- **Решение:** `<ReactFlow fitViewOptions={{ padding: 0.2, maxZoom: 1,
  minZoom: 0.02 }} fitView />`.
- **Связанные:** KI-306.

---

### KI-468 — ServeStatic не перехватывает `/` и `/workflow/share/*`: контроллеры регистрируются раньше (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 Docker
- **Файлы:** `src/app.module.ts`
- **Описание:** `ServeStaticModule.register()` вызывается в `onModuleInit`,
  то есть **после** регистрации контроллеров. `GET /` перехватывал
  `AppController` (возвращал `Hello World!`), а `GET /workflow/share/:token` —
  `WorkflowShareController` (возвращал JSON). Браузер не получал SPA ни на
  корне, ни по публичной share-ссылке. Дополнительно `req.path` внутри
  Nest-middleware обрезан до пути монтирования (`/`), поэтому проверка пути
  по `req.path` ошибочно срабатывала для всех HTML-запросов.
- **Решение:** в `AppModule.configure()` добавлена middleware, которая
  регистрируется **до** роутера и отдаёт `web/dist/index.html` только для
  `GET`, `Accept: text/html` и путей `/` или `/workflow/share/*`. Маршрут
  берётся из `req.originalUrl`. API-ручки и прямые скачивания
  (`/media/file/...`, `/workflow/:id/export`) не перехватываются.
- **Связанные:** KI-238, KI-467.

---

### KI-259 — `addNodeOnEdge`: тип без входного порта удаляет связь и не создаёт новых
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0d (R6.4a-fix5, коммит `21fdad7`)
- **Fix:** `NODE_REGISTRY.canBeInsertedOnEdge` (единый источник
  правды) + `NodeCatalogPopover.filter` + защита в `addNodeOnEdge`
  (не удалять связь, если тип без входного порта). + notice
  `canvas.edge.cannotInsert`.
- **Связанные:** KI-185, KI-127, KI-262.
- **Файлы:** `web/src/stores/workflow.ts` (`addNodeOnEdge`),
  `web/src/lib/node-registry.ts`
- **Описание:** При вставке на связь узла без входного порта
  (`Text`) `addNodeOnEdge` удаляет исходную связь и пытается
  создать `source → new` с `targetHandle: null`; React Flow
  резолвит null в первый handle нужного типа, у Text `handleBounds.
  target = []` → `error008`, новая связь не создаётся, старый
  граф теряет связь.
- **Решение:** (а) поле `inputHandleId: string | null` в
  `NODE_REGISTRY` — фильтровать каталог вставки; (б) если
  `source → new` не создаётся — не удалять исходную связь.
- **Связанные:** KI-185, KI-127.

---

### KI-439 — Комментарии спеков web ссылаются на `environment: 'node'`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.3
- **Fix:** шапки спеков переписаны под jsdom (заглушка `@/i18n` и моки
  `matchMedia`/`ResizeObserver` объяснены отсутствием API в jsdom);
  логика тестов не менялась.
- **Файлы:** `web/src/stores/*.spec.ts`
- **Описание:** после перехода на jsdom (KI-155) шапки спеков
  (`generation-store.spec.ts`, `image-tool-store.spec.ts`,
  `workflow-nodes.spec.ts`, `workflow.spec.ts`) продолжают объяснять заглушку
  `@/i18n` и мок `window` тем, что «тесты идут в `environment: 'node'` — без
  jsdom». Комментарии врут: окружение уже jsdom, а мок нужен ради API, которых
  в jsdom нет (`matchMedia`, `ResizeObserver`). Читатель делает вывод, что
  компоненты по-прежнему не тестируются.
- **Решение:** переписать шапки под jsdom (что именно не реализовано в jsdom
  и зачем заглушка), логику тестов не трогать.
- **Связанные:** KI-155.

---

### KI-011 — `REDIS_URL` обязателен в `validateEnv()`, но в CI нет Redis
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/config/env.schema.ts`, `.github/workflows/ci.yml`,
  `test/app.e2e-spec.ts`
- **Описание:** `EnvSchema.REDIS_URL` объявлен как `z.url()` без default.
  Unit-тесты (`pnpm test`) проходят — они не поднимают `AppModule` с реальным
  `ConfigModule`. Но любой e2e (`test/app.e2e-spec.ts` через
  `Test.createTestingModule({ imports: [AppModule] })`) упадёт с
  `validateEnv` → `Error` на CI и на чистой машине без Redis.
- **Возможные решения:**
  1. `.default('redis://127.0.0.1:6379')` в схеме — теряется fail-fast.
  2. Service-контейнер Redis в GitHub Actions (правильно, но +30 сек CI).
  3. Мок `ConfigService` в e2e.
- **Когда чинить:** при добавлении e2e в CI (R2/R4).
- **Связанные:** KI-012.

---

### KI-318 — Vitest не читает `.env` → гейт KI-298 silently skipped
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `ca21f30`)
- **Файлы:** `vitest.config.ts`, `package.json`
- **Описание:** Vitest не переносит `.env` в `process.env` — локальный
  `pnpm test` показывает «зелено», а паритет схемы не проверялся.
- **Решение (проверено):** `"test:parity": "node --env-file=.env
  node_modules/vitest/vitest.mjs run src/db/schema-parity.spec.ts"`.
- **Fix:** `"test:parity": "node --env-file=.env node_modules/vitest/
  vitest.mjs run src/db/schema-parity.spec.ts"` — явный запуск
  паритет-гейта с .env. `vitest.config.ts` не менялся (иначе корневой
  pnpm test начал бы зависеть от живой БД). Проверено: `pnpm test:parity`
  → 6/6.
- **Остаток:** KI-344 (обычный `pnpm test` без DATABASE_URL молча
  скипает гейт).
- **Связанные:** KI-298.

---

### KI-456 — `read_file` в S0 помечен как вставляемый в связь (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 (S8)
- **Fix:** в `NODE_REGISTRY` выставлено `read_file.canBeInsertedOnEdge:
  false`, target-хендл в `ReadFileNode` не рисуется, исполнитель берёт путь
  только из `data.path`; связь не может подменить путь.
- **Файлы:** `web/src/lib/node-registry.ts`,
  `web/src/components/nodes/ReadFileNode.tsx`,
  `src/engine/node-executors.ts`, `src/engine/node-ports.ts`
- **Описание (историческое):** по заданию S0 у всех четырёх каркасных узлов
  стоял `canBeInsertedOnEdge: true`, включая `read_file`. DESIGN v0.10 § 3.3.4
  требует обратного: `read_file` — source-only (`false`), потому что путь
  читается только из `data.path`, а вход `prompt` дал бы LLM управлять путём
  (prompt injection / path traversal).
- **Решение:** в S8 при добавлении компонента и `NODE_PORT_CONTRACT` выставить
  `read_file.canBeInsertedOnEdge = false` и не рисовать target-хендл; закрыть
  security-тестами на попытку подать путь через вход.
- **Связанные:** KI-455, KI-477, DESIGN v0.10 § 3.3.

---

### KI-602 — Удаление не чистит приглашения, отправленные участником, и шаблоны с его `created_by`
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`, `src/db/schema.ts`
- **Описание:** при удалении удаляются только строки `workflow_collaborators`
  участника; `organization_invitations.invited_by` (отправленные им приглашения)
  и `document_templates.created_by` (загруженные им шаблоны) остаются с
  указателем на переехавшего пользователя. Для организации это безвредно:
  приглашения фильтруются по её `organization_id`, шаблоны — по `workflow_id`,
  а `created_by` не участвует в проверке доступа; но это «висячие» ссылки на
  пользователя другой организации, которые видны в аудите/будущем UI.
- **Решение:** при удалении переоформлять `organization_invitations.invited_by`
  на владельца или удалять pending-приглашения; `created_by` оставить
  историческим (аудит) и документировать; при появлении UI шаблонов — не
  показывать автора из другой организации.
- **Связанные:** KI-586, KI-560.

### KI-371 — `applyToolAsync` обязателен для `IMediaProvider`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.3)
- **Fix:** обязательство выполнено: `applyToolAsync` реализован во всех
  трёх провайдерах R7.3 — Replicate, FAL и OpenAI Images; `tsc` не падает,
  optional/fallback не понадобился.
- **Файлы:** `src/media/media-provider.interface.ts`,
  `src/media/providers/replicate.provider.ts`,
  `src/media/providers/fal.provider.ts`,
  `src/media/providers/openai-images.provider.ts`
- **Описание (историческое):** `IMediaProvider.applyToolAsync` обязателен →
  провайдеры R7.3 (Replicate / FAL / OpenAI Images) обязаны реализовать,
  иначе `tsc` упадёт.
- **Решение:** в R7.3 — реализация в каждом провайдере; либо сделать
  метод optional (`applyToolAsync?: ...`) с default fallback.
- **Связанные:** KI-363, KI-380, R7.3.

---

### KI-347 — SSE-снимок не несёт `run.error`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.4 (коммит `87455f2`)
- **Файлы:** `src/runs/runs-stream.service.ts`, `web/src/stores/workflow.ts`
- **Описание:** После F5 панель показывает «Ошибка запуска: причина недоступна», хотя в `workflow_runs.error` текст есть.
- **Решение:** включить `error` в snapshot-событие потока.
- **Связанные:** KI-288.
- **Fix:** `RunSnapshotSchema.error = z.string().nullable()`; снимок
  читается через новый `runs.service.getRunRowAsync` (owner-check
  переиспользован, публичный REST-ответ не расширялся); зеркало web
  обновлено, `applySnapshot` пишет `runError = snapshot.run.error ??
  state.runError` (не перетирает null'ом). CDP-смоук: реальный
  прогон (http 404 + failOnHttpError) → F5 → панель «Ошибка запуска:
  HTTP 404».
- **Остаток:** KI-352, KI-077.
- **Связанные:** KI-271, KI-288.

---

### KI-166 — Frontend и backend расходятся в источнике промпта media-узла
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `29f4e19`)
- **Файлы:** `src/media/media-node-executor.service.ts` (`readPrompt`),
  `web/src/components/nodes/ImageGenNode.tsx`,
  `web/src/stores/workflow.ts`
- **Описание:** После KI-160 промпт хранился в `data.prompt`, а исполнитель
  читал `inputs.prompt` → `data.value`. Связь была скрытой: промпт сохранялся,
  но до генерации не доходил, и узел падал с «Пустой prompt» без единой ошибки
  в логах. В v0.7.1 расхождение временно маскировалось записью в оба ключа.
- **Fix:** `readPrompt` читает `inputs.prompt` → `data.prompt` → `data.value`
  (последнее — для workflow, сохранённых до появления `data.prompt`);
  дублирование во frontend убрано, при загрузке старый `value` переносится
  в `prompt`.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-160, KI-122.

---

### KI-217 — `@types/express` не объявлен в devDependencies
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (проверено при Пакете 3, коммит 4a214f7)
- **Fix:** правка не потребовалась — `@types/express@^5.0.0` уже
  присутствует в devDeps (добавлено при R6.1a/R6.1b).
- **Файлы:** `package.json`, `src/auth/auth.controller.ts`
- **Описание:** `Request` / `Response` из `express` используются в
  `auth.controller.ts`, но `@types/express` приходит транзитивно через
  `@nestjs/platform-express` — при смене зависимостей типы могут пропасть.
- **Решение:** явный `@types/express` в devDependencies.
- **Когда чинить:** при следующей чистке deps.
- **Связанные:** —

---

### KI-613 — Scrape-config `localhost:3000` зависит от способа запуска Prometheus
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-04
- **Файлы:** `infra/prometheus/prometheus.yml`
- **Описание:** target `localhost:3000` корректен, когда Prometheus запущен на
  хосте рядом с backend. В Docker-сети `localhost` указывает на сам контейнер
  Prometheus: нужен `host.docker.internal:3000` (Docker Desktop) или DNS-имя
  сервиса backend; в Kubernetes — Service/namespace с network policy.
  Конфиг — локальный пример, не production-манифест.
- **Решение:** в S6 добавить варианты конфига для docker-compose/k8s и
  задокументировать target в RELEASES/ops; `/metrics` не публиковать наружу
  (KI-575).
- **Связанные:** KI-575, KI-582, KI-610.

## v1.1.0 — Security Polish (S5, 2026-11-05)

### KI-469 — `migrate.ts` не попадал в `dist`, entrypoint не мог применить миграции (High)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 Docker
- **Файлы:** `tsconfig.migrate.json`, `package.json`, `Dockerfile`,
  `docker-entrypoint.sh`
- **Описание:** `migrate.ts` лежит в корне, а `nest build` использует
  `tsconfig.build.json` с `rootDir: ./src` и `include: ["src"]`. Поэтому
  `pnpm build` удалял `dist` и не создавал `dist/migrate.js`; entrypoint
  `node dist/migrate.js` падал бы с `MODULE_NOT_FOUND` ещё до старта
  приложения. Отдельный скрипт миграций `pnpm db:migrate` использует `tsx`,
  которого нет в production-образе после `pnpm prune --prod`.
- **Решение:** добавлен `tsconfig.migrate.json` (`rootDir: "."`,
  `outDir: "./dist"`, `include: ["migrate.ts"]`) и скрипт
  `pnpm build:migrate`. Dockerfile выполняет
  `pnpm build && pnpm build:migrate`; runner получает готовый
  `dist/migrate.js`. Порядок «миграции → приложение» проверен логами
  контейнера.
- **Связанные:** KI-470.

---

### KI-571 — `GET /admin/audit` считает `total` отдельным `count(*)` на каждый запрос
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/audit.service.ts`
- **Описание:** как и в истории запусков (v0.14 S1), `total` — отдельный
  `count(*)` по журналу организации на каждый запрос страницы. Индекс
  `audit_logs_org_created_id_idx` покрывает фильтр, но на большом журнале каждая
  страница платит за подсчёт. `total` нужен только счётчику UI.
- **Решение:** при появлении жалоб на производительность — убрать `total` из
  контракта (UI уже умеет жить по `nextCursor`), либо перейти на
  приблизительный `count`/кэш; решение принять вместе с UI аудита (S5).
- **Связанные:** KI-542, KI-573, S5.

### KI-181 — Media-модели с не-generic params (Yandex Art) падают
- **Приоритет:** 🟠 High | **Статус:** Fixed (частично) | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.7.2 (коммит `675ca23`)
- **Файлы:** `src/media/dto/media-task.dto.ts`,
  `src/media/dto/media-task.mapper.ts`,
  `src/media/media-registry.service.ts`,
  `src/media/media-node-executor.service.ts`
- **Описание:** `yandex-art` через CreativeLab/GPTunnel падал с
  `Invalid input, check schema issues`.
- **Диагностика (2026-10-15):** params в `/media/models` для
  `yandex-art` корректны (`aspect_ratio:enum`, `inputs: []`) — наш payload
  подходил. Реальная причина: GPTunnel возвращает
  `error:{code:1, title:"EXCEPTION", message:"Internal server error"}`,
  `refunded:true` — падает на их стороне (4/4 прогонов). Наша схема
  `MediaTaskResponseSchema` объявляла `error: z.string()` → `safeParse`
  падал → в UI показывалось «Invalid input» вместо настоящей причины.
- **Fix:** схема принимает объектную форму ошибки; executor показывает
  `EXCEPTION: Internal server error` (refunded); параметры запроса
  собираются по `params` модели из каталога, а не хардкодятся.
- **Остаток:** генерация `yandex-art` через GPTunnel не работает на их
  стороне. Нужен тикет в GPTunnel или отдельный endpoint Yandex Art —
  KI-184.
- **Когда чинить:** — (закрыто частично, v0.7.2)
- **Связанные:** KI-101, KI-154, KI-166, KI-184.

### KI-249 — Union `ReasoningEffort` продублирован в трёх местах
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/llm/llm-provider.interface.ts`,
  `web/src/lib/llm-node-fields.ts`, `web/src/types/graph.ts`
- **Описание:** Union `'off'|'medium'|'high'` объявлен на backend и
  дважды на frontend (`types/graph.ts` + `lib/llm-node-fields.ts`).
  При добавлении `low`/`minimal` (KI-246) легко забыть одно место.
- **Решение:** `types/graph.ts` импортирует `ReasoningEffort` из
  `lib/llm-node-fields.ts`; backend/frontend синхронизировать через
  общий источник (или паритет-тест на строку-литерал).
- **Когда чинить:** при расширении union (KI-246).
- **Связанные:** KI-246, KI-248.

---

### KI-540 — Нет индекса под запрос истории запусков
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`, `drizzle/`
- **Описание:** у `workflow_runs` есть только PK `id`; в PostgreSQL FK
  (`workflow_id → workflows.id`) не создаёт индекс автоматически. Запрос
  истории (`WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT/OFFSET`) и
  `count(*)` идут seq scan'ом по всей таблице запусков. С ростом истории (см.
  риск retention в DESIGN V014 § 7) время ответа будет расти линейно.
- **Решение:** миграция с индексом
  `workflow_runs (workflow_id, created_at DESC)` + covering по `id`;
  при пагинации большими `offset` — keyset-пагинация.

### KI-605 — Write-пути аудита и создания workflow берут `orgId` из токена
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S5) | **Обнаружено:** 2026-11-04
- **Файлы:** `src/audit/audit.interceptor.ts`, `src/workflow/workflow.service.ts`,
  `src/workflow/workflow.controller.ts`, `src/templates/templates.controller.ts`,
  `src/auth/guards/jwt-auth.guard.ts`
- **Описание:** S3 закрыл **чтение** журнала от устаревшего `orgId` (KI-587):
  `AuditService.listAsync` берёт организацию из `users`. Но запись записи и
  создание workflow по-прежнему используют `toWorkflowAccess(user).orgId` из
  access-токена: `AuditInterceptor` пишет `organization_id` из JWT, а
  `WorkflowService.createAsync` вставляет `organizationId = access.orgId`.
  Следствие (подтверждено смоуком): удалённый участник со старым токеном
  (24 ч) может выполнить `POST /workflow` и создать граф в организации, из
  которой его исключили; запись об этом попадёт в её журнал аудита. Владелец
  этот граф не увидит (`workflowAccessListFilter` ищет владельца/участника), а
  участник не увидит журнал (S3) — то есть это «мусор» в чужой организации и
  загрязнение журнала, а не чтение чужих данных.
- **Решение:** резолвить `organization_id` из `users` во всех write-путях:
  в `AuditInterceptor` — один SELECT по `sub` перед INSERT (или кэш на запрос);
  в `createAsync`/`importAsync` — читать организацию из БД либо ввести
  `workflowAccessFromDbAsync(userId)` и использовать его в контроллерах.
  Полный отзыв access-токена (token_version/blacklist) — отдельная задача
  вместе с KI-601.
- **Fix (v1.1.0 S5):** организация в write-путях больше не берётся из токена.
  `JwtAuthGuard` читает `users.organization_id`/`token_version` и кладёт в
  `request.user` актуальную организацию (или 401), поэтому `AuditInterceptor`
  и все `toWorkflowAccess`-пути используют БД-значение. Дополнительно
  `WorkflowService.createAsync`/`importAsync` принимают только `userId` и сами
  резолвят организацию из `users` (вторая граница, RULES 1.17); контроллеры
  `workflow`/`templates` передают `user.sub`. Смоук: удалённый B старым токеном
  получает 401 на `POST /workflow`, новых записей в журнале A нет.
- **Связанные:** KI-587, KI-601, KI-615, DESIGN V110 § 3.5.

### KI-028 — Дублирование `toMessage` в 4 файлах
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.service.ts`, `src/runs/run-events.service.ts`,
  `src/runs/runs.processor.ts`, `src/engine/execution-engine.service.ts`
- **Решение:** вынести в `src/common/utils/to-message.ts`.
- **Когда чинить:** при следующей правке одного из файлов.
- **Связанные:** —

---

### KI-532 — `isPidAlive` трактует `EPERM` как «процесс мёртв»
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.13.0 (S1) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp-client.service.ts`
- **Описание:** `process.kill(pid, 0)` при `EPERM` возвращает false → `SIGKILL` не отправляется, возможен orphan.
- **Решение:** различать `ESRCH` (мёртв) и `EPERM` (жив).

### KI-052 — `calculateCostUsd` возвращает 0 при отсутствии usage
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/llm/model-pricing.ts`
- **Описание:** Если провайдер не отдал `usage` (`inputTokens` и
  `outputTokens` = null), `calculateCostUsd` подставляет `?? 0` и
  возвращает `0`. В `node_runs.cost_usd = 0` неотличим от бесплатного
  вызова; для биллинга «неизвестно» и «ноль» — разные вещи.
- **Решение:** вернуть `null`, если **оба** счётчика null; если один —
  считать по известному. Либо хранить признак «метрики недоступны».
- **Когда чинить:** вместе с KI-039 или отдельным микро-шагом (R4-prep).
- **Связанные:** KI-038, KI-053.
- **Fix:** `if (inputTokens === null && outputTokens === null) return null`.
  Частичные метрики (один токен известен, второй null) считаются
  как раньше. +2 теста. Smoke: `cost_usd` остаётся NULL при падении
  провайдера (было 0).

---

### KI-131 — Связь `NodeType ↔ data.kind` не проверяется tsc
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/types/graph.ts`, `web/src/lib/node-registry.ts`
- **Описание:** После R5.1 `NodeData` — дискриминированный union по
  `kind`, а `NODE_REGISTRY` — `as const satisfies Record<NodeType,
  NodeRegistryEntry>`. Но `satisfies` проверяет **только форму
  записи**: `component` — объединение трёх компонентов, поэтому
  `text: { component: LLMNode }` пройдёт молча. Аналогично, связь
  `node.type='llm'` ↔ `data.kind='image'` не проверяется
  компилятором, хотя JSDoc в `graph.ts` и DESIGN § 6 обещают
  обратное.
- **Возможные решения:**
  1. Рядом с реестром — маппинг `Record<NodeType, NodeData['kind']>`,
     и generic-хелпер `entry<K extends NodeType>(type: K, entry:
     Entry<NodeDataOf<K>>)`. Тогда `text: entry('llm', ...)` — ошибка.
  2. Discriminated `NodeRegistryEntry` по `kind` (не по `NodeType`).
  3. Type-тест (vitest + `expectTypeOf`) — когда появится
     frontend-инфраструктура (KI-068).
- **Когда чинить:** R5.3 (i18n) или R5.4 (каталог) — обе задачи
  трогают `NODE_REGISTRY`. Type-тест — **опционально**, если
  KI-068 (frontend-инфраструктура) закроют до R5.3; иначе —
  решения 1–2 (generic-хелпер или discriminated entry).
- **Связанные:** KI-121, KI-129, KI-068.

---

### KI-055 — Прайс-лист статичен и неполон
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.9.0 (R7.7, коммит `3e2844a`)
- **Fix:** кэш-токены учитываются в прайсе и расчёте:
  `cacheReadPerMillionUsd` / `cacheCreationPerMillionUsd` в
  `ModelPricing`, `LlmCacheTokens` (+ `cacheTokensIncludedInInput` —
  Anthropic отдаёт кэш отдельно от `input`), `calculateCacheSavingsUsd`,
  колонки `node_runs.cache_read_tokens` / `cache_creation_tokens`
  (миграция 0009), строка «Cache read: N (экономия $X)» в панели
  результата. Кэш-токены без отдельного тарифа считаются по входной цене —
  стоимость не занижается.
- **Остаток:** версионирование таблицы и batch-скидки не сделаны; включение
  Anthropic prompt caching — KI-414.
- **Файлы:** `src/llm/model-pricing.ts`, `src/llm/token-usage.ts`,
  `src/db/schema.ts`, `web/src/components/RunResultPanel.tsx`
- **Описание:** `MODEL_PRICING` не содержит даты актуализации/версии,
  не учитывает **cache-токены** Anthropic
  (`cache_read_input_tokens` / `cache_creation_input_tokens`
  игнорируются) и **batch-скидки**, не покрывает новые модели —
  при появлении такой модели `cost_usd` молча станет `null`.
- **Решение:** версионировать таблицу, учитывать cache-токены,
  логировать промахи прайса.
- **Когда чинить:** до прод-биллинга.
- **Связанные:** KI-038, KI-052.

---

### KI-384 — `pricing` каталога не читается: `price` ≠ фактическая стоимость media
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.0 (R7.2b, коммит `2172d1a`)
- **Fix:** DTO и маппер читают блок `pricing` каталога (`fixed` /
  `per_second` / `per_character` / `matrix` / `tiers` / `plus`), оценка
  бюджета считается по параметрам вызова (`duration`, `resolution`, длина
  текста), а не по `price`. `tts2` (`price=0`, `per_character.ratePer1K=60`)
  больше не даёт нулевую оценку.
- **Остаток:** `pricing.plus` и `expr.units`-объекты не учитываются —
  KI-393; семантика `matrix.unitParam` — KI-392.
- **Файлы:** `src/media/dto/media-model.dto.ts`,
  `src/media/dto/media-model.mapper.ts`, `src/runs/cost-budget.service.ts`,
  `src/media/media-node-executor.service.ts`
- **Описание:** Каталожный `price` расходится со списанием: `glabs-veo-3` 480 vs
  `pricing.cost` 960; `glabs-veo-3-1-fast` 49 vs 245; `kling-v3` 210 vs
  `per_second` 33.6 ₽/с (5 с → 168 ₽); `sound-effect` `price_unit=per_second`;
  `tts2` `price=0`, `price_unit` отсутствует, а фактически списано 2.04 ₽
  (`pricing.per_character.ratePer1K=60`). Оценка бюджета (KI-048) для media
  недооценивает стоимость, для `tts2` равна нулю — hard cap не срабатывает.
- **Решение:** читать блок `pricing` (fixed / per_second / per_character /
  matrix / expr) в DTO+маппер и считать оценку по параметрам вызова
  (`duration`, `resolution`, длина текста), а не по `price`.
- **Связанные:** KI-048, KI-112, KI-372, R7.2.

---

### KI-506 — `NodeRunSnapshot` гейтуется двумя файлами
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `sse-contract.json`, `api-contract.json`
- **Описание:** Новое поле требует правок в двух JSON. Если забудут вторую — упадёт гейт.
- **Решение:** связать схемы ссылкой или генерировать `api-contract.json` из `sse-contract.json`.

---

### KI-267 — `loadWorkflowAsync` при ошибке схемы молчит в консоль
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts` (`loadWorkflowAsync`)
- **Описание:** При `ApiWorkflowSchema.parse` Zod-ошибка попадает
  в notice, но **не в console.warn** — диагностика Load затруднена
  (поймано в смоуке R6.4b.2a).
- **Решение:** в catch — `console.warn('[loadWorkflow]', error)`.
- **Когда чинить:** при следующей правке стора.
- **Связанные:** KI-266.

---

### KI-470 — В Docker-runner не копировались JSON-шаблоны `src/templates` (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 Docker
- **Файлы:** `Dockerfile`
- **Описание:** `nest build` не копирует `.json`-ассеты в `dist` (это уже
  известно как KI-289). `TemplateLoaderService` ищет шаблоны в
  `dist/templates` и в фолбэке `<repo>/src/templates`. В runner-стадии
  `src/` отсутствовал, поэтому `GET /templates` вернул бы пустой список,
  хотя приложение стартовало бы без ошибки (fail-soft).
- **Решение:** в runner добавлен
  `COPY --from=builder /app/src/templates ./src/templates`. В логе контейнера
  — `Шаблоны загружены: 3 из 3 (/app/src/templates)`.
- **Связанные:** KI-289.

---

### KI-048 — Нет предохранителя по стоимости повторов
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.9.0 (R7.1, коммит `1dc35f5`)
- **Fix:** `CostBudgetService` — лимит стоимости на запуск (`hard`/`soft`,
  дефолт `$5` / `500 ₽`, `WORKFLOW_RUN_MAX_COST_*`). Оценка media-вызова
  считается по каталогу и проверяется **до** обращения к провайдеру
  (`assertWithinBudgetAsync`), при превышении узел падает без списания.
  Повторы не обходят предохранитель: каждый повторный вызов проходит ту же
  проверку по уже потраченному.
- **Остаток:** KI-372 (фиксированный курс, нулевая оценка LLM-вызова),
  KI-407 (Agent и `llm_call` обходят бюджет).
- **Файлы:** `src/runs/cost-budget.service.ts`,
  `src/media/media-node-executor.service.ts`
- **Описание:** До 3 job-попыток × 3 node-попыток = до 9 вызовов
  провайдера на узел за запуск, и каждый job-retry прогоняет **весь
  граф** заново (KI-046).
- **Решение:** бюджет/лимит вызовов на запуск или circuit breaker
  по 429 (связан с KI-042).
- **Когда чинить:** перед прод-запуском.
- **Связанные:** KI-036, KI-040, KI-042, KI-046.

---

### KI-033 — Неизвестный `sourceHandle` подменяется дефолтом по типу узла
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/engine.service.ts`, `src/engine/node-ports.ts`
- **Описание:** После KI-030 формула стала
  `handleIdToOutputPort(sourceHandle) ?? inferDefaultOutputPort(type)`.
  Для «явного, но неизвестного» хэндла (`'custom'`, `'result'`) это
  молча подменяет порт на тип-дефолт: если узел-источник отдаёт
  не-дефолтный порт, вход снова получит `null`. До KI-030 такое значение
  проходило насквозь.
  Дополнительный риск: `handleIdToOutputPort` ищет хэндл по **всем**
  контрактам без сверки с типом узла-источника — узел `image_generation`
  с чужим `sourceHandle='text-output'` получит `fromPort='text'`, хотя
  у него в `outputs` только `url`.
- **Возможные решения:**
  1. Type-aware резолвер: сначала сверить `edge.sourceHandle` с
     контрактом именно `sourceNode.type`, потом fallback на тип,
     потом — на пропуск насквозь.
  2. Валидировать принадлежность `sourceHandle`/`targetHandle` типам
     концов связи в `EngineService.validateGraphAsync` и отдавать
     в `errors`.
- **Когда чинить:** R4 (multi-input) или раньше, если кейс всплывёт.
  Понижено с 🟠 High до 🟡 Medium: текущие типы узлов (`text`, `llm`,
  `image_generation`) имеют только дефолтный хэндл, экзотических графов
  нет.
- **Связанные:** KI-030, KI-034.

---

### KI-126 — Нет i18n (RU/EN, расширяемо)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `ea5571e`)
- **Файлы:** `web/src/components/*`, `web/src/stores/*`
- **Описание:** Все строки захардкожены на русском в JSX.
  RULES 1.14 требует i18n-файлы (en.json + ru.json) + тест, но они
  ещё не заведены. Интерфейс невозможно перевести без рефакторинга.
- **Возможные решения:**
  1. `react-i18next` + `i18next` — стандарт, есть lazy-loading.
  2. `@lingui/react` — компактнее, менее распространён.
  3. Своя реализация на `Intl` — только если пакет запрещён.
- **Требования:**
  - Ключи в `web/src/i18n/{ru,en}.json` (плоские, dot-notation).
  - Язык в `localStorage` + `Accept-Language` fallback.
  - Тест: все ключи в `ru.json` есть в `en.json` и наоборот.
  - RULES 1.14 — обновить, если формулировка нужна другая.
- **Когда чинить:** — (закрыто, v0.7.0).
- **Fix:** react-i18next + i18next. `web/src/i18n/index.ts` — init,
  `detectInitialLanguage` (localStorage -> navigator.language -> 'ru'),
  `setLanguage`. `ru.json` / `en.json` — 84 ключа, паритет-тест
  (`i18n.spec.ts`, 2/2). `node-registry`: `tLabel` / `TEMP_LABELS`
  удалены, `nodeLabelOf` -> `i18n.t()`. Компоненты (`TopBar`,
  `Toolbar`, `BaseNode`, `TextNode`, `LLMNode`, `ImageGenNode`,
  `RunResultPanel`, `LoadModal`) на `useTranslation()` + `t()`;
  `stores/workflow.ts` -> `i18n.t()`. Кнопка RU/EN в `TopBar`.
  CI job `web` (install + build + test). Bundle 528 -> 585 kB
  (+56 kB i18next).
- **Остаток:** KI-138 (тосты хранят текст), KI-139 (peer
  react-i18next / TS 6), KI-140 (строки Zod вне UI).
- **Связанные:** KI-005, KI-068, KI-137, KI-138, KI-139, KI-140,
  KI-141, KI-142.

---

### KI-070 — Промежуточный провал выглядит как окончательный
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `web/src/components/TopBar.tsx`, `web/src/stores/workflow.ts`
- **Описание:** При `run_completed(failed, final=false)` (будет retry,
  KI-040) бейдж на ~2 сек меняется на «Ошибка», кнопка Run
  разблокируется. Пользователь может запустить второй прогон, пока
  BullMQ ещё повторяет первый.
- **Решение:** «Ошибка (повтор N/M)» и кнопка заблокирована до `final=true`.
- **Когда чинить:** R4.3.
- **Связанные:** KI-040, KI-059, KI-060.
- **Fix:** при `run_completed(failed, final=false)` `runStatus`
  остаётся `'running'`, добавляется `runHasMoreAttempts: true`.
  Бейдж продолжает «Выполняется… (попытка N/M)», кнопка Run
  заблокирована до `final=true`. Smoke: timeline без «Ошибка»
  до финала, `runDisabled=true` на промежуточных провалах.

---

### KI-413 — TTL локальных media-файлов не чистится
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 — `MediaCleanupService` + BullMQ cron.
- **Дополнено в:** v0.10.2 — очистка по TTL из БД (`storage_key`, а не только
  mtime) и очистка файлов workspace (`WORKSPACE_TTL_DAYS`, default 30;
  `0` — выключено).
- **Fix:** `MediaCleanupService` + `MediaCleanupProcessor`: BullMQ
  `upsertJobScheduler` с cron `0 3 * * *`; удаляются файлы
  `./data/media/{runId}/` старше `MEDIA_STORAGE_LOCAL_TTL_DAYS` (по `fs.stat`,
  без БД), опустевшие каталоги убираются. `TTL=0` — очистка выключена.
  Префикс/БД Redis общие с очередью запусков (KI-387).
- **Файлы:** `src/media/media-cleanup.service.ts`, `src/media/media.module.ts`
- **Связанные:** KI-362, KI-215 (cleanup `refresh_tokens` — тот же паттерн),
  KI-427.

---

### KI-324 — Frontend hash vs backend deep-equal (type)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/lib/graph-hash.ts`, `src/workflow/workflow.service.ts`
- **Описание:** `computeGraphHash` игнорирует type узла, backend
  deep-equal — нет; смена только type без data/position фронтом
  не отправится. Практический риск ≈0.
- **Связанные:** KI-300.

---

### KI-251 — Нет unit-теста на `nodeDataFromApi` (LLM-поля)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts`,
  `web/src/stores/workflow.spec.ts` (нет)
- **Описание:** Перенос `systemPrompt` / `reasoningEffort` /
  `maxTokensOverride` в `nodeDataFromApi` покрыт только CDP-смоуком.
  Валидаторы вынесены в `llm-node-fields.ts` и покрыты тестами, а
  сам маппинг — нет.
- **Решение:** unit-тест на `nodeDataFromApi` (или выделить
  `mapLlmNodeFromApi` в `lib/*` и покрыть).
- **Когда чинить:** вместе с KI-155 (frontend-инфраструктура тестов).
- **Связанные:** KI-155, KI-192, KI-193.

---

### KI-220 — `COOKIE_SECURE=false` разрешён в production
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (Пакет 3, коммит 4a214f7)
- **Fix:** superRefine: `NODE_ENV=production` + `COOKIE_SECURE=false`
  → отказ старта. +2 теста.
- **Файлы:** `src/config/env.schema.ts`, `src/auth/auth.cookie.ts`
- **Описание:** Аналогично KI-213 — в prod `COOKIE_SECURE=false` явно
  разрешён и приведёт к отправке refresh-cookie по http. Secure-флаг
  по умолчанию берётся от `NODE_ENV`, но явный `false` его перебивает.
- **Решение:** superRefine (production + `COOKIE_SECURE=false` → отказ)
  или принудительный `secure: true` в prod, игнорируя env.
- **Когда чинить:** v0.8.x (security, как KI-213).
- **Связанные:** KI-213, KI-201.

---

### KI-515 — `THROTTLER_STORAGE=memory` создает Redis-соединение
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/common/throttler/redis-throttler.storage.ts`
- **Описание:** `RedisThrottlerStorage` инжектится всегда и делает `duplicate()`, даже если выбран in-memory режим.
- **Решение:** создавать хранилище лениво.

---

### KI-183 — maxTokens не учитывает reasoning-модели
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0c (коммит `283ce94`)
- **Fix:** `ModelInfo.defaultMaxTokens` + env-суффикс `:reasoning` →
  4096 (обычные модели — 1024). `LlmNodeExecutor` читает
  `data.maxTokensOverride` (приоритет над дефолтом). +тесты.
- **Связанные:** KI-192, KI-193.
- **Файлы:** `src/llm/providers/openai-compatible.provider.ts`
  (`DEFAULT_MAX_TOKENS`), `src/llm/llm-provider.interface.ts`
  (`LlmGenerateOptions`)
- **Описание:** Модели с reasoning (deepseek-v4-flash через GPTunnel)
  тратят бюджет 1024 токена на рассуждения — финальный ответ либо
  пуст (KI-179), либо обрезан (в живом прогоне `tokens_out=1024`,
  эссе оборвано на середине).
- **Решение:** (1) поднять maxTokens для reasoning-моделей (2048/4096);
  (2) env per-model override (`LLM_MAX_TOKENS_<MODEL>`);
  (3) поле `maxTokens` в `ModelInfo`.
- **Когда чинить:** v0.8 (нужно решение по тарифам/лимитам).
- **Связанные:** KI-179.

### KI-216 — Нет family-revocation при reuse refresh-токена
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/auth/auth.service.ts`
- **Описание:** OAuth 2.0 BCP: при обнаружении повторного использования
  уже ротированного refresh-токена — отозвать **все** активные токены
  пользователя (защита от угона). Сейчас — просто 401.
- **Решение:** при `rotateRefreshTokenAsync` — если токен уже `revoked`,
  `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND
  revoked_at IS NULL`.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201.

---

### KI-609 — `@prometheus-io/client` требует Node 22/24/26+
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-04
- **Файлы:** `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`
- **Описание:** `@prometheus-io/client@0.16.1` объявляет
  `engines: { node: "^22 || ^24 || >=26" }`, тогда как `package.json` проекта
  `engines` не фиксирует. CI использует Node 22, локальная машина — Node 24,
  поэтому сейчас всё совместимо; на Node 20 (или 23) установка/работа не
  гарантированы. Пакет молодой (0.x) — API может меняться.
- **Решение:** зафиксировать `engines.node` в `package.json` (`>=22`) и
  добавить его в README/RELEASES; при обновлении мажора `@prometheus-io/client`
  прогонять `metrics.service.spec.ts` и смоук (формат экспозиции).
- **Связанные:** KI-574.

### KI-235 — Share-ссылка бессрочная и без аудита
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/db/schema.ts` (`workflows`),
  `src/workflow/workflow.service.ts`
- **Описание:** Нет `expiresAt` (TTL); после утечки ссылка живёт до
  ручного `DELETE .../share`. Нет аудита: `shared_at`, `revoked_at`,
  `shared_by`.
- **Решение:** TTL-колонка + поля аудита; UI — «Ссылка истечёт через
  N дней».
- **Когда чинить:** при появлении аудита (v0.8.x).
- **Связанные:** KI-197.

---

### KI-484 — `WORKFLOW_RUN_LEASE_TTL_MS` без верхней границы
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** В S0 задана только нижняя граница TTL. Значение порядка 10^12 фактически отключает обнаружение падения worker'а.
- **Решение:** добавить `max` и связать со `WORKFLOW_RUNS_STALE_THRESHOLD_MS` в S3.

---

### KI-201 — Auth backend (R6.1a): users, JWT, scrypt
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-12
- **Исправлено в:** v0.8.0a (коммит `88f53e4`)
- **Файлы:** `src/auth/`, `src/db/schema.ts`,
  `drizzle/0004_add_users.sql`, `src/config/env.schema.ts`,
  `src/workflow/workflow.controller.ts`,
  `src/workflow/workflow.module.ts`, `src/runs/runs.controller.ts`,
  `src/runs/runs.module.ts`, `src/runs/runs.service.ts`,
  `src/app.module.ts`, `.env.example`, `.github/workflows/ci.yml`
- **Описание:** Auth как фича была в `[0.1.0] → ### Planned` в
  CHANGELOG под «KI-106» (устаревшая ссылка). В реестре
  `KNOWN_ISSUES.md` отдельной записи не существовало. Заведена
  задним числом как KI-201.
- **Fix (R6.1a, backend):**
  - Миграция 0004: `users` (uuid), системный пользователь
    `00000000-0000-0000-0000-000000000001`
    (`system@workflow-builder.local`, `password_hash =
    scrypt$disabled$disabled` — вход невозможен),
    `workflows.user_id` **text → uuid** с backfill (65 строк:
    41 `demo-user` + 24 smoke), `workflows.share_token` (задел R6.2).
  - `AuthService`: `registerAsync` / `loginAsync` / `getMeAsync` /
    `hashPasswordAsync` (scrypt через `node:crypto`, формат
    `scrypt$<salt_b64>$<hash_b64>`) / `verifyPasswordAsync`
    (timingSafeEqual) / `generateAccessToken`.
  - `JwtAuthGuard` (кастомный, `@nestjs/jwt`, без `passport-jwt`) +
    `@CurrentUser`.
  - `AuthController`: `POST /auth/register` (201),
    `POST /auth/login` (200), `GET /auth/me` (200/401).
  - `AUTH_DISABLED=true` (dev/CI) → `sub = DEMO_USER_ID` (валидный
    uuid системного пользователя).
  - `WorkflowController` / `RunsController` под `JwtAuthGuard`;
    владелец — **только из токена** (`user.sub`), `userId` из
    body/query игнорируется.
  - Env: `JWT_SECRET` (min 32), `JWT_EXPIRES_IN` (default `24h`),
    `AUTH_DISABLED`.
  - Tests: 358 → 380 (+22: `auth.service` 13, `auth.controller` 9).
- **Остаток (R6.1b.1, backend):** ✅ refresh-token (opaque +
  rotation), logout, `POST /auth/refresh`, httpOnly cookie — коммит
  `4b1c149`.
- **Остаток (R6.1b.2, frontend):** ✅ LoginPage / AuthProvider /
  ProtectedRoute / 401-interceptor — коммиты `316c680` +
  `4eb4664`. **R6.1 (Auth) завершён.**
- **Связанные:** KI-202..208.

---

### KI-149 — Frontend не читает метрики из событий `node_completed`/`node_failed`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `684211f`)
- **Файлы:** `web/src/types/run-stream.ts`, `web/src/stores/workflow.ts`
- **Описание:** Даже после того как backend начал присылать метрики в событиях
  (KI-075), frontend их игнорировал: схема события их не содержала, а
  обработчик обновлял только `durationMs`, сохраняя остальные поля из snapshot.
  Панель показывала стоимость лишь после перезагрузки страницы.
- **Fix:** в схему событий добавлены `costRub`/`costUsd`/`tokensIn`/`tokensOut`
  (опциональные — для совместимости с ретраями старых версий), а обработчик
  сливает их в `nodeMetrics` вместе с длительностью.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-075, KI-038.

---

### KI-427 — S3-загрузка буферизует файл в память (до 200 МБ)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.3
- **Fix:** потоковая загрузка — `Readable.fromWeb(...).pipe(counter)` уходит
  в `Body` без копии в память; потолок 200 МБ проверяется по ходу потока.
- **Файлы:** `src/media/media-storage.service.ts`
- **Описание:** `PutObjectCommand.Body` — буфер: при `concurrency=5` и
  видео-результатах пиковая память может достигать ~1 ГБ.
- **Решение:** потоковая загрузка (`Upload` из `@aws-sdk/lib-storage`) с
  известным `ContentLength` или запись во временный файл.
- **Связанные:** KI-412, KI-065.

---

### KI-488 — Дублирование константы `MCP_MAX_TOOLS_PER_NODE_LIMIT`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/config/env.schema.ts`, `web/src/types/graph.ts`
- **Описание:** Константа продублирована на фронте, пока нет shared-типов.
- **Решение:** вынести в shared-типы в S6/S8.

---

### KI-510 — Глобальные поверхности (Toast, модалки, логин) — светлые литералы (Low)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/components/Toast.tsx`,
  `web/src/components/ShareModal.tsx`, `web/src/components/LoadModal.tsx`,
  `web/src/components/auth/LoginPage.tsx`,
  `web/src/components/edges/InsertableEdge.tsx`
- **Описание:** вне узлов остались светлые литералы: тосты
  `bg-red-50`/`bg-emerald-50`, ссылки `text-blue-600`, ошибки `text-red-600`
  и ховеры `hover:bg-red-50`, предупреждения `text-amber-600`. В тёмной теме
  это светлые панели/вспышки при наведении, а `text-red-600`/`text-blue-600`
  на `slate-950` дают контраст ниже AA (~3:1). В S16 аудит ограничен
  node-поверхностями (DESIGN § 3.6), поэтому зафиксировано отдельно.
- **Решение:** переиспользовать уже введённые `--color-status-*-foreground`
  для текста (как сделано в `RunResultPanel`), для тостов — `bg-muted`/
  `--color-status-*` фон, для ховеров — `hover:bg-node-bg-failed` или
  `hover:bg-muted` вместо `hover:bg-red-50`.
- **Связанные:** KI-448, KI-509, KI-511.

---

### KI-584 — Приглашения не доставляются письмом (нет SMTP)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S1) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`,
  `web/src/components/TeamPage.tsx`
- **Описание:** инвайт создаёт только строку `organization_invitations`;
  приглашённый узнаёт о приглашении от владельца (вне продукта). Транспорта
  почты в проекте нет (ни SMTP, ни transactional-провайдера), поэтому UI
  ограничивается сообщением «Приглашение отправлено: <email>», а не «письмо
  отправлено». Владелец видит приглашение в секции «Ожидают регистрации», пока
  адрес не зарегистрируется.
- **Решение:** отдельной задачей — SMTP/провайдер + шаблон письма со ссылкой
  (`/login?invite=<token>`), очередь ретраев и статус доставки; до этого
  формулировки UI не должны обещать письмо.
- **Fix (v1.1.0 S1):** `EmailService` (`src/email/`, nodemailer) отправляет
  HTML+text письмо с темой «Приглашение в организацию {orgName}» и ссылкой
  `/login?invite=<uuid>`; `OrgMembersService.inviteAsync` вызывает его после
  создания приглашения. Без `SMTP_HOST` — WARN и `emailSent: false` при 201
  (fallback DESIGN V110 § 3.1); сбой SMTP — ERROR и `false`, приглашение
  сохраняется. Env: `SMTP_HOST/PORT/USER/PASS/FROM/SECURE` +
  `APP_PUBLIC_URL`. Остатки (нет очереди/ретраев, ссылка не проверяется UI,
  один язык письма) — KI-592..597.
- **Связанные:** KI-563, KI-566, KI-592, KI-593.

### KI-223 — Bootstrap не различает 401 и сетевую ошибку
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/lib/api.ts` (`runRefreshAsync`),
  `web/src/components/auth/AuthProvider.tsx`
- **Описание:** `runRefreshAsync` ловит любую ошибку и делает
  `clearSession()` → при недоступном backend пользователь
  выбрасывается на /login с status='guest', хотя cookie могла быть
  валидной.
- **Решение:** различать `ApiError.status === 401` и сетевой сбой
  (status отсутствует) → в последнем случае status='unknown' +
  баннер «нет связи» + retry.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201, KI-224.

---

### KI-074 — Дефолт модели захардкожен; недоступная модель не блокирует Run
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `web/src/types/graph.ts`, `web/src/components/TopBar.tsx`
- **Описание:** `DEFAULT_LLM_MODEL_ID` — временный fallback; при
  создании узла логичнее брать `llmModels[0].id` (нужно грузить
  список на старте, а не лениво). Плюс: при выбранной недоступной
  модели кнопка Run активна, и запуск падает уже в узле с «Модель
  не поддерживается» — стоит предупредить в UI или валидировать
  перед запуском.
- **Решение:** загрузка списка на старте + валидация модели перед
  Run.
- **Когда чинить:** R4.3b.
- **Связанные:** KI-069.
- **Fix:** список моделей грузится на старте (`App.tsx useEffect`);
  новый LLM-узел получает `llmModels[0].id`; `findNodesWithUnavailableModel`
  в `TopBar` блокирует Run с тостом. Smoke: POST /runs не уходит.

---

### KI-116 — `aspect_ratio` рендерится только если у модели есть `options`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Условие рендера — `aspectRatioParam?.options !==
  undefined`. Если upstream вернёт `aspect_ratio` как `string` без
  `options` (сейчас — `enum`), селект не появится.
- **Решение:** добавить контролы для `number`/`string`/`boolean`.
- **Связанные:** KI-092.

---

### KI-495 — Рост `#stopped` в памяти
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/runs/run-lease.service.ts`
- **Описание:** Set `#stopped` пополняется при каждом вызове `stop()`, но не чистится для старых runId.
- **Решение:** удалять runId из Set при `startAsync`.

---

### KI-303 — `inputsMap` не применяется executor'ом подграфа
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-executors.ts`, `web/src/types/graph.ts`
- **Описание:** `inputsMap` хранится, валидируется и переносится
  Save/Load, но подграф получает вход как обычно (`prompt`).
  Именованных входов у подграфа нет (KI-278/279).
- **Связанные:** KI-278, KI-279, KI-200.

---

### KI-171 — auto-resize не учитывает смену ширины узла
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/hooks/use-auto-resize.ts`
- **Описание:** Высота пересчитывается только по изменению `value`; при
  зуме/сужении текста (перенос строк меняется) остаётся устаревшей до
  следующего ввода. Для узлов фиксированной ширины (240px) не проявляется, но
  при resizable-узлах — заметно.
- **Решение:** добавить `ResizeObserver` на элемент.
- **Когда чинить:** при появлении resizable-узлов.
- **Связанные:** KI-169.

---

### KI-056 — `listModels()` недостижим снаружи
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-registry.service.ts`, `src/llm/llm.controller.ts` (нет)
- **Описание:** `GET /llm/models` → 404. Отфильтрованный список
  виден только внутри процесса, UI (R4) не может получить его без
  нового эндпоинта. Открытый вопрос: отдавать ли `provider`/`label`/
  `isConfigured` в ответе.
- **Когда чинить:** R4.
- **Связанные:** KI-039.

---

### KI-599 — Удаление участника принудительно передаёт его графы владельцу, без выбора
- **Приоритет:** 🟡 Medium | **Статус:** Fixed (частично) | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`,
  `web/src/components/TeamPage.tsx`
- **Описание:** «Исключение из организации» не может оставить графы
  бесхозными: предикат доступа требует `user_id` = я или строку участника, а
  после переезда участника ни то, ни другое не выполняется, поэтому в S2 все
  его workflow в этой организации переводятся на владельца. Это сохраняет
  данные, но владелец получает графы, которые, возможно, не хотел, а
  участник теряет к ним доступ без возможности «передать коллеге» или
  «оставить только себе». UI ограничивается текстом в `window.confirm`.
- **Решение:** отдельной задачей — выбор стратегии при удалении (передать
  владельцу / другому участнику / архивировать), предварительный список графов
  в подтверждении и послеоперационное уведомление «передано N графов»;
  в перспективе — `organization_members` с «личными» и «командными» графами.
- **Связанные:** KI-586, KI-583, KI-604.

### KI-206 — Нет rate limiting / refresh / logout
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.9.1 (коммит `af1766d`) — добавлен `@nestjs/throttler`.
- **Остаток (v0.9.0):** refresh/logout реализованы в R6.1b (v0.8.0,
  коммит `4b1c149`), **rate-limit не сделан** — `@nestjs/throttler` нет в
  зависимостях, на `/auth/login` ограничения нет. R7.7 закрыл rate limiting
  на уровне **провайдеров** (семафор, KI-067), а не HTTP-ручек. KI остаётся
  открытым до появления throttler'а.
- **Файлы:** `src/auth/`
- **Описание:** MVP R6.1a: без rate-limit на `/auth/login` (брутфорс
  не ограничен); нет refresh-токена (R6.1b), нет logout/revocation.
- **Решение:** `@nestjs/throttler` для login; refresh + logout в R6.1b.
- **Когда чинить:** R6.1b (refresh/logout) + v0.8.x (throttle).
- **Связанные:** KI-201, KI-234.

---

### KI-004 — React Flow: лицензия `hideAttribution` при платных плагинах
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/Canvas.tsx` (`proOptions={{ hideAttribution: true }}`)
- **Описание:** Отключили watermark React Flow в dev. В v12 MIT это разрешено,
  но при подключении проприетарных плагинов (`@xyflow/pro`) условия меняются.
- **Что проверить перед prod:** актуальная лицензия React Flow +
  всех плагинов. Если условия требуют attribution — вернуть.
- **Не блокер:** dev-only.

---

### KI-047 — UPSERT не сбрасывает `outputs` / `duration_ms`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `7be74d1`)
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** При реплее строка `node_runs` показывает `status='running'`
  вместе с `outputs`/`duration_ms` прошлой попытки. При повторном падении
  старые `outputs` остаются с новой `error`. В `workflow_runs` аналогично:
  `outputs` прошлой попытки видны до `finishRunAsync`. Плюс номер попытки
  живёт только в job'е — для R4 (диагностика) стоит хранить.
- **Решение:** добавить `outputs: null, durationMs: null` в `set` UPSERT.
- **Когда чинить:** вместе с KI-046.
- **Связанные:** KI-031, KI-040, KI-046.
- **Fix:** в UPSERT `set` добавлены `outputs: null, durationMs: null`.
  Плюс — при попадании в кэш (KI-046) строка не перезаписывается
  совсем, так что «running» не показывает результат прошлой попытки.

---

### KI-017 — CRUD не валидирует форму графа
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/workflow/dto/create-workflow.dto.ts`,
  `src/workflow/dto/update-workflow.dto.ts`,
  `src/workflow/workflow.service.ts`
- **Описание:** `CreateWorkflowSchema.nodes/edges = z.array(z.any())` —
  нарушение RULES 4.15 (any запрещён). `UpdateWorkflowSchema` —
  `z.array(z.unknown())`. После KI-014 в `updateAsync` появился каст
  `unknown[] as NodeDto[]`. Тип `NodeDto[]` в БД — обещание, а не гарантия.
- **Решение:** валидировать граф на записи через `z.looseObject` /
  `.passthrough()`, чтобы не терять UI-поля React Flow (`selected`,
  `dragging`, `measured`).
- **Когда чинить:** R4 (перед интеграцией с UI).
- **Связанные:** KI-014.

---

### KI-555 — `UserPublic` / `GET /auth/me` не отдают `orgId`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.0.0 (S5) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/auth/auth.service.ts`, `src/auth/auth.controller.ts`
- **Описание:** `orgId` появился только в JWT. Клиенту, которому нужен
  tenant (настройки команды, аудит), приходится декодировать токен вручную.
  В S1 публичный контракт `UserPublic` намеренно не менялся (только БД/JWT).
- **Решение:** в S5 добавить `organizationId` (и, возможно, имя организации) в
  `UserPublic`, `/auth/me` и оба зеркала контракта (`web/src/lib/api.ts`,
  `docs/development/api-contract.json`).
- **Fix (S5):** `UserPublic` дополнен `organizationId` и `role` (читаются из
  строки `users`, а не из JWT); поля приходят в `GET /auth/me`, `/auth/login`,
  `/auth/register`, `/auth/refresh`, зеркала синхронизированы
  (`web/src/lib/auth-api.ts`, `web/src/stores/auth.ts`,
  `docs/development/api-contract.json` — DTO `UserPublic` + домен
  `UserPublic.role`). Имя организации в `UserPublic` не добавляли: UI команды
  его не показывает, а второй join ради подписи не нужен.
- **Связанные:** DESIGN v1.0 § 2.1, S5.

### KI-178 — Формат `YANDEX_MODELS` / `LMSTUDIO_MODELS` не валидируется Zod
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** `YANDEX_MODELS`, `LMSTUDIO_MODELS`, `GPTUNNEL_MODELS` —
  `z.string().optional()`. Опечатка в формате видна только в логе, но
  не в `validateEnv`, то есть старт проходит с «тихо» неполным
  каталогом.
- **Решение:** Zod-схема формата списка (`<id>[:<modalities>]`),
  проверяющая записи на этапе валидации env.
- **Когда чинить:** v0.8 (вместе с KI-174-доработками).
- **Связанные:** KI-174.

### KI-162 — Удаление связи недоступно без клавиатуры
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `9d2f6bf`)
- **Файлы:** `web/src/components/Canvas.tsx`, `web/src/stores/workflow.ts`
- **Описание:** Связь выделялась кликом, но удалить её было нечем: в сторе не
  было `removeEdge`, а React Flow v12 по умолчанию слушает только `Backspace`.
  Привычная клавиша `Delete` не делала ничего, поэтому пользователь с мышью или
  без знания горячей клавиши не мог убрать связь.
- **Fix:** задан `deleteKeyCode={['Delete', 'Backspace']}` на `<ReactFlow>` и
  добавлен `removeEdge` в стор.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-163.

---

### KI-535 — WARN «stdio без Docker» только при первом подключении
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp-client.service.ts`
- **Описание:** Если сервер не используется, оператор не увидит рекомендацию при старте.
- **Решение:** продублировать WARN на старте реестра.

### KI-342 — Двойник Drizzle в тестах не thenable
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/*.spec.ts`, тестовые двойники `db`
- **Описание:** `db.insert().values().onConflictDoUpdate(...)` без `.returning()` в двойнике молча не выполняет запрос — тест «проходит» на несуществующем пути.
- **Решение:** сделать двойник thenable и падать на неожидаемых цепочках.
- **Связанные:** KI-317.

---

### KI-266 — Комментарии не персистятся (backend роняет run на незнакомом типе)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.2a-fix, коммит 55beb6d)
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/engine/engine.service.ts`, `web/src/lib/graph-payload.ts`
- **Описание:** `ExecutionEngineService.runNodeAsync` — `switch
  (node.type)` с `default: throw new UnsupportedNodeTypeException`.
  Комментарий, доехавший до backend, **уронит весь run**. Из-за
  этого frontend вынужден отсекать `comment` на границе API
  (`lib/graph-payload.ts`) → стикеры **теряются при F5**.
- **Решение:** (1) `buildExecutionPlanAsync` игнорирует
  «annotation»-типы (`comment`) — не включает в `levels`/`executionMap`,
  не создаёт `node_runs`; (2) откат `local-only`-фильтра на frontend.
  Миграции не нужно (узлы уже хранятся в `workflows.nodes` jsonb).
- **Влияние:** сейчас пользователь теряет заметки после перезагрузки.
- **Связанные:** KI-187, KI-247 (лог «узлов=0»), KI-267.
- **Fix:** `ANNOTATION_NODE_TYPES` в `src/engine/node-executors.ts`;
  `buildExecutionPlanAsync` фильтрует аннотации (нет в
  `order`/`levels`/`executionMap`, нет `node_runs`); граф только
  из аннотаций → 400 «Граф содержит только аннотации, нечего
  выполнять»; `validateGraphAsync` не пишет warning об
  изолированности аннотации; фронт-фильтр `LOCAL_ONLY_NODE_TYPES`
  опустошён — Save/Plan шлют `comment` как есть.

---

### KI-278 — NodePortContract: 1 вход / 1 выход на тип
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-ports.ts`, `src/engine/engine.service.ts`
- **Описание:** `NodePortContract` описывает один `inputPortName` и один
  `outputPortName` на тип. Нельзя выразить: `condition` с двумя выходами
  `true`/`false`; `compare` с двумя входами `a`/`b`; `http` с двумя
  выходами `status`/`body`. У `output` (0 выходов по DESIGN § 8.3)
  объявлен `outputPortName: 'result'` — фиктивно. Симптом: `compare`
  вынужденно без контракта (иначе a/b схлопнутся в один ключ, KI-035);
  `http`/`output` объявлены неточно.
- **Решение:** per-handle контракт (`inputs[]`/`outputs[]` с `handleId`
  + `portName`).
- **Связанные:** KI-033, KI-034, KI-035.

---

### KI-316 — Асимметрия fit-операций: кнопка Fit и хоткей F
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.2 (коммит `a32023f`)
- **Fix:** `void fitView({ ...FIT_VIEW_OPTIONS, duration: 200 })`;
  CDP: Fit = 1.0, хоткей F = 1.0 (до фикса 1.82875). Осознанно
  меняет поведение KI-186 (добавлены padding/maxZoom).
- **Файлы:** `web/src/components/Canvas.tsx` (хоткей F)
- **Описание:** Измерено CDP на одном графе (Text + Output):
  Controls Fit = 1.0, хоткей F = 1.53091 — у хоткея нет padding /
  maxZoom, поэтому «вписать» даёт разный вид.
- **Решение:** хоткею F передавать весь `FIT_VIEW_OPTIONS`
  (осознанно меняет поведение KI-186).
- **Связанные:** KI-306, KI-186.

---

### KI-458 — `PGVECTOR_ENABLED=false` не отключает vector-инструменты агента (Low)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Запланировано:** v0.10 S10
- **Файлы:** `src/agent/agent-tools.ts`, `src/vector/vector-store.service.ts`
- **Описание:** флаг `PGVECTOR_ENABLED` проверяется в
  `ExecutionEngineService` для узлов `vector_*`/`memory_*`, но agent-узел
  вызывает `VectorStoreService` через свои инструменты напрямую. При
  `false` агент всё ещё сможет читать/писать векторы и память.
- **Решение:** проверять флаг в `WireVectorTools`/`AgentService` (или в
  `VectorStoreService`) и возвращать инструменту понятное «disabled»-сообщение;
  добавить тест агента с `PGVECTOR_ENABLED=false`.
- **Связанные:** KI-455, DESIGN v0.10 § 3.5.3.

---

### KI-350 — Фронт-SSE-зеркало мягче бэкенда
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/types/run-stream.ts`
- **Описание:** `z.string()` вместо `z.uuid()`/`z.iso.datetime()`, `durationMs` без `.nonnegative()` — маскирует битые события.
- **Решение:** ужесточить зеркало вместе с паритет-гейтом (KI-348).
- **Связанные:** KI-348.

---

### KI-269 — /engine/sort не исключает аннотации
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/engine/engine.service.ts` (`topologicalSortAsync`)
- **Описание:** `POST /engine/sort` с `[text, comment]` вернул
  `order=["t1","c1"]`, хотя `/engine/plan` для того же графа —
  `["t1"]`. Расхождение контрактов двух эндпоинтов.
- **Решение:** вынести фильтр аннотаций в общий приватный хелпер
  и применить в обоих методах.
- **Когда чинить:** при следующей правке engine.
- **Связанные:** KI-266.

---

### KI-022 — Дефолтный выходной порт `output` не существует ни у одного исполнителя
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `d2a06ed`)
- **Файлы:** `src/engine/engine.service.ts`, `src/engine/node-executors.ts`
- **Описание:** `executionMap` подставляет `fromPort = sourceHandle ?? 'output'`,
  а узлы отдают `text` (text/llm) или `url` (image_generation). Если у связи
  не задан `sourceHandle` — вход молча получает `null`, данные теряются.
- **Решение:** `sourceHandle ?? inferDefaultPort(sourceNode.type)` —
  text/llm → 'text', image_generation → 'url'. Проверить маппинг портов
  в `web/src/components/nodes/` (T/G badges).
- **Когда чинить:** до R3 (LLM-вызовы) или отдельным микро-шагом.
- **Связанные:** KI-003.
- **Fix:** `inferDefaultOutputPort(nodeType)` в `src/engine/node-ports.ts`;
  `buildExecutionPlanAsync` использует `sourceHandle ??
  inferDefaultOutputPort(sourceNode.type)`. Fallback `'output'`
  сохранён для неизвестных типов. +4 теста.
- **Остаток:** закрыт только для API-графов; для UI-графов требуется
  KI-030 (handle id не совпадают).

---

### KI-277 — Load не чистит историю undo
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts` (`loadWorkflowAsync`)
- **Описание:** `newWorkflow` историю очищает, `loadWorkflowAsync` —
  нет. Возможны оба варианта: «откатить Load» (текущее) или
  «Load = новый документ». Требует решения по UX.
- **Решение:** определиться в DESIGN v0.8 § 7.2 и либо очищать
  `past`/`future` в `loadWorkflowAsync`, либо зафиксировать текущее
  поведение тестом.
- **Связанные:** KI-274, KI-186.

---

### KI-394 — Миграция `BULLMQ_PREFIX` `bull` → `workflow-runs` (операционное)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `.env.example`, `src/runs/runs.worker-options.ts`
- **Описание:** смена дефолтного префикса BullMQ (`bull` → `workflow-runs`)
  делает старые задания в Redis невидимыми для нового воркера. При выкатке без
  опустошения очереди — потерянные запуски.
- **Решение:** процедура миграции в `RELEASES.md` (опустошить очередь / указать
  `BULLMQ_PREFIX=bull` в env при апгрейде).
- **Связанные:** KI-387.

---

### KI-140 — Строки вне UI-слоя остаются русскими
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/lib/api.ts`, `web/src/types/media.ts`,
  `web/src/types/run-stream.ts`, `web/src/stores/workflow.ts`
- **Описание:** Сообщения Zod и `console.warn` вне i18n. Часть
  всплывает в тостах через `error.message` — в EN-режиме текст
  ошибки будет русским.
- **Решение:** словарь `error.*` + маппинг кодов/статусов.
- **Когда чинить:** R5.4 или v0.8.
- **Связанные:** KI-126, KI-138.

---

### KI-448 — Тёмная тема: светлые фоны статусных узлов
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.11.0 (S16) — в `theme.css` добавлены токены
  `--color-node-bg-*`/`--color-node-border-*` (плюс `--color-status-*-foreground`
  и `--color-status-warning-bg/-border` для статусного текста и предупреждающих
  плашек); `BaseNode` и медиа-узлы больше не используют светлые литералы.
  Отчёт: [S16-dark-theme.md](development/reports/v0.11.0/S16-dark-theme.md).
- **Файлы:** `web/src/styles/theme.css`,
  `web/src/components/nodes/BaseNode.tsx`,
  `web/src/components/nodes/*.tsx`, `web/src/components/RunResultPanel.tsx`
- **Описание:** в тёмной теме фон узла остаётся светлым: статусные
  модификаторы (`completed`/`failed`/`running` и т.п.) задают светлые
  оттенки без привязки к текущей теме. На светлом фоне светлый текст
  становится нечитаемым, контраст падает ниже WCAG.
- **Решение:** строить фон/рамку статуса через переменные темы (`.dark` в
  `theme.css` или `dark:`-варианты) и проверять контраст текста для каждого
  статуса; не хардкодить светлые hex-значения в `BaseNode`.
- **Связанные:** RULES 4.32, KI-133, KI-509, KI-510, KI-511, KI-512.

---

### KI-339 — `node_runs.error` skipped не называет упавшего предшественника
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Текст ровно «Пропущен: упал предшественник»; id упавшего только в логе движка.
- **Решение:** подставлять id упавшего узла в текст ошибки.
- **Связанные:** KI-288.

---

### KI-001 — Шаблон записи (Documented)
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-12
- **Файлы:** —
- **Описание:** Это шаблон. Реальные проблемы начинаются с `KI-002`. Каждая
  запись содержит: приоритет, статус, файлы, описание проблемы, возможные
  решения, оценку, связанные KI.
- **Формат полей:**
  - **Приоритет:** 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
  - **Допустимые статусы:** Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved
  - **Исправлено в:** vX.Y.Z (для Fixed)
  - **Запланировано:** vX.Y.Z (для Planned / Deferred)
- **Связанные:** —

---

### KI-382 — коллизия gpt-image-1/dall-e-3 с CreativeLab
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.3)
- **Fix:** коллизия разрешается детерминированно — `orderMediaProviders`
  сортирует провайдеров по `MEDIA_PROVIDER_PRIORITY`, `deduplicate` оставляет
  первого и пишет warning. Прямой OpenAI Images доступен, если поставить
  `openai_images` раньше CreativeLab в env; дефолт CreativeLab сохранён.
- **Файлы:** `src/media/media-provider-priority.ts`,
  `src/media/media.module.ts`, `src/config/env.schema.ts`, `.env.example`
- **Описание:** id `gpt-image-1` объявлен и CreativeLab, и прямым OpenAI
  Images. Дедупликация отдаёт CreativeLab (приоритет выше) → прямой
  провайдер для этих id недоступен без переопределения приоритета.
- **Решение:** задокументировать; либо env-переопределение приоритета.
- **Связанные:** KI-366, KI-363.

---

### KI-125 — Нет тёмной темы
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммиты `1c3d948`, `d4b33f0`, `fc621f8`)
- **Файлы:** `web/src/index.css`, `web/src/components/*`
- **Описание:** Tailwind v4 подключён без dark-mode стратегии. Все
  цвета светлые (`bg-white`, `text-slate-700`, `border-slate-200`).
  Переключение темы невозможно без переписывания классов.
- **Возможные решения:**
  1. `dark:` варианты + класс `.dark` на `<html>` (классический
     Tailwind-подход). Требует ревизии всех компонентов.
  2. CSS-переменные (`--color-bg`, `--color-fg`) в `:root` и `.dark`,
     Tailwind v4 `@theme` — компоненты используют `bg-background`,
     `text-foreground`. Меньше правок при добавлении новых тем.
- **Когда чинить:** — (закрыто, v0.7.0).
- **Fix:** CSS-переменные через Tailwind v4 `@theme`
  (`web/src/styles/theme.css`) + `.dark` на `<html>`.
  `useTheme()` (`web/src/hooks/use-theme.ts`) — light/dark/system,
  `localStorage.theme`, реактивная подписка на `matchMedia`.
  Inline-script в `web/index.html` до bundle — против вспышки (FOUC).
  Кнопка ☀/🌙 в `TopBar`.
  Компоненты (`TopBar`, `Toolbar`, `BaseNode`, `RunResultPanel`,
  `LoadModal`, `Canvas`, узлы `TextNode`/`LLMNode`/`ImageGenNode`)
  переведены на переменные (`bg-background`, `text-foreground`,
  `border-border`, `bg-node-bg`, `border-node-pending`).
  React Flow: `--xy-*` (edge-stroke, background-pattern, controls,
  minimap, edge-label) — маппинг на наши переменные.
  Инпуты узлов темизированы (R5.2.1) + заметный фокус
  `focus:border-primary focus:ring-1 focus:ring-primary` (R5.2.2/3).
  Smoke: light/dark/system, F5 сохраняет, system переключается
  без перезагрузки (Emulation.setEmulatedMedia).
- **Остаток:** KI-133 (статусные цвета вне узлов — R5.3);
  KI-136 (`:focus` vs `:focus-visible`).
- **Связанные:** KI-126, KI-132, KI-133, KI-134, KI-135, KI-136.

---

### KI-102 — `passthrough()` может дублировать имя поля в ответе
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/media/dto/media-model.dto.ts`, `media-model.mapper.ts`
- **Описание:** `passthrough()` пропускает поля upstream, которые мы
  не типизировали (сознательно — терять нельзя). Если GPTunnel
  вернёт поле с именем, конфликтующим с нашим camelCase (`maxLength`
  vs `max_length`), в ответе будет **два написания**.
- **Решение:** при обнаружении — явно исключать snake_case после
  маппинга.
- **Когда чинить:** при обнаружении.
- **Связанные:** —

---

### KI-250 — Placeholder «Max tokens» без пояснения
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`,
  `web/src/i18n/{ru,en}.json`
- **Описание:** При известном `defaultMaxTokens` placeholder —
  голое число (4096) без пояснения, что это «по умолчанию».
- **Решение:** i18n-шаблон с интерполяцией
  (`node.llm.maxTokens.placeholder = 'По умолчанию: {{value}}'`).
- **Когда чинить:** при UX-полировке.
- **Связанные:** KI-183.

---

### KI-610 — Grafana dashboard статичен: панели не проверяются в CI и нет alert rules
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-04
- **Файлы:** `infra/grafana/dashboard.json`
- **Описание:** JSON дашборда — статический артефакт: CI проверяет только
  `JSON.parse` (смоук), но не рендерит панели и не сверяет запросы с именами
  метрик. При переименовании `http_request_duration_seconds`/
  `agent_step_duration_seconds`/`llm_call_duration_seconds` панель молча
  покажет «No data». Alert rules и provisioning datasource в репозиторий не
  входили (DESIGN § 3.4 требует только dashboard.json + prometheus.yml).
- **Решение:** добавить `infra/grafana/provisioning/` (datasource + dashboard
  provider), alert rules (error rate агента, p95 HTTP) и лёгкий CI-тест:
  парсить dashboard JSON, проверять, что каждый `expr` ссылается на имя
  метрики из `MetricsService` (или из фиксированного списка).
- **Связанные:** KI-582, KI-613.

### KI-487 — Конфликт `heartbeat < staleThreshold` с верхней границей heartbeat
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `docs/development/v0.11/DESIGN_V011_FEATURES.md`, `src/config/env.schema.ts`
- **Описание:** DESIGN § 3.3.1 требует `heartbeat < staleThreshold`, но с дефолтным `stale=300000` это делает недостижимой верхнюю границу `heartbeat=300000`.
- **Решение:** в S3 либо поднять stale, либо убрать условие, либо уменьшить max heartbeat.

---

### KI-258 — Каталог вставки узла в связь: нулевая ширина и вылет за холст
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0d (R6.4a, коммит `fcd2913`)
- **Файлы:** `web/src/components/Canvas.tsx`,
  `web/src/components/NodeCatalogPopover.tsx`
- **Описание:** Каталог, открытый кнопкой «+» на связи, имел
  ширину ~18 px и раскрывался за верхней кромкой холста (обёртка
  без `w-*`, `bottom-full mb-2` — для тулбара снизу, не для центра
  экрана). Выбрать узел было невозможно.
- **Fix:** обёртка `w-72`, поповер с `placement="down"`
  (дефолт `up` — для тулбара).
- **Связанные:** KI-185.

---

### KI-205 — migrate.ts логирует DATABASE_URL с паролем
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0b (коммит `4b1c149`)
- **Fix:** `migrate.ts` — `new URL(url).host` + `pathname` вместо
  полного URL (пароль в лог больше не попадает).
- **Файлы:** `migrate.ts`
- **Описание:** `console.log('URL:', url)` печатает `DATABASE_URL`
  целиком — **пароль в открытом виде** в stdout (RULES 5.1/5.3).
  Видно при `pnpm db:migrate`.
- **Решение:** не логировать URL; логировать только host/port/db
  (без user/password) или вообще ничего.
- **Когда чинить:** v0.8.x (одна строка).
- **Связанные:** RULES 5.1, 5.3.

---

### KI-029 — Нет следа узла, если падение до INSERT в `node_runs`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Сбой `collectInputsAsync` или самого INSERT выбрасывается
  наружу: строки `node_runs` нет, узел не виден в UI, хотя run помечен failed.
- **Когда чинить:** до R4 (UI начнёт показывать узлы).
- **Связанные:** —

---

### KI-507 — Нет автоматического UI-гейта на F5
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `.smoke/s12-s13-smoke.mjs`
- **Описание:** Сценарий проверен только ручным скриптом, в CI его нет.
- **Решение:** перенести в CI-job с сервисами (аналог `test:e2e`).

---

### KI-590 — Список команды без пагинации и поиска; роль не привязана к членству
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`,
  `web/src/components/TeamPage.tsx`
- **Описание:** `GET /admin/members` возвращает всех пользователей организации
  одним списком (без `limit`/`cursor`), UI рендерит все строки. Для крупных
  организаций это лишний трафик и длинный DOM. Модель членства осталась
  `users.organization_id` + `users.role` (одна организация на пользователя) —
  таблицы `organization_members` нет (KI-570).
- **Решение:** keyset-пагинация + поиск по email на сервере; при появлении
  мультичленства — `organization_members` с ролью в составе.
- **Связанные:** KI-570, KI-563.

### KI-367 — нет моделей для upscale/chromakey/trim
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.1 (коммит `af1766d`) — trim (@VideoEdit), upscale (FAL/Replicate). Остаток по chromakey — KI-418.
- **Файлы:** `src/media/image-tool.ts`
- **Описание:** в каталоге CreativeLab есть дефолтные модели только у
  `bg_removal` (`bgremover`) и `lipsync` (`kling-lipsync`). Для остальных
  операций `DEFAULT_IMAGE_TOOL_MODELS` пуст → узел падает с «Для операции
  X не выбрана модель». chromakey/trim/upscale из UI не запускаются
  «из коробки».
- **Решение:** добавить дефолты после проверки каталога; либо
  документировать «выберите модель вручную».
- **Связанные:** KI-366, KI-196, DESIGN v0.9 § 3.1.

---

### KI-494 — `lease_expires_at` не обнуляется при завершении
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** После `finishRunAsync` поле `lease_expires_at` остается в БД, хотя запуск уже не `running`.
- **Решение:** сбрасывать `leaseExpiresAt: null` в `finishRunAsync`.

---

### KI-464 — `storage_key` пишется, но переподпись S3 всё ещё идёт по URL (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — `refreshStoredUrlByKeyAsync(storageKey)` в
  `IMediaStorage`; снимок (`src/runs/run-node-snapshots.ts`) выбирает
  `storage_key` и перевыпускает ссылку по нему, media-узлы пишут ключ в
  `node_runs`; для старых строк сохранён fallback по URL.
- **Файлы:** `src/runs/run-node-snapshots.ts`,
  `src/media/media-storage.service.ts`,
  `src/media/media-node-executor.service.ts`,
  `src/engine/execution-engine.service.ts`, `src/db/schema.ts`
- **Описание:** S6 пишет ключ сгенерированного документа в
  `node_runs.storage_key`, но снимок SSE не читает эту колонку, а
  `IMediaStorage.refreshStoredUrlAsync` принимает **ссылку** и извлекает ключ
  из path-style URL. Для virtual-hosted style/URL-rewrite ключ по-прежнему не
  восстановить — ровно сценарий KI-451. Кроме того, узел `document_gen` читает
  ссылку из `nodeOutputs.storedUrl` (это копия в `node_runs.outputs`), а
  `RunsStreamService` переподписывает только `node_runs.stored_url`, поэтому
  после истечения presigned URL (1 ч) кнопка в узле может вести на 403. Запись
  ключа без его использования закрывает только половину задачи.
- **Решение:** добавить в `IMediaStorage` метод переподписи по ключу
  (`refreshStoredUrlByKeyAsync(storageKey)`), в снимке выбирать `storage_key`
  и передавать его; для `document_gen` — обновлять `outputs.storedUrl` (или
  читать актуальную ссылку из поля снимка). Старый путь по URL оставить
  fallback для старых строк.
- **Связанные:** KI-451, KI-425, KI-443.

---

### KI-335 — Формула покрытия в KI-314 неточна
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `docs/KNOWN_ISSUES.md` (KI-314), `web/src/components/Canvas.tsx`
- **Описание:** `parsePadding` из @xyflow/system даёт `height/(1+padding)/minZoom`, не `height/minZoom`: реальные 19 208 px при 0.02 и 76 833 px при 0.005 (холст 461 px).
- **Решение:** формула уточнена в KI-314; при следующем пересчёте использовать `parsePadding`.
- **Связанные:** KI-306, KI-314.

---

### KI-210 — DESIGN v0.8 § 1 / § 3.1 называют guard «Passport»-овым
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `docs/development/v0.8/DESIGN_V08_FEATURES.md`
- **Описание:** § 1 «Backend API — auth (JWT + Passport)» и § 3.1
  «`JwtAuthGuard` (Passport) — на `WorkflowController`» — фактически
  **неверны после R6.1a**: реализован кастомный `JwtAuthGuard` на
  `@nestjs/jwt` без `passport-jwt` (см. § 3.1, строки 68–70 — они
  прямо это утверждают). KI-208 покрывает только deps, а не
  формулировки.
- **Решение:** поправить § 1 и § 3.1 в DESIGN; в § 3.1 уточнить
  «кастомный, `@nestjs/jwt`».
- **Когда чинить:** docs-коммит R6.1a (сейчас).
- **Связанные:** KI-208, KI-201.

---

### KI-192 — System prompt у LLM-узла
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0c (коммит `283ce94`)
- **Fix (R6.3.1, backend):** `LlmNodeExecutor` читает
  `data.systemPrompt` (fallback `data.system`), передаёт в
  `options.system`. OpenAI-совместимые: `messages[0].role='system'`;
  Anthropic: поле `system`.
- **Fix (R6.3.2, frontend):** сворачиваемый `<textarea>` в `LLMNode`
  (коммит `fd50a31`).
- **Связанные:** KI-180, KI-193.
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`,
  `web/src/types/graph.ts`, `src/llm/llm-node-executor.service.ts`
- **Описание:** GPTunnel позволяет задать System prompt в LLM-узле
  (отдельно от user prompt, который приходит по связи). У нас
  только user prompt.
- **Решение:** поле `systemPrompt` в `LlmNodeData`; textarea в узле
  (сворачиваемая); `role: 'system'` в messages перед user.
- **Когда чинить:** v0.8 (High — часто нужно).
- **Связанные:** KI-180, KI-193.

---

### KI-069 — UI отправляет метку модели вместо id, `GET /llm/models` не используется
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `web/src/types/graph.ts`, `web/src/components/nodes/LLMNode.tsx`,
  `web/src/lib/api.ts`
- **Описание:** `LLM_MODELS` — человекочитаемые строки («Claude Opus 4»),
  а backend `resolveByModel` ждёт **id** (`claude-sonnet-4-20250514`) →
  LLM-узел из редактора **всегда** падает с «Модель не поддерживается».
  **Успешный прогон LLM из UI сейчас невозможен.** Дополнительно:
  `nodeDataFromApi` **молча подменяет** неизвестный id на `LLM_MODELS[0]`,
  и при Save модель в workflow **перезаписывается**.
- **Решение:** тянуть список из `GET /llm/models` (R4.1b), хранить пару
  `{ id, label }`, id — в `data.model`.
- **Когда чинить:** R4.3-prep (блокер для успешного LLM-прогона из UI).
- **Связанные:** KI-039, KI-056.
- **Fix:** `LLM_MODELS`/`LlmModel`/`LLM_MODEL_HINTS` удалены;
  список — `GET /llm/models` через `fetchLlmModelsAsync` +
  кэш в store (`llmModels`, `llmModelsLoaded`,
  `loadLlmModelsAsync`). `data.model` = id. `nodeDataFromApi`
  больше не подменяет неизвестный id; селект показывает
  «(недоступно)» disabled. `DEFAULT_LLM_MODEL_ID` — временный
  fallback. Smoke: Save сохраняет id в БД (SQL-проверка).
  Плюс `vite.config.ts`: добавлен `/llm` proxy (иначе
  `GET /llm/models` → 404 мимо бэкенда).
- **Остаток:** KI-074 (захардкожен дефолт; недоступная модель
  не блокирует Run).

---

### KI-340 — `http.failOnHttpError` не ретраит 5xx/429
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-executors.ts`
- **Описание:** Бросок — обычный Error; node-level retry (KI-036) только для `LlmProviderException.retryable`.
- **Решение:** отдельный retryable-класс ошибки для 5xx/429.
- **Связанные:** KI-036, KI-041, KI-289.

---

### KI-179 — LLM возвращает пустой content → media-узел падает с «Пустой prompt»
- **Приоритет:** 🔴 Critical | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.7.2 (коммит `675ca23`)
- **Файлы:** `src/llm/providers/openai-compatible.provider.ts`,
  `src/llm/llm-node-executor.service.ts`
- **Описание:** При Text → LLM (deepseek-v4-flash на GPTunnel) → ImageGen
  (nano-banana-pro) LLM **иногда** возвращал `{"text": ""}` при
  `tokens=44/1024` (1024 = maxTokens). Тогда media падал с «Пустой
  prompt», и настоящая причина была не видна.
- **Диагностика (2026-10-15):** гипотеза подтверждена — при
  `finish_reason='length'` (упор в maxTokens) `content` пустой,
  рассуждения в поле `reasoning` (не `reasoning_content`).
  Воспроизведено на deepseek-v4-flash / GPTunnel с лимитами 16/64/256.
- **Fix:** (1) fallback на `reasoning` при пустом `content`;
  (2) явное исключение `LLM вернул пустой ответ (finish_reason=X)`
  вместо каскада «Пустой prompt» в media.
- **Остаток:** maxTokens для reasoning-моделей — KI-183.
- **Когда чинить:** — (закрыто, v0.7.2)
- **Связанные:** KI-166, KI-180, KI-183.

### KI-572 — Metadata аудита может содержать пользовательские промпты/графы (PII)
- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** v1.0.0 (S5) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/audit.interceptor.ts`
- **Описание:** `metadata.body` — санитизированное тело запроса (удалены только
  ключи password/token/secret/apiKey/authorization/cookie, ограничение 16 KiB).
  Для `POST/PATCH /workflow` тело содержит `nodes`/`edges`, то есть
  пользовательские промпты и данные узлов; RULES 5.9 требует не логировать
  пользовательские промпты целиком (PII/секреты бизнес-логики), а постановка
  S3 прямо просила сохранять тело (без секретов). Компромисс S3: тело
  сохраняется для аудита изменений, риск и ограничение зафиксированы.
- **Решение:** в S5 для крупных/чувствительных сущностей (workflow, документы)
  хранить в metadata не тело, а сводку: хэш тела (sha256), размер, список
  изменённых полей, количество узлов/связей; для мелких метаданных (имя,
  описание, роль) — значения. Заодно решить retention (KI-565).
- **Связанные:** RULES 5.9, KI-565, KI-573, S5.

### KI-574 — `prom-client` помечен deprecated upstream
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `package.json`, `pnpm-lock.yaml`, `src/metrics/`
- **Описание:** `pnpm add prom-client` (требование S4) установил 15.1.3; метаданные npm: «prom-client has been replaced by @prometheus-io/client». Пакет работает, но не развивается.
- **Решение:** отдельной задачей мигрировать на `@prometheus-io/client` (сверить API `Registry`/`Histogram`/`Counter`, обновить импорты и тесты) либо зафиксировать версию и пересмотреть в v1.1.
- **Fix (v1.1.0 S4):** `prom-client` удалён, установлен `@prometheus-io/client@0.16.1`
  (Apache-2.0, официальный клиент Prometheus). Импорты `Registry`/`Histogram`/
  `Counter`/`collectDefaultMetrics` заменены механически — API совместим;
  `contentType` остался `text/plain; version=0.0.4; charset=utf-8`, тесты и
  смоук подтверждают формат. Ограничение по Node (engines `^22 || ^24 || >=26`)
  зафиксировано в KI-609.
- **Связанные:** KI-576, KI-577, KI-581, KI-582, KI-609.

### KI-479 — Multipart Content-Type не поддерживается фронтендом (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.11.0 (S3) — `sendAsync` не ставит
  `Content-Type: application/json` для `FormData` и не перезаписывает явно
  заданный заголовок; браузер сам добавляет `multipart/form-data; boundary`.
  Повтор после refresh сохраняет тело. Тест — `web/src/lib/api.spec.ts`.
- **Файлы:** `web/src/lib/api.ts`, `web/src/lib/api.spec.ts`
- **Описание:** `sendAsync` безусловно выполнял
  `headers.set('Content-Type', 'application/json')`, даже если передан
  `FormData`. Браузер не мог добавить `multipart/form-data; boundary`, и сервер
  получал JSON-заголовок с multipart-телом. Следствие: загрузка DOCX-шаблона
  (`POST /workflow/:id/document-templates`) из UI была невозможна.
- **Решение:** не ставить JSON-заголовок для `FormData` и не перезаписывать
  явно заданный `Content-Type` (DESIGN v0.11 § 3.1.8).
- **Связанные:** DESIGN v0.11 § 1.2/§ 3.1.8, KI-480.

---

### KI-112 — `price_unit` отсутствует у моделей с тарифом «по входу»
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.0b.2.3 (коммит `<hash>`)
- **Файлы:** `src/media/dto/media-model.dto.ts`,
  `src/media/dto/media-model.mapper.ts`,
  `src/media/media-provider.interface.ts`
- **Описание:** У моделей с тарифом по входу (`tts2`: 0.06 ₽/1000
  символов) в ответе `GET /media/models` нет поля `price_unit`:
  `price: 0`, ставка — в `price_input` + `price_input_unit`.
  Схема требовала `price_unit: z.string()`, поэтому один такой
  элемент ломал **весь** safeParse. `listModelsAsync()` без `type`
  (вызывается из `resolveByModelAsync`) возвращал ошибку — executor
  падал ещё до `createTaskAsync`.
- **Fix:** `price_unit` — `.optional()`; добавлены `price_input` и
  `price_input_unit`. В `MediaModelInfo` — `priceUnit` / `priceInput`
  / `priceInputUnit` nullable.
- **Замечание:** `resolveByModelAsync` в `MediaRegistryService`
  каждый раз читает **все** модели; при появлении второго
  провайдера стоит держать реестр `Map<modelId, provider>` в памяти,
  а не пересобирать на каждый вызов (KI-113).
- **Связанные:** KI-101, KI-113.

---

### KI-025 — `workflow_runs.outputs` дублирует выходы всех узлов
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** При больших графах раздувает jsonb и дублирует
  `node_runs.outputs`. Решить: хранить только терминальные выходы или ссылки.
- **Когда чинить:** до R4.
- **Связанные:** —

---

### KI-314 — `minZoom: 0.02` умещает разброс только до 23 050 px
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `c6edf91`)
- **Файлы:** `web/src/components/Canvas.tsx` (`FIT_VIEW_OPTIONS`)
- **Описание:** Измерено CDP: холст 1368×461 → покрытие 68 400 ×
  23 050 px, последний умещающийся разброс 23 000 px, при 24 000 px —
  оба узла за кадром. Для разброса 50 000 px нужен zoom ≈0.0092.
- **Решение:** `minZoom: 0.005` либо fit по кластеру / выделению,
  либо `fitView({ nodes })`.
- **Fix:** `FIT_VIEW_OPTIONS.minZoom` 0.02 → 0.005 + отдельный
  `FIT_SELECTION_OPTIONS = { padding: 0.3, maxZoom: 1, minZoom: 0.1 }`.
  CDP (разброс 60 000 px): zoom 0.0104, узлы в кадре; при 0.02 zoom
  клампился (1200 px против доступных 625).
- **Уточнение формулы:** `parsePadding` из @xyflow/system даёт
  `height/(1+padding)/minZoom` (не `height/minZoom`) → 19 208 px при 0.02
  и 76 833 px при 0.005, а не 23 050/92 200 (см. KI-335).
- **Связанные:** KI-306, KI-307, KI-328, KI-335.

---

### KI-325 — `updatedAt` меняется на идемпотентном PATCH
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/workflow.service.ts`
- **Описание:** `updatedAt: new Date()` в `set` на любом PATCH,
  включая name/description и идентичные nodes/edges.
  После KI-300 заметнее: Save без правок двигает `updatedAt`, но
  не `version`. Pre-existing, но теперь выделяется.
- **Связанные:** KI-300.

---

### KI-024 — Сбой публикации события роняет узел
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** `publishAsync(node_started/node_completed)` внутри try —
  недоступность Redis помечает узел failed, хотя сам узел отработал.
- **Решение:** события — best-effort. Разделить «ошибка выполнения» и
  «ошибка публикации». Узел → completed; publish — только лог.
- **Когда чинить:** до R4.
- **Связанные:** —

---

### KI-410 — устаревшая `nodeErrors` после job-retry
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.0 (R7.4b, коммит `8e1e89a`)
- **Файлы:** `web/src/stores/workflow.ts`
- **Описание:** `node_completed` не очищал `nodeErrors[nodeId]`. Панель
  показывала «Ошибка» после успешного retry.
- **Fix:** очистка при `node_completed` (в коммите `8e1e89a`).
- **Связанные:** KI-070.

---

### KI-581 — Нет default process-метрик и моста OTel→Prometheus
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/metrics/metrics.service.ts`, `src/observability/`
- **Описание:** экспортируются только 4 кастомные метрики; CPU/RSS/event-loop/GC (`collectDefaultMetrics`) и моста OTel-трейсов в Prometheus нет. DESIGN § 2.3 перечисляет только кастомные, но для дежурства стандартные process-метрики полезны.
- **Решение:** добавить `collectDefaultMetrics({ register })` и/или OTel Prometheus exporter в v1.1 (следить за памятью и префиксами).
- **Fix (v1.1.0 S4, частично):** в конструкторе `MetricsService` вызывается
  `collectDefaultMetrics({ register: this.registry })` — CPU, RSS, heap,
  event loop, GC, handles. Имена `process_*`/`nodejs_*` не конфликтуют с
  доменными (`http_`, `run_`, `agent_`, `llm_call_`); тест и смоук проверяют
  `nodejs_*`/`process_*`. **Остаток:** моста OTel-трейсов в Prometheus нет —
  вынесен в KI-612.
- **Связанные:** KI-574, KI-576, KI-577, KI-582, KI-609, KI-611, KI-612.

### KI-289 — http-узел не считает 4xx/5xx ошибкой
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `aacae26`)
- **Файлы:** `src/engine/node-executors.ts` (`executeHttpNode`)
- **Описание:** HTTP 4xx/5xx возвращаются как `{ status, body }` —
  узел завершается `completed`, а не `failed`. Для невалидного URL,
  отдавшего 400, ни узел, ни run не помечаются failed (смоук
  R6.5.2-fix: пришлось использовать закрытый порт для падения).
- **Решение:** конфигурируемый `failOnHttpError` (или предикат по
  статусу) + `retryable` для 5xx/429.
- **Fix:** `HttpNodeData.failOnHttpError?: boolean` (Zod в исполнителе,
  дефолт false — backward compat); при true и status >= 400 — `throw
  new Error('HTTP <код>')` (тело/заголовки не попадают в node_runs.error,
  RULES 5.9). +5 unit + интеграционный (http fails → потомок skipped).
- **Остаток:** KI-340 (5xx/429 не ретраятся — обычный Error, не
  LlmProviderException.retryable).
- **Связанные:** KI-036, KI-041, KI-288.

---

### KI-260 — Вставляемый узел накрывает соседей
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0d (R6.4a-fix5, коммит `21fdad7`)
- **Fix:** `insertPositionOnEdge` (`lib/graph-edit.ts`) — позиция =
  центр связи − половина размера; размер — `measured` существующего
  узла того же типа, дефолт 240×100. Δ=0.0 px.
- **Остаток:** перекрытие в «тесной» раскладке (зазор Toolbar 40 px
  < ширины 240 px) → KI-263.
- **Связанные:** KI-185, KI-263.
- **Файлы:** `web/src/stores/workflow.ts` (`addNodeOnEdge`)
- **Описание:** Позиция нового узла = среднее `top-left` источника
  и приёмника (не центр связи). Узел 240×~176 накрывает и
  источник, и приёмник.
- **Решение:** позиция = центр связи минус половина
  `measured`-размера узла.
- **Связанные:** KI-185.

---

### KI-242 — Сбой копирования не сообщается пользователю
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/ShareModal.tsx`
- **Описание:** Clipboard API требует user activation. Программный
  клик в смоуке не сработал. Добавлен fallback на deprecated
  `execCommand('copy')`, но неудача никак не сигнализируется —
  метка остаётся «Копировать».
- **Решение:** при сбое показывать «Не удалось скопировать,
  выделите вручную» / статус из `navigator.clipboard`.
- **Когда чинить:** при UX-полировке.
- **Связанные:** KI-197.

---

### KI-446 — На UI нет версии и копирайта
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.4
- **Файлы:** `web/src/components/TopBar.tsx`
- **Описание:** нарушение RULES 1.12: в интерфейсе нет строки
  `© 2026 RuChating (iilmchat) · vX.Y.Z`. Версия продукта пользователю не
  видна (в `package.json` — `0.9.1`), `TopBar` заканчивается на user-menu.
- **Решение:** добавить в `TopBar` (правый край, `text-xs
  text-muted-foreground`) статичный копирайт и версию из `package.json`
  через Vite `define` (`__APP_VERSION__`) либо
  `import.meta.env.VITE_APP_VERSION`, чтобы версия не дублировалась руками.
- **Связанные:** RULES 1.12, KI-008.

---

### KI-549 — `RunSummary.cursor` дублирует `nextCursor`
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/runs/dto/run-history.dto.ts`, `web/src/lib/api.ts`,
  `web/src/components/RunHistoryModal.tsx`
- **Описание:** После введения `nextCursor` (v0.16 S1, KI-542) навигация UI
  использует только `RunHistoryResponse.nextCursor`; курсор в каждом
  `RunSummary` остаётся невостребованным. Два поля кодируют одно и то же
  (`{createdAt, id}`), и клиент может выбрать неверный путь навигации
  (`runs.at(-1).cursor` вместо `nextCursor`) — последний, например, учитывает
  `limit + 1` и не зацикливает «Загрузить ещё» на пустой странице.
- **Решение:** оставить оба поля до мажорного релиза (per-item cursor полезен
  для диагностики и точечной догрузки), в v1.0 обсудить удаление
  `RunSummary.cursor` и оставить единственный `nextCursor`.

### KI-137 — Корневой vitest подхватывает web-спеки
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `503e1a2`)
- **Файлы:** `vitest.config.ts` (корневой)
- **Описание:** После R5.3 `pnpm test` в корне давал 34 files /
  327 tests (33/325 backend + 2 web) — `include: ['**/*.spec.ts']`
  подхватывал `web/src/i18n/i18n.spec.ts`. Backend-прогон зависел
  от наличия `web/node_modules`.
- **Fix:** `include` сужен до `src/**/*.spec.ts` + `test/**/*.spec.ts`,
  добавлен `exclude: ['**/node_modules/**', '**/dist/**', 'web/**']`.
  Root 33/325, web — своим job'ом в CI.
- **Связанные:** KI-005, KI-068, KI-126.

---

### KI-067 — `concurrency` глобальный, нет fairness
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.9.0 (R7.7, коммит `3e2844a`)
- **Fix:** per-provider семафор `ProviderSemaphore` (`src/llm/provider-semaphore.ts`)
  — FIFO-очередь, идемпотентный `release`, лимит на провайдера из
  `LLM_PROVIDER_MAX_CONCURRENCY_<NAME>` (default — без ограничения,
  backward compat). Вызовы LLM не бьют в одного провайдера сверх лимита.
- **Остаток:** глобальный `concurrency` очереди BullMQ (5) не пересчитан
  нагрузочным тестом — калибровка остаётся открытой (KI-065).
- **Файлы:** `src/llm/provider-semaphore.ts`, `src/llm/llm.service.ts`,
  `src/config/env.schema.ts`
- **Описание:** `concurrency = 5` — глобальный параметр очереди. Пять
  тяжёлых запусков одновременно бьют в одного провайдера (429/лимиты,
  рост расходов); нет разделения по пользователю/workflow и
  ограничения на одновременные вызовы провайдера. Дефолт 5 выбран
  «на глаз», без нагрузочного теста (сколько параллельных запусков
  выдерживает пул `pg` в `DbModule`).
- **Решение:** per-provider семафор или нагрузочный тест + калибровка
  дефолта.
- **Когда чинить:** при появлении параллельных пользователей или
  провидорских лимитов.
- **Связанные:** KI-065, KI-048.

---

### KI-528 — `SafeHttpClient.discardAsync` ронял процесс на редиректе
- **Приоритет:** 🔴 High | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `src/common/http/safe-http.client.ts`, `src/common/http/safe-http.client.spec.ts`
- **Описание:** `undici` 8 эмитит `RequestAbortedError` на непрочитанном теле. Без слушателя — uncaught exception и падение бэкенда.
- **Решение:** `discardBodyAsync` ставит слушатель `error` до `destroy()`. Найдено smoke-тестом S3.

### KI-475 — 3D/Motion узлы не реализованы (перенесено из KI-196)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/lib/node-registry.ts`,
  `docs/development/v0.9/DESIGN_V09_FEATURES.md`,
  `docs/development/v0.10/DESIGN_V010_FEATURES.md`
- **Описание:** KI-196 фиксировал перенос 3D-сцены и motion-ролика в v0.10,
  но v0.10.0 выпущен с 22 типами узлов без `3d`/`motion`; DESIGN v0.10 § 6
  уже переносит их в v0.11+ («нет провайдера/спроса»). Это остаток KI-196,
  вынесенный отдельно, чтобы не держать закрытыми пять реализованных
  операций `image_tool`.
- **Решение:** отдельные узлы 3D/Motion в v0.11+ после появления
  провайдера/спроса; до этого не обещать их в UI и роадмапе.
- **Связанные:** KI-196, KI-128, DESIGN v0.10 § 6.

---

### KI-142 — zod не объявлен в web/package.json
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `169b117`)
- **Файлы:** `web/package.json`, `web/pnpm-lock.yaml`
- **Описание:** `zod` использовался в `web/src/lib/api.ts`,
  `web/src/types/media.ts`, `web/src/types/run-stream.ts`, но НЕ был
  в `web/package.json`. Локально разрешался из корневого
  `node_modules` (фантомная зависимость); в CI (`working-directory:
  web`, свой `pnpm install`) — TS2307 + каскад TS7006 (параметры
  `param`/`option`/`edge` становились `any`). 8 ошибок build.
- **Fix:** `zod: ^4.6.6` в `web/dependencies` + lockfile.
  TS7006 исчезли сами — побочный эффект. Аудит bare-импортов
  подтвердил отсутствие других фантомных зависимостей.
- **Связанные:** KI-005, KI-068, KI-126, RULES 6.11.

---

### KI-150 — `cost_usd` не заполняется для моделей вне прайс-листа
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.9.0 (R7.7, коммит `3e2844a`)
- **Fix:** `findModelPricing` ищет тариф в три шага: точное совпадение →
  `bareModelId` → **последний сегмент** id. Модели RouterAI с префиксом
  (`openai/gpt-4o`) больше не дают `cost_usd = null` — считается по
  `MODEL_PRICING` (смоук: `$0.008735`). Для кэш-токенов стоимость
  считается отдельно (KI-055).
- **Остаток:** модели вне `MODEL_PRICING` (часть DeepSeek/GPTunnel) по-прежнему
  дают `null` — это честное «неизвестно», но подписи «цена неизвестна» в UI
  нет. Правка прайса — по мере появления тарифов.
- **Файлы:** `src/llm/model-pricing.ts`, `web/src/components/RunResultPanel.tsx`
- **Описание:** Для моделей RouterAI/GPTunnel/DeepSeek/Yandex прайс-лист пуст,
  поэтому `costUsd` остаётся `null` и панель не показывает стоимость вовсе —
  пользователь видит токены без цены и не может оценить расход.
- **Решение:** наполнять `MODEL_PRICING` тарифами провайдеров или брать цену из
  их API; до этого честно подписывать «цена неизвестна» вместо пустоты.
- **Когда чинить:** v0.8 (нужны тарифы).
- **Связанные:** KI-052, KI-055, KI-151.

---

### KI-164 — Нет кнопки «Новый workflow»
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `9d2f6bf`)
- **Файлы:** `web/src/components/TopBar.tsx`, `web/src/stores/workflow.ts`
- **Описание:** Начать новый граф было нечем: оставалось либо очищать узлы
  вручную, либо перезагружать страницу, при этом `?workflowId=` возвращал
  прежний workflow. Очистка состояния запуска при этом не выполнялась.
- **Fix:** кнопка «Новый» рядом с Load: confirm при непустом графе, сброс узлов,
  связей, `currentWorkflowId`, имени, выбранного узла и всей run-статистики,
  удаление `?workflowId` из URL через `history.replaceState`.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-147, KI-163.

---

### KI-232 — Welcome screen с шаблонами при старте
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/App.tsx` (условие показа),
  `web/src/components/WelcomeScreen.tsx` (новый),
  `web/src/i18n/{ru,en}.json`
- **Описание:** GPTunnel при открытии редактора показывает
  welcome-экран: 3 карточки-шаблона («Изображение из текста»,
  «Картинка → видео», «Идея → AI-промпт → изображение»),
  кнопка «Скрыть» и чекбокс «Больше не показывать». У нас при
  открытии `/` без `?workflowId=` — пустой canvas.
- **Решение:**
  - Показ при `nodes.length === 0 && !currentWorkflowId &&
    !localStorage.welcomeDismissed`.
  - 3-5 шаблонов (связано с KI-109): «Text→Image»,
    «Text→LLM→Image», «Idea→Prompt→Image», «http→LLM»,
    «LLM→Compare».
  - Клик по карточке → `POST /templates/:id/instantiate` (из KI-109) →
    открыть в редакторе.
  - Галочка «Больше не показывать» → `localStorage.welcomeDismissed=true`.
  - Кнопка «Скрыть» — одноразовый dismiss.
  - i18n: `welcome.title`, `welcome.subtitle`, `welcome.dismiss`,
    `welcome.neverShow`, `welcome.template.*` (5 штук).
- **Когда чинить:** v0.8.x — **после R6.6** (Templates), т.к.
  зависит от `POST /templates/:id/instantiate`.
- **Связанные:** KI-109, KI-196 (v0.9), DESIGN v0.8 § 9.3.

---

### KI-190 — Мини-карта: toggle + hotkey
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.1, коммит `e923384`)
- **Fix:** hotkey M + кнопка в панели; `showMinimap` в сторе +
  localStorage; условный рендер `<MiniMap />`.
- **Связанные:** KI-158 (контраст), KI-170 (aria-label — оставлен Open).
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel: мини-карта включается/выключается через
  правую панель. У нас — всегда показана (KI-158 — контраст).
- **Решение:** toggle в правой панели + сохранение в localStorage.
- **Когда чинить:** v0.8.
- **Связанные:** KI-158.

---

### KI-370 — дублирование маршрутизации в `MediaNodeExecutor`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/media/media-node-executor.service.ts`
- **Описание:** `MediaNodeExecutor` инжектит `MEDIA_PROVIDERS` напрямую и
  сам ищет модель в каталогах, потому что `media-registry.service.ts`
  зарезервирован R7.3. Логика должна жить в реестре (метод
  `applyToolAsync` в `MediaRegistryService`).
- **Решение:** после R7.3 вернуть в реестр.
- **Связанные:** KI-352, KI-363, R7.3.

---

### KI-611 — `collectDefaultMetrics` регистрируется на каждый инстанс и не снимается
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-04
- **Файлы:** `src/metrics/metrics.service.ts`
- **Описание:** каждый `MetricsService` создаёт свой `Registry` и вызывает
  `collectDefaultMetrics`, включая `PerformanceObserver` для GC (nodejs_gc_*).
  В проде инстанс один, но тесты создают десятки сервисов; наблюдатели и
  зарегистрированные коллекторы не снимаются при уничтожении сервиса
  (Nest не вызывает для этого хук). На коротких тестах это незаметно, при
  долгоживущем процессе с пересозданием сервиса — утечка наблюдателей.
- **Решение:** вынести default-коллекторы в отдельный singleton-провайдер (или
  регистрировать их один раз на процесс с общим реестром), при необходимости —
  `OnApplicationShutdown` с `registry.clear()`; в тестах использовать
  `collectDefaults: false`-опцию конструктора.
- **Связанные:** KI-581.

### KI-414 — Anthropic prompt caching не включается
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 (коммит `1c36901`) — `cache_control: ephemeral`
  на последнем system-блоке при длине промпта выше `PROMPT_CACHE_MIN_TOKENS`.
- **Файлы:** `src/llm/providers/anthropic.provider.ts`
- **Описание:** нет `cache_control: ephemeral` при `systemPrompt > 1024`, нет
  `PROMPT_CACHE_ENABLED` / `PROMPT_CACHE_MIN_TOKENS` (DESIGN § 3.7.3).
  `cache_creation_tokens` от наших вызовов всегда `null`.
- **Решение:** аннотировать последний system-block `cache_control` при длине
  `systemPrompt` > порога; env-флаги.
- **Связанные:** KI-055, DESIGN v0.9 § 3.7.3.

---

### KI-243 — Флаг «Разрешить копирование» — UI-заглушка
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/ShareModal.tsx`
- **Описание:** Чекбокс «Разрешить копирование» ничего не сохраняет,
  сбрасывается при F5, ни на что не влияет — задел под R6.6.
- **Решение:** либо реализовать в R6.6 (backend-поле `allow_copy` +
  проверка при импорте), либо убрать из UI до тех пор.
- **Когда чинить:** R6.6.
- **Связанные:** KI-197, KI-108 (Export/Import).

---

### KI-534 — Опечатка в `MCP_STDIO_ENV_ALLOWLIST` не диагностируется
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp.config.ts`, `src/mcp/mcp-client.service.ts`
- **Описание:** Если переменной нет в окружении, она молча пропускается. Нет WARN о не найденном имени.
- **Решение:** валидировать имена и логировать WARN.
- **Реализовано в v0.16 S1:** `McpClientService.buildStdioEnv` собирает имена
  allowlist, не найденные ни в `env` сервера, ни в `ConfigService`, и пишет
  WARN с их перечнем (без значений, RULES 5.1). WARN — один раз на сервер
  (`warnedMissingAllowlist`), переподключение не дублирует строку.

### KI-141 — pnpm version в CI дублировал packageManager
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `c841bfd`)
- **Файлы:** `.github/workflows/ci.yml`
- **Описание:** CI job `web` падал на `pnpm/action-setup@v4`:
  `Multiple versions of pnpm specified` — `version: 12` в YAML +
  `pnpm@12.11.2` в `package.json` (`packageManager`).
  `ERR_PNPM_BAD_PM_VERSION`. Backend job — без `version`, правильный.
- **Fix:** `with: version: 12` убран из job `web` — версия берётся
  из `packageManager` (как в backend).
- **Связанные:** KI-005, KI-068, KI-126, RULES 6.10.

---

### KI-577 — Агентский `llm_call` не инструментирован
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/agent/agent.service.ts`, `src/metrics/metrics.service.ts`
- **Описание:** инструмент `llm_call` делает второй платный LLM-вызов внутри шага; он не попадает в `agent_step_duration_seconds` (latency tool-вызова не видна; стоимость учитывается отдельно через usage/budget).
- **Решение:** при необходимости `agent_tool_llm_duration_seconds{model}` или общий `llm_request_duration_seconds` на уровне `LlmService` (S5).
- **Fix (v1.1.0 S4):** добавлена гистограмма
  `llm_call_duration_seconds{model,status}` с ведрами 0.05…60 с.
  `executeToolAsync` замеряет выполнение `llm_call` (модель — из аргументов
  инструмента или из модели агента) и пишет `success`/`error`; ошибка
  инструмента не прерывает цикл. `model`-label санитизируется по реестру
  моделей (`unknown` для произвольной строки от LLM), чтобы не раздувать
  кардинальность. Смоук подтверждает серию после реального `llm_call`.
- **Связанные:** KI-574, KI-576, KI-610.

### KI-288 — Потомки упавшего узла не пропускаются (нет статуса skipped)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `aacae26`)
- **Файлы:** `src/engine/execution-engine.service.ts`, `src/db/schema.ts`
- **Описание:** После KI-287 (вариант A) зависимые узлы выполняются
  с `null`-входами и падают сами. У пользователя узел-потомок выглядит
  как самостоятельно сломанный, хотя запускать его не следовало.
- **Решение:** добавить `skipped` в `RUN_STATUSES` (миграция) +
  транзитивное замыкание от упавших в `executeAsync`.
- **Fix:** `executeAsync` собирает `failedIds`/`skippedIds`; перед каждым
  уровнем узлы с упавшим/пропущенным предшественником (обратный граф из
  `executionMap.dependents`) не выполняются, а UPSERT'ятся в `node_runs` со
  `status='skipped'` и `error='Пропущен: упал предшественник'` (KI-031),
  публикуется `node_skipped` (RunEventSchema). Пропуск транзитивен.
  `NodeRunSnapshotSchema` принимает skipped (условие работоспособности SSE).
  +12 тестов, смоук на реальных PostgreSQL+Redis (22 проверки).
  В v0.8.3 остаток KI-288 закрыт на фронте (`df4f3f0`).
- **Остаток:** KI-338 (ветки condition), KI-339 (кто упал), KI-353
  (три источника правды по статусам).
- **Связанные:** KI-287, KI-290, KI-301.

---

### KI-491 — Список шаблонов не обновляется при возврате к узлу
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/components/nodes/DocumentGenNode.tsx`
- **Описание:** Загруженные шаблоны кэшируются до перезагрузки страницы. Если шаблон удалили в другой вкладке, он останется в селекте.
- **Решение:** инвалидация списка при `visibilitychange` или фокусе на узле.

---

### KI-563 — Совместная работа между организациями недоступна до S5
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.0.0 (S5) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/workflow/workflow.service.ts`,
  `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md` § 2.1/§ 5
- **Описание:** S1 создал каждому существующему пользователю личную
  организацию, S2 разрешает коллаборацию только внутри одной организации.
  API создания организации, приглашения в неё и смены организации появится в
  S5, поэтому сейчас все пользователи — в разных (личных) организациях:
  совместная работа над workflow (участники R7.6) между двумя пользователями
  невозможна (в смоуке same-org путь проверен прямой SQL-правкой
  `users.organization_id`). Существующие collaboration-связи де-факто
  заморожены, см. KI-560.
- **Решение:** в S5 — управление организацией/командой (приглашение в org,
  роли owner/admin/member/viewer), UI настроек, перенос существующих
  участников в общие организации; после этого пересмотреть семантику
  `GET /workflow` (возможно, доступ всех member организации, а не только
  владельца/участника).
- **Fix (S5):** таблица `organization_invitations` (миграция
  `0016_numerous_gambit.sql`), `POST /admin/members/invite` (owner/admin) и
  «сжигание» приглашения при регистрации: приглашённый создаётся в организации
  пригласившего с назначенной ролью (`admin`/`member`/`viewer`) в той же
  транзакции; UI-модалка «Команда и аудит». Перенос **уже зарегистрированных**
  пользователей между организациями остаётся нерешённым — KI-583; доставка
  писем — KI-584.
- **Связанные:** DESIGN v1.0 § 2.1/§ 5, KI-560, KI-583, KI-584.

### KI-539 — `started_at` по умолчанию = времени создания запуска
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`, `src/runs/runs.service.ts`
- **Описание:** `workflow_runs.started_at` объявлен с `DEFAULT now()`, а
  фактическое время старта пишет только `markRunRunningAsync`. У запусков,
  упавших до этого шага (невалидный snapshot, ошибка планирования), `started_at`
  — время постановки в очередь, поэтому история (`durationMs = finished_at −
  started_at`) показывает длительность вместе с ожиданием в очереди.
- **Решение:** убрать дефолт у `started_at` (миграция + backfill `NULL` для
  `pending`) или считать длительность как `sum(node_runs.duration_ms)`.

### KI-426 — `S3_TTL_DAYS` не удаляет объекты из бакета
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/media/media-storage.service.ts`
- **Описание:** `stored_expires_at` вычисляется, но cron чистит только
  локальный диск (KI-413). Объекты S3 живут вечно и растут в цене.
- **Решение:** lifecycle-правило на бакете (`Expiration`) либо `DeleteObjects`
  в задании очистки.
- **Связанные:** KI-412, KI-413, KI-362.

---

### KI-273 — Расширенные хоткеи: Ctrl+A / Ctrl+C / Ctrl+V / Ctrl+S / Ctrl+Shift+Backspace
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/hooks/use-hotkeys.ts`, `web/src/components/Canvas.tsx`
- **Описание:** DESIGN v0.8 § 7.2 перечисляет полный список хоткеев.
  После R6.4b.2b закрыты: Ctrl+D, S, H, F, M, Tab, C, Shift+C,
  Ctrl+Z, Ctrl+Shift+Z. **Остаток** (отложен сознательно — не критично
  для MVP): Ctrl+A (выделить все), Ctrl+C/Ctrl+V (копи/паст узлов),
  Ctrl+S (сохранить — сейчас Save только кнопкой),
  Ctrl+Shift+Backspace (очистить промпт выделенных).
- **Решение:** (1) Ctrl+A / Ctrl+C / Ctrl+V — буфер узлов в памяти
  + вставка с offset; (2) Ctrl+S — `saveWorkflowAsync()`; (3)
  Ctrl+Shift+Backspace — `updateNodeData` пустого `prompt`.
- **Когда чинить:** v0.8.x (после R6.7) — не блокер продукта.
- **Связанные:** KI-186, KI-191, KI-195.

---

### KI-261 — `addNodeOnEdge` при отсутствующей связи молча ничего не делает
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0d (R6.4a-fix5, коммит `21fdad7`)
- **Fix:** notice `canvas.edge.gone` («Связь уже удалена»).
- **Связанные:** KI-185.
- **Файлы:** `web/src/stores/workflow.ts` (`addNodeOnEdge`)
- **Описание:** Если связь исчезла между открытием каталога и
  выбором типа — функция возвращает `{}` без notice пользователю.
- **Решение:** тост «Связь уже удалена».
- **Связанные:** KI-185.

---

### KI-147 — Run без Save не предупреждает об устаревшем snapshot
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `47d577f`)
- **Файлы:** `web/src/components/TopBar.tsx` (`handleRun`)
- **Описание:** `handleRun` вызывал `saveWorkflowAsync()` только если
  `currentWorkflowId === null`. Для **ранее сохранённого** workflow авто-Save
  **не срабатывал** — `POST /runs` брал **snapshot из БД**, а не текущее
  состояние UI. Пользователь добавлял связи после последнего Save, нажимал
  Run — backend получал `связей=0`, узлы падали с «Пустой prompt».
- **Fix:** Run всегда выполняет `await saveWorkflowAsync()` перед стартом,
  поэтому в БД уходит актуальный граф. Операция идемпотентна: если ничего не
  менялось, backend обрабатывает PATCH без изменений.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-098, KI-101.

---

### KI-433 — Метрики `AgentRunResult` не пишутся в `node_runs`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — `executeAgentNodeAsync` возвращает `usage`
  (`AgentNodeExecutionMetrics`: суммарные токены и `cost_usd` цикла), движок
  пишет `tokens_in`/`tokens_out`/`cost_usd` в `node_runs` и в SSE-проекцию
  наравне с LLM-узлами.
- **Файлы:** `src/engine/node-executors.ts`,
  `src/engine/execution-engine.service.ts`, `src/agent/agent.types.ts`
- **Описание:** `executeAgentNodeAsync` возвращает только `outputs` и `steps`;
  `tokensIn` / `tokensOut` / `costUsd` из `AgentRunResult` до движка не
  доходят. У узла `agent` колонки `node_runs.tokens_in`, `tokens_out`,
  `cost_usd` остаются `NULL`, поэтому бюджет (KI-407) считается, а в БД и в
  агрегате запуска этих трат нет.
- **Решение:** расширить `AgentNodeExecution` полями usage/cost и передавать их
  в `updateNodeRunAsync` наравне с `LlmNodeExecutor`.
- **Связанные:** KI-407, KI-038, KI-054.

---

### KI-061 — Нет `GET /runs` (список запусков)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.controller.ts`, `src/runs/runs.service.ts`
- **Описание:** Есть POST/GET:id/stream, но нет `GET /runs` —
  нельзя получить историю запусков workflow (и отфильтровать по
  `workflowId`).
- **Когда чинить:** R4.2, если UI покажет историю.
- **Связанные:** —

---

### KI-483 — DESIGN § 3.2.4: формула имени MCP-инструмента даёт 65 символов при лимите 64
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Файлы:** `src/mcp/mcp-tool.adapter.ts`, `src/mcp/mcp-tool.adapter.spec.ts`
- **Описание:** Псевдокод `raw.slice(0, MCP_AGENT_TOOL_NAME_MAX - 9) + '__' + sha256[0..8]` даёт 55 + 2 + 8 = 65 символов, то есть превышает объявленный лимит имени инструмента в протоколе агента на 1 символ; на части провайдеров/валидаторов это может отклонить вызов.
- **Решение:** Префикс обрезается до 54 символов (54 + 2 + 8 = 64); sha256-хвост сохранён, коллизии маловероятны (2⁻³² на пару), уникальность сервер+инструмент сохраняется.
- **Исправлено в:** v0.11.0 (S7).
- **Связанные:** DESIGN v0.11 § 3.2.4, v0.11 S7.

---

### KI-154 — Дефолтная media-модель `bgremover` не работает для text-to-image
- **Приоритет:** 🔴 Critical | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `29f4e19`)
- **Файлы:** `web/src/lib/media.ts` (`pickDefaultMediaModel`),
  `web/src/stores/workflow.ts` (`addNode`)
- **Описание:** Новый узел Image Generation получал `mediaModels[0]`. Каталог
  CreativeLab приходит в алфавитном порядке, поэтому первой оказывалась
  `bgremover` — image-to-image, требующая входного файла. Run падал с
  upstream-ошибкой `Invalid input, check schema issues`, и первый же запуск
  нового узла выглядел сломанным.
- **Fix:** выбор дефолта вынесен в `pickDefaultMediaModel`: сначала известные
  text-to-image модели (`flux-schnell`, `flux-dev`, `dall-e-3`, `nano-banana`,
  `gemini-image`), затем первая модель с `prompt: 'required'` и без обязательных
  входов, иначе `''` (выбирает пользователь). Покрыто 8 юнит-тестами.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-160, KI-173.

---

### KI-237 — Повторный POST `/workflow/:id/share` молча перевыпускает токен
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/workflow/workflow.service.ts`
  (`createShareTokenAsync`)
- **Описание:** Повторный `POST` инвалидирует старую ссылку **без
  предупреждения**. Не отличается от «отозвать + создать», может
  удивить пользователя.
- **Решение:** в UI — подтверждение «Перевыпустить ссылку? Старая
  перестанет работать» (KI-239); либо отдельный
  `POST .../share/rotate`.
- **Когда чинить:** R6.2.2 (frontend, KI-239) или v0.8.x.
- **Связанные:** KI-197, KI-239.

---

### KI-157 — Курсор в контролируемых полях прыгает в конец
- **Приоритет:** 🔴 Critical | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `702d849`)
- **Файлы:** `web/src/hooks/use-preserve-cursor.ts`,
  `web/src/components/nodes/TextNode.tsx`, `web/src/components/TopBar.tsx`
- **Описание:** `<textarea value>`/`<input value>` были связаны с Zustand:
  каждый введённый символ менял состояние → перерисовка → React перезаписывал
  значение в DOM и **терял позицию курсора**. Правка середины текста уводила
  курсор в конец: вместо `12345X6789` пользователь получал правильный текст,
  но курсор на позиции 10 вместо 6. В TopBar то же на имени workflow.
- **Fix:** хук `usePreserveCursor` запоминает выделение перед записью в стор и
  возвращает его через `useLayoutEffect` — только когда DOM уже содержит новое
  значение (иначе React перезапишет его позже и снова уведёт курсор).
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-161, KI-169.

---

### KI-008 — Zod в клиентском бандле добавляет ~100 kB
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.9.3
- **Fix:** route-level code-split (React.lazy для страниц и узлов) — основной
  чанк уменьшен до ~141 kB, тяжёлые зависимости уехали из first-load (KI-390).
- **Файлы:** `web/src/lib/api.ts`
- **Описание:** Zod-валидация ответов бэкенда даёт безопасность, но тянет
  ~100 kB в bundle (506 kB vs 405 kB до Task 3). Vite предупреждает про
  chunk > 500 kB.
- **Возможные решения:**
  1. Динамический импорт Zod только при получении ответа.
  2. Заменить на лёгкие type-guard'ы (без схем).
  3. Оставить как есть — 506 kB приемлемо для MVP.
- **Не блокер:** заметка на будущее, если размер станет критичным.

---

### KI-058 — `isConfigured` — это «ключ задан», а не «ключ работает»
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/providers/*.provider.ts`
- **Описание:** Невалидный/просроченный ключ даёт `isConfigured = true`,
  и UI покажет модели, вызов которых упадёт с 401/403 (в smoke KI-038
  невалидный ключ дал 403).
- **Решение:** необязательный health-check на старте **или** учёт
  последней ошибки авторизации, чтобы отличать «ключа нет» от
  «ключ не работает».
- **Когда чинить:** при UI, который показывает статус провайдера.
- **Связанные:** KI-039.

---

### KI-391 — Рестарт без `INSTANCE_ID` оставляет run в `pending`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.1 (коммит `af1766d`) — дефолт `os.hostname():PORT`.
- **Файлы:** `src/runs/runs.worker-options.ts`, `src/runs/runs.processor.ts`
- **Описание:** `INSTANCE_ID` по умолчанию — `randomUUID()` на процесс. После
  рестарта без явного `INSTANCE_ID` задания от прежнего процесса попадают к
  новому воркеру, не проходят instanceId-check и пропускаются; run остаётся
  `pending` навсегда.
- **Решение:** стабильный дефолт (`hostname:PORT`), либо персист instance-id в
  Redis, либо adoption «pending + старый job».
- **Связанные:** KI-387.

---

### KI-544 — В списке истории нет причины падения запуска
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/RunHistoryModal.tsx`, `src/runs/dto/run-history.dto.ts`
- **Описание:** `RunSummary` (v0.14 S1) не включает `error`: failed-строка в
  истории показывает только «Ошибка», причина видна после клика (панель
  результата / `GET /runs/:id`). Это осознанно лёгкий контракт списка, но
  пользователю приходится открывать запуск, чтобы понять, что произошло.
- **Решение:** добавить `error` в `RunSummary` (расширение контракта + зеркала)
  либо показывать причину в тултипе строки из `GET /runs/:id` по требованию.

### KI-405 — компонентные тесты фронтенда без DOM
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.3
- **Fix:** jsdom + Testing Library; компонентные тесты `AgentNode` и
  `VectorUpsertNode` через `render()`, а не только проверки контракта (KI-155).
- **Файлы:** `web/src/lib/vector-memory-nodes.spec.ts`,
  `web/src/lib/node-registry.spec.ts` (компонентных `*.spec.ts`
  в `web/src/components/nodes/` нет)
- **Описание:** нет jsdom/@testing-library (KI-155) — тесты проверяют
  контракт (регистрация, handles, валидаторы), а не `render()`.
  Отличие от буквальной формулировки задания.
- **Решение:** jsdom при следующем апгрейде фронтенд-инфраструктуры.
- **Связанные:** KI-155, KI-364.

---

### KI-129 — Уборка типов фронтенда (NodeData, imageUrl)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `7838359`)
- **Файлы:** `web/src/types/graph.ts`, `web/src/stores/workflow.ts`,
  `web/src/lib/node-registry.ts`
- **Описание:** После KI-121/KI-122 накопились типовые шероховатости,
  не влияющие на рантайм, но мешающие поддержке:
  1. `NodeData` стал пустой индексной сигнатурой
     (`{ [key: string]: unknown }`) — тип больше ничего не
     документирует, хотя используется в `GraphNode.data`.
  2. `data.kind` (`'text' | 'llm' | 'image'`) не связан с `node.type`
     на уровне типов: можно создать `node.type='llm'` с
     `data.kind='image'` — tsc не заметит.
  3. В сторе после Load появляется ключ `imageUrl: undefined`
     (nodeDataFromApi задаёт его явно, даже если поле отсутствует) —
     в JSON/БД не попадает, но виден в `Object.keys(data)` и
     расходится с тем, что уйдёт в payload.
  4. `default:`-ветки в `createNode`/`nodeDataFromApi` не поймают
     4-й тип узла — расширить switch при добавлении или заменить
     на `satisfies`-проверку по реестру.
- **Возможные решения:**
  1. Дискриминированный union `NodeData` по `kind` + `satisfies`
     на `node.type`. Важно: `kind` сделать **обязательным**
     (`kind: 'text' | 'llm' | 'image'`), иначе tsc не сужает тип
     (сейчас `kind?` опционален в `TextNodeData`/`LlmNodeData`/
     `ImageGenNodeData`):
     `type NodeData = { kind: 'text'; value: string }
       | { kind: 'llm'; model: string }
       | { kind: 'image'; model?: string; aspectRatio?: string;
           imageUrl?: string }`.
  2. Явные `case 'text': case 'llm': case 'image_generation':`
     без `default:` — tsc потребует обработать новый тип
     (ошибка при добавлении узла — это то, что нужно).
  3. В `nodeDataFromApi` — не присваивать `imageUrl: undefined`,
     использовать условное добавление поля (или `structuredClone`).
- **Когда чинить:** — (закрыто, v0.7.0).
- **Fix:** `NodeData` — дискриминированный union по `kind`
  (`TextNodeData | LlmNodeData | ImageGenNodeData`), `kind`
  обязателен. `imageUrl` в `nodeDataFromApi` добавляется условно —
  без `undefined`-ключей (подтверждено payload PATCH:
  `dataKeys = [kind, model, aspectRatio]`). `createNode` /
  `nodeDataFromApi` — явные `case` без `default:`; новый тип узла
  поймает tsc.
- **Остаток:** связь `NodeType ↔ data.kind` компилятором **не**
  проверяется (см. KI-131) — `satisfies` проверяет только форму
  записи реестра.
- **Связанные:** KI-121, KI-122, KI-126, KI-127, KI-130, KI-131.

---

### KI-038 — `tokensIn` / `tokensOut` / `costUsd` / `logs` не заполняются
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/llm/llm-node-executor.service.ts`
- **Описание:** Провайдеры возвращают `usage` (tokens), но
  исполнители отдают только `{ text }`. Колонки остаются NULL —
  биллинг и UI-статистика в R4 без данных.
- **Решение:** расширенный результат узла (outputs + метрики) и
  запись метрик в `node_runs`.
- **Когда чинить:** R4.
- **Связанные:** —

---

### KI-396 — CDP-смоук невоспроизводим без Docker (инфраструктурный)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `.smoke/**` (скрипты), `docs/development/` (SMOKE_CDP.md)
- **Описание:** на 3-м компе (`K:\`) нет Docker/WSL, Postgres 5433, Redis
  6379. Backend стартует, SandboxModule инициализируется, но `/runs`
  невозможен (BullMQ `ECONNREFUSED`). Не дефект кода, но блокирует приёмочный
  смоук.
- **Решение:** документация «минимум для CDP — Docker/Postgres/Redis»; либо
  graceful-режим backend при отсутствии Redis.
- **Связанные:** KI-264, KI-275, R7.5.

---

### KI-168 — Кнопка сворачивания панели без подписи и тултипа
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `474a93f`)
- **Файлы:** `web/src/components/RunResultPanel.tsx`
- **Описание:** У кнопки с иконкой ▼/▲ не было ни `title`, ни `aria-label`:
  назначение угадывалось, скринридер озвучивал её как безымянную кнопку.
- **Fix:** добавлены `aria-label` и `title` из i18n (`panel.collapse` /
  `panel.expand`) в зависимости от состояния.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-145, KI-167.

---

### KI-531 — UI не различает `stdio`-транспорт MCP-сервера
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.13.0 (S1) | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/lib/api.ts`, `web/src/components/nodes/AgentNode.tsx`
- **Описание:** В UI нет бейджа/подписи, что сервер запущен локально.
- **Решение:** добавить бейдж `LOCAL` и i18n-строки.

### KI-139 — Unmet peer: react-i18next хочет TypeScript ^5
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/package.json`, `web/pnpm-lock.yaml`
- **Описание:** `react-i18next@15.7.4` объявляет peer
  `typescript: ^5`, в проекте TS 6.0.3. `pnpm peers check` ругается
  (`✕ unmet peer typescript`). Сборка и типы работают, но при
  `strict-peer-dependencies=true` установка упадёт.
- **Решение:** дождаться обновления `react-i18next` с поддержкой
  TS 6, либо `pnpm.peerDependencyRules.allowedVersions`.
- **Когда чинить:** при обновлении react-i18next.
- **Связанные:** KI-126.

---

### KI-228 — `?workflowId=` теряется при миграции на react-router
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0b (коммит `4eb4664`)
- **Файлы:** `web/src/App.tsx`,
  `web/src/components/auth/ProtectedRoute.tsx`,
  `web/src/components/auth/LoginPage.tsx`
- **Описание:** После R6.1b.2 (react-router-dom + ProtectedRoute)
  `?workflowId=` терялся **на трёх звеньях**:
  1. `ProtectedRoute` → `<Navigate to="/login" replace />` — без search.
  2. `LoginPage` → `navigate('/', { replace: true })` — без search.
  3. `App` читал `URLSearchParams` один раз на маунте (до логина → пусто).
  Итог: при заходе по прямой ссылке пользователь попадал на форму
  входа, а после логина — на пустой /; граф не грузился.
- **Fix:** `Navigate to={{ pathname: '/login', search: location.search }}`;
  `navigate({ pathname: '/', search: location.search }, { replace: true })`;
  `useSearchParams() + useEffect([workflowIdParam, authStatus])`.
  Побочный плюс: запрос графа не уходит до готовности сессии.
- **Связанные:** KI-229, KI-230.

---

### KI-595 — Шаблон письма только на русском
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/email/email.templates.ts`
- **Описание:** DESIGN V110 § 6 прямо исключает локализацию шаблонов из v1.1.0,
  поэтому тема и тело письма — русские для всех получателей; язык
  пользователя в `users` не хранится (у продукта есть RU/EN i18n, но не
  профиль locale). Англоязычный участник получит русское письмо.
- **Решение:** добавить `users.locale` (или фиксировать `Accept-Language` при
  регистрации) и EN-шаблон с выбором по locale получателя; тему/текст
  дублировать в `email.templates.ts` рядом (структура уже готова — функции
  принимают orgName/ссылка).
- **Связанные:** DESIGN V110 § 6, KI-584.

### KI-298 — `drizzle-kit generate` не сверяет схему с БД (только со snapshot)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.2 (коммит `df2ea46`)
- **Fix:** `src/db/schema-parity.spec.ts` — CI-гейт сверки
  `information_schema.columns` ↔ Drizzle-схема (data_type /
  is_nullable / default / numeric_precision,scale); шаг
  `Apply migrations` в `.github/workflows/ci.yml`.
- **Остаток:** KI-317..321.
- **Связанные:** KI-293, KI-296, KI-317..321.
- **Файлы:** `drizzle.config.ts`, CI, `package.json` (`db:generate`)
- **Описание:** `generate` не подключается к БД — сравнивает только
  `schema.ts` ↔ последний snapshot. Любой дрейф `snapshot ↔ фактическая
  БД` невидим: `pnpm db:generate` рапортует «No schema changes», пока
  схема и snapshot согласованы между собой. Именно это дало KI-293 и
  KI-296.
- **Решение:** CI/локальный гейт, сверяющий `information_schema.columns`
  с ожидаемыми типами (интеграционный тест на `pg_typeof`), либо
  `drizzle-kit push --dry-run` в read-only.
- **Связанные:** KI-293, KI-296, RULES 3.10.

---

### KI-453 — устаревший комментарий про `Ctrl+S` (Low)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 (S0)
- **Файлы:** `web/src/stores/workflow.ts`
- **Описание:** комментарий в `saveWorkflowAsync` утверждал, что `Ctrl+S`
  «живёт в Canvas» и вызывает стор, но биндинга в `Canvas` не было.
- **Решение:** комментарий приведён к факту: сохранение вызывается из TopBar
  и автосохранением, а `Ctrl+S` пока не привязан — хоткей вынесен в v0.10 S10
  (DESIGN v0.10 § 3.5.1).
- **Связанные:** KI-273.

---

### KI-176 — Yandex: цены не в `MODEL_PRICING` → `cost_usd = null`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.2-pre (коммит `ed945cd`)
- **Файлы:** `src/llm/model-pricing.ts`
- **Описание:** Цены Yandex AI Studio известны и стабильны
  (пользовательский конфиг):
  - YandexGPT Lite: $0.002/1k input, $0.002/1k output.
  - Qwen3.6-35B (VL): $0.002/1k input, $0.003/1k output.
  Но в `MODEL_PRICING` их нет → `cost_usd = null` (как в KI-150,
  KI-052). UI покажет токены без стоимости.
- **Fix:** в `MODEL_PRICING` добавлены `yandexgpt-lite`, `yandexgpt`,
  `yandexgpt-32k`, `qwen3.6-35b-a3b` (тарифы на 2026-10-15);
  `calculateCostUsd` ищет цену и по полному URI через `bareModelId()`.
- **Когда чинить:** — (закрыто, v0.7.2-pre)
- **Связанные:** KI-052, KI-150, KI-174.

---

### KI-578 — Переиспользованные узлы (KI-046) считаются completed с ~0 с
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** `executeNodeAsync` наблюдает completed и для узла, чей результат переиспользован после job-level retry (KI-046), — длительность ≈0. При ретраях `run_execution_duration_seconds_count` завышен, распределение смещено к нулю.
- **Решение:** не наблюдать reuse (возвращать признак из `executeNodeRunAsync`) либо добавить label `reused`.

### KI-363 — Image providers напрямую (Replicate / FAL / OpenAI Images)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.3)
- **Fix:** `MediaModule` регистрирует CreativeLab, Replicate, FAL и
  OpenAI Images; `MediaRegistryService.resolveByModelAsync` ищет модель по
  каталогам всех сконфигурированных провайдеров, порядок задаёт
  `MEDIA_PROVIDER_PRIORITY`.
- **Файлы:** `src/media/media-registry.service.ts`, `src/media/media.module.ts`,
  `src/media/providers/*`, `src/config/env.schema.ts`, `.env.example`,
  `web/src/components/nodes/ImageGenNode.tsx`
- **Описание (историческое):** media-провайдер был один — CreativeLab
  (GPTunnel). Replicate / FAL / OpenAI Images — крупнейшие вендоры
  image/video-моделей; без них недоступны flux-pro-1.1-ultra, SDXL, Kling,
  gpt-image-1.
- **Решение:** расширить `MediaRegistryService` — несколько `IMediaProvider`
  подряд; `resolveByModelAsync` ищет по всем; приоритет через env
  `MEDIA_PROVIDER_PRIORITY`. Env: `REPLICATE_API_TOKEN`, `FAL_KEY`,
  `OPENAI_IMAGES_API_KEY`. Реализация — DESIGN v0.9 § 3.3 (R7.3).
- **Связанные:** KI-196, KI-370, KI-379, DESIGN v0.9 § 3.3.

---

### KI-598 — Версии `nodemailer` (10.3.1) и `@types/nodemailer` (8.0.2) различаются мажорно
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `package.json`, `pnpm-lock.yaml`
- **Описание:** `nodemailer` не отдаёт собственные декларации типов
  (`"types"` в пакете отсутствует), поэтому типы ставятся отдельным пакетом
  `@types/nodemailer`, и на момент S1 upstream-версия типов — 8.0.2, а
  библиотеки — 10.3.1: типы отстают на два мажора. Используемый срез API
  (`createTransport`, `Transporter`, `sendMail` с `from/to/subject/text/html`)
  стабилен и совпадает, но при обновлении библиотеки TypeScript может не увидеть
  новые/удалённые опции (или пропустить breaking change) — расхождение никак не
  проверяется сборкой.
- **Решение:** перед каждым обновлением `nodemailer` сверять `@types`-пакет
  (ожидаем синхронизации версий), а при появлении bundled-типов в самой
  библиотеке — убрать `@types/nodemailer`; поведение транспорта покрыто
  unit-тестом и смоуком с реальным SMTP-диалогом.
- **Связанные:** KI-592, KI-593.

## v1.1.0 — Team Management (S2, 2026-11-03)

### KI-189 — Направляющие / snap при перетаскивании
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0d (R6.4a, коммит `fcd2913`)
- **Fix:** `snapToGrid + snapGrid=[8,8]`; guides — соседи из стора
  (3-й аргумент `onNodeDrag` содержит только dragged-узлы);
  SVG-слой в `<ViewportPortal>` + `overflow-visible` — линия точно
  на узлах при pan/zoom (Δ=0 при zoom 1.4/1.95).
- **Остаток:** отключение snap по Ctrl — v0.8.x.
- **Связанные:** KI-186.
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel показывает направляющие для выравнивания
  узлов, Ctrl временно отключает привязку. У нас — свободное
  перетаскивание без выравнивания.
- **Решение:** `snapToGrid` + custom guides (React Flow helper);
  hotkey Ctrl для отключения.
- **Когда чинить:** v0.8.
- **Связанные:** KI-186.

---

### KI-128 — Узлы-сервисы с внутренним конфигом (концепт)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.9.0 (R7.4a `3be8555`, R7.4b `8e1e89a`)
- **Fix:** сервисные узлы с собственным конфигом и runtime-состоянием:
  - **R7.4a** — Vector DB / Memory на pgvector: `vector_upsert`,
    `vector_query`, `memory_write`, `memory_read`; таблицы
    `workflow_vectors`, `workflow_memory` (миграция 0008), `VectorStoreService`.
  - **R7.4b** — `agent`: LLM-loop + 7 tools (vector/memory/http/image и др.),
    `AgentService`, транскрипт шагов в `node_runs.logs`.
- **Остаток:** «Веб-поиск» отдельным узлом не заведён; неидемпотентность
  `vector_upsert` (KI-401), каталог embedding-моделей (KI-402),
  Agent обходит бюджет (KI-407).
- **Файлы:** `src/vector/vector-store.service.ts`, `src/agent/agent.service.ts`,
  `src/engine/node-executors.ts`, `src/db/schema.ts`
- **Описание:** GPTunnel (2026-10-14) показывает класс узлов, которые
  мы ещё не поддержали: «Веб-поиск», «Векторная база», «Память» —
  с собственным UI, входами/выходами и состоянием («у вас ещё нет
  базы данных с обработкой»). Это не просто "ещё один тип узла" —
  это узлы с **собственной панелью конфигурации** и
  **runtime-состоянием** (БД, индекс).
- **Возможные решения:**
  1. Расширить `NodeData` до discriminated union с полем `config`
     для сервисных узлов.
  2. Ввести `NodeCapabilities` (persistence, external_state,
     user_config) — engine учитывает при валидации.
- **Когда чинить:** v0.8+ (после базовых узлов).
- **Связанные:** KI-121, KI-127.

---

### KI-364 — Condition sandbox (QuickJS-WASM)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.5, коммит `2b6243c`)
- **Fix:** QuickJS-WASM (`quickjs-emscripten`) в `QuickJsRunnerService`:
  timeout 100 мс, memory 16 МБ, allowlist глобалов;
  `ConditionNodeData.mode: 'dsl' | 'sandbox'` (default `'dsl'`) —
  обратная совместимость с MVP-DSL. 26 тестов.
- **Остаток:** allowlist расширен до 14 имён сверх DESIGN § 3.5 — KI-395.
- **Файлы:** `src/engine/node-executors.ts` (executeConditionNode),
  `web/src/components/nodes/ConditionNode.tsx`,
  `web/src/types/graph.ts` (ConditionNodeData.mode),
  `src/sandbox/quickjs-runner.service.ts`
- **Описание:** Condition-узел поддерживает только MVP-DSL (`>`, `<`, `===`,
  `includes`). Произвольные JS-выражения (`input.value > 100 &&
  input.name.includes('foo')`) невозможны без изоляции. `new Function` —
  RCE; `vm2` — deprecated (CVE-2023-29017); `isolated-vm` — native build
  сложен на Windows + Docker; Node `vm` — небезопасен.
- **Решение:** QuickJS-WASM (`quickjs-emscripten`), проверенная модель
  Figma/Cloudflare/Shopify. Timeout 100 мс, memory 16 МБ, allowlist глобалов.
  Обратная совместимость с MVP-DSL через `ConditionNodeData.mode:
  'dsl' | 'sandbox'` (default `'dsl'`). Реализация — DESIGN v0.9 § 3.5 (R7.5).
- **Связанные:** KI-282, KI-283, KI-338, DESIGN v0.9 § 2.8, § 3.5.

---

### KI-465 — `data.title` игнорируется в Markdown-режиме `document_gen` (Low)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.12.0 (S1) | **Обнаружено:** 2026-10-18
- **Запланировано:** v0.10.x
- **Файлы:** `src/engine/node-executors.ts`,
  `src/documents/document.service.ts`
- **Описание:** в JSON-режиме `data.title` добавляется в документ (если в JSON
  нет своего `title`), а в Markdown-режиме поле молча не используется:
  `generateDocxFromMarkdownAsync` принимает только строку, а `parseMarkdown`
  не заполняет `DocumentModel.title`. UI S6 поля `title` не показывает, но
  значение может прийти из API/старого графа.
- **Решение:** либо поддержать `title` в Markdown (H1/титульный параграф), либо
  явно отклонять непустой `title` в Markdown-режиме; сейчас — задокументированное
  ограничение.
- **Связанные:** DESIGN v0.10 § 3.2.1.

---

### KI-214 — Нет индекса `workflows(user_id)`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/db/schema.ts`, `drizzle/`
- **Описание:** Owner-подзапрос в `getRunAsync` (`inArray(workflowId,
  select id from workflows where user_id = $1)`) сканирует таблицу —
  индекса на `workflows.user_id` нет.
- **Решение:** partial или обычный индекс на `workflows(user_id)`.
- **Когда чинить:** v0.8.x (при росте числа workflow).
- **Связанные:** KI-202.

---

### KI-421 — АвтоINSTANCE_ID нестабилен при пересоздании контейнера
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.11.1 (S1) | **Обнаружено:** 2026-10-18
- **Файлы:** `src/runs/runs.worker-options.ts`
- **Описание:** `hostname:PORT` меняется в Docker/K8s при пересоздании.
- **Решение:** явный `INSTANCE_ID` в манифесте.
- **Связанные:** KI-387, KI-391.

---

### KI-239 — Модалка не предупреждает о перевыпуске share-токена
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/ShareModal.tsx`
- **Описание:** Backend не отдаёт существующий `share_token` в
  `GET /workflow/:id`; после F5 состояние `shareToken=null`, повторное
  «Создать ссылку» **молча инвалидирует старую**. Нет предупреждения
  и нет режима «Обновить ссылку».
- **Решение:** либо сохранять токен в localStorage на клиенте (с
  TTL), либо backend-эндпоинт `GET /workflow/:id` возвращает
  `share_token` владельцу; в UI — подтверждение «Перевыпустить?
  Старая ссылка перестанет работать».
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-197, KI-237.

---

### KI-019 — RedisModule не проверяет доступность Redis на старте
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/redis/redis.module.ts`
- **Описание:** ioredis ретраит в фоне, приложение поднимается при мёртвом
  Redis. Ошибка всплывёт только на первой публикации / первом job'е.
  Fail-fast сейчас только по env (validateEnv).
- **Решение:** `onModuleInit` → `await redis.ping()` с таймаутом.
- **Когда чинить:** R2.2 или вместе с KI-011 (e2e в CI).
- **Связанные:** KI-011.

---

### KI-104 — Повтор узла учитывает только LLM-исключения
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S10) | **Обнаружено:** 2026-10-14
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** В `executeNodeAsync` условие повтора:
  `error instanceof LlmProviderException && error.retryable`. Для
  media-узла временная ошибка (429/5xx/таймаут, где
  `MediaProviderException.retryable = true`) повтора **не получит** —
  узел сразу `failed`. Поле `retryable` у media **декоративно**.
- **Решение:** обобщить на «провайдерская ошибка с `retryable`»:
  общий интерфейс / бренд (`LlmProviderException`,
  `MediaProviderException`).
- **Когда чинить:** v0.6.0b.2.3 или отдельным микро-шагом.
- **Связанные:** KI-036.

---

### KI-319 — CI: шаг `Apply migrations` стал обязательным
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `ca21f30`)
- **Файлы:** `.github/workflows/ci.yml`
- **Описание:** Job build годами шёл без `db:migrate`, БД сервиса
  пустая; новый шаг — предпосылка для KI-298-гейта и всех будущих
  DB-интеграционных спеков.
- **Решение:** зафиксировать в RULES/PROMPT; при росте числа
  DB-спеков — вынести в отдельный job.
- **Fix:** RULES § 3.19 — «новый DB-интеграционный spec опирается на шаг
  Apply migrations в CI»; § 8 — v1.8.0.
- **Связанные:** KI-298, KI-317.

---

### KI-133 — Статусные/notice-цвета вне узлов остаются палитрой Tailwind
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/TopBar.tsx`
  (`RUN_STATUS_STYLE`), `web/src/components/Toast.tsx`,
  `web/src/components/RunResultPanel.tsx`,
  `web/src/components/LoadModal.tsx` (кнопка «Удалить»),
  `web/src/components/nodes/BaseNode.tsx` (статусные фоны узлов)
- **Описание:** После R5.2 базовые поверхности (background, text,
  border, node-bg) темизированы, но статусные/notice-цвета остаются
  литеральными (`bg-blue-100/text-blue-700`, `bg-red-50`,
  `bg-emerald-50`, `bg-blue-50/bg-green-50/bg-red-50` для узлов).
  Читаемы в обеих темах, но выглядят как «светлые чипы» на тёмном
  UI. `--color-node-pending/running/completed/failed` уже заведены
  в `theme.css`, но используются не везде.
- **Когда чинить:** R5.3 (i18n) — вместе с канонизацией статусов.
- **Связанные:** KI-125, KI-132.

---

### KI-313 — Смоук-чек-лист: `/unknown/foo → 404` верен только для fetch
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `docs/development/SMOKE_CDP.md` (нет) или заметки
- **Описание:** Для не-HTML запросов Vite отдаёт 404, для навигации
  документа (`Accept: text/html`) — SPA-fallback 200 text/html
  (штатное поведение `appType: 'spa'`). Ожидание в промпте было
  неверным.
- **Решение:** уточнить в заметках.

---

### KI-219 — `refresh_tokens` не хранит контекст отзыва
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/db/schema.ts`
- **Описание:** У `revoked_at` нет `reason` / IP / user-agent — при
  разборе инцидента непонятно, кто и почему отозвал (аудит).
- **Решение:** колонки `revoke_reason` (enum: 'logout' / 'rotation' /
  'reuse_detected' / 'admin') + `ip` + `user_agent`.
- **Когда чинить:** при появлении аудита.
- **Связанные:** KI-201, KI-216.

---

### KI-341 — «нет выходов» у узла: `null` у skipped vs `{}` у failed
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** `markNodeFailedAsync` не сбрасывает outputs; skipped пишет null.
- **Решение:** привести представление «нет выходов» к единому виду.
- **Связанные:** KI-288.

---

### KI-248 — `reasoningEffort` не сбрасывается при смене модели
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`
- **Описание:** При смене модели на модель без `supportsReasoning`
  поле `data.reasoningEffort` остаётся в графе (backend игнорирует
  через проверку `supportsReasoning`, но в JSON мусор).
- **Решение:** при изменении `data.model` — если у новой модели
  `supportsReasoning !== true` → `updateNodeData(id, { reasoningEffort: undefined })`.
- **Когда чинить:** v0.8.x (при UX-полировке).
- **Связанные:** KI-193, KI-249.

---

### KI-358 — у REST-ответов backend нет Zod: гейт разбирает TS-интерфейсы
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/runs/runs.service.ts`,
  `src/workflow/dto/share-workflow.dto.ts`, `src/runs/dto/api-contract.spec.ts`
- **Описание:** SSE-гейт читает поля из `ZodObject.shape`; REST-ответы,
  кроме `ExportWorkflowDto`, — TS-интерфейсы (`RunResponse`, `ShareTokenDto`,
  `SharedWorkflow`), поэтому backend-гейт KI-352 читает их через
  `ts.createSourceFile`. Хрупче Zod.
- **Решение:** завести Zod-схемы ответов (`RunResponseSchema` и т.д.),
  вывести типы через `z.infer`, заменить AST на `ZodObject.shape`.
- **Связанные:** KI-352, KI-348.

---

### KI-556 — NOT NULL включается backfill-скриптом, а не SQL-миграцией
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `drizzle/0014_heavy_iron_patriot.sql`, `migrate.ts`,
  `src/db/migrations/backfill-organizations.ts`
- **Описание:** миграция 0014 добавляет `organization_id` **nullable** (иначе
  `ADD COLUMN ... NOT NULL` без DEFAULT упал бы на непустой БД), а `SET NOT NULL`
  выполняет `backfillOrganizationsAsync` из `migrate.ts` после заполнения.
  `pnpm db:migrate` (RULES 3.10, `docker-entrypoint.sh`, CI) всегда делает оба
  шага, но прямой `drizzle-kit migrate`/`db:push` в обход `migrate.ts` оставит
  колонки nullable, а snapshot Drizzle будет считать их NOT NULL.
- **Решение:** использовать только `pnpm db:migrate`; расхождение ловит
  parity-гейт KI-298 (CI). При необходимости автономности миграции — перенести
  backfill в SQL-миграцию в следующем релизе.
- **Связанные:** KI-298, RULES 3.10/4.29/4.30, KI-552.

### KI-524 — Список операций `image_tool` продублирован в UI
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/media/image-tool.ts`, `web/src/types/graph.ts`
- **Описание:** backend `IMAGE_TOOL_OPERATIONS` и UI
  `UI_IMAGE_TOOL_OPERATIONS` — два независимых списка. `chromakey` скрыт
  только в UI (KI-418), поэтому backend обязан и дальше принимать старые
  значения; при появлении модели её нужно добавить в оба места.
- **Решение:** генерировать UI-список из общего контракта (OpenAPI/JSON-схема)
  либо добавить тест-паритет на совпадение наборов.
- **Связанные:** KI-121, KI-418.

---

### KI-299 — Vite-прокси не знает префикс `/templates`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.0e (R6.6.2, `27cbc14`) — точечно; **v0.8.1**
  (коммит 39b6851) — структурно.
- **Fix:** см. KI-072.
- **Связанные:** KI-072, KI-120.
- **Файлы:** `web/vite.config.ts`, `src/templates/*`
- **Описание:** R6.6.1 добавил `GET /templates` и
  `POST /templates/:id/instantiate`, но список прокси в
  `web/vite.config.ts` остался ручным (KI-072 → `/llm`, KI-120 →
  `/media`). Запрос уходил в SPA-fallback Vite (`200 text/html`),
  Zod-разбор падал, вкладка «Шаблоны» показывала ошибку.
  Ловится только смоуком — unit-тесты зелёные.
- **Fix:** добавлен префикс `'/templates': 'http://localhost:3000'`.
- **Остаток:** структурный фикс — единый `/api`-префикс (v0.8.1).
- **Связанные:** KI-072, KI-120, KI-108, KI-109.

---

### KI-541 — F5 после открытия старого запуска из истории не восстанавливает панель
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/RunHistoryModal.tsx`, `web/src/stores/workflow.ts`,
  `web/src/lib/url-sync.ts`
- **Описание:** Клик по запуску вызывает `restoreRunAsync`, но `?runId=` в адрес
  он не пишет (это делает только `startRunAsync`), а для **завершённого**
  запуска `restoreRunAsync` ещё и удаляет параметр (KI-271: «подписываться не на
  что»). Поэтому после F5 панель результата пуста — для любого статуса, включая
  `pending`/`running`: параметра из истории нет вовсе. История делает это
  заметным: клик по старому запуску → обновление страницы теряет выбор.
- **Решение:** после восстановления терминального запуска из истории писать
  `?runId=` заново (и не чистить его в `restoreRunAsync` при `initial restore`),
  либо завести отдельный параметр `?historyRunId=`.
- **Реализовано в v0.16 S1:** `RunHistoryModal` при клике вызывает
  `setRunIdInUrl` (`history.replaceState`) и `restoreRunAsync(runId, {
  preserveRunIdInUrl: true })`. `restoreRunAsync` с этим флагом не удаляет
  `?runId=` у терминального запуска (и выставляет его, если параметра нет);
  `loadWorkflowAsync` на F5 восстанавливает запуск с тем же флагом. Проверено
  unit-тестами модалки и стора и CDP-смоуком (клик → F5 → панель на месте).

### KI-136 — `:focus` vs `:focus-visible` в инпутах узлов
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/nodes/*.tsx`,
  `web/src/components/TopBar.tsx`
- **Описание:** После R5.2.2/R5.2.3 фокус инпутов — `:focus`
  (`focus:border-primary focus:ring-1 focus:ring-primary`). Ring
  виден при клике мышью и при программном фокусе, не только при
  навигации с клавиатуры. Для инпутов это обычно ожидаемо, но
  не соответствует современным a11y-рекомендациям (обычно
  `:focus-visible` для ring, `:focus` для бордера).
- **Возможные решения:**
  1. Оставить `:focus` (текущее) — привычно, просто.
  2. `focus-visible:ring-1 focus-visible:ring-primary` для ring +
     `focus:border-primary` для бордера.
  3. Полный переход на `focus-visible` — только клавиатура.
- **Когда чинить:** R5.3 или v0.8 (при a11y-аудите).
- **Связанные:** KI-125, KI-132.

---

### KI-366 — `type: 'TOOL'` у upstream не существует
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (docs, DESIGN v0.9 § 2.4/§ 3.1)
- **Fix:** DESIGN обновлён: `TOOL` — семантический маркер, upstream его не
  отдаёт; инструменты резолвятся model-first через IMAGE/VIDEO-модели с
  обязательным входным слотом. Код сохраняет `TOOL` только как внутренний
  тип, что соответствует обновлённому контракту.
- **Файлы:** `docs/development/v0.9/DESIGN_V09_FEATURES.md` (§ 2.4, § 3.1),
  `src/media/image-tool.ts`, `web/src/lib/media.ts`
- **Описание (историческое):** DESIGN § 2.4/3.1 предполагал
  `type: 'TOOL'`, но `GET /api/v2/media/models?type=TOOL` →
  `{ code: 0, models: [] }`. Инструменты CreativeLab — обычные
  IMAGE/VIDEO-модели с обязательным входным слотом (bgremover, faceswap,
  kling-lipsync, @VideoEdit). Смягчено фолбэком (`toolModels` = TOOL ∪
  модели с обязательным входом).
- **Решение:** обновить DESIGN v0.9 § 2.4/3.1 — заменить `type: 'TOOL'`
  на «model-first, роль инструмента задаёт operation».
- **Связанные:** KI-367, KI-382, DESIGN v0.9 § 2.4, § 3.1.

---

### KI-390 — Бандл web 734.19 kB → порог Vite 730 → 750 kB
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.3
- **Fix:** основной чанк уменьшен до ~141 kB после route-level code-split
  (KI-008); порог предупреждения Vite больше не достигается.
- **Файлы:** `web/vite.config.ts`
- **Описание:** Три узла media-генерации и зеркала контрактов дали +23 kB
  (711.08 → 734.19 kB). Системное решение — code-split (KI-008), вошло в v0.9.3.
- **Связанные:** KI-008, KI-373.

---

### KI-404 — семантика VectorUpsert → VectorQuery
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/engine/node-executors.ts`
- **Описание:** `VectorQuery` получает `inputs.prompt = {result:{id,
  collection}}` от `VectorUpsert` → эмбеддит JSON вместо исходного текста
  (score 0.33). Механика верна, но семантика цепочки нелогична.
- **Решение:** `VectorUpsert` должен отдавать
  `output: {collection, id, text}` (или не соединять его напрямую
  с `VectorQuery` в типовом шаблоне).
- **Связанные:** KI-128, DESIGN v0.9 § 3.4.

---

### KI-233 — Публичный share отдаёт nodes/edges целиком
- **Приоритет:** 🟡 Medium | **Статус:** Won't Fix | **Обнаружено:** 2026-10-15
- **Причина (Won't Fix):** принятый риск R6.2.2: граф целиком — объект
  шаринга. Санитизация/whitelist отклонена, чтобы не терять UI-поля
  React Flow; в `ShareModal` добавлено предупреждение `share.warning`.
- **Файлы:** `src/workflow/workflow.service.ts` (`findSharedAsync`),
  `src/workflow/workflow-share.controller.ts`, `web/src/components/ShareModal.tsx`
- **Описание:** Публичный `GET /workflow/share/:token` отдаёт
  `nodes`/`edges` целиком. Если в `data` узлов лежат промпты, тексты
  или (теоретически) ключи/URL с токенами — всё уедет наружу.
- **Решение:** либо санитизация/whitelist полей (риск потери
  UI-полей React Flow), либо явное решение «граф целиком — объект
  шаринга» + предупреждение в UI. **Принято: второе** (решение R6.2.2, в DESIGN § 4 явно не зафиксировано);
  в R6.2.2 добавлено предупреждение в модалку.
- **Когда чинить:** — (решение принято, не планируется).
- **Связанные:** KI-197, KI-105.

---

### KI-090 — oxlint warning в `web/src/lib/api.ts` (pre-existing)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/lib/api.ts`
- **Описание:** `typescript/no-misused-spread` — `...options.headers`
  в `requestAsync`. `HeadersInit` может быть массивом, спред
  массива в объект разложится в индексы. Предупреждение
  существовало **до** v0.6.0a (проверено через `git show`).
- **Решение:** нормализовать заголовки через `new Headers(...)` или
  `Object.fromEntries`, либо сузить тип `options` до
  `{ headers?: Record<string, string> }`.
- **Когда чинить:** v0.6.0b.
- **Связанные:** —

---

### KI-120 — Vite proxy: `/media` забыт при добавлении узла Image Generation
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.0b.2.5 (точечно), **v0.8.1** (структурно, коммит 39b6851)
- **Fix:** см. KI-072 (единый реестр + генерация proxy + паритет-тесты).
- **Связанные:** KI-072, KI-299.
- **Файлы:** `web/vite.config.ts`
- **Описание:** При добавлении узла Image Generation (v0.6.0b.2.3)
  не добавили `/media` в Vite proxy. UI получал HTML (SPA fallback)
  со статусом 200, `requestAsync` падал на `JSON.parse`, селект
  оставался disabled с «Нет доступных image-моделей».
- **Fix:** `'/media': 'http://localhost:3000'` в proxy.
- **Структурное решение:** закрыть **KI-072** — единый префикс
  `/api` или общий список префиксов.
- **Связанные:** KI-072.

---

### KI-262 — `canBeInsertedOnEdge` не проверяется против фактических Handle
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/lib/node-registry.ts`,
  `web/src/components/nodes/*.tsx`
- **Описание:** Поле `canBeInsertedOnEdge` — ручное знание о портах;
  `tsc` гарантирует только наличие поля, но не согласованность с
  `Handle` внутри компонента. Если из `TextNode` добавят/уберут
  target-handle — реестр об этом не узнает.
- **Решение:** автотест с рендером узла (jsdom, KI-155) или вывод
  handles из одного места.
- **Связанные:** KI-259, KI-155.

---

### KI-174 — Yandex AI Studio: env-формат каталога моделей
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.2-pre (коммит `ed945cd`)
- **Файлы:** `src/llm/llm-provider.factory.ts` (`YANDEX_MODELS`),
  `.env.example`, `src/config/env.schema.ts`
- **Описание:** v0.7.1 (KI-159) захардкодил список моделей Yandex
  в фабрике (`yandexgpt-lite`, `yandexgpt`, `yandexgpt-32k`). Это
  ломается сразу:
  1. **Потеряна реальная `qwen3.6-35b-a3b/latest`** — модель есть
     в Yandex AI Studio и поддерживает vision (см. пользовательский
     конфиг: `gpt://b1gufspraeh2i5nin6nt/qwen3.6-35b-a3b/latest`).
     В KI-159 решили, что это «выдуманный id» — ошибочно.
  2. **Yandex AI Studio обновляет каталог**: там уже DeepSeek V4
     Flash, Alice AI LLM, Qwen3.6-35B. Хардкод нужно править каждый
     раз.
  3. Пользователь сам знает свой folder и модели — env-формат
     лучше.
- **Fix:** каталог переведён в `YANDEX_MODELS` (формат
  `<id>[:<модальности>]` через запятую). Парсер `parseYandexModels`
  понимает полный URI `gpt://<folder>/<model>/<version>`, короткое
  имя (`yandexgpt-lite` → `/latest`) и имя с версией
  (`yandexgpt-lite/latest` — версия не дублируется); короткие id без
  `YANDEX_FOLDER_ID` пропускаются с предупреждением. Без
  `YANDEX_MODELS` работает дефолт (`yandexgpt-lite` + `yandexgpt`),
  а без folder_id провайдер не регистрируется.
- **Отменяет:** KI-172.
- **Когда чинить:** — (закрыто, v0.7.2-pre)
- **Связанные:** KI-159, KI-172, KI-175, KI-176, KI-088.

### KI-026 — Нет таймаута и отмены выполнения
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`, `src/engine/node-executors.ts`
- **Описание:** `runNode` синхронный, `AbortSignal` не прокинут. Статус
  `cancelled` есть в схеме, но перевести в него запуск нечем (RULES 4.19).
- **Когда чинить:** до R3 (LLM-вызовы) и до R4 (кнопка Stop).
- **Связанные:** KI-024.

---

### KI-226 — Красный 401 в консоли на неаутентифицированном заходе
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/auth/auth.controller.ts` (POST /auth/refresh),
  `web/src/components/auth/AuthProvider.tsx`
- **Описание:** Bootstrap-refresh без cookie → backend 401 → красная
  строка в консоли. Убрать нельзя (cookie httpOnly).
- **Решение:** принять как косметику, либо отдавать 204/200 с
  `{ user: null }` для «нет сессии».
- **Когда чинить:** при полировке.
- **Связанные:** KI-201.

---

### KI-437 — Web-зеркало ролей: `owner` протекает в инвайт
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.2 (ограничение invite-роли)
- **Файлы:** `web/src/types/collaborator.ts`
- **Описание:** после закрытия KI-399 `owner` появился в зеркале ролей
  (`CollaboratorRoleSchema`), но тот же enum остался у
  `InviteCollaboratorPayloadSchema`. Из-за этого UI пропускал `role: 'owner'` в
  `POST /workflow/:id/collaborators`, хотя backend-инвайт допускает только
  `viewer`/`editor` (`src/workflow/dto/collaborator.dto.ts`): запрос уходил и
  падал на валидации. Вдобавок JSDoc над enum утверждал, что «владелец в этом
  списке отсутствует», хотя `owner` уже был добавлен — комментарий врал и
  подталкивал к повторному «исправлению» enum.
- **Решение:** разделить домены: ответ (`CollaboratorSchema`) —
  `owner`/`viewer`/`editor`, инвайт — только `viewer`/`editor` (как на backend);
  JSDoc синхронизировать с фактическим списком.
- **Fix:** `InviteCollaboratorPayloadSchema.role` ограничен
  `z.enum(['viewer', 'editor'])`, `CollaboratorSchema` продолжает принимать
  owner-строку; JSDoc переписан (коммит `de15562`).
- **Связанные:** KI-399, KI-397, KI-440.

---

### KI-279 — compare без контракта: fallback по targetHandle
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-ports.ts`, `src/engine/node-executors.ts`
- **Описание:** `compare` намеренно не имеет записи в `NODE_PORT_CONTRACT`
  (KI-278). `inferDefaultOutputPort('compare') → 'output'`,
  `inferInputPortName('compare') → 'input'`. Работает только за счёт
  fallback `targetHandle → sourceHandle → edge.id`. Если UI пришлёт
  связи без `targetHandle`, операнды `a`/`b` схлопнутся.
- **Решение:** закрыть вместе с KI-278.
- **Связанные:** KI-278, KI-035.

---

### KI-566 — Мутирующие `/auth/*` (login/register/refresh/logout) не аудируются
- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** v1.0.0 (S5) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/audit.interceptor.ts`, `src/auth/auth.controller.ts`
- **Описание:** DESIGN § 2.2 перечисляет Login среди аудируемых действий, но
  глобальный интерсептор пропускает `/auth/*`: на `register/login` в момент
  интерсептора нет `request.user` (автор ещё не аутентифицирован), а тело
  содержит пароль/refresh-токен. Аудит входа/выхода требует сервисного вызова
  внутри `AuthService` (после проверки пароля, с `userId`/`orgId` из строки
  пользователя), а не HTTP-интерсептора. В S3 смоук подтвердил: строк с
  `auth.*`/`http.post` в журнале нет.
- **Решение:** в S5 добавить `AuditService.recordAsync` в `AuthService`
  (`auth.login`, `auth.register`, `auth.logout`, при необходимости
  `auth.refresh`), писать только `userId`/`orgId` и результат (без пароля,
  токенов и email в metadata либо с маскированием). Отдельно — аудит
  неудачных входов (KI-569).
- **Связанные:** DESIGN v1.0 § 2.2, KI-569, S5.

### KI-054 — Нет агрегата по запуску
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/schema.ts` (`workflow_runs`),
  `src/engine/execution-engine.service.ts`
- **Описание:** `workflow_runs` не хранит суммарные
  `tokens_in`/`tokens_out`/`cost_usd` — UI (R4) придётся каждый раз
  считать `SUM` по `node_runs`; для списка запусков это N+1-запросы.
- **Решение:** денормализованный агрегат, обновляемый в
  `finishRunAsync`.
- **Когда чинить:** R4.
- **Связанные:** KI-038.

---

### KI-134 — Ловушка Tailwind v4: `color-mix()` вне `@theme`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `1c3d948`, RULES 4.32)
- **Файлы:** `docs/development/RULES.md` (§ 4.32),
  `web/src/styles/theme.css`
- **Описание:** `color-mix()` со ссылкой на `var(--color-*)` **вне
  блока `@theme`/`.dark`** эмитится Tailwind v4 как невалидный
  `theme(colors.…)` — браузер отбрасывает свойство. Обнаружено при
  попытке задать `--xy-minimap-mask-background-color` через
  `color-mix` в `.react-flow`.
- **Fix:** `--color-canvas-mask` объявлен отдельной переменной
  внутри `@theme`/`.dark`; в `.react-flow` используется
  `var(--color-canvas-mask)`. Правило зафиксировано в RULES 4.32.
- **Связанные:** KI-125.

---

### KI-097 — GPTunnel-модели не валидируются на старте
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-provider.factory.ts`
- **Описание:** `GPTUNNEL_MODELS` — ручной список; может разойтись
  с upstream (опечатка в id → 404 только при вызове). ~200 моделей
  и отсутствие metadata о vision.
- **Решение:** автоподтягивание `GET /v1/models` при старте + env
  override. Требует решения про сеть/задержку.
- **Когда чинить:** v0.7.0.
- **Связанные:** KI-098.

---

### KI-380 — OpenAI Images не поддерживает applyToolAsync
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.11.1 (S2) — отчёт
  [S2-openai-images.md](development/reports/v0.11.1/S2-openai-images.md).
- **Файлы:** `src/media/providers/openai-images.provider.ts`,
  `src/media/providers/openai-images.provider.spec.ts`, DESIGN v0.9 § 3.1/§ 3.8
- **Описание:** `/v1/images/edits` требует `multipart/form-data` с файлом, а
  `IMediaProvider.applyToolAsync` принимает URL. Passthrough через
  `createTaskAsync` — не upscale, а «перерисуй по описанию».
- **Fix:** метод скачивает вход в буфер (лимит 25 МБ, проверка формата
  PNG/JPEG/WebP), собирает `FormData` с `image` (Blob), `prompt`, `model` и
  скалярными параметрами и отправляет POST в `/v1/images/edits`. Ответ
  разбирается тем же `toTaskResult`, что и генерация, — поддерживаются и
  `url`, и `b64_json`. Работают `upscale` и `bg_removal`; для остальных
  операций и для `dall-e-3` — понятная ошибка до платного запроса.
  Идемпотентность сохраняется в памяти по `idempotencyKey`.
- **Связанные:** KI-371, KI-378, KI-525, DESIGN v0.9 § 3.8.

---

### KI-051 — Кэш ограничен одним `runId`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Повторный запуск того же workflow (кнопка Re-run в R4)
  выполнит все узлы заново, хотя граф и входы не менялись.
- **Решение для R4:** опционально переиспользовать `node_runs`
  последнего успешного запуска (с явным инвалидированием по версии
  графа).
- **Когда чинить:** R4.
- **Связанные:** KI-046.

---

### KI-452 — удаление workflow без подтверждения (High)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 (S0)
- **Файлы:** `web/src/components/LoadModal.tsx`, `web/src/i18n/ru.json`,
  `web/src/i18n/en.json`
- **Описание:** кнопка «Удалить» в списке сохранённых workflow сразу вызывала
  `deleteWorkflowAsync`. Случайный клик необратимо удалял граф, а отмены в UI
  не было.
- **Решение:** перед запросом — `window.confirm` с именем workflow и явным
  предупреждением о необратимости; отмена не трогает список. Текст вынесен в
  оба i18n-файла (`loadModal.delete_confirm`). Вложенный `alertdialog` —
  отдельная задача DESIGN v0.10 § 3.4.3.
- **QA:** `MANUAL_TESTING_GUIDE.md`, кейс CANVAS-18 (ожидаемое поведение
  изменилось: удаление требует подтверждения).

---

### KI-113 — `resolveByModelAsync` перечитывает все модели при каждом вызове
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/media/media-registry.service.ts`
- **Описание:** На каждый `createTaskAsync` / `getTaskAsync` реестр
  зовёт `provider.listModelsAsync()` — первый раз это поход в
  upstream (кэш провайдера TTL 15 мин), дальше — попадание в кэш.
  Но кэш привязан к `type`/`ALL`, а реестр делает вызов без типа
  и не помнит сам результат: `Map<modelId, provider>` не строится.
  При расширении (несколько провайдеров) — N вызовов к N
  провайдерам на каждый task.
- **Решение:** построить `Map<modelId, provider>` в реестре с TTL
  либо один раз при старте модуля.
- **Когда чинить:** при появлении второго media-провайдера.
- **Связанные:** KI-112.

---

### KI-450 — `GET /runs/:id` не отдаёт `node_runs` (дубль KI-077)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — `GET /runs/:id` отдаёт поле `nodes`; исправлено
  вместе с KI-077 (каноническая запись).
- **Дубль:** KI-077 — та же проблема; отдельная запись не ведётся, статус и
  исправление отслеживаются в KI-077. Запись сохранена для истории и ссылок.
- **Файлы:** `src/runs/runs.controller.ts`, `src/runs/runs.service.ts`,
  `src/runs/run-node-snapshots.ts`
- **Описание:** дубль KI-077. `RunResponse` содержит только `id`,
  `workflowId`, `status`, `createdAt`; строки `node_runs` (включая
  `stored_url`/`stored_expires_at`) читаются только в SSE-снимке. Поэтому
  требование «переподписать просроченный `stored_url` в `GET /runs/:id`»
  невыполнимо без расширения REST-контракта; переподпись реализована в
  `toNodeSnapshot` SSE (KI-443).
- **Решение:** либо расширить `RunResponse` полем `nodes` (синхронизировать
  `docs/development/api-contract.json` и `web/src/lib/api.ts`), либо добавить
  отдельный `GET /runs/:id/nodes`; затем использовать
  `IMediaStorage.refreshStoredUrlAsync`.
- **Связанные:** KI-077, KI-443.

---

### KI-187 — Комментарии/аннотации на холсте
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.2a + fix, коммиты 9c560cf + 55beb6d)
- **Fix (R6.4b.2a, frontend):** тип узла `comment`, `CommentNode`
  (стикер без Handle), хоткеи C / Shift+C.
- **Fix (R6.4b.2a-fix, backend):** `ANNOTATION_NODE_TYPES` +
  фильтр в `buildExecutionPlanAsync` — комментарии персистятся
  (Save → F5 → восстановление), но не участвуют в Run.
- **Связанные:** KI-188, KI-194, KI-266, KI-269.
- **Fix (R6.4b.2a, коммит `9c560cf `):** тип узла `comment`,
  `CommentNode` (стикер без Handle), хоткеи C / Shift+C,
  `lib/graph-payload.ts` (фильтр local-only).
- **Остаток (R6.4b.2a-fix):** KI-266 — персистить комментарии
  на backend (фикс `ExecutionEngineService`, откат local-only).
- **Связанные:** KI-188, KI-194, KI-266.
- **Файлы:** `web/src/components/Canvas.tsx`, `web/src/stores/workflow.ts`
- **Описание:** GPTunnel позволяет оставлять текстовые заметки на
  холсте (C). У нас нет.
- **Решение:** тип узла `comment` (или отдельный слой annotations);
  i18n; сохранение в workflow.
- **Когда чинить:** v0.8.
- **Связанные:** KI-194.

---

### KI-163 — Узел нельзя удалить с клавиатуры
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `9d2f6bf`)
- **Файлы:** `web/src/components/Canvas.tsx`, `web/src/stores/workflow.ts`,
  `web/src/components/nodes/BaseNode.tsx`
- **Описание:** Та же причина, что у KI-162: `Delete` не была заведена, поэтому
  выделенный узел не удалялся. Плюс удаление было доступно только с клавиатуры —
  кнопки на узле не существовало.
- **Fix:** добавлен `removeNode` (узел вместе со всеми его связями, чтобы не
  оставалось висячих рёбер) и вызывается из `onNodesDelete`; в шапке `BaseNode`
  появилась кнопка «×» (hover, `nodrag`, `aria-label`).
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-162, KI-164.

---

### KI-553 — Старые access-JWT без `orgId` получают 401 до истечения срока
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/auth/guards/jwt-auth.guard.ts`, `src/auth/auth.service.ts`
- **Описание:** DESIGN § 4 объявляет инвалидацию старых JWT (меняется payload).
  После выката v1.0.0 access-токен, выпущенный до релиза, получает 401 на
  любом защищённом маршруте. Сессия восстанавливается без пароля:
  `POST /auth/refresh` ротирует httpOnly refresh-cookie и выдаёт access с
  `orgId`; если refresh-cookie отсутствует/истекла — нужен повторный вход.
  Пока UI не научится 401 → refresh → редирект, пользователь видит 401.
- **Решение:** оставить как есть (соответствует DESIGN § 4); в S5 добавить
  UI-обработку 401 (попытка `POST /auth/refresh`, затем экран входа).
- **Связанные:** DESIGN v1.0 § 3.1/§ 4.

### KI-503 — `cacheSavingsUsd` агента не в SSE
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/runs/run-node-snapshots.ts`
- **Описание:** `node_completed` для агента не содержит `cacheSavingsUsd`, в отличие от LLM-узлов.
- **Решение:** передать модель в `AgentNodeMetrics` или считать экономию в движке.

---

### KI-040 — Job-level retry (BullMQ) сейчас no-op для терминальных запусков
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/runs/runs.processor.ts`,
  `src/engine/execution-engine.service.ts`
- **Описание:** `RunsProcessor.process()` пропускает любую доставку,
  если запуск не `pending` и не stale (guard KI-023), а `executeAsync`
  перед пробросом из KI-036 уже ставит `status='failed'`. BullMQ честно
  ретраит job (`attempts: 3`), но граф **не переигрывается** — «последний
  рубеж» декоративен. Длительная (десятки секунд) недоступность
  провайдера всё равно убивает запуск.
- **Возможные решения:**
  1. Разрешить переигрывание при `job.attemptsMade > 0` — идемпотентность
     обеспечена UPSERT из KI-031.
  2. Оставить как есть и зафиксировать, что восстановление — только
     node-level.
- **Когда чинить:** микро-шаг перед R4.
- **Связанные:** KI-016, KI-023, KI-031, KI-036.
- **Fix:** `RunsProcessor.process()` — `isJobRetry =
  job.attemptsMade > 0 && run.status === 'failed'`. Guard расширен:
  `pending || isStale || isJobRetry`. Плюс `markRunRunningAsync`
  сбрасывает `error: null, finishedAt: null` (баг из п.4: retry
  оставлял старые error/finished_at). +5 тестов. Smoke с реальным
  BullMQ retry (backoff 2s/4s, 3 прогона графа, UPSERT идемпотентен).
- **Остаток:** KI-046 (весь граф переигрывается, включая завершённые
  LLM-узлы — платно), KI-047 (UPSERT не сбрасывает outputs/duration_ms),
  KI-048 (нет предохранителя по стоимости).

---

### KI-291 — `workflows.version` не переносится в артефакт экспорта
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/workflow.service.ts` (`EXPORT_FORMAT_VERSION`)
- **Описание:** В артефакте `version` — версия **формата** (z.literal(1)),
  не колонка БД `workflows.version`. Экспорт→импорт теряет колонку;
  при `version = 2` в БД файл стал бы неимпортируемым, если бы
  использовался как версия артефакта.
- **Решение:** отдельное поле для версии колонки, если понадобится.
- **Связанные:** KI-108.

---

### KI-349 — `TextNode` без target-handle при контракте `text-input`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/components/nodes/TextNode.tsx`, `src/engine/node-ports.ts`
- **Описание:** Связь «в text-узел» рисуется висячей (36 warning React Flow в смоуке B2), хотя планировщик вход видит.
- **Решение:** добавить target-handle `text-input` (или убрать из контракта).
- **Связанные:** KI-030, KI-301.

---

### KI-564 — Нет DB-инварианта «организация workflow = организация владельца»
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`
- **Описание:** `workflows.organization_id` и `users.organization_id` берутся
  из одного access-токена при создании (`createAsync`), но FK/CHECK/триггера,
  гарантирующего их совпадение, нет: прямой SQL или будущая миграция может
  оставить workflow в чужой организации. Изоляция при этом не ломается (все
  выборки фильтруют по `workflows.organization_id`), но владелец потеряет
  доступ к своему графу, а организация-хранитель получит «чужой» граф.
- **Решение:** при появлении смены организации/переносов — проверка в сервисе
  либо триггер `BEFORE INSERT/UPDATE` на `workflows`; либо зафиксировать
  инвариант приложения и покрыть интеграционным тестом.
- **Связанные:** KI-558, KI-560.

---

## v1.0.0 — Audit Logs (S3, 2026-11-02)

### KI-393 — `pricing.plus` и `expr.units`-объекты не учитываются
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/runs/cost-budget.service.ts`
- **Описание:** составные доплаты (`base`/`unitsSum`/`tierRates`) у `krea-3`,
  `minimax-h3-max`, `seedance-2-5` и `expr.units`-объекты у `flux-2-pro` не
  считаются → недооценка бюджета.
- **Решение:** парсить `plus` и `expr`-объекты (или фолбэк на `price` +
  `margin`).
- **Связанные:** KI-384, KI-392.

---

### KI-229 — `syncWorkflowUrlParam` через `history.replaceState` — роутер не знает
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/TopBar.tsx` (`syncWorkflowUrlParam`)
- **Описание:** Функция использует `history.replaceState` → роутер
  о новом search не знает: после Save `useSearchParams()` отдаёт
  старое значение. Сейчас безвредно (граф уже в сторе), но ловушка
  для будущих фич.
- **Решение:** использовать `navigate(..., { replace: true })`
  react-router (с сохранением текущего search), а не `replaceState`.
- **Когда чинить:** при следующей правке TopBar.
- **Связанные:** KI-228.

---

### KI-053 — Стоимость неудачных попыток теряется
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/llm/llm-node-executor.service.ts`
- **Описание:** В `node_runs` попадают метрики только **последней**
  попытки. Node-level retry (KI-036) и job-level replay (KI-040/046)
  сжигают токены, которые нигде не учтены, — фактическая стоимость
  запуска недооценивается тем сильнее, чем больше повторов.
- **Решение:** аккумулировать метрики по попыткам (структурно в
  `logs` или отдельной таблицей `node_run_attempts`).
- **Когда чинить:** R4 (метрики + биллинг).
- **Связанные:** KI-036, KI-040, KI-046, KI-052.

---

### KI-333 — web/ без lint-скрипта и без oxlint в package.json
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/package.json`
- **Описание:** `cd web && pnpm exec oxlint --type-aware src/` падает; фронт вне линт-гейта.
- **Решение:** добавить `lint`-скрипт и oxlint в devDependencies `web/`, включить в CI.
- **Связанные:** KI-317.

---

### KI-165 — Длинный вывод в панели результата не переносится
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `474a93f`)
- **Файлы:** `web/src/components/RunResultPanel.tsx`
- **Описание:** Вывод узла рендерился в `<pre>` без переноса: длинный промпт или
  URL уезжал за правую границу панели и обрезался, прочитать ответ модели было
  невозможно.
- **Fix:** к `<pre>` добавлены `whitespace-pre-wrap break-words` — текст
  переносится по словам с разрывом длинных токенов, монопространственный вид
  (`font-mono`) сохранён.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-077.

---

### KI-386 — Метаданные результата музыки/аудио теряются на схеме задачи
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/media/dto/media-task.dto.ts`, `src/media/dto/media-task.mapper.ts`,
  `web/src/types/media.ts`
- **Описание:** `MediaTaskResponseSchema.result` объявлен как
  `z.array(z.object({ url }))` без `passthrough`, поэтому реальные поля
  `duration`, `title`, `cover_url`, `lyric`, `tags` (ответ `grom-zvuk`)
  отбрасываются. UI не может показать обложку, длительность и текст песни.
- **Решение:** `passthrough()` в схеме + новые поля `MediaTaskResult`
  (`durationSec`, `coverUrl`, `title`) и их запись в `node_runs.outputs`.
- **Связанные:** KI-361, KI-362, R7.2.

---

### KI-332 — TTL кэша workflow-list не видит изменений из другой вкладки
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/lib/workflow-list-cache.ts`
- **Описание:** TTL проверяется только в момент запроса; без refetch по focus/visibilitychange.
- **Решение:** инвалидация по `focus`/`visibilitychange` либо `BroadcastChannel`.
- **Связанные:** KI-302.

---

### KI-542 — Offset-пагинация истории сдвигается при появлении новых запусков
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/RunHistoryModal.tsx`, `src/runs/runs.service.ts`
- **Описание:** История листается `LIMIT/OFFSET` по `created_at DESC`. Если между
  страницами добавился новый запуск, `offset`-окно сдвигается: одна запись
  покажется дважды, другая будет пропущена. При активном выполнении графа это
  реальный сценарий.
- **Решение:** keyset-пагинация по `(created_at, id)` (курсор в API вместо
  `offset`); согласовать с KI-540 (индекс под тот же порядок).
- **Реализовано в v0.16 S1:** `RunSummary.cursor` — непрозрачный base64url
  (`{ createdAt, id }`); `RunHistoryQuerySchema` принимает `cursor` вместо
  `offset`; сервис фильтрует `(created_at, id) < (cursor.createdAt,
  cursor.id)` при порядке `created_at DESC, id DESC`; модалка грузит страницы
  кнопкой «Загрузить ещё» по `runs.at(-1).cursor` и дедуплицирует `id`.
  Offset-параметр удалён из контракта. Индекс KI-540 остаётся отдельной
  задачей.

### KI-085 — `z.url()` не ограничивает схему http/https
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.5.0
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** `z.url()` принимает `ftp://`, `ws://` и т.п.
  Требование «валидный URL» выполняется только частично —
  отсекается мусор (`not-a-url`), но не неподходящая схема.
- **Решение:** `z.url({ protocol: /^https?$/ })` или `.refine()`.
- **Когда чинить:** v0.5.0.
- **Связанные:** KI-084.
- **Fix:** `const httpUrl = z.url({ protocol: /^https?$/ })`. Проверено:
  `ftp://`, `ws://`, `not-a-url` — fail. **Остаток:** KI-089
  (deprecated-путь в Zod 4).

---

### KI-504 — Нет теста на env-переопределение retry в движке
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/engine/execution-engine.service.spec.ts`
- **Описание:** Чтение `NODE_RETRY_*` в конструкторе проверяется только дефолтами и Zod-схемой.
- **Решение:** вынести список провайдеров engine-спека в фабрику.

---

### KI-375 — бюджет-бар только при активном run
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/components/TopBar.tsx`
- **Описание:** по DESIGN § 3.1 бар скрывается после финала; итоговая
  сумма видна только через `GET /runs/:id/budget` или панель результата.
- **Решение:** зафиксировать в DESIGN § 3.1 или показывать кратко
  «$X / $Y» после финала.
- **Связанные:** DESIGN v0.9 § 3.1.

---

### KI-292 — `nest build` не копирует `src/templates/*.json` в dist
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `nest-cli.json`, `src/templates/template-loader.service.ts`,
  `Dockerfile`
- **Описание:** `nest build` копирует только `.js`/`.d.ts`; ассеты не
  объявлены. Загрузчик находит шаблоны **фолбэком** на
  `<корень>/src/templates`. В Docker-образе (без `src/`) `GET /templates`
  вернёт пустой список + warning.
- **Примечание (v0.10.0 Docker):** в контейнере проблема снята —
  `Dockerfile` копирует `src/templates` (KI-470), поэтому `GET /templates`
  работает. Для не-Docker `node dist/main` остаётся фолбэк на
  репозиторный `src/templates`; `assets` в `nest-cli.json` всё ещё не
  объявлены. Приоритет понижен до Low.
- **Решение:** `"assets": [{"include": "templates/*.json", "outDir": "dist"}]`
  в `nest-cli.json`.
- **Связанные:** KI-108, KI-470.

---

### KI-485 — `schema-parity` маппит все `PgCustomColumn` в `bytea`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/db/schema-parity.spec.ts`
- **Описание:** Второй custom-тип с другим SQL-типом пройдёт гейт молча.
- **Решение:** брать `column.getSQLType()` или маппинг по `dataType()`.

---

### KI-451 — ключ объекта S3 не хранится в `node_runs`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — media-узлы возвращают `storage_key` в метриках
  шага, движок сохраняет ключ в `node_runs.storage_key`, а снимок
  переподписывает ссылку по ключу, а не по разбору URL (KI-464).
- **Файлы:** `src/db/schema.ts`, `src/media/media-storage.service.ts`,
  `src/media/media-node-executor.service.ts`,
  `src/engine/execution-engine.service.ts`
- **Описание:** при переподписи (KI-443) ключ объекта восстанавливается из
  `stored_url` как path-style `<endpoint>/<bucket>/<runId>/<fileName>`. При
  virtual-hosted style (`<bucket>.endpoint/key`), endpoint с префиксом пути
  или внешнем URL-rewrite ключ извлечь нельзя — ссылка останется истёкшей.
- **Решение:** добавить в `node_runs` колонку `storage_key` (`text`, nullable),
  писать её при сохранении результата и подписывать по ней, а не парсить URL;
  нужна миграция Drizzle (RULES 3.10).
- **Прогресс v0.10 S6:** колонка и миграция есть (S5), `document_gen` пишет в
  неё ключ сгенерированного DOCX; media-узлы ключ по-прежнему не пишут, а
  переподпись идёт по URL — остаток вынесен в KI-464.
- **Связанные:** KI-362, KI-425, KI-443, KI-464.

---

### KI-148 — `cost_usd = null` для локальных провайдеров (LM Studio)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `f200c42`)
- **Файлы:** `src/llm/model-pricing.ts` (`MODEL_PRICING`,
  `calculateCostUsd`), `src/llm/providers/openai-compatible.provider.ts`,
  `src/llm/llm-provider.factory.ts`
- **Описание:** Для локальных провайдеров (LM Studio) моделей нет в
  `MODEL_PRICING` → `calculateCostUsd` возвращал `null` (KI-052,
  корректно — «неизвестно»). Но **локальные модели бесплатны** →
  правильнее `0`, чтобы в UI было видно `$0.00`, а не пусто.
- **Fix:** у `ILlmProvider` появился флаг `isLocal`; фабрика помечает им
  LM Studio. Новая функция `calculateCostUsdForProvider` возвращает `0` для
  локальных провайдеров и делегирует в `calculateCostUsd` для остальных, а
  `LlmService` прокидывает флаг в результате вызова.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-052, KI-055, KI-075, KI-134.


### KI-197 — Публичный share workflow (read-only ссылка)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0b (ссылка — коммиты `ae5e461`, `abf88ff`),
  v0.9.0 (участники — R7.6, коммит `60f9e22`)
- **Fix (R6.2.1, backend):** `share_token` (uuid, генерация в БД) +
  `POST/DELETE /workflow/:id/share` + публичный
  `GET /workflow/share/:token` (без auth). Ответ без `userId` /
  `shareToken` / `updatedAt`. Owner-check переиспользует
  `buildAccessFilter`; чужой → 404.
- **Fix (R6.2.2, frontend):** кнопка «Поделиться» в TopBar,
  `ShareModal` (создать / копировать / отозвать + предупреждение
  KI-233), `ShareViewPage` (route без ProtectedRoute, read-only
  ReactFlow + баннер), Vite `/workflow` bypass для SPA deep-link.
- **Fix (R7.6, участники по ID):** таблица `workflow_collaborators`
  (роли `viewer`/`editor`), приглашение по ID, owner-проверка через
  `buildAccessFilter` (`viewer` — GET, `editor` — запись), управление
  участниками в `ShareModal`. Остаток UX — KI-397..400.
- **Файлы:** `src/workflow/` (эндпоинт share + collaborators),
  `src/db/schema.ts`, `src/workflow/workflow-access.ts`,
  `web/src/components/TopBar.tsx`, `web/src/components/ShareModal.tsx`
- **Описание:** В GPTunnel есть «Поделиться»: toggle «Доступ по ссылке»
  (любой по ссылке видит и делает копию), «Участники» (приглашение по
  ID с ролью Просмотр/Редактирование), «Разрешить копирование»
  (toggle). У нас workflow доступен только владельцу, публичной ссылки
  нет — поделиться графом невозможно.
- **Решение:** (1)–(3) реализовано в v0.8.0b; (4) copy-to-my-account —
  R6.6 (Export/Import); участники-по-ID — реализованы в v0.9.0 (R7.6).
- **Когда чинить:** — (закрыто в v0.8.0b).
- **Связанные:** KI-233..243.

---

### KI-352 — нет паритет-гейта для REST-зеркала `web/src/lib/api.ts`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.5 (коммит `a889991`)
- **Файлы:** `web/src/lib/api.ts`, `src/runs/runs.controller.ts`,
  `src/runs/dto/*.dto.ts`
- **Описание:** `ApiRunSchema` вручную повторяет backend `RunResponse`
  (в JSDoc это прямо записано); ни один spec не сверяет их состав. Тот
  же класс дефекта, что KI-348, но для REST.
- **Решение:** распространить паттерн `docs/development/sse-contract.json`
  (или общий `api-contract.json`) на REST-DTO.
- **Fix:** `docs/development/api-contract.json` — source of truth для
  4 REST-ответов (RunResponse, ShareTokenDto, SharedWorkflow,
  ExportWorkflowDto); два паритет-спека:
  `src/runs/dto/api-contract.spec.ts` (backend, `ts.createSourceFile`
  для TS-интерфейсов + `ZodObject.shape` для ExportWorkflowDto) и
  `web/src/lib/api-contract.spec.ts` (`import.meta.glob '?raw'`).
  Двойные негативные тесты (M1/M2/M3) подтвердили симметрию.
  Production-код не тронут.
- **Остаток:** KI-356, KI-357, KI-358.
- **Связанные:** KI-348, KI-299, KI-072, KI-120.

---

### KI-509 — Бейджи статусов и возможностей — светлые литералы (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/components/TopBar.tsx`,
  `web/src/components/nodes/LLMNode.tsx`
- **Описание:** бейджи статуса запуска (`bg-blue-100 text-blue-700` и т.п. в
  `TopBar`) и бейджи возможностей модели (`bg-purple-100 text-purple-700`,
  `bg-emerald-100 text-emerald-700` в `LLMNode`) остаются светлыми плашками в
  тёмной теме. Текст на них формально читается (тёмный на светлом), но плашка
  «выжигает» тёмную карточку и не следует теме. DESIGN v0.11 § 3.6 явно вынес
  это за границы KI-448 («отдельные токены `--color-status-badge-*` или
  `dark:`-варианты; отдельная задача, не блокирующая KI-448»).
- **Решение:** добавить пару токенов `--color-status-badge-*` в
  `@theme`/`.dark` (светлая тема: `*-100` фон + `*-700` текст; тёмная:
  `*-950` фон + `*-200` текст) и заменить литералы в `TopBar` и в
  `NodeBadge.className`; `dark:`-утилиты использовать нельзя (KI-511).
- **Связанные:** KI-448, KI-510, KI-511.

---

### KI-436 — Agent: hard-cap превышается на один шаг
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/agent/agent.service.ts`
- **Описание:** `assertWithinBudgetAsync` вызывается после ответа LLM, когда
  стоимость шага уже израсходована (до ответа провайдера она неизвестна). В
  `hard`-режиме `BudgetExceededException` приходит после траты, поэтому
  последний вызов может превысить лимит на стоимость одного шага.
- **Решение:** проверять бюджет до вызова модели по оценке худшего случая
  (`maxTokensPerStep`) либо условием `spent + worstCaseStep > limit`.
- **Связанные:** KI-407, KI-048, KI-433.

---

### KI-408 — `node_runs.logs` агента дублирует транскрипт
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/agent/agent.service.ts`
- **Описание:** каждый шаг LLM пишет полный `system` + всю историю в `logs`.
  Рост JSONB квадратичный.
- **Решение:** писать только дельту (аргументы tool / финальный ответ).
- **Связанные:** KI-043, R7.4b.

---

### KI-188 — Режимы Курсор / Рука (S / H)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.1, коммит `e923384`)
- **Fix:** hotkeys S / H + кнопки в панели; `canvasMode` в сторе +
  localStorage; `panOnDrag` / `selectionOnDrag` / курсор обёртки.
- **Связанные:** KI-186.
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel: S — selection, H — pan (рука). У нас — обе
  через мышь (без hotkey).
- **Решение:** `panOnDrag` toggle + хук `useHotkeys`.
- **Когда чинить:** v0.8.
- **Связанные:** KI-186.

---

### KI-550 — `offset` удалён из API истории без deprecation-окна
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/runs/dto/run-history.dto.ts`, `src/runs/runs.controller.ts`
- **Описание:** `GET /workflow/:id/runs` больше не принимает `offset` (KI-542):
  Zod отбрасывает неизвестный параметр, и старый клиент с
  `?limit=20&offset=40` молча получает **первую** страницу вместо 40-й. Для
  внешних интеграций это тихая деградация данных, а не ошибка 400.
- **Решение:** в следующем миноре либо вернуть `offset` как deprecated-алиас с
  WARN/заголовком `Deprecation`, либо отвечать 400 на `offset` с текстом «use
  cursor». Внутренний UI обновлён в v0.16 S1, старые `.smoke/*`-скрипты —
  gitignored артефакты, их обновление не требуется.

### KI-582 — Дашбордов/алертов Grafana в репозитории нет
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `infra/grafana/dashboard.json`, `infra/prometheus/prometheus.yml`
- **Описание:** S4 даёт экспозицию; provisioning Grafana (dashboard JSON, alert rules) и scrape-config в репозитории отсутствуют — мониторинг пока ручной.
- **Решение:** в S6 добавить `deploy/prometheus/` и `deploy/grafana/`: scrape-config + базовый дашборд (HTTP latency/error rate, длительности узлов, стоимость, шаги агента).
- **Fix (v1.1.0 S4, частично):** добавлены `infra/prometheus/prometheus.yml`
  (job `workflow-builder`, `metrics_path: /metrics`, target `localhost:3000`)
  и `infra/grafana/dashboard.json` с тремя панелями: HTTP latency p95,
  Run duration p95 по типам узлов, Agent errors (`status="error"` для
  `agent_step` и `llm_call`). JSON парсится и проверяется смоуком.
  **Остаток:** alert rules, provisioning datasource и проверка дашборда в CI
  не добавлены (KI-610); target `localhost` требует правки для Docker (KI-613).
- **Связанные:** KI-574, KI-575, KI-581, KI-610, KI-613.

---

## v1.0.0 — Team & Audit UI (S5, 2026-11-03)

### KI-557 — Гонка регистрации с одинаковым email → 500 вместо 409
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/auth/auth.service.ts` (`registerAsync`)
- **Описание:** проверка занятости email остаётся вне транзакции: два
  параллельных запроса с одним email могут оба пройти pre-check, и второй
  упадёт на `users_email_unique` (PostgreSQL 23505) → 500 вместо 409. Это
  преэкзистующее поведение (тот же класс, что KI-400 у collaborators); S1
  улучшил только атомарность «организация + пользователь» (RULES 4.22).
- **Решение:** обернуть INSERT'ы в `try/catch`, ловить `unique_violation`
  (код 23505) и бросать `ConflictException('Email уже зарегистрирован')`.
- **Связанные:** KI-400, RULES 4.18.

### KI-331 — Нельзя вернуть fit-вид на share после wheel-zoom
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.1 — добавлены Controls с fitViewOptions.
- **Файлы:** `web/src/components/ShareViewPage.tsx`
- **Описание:** `<Controls>` не рендерится; колесо зажато store-minZoom 0.5; fit даёт 0.0104.
- **Решение:** добавить `<Controls>` (или хоткей fit) с общими `fitViewOptions`.
- **Связанные:** KI-315, KI-329, KI-330.

---

### KI-193 — Режим размышления (Reasoning) для LLM
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0c (коммит `283ce94`)
- **Fix (R6.3.1, backend):** `LlmGenerateOptions.reasoningEffort`
  ('off'|'medium'|'high'); OpenAI-совместимые — `reasoning_effort`
  через типизированное поле SDK, только если
  `ModelInfo.supportsReasoning === true`; 'off' → поле не отправляется.
  Anthropic extended thinking — v0.8.x (warn).
- **Fix (R6.3.2, frontend):** `<select>` Off/Medium/High в `LLMNode`
  (только при `supportsReasoning === true`) — коммит `fd50a31`.
- **Связанные:** KI-183, KI-192, KI-244, KI-246.
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`,
  `web/src/types/graph.ts`, `src/llm/llm-node-executor.service.ts`
- **Описание:** GPTunnel даёт выбор `Off / Medium / High` для
  reasoning-моделей (DeepSeek V4 Flash и аналоги). У нас reasoning
  идёт всегда и упирается в maxTokens (KI-183).
- **Решение:** поле `reasoningEffort: 'off' | 'medium' | 'high'` в
  `LlmNodeData`; прокидывать в SDK (`reasoning_effort` или аналог);
  дефолт — 'off' для не-reasoning, 'medium' для reasoning.
- **Когда чинить:** v0.8 (High — связано с KI-183).
- **Связанные:** KI-183, KI-179, KI-192.

---

### KI-425 — S3 `storedUrl` не работает для приватного бакета
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.3
- **Fix:** `storedUrl` приватного бакета — presigned GET
  (`@aws-sdk/s3-request-presigner`, `S3_SIGNED_URL_TTL_SECONDS = 3600`);
  публичный бакет по-прежнему получает прямой URL.
- **Файлы:** `src/media/media-storage.service.ts`
- **Описание:** `storedUrl` для S3 — прямой `<endpoint>/<bucket>/<key>`. При
  приватном бакете (норма для прода) UI получит 403. Локальный бэкенд отдаёт
  файл через `GET /media/file/...`, S3 — нет.
- **Решение:** presigned GET (`@aws-sdk/s3-request-presigner`) при чтении
  `node_runs.stored_url` или проксирование S3 через `openAsync`.
- **Связанные:** KI-412, KI-415, KI-362.

---

### KI-264 — Смоук-харнесс CDP: узкий Fetch-перехват + windowsVirtualKeyCode
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** временные скрипты смоука (вне репо)
- **Описание:** Три класса дефектов драйвера, встретившихся при
  смоуках R6.4b.1 / R6.4b.2a:
  1. Слишком широкий `Fetch.requestPaused` (например,
     `url.includes('/workflow')`) перехватывает модули Vite
     (`/src/stores/workflow.ts`, `/node_modules/`, `?import`) и
     отдаёт `application/json` вместо JS → «Failed to load module
     script», холст не рендерится. Фикс — пропускать запросы к
     `/src/`, `/node_modules/`, `/@vite/`, `/@fs/`, `?import`, `?t=`.
  2. Синтетический `keydown` без `windowsVirtualKeyCode` часть
     нажатий теряет. Повторные переключатели (H/M/Tab) «дожимают»
     состояние обратно.
  3. `Input.dispatchKeyEvent` для печатаемых клавиш требует
     `type: 'keyDown'` с полем `text`; `rawKeyDown` в части прогонов
     **не доходит** до страницы (0 keydown). `Page.captureScreenshot`
     снимает фокус с активного элемента — после скриншота нужен
     повторный фокус / `Page.bringToFront` перед нажатиями. 
  4. CDP-импорт модуля стора из страницы
     (`import('/src/stores/workflow.ts')`) создаёт **второй экземпляр**
     Zustand-стора, если Vite отдал приложению `?t=<timestamp>` после
     инвалидации. Обход — брать URL из
     `performance.getEntriesByType('resource')` (с реальным `?t=`).
  5. `Network.requestWillBeSent` **не содержит** заголовок
     `Authorization` (даже при валидном токене). Реальные заголовки
     доступны в `Network.requestWillBeSentExtraInfo` (или через
     `Fetch.requestPaused`). Для проверки «Bearer ушёл» — использовать
     только второй.       
  6. Хук, работающий после F5 (перехват кадров SSE, **запись
     `console.log`**), надо ставить через
     `Page.addScriptToEvaluateOnNewDocument` — иначе восстановленная
     подписка стартует раньше инъекции и кадры теряются.
  7. **Проверять `document.visibilityState` перед вводом** — в
     видимом Chrome с `document.hidden === true` OS-ввод молча
     отбрасывается. См. KI-275.                 
- **Решение:** зафиксировать оба правила в RULES § 4.33 (смоук CDP)
  или в отдельной памятке.
- **Связанные:** KI-135 (Emulation.setFocusEmulationEnabled).

---

### KI-180 — Нет textarea для prompt в LLM-узле
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.7.2 (коммит `675ca23`)
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`,
  `web/src/types/graph.ts`, `web/src/stores/workflow.ts`,
  `src/llm/llm-node-executor.service.ts`
- **Описание:** TextNode и ImageGenNode имеют textarea (auto-resize),
  LLMNode — только `<select>` модели. Если связь от Text не проведена,
  у LLM нет способа принять prompt — узел падал с «Пустой prompt».
- **Fix:** textarea для `data.prompt` (auto-resize из KI-169), backend
  fallback `inputs.prompt` → `data.prompt` → `data.value`. i18n
  `node.llm.placeholder`.
- **Когда чинить:** — (закрыто, v0.7.2)
- **Связанные:** KI-160, KI-169, KI-179.

### KI-525 — Скачивание входа OpenAI Images без pinning DNS
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.12.0 (S3) | **Обнаружено:** 2026-10-19
- **Файлы:** `src/media/providers/openai-images.provider.ts`
- **Описание:** `applyToolAsync` скачивает входное изображение обычным `fetch`.
  До вызова проверяются metadata/локальные имена, приватные IP-литералы,
  учётные данные в URL и запрещены редиректы, но DNS-резолв делает уже сам
  `fetch`: окно DNS rebinding между проверкой и соединением остаётся.
  `SafeHttpClient` закрывает это, но отдаёт тело строкой и портит бинарные
  данные.
- **Решение:** добавить в `SafeHttpClient` бинарный метод с тем же pinned DNS
  и лимитом байт, затем перевести скачивание на него.
- **Связанные:** KI-380, KI-434, KI-435, KI-478.

---

### KI-241 — `nodes as unknown as AppNode[]` без валидации
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/ShareViewPage.tsx`
- **Описание:** Форма `nodes`/`edges` с сервера не проверяется на
  клиенте (`as unknown as AppNode[]`). Некорректный граф уронит
  страницу.
- **Решение:** валидировать Zod-схемой (`ApiNodeSchema` /
  `ApiEdgeSchema`), при ошибке — понятное сообщение.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-197, KI-233.

---

### KI-418 — CreativeLab не объявляет модели upscale/chromakey
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.11.1 (S1) — отчёт
  [S1-hardening.md](development/reports/v0.11.1/S1-hardening.md).
- **Файлы:** `src/media/image-tool.ts`, `src/media/image-tool.spec.ts`,
  `web/src/types/graph.ts`, `web/src/components/nodes/ImageToolNode.tsx`,
  `web/src/components/nodes/ImageToolNode.spec.tsx`, `web/src/i18n/{ru,en}.json`
- **Описание:** Живой каталог 113 моделей не содержит upscale или chromakey.
  trim замаплен на `@VideoEdit`, upscale — на FAL/Replicate, chromakey пуст.
- **Fix:** `upscale` подтверждён тестами (FAL `clarity-upscaler` → Replicate
  `real-esrgan`); для `chromakey` модели нет ни у одного провайдера, поэтому
  операция скрыта из UI (`UI_IMAGE_TOOL_OPERATIONS`). Backend по-прежнему
  принимает `chromakey` в старых workflow; такой узел показывает выбранную
  операцию как недоступную, без молчаливой подмены (KI-069).
- **Связанные:** KI-366, KI-367, KI-524.

---

### KI-117 — Каталог media кэшируется на сессию без инвалидации
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/stores/workflow.ts`
- **Описание:** `loadMediaModelsAsync` выставляет `mediaModelsLoaded:
  true` и больше не ходит в API. При обновлении каталога (новая
  модель, изменился тариф) пользователь видит старое до F5.
- **Решение:** TTL или кнопка обновления.
- **Когда чинить:** при появлении VIDEO/AUDIO-узлов.
- **Связанные:** KI-088.

---

### KI-301 — `handleIdToOutputPort` не различает тип узла-источника
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `aacae26`)
- **Файлы:** `src/engine/node-ports.ts`
- **Описание:** Функция выбирает порт по id хэндла, **не сверяя тип
  узла-источника**. Если два типа имеют одинаковый `sourceHandleId`
  с разными `outputPortName` — данные молча теряются. В R6.7
  обойдено отдельным хэндлом `result-output`.
- **Решение:** type-aware резолвер портов (сверить с `sourceNode.type`).
- **Fix:** `handleIdToOutputPort(handleId, sourceNodeType?)` —
  при известном типе хендл сверяется с контрактом этого типа; чужой хендл
  → null → `inferDefaultOutputPort(type)`. Для типов без контракта (compare/
  merge/неизвестный) сохранён fallback по всем контрактам (иначе регресс
  KI-030). `buildExecutionPlanAsync` передаёт `sourceNode?.type`.
  +5 тестов, смоук (image_generation + чужой `text-output` → fromPort='url').
- **Остаток:** KI-033 (для типов без контракта fallback по-прежнему
  подменяет чужой хендл тип-дефолтом).
- **Связанные:** KI-022, KI-030, KI-033, KI-034.

---

### KI-368 — контракт порта `url` ≠ `mediaUrl`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9-R7.1 (коммит `1dc35f5`)
- **Файлы:** `src/engine/node-ports.ts`,
  `src/engine/execution-engine.service.spec.ts`
- **Описание:** `image_generation` объявлял выходной порт `url`, а
  исполнитель писал `mediaUrl` → любая связь из узла генерации отдавала
  зависимому `null`. Латентный дефект с v0.6.0; обнаружен CDP-смоуком
  R7.1 (генерация 0.6 ₽ — инструмент failed «Не задан входной файл»).
- **Решение:** `NODE_PORT_CONTRACT.image_generation.outputPortName =
  'mediaUrl'` (единственный источник правды; UI и
  `MediaNodeOutputsSchema` и так читают `mediaUrl`). 4 теста обновлены
  (один фиксировал `null` как норму).
- **Fix:** в R7.1 (коммит `1dc35f5`).
- **Связанные:** KI-030, KI-111.

---

### KI-604 — Удаление необратимо и подтверждается только текстовым `window.confirm`
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `web/src/components/TeamPage.tsx`
- **Описание:** удаление участника необратимо (вернуть можно только SQL-правкой,
  KI-600) и передаёт графы (KI-599), но подтверждение — нативный
  `window.confirm` без списка последствий и без ввода email/имени для
  подтверждения. В S2 этого достаточно (постановка прямо просила
  `window.confirm`), но защиты от случайного клика по «Удалить» нет; отмены
  операции (undo) тоже нет.
- **Решение:** отдельной задачей — модалка подтверждения с перечнем последствий
  (число передаваемых графов, потеря доступа, невозможность повторного
  приглашения) и подтверждением удаления; опционально undo-окно на несколько
  секунд (потребует отложенного удаления/очереди).
- **Связанные:** KI-599, KI-600, KI-586.

## v1.1.0 — Audit Filters & Security Fix (S3, 2026-11-04)

### KI-416 — OTel span `agent.step` отсутствует
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 (коммит `a1ccf86`) — каждая итерация цикла
  обёрнута в `withSpanAsync('agent.step', …)`.
- **Файлы:** `src/agent/agent.service.ts`
- **Описание:** DESIGN § 3.7.1 перечисляет `agent.step`, R7.7 ограничен
  `run.execute` / `node.execute` / `llm.call` / `media.createTask`.
- **Решение:** обернуть каждую итерацию агента в
  `tracing.runAsync('agent.step', ...)`.
- **Связанные:** R7.4b, DESIGN v0.9 § 3.7.1.

---

### KI-392 — `matrix.unitParam='duration'` семантика не документирована
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/runs/cost-budget.service.ts`, `src/media/dto/media-model.dto.ts`
- **Описание:** `matrix.unitParam='duration'` трактуется как «цена за секунду»
  (5 с × 30 = 150 для `wan-3.0`). Для `minimax-h3-max` (10/с → 50) и
  `minimax-hailuo-03` (12/с → 60) может расходиться с биллингом upstream.
- **Решение:** сверка с upstream-документацией; при необходимости — отдельный
  тариф на модель.
- **Связанные:** KI-384.

---

### KI-356 — REST-ответ workflow без DTO: web-зеркало расходится на shareToken
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/workflow.controller.ts`, `src/db/schema.ts`,
  `web/src/lib/api.ts`
- **Описание:** `GET/POST/PATCH /workflow` отдают строку Drizzle `workflows`
  (10 колонок) как есть; web-зеркало `ApiWorkflowSchema` объявляет 9 полей —
  без `shareToken`. Zod отбрасывает лишнее, дефект не проявляется, но
  контракта ответа нет — в `api-contract.json` пара не попадает.
- **Решение:** ввести backend-DTO `WorkflowResponse` (без `shareToken`),
  внести пару в `api-contract.json` — гейт KI-352 подхватит автоматически.
- **Связанные:** KI-352, KI-348.

---

### KI-330 — `elementsSelectable` на share-странице не работает
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.1 — onNodesChange для выделения.
- **Файлы:** `web/src/components/ShareViewPage.tsx`
- **Описание:** `nodes` controlled без `onNodesChange`; клик по узлу не даёт выделения.
- **Решение:** прокинуть `onNodesChange` (хотя бы для selection) либо сделать `nodes` uncontrolled на публичной странице.
- **Связанные:** KI-329, KI-331.

---

### KI-543 — Список истории не обновляется в реальном времени
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/RunHistoryModal.tsx`
- **Описание:** Модалка загружает страницу один раз: статусы `pending`/`running`
  не обновляются, а новый запуск, созданный при открытой модалке, не появится до
  переоткрытия или перелистывания страницы.
- **Решение:** периодический refetch (polling) или SSE-событие `run_created`,
  пока модалка открыта; отмена в текущем срезе — осознанно (лишние запросы и
  подписки при редком сценарии).

### KI-281 — http: тело ответа читается целиком перед обрезкой
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-executors.ts`
- **Описание:** `response.text()` читает тело **целиком** в память
  worker'а, потом обрезает до 1 МБ. Большой ответ (сотни МБ) успевает
  попасть в память.
- **Решение:** потоковое чтение с ранним обрывом или проверка
  `Content-Length` до чтения.
- **Связанные:** KI-025.

---

### KI-309 — Frontend-спек ловит литералы, не конкатенацию
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/lib/api-prefixes.spec.ts`
- **Описание:** Тест ищет `fetch('/prefix/...')`-литералы регуляркой.
  Не ловит `'/work' + 'flow/...'` и переменные; матчит комментарии.
- **Решение:** расширять при реальных ложных срабатываниях.
- **Связанные:** KI-072.

---

### KI-087 — `OPENAI_BASE_URL` дублирует `ROUTERAI_*`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-provider.factory.ts`, `.env.example`
- **Описание:** Для совместимости фабрика прокидывает
  `OPENAI_BASE_URL` в провайдера `openai`. Если задано
  `OPENAI_API_KEY=<routerai>` + `OPENAI_BASE_URL=https://routerai.ru/api/v1`
  и **одновременно** `ROUTERAI_API_KEY=<routerai>`, то в
  `GET /llm/models` появится **две «families»** одного upstream.
- **Решение:** пометить `OPENAI_BASE_URL` deprecated, убрать из
  `.env.example`, оставить только `ROUTERAI_*` / `DEEPSEEK_*` /
  `YANDEX_*` / `LMSTUDIO_*`.
- **Когда чинить:** v0.6.0.
- **Связанные:** KI-084.

---

### KI-105 — URL-ы результата живут 48 часов и нигде не продлеваются
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.8.0e (R6.5.1 + R6.5.2, коммиты 1e89cdd + c4f2792)
- **Fix (R6.5.1, backend):** executors `http` / `condition` / `output` /
  `compare`; узел `note` реализован ранее как `comment` (KI-187).
- **Fix (R6.5.2, frontend):** 4 компонента + `NODE_REGISTRY` +
  i18n; handle IDs по `node-ports.ts`.
- **Связанные:** KI-278..287, KI-187.
- **Прогресс (R6.5.1, коммит 1e89cdd):** backend-executors для
  `http`, `condition`, `output`, `compare` (DESIGN v0.8 § 8). Узел
  `note` реализован ранее как `comment` (KI-187/R6.4b.2a).
- **Остаток (R6.5.2):** frontend-компоненты + `NODE_REGISTRY` +
  i18n.
- **Связанные:** KI-278..283, KI-187.
- **Файлы:** `src/media/media-node-executor.service.ts`,
  `src/db/schema.ts`
- **Описание:** `resultUrls` сохраняются в `node_runs.outputs` как
  есть. Через 2 суток ссылки в истории перестанут открываться, а
  файла у нас нет (см. GPTunnel docs: «Ссылки на результат
  действуют 48 часов»).
- **Решение:** либо скачивать результат к себе (S3 / local disk),
  либо помечать «ссылка истекла» в UI.
- **Когда чинить:** до R5 (хранение результатов).
- **Связанные:** KI-077.

---

### KI-589 — Email приглашённого попадает в metadata аудита в открытом виде
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S5) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/audit/audit.interceptor.ts`, `src/organizations/org-members.service.ts`
- **Описание:** интерсептор аудита пишет санитизированное тело запроса; у
  `POST /admin/members/invite` это `{ role, email }`. Email — персональные данные
  (RULES 5.9), но для журнала «кто кого пригласил» он и есть смысл записи.
  Retention/immutability журнала не определены (KI-565), поэтому «удалить
  навсегда» сейчас нечем.
- **Решение:** зафиксировать политику: email в аудите разрешён (нужен для
  расследований), пароли/токены — нет; при введении retention (KI-565)
  предусмотреть маскирование адресов старше N месяцев.
- **Fix (v1.1.0 S5):** для действий `member.invite` и `member.remove`
  `AuditInterceptor` рекурсивно маскирует email-подобные подстроки в metadata:
  `alice@example.com` → `a***@example.com` (локальная часть скрыта, домен
  сохранён). Маска идемпотентна, применяется и к телу, и к параметрам, и к
  вложенным объектам; для остальных действий metadata не меняется. Тесты:
  `audit.interceptor.spec.ts` (body, строка, вложенность, member.remove,
  негативный кейс для workflow.create); смоук проверяет, что полного email в
  журнале нет.
- **Связанные:** KI-565, KI-572, KI-573, KI-616.

### KI-247 — Лог движка «узлов=0» при падении первого узла
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (Пакет 2, коммит bec48bf)
- **Fix:** лог «Запуск … завершён» различает completed/failed:
  `узлов выполнено=N, провалено=M` (движок прерывается на первом
  failed, поэтому `провалено ∈ {0, 1}`).
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** При падении первого узла в логе: «Запуск … завершён:
  status=failed, узлов=0». Узел **выполнялся** (в логе есть строка
  исполнителя), но счётчик `узлов` считает только `completed`.
  Путает при диагностике.
- **Решение:** логировать отдельно `completed` / `failed` /
  `skipped`; или `узлов=N (failed=M)`.
- **Когда чинить:** при следующей правке engine (v0.8.x).
- **Связанные:** KI-036 (retry), KI-037 (plan-error).

---

### KI-084 — Пустой `OPENAI_BASE_URL=` в `.env` роняет приложение
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.5.0
- **Файлы:** `src/config/env.schema.ts`, `.env.example`
- **Описание:** Схема `OPENAI_BASE_URL: z.url().optional()` в Zod 4
  пропускает **только** `undefined`, не пустую строку. Если
  скопировать `.env.example` в `.env` **как есть**
  (`OPENAI_BASE_URL=`), `validateEnv` падает — приложение не
  поднимается.
- **Решение:** `z.preprocess((v) => (v === '' ? undefined : v), z.url().optional())`.
  Тот же паттерн — для всех будущих URL-переменных.
- **Когда чинить:** v0.5.0 (блокер onboarding на чистой машине).
- **Связанные:** KI-085.
- **Fix:** `emptyToUndefined` через `z.preprocess` — пустая строка
  трактуется как `undefined`. Применено ко **всем** опциональным
  строковым/URL-переменным. `.env.example` теперь копируется как
  есть.

---

### KI-502 — Нет DB-интеграционного спека на кэш-колонки
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/engine/execution-engine.service.spec.ts`
- **Описание:** UPDATE с кэш-колонками проверяется только in-memory двойником, не на живой PostgreSQL.
- **Решение:** добавить в `test:parity` или отдельный интеграционный тест.

---

### KI-513 — Хрупкий deep-import `ThrottlerStorageRecord`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/common/throttler/redis-throttler.storage.ts`
- **Описание:** Тип берется из `@nestjs/throttler/dist/...`, что сломается при смене exports в пакете.
- **Решение:** объявить локальный структурный тип.

---

### KI-424 — UI lipsync: audioUrl без валидации
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.2 — `isAudioUrlInvalid` (`web/src/lib/image-tool-node.ts`)
  + красная рамка/подсказка в `ImageToolNode`; пустое значение — нейтрально
  (см. KI-438).
- **Файлы:** `web/src/components/nodes/ImageToolNode.tsx`
- **Описание:** Поле принимает любую строку, нет плеера и подсказки.
- **Решение:** `type="url"`, preview-player.
- **Связанные:** KI-369.

---

### KI-569 — Неудачные (4xx/5xx) мутирующие запросы не аудируются
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/audit.interceptor.ts`
- **Описание:** запись выполняется только в `tap(next)` — после успешного
  обработчика. Отклонённые операции (валидация 400, 403, 404, 409, 500) в
  журнал не попадают. Для журнала действий это осознанно, но для безопасности
  (попытки несанкционированного доступа, брутфорс, отказы прав) нужен аудит
  попыток, а не только успехов.
- **Решение:** в S5 (вместе с аудитом login, KI-566) добавить обработку ошибок
  в интерсепторе (`catchError`) или отдельный `AuditExceptionFilter`, писать
  `action`, `statusCode`, `error` без тела-секрета; определить, какие ошибки
  журналировать (403/401/409 — вероятно да, 400/404 — по решению).
- **Связанные:** KI-566, KI-568, S5.

### KI-185 — Вставка узла в связь (hover на edge)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0d (R6.4a, коммит `fcd2913`)
- **Fix:** кастомное ребро `InsertableEdge` по паттерну React Flow
  (`BaseEdge` + `interactionWidth={60}` + `EdgeLabelRenderer`).
  Hover-состояние в ребре, костыль fix3 (таймер + ref-флаги) удалён.
- **Остаток:** KI-259 (вставка типа без входного порта), KI-260
  (позиция узла), KI-261 (молчание при отсутствующей связи).
- **Связанные:** KI-162, KI-127, KI-259..261.
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel при hover на связь показывает «+» с
  подсказкой «Вставить ноду в связь» (и «×» для удаления). У нас
  удаление — только Delete/Backspace; вставки нет.
- **Решение:** `onEdgeMouseEnter` → показать «+» посередине
  (`EdgeLabelRenderer`), клик — открыть каталог узлов, после выбора
  разбить edge на два (source→new, new→target).
- **Когда чинить:** v0.8 (Canvas UX).
- **Связанные:** KI-162, KI-127.

---

### KI-207 — Параметры scrypt не фиксированы в хэше
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/auth/auth.service.ts`
- **Описание:** Формат `scrypt$<salt>$<hash>` не хранит N/r/p.
  Используются дефолты Node (N=16384, r=8, p=1). При смене дефолтов
  Node старые пароли перестанут проверяться.
- **Решение:** расширить формат `scrypt$N$r$p$salt$hash`; либо
  фиксировать константы в коде и не менять без миграции.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201.

---

### KI-373 — бандл web 711 kB → порог Vite 710 → 730 kB
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.3
- **Fix:** выполнен code-split (ленивые компоненты узлов + группы
  `react`/`reactflow`/`i18n`/`vendor`); `chunkSizeWarningLimit` снижен до
  500 kB. В `web/dist/assets` крупнейшие чанки — `react` ~219 kB,
  `reactflow` ~178 kB, `index` ~150 kB; единого бандла 711 kB больше нет.
- **Файлы:** `web/vite.config.ts`
- **Описание (историческое):** системное решение — code-split (KI-008).
- **Связанные:** KI-334, KI-008, KI-390.

---

### KI-099 — Кэш media-моделей живёт в памяти процесса
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/media/providers/creativelab.provider.ts`
- **Описание:** При нескольких инстансах backend каждый держит свой
  кэш и ходит в upstream отдельно (N запросов на N инстансов за
  TTL). Сейчас инстанс один; при горизонтальном масштабировании
  нужен Redis-кэш (инфраструктура уже есть — `RedisModule`).
- **Решение:** общий Redis-кэш при multi-instance.
- **Когда чинить:** при масштабировании.
- **Связанные:** KI-100.

---

### KI-537 — Права на историю запусков уже, чем на сам запуск
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/runs/runs.service.ts`, `src/runs/runs.controller.ts`
- **Описание:** `GET /workflow/:id/runs` (v0.14 S1) требует роль `editor`, а
  `GET /runs/:id` и `GET /runs/:id/nodes` доступны любому участнику, включая
  `viewer` (`accessibleWorkflowIdsSubquery`, R7.6). Наблюдатель по прямой
  ссылке видит запуск, но в списке истории получает 404 — расхождение прав на
  одно и то же чтение.
- **Решение:** либо снизить требование истории до `viewer` (чтение — всем
  участникам), либо поднять остальные read-ручки до `editor`. **S2:** UI-решение
  принято — кнопка «История» скрыта для `viewer` (не предлагаем гарантированный
  404), backend по-прежнему требует `editor`. Открытый вопрос — снижать ли
  требование ручки до `viewer` (тогда кнопку можно вернуть). Согласовать в S3.

### KI-614 — Logout не отзывает access-токен
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-05
- **Файлы:** `src/auth/auth.controller.ts`, `src/auth/auth.service.ts`,
  `src/auth/guards/jwt-auth.guard.ts`
- **Описание:** `POST /auth/logout` отзывает refresh-токен и очищает cookie, но
  выданный access-JWT остаётся валидным до истечения TTL (24 ч). Механизм
  `token_version` (S5) позволяет отозвать его, но инкремент на logout отозвал бы
  **все** сессии пользователя на всех устройствах, а не только текущую. Blacklist
  по `jti` в Redis не вводился.
- **Решение:** при требовании «выход = мгновенный отзыв» — хранить `jti`
  access-токена в Redis с TTL и проверять в guard'е либо ввести отдельные
  короткоживущие access-токены + refresh-ротацию; до этого действует TTL.
- **Связанные:** KI-601, KI-615.

### KI-337 — Подграф sub_workflow без skip-семантики
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.4 (коммит `ac665b1`)
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** `executeSubWorkflowGraphAsync` бросает на первом падении и не создаёт строк для непройденных узлов подграфа — асимметрия с корневым графом.
- **Решение:** распространить `failedIds`/`skippedIds` на подграфы.
- **Связанные:** KI-288, KI-304.
- **Fix:** общий приватный хелпер `skipBlockedNodesAsync` — корневой
  `executeAsync` и `executeSubWorkflowGraphAsync` используют один
  механизм. Подграф после падения доигрывает независимые ветки
  (симметрия с KI-287, RULES 4.16). `node_runs` и `node_skipped` —
  с префиксом `sub_<nodeId>__` (DESIGN § 5.3). Контракт родителя не
  менялся (`sub_workflow` → failed, потомки родителя → skipped,
  DESIGN § 5.6). Смоук: sub→sub→fail→skipped, 6 строк `node_runs`
  (2 skipped), 2 `node_skipped`.
- **Остаток:** KI-354, KI-355.
- **Связанные:** KI-288, KI-287, KI-336, KI-200.

---

### KI-431 — `PROMPT_CACHE_MIN_TOKENS` не объявлена в `EnvSchema`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** порог промпт-кэша читается провайдером напрямую
  (`readPromptCacheMinTokens`, `src/llm/providers/anthropic.provider.ts`), хотя
  переменной нет в `EnvSchema`. Значение не валидируется Zod: опечатка в имени
  или строка `"abc"` молча откатываются на `DEFAULT_PROMPT_CACHE_MIN_TOKENS`
  (1024), и включённый кэш незаметно работает с дефолтным порогом.
- **Решение:** добавить `PROMPT_CACHE_MIN_TOKENS`
  (`z.coerce.number().int().positive().default(1024)`) в `EnvSchema` и читать
  через `ConfigService` (RULES 4.6), как остальные env-флаги.
- **Связанные:** KI-414, KI-432.

---

### KI-169 — Textarea в узлах фиксированной высоты
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `474a93f`)
- **Файлы:** `web/src/hooks/use-auto-resize.ts`,
  `web/src/components/nodes/TextNode.tsx`,
  `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Поля ввода имели фиксированную высоту (`rows={3}`), поэтому
  длинный текст обрезался, а прокрутка внутри узла была незаметной.
- **Fix:** хук `useAutoResize` пересчитывает высоту по `scrollHeight` в
  `useLayoutEffect` (без мигания), ограничивает её 200px и включает
  `overflow-y: auto` при превышении; поле сжимается обратно при сокращении
  текста.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-157, KI-171.

---

### KI-474 — UI-селекты форматов у файловых узлов не применяются
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/engine/node-executors.ts`, `web/src/components/nodes/*.tsx`
- **Описание:** `read_file` и `write_file` принимают `format` и `overwrite`, но исполнители их игнорируют (всегда текст, всегда перезапись).

---

### KI-023 — Зависший запуск при падении worker'а
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `b1065be`)
- **Файлы:** `src/runs/runs.processor.ts`
- **Описание:** Если worker умрёт во время выполнения, `workflow_runs.status`
  останется `running`. BullMQ перезапустит job (attempts: 3, stalled-check),
  но процессор пропустит его по guard'у `status !== 'pending'` — запуск
  навсегда останется в `running`.
- **Решение:** lease-таймаут или `UPDATE ... WHERE status IN
  ('pending', 'running') AND started_at < now() - interval '...'`.
- **Когда чинить:** R3 (реальные LLM-вызовы падают чаще).
- **Связанные:** —
- **Fix:** lease-guard в `RunsProcessor.process()` — `RUN_STALE_THRESHOLD_MS
  = 5 min` в `src/runs/runs.constants.ts`. Повтор разрешён при
  `status='running'` и `started_at` старше порога; свежий `running`
  и `started_at=null` — пропускаются. Вариант A (не сбрасываем
  в pending — executor сам обновит `started_at`).
- **Остаток:** KI-031 (дубли `node_runs`), KI-032 (нет heartbeat).

---

### KI-603 — Роль admin не может управлять командой, хотя DESIGN называет её «управлением командой»
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-owner-only.guard.ts`,
  `src/organizations/org-members.controller.ts`
- **Описание:** DESIGN § 2.1 описывает Admin как роль для управления командой,
  S5 разрешил `admin` приглашать участников, а S2 (по постановке) оставил
  `PATCH`/`DELETE` за `owner` (`OrgOwnerOnlyGuard`): администратор получает 403
  на смену роли и удаление. Три политики на одном контроллере (`GET` — все,
  `invite` — owner/admin, управление — owner) удобны для поэтапного релиза, но
  пользователь с ролью `admin` в UI видит кнопку «Пригласить» и не видит
  управления составом — расхождение с ожиданиями из DESIGN.
- **Решение:** в S6/релизе v1.1 определить целевую матрицу прав (admin может
  менять роль `member`/`viewer`, но не владельца; передача владения) и
  синхронизировать DESIGN § 2.1, guard'ы и UI; до этого — явная подпись в UI,
  какие действия доступны роли.
- **Связанные:** KI-586, KI-554, DESIGN V110 § 3.2.

### KI-043 — `node_runs.logs` — свободный текст
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/schema.ts` (`node_runs.logs`), `src/engine/execution-engine.service.ts`
- **Описание:** Записи вида «попытка 1/3 упала: … — повтор через 500 мс»
  читаемы, но не структурированы. Для UI (R4) и агрегатов (сколько ретраев,
  какая ошибка) лучше JSON-объекты (сейчас `$type<string[]>`).
- **Когда чинить:** R4.
- **Связанные:** KI-036.

---

### KI-274 — `matchesHotkey`: `ctrl+*` биндинги не срабатывали никогда
- **Приоритет:** 🔴 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.2b, коммит 2efe3f3)
- **Файлы:** `web/src/lib/hotkeys-utils.ts`, `web/src/lib/hotkeys-utils.spec.ts`
- **Описание:** После строгой сверки модификаторов функция возвращала
  `!pressed.ctrl && !pressed.alt && !pressed.meta` — то есть `false`
  для любого сочетания с `ctrl`. Не работали `Ctrl+D` (R6.4a),
  `Ctrl+Z`/`Ctrl+Shift+Z`, `ctrl+s` из тестов. Существующий тест
  `Ctrl+S ⟂ Ctrl+Shift+S` покрывал корректное поведение, но падал —
  расхождение не заметили.
- **Fix:** сверка `pressedCtrl !== binding.ctrl || …` (строго) +
  `isSingleKey || !pressed.shift` для нестрогого shift у одиночных
  клавиш (поведение R6.4b.1 сохранено). +5 регресс-тестов.
- **Связанные:** KI-186, KI-191.

---

### KI-580 — Fallback-нормализация route заменяет только UUID
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/metrics/metrics.interceptor.ts`
- **Описание:** подпись `route` берётся из `request.route.path`; fallback заменяет только UUID-сегменты. Если шаблон Express станет недоступен, не-uuid идентификаторы (слаги шаблонов, произвольные id) дадут рост кардинальности.
- **Решение:** расширить нормализацию (slug/hex/числа) либо брать шаблон из Nest-метаданных (`getClass()/getHandler()`), добавив паритет-тест.

### KI-118 — Результат media-генерации — внешняя ссылка 48 ч
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.9.0 (R7.8, коммит `3e2844a`); уточнено в v0.9.1/v0.9.4
- **Fix:** это дубль KI-362. Результат media сохраняется в `IMediaStorage`
  (local/S3), в `node_runs` есть `stored_url`/`stored_expires_at`, а UI
  выбирает `storedUrl` и показывает `ExpiredMediaPlaceholder` вместо
  битой ссылки провайдера.
- **Файлы:** `src/media/media-storage.service.ts`, `src/db/schema.ts`
  (`node_runs.stored_url`, `stored_expires_at`), `web/src/lib/media-source.ts`,
  `web/src/components/ExpiredMediaPlaceholder.tsx`,
  `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** `mediaUrl` живёт 48 часов и не кэшируется у нас. При
  повторном открытии старого run `<img>` будет битым, а определить
  «ссылка истекла» по ответу `<img>` нельзя.
- **Решение:** скачивать результат к себе (S3/local) либо
  плейсхолдер «ссылка истекла» в UI.
- **Связанные:** KI-105, KI-362.

---

### KI-552 — `document_templates` и `workflow_runs` без `organization_id` (DESIGN § 3.1)
- **Приоритет:** 🟡 Medium | **Статус:** Deferred | **Запланировано:** v1.0.0 (S5/backlog) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`, `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md`
- **Описание:** DESIGN § 3.1 перечисляет `organization_id` в `users`,
  `workflows`, `document_templates`, `workflow_runs`; S1 по постановке ограничен
  `users` + `workflows`, S2 закрыл изоляцию этих таблиц через
  `workflows.organization_id` (все выборки идут через org-scoped проверку
  workflow), так что отдельная колонка сейчас не нужна. Денормализация
  понадобится для запросов «все шаблоны/запуски организации» без join'а
  (аудит/биллинг S3+, массовые выборки).
- **Решение (отложено):** при появлении таких запросов добавить
  `organization_id` в `document_templates` и `workflow_runs` с backfill от
  `workflows.organization_id` (через `workflow_id`), NOT NULL после заполнения
  по схеме 0014 + backfill; расширить parity-гейт и `schema.spec.ts`.
- **Связанные:** DESIGN v1.0 § 3.1, KI-556.


### KI-583 — Приглашение не переносит уже зарегистрированного пользователя в организацию
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`, `src/auth/auth.service.ts`
- **Описание:** `POST /admin/members/invite` принимает только ещё не
  зарегистрированный email: если строка `users` с таким email существует, сервис
  отвечает 409. Совместная работа поэтому доступна лишь тем, кто регистрируется
  **после** приглашения. Просто переписать `users.organization_id` нельзя:
  workflow привязаны к `organization_id`, и перенос пользователя без переноса его
  графов оставил бы данные в прежней организации (пользователь потерял бы к ним
  доступ), а перенос графов меняет владельца.
- **Возможные решения:** 1) отдельная таблица `organization_members(user_id,
  organization_id, role)` (снимает и KI-570), приглашение-приглашение с
  подтверждением для существующего пользователя; 2) сервисный перенос
  «пользователь + его workflow» в одну транзакцию с аудитом и подтверждением
  владельца; 3) оставить как есть и считать команду «созданием новых
  участников» — тогда UX должен явно говорить об ограничении.
- **Связанные:** KI-563, KI-570, KI-558, DESIGN v1.0 § 2.1.

### KI-444 — `publicBucket` не проброшен из env
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.4
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** флаг `publicBucket` в `S3MediaStorage` есть и меняет формат
  `storedUrl` (прямой URL vs presigned GET), но `createMediaStorage` его не
  передаёт, а переменной `S3_PUBLIC_BUCKET` нет в `EnvSchema`. Публичный
  бакет недостижим без правки кода, и это единственный S3-флаг вне
  Zod-валидации.
- **Решение:** добавить `S3_PUBLIC_BUCKET` в схему
  (`z.preprocess(emptyToUndefined, z.enum(['true', 'false']).optional())`)
  и читать через `ConfigService` (RULES 4.6) в `createMediaStorage`, как
  остальные `S3_*`.
- **Связанные:** KI-425, KI-431, KI-412.

---

### KI-159 — Yandex: 400 «Failed to parse model URI»
- **Приоритет:** 🔴 Critical | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `29f4e19`)
- **Файлы:** `src/llm/llm-provider.factory.ts`,
  `src/llm/providers/openai-compatible.provider.ts`,
  `src/config/env.schema.ts`, `.env.example`
- **Описание:** В `YANDEX_MODELS` стоял выдуманный id
  `qwen3.6-35b-a3b/latest`, а Yandex AI Studio принимает модель только как URI
  `gpt://<folder_id>/<model>/<version>`. Каждый Run по Yandex падал с
  400 «Failed to parse model URI».
- **Fix:** список приведён к реальным моделям (`yandexgpt-lite`, `yandexgpt`,
  `yandexgpt-32k`); в конфиг провайдера добавлен хук `resolveModel`, собирающий
  URI из короткого id; добавлена переменная `YANDEX_FOLDER_ID`, без которой
  провайдер не регистрируется вовсе (graceful degradation + warning в логе
  вместо 400 при запуске).
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-088, KI-172.

---

### KI-357 — REST-зеркала вне паритет-гейта: TemplateSummary, LlmModelInfo,
MediaModelInfo, engine-DTO
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/lib/api.ts`, `web/src/lib/export-import-api.ts`,
  `web/src/types/media.ts`, `src/templates/dto/template.dto.ts`,
  `src/llm/llm-registry.service.ts`, `src/media/dto/media-model.mapper.ts`,
  `src/engine/dto/graph.dto.ts`
- **Описание:** гейт KI-352 покрывает 4 ответа. Вне его — `TemplateSummary`
  (Zod↔Zod 4/4, backend в `src/templates/dto`), `LlmModelInfo` (7/7,
  backend TS-interface), `MediaModelInfo` (ручная синхронизация),
  `ApiNodeSchema` (+`order`; `position` optional↔обязателен),
  `ApiEdgeSchema` (`.optional` ↔ `.nullish`), `ModelModality`
  (значения дублируются).
- **Решение:** добавить `TemplateSummary` в текущий `api-contract.json`;
  LLM/media/engine — после снятия ограничений на чтение их папок.
- **Связанные:** KI-352, KI-348, KI-350.

---

### KI-536 — `MCP_STDIO_CWD` не канонизируется
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** Дефолт относителен (`./data/mcp`). При запуске из другого каталога база изоляции окажется не там.
- **Решение:** резолвить в абсолютный путь при создании клиента.

### KI-075 — `node_completed` / `node_failed` не несут метрики и логи
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.7.1 (коммиты `84532f1`, `684211f`)
- **Уточнено:** 2026-10-14 (R5.4 smoke)
- **Файлы:** `src/runs/dto/run-event.dto.ts` (схема события),
  `src/engine/execution-engine.service.ts` (публикация),
  `web/src/stores/workflow.ts` (snapshot reader)
- **Описание:** Токены, стоимость и записи ретраев (KI-036) приходили
  только в `snapshot`, поэтому панель показывала их лишь после
  переподключения к потоку. При живом выполнении были видны только
  длительность (из `node_completed`) и текст ошибки: после Run панель
  показывала `durationMs` для image_generation **без `cost_rub`**, хотя в БД
  и в snapshot значение есть.
- **Fix:** события `node_completed`/`node_failed` теперь несут `costRub`,
  `tokensIn`, `tokensOut`, `costUsd` и `logs`, а frontend читает их из события
  и обновляет метрики узла без перезагрузки страницы (F5 больше не нужен).
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-038, KI-043.

---

### KI-007 — Отсутствие необязательного пропа React Flow не ловит tsc
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** При рефакторинге `Canvas.tsx` проп `nodeTypes={nodeTypes}`
  исчез. TypeScript не ругался — проп необязательный. Узлы рендерились
  дефолтным компонентом React Flow. Обнаружено только в браузере (headless
  Chrome + CDP): `react-flow__node-default` вместо `react-flow__node-text`.
- **Паттерн:** после рефакторинга React-компонентов с React Flow —
  **обязательная проверка в реальном браузере**. Юнит-тесты и `tsc`
  не ловят этот класс ошибок.
- **Возможные меры:**
  1. Простой smoke-тест в CI: собирать web/ и открывать страницу через
     Playwright/Cypress, проверять наличие `react-flow__node-text` и т.п.
  2. Линт-правило (custom): требовать `nodeTypes` в `<ReactFlow>`.
- **Не блокер:** задокументировано, работает после fix.

---

### KI-107 — Параллельные media-узлы могут упереться в rate limit
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Узлы одного уровня выполняются параллельно
  (`Promise.allSettled`), несколько media-узлов одновременно создадут
  несколько задач. Ограничения конкурентности для media нет, хотя
  upstream наверняка имеет лимит. При 429 — узел упадёт без повтора
  (см. KI-104).
- **Решение:** per-provider семафор (как KI-067 для LLM).
- **Когда чинить:** при появлении параллельных media-узлов.
- **Связанные:** KI-067.

---

### KI-530 — MCP `stdio`: нет изоляции процесса
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.13.0 (S1) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/mcp/mcp.config.ts`
- **Описание:** Нет `cwd`, лимитов памяти/CPU. Denylist — эвристика. Защита только через `docker run`.
- **Решение:** обязательный `cwd`, лимиты `MCP_STDIO_MAX_*` в v0.13.

### KI-293 — Timestamptz-дрейф: `created_at` в БД без таймзоны
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.0e (KI-293-fix, коммит `e5f489a`)
- **Fix:** миграция `0006_timestamptz_drift.sql` — 6 колонок
  `ALTER COLUMN ... TYPE timestamptz USING col AT TIME ZONE 'UTC'`;
  `schema.ts` — 4 колонки получили `{ withTimezone: true }`
  (ТЗ ошибочно утверждало, что это уже сделано). Смоук before/after:
  до — `createdAt` на −10800 сек, после — delta 0.
- **Остаток:** KI-298 (drizzle-kit generate не сверяет схему с БД).
- **Связанные:** KI-296, KI-297, KI-298, KI-018.
- **Файлы:** `src/db/schema.ts` (`workflows`, `workflow_runs`,
  `node_runs`), `drizzle/`
- **Описание:** Drizzle-схема объявляет `timestamp(..., { withTimezone: true })`,
  но фактически колонки в БД — `timestamp WITHOUT time zone`. Node `pg`
  парсит naive-значение как локальное, и **API отдаёт момент на 3 часа
  раньше** (воспроизведено: БД 22:10:04 → API `19:10:04Z` при UTC+3).
  Плюс вечный diff у `drizzle-kit generate`.
- **Решение:** миграция `ALTER COLUMN ... TYPE timestamptz USING ... AT TIME ZONE 'UTC'`
  + синхронизация Drizzle-схемы.
- **Связанные:** KI-018, KI-015, KI-290.

---

### KI-002 — `EngineService.validateGraphAsync` — синхронный метод с суффиксом Async
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/engine.service.ts`
- **Описание:** Метод `validateGraphAsync` возвращает `GraphValidationResult`
  (не `Promise<>`), но имеет суффикс `Async` по конвенции проекта. Сбивает
  с толку — читатель ожидает `await`.
- **Возможные решения:**
  1. Переименовать в `validateGraph` (правка контроллера + тестов).
  2. Обернуть в `Promise.resolve()` (костыль, не рекомендуется).
- **Не блокер:** косметика. Исправить при следующей правке Engine.

---

### KI-466 — `download` у кнопки DOCX игнорируется для cross-origin S3 (Low)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Запланировано:** v0.10.x
- **Файлы:** `web/src/components/nodes/DocumentGenNode.tsx`
- **Описание:** кнопка «Скачать DOCX» — `<a download>`. Для локального
  хранилища (`/media/file/...`, same-origin) браузер сохраняет файл, а для
  presigned S3 URL атрибут `download` игнорируется: ссылка открывается в новой
  вкладке (файл всё равно можно сохранить). Это ограничение браузера, не
  ошибка ссылки.
- **Решение:** проксировать скачивание через backend-ручку с
  `Content-Disposition: attachment` либо отдавать документы только через
  same-origin `/media/file/...`; до этого поведение остается нативным.
- **Связанные:** KI-425, KI-443.

---

### KI-579 — Реестр метрик на процесс: multi-instance скрейп
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-03
- **Файлы:** `src/metrics/metrics.service.ts`
- **Описание:** собственный `Registry` живёт в памяти процесса; при нескольких backend-инстансах Prometheus должен скрейпить каждый pod, агрегация — на его стороне. Pushgateway нет; метрики сбрасываются при рестарте.
- **Решение:** scrape-config и recording rules в S6 (`docker-compose.prod`/deploy); дашборды агрегируют по инстансам.

### KI-415 — `/media/file/:runId/:fileName` публичен
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — HMAC-подписанные ссылки `?expires=&sign=`
  (`src/media/media-url-signer.ts`), контроллер проверяет подпись и срок;
  секрет — `MEDIA_URL_SIGNING_SECRET` (fallback `JWT_SECRET`), TTL —
  `MEDIA_URL_TTL_SECONDS` (default 3600).
- **Файлы:** `src/media/media-storage.controller.ts`,
  `src/media/media-url-signer.ts`, `.env.example`
- **Описание:** `<img src>` не несёт `Authorization` → ручка без auth.
  Защита: непредсказуемый `runId` (uuid) + sanitize key. Нет signed URL.
- **Решение:** signed URL (HMAC параметр `?sign=...`) или JWT в cookie.
- **Связанные:** KI-362, KI-197.

---

### KI-387 — Несколько инстансов backend делят очередь BullMQ: job узла выполняет чужой воркер
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.0 (R7.2b, коммит `2172d1a`)
- **Fix:** изоляция инстансов в два рубежа: (1) префикс очереди и номер
  логической БД Redis — `BULLMQ_PREFIX` + `REDIS_QUEUE_DB` (env, дефолты
  `workflow-runs` / `0`); (2) маркер `instanceId` в payload job'а —
  `RUNS_INSTANCE_ID`, чужое задание пропускается с логом. `.env.example`
  документирует dev/smoke/prod-значения.
- **Остаток:** рестарт без явного `INSTANCE_ID` оставляет run в `pending`
  (KI-391); операционная миграция префикса `bull` → `workflow-runs`
  (KI-394).
- **Файлы:** `src/runs/runs.processor.ts`, `src/runs/runs.worker-options.ts`,
  `src/redis/redis.module.ts`, `src/config/env.schema.ts`, `.env.example`
- **Описание:** Обнаружено смоуком R7.2: UI-запуск, созданный backend-ом с
  mock-upstream, был выполнен воркером параллельного backend-а с **боевым**
  ключом CreativeLab — узлы ушли в настоящий upstream и списали 80.38 ₽
  (`wan-2.5` 55 ₽, `suno` 24 ₽, `tts2` 1.38 ₽). Воркеры не привязаны к
  инстансу: очередь одна на всех (`REDIS_URL`), поэтому «кто первый взял».
- **Решение:** префикс/отдельная БД Redis на окружение (`REDIS_URL` c `/N`),
  либо маркер инстанса в job'е и отказ чужим воркерам.
- **Связанные:** KI-032, KI-046, R7.2.

---

### KI-132 — Инпуты внутри узлов не темизированы
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.0 (коммит `1c3d948`)
- **Файлы:** `web/src/components/nodes/TextNode.tsx`,
  `web/src/components/nodes/LLMNode.tsx`,
  `web/src/components/nodes/ImageGenNode.tsx`,
  `web/src/components/nodes/BaseNode.tsx`
- **Описание:** После R5.2 карточки узлов стали тёмными, но инпуты
  внутри них оставались светлыми: селекты (`LLMNode`,
  `ImageGenNode`) — из-за `bg-white`, textarea (`TextNode`) — из-за
  UA-дефолта контролов при незаданном фоне (в таблице соответствий
  такой замены не было — фон пришлось добавить). На тёмной карточке
  это выглядело как белые прямоугольники; рамка карточки в статусе
  pending оставалась `border-slate-300` (светлое кольцо).
- **Fix:** `TextNode.tsx` (textarea), `LLMNode.tsx` (select),
  `ImageGenNode.tsx` (2 select + цена + placeholder результата),
  `BaseNode.tsx` (рамка pending → `border-node-pending`) переведены
  на переменные `bg-background`, `border-border`, `text-foreground`,
  `text-muted-foreground`, `disabled:bg-muted`. Заметный фокус —
  `focus:border-primary focus:ring-1 focus:ring-primary`.
- **Остаток:** статусные фоны узлов (`bg-blue-50/bg-green-50/
  bg-red-50`) — R5.3 (KI-133).
- **Связанные:** KI-125, KI-133.

---

### KI-432 — Порог промпт-кэша считается в символах, а не в токенах
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/llm/providers/anthropic.provider.ts`
- **Описание:** `buildSystemParam` сравнивает `systemPrompt.length` (символы) с
  `PROMPT_CACHE_MIN_TOKENS` (заявленные токены). Для латиницы символов больше,
  чем токенов, и порог срабатывает с запасом; для кириллицы наоборот — 1024
  символа ≈ 400–500 токенов, то есть `cache_control` ставится на промпт короче
  минимального кэшируемого Anthropic (1024 токена), и кэш не создаётся, хотя
  флаг включён.
- **Решение:** оценивать токены (tokenizer или эвристика по языку) либо явно
  переименовать переменную в `PROMPT_CACHE_MIN_CHARS` и подобрать порог под
  реальную токенизацию.
- **Связанные:** KI-414, KI-431.

---

### KI-473 — Коллизия ссылок в `node-executors.ts`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/engine/node-executors.ts`
- **Описание:** В коде есть ссылка на `KI-467` (в контексте CSV-разбора), но `KI-467` теперь занят Docker-проблемой (`serve-static`). Нужно поправить комментарий на `KI-474`.

---

### KI-551 — Счётчик «Показано N из M» может опережать список
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/RunHistoryModal.tsx`
- **Описание:** `total` — общее число запусков на момент **каждого** запроса.
  Если при открытой модалке появился новый запуск, он оказывается «выше»
  первого курсора и в догружаемые страницы не попадает: внизу будет
  «Показано 25 из 26» и подпись «Дальше запусков нет». Список не обновляется
  в реальном времени (KI-543), поэтому это ожидаемо, но текст может вводить в
  заблуждение.
- **Решение:** polling/SSE (KI-543) либо при `nextCursor === null` показывать
  только «Показано N» без «из M». В v0.16 S1 подпись конца изменена на
  «Дальше запусков нет», чтобы не утверждать, что список полный.

---

## v1.0.0 — Organizations DB & Auth (S1, 2026-11-02)

### KI-443 — presigned `stored_url` живёт 1 час и не переподписывается
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.4
- **Файлы:** `src/media/media-storage.service.ts`
- **Описание:** `storedUrl` приватного бакета — presigned GET, подписанный
  один раз при загрузке (`S3_SIGNED_URL_TTL_SECONDS = 3600`) и сохранённый
  в `node_runs.stored_url`. Через час ссылка в UI, истории запусков и
  SSE-событиях начинает отдавать 403: `getSignedUrlAsync` при чтении никто
  не вызывает.
- **Решение:** хранить ключ объекта и подписывать на чтении — отдельный
  route с redirect 302 на свежий presigned URL (либо поле `storage_key` в
  ответе media-узла); TTL ссылки выбирать не меньше времени жизни записи.
- **Связанные:** KI-425, KI-426, KI-412.

---

### KI-057 — `isConfigured` не подхватывает смену ключа без перезапуска
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/providers/*.provider.ts`
- **Описание:** `isConfigured` вычисляется один раз в конструкторе.
  Добавление/смена ключа в `.env` не подхватывается до перезапуска
  процесса: UI останется «недоступным», пока приложение не
  перезапустят.
- **Решение:** читать ключ на каждый вызов или предусмотреть
  переинициализацию клиента.
- **Когда чинить:** при добавлении «горячей» ротации ключей.
- **Связанные:** KI-039.

---

### KI-476 — Реестр KI: KI-001 ломает счётчики статусов
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `docs/KNOWN_ISSUES.md` (KI-001, сводка)
- **Описание:** KI-001 — шаблон, но его строка «формата полей» была
  оформлена как поле статуса со значением `Open / ...`, поэтому grep и
  парсеры считали шаблон ещё одной Open-записью: 259 вместо 258. После
  переименования строки в «Допустимые статусы» KI-001 учитывается только
  как `Documented`.
- **Решение:** в KI-001 оставлен только реальный статус `Documented`;
  для предотвращения регресса проверять
  `count("### KI-") == summary.total` и не дублировать поле статуса
  в описании формата.
- **Связанные:** KI-001, KI-473, KI-474.

---

### KI-345 — `--env-file=.env` на Node 24/Windows даёт `.env: not found`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `package.json` (`test:parity`)
- **Описание:** Не «ENOENT .env» как ожидалось; вывод зависит от версии Node.
- **Решение:** уточнить в PROMPT/RULES фактический текст ошибки.
- **Связанные:** KI-318.

---

### KI-334 — `chunkSizeWarningLimit` исчерпан
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `952d8b6`)
- **Файлы:** `web/vite.config.ts`
- **Описание:** b2 добавил +0.78 kB Zod-схемы (700.66 при лимите 700) — RULES 3.6 «0 warnings» был нарушен.
- **Решение:** поднять лимит (сделано) либо code-split.
- **Fix:** `build.chunkSizeWarningLimit` 700 → 710 — b2 добавил +0.78 kB
  Zod-схемы (700.66 при лимите 700), RULES 3.6 «0 warnings» был нарушен.
  Долгосрочно — code-split (KI-008/DESIGN v0.7 § 4.5).
- **Связанные:** KI-008.

---

### KI-586 — Нет управления участниками: смена роли и удаление из организации
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S2) |
  **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`,
  `web/src/components/TeamPage.tsx`
- **Описание:** S5 даёт только приглашение. `PATCH /admin/members/:userId`
  (смена роли) и `DELETE /admin/members/:userId` (исключение) отсутствуют, хотя
  DESIGN § 2.1 называет роль Admin «управлением командой». Менять роль/состав
  можно только SQL'ом. Нужны продуктовые правила: защита `owner`, «последний
  владелец», что происходит с workflow исключённого.
- **Решение:** отдельный срез: сервисные методы с транзакцией + аудит
  (`member.role_change`, `member.remove`), UI-контролы, запрет удалить
  последнего owner, политика переноса workflow (вместе с KI-583).
- **Fix (v1.1.0 S2):** `PATCH /admin/members/:userId` (смена роли
  `admin`/`member`/`viewer`) и `DELETE /admin/members/:userId` — только
  `owner` (`OrgOwnerOnlyGuard`, роль из БД). Запреты: себе роль не меняем
  (400), себя не удаляем (400), роль `owner` неизменяема (400), участник чужой
  организации неотличим от несуществующего (404). Удаление — выход из
  организации: в одной транзакции графы участника передаются владельцу, его
  строки `workflow_collaborators` удаляются, участник переезжает в новую личную
  организацию (`owner`), refresh-токены отзываются; аудит — `member.role_change`
  и `member.remove`. UI: селект роли и кнопка «Удалить» (`window.confirm`) в
  строке участника, видны только владельцу. Остатки — KI-599..604.
- **Связанные:** KI-554, KI-570, KI-583, KI-599, KI-601, KI-603.

### KI-088 — `LMSTUDIO_MODELS` не имеет автообнаружения
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.7.2-pre (коммит `ed945cd`)
- **Файлы:** `src/llm/llm-provider.factory.ts`, `src/llm/llm.module.ts`
- **Описание:** Список моделей LM Studio задавался вручную в env,
  хотя сервер отдаёт их через `GET /v1/models`. Если в env модель
  указана, а в LM Studio её нет — ошибка всплывала только на
  вызове.
- **Fix:** `createLmStudioProvider` стал асинхронным
  (`createProvidersAsync` в `LlmModule`): при старте запрашивается
  `GET {LMSTUDIO_BASE_URL}/models` с таймаутом 3 с. Каталог
  сливается: env-записи сохраняют свои модальности (приоритет),
  найденные в API добавляются как `text`, отсутствующие в API
  остаются с предупреждением, недоступный сервер — fallback на env.
- **Когда чинить:** — (закрыто, v0.7.2-pre)
- **Связанные:** KI-177.


### KI-547 — `data.provider` может ссылаться на провайдера без ключа
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `web/src/components/nodes/WebSearchNode.tsx`,
  `src/web-search/web-search.registry.ts`
- **Описание:** Выбранный в узле провайдер сохраняется в граф. Если после этого
  ключ провайдера убрали из env, Run падает понятной ошибкой (`[... ключ не
  задан]`) — это верно. Но UI не помечал сохранённый выбор недоступным:
  провайдера нет среди `configured`-опций, `<select>` визуально показывает
  первый пункт («По умолчанию»), хотя `data.provider` остаётся старым. Перед
  запуском пользователь видел не то значение, которое выполнится. Тот же эффект
  был у env-дефолта без ключа: при одном сконфигурированном провайдере селект
  скрывался, и выбрать работающего было нельзя.
- **Решение:** реализовано в v0.15 S1. Селект показывается, если сохранённый
  провайдер недоступен или env-дефолт не сконфигурирован (даже при одном
  доступном); недоступные варианты рендерятся `disabled`-опциями («По умолчанию
  недоступен», «— нет ключа»), значение не подменяется молча. Backend-ошибка
  сохранена (фолбэк на другого провайдера менял бы семантику поиска).

### KI-218 — Нет юнит-тестов `parseDurationToMs` и интеграционного теста ротации
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/common/utils/parse-duration.ts`,
  `src/auth/auth.service.spec.ts`
- **Описание:** `parseDurationToMs` покрыт только косвенно (`7d`).
  Нет кейсов `30s` / `15m` / `1h`, пробелов, неверного формата.
  Ротация проверена смоуком, но не интеграционным тестом на реальной
  БД (мок `transaction` откат не проверяет).
- **Решение:** юнит-тесты `parseDurationToMs` + интеграционный тест
  ротации.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201.

---

### KI-440 — `api-contract.json` не кодирует enum-домены
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.3
- **Fix:** добавлена секция `enums` (поле → отсортированный список значений);
  паритет-спеки backend и web сверяют домены наравне со списками полей.
- **Файлы:** `docs/development/api-contract.json`
- **Описание:** контракт хранит только имена полей
  (`"CollaboratorResponse": ["email", "invitedAt", "invitedBy", "role", "userId"]`),
  но не допустимые значения. Домены `role` (`owner`/`viewer`/`editor`) и
  `accessRole` не сверяются: обе стороны (backend и `web/src/lib/api.ts`) могут
  разойтись в enum, а `api-contract.spec.ts` с обеих сторон этого не заметит —
  ровно расхождение класса KI-437 ловится только руками.
- **Решение:** добавить в контракт секцию `enums` (поле → отсортированный
  список значений) и сверять её в обоих spec'ах наравне со списками полей.
- **Связанные:** KI-358, KI-437, KI-399.

---

### KI-286 — CDP-смоук: Ctrl+A вставляет символ; каталог требует scrollIntoView
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** временные скрипты смоука (вне репо)
- **Описание:** `Input.dispatchKeyEvent` с полем `text` для `Ctrl+A`
  вставляет символ (`a`) в пустое поле — для «очистить поле» нужен
  `DOM-setSelectionRange(0, len)`. Пункты каталога ниже `max-h-80`
  требуют `scrollIntoView` перед кликом по координатам — иначе
  `elementFromPoint` попадает в контейнер.
- **Связанные:** KI-264, KI-275.

---

### KI-322 — Подграф вне топ-50 `GET /workflow` → warning недостижим
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/components/nodes/SubWorkflowNode.tsx`,
  `web/src/lib/api.ts`, `src/workflow/workflow.controller.ts`
- **Описание:** `listWorkflowsAsync` без `limit` при default limit=50
  и `createdAt DESC`; подграф вне топ-50 → `selected === undefined`,
  warning «есть новая версия» в `sub_workflow` не появится.
- **Связанные:** KI-200.

---

### KI-481 — DESIGN § 3.1.3: порядок `asText()` и `uncompressedSize` ломает fail-closed (Low)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.11.0 (S2) — в `DocumentTemplateService.assertDocxArchive`
  лимиты распаковки считаются по метаданным **до** первых `asText()`; в
  DESIGN v0.11 § 3.1.3 добавлена поправка реализации.
- **Файлы:** `src/documents/document-template.service.ts`,
  `docs/development/v0.11/DESIGN_V011_FEATURES.md`
- **Описание:** в псевдокоде DESIGN проверка макросов через
  `zip.file('[Content_Types].xml')?.asText()` стоит до подсчёта
  `_data.uncompressedSize`. PizZip лениво распаковывает запись и при
  `asText()` подменяет `_data`: после чтения текста `uncompressedSize` уже не
  число. Реализация «строго по псевдокоду» отклонила бы **любой** шаблон по
  fail-closed ветке, то есть проверка не работала бы вовсе.
- **Решение:** переставить проверки: сначала записи/размеры (метаданные), затем
  макросы и скан DTD (текст). Набор проверок не изменён; тесты фиксируют, что
  обычный шаблон проходит, а битый ZIP, макросы, XXE и zip bomb — нет.
- **Связанные:** DESIGN v0.11 § 3.1.3, v0.11 S2.

---

### KI-263 — В «тесной» раскладке вставляемый узел перекрывает соседей
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.9.1 — сдвиг перпендикулярно связи.
- **Файлы:** `web/src/App.tsx` (шаг раскладки Toolbar),
  `web/src/components/Canvas.tsx`
- **Описание:** Toolbar раскладывает узлы с шагом 280 px при ширине
  карточки 240 px → зазор 40 px. Вставленный узел 240 px **физически**
  не может не перекрыть соседей: замер — 100×123 с источником и
  100×203 с приёмником. KI-260 (центрирование) исправлен, но
  остаточное перекрытие — свойство раскладки.
- **Решение:** раздвигать соседей при вставке; сдвигать узел
  перпендикулярно связи; увеличить шаг раскладки в `App.tsx`
  (280 → 400+).
- **Связанные:** KI-260, KI-185.

---

### KI-472 — API-префиксы продублированы в `app.module.ts` и `web/src/lib/api-prefixes.ts` (Low)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — единый реестр `api-prefixes.json` в корне
  репозитория; backend (`src/common/api-prefixes.ts`) строит из него RegExp
  SPA-fallback'а, frontend (`web/src/lib/api-prefixes.ts`) — Vite-прокси.
  Паритет-спека `src/common/api-prefixes.spec.ts` читает JSON напрямую.
- **Файлы:** `src/app.module.ts`, `src/common/api-prefixes.ts`,
  `api-prefixes.json`, `src/common/api-prefixes.spec.ts`,
  `web/src/lib/api-prefixes.ts`
- **Описание:** `API_ROUTE_PATTERN` в `app.module.ts` перечисляет префиксы
  (`api`, `auth`, `llm`, `media`, `workflow`, `engine`, `runs`, `templates`,
  `nodes`) вручную. Источник правды для frontend/Vite — `api-prefixes.ts`,
  паритет которого проверяется spec'ами. При добавлении нового контроллера
  список в `app.module.ts` можно забыть, и SPA-fallback начнёт отдавать
  `index.html` вместо JSON-404 для неизвестной API-ручки.
- **Решение:** генерировать regex/список из единого машинночитаемого
  источника (например, `api-prefixes.json` в `docs/development/`), либо
  добавить паритет-спек `api-prefixes.spec.ts`, который сравнивает regex с
  реестром. До этого — синхронизировать вручную при каждом новом контроллере.
- **Связанные:** KI-299, KI-467.

---

### KI-587 — `GET /admin/audit` по-прежнему доверяет `orgId` из access-токена
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S3) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/audit/admin-audit.controller.ts`, `src/audit/audit.service.ts`
- **Описание:** S5 закрыл KI-554 только для `/admin/members*`, где организация
  резолвится из `users`. `AdminAuditController.list` передаёт в
  `AuditService.listAsync` `toWorkflowAccess(user)`, то есть `orgId` из JWT:
  после переезда пользователя в другую организацию (когда появится перенос,
  KI-583) журнал старой организации остаётся видимым до истечения access-токена
  (24 ч).
  **Ошибка реестра:** HEAD S2 содержал у этого KI статус «Fixed в v1.1.0 (S2)»,
  хотя S2 аудит не менял: контроллер всё ещё передавал `toWorkflowAccess(user)`.
  Фактическое исправление — S3.
- **Решение:** резолвить организацию из строки `users` (как в
  `OrgMembersService`) либо сократить TTL access-токена и валидировать
  членство при refresh.
- **Fix (v1.1.0 S3):** контроллер передаёт в `AuditService.listAsync` только
  `user.sub`; `AuditService` первым запросом читает `users.organization_id` по
  `id` и фильтрует журнал по нему. `JwtPayload.orgId` в коде аудита больше не
  используется. Нет строки `users` — 401 (`UnauthorizedException`) до чтения
  журнала. Тесты: `audit.service.spec.ts` (организация из `users`, а не из
  аргумента; устаревший/чужой org не попадает в SQL),
  `admin-audit.controller.spec.ts` (в сервис уходит только `sub`, `orgId`
  токена не утекает ни в один аргумент), живой смоук 31/31 (удалённый B видит
  пустой журнал своей новой организации).
- **Связанные:** KI-554, KI-563, KI-601, KI-605.

### KI-209 — KI-номера в CHANGELOG `[0.1.0] → ### Planned` — не ссылки на реестр
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `docs/CHANGELOG.md`
- **Описание:** Раздел `[0.1.0] → ### Planned` содержит строки вида
  `KI-106 — Аутентификация (JWT + Passport)`. Эти KI-номера —
  **исторические идентификаторы фич** из плана v0.1.0, а не ссылки на
  реестр. С момента создания `KNOWN_ISSUES.md` нумерация разошлась:
  там `KI-106` = «Идемпотентность media». Именно из-за этой коллизии
  в R6.1a была ошибочно заведена запись «KI-106 → Fixed» (откачена,
  см. KI-212).
- **Решение:** (1) добавить оговорку в начало `### Planned`;
  (2) провести разовую ревизию — сверить все `KI-\d+` из CHANGELOG
  с реестром на совпадение смысла (потенциально другие коллизии).
- **Когда чинить:** оговорка — docs-коммит R6.1a (сейчас); ревизия —
  отдельной задачей v0.8.x.
- **Связанные:** KI-212, RULES 3.18.

---

### KI-071 — `/favicon.ico` → 404 в консоли
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `web/index.html`
- **Описание:** В smoke A единственная «ошибка» в консоли — 404 на
  favicon (в успешном прогоне не было из-за кэша).
- **Что сделано:** favicon встроен SVG data-URI в `<head>` (`<link rel="icon"
  href="data:image/svg+xml,…">`) — отдельный файл не нужен, браузер больше не
  запрашивает `/favicon.ico`. Проверено CDP-smoke R4.3b: `responseErrors: []` и
  `consoleErrors: []` во всех прогонах.
- **Связанные:** —

---

### KI-407 — Agent и `llm_call` обходят `CostBudgetService`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 (коммит `a1ccf86`) — стоимость шагов агента
  учитывается в `CostBudgetService` (`assertWithinBudgetAsync`).
- **Файлы:** `src/agent/agent.service.ts`
- **Описание:** `LlmNodeExecutor` пишет `cost_usd` в `node_runs`, а
  `AgentService` вызывает `LlmService.generateAsync` напрямую.
  `tokens_in` / `tokens_out` / `cost_usd` у агента остаются `NULL`. Бюджет
  KI-048 не учитывает циклы агента.
- **Решение:** передавать usage шагов в движок для учёта.
- **Связанные:** KI-048, KI-384, KI-406.

---

### KI-538 — В `workflow_runs` нет длительности и стоимости запуска
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-11-02
- **Файлы:** `src/runs/runs.service.ts`, `src/engine/execution-engine.service.ts`,
  `src/db/schema.ts`
- **Описание:** `duration_ms`/`cost_usd`/`cost_rub` есть только у `node_runs`.
  История запусков (v0.14 S1) считает `durationMs` из
  `finished_at − started_at`, а стоимости агрегирует отдельным запросом
  `sum(...) GROUP BY run_id`. Плюс: нет денормализации и расхождений с
  `node_runs`; минус: на каждый запрос истории — агрегат по `node_runs`, а
  фильтровать/сортировать запуски по стоимости нельзя.
- **Решение:** писать итоговые `duration_ms`/`cost_usd`/`cost_rub` в
  `workflow_runs` в `finishRunAsync` (миграция + backfill), историю перевести
  на чтение этих колонок. Оценка: ~0.5 сессии.

### KI-086 — Frontend `ApiNodeDataSchema` не содержит `model` / `value` / `imageUrl`
- **Приоритет:** 🟢 Low | **Статус:** Won't Fix | **Обнаружено:** 2026-10-13
- **Закрыто:** 2026-10-13 (не воспроизводится)
- **Файлы:** `web/src/lib/api.ts`
- **Описание:** Zod-схема для `ApiNodeData` при **загрузке**
  сохранённого workflow **не пропускает** поля `data.model`,
  `data.value`, `data.imageUrl`. При Load модель LLM-узла и текст
  Text-узла **теряются**. Это **блокер** для smoke v0.5.0, если
  перезагрузить страницу после Save.
- **Решение:** расширить `ApiNodeDataSchema` (`.passthrough()`
  или явные поля). Проверить, что Save/Load **round-trip**.
- **Когда чинить:** v0.5.1 (**до** smoke с провайдерами).
- **Связанные:** KI-017.
- **Обоснование:** схема называется `ApiNodeSchema` (не
  `ApiNodeDataSchema`); поле `data` — `z.record(z.string(),
  z.unknown())`, то есть **free-form словарь**: любые строковые
  ключи (`model`, `value`, `imageUrl`) сохраняются без потерь.
  Smoke v0.5.0 подтвердил round-trip Save → F5 → Load. Ошибочная
  классификация (dsh предположил строгую типизацию).
- **Заметка:** типизацию `data` можно сузить до discriminated union
  по `kind` — **не баг**, а **улучшение type-safety**. Отдельная
  задача, не сейчас.
- **Связанные:** KI-017.

---

### KI-329 — Share pointer-events-none блокирует zoom/pan
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `c6edf91`)
- **Файлы:** `web/src/components/ShareViewPage.tsx`
- **Описание:** Обёртка `pointer-events-none` гасит и wheel-zoom, и
  pan. В связке с KI-328 граф с разбросом невозможно рассмотреть.
- **Решение:** разрешить zoom/pan без перетаскивания узлов, либо не
  опускать fit ниже читаемого порога.
- **Fix:** снят `pointer-events-none` с обёртки <ReactFlow> на
  ShareViewPage; явные `nodesDraggable={false}`,
  `nodesConnectable={false}`, `elementsSelectable={true}`,
  `panOnDrag={true}`, `zoomOnScroll={true}`; поля карточек инертны
  точечно. CDP SH-5 (wheel 0.0104 → 0.5 → 0.87), SH-6 (pan Δx=260,
  Δy=160), SH-8 (4 контрола с `pointer-events: none`), SH-10 — причинная
  проверка (снять override → воспроизвести → вернуть → снять).
- **Связанные:** KI-197, KI-330, KI-331.

---

### KI-447 — Route-level lazy для Canvas/ShareViewPage
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `web/src/App.tsx`
- **Описание:** кандидат от dsh для дальнейшего снижения first-load:
  `Canvas` и `ShareViewPage` импортируются в `App.tsx` статически, поэтому
  `@xyflow/react` и стили холста попадают в основной чанк даже на
  `/login`, где холст не нужен. Узлы уже ленивые (KI-008), страницы — нет.
- **Решение:** `React.lazy(() => import('@/components/Canvas'))` и то же
  для `ShareViewPage` под общим `<Suspense>`; проверить, что `/` под
  `ProtectedRoute` не мигает пустым экраном при cold load.
- **Связанные:** KI-008, KI-390.

---

### KI-106 — Идемпотентность работает только при повторе с тем же runId
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/media/media-node-executor.service.ts`
- **Описание:** `idempotencyKey = ${runId}:${nodeId}`. Если запуск
  пересоздадут (новый `runId`), а задача в upstream останется
  «висеть», генерация оплатится заново. Защиты от двойного списания
  при нажатии Run дважды нет.
- **Решение:** переиспользовать активный запуск или дедуплицировать
  задачи по `(workflowId, nodeId, hash(prompt, params))`.
- **Когда чинить:** при появлении жалоб на двойное списание.
- **Связанные:** KI-040, KI-046.

---

### KI-560 — Legacy кросс-организационные строки `workflow_collaborators` не используются и не чистятся
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/workflow/workflow.service.ts`, `src/db/schema.ts`
- **Описание:** после S2 доступ участника требует совпадения организации
  (`workflows.organization_id`), а `GET /workflow/:id/collaborators` фильтрует
  участников по `users.organization_id`. Строки, созданные до S2 (после
  бэкфилла S1 все они кросс-организационные), больше не дают доступа и не
  видны владельцу (скрывается email чужой организации), но остаются в БД
  (на dev-БД такая строка одна). Чистки/миграции нет; владелец при знании uuid
  всё ещё может сменить роль/удалить строку — эндпоинты по `participantId` не
  проверяют организацию участника.
- **Решение:** в S5 (управление командой) миграция-аудит: удалить или
  переоформить кросс-организационные строки на общую организацию; опционально
  CHECK/триггер «участник и workflow в одной организации» (сейчас SQL-инвариант
  не выражен).
- **Связанные:** KI-558, KI-563, KI-564.

### KI-461 — UI `web_search` не покрывает поля DESIGN `searchDepth`/`topic` (Low)
- **Приоритет:** 🟢 Low | **Статус:** Deferred | **Обнаружено:** 2026-10-18
- **Запланировано:** v0.10.x
- **Файлы:** `web/src/components/nodes/WebSearchNode.tsx`,
  `src/engine/node-executors.ts`, `src/web-search/web-search.interface.ts`
- **Описание:** DESIGN v0.10 § 3.1.5 перечисляет `searchDepth`,
  `includeAnswer`, `topic` и `days`, но провайдерский интерфейс S1 принимает
  только `maxResults`. UI S2 честно показывает `query`/`maxResults`, а
  Zod-схема отбрасывает неизвестные ключи. Расширение требует сначала
  расширить `WebSearchOptions`/Tavily-запрос, иначе поля были бы мёртвыми.
- **Решение:** добавить опции в `IWebSearchProvider` (S1) и только затем
  вывести поля в узле; до этого не показывать настройки, которые никуда не
  уходят.
- **Связанные:** KI-459, DESIGN v0.10 § 3.1.1/§ 3.1.5.

---

### KI-060 — Нет докачки событий при переподключении
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs-stream.service.ts`
- **Описание:** Nest нумерует сообщения (`id: 1, 2, ...`), но
  `Last-Event-ID` не обрабатывается: разорванный и переподключившийся
  клиент получит только snapshot (состояние из БД компенсирует),
  а промежуточные переходы (`node_started` → `node_completed` внутри
  разрыва) не увидит как события.
- **Решение:** хранить историю событий (Redis Stream вместо pub/sub)
  и отдавать пропущенное по `Last-Event-ID`.
- **Когда чинить:** до прод-надёжности.
- **Связанные:** —

---

### KI-561 — Необязательный `WorkflowAccess` оставляет внутренние пути без фильтра
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/workflow/workflow.service.ts`, `src/runs/runs.service.ts`,
  `src/documents/document-templates.service.ts`
- **Описание:** `findAllAsync`/`findOneAsync`/`updateAsync`/`removeAsync`/
  `createRunAsync`/`getRunAsync`/`listNodeRunsAsync`/`getRunRowAsync` принимают
  `access?`; без него фильтр по пользователю/организации не применяется
  (совместимость внутренних вызовов и тестов, все HTTP-пути всегда передают
  `toWorkflowAccess(user)`). Будущий внутренний вызов без `access` тихо обойдёт
  изоляцию — компилятор этого не поймает.
- **Решение:** сделать `access` обязательным (и, при необходимости, отдельный
  internal-метод), либо dev-assert: в non-test окружении `!access` → исключение.
- **Связанные:** S2, KI-554.

### KI-123 — `NODE_TYPE_LABELS/ICONS` дублируются в тулбаре
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.1 (коммит `990e705`)
- **Файлы:** `web/src/components/Toolbar.tsx`
- **Описание:** `Toolbar.tsx` держит собственный массив `BUTTONS` с
  `label` и `icon`, хотя те же строки есть в `NODE_TYPE_LABELS/ICONS`.
  Согласовано сейчас, но при переименовании легко поправить одно
  место и забыть второе.
- **Решение:** строить `BUTTONS` из `NODE_TYPE_LABELS/ICONS`.
- **Когда чинить:** — (закрыто, v0.6.1).
- **Fix:** `Toolbar` берёт иконку из `NODE_REGISTRY[type].iconEmoji`
  (📝🤖🖼) и подпись из `NODE_REGISTRY[type].labelEn`
  (Text / LLM / Image Generation). Визуал v0.6.0 сохранён.
  Локальный массив `BUTTONS` удалён полностью.
- **Остаток:** два набора имён/иконок (RU/текст + EN/эмодзи) —
  свести к одному ключу + локали при i18n (KI-126).
- **Связанные:** KI-121, KI-126.

---

### KI-030 — Хендлы фронтенда не совпадают с портами бэкенда
- **Приоритет:** 🔴 Critical | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `a7a9da0`)
- **Файлы:** `src/engine/node-ports.ts`, `src/engine/engine.service.ts`,
  `src/engine/engine.service.spec.ts`, `src/engine/node-ports.spec.ts`
- **Описание:** UI рисует handle id `text-output` / `image-output` /
  `text-input`, а исполнители отдают порты `text` / `url`. React Flow
  пишет id хендла в `edge.sourceHandle`, поэтому для любой связи,
  собранной в редакторе, `fromPort = 'text-output'` и
  `collectInputsAsync` кладёт `null`. KI-022 закрыл только случай
  «`sourceHandle` не задан вовсе» (API-графы); для UI-графов данные
  по-прежнему теряются молча.
- **Возможные решения:**
  1. Переименовать хендлы во фронтенде в `text` / `url` (R4).
  2. Переименовать выходные порты исполнителей и дефолты в
     `node-ports.ts` в `text-output` / `image-output`.
  3. Свести обе системы имён в один реестр (`node-ports.ts` хранит
     и `handleId`, и имя порта) и маппить на границе. **Выбрано.**
- **Когда чинить:** до R3 (LLM-вызовы). Нужен единый контракт до R3/R4.
- **Связанные:** KI-022.
- **Fix:** единый реестр `NODE_PORT_CONTRACT` (`sourceHandleId` +
  `outputPortName` + `targetHandleId`) и `handleIdToOutputPort()` в
  `src/engine/node-ports.ts`. `fromPort = handleIdToOutputPort(sourceHandle)
  ?? inferDefaultOutputPort(sourceNode.type)`. `DEFAULT_OUTPUT_PORT_BY_NODE_TYPE`
  теперь **выводится** из `NODE_PORT_CONTRACT` — рассинхрон имён невозможен.
  +8 тестов. Smoke: UI-граф (`sourceHandle='text-output'`) — `B.inputs`
  не пустой.
- **Остаток:** KI-033 (неизвестный хэндл → тип-дефолт), KI-034
  (асимметрия входов/выходов).

---

### KI-359 — inline-union'ы финальных статусов запуска вне канона
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts` (:164, :370, :1208),
  `src/runs/runs.processor.ts` (:220)
- **Описание:** канон после v0.8.5 — `db/schema.ts`; но сигнатуры
  `finishRunAsync`, обработчик события и процессор повторяют
  `'completed' | 'failed'` литералами. Переименование статуса не
  подсветится компилятором.
- **Решение:** `export type TerminalRunStatus = (typeof
  TERMINAL_WORKFLOW_RUN_STATUSES)[number]` и заменить inline-union'ы.
- **Связанные:** KI-353, KI-336.

---

### KI-361 — Video / Audio / Music узлы (media-generation)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.2)
- **Fix:** зарегистрированы три типа узлов — `video_generation`,
  `audio_generation`, `music_generation`; добавлены компоненты
  `VideoGenNode`/`AudioGenNode`/`MusicGenNode`, Zod-схемы и маршрутизация
  в `MediaNodeExecutor` (`executeVideoAsync`/`executeAudioAsync`/
  `executeMusicAsync`).
- **Файлы:** `src/media/media-node-executor.service.ts`,
  `src/media/media-generation.ts`, `web/src/lib/node-registry.ts`,
  `web/src/components/nodes/VideoGenNode.tsx`,
  `web/src/components/nodes/AudioGenNode.tsx`,
  `web/src/components/nodes/MusicGenNode.tsx`
- **Описание (историческое):** Продукт умел только text-to-image
  (CreativeLab). Узлов video_generation / audio_generation /
  music_generation не было. CreativeLab API предоставляет VIDEO/AUDIO/MUSIC
  через тот же endpoint `/api/v2/media`.
- **Решение:** 3 новых узла, реализация — DESIGN v0.9 § 3.2 (R7.2).
- **Связанные:** KI-196, KI-475, DESIGN v0.9 § 3.2.

---

### KI-063 — Финальность не попадает в snapshot
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs-stream.service.ts`, `src/db/schema.ts`
- **Описание:** Если клиент подключился **после** публикации
  `run_completed`, он видит только snapshot. Для `completed` финал
  очевиден из `status`, для `failed` — нет (в БД не хранится,
  остались ли попытки у job'а), и поток остаётся открытым до
  отключения страницы.
- **Решение:** хранить признак финальности в `workflow_runs`
  (например, `final` / `attempts_made` / `attempts`) и отдавать
  в snapshot — тогда R4.2 закроет `EventSource` сразу после snapshot.
- **Когда чинить:** R4.2-prep (нужна миграция) или R4.3.
- **Связанные:** KI-060 (final в SSE, закрыт), KI-064.

---

### KI-520 — MCP-ссылки вне каталога не видны в UI узла `agent`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/components/nodes/AgentNode.tsx`,
  `web/src/lib/agent-node-fields.ts`
- **Описание:** UI рисует только инструменты из `GET /mcp/servers`. Если
  каталог сервера изменился (инструмент переименован/удалён), сохранённая
  ссылка `data.mcpTools` остаётся в графе, но в секции не отображается:
  пользователь не видит её и не может снять. При запуске preflight падает
  `McpToolNotFoundException`/`McpUnavailableException`, а лимит продолжает
  считать такие ссылки, уменьшая доступный выбор.
- **Решение:** показывать отдельную группу «нет в каталоге» с кнопкой снятия
  (или чистить битые ссылки при открытии узла — с уведомлением, не молча).
- **Связанные:** DESIGN v0.11 § 3.2.5/§ 3.2.7, отчёт
  `reports/v0.11.0/S8-mcp-ui.md` § 6.

---

### KI-307 — `autoPanOnNodeDrag` усиливает координаты узла при drag за край
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** `autoPanOnNodeDrag` (дефолт React Flow) панорамирует
  холст на 810–885 px при drag «500 px вверх» → позиция в flow-space
  становится −1304…−1368 вместо −500. При длинном drag накапливаются
  значения вида −21 888 (объясняет происхождение графа в KI-306).
- **Решение:** `by design` React Flow. Если нужно ограничение —
  `autoPanOnNodeDrag={false}` или клампить финальную позицию.
- **Связанные:** KI-306.

---

### KI-037 — Ошибка `buildExecutionPlanAsync` оставляет run в `pending`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `cbc347c`)
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/runs/runs.processor.ts`
- **Описание:** Цикл или битые связи в графе бросают исключение **до**
  `markRunRunningAsync`. `workflow_runs.status` остаётся `pending`
  навсегда — пользователь не видит ни ошибки, ни завершения.
- **Решение:** try/catch вокруг `buildExecutionPlanAsync` в
  `executeAsync` с записью `status='failed'` + `error`.
- **Когда чинить:** вместе с KI-036.
- **Связанные:** KI-036.
- **Fix:** try/catch вокруг `buildExecutionPlanAsync` в `executeAsync`;
  при ошибке — `failRunAsync` (status='failed' + `error` с деталями
  через `describePlanError`). Детерминированные ошибки планирования
  не пробрасываются — BullMQ retry всё равно упал бы так же.

---

### KI-240 — Read-only страница рендерит редакторные node-компоненты
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/ShareViewPage.tsx`,
  `web/src/components/nodes/*`
- **Описание:** На read-only странице используются те же компоненты
  узлов, что в редакторе: поля / селекты выглядят интерактивными
  (отключены только через `pointer-events-none`), компоненты
  подписаны на глобальный store (списки моделей и т.п.).
- **Решение:** «чистые» read-only карточки узлов (или флаг
  `readOnly` в контексте), отключающий подписки и input-элементы.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-197.

---

### KI-114 — `cost_rub` не передаётся в SSE snapshot
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.0b.2.4
- **Файлы:** `src/runs/dto/run-stream-message.dto.ts`,
  `src/runs/runs-stream.service.ts`
- **Описание:** Колонка `node_runs.cost_rub` заполняется executor'ом
  (v0.6.0b.2.2), но `toNodeSnapshot` не мапит её в snapshot SSE.
  Фронтенд **готов** (`costRub` в `NodeRunSnapshotSchema` как
  `.nullable().optional()`), в реальном прогоне панель покажет
  `4200 мс` без цены. Smoke на заглушке — со `costRub: '0.600000'`.
- **Fix:** добавить `costRub: z.string().nullable().optional()` в
  `NodeRunSnapshotSchema`, передавать `cost_rub` в `toNodeSnapshot`.
- **Когда чинить:** **до tag'а v0.6.0** (v0.6.0b.2.4, ~5 мин).
- **Связанные:** KI-038, KI-111.
- **Fix:** `NodeRunSnapshotSchema.costRub: z.string().nullable().optional()`,
  `toNodeSnapshot: row.costRub ?? null`. +1 тест.
- **Замечание:** поле `.optional()` — временная защита совместимости;
  когда фронтенд перестанет поддерживать старые ответы без `costRub`,
  можно сделать обязательным.
  
---

### KI-076 — Панель фиксированной высоты без drag-ресайза
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/RunResultPanel.tsx`
- **Описание:** Высота переключается только между 48px и 288px,
  размер не тянется мышью и не запоминается между сессиями
  (F5 сбрасывает в развёрнутое состояние).
- **Решение:** drag-ресайз + `localStorage`.
- **Когда чинить:** при UX-полировке.
- **Связанные:** —

---

### KI-463 — PDF-режим `document_gen` не реализован в S6 (Low)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.12.0 (S1) — `PdfRenderer` на `pdfkit` + NotoSans
  (`src/documents/pdf-renderer.service.ts`); исполнитель выбирает рендерер по
  `format`, сохраняет `.pdf` с `mimeType: application/pdf`; в UI добавлен
  селект DOCX/PDF. Тесты: `pdf-renderer.service.spec.ts`,
  `document-generation-executor.spec.ts`, `DocumentGenNode.spec.tsx`.
- **Файлы:** `src/engine/node-executors.ts`, `src/documents/pdf-renderer.service.ts`,
  `web/src/components/nodes/DocumentGenNode.tsx`
- **Описание:** `DocumentGenerationNodeDataSchema` знает `format: 'docx'|'pdf'`
  (DESIGN § 3.2.1/§ 3.2.3), но `DocumentService` S3 умеет только DOCX.
  Исполнитель S6 бросает понятную ошибку на `pdf`, а UI не показывает селект
  формата — только источник Markdown/JSON. Молчаливая подмена PDF на DOCX
  была бы хуже: пользователь получил бы не тот файл.
- **Решение:** реализовать `PdfRenderer` (pdfkit + NotoSans, DESIGN § 3.2.3) и
  вывести селект `format` в узле; до этого `pdf` остаётся явной ошибкой.
- **Связанные:** DESIGN v0.10 § 3.2.3/§ 3.2.6.

---

### KI-204 — Frontend шлёт userId в body/query (игнорируется)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0b (коммит `4b1c149`)
- **Fix:** `userId` удалён из `CreateWorkflowSchema` и
  `ListWorkflowsQuerySchema`; владелец — только из токена
  (`user.sub`). Zod `.strip()` сохраняет совместимость со старым
  клиентом. +2 теста.
- **Файлы:** `web/src/lib/api.ts`, `web/src/stores/workflow.ts`,
  `src/workflow/dto/create-workflow.dto.ts`,
  `src/workflow/dto/list-workflows-query.dto.ts`
- **Описание:** После R6.1a backend берёт владельца **только из
  токена**, но DTO/query **продолжают принимать `userId`**. Фронт
  (не тронут, R6.1b) отправляет его. Пока безвредно, но API вводит
  в заблуждение.
- **Решение:** убрать `userId` из `CreateWorkflowSchema` и
  `ListWorkflowsQuerySchema`; во фронте — убрать из запросов.
- **Когда чинить:** R6.1b.
- **Связанные:** KI-201.

---

### KI-287 — Движок прерывает независимые уровни после первого падения
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.0e (R6.5.2-fix, коммит 987bc5a)
- **Fix:** убран `break` в `executeAsync`; level-цикл проходит план
  до конца. Зависимые узлы получают `null` во входах и падают сами
  (вариант A). Финальный `run.status = failed` при любом упавшем узле.
  +3 теста (Т1/Т2/Т3); смоук A/B подтвердил.
- **Связанные:** KI-288, KI-289, KI-290, RULES 4.16.
- **Файлы:** `src/engine/execution-engine.service.ts`
  (`executeAsync` — `break` при `failures.length > 0`)
- **Описание:** Упавший узел **не даёт выполниться независимым узлам
  следующих уровней** (смоук E2: `http` упал → `condition`/`compare`
  не выполнились). Противоречит **RULES 4.16** («один fail не роняет
  весь run»). В коде описано как намеренное, но фактически нарушает
  правило.
- **Решение:** продолжать независимые ветки, помечая запуск `failed`
  только по факту падений в самом узле.
- **Связанные:** KI-036, KI-047, KI-105.

---

### KI-270 — фронт шлёт мёртвый `userId: 'demo-user'` в POST /workflow
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts` (`DEFAULT_USER_ID`),
  `src/workflow/workflow.controller.ts`
- **Описание:** Backend владельца берёт из JWT и поле игнорирует
  (проверено — workflow принадлежит uuid пользователя), но
  `demo-user` как строка противоречит DESIGN v0.8 § 3.6
  («`demo-user` как строка не используется»; `users.id` — uuid).
- **Решение:** убрать `userId` из клиентского DTO создания.
- **Связанные:** KI-201, KI-202.

---

### KI-115 — `aspectRatio` не материализуется в `data` до первого изменения
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Селект показывает дефолт модели (`auto`), но
  `data.aspectRatio` остаётся `undefined`, пока пользователь не
  сменит значение. Runtime-эффект безобиден (executor отправляет
  `params.aspect_ratio` только если задано, upstream применяет свой
  дефолт), но UI и реальность формально расходятся.
- **Решение:** записывать выбранное значение при создании узла
  либо всегда отправлять `aspect_ratio`.
- **Связанные:** —

---

### KI-360 — Перспектива: вынос vector store в отдельный сервис
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/db/schema.ts`, `src/engine/execution-engine.service.ts`
  (план), новый сервис (перспектива)
- **Описание:** В v0.9 (R7.4) vector store реализуется через pgvector в
  текущей PostgreSQL 17. При росте >10M vectors или >100 QPS
  производительность HNSW-индекса падает, и вынос в специализированный
  сервис (Qdrant / Weaviate / Pinecone) становится оправдан.
- **Решение (перспектива):** отдельный микросервис `vector-store` с
  gRPC/HTTP API; узлы `vector_upsert`/`vector_query` переключаются через
  env `VECTOR_BACKEND=pgvector|qdrant`. Триггер: метрики QPS/latency из
  R7.7 (OTel).
- **Связанные:** KI-128, DESIGN v0.9 § 2.5.

---

### KI-042 — Retry-After из 429 игнорируется, backoff не настраивается
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Задержки захардкожены (500 мс × 2^(n−1), 3 попытки).
  Реальный провайдер при 429 присылает `Retry-After`, который стоит
  уважать; значения — вынести в env (RULES 4.5/4.6).
- **Когда чинить:** до R4 или раньше, если начнутся массовые 429.
- **Связанные:** KI-036, KI-016.

---

### KI-409 — `http_request` без SSRF-защиты
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.1 (коммит `a1ccf86`) — `assertPublicHttpUrlAsync`:
  DNS-резолв + блокировка приватных IPv4/IPv6 и metadata-алиасов.
- **Файлы:** `src/agent/agent-tools.ts`
- **Описание:** нет allowlist / запрета приватных IP. Можно дернуть
  `http://127.0.0.1:3000` и внутренние сервисы.
- **Решение:** zod-url + проверка на private IP.
- **Связанные:** R7.4b.

---

### KI-143 — Нет локального CI-прогона для web перед push
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `package.json` (корневой), возможно `.github/workflows/ci.yml`
- **Описание:** KI-141 и KI-142 — две подряд CI-поломки, которые
  локально НЕ проявлялись: `pnpm/action-setup` не валидируется
  локально, `zod` резолвился из корневого `node_modules`.
  Локальные `pnpm build`/`pnpm test` не эквивалентны job `web`.
- **Решение:** скрипт `pnpm ci:web` (root) — чистый install
  + build + test для web/. Возможно `actionlint` в pre-push.
- **Когда чинить:** при следующей правке CI.
- **Связанные:** KI-141, KI-142, KI-005, KI-068.

---

### KI-308 — `NodesController` без маршрутов (мёртвый модуль)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/nodes/nodes.controller.ts`
- **Описание:** `@Controller('nodes')` с пустым телом (0 маршрутов).
  Проксируется вхолостую, в реестре `API_PREFIXES` числится.
- **Решение:** удалить модуль (если не планируется) или наполнить
  ручками (R4+).
- **Связанные:** KI-072, KI-299.

---

### KI-430 — Регистрозависимость схемы URL
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `web/src/types/media.ts`
- **Описание:** `isRenderableMediaUrl` проверяет префикс `https://` без учёта
  регистра и отвергает `HTTPS://...` (по RFC 3986 схема регистронезависима).
- **Решение:** нормализовать схему (`url.protocol.toLowerCase()`) или
  сравнивать `protocol` через `new URL(...)`.
- **Связанные:** KI-378.

---

### KI-516 — Нет CI-гейта на два инстанса (Throttler)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `.github/workflows/ci.yml`
- **Описание:** Проверка общего лимита между инстансами только в ручном smoke.
- **Решение:** добавить CI-job с Redis и двумя инстансами.

---

### KI-328 — Fit по bbox даёт микроскопические узлы
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `c6edf91`)
- **Файлы:** `web/src/lib/fit-view-options.ts`,
  `web/src/components/Canvas.tsx`
- **Описание:** CDP: при разбросе 21 888 px — узлы 6×3 и 4×2 px;
  при 5 000 px — 37×19 и 23×13 px. «В кадре» ≠ «читаемо»; проблема
  наступает уже при 5 000 px.
- **Решение:** fit по кластеру/выделению, floor для fit-zoom
  (например ≥0.1) с возможностью pan, либо «fit only selected».
- **Fix:** `FIT_SELECTION_OPTIONS.minZoom 0.1`; `Shift+F` и кнопка
  «Вписать выделение» вписывают только выделенные узлы (без выделения —
  работает как обычный Fit). CDP: близкое выделение → zoom 1 (240×123 px
  узлы, читаемо); разнесённое → 0.1 (пол, ratio 15.62 к полному fit);
  кнопка == хоткей.
- **Остаток:** Shift+F по разнесённому выделению визуально теряет часть
  кластера — компромисс.
- **Связанные:** KI-306, KI-314, KI-330.

---

### KI-295 — `WorkflowController`: смешан Async-стиль
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/workflow/workflow.controller.ts`
- **Описание:** `create`/`findAll`/`findOne`/`update`/`remove` — без
  суффикса (нарушение RULES 1.4), новые `importAsync`/`exportAsync` —
  с суффиксом.
- **Решение:** переименовать старые методы при следующей правке
  контроллера.
- **Связанные:** RULES 1.4.

---

### KI-290 — `workflow_runs.outputs` содержит fallback-выходы от потомков упавших
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `aacae26`)
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** text-потомок упавшего узла завершается completed с
  `null`-входом (executeTextNode игнорирует входы, берёт `data.value`),
  и его fallback-значение попадает в `workflow_runs.outputs` как
  полноценный результат ветки — потребитель не отличит от настоящего.
- **Решение:** пометка «fallback» в outputs или переход к KI-288 (skip).
- **Fix:** закрыт автоматически с KI-288 — пропущенный узел не выполняет
  свой код и в `workflow_runs.outputs` не пишет (fallback-выходы
  потомков упавших не попадают). Проверено смоуком и интеграционным тестом.
- **Связанные:** KI-288.

---

### KI-441 — `TRUST_PROXY` не задаёт число хопов / подсети
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** `TRUST_PROXY` — булев флаг
  (`z.union([z.boolean(), z.enum(['true', 'false'])])`, дефолт `false`), и в
  `src/main.ts` он уходит в `app.set('trust proxy', true | false)`. `true`
  доверяет всей цепочке `X-Forwarded-For`: при двух прокси (CDN → nginx)
  клиент подставляет левый адрес и обходит rate limiting, а выразить
  «доверять N хопам / только этим подсетям» конфигурация не может вовсе.
- **Решение:** принимать число хопов или список подсетей (как `trust proxy` в
  Express: `1`, `['10.0.0.0/8']`), валидировать в `EnvSchema` и передавать в
  `set` без преобразования к boolean.
- **Связанные:** KI-419, KI-206, KI-420.

---

### KI-486 — `drizzle-kit` кавычит custom SQL-тип
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `drizzle/0012_document_templates.sql`
- **Описание:** Drizzle рендерит `"bytea"`. Для `bytea` ок, но для алиасов (`"integer"`) DDL упадёт.
- **Решение:** проверить генерацию при следующем custom-типе.

---

### KI-224 — Logout best-effort без отзыва refresh-токена
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/TopBar.tsx` (`handleLogout`)
- **Описание:** При сбое `POST /auth/logout` локальная сессия
  чистится, но refresh-токен на сервере остаётся валидным до 7 дней.
- **Решение:** retry / очередь; или не чистить локальную сессию при
  неудачном logout.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-201.

---

### KI-562 — SQL-shape тесты изоляции зависят от приватных внутренностей Drizzle
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/runs/runs.service.spec.ts`,
  `src/documents/document-templates.service.spec.ts`,
  `src/workflow/workflow-access.spec.ts` и др.
- **Описание:** чтобы доказать наличие `organization_id` в запросах при
  мок-БД, спеки разбирают `SQL.queryChunks` и `Param.value` (внутренние
  структуры drizzle-orm). При обновлении ORM структура может измениться —
  тесты упадут без изменения поведения. Поведенческая проверка изоляции есть в
  e2e-бутстрапе и живом смоуке, но не в DB-интеграционном spec'е.
- **Решение:** при обновлении drizzle заменить на интеграционные проверки или
  собственный helper-обёртку; рассмотреть 1–2 DB-интеграционных спека изоляции
  (RULES 3.19).
- **Связанные:** KI-298, RULES 3.19.

### KI-376 — sse-contract не расширен
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `docs/development/sse-contract.json`,
  `src/runs/dto/run-stream-message.dto.ts`
- **Описание:** по заданию новых полей в SSE-контракте нет. Суммарная
  стоимость запуска приходит отдельным REST-запросом
  (`GET /runs/:id/budget`) на каждое событие узла.
- **Решение:** опционально добавить поле `budget` в SSE snapshot — тогда
  лишних запросов не будет.
- **Связанные:** KI-348, KI-352, DESIGN v0.9 § 3.7.

---

### KI-238 — В проде reverse-proxy должен отдавать SPA для /workflow/share/*
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.10.0 (Docker/ServeStatic, KI-468)
- **Fix:** NestJS `ServeStaticModule` + SPA-middleware в `src/app.module.ts`
  сами отдают `index.html` для `/` и `/workflow/share/*` при
  `Accept: text/html`; Docker-образ собирает `web/dist` и отдаёт SPA тем же
  процессом. Отдельный SPA-fallback в nginx/Caddy больше не обязателен.
- **Файлы:** `src/app.module.ts` (`ServeStaticModule`, middleware),
  `Dockerfile`, `web/vite.config.ts` (dev-bypass)
- **Описание:** В dev-режиме Vite proxy `/workflow` перехватывал
  навигацию на `/workflow/share/:token` и возвращал JSON API вместо
  SPA. Обойдено `bypass` в `vite.config.ts`. **В проде** то же правило
  должен применить reverse-proxy / ingress: запросы с
  `Accept: text/html` на `/workflow/share/*` → `index.html`, API —
  на backend. Иначе публичная ссылка вернёт JSON.
- **Решение:** правило в nginx/Caddy/ingress; задокументировать в `docs/development/GETTING_STARTED.md` (файла
`DEPLOYMENT.md` в репозитории нет — завести при подготовке прода).
- **Когда чинить:** — для self-hosted Docker закрыто в v0.10.0.
- **Примечание:** для **не-Docker ingress** (отдельный nginx/Caddy/static
  hosting) правило всё ещё может понадобиться: если внешний слой
  перехватывает `/workflow/share/*` и не проксирует запрос в Nest,
  нужен SPA-fallback на его стороне.
- **Связанные:** KI-197, KI-072 (единый /api-префикс), KI-468.

---

### KI-170 — `<MiniMap />` не локализуется через `ariaLabelConfig`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** Ключ `minimap.ariaLabel` из `defaultAriaLabelConfig`
  передаётся, но у `.react-flow__minimap` в DOM `aria-label` не появляется —
  в отличие от `<Controls />`, который подписи из того же конфига читает.
  Скринридер озвучит миникарту без имени.
- **Решение:** обернуть `<MiniMap />` в контейнер с `aria-label` /
  `role="img"` или задать атрибут через props миникарты.
- **Когда чинить:** v0.8 (доступность).
- **Связанные:** KI-167.

---

### KI-211 — Пропущены номера KI-198 и KI-199
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `docs/KNOWN_ISSUES.md` («Правила ведения»)
- **Описание:** В реестре после KI-197 сразу KI-200 — номера KI-198
  и KI-199 отсутствуют. Причина не установлена. Дырка сама по себе
  не ошибка (номера не переиспользуются), но без правила следующий
  автор решит, что записи потеряны, и попробует «заполнить» их.
- **Решение:** зафиксировать в «Правилах ведения» `KNOWN_ISSUES.md`:
  «номера KI не переиспользуются; пропуски допустимы; продолжать
  с max+1 (RULES § 3.18)».
- **Когда чинить:** docs-коммит R6.1a (сейчас).
- **Связанные:** RULES 3.18.

---

### KI-559 — Удаление организации падает на FK `workflow_collaborators.invited_by`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-02 (смоук S2)
- **Файлы:** `src/db/schema.ts`
- **Описание:** `workflow_collaborators.invited_by` ссылается на `users.id` без
  `ON DELETE CASCADE` (колонка NOT NULL, действие NO ACTION). При удалении
  организации PostgreSQL каскадно удаляет `users` и `workflows`; порядок
  каскадов не гарантирован, и если пользователи удаляются раньше, операция
  падает с `23503` (`violates foreign key constraint
  workflow_collaborators_invited_by_users_id_fk`). Воспроизведено смоуком S2
  при уборке тестовых организаций (пришлось сначала удалить строки
  участников). API/UI удаления организаций пока нет (см. KI-558).
- **Решение:** перед удалением организации удалять/переоформлять
  `workflow_collaborators` в одной сервисной операции, либо изменить FK на
  `ON DELETE CASCADE`/`SET NULL` (потребует nullable и миграцию). Решать вместе
  с политикой удаления арендатора (S5).
- **Связанные:** KI-558.

### KI-523 — `maxRetries: 0` для SDK захардкожен
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/llm/providers/openai-compatible.provider.ts`,
  `src/llm/providers/anthropic.provider.ts`
- **Описание:** KI-500 закрыт жёстким `maxRetries: 0`: оператор не может
  временно включить внутренние ретраи SDK без пересборки. Для диагностики
  «наш движок vs SDK» флаг мог бы быть полезен, но он же возвращает риск
  двойного списания.
- **Решение:** при необходимости добавить env-флаг с дефолтом `0`, строгим
  парсингом (RULES 4.35) и предупреждением в логе при значении `> 0`.
- **Связанные:** KI-500.

---

### KI-527 — PDF-рендер GFM-таблиц плоским текстом (Low)
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/documents/pdf-renderer.service.ts`
- **Описание:** DOCX-рендерер (`DocumentService`) рисует GFM-таблицы сеткой с
  шапкой, а `PdfRenderer` v0.12 S1 выводит заголовки и строки через ` | ` без
  ячеек и границ. Данные в PDF не теряются, но документ визуально отличается
  от DOCX и не переносится по колонкам. DESIGN § 3.1.2 не требует таблиц в
  PDF, поэтому это задокументированное ограничение, а не регресс.
- **Решение:** при необходимости — PDFKit `table` (в форке/плагине) либо
  ручная сетка с расчётом ширин колонок и переносом ячеек; проверять на
  длинных кириллических ячейках.
- **Связанные:** KI-463, DESIGN v0.12 § 3.1.2.

---



| Статус | Кол-во |
|--------|--------|
| Fixed | 230 |
| In Progress | 0 |
| Planned | 1 |
| Deferred | 1 |
| Documented | 9 |
| Open | 269 |
| Won't Fix | 4 |
| **Всего** | **514** |

---

## Правила ведения

1. Любая найденная проблема / ограничение → запись с номером `KI-XXX`.
2. Даже если это «не баг» — запись нужна для истории.
3. Приоритет: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low.
4. Статус: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved.
5. Для Fixed — обязательно указывается «Исправлено в: vX.Y.Z» и список файлов.
6. Для Deferred — указывается «Запланировано: vX.Y.Z» и причина отсрочки.
7. **Номера KI не переиспользуются.** Пропущенные номера (например,
   KI-198, KI-199) — допустимы, это следы откаченных/перенесённых
   записей. Не «заполнять» пропуск — продолжать с максимального
   существующего +1 (RULES § 3.18).
8. **KI-номера в других документах (CHANGELOG, DESIGN) могут быть
   историческими идентификаторами фич, а не ссылками на реестр.**
   Перед использованием любого «предложенного» номера — сверить
   с реестром (RULES § 3.18, KI-209).


### KI-434 — SSRF: `http_request` следует за redirect на приватный адрес
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.2 — `fetchWithSsrfGuardAsync` в
  `src/common/utils/network-safety.ts`: `redirect: 'manual'`, повторная
  проверка каждого `Location` и лимит хопов (`HTTP_MAX_REDIRECTS = 5`).
- **Файлы:** `src/agent/agent-tools.ts`, `src/common/utils/network-safety.ts`
- **Описание:** `assertPublicHttpUrlAsync` проверяет только исходный URL, а
  `fetch` вызывается без `redirect: 'manual'` и по умолчанию идёт по 3xx.
  Публичный хост может ответить `302 Location: http://169.254.169.254/…`, и
  запрос уйдёт на приватный адрес в обход guard (первый редирект бесплатен).
- **Решение:** `redirect: 'manual'` с повторной проверкой каждого `Location`
  и ограничением числа хопов либо проверка адреса на уровне соединения
  (`dispatcher`/`lookup`).
- **Связанные:** KI-409, KI-435.

---

### KI-184 — Media-ошибка upstream не различает «наш запрос» и «сбой провайдера»
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/media/dto/media-task.mapper.ts`,
  `src/media/media-node-executor.service.ts`
- **Описание:** После KI-181 объектная форма `error` разбирается,
  но `code:1 EXCEPTION` от GPTunnel — это внутренняя ошибка на их
  стороне. В `node_runs.error` попадает как обычный текст падения
  узла. Пользователь не понимает, что повторять бессмысленно, и
  что `refunded:true`.
- **Решение:** различать классы ошибок upstream (валидация входа /
  сбой провайдера / модель снята); передавать `refunded` в метрики
  узла.
- **Когда чинить:** v0.8 (вместе с тикетом в GPTunnel).
- **Связанные:** KI-181, KI-105.

---

### KI-429 — Неполная формула зазора при вставке узла
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `web/src/lib/graph-edit.ts`
- **Описание:** Формула зазора `size/2 + 40` при вставке узла не учитывает
  половину высоты соседа: для высоких узлов новый узел всё ещё перекрывает
  соседний (остаток KI-263).
- **Решение:** учитывать половину высоты соседа в формуле зазора при расчёте
  сдвига.
- **Связанные:** KI-263.

---

### KI-521 — Действующий лимит MCP читается независимо в двух местах
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/mcp/mcp.controller.ts`, `src/agent/agent.service.ts`,
  `src/mcp/mcp.config.ts`
- **Описание:** `MCP_MAX_TOOLS_PER_NODE` читается через `readIntegerConfig` и в
  контроллере каталога (для `maxToolsPerNode` в ответе API), и в
  `AgentService` (для проверки при запуске). Сейчас значения и границы
  совпадают, но при изменении clamp/дефолта в одном месте они разойдутся:
  UI покажет один лимит, а запуск проверит другой.
- **Решение:** вынести чтение лимита в общий провайдер (например,
  `McpServerRegistry` или отдельный `McpSettingsService`) и использовать его в
  обоих местах.
- **Связанные:** DESIGN v0.11 § 3.2.5/§ 3.2.6, отчёт
  `reports/v0.11.0/S8-mcp-ui.md` § 6.

---

### KI-477 — `read_file` в `NODE_PORT_CONTRACT` имеет target-хендл
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/engine/node-ports.ts`,
  `web/src/components/nodes/ReadFileNode.tsx`,
  `web/src/lib/node-registry.ts`
- **Описание:** `read_file` — source-only (`canBeInsertedOnEdge: false`,
  target-хендла в компоненте нет), но `NODE_PORT_CONTRACT.read_file` всё ещё
  объявляет `targetHandleId: 'text-input'` и `inputPortName: 'prompt'`.
  Исполнитель входы игнорирует, поэтому уязвимости нет, но контракт вводит
  в заблуждение будущий type-aware резолвер/валидатор.
- **Решение:** убрать target-поля у `read_file` либо ввести явный
  source-only вариант контракта; добавить тест, что у узла нет входного порта.
- **Связанные:** KI-456, KI-301.

---

### KI-095 — Правило включения env-провайдера разъехалось
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-provider.factory.ts`
- **Описание:** LM Studio включается при непустом `LMSTUDIO_MODELS`
  (ключ-заглушка). GPTunnel — при ключе **и** непустом
  `GPTUNNEL_MODELS`. Правила выражены кодом в двух методах и легко
  забыть при добавлении третьего env-провайдера.
- **Решение:** описатель провайдера `{ name, envKey, baseUrlEnv,
  modelsEnv, requiresApiKey }` + один проход.
- **Когда чинить:** при появлении третьего env-провайдера.
- **Связанные:** KI-088.

---

### KI-222 — Env-схема не покрыта кейсами `AUTH_DISABLED=''` и `'garbage'`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/config/env.schema.spec.ts`
- **Описание:** Дешёвая регресс-защита первого кросс-полевого
  инварианта: `AUTH_DISABLED=''` (пустая строка → undefined → ок),
  `'garbage'` (enum-ошибка).
- **Решение:** +2 теста в существующий `describe`.
- **Когда чинить:** v0.8.x.
- **Связанные:** KI-213.

---

### KI-554 — Guard доверяет `orgId` из токена без проверки членства в БД
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.0.0 (S5, ручки `/admin/members*`) | **Обнаружено:** 2026-11-02
- **Файлы:** `src/auth/guards/jwt-auth.guard.ts`
- **Описание:** `JwtAuthGuard` проверяет, что `orgId` — непустая строка, но не
  сверяет его с БД (нет проверки uuid, существования организации и членства
  пользователя). Подделать payload без `JWT_SECRET` нельзя, но пользователь,
  исключённый из организации в будущем управлении командой, сохранит доступ до
  истечения access-токена (24 ч). Пока удаления из организации и смены
  арендатора в продукте нет.
- **Решение:** в S2 (фильтрация по `orgId`) не полагаться на токен слепо:
  проверка `users.organization_id` на чувствительных операциях либо короткий
  TTL + валидация при refresh. Перед S5 (управление командой) — обязательно.
- **Fix (S5):** новые ручки `GET /admin/members` и `POST /admin/members/invite`
  не используют `orgId` из токена: `OrgMembersService` резолвит организацию из
  строки `users` по `sub`, а роль приглашающего читает `OrgOwnerGuard` (тоже по
  БД). `GET /admin/audit` по-прежнему фильтрует по `orgId` из подписанного
  токена — остаток вынесен в KI-587.
- **Связанные:** KI-552, KI-587, DESIGN v1.0 § 2.1.

### KI-280 — http-узел полностью не ретраится
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/engine/node-executors.ts`
- **Описание:** Ветка повтора в `executeNodeAsync` срабатывает только на
  `LlmProviderException.retryable`. Для `http` — не срабатывает никогда.
  Для идемпотентных методов (GET/HEAD) потеряна устойчивость к 5xx/
  таймауту; для POST/PUT/DELETE повтор опасен дублем (сознательно не
  включали).
- **Решение:** признак идемпотентности у типа узла или классификация
  ошибок http по методу.
- **Связанные:** KI-041, KI-036, KI-042.

---

### KI-389 — TTS: нет каталога голосов, `speed` не объявлен ни одной моделью
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `web/src/components/nodes/AudioGenNode.tsx`, `src/media/media-generation.ts`
- **Описание:** `tts2.voice` — непрозрачный id (`69e7736797a24533bd8ffca6`),
  каталога голосов у upstream нет, свой дефолт он подставляет сам; поле `voiceId`
  в UI — свободный ввод. Параметр `speed` (DESIGN 0.5–2.0) не объявлен ни одной
  моделью, поэтому поле никогда не появляется.
- **Решение:** селект голосов (если upstream отдаст список) либо честная подпись
  «id голоса, необязательно — иначе голос по умолчанию»; убрать `speed` из
  DESIGN или завести TTS-провайдера с этим параметром.
- **Связанные:** KI-385, DESIGN v0.9 § 3.2.

---

### KI-607 — `GET /admin/audit` делает четыре запроса к БД на страницу
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S5) | **Обнаружено:** 2026-11-04
- **Файлы:** `src/audit/admin-audit.controller.ts`, `src/audit/audit.service.ts`,
  `src/audit/org-owner.guard.ts`
- **Описание:** на каждый запрос журнала выполняются: `SELECT role` (guard),
  `SELECT organization_id` (резолв актора), `count(*)` (total) и `SELECT`
  страницы. Org-резолв и роль можно получить одним запросом (или положить
  организацию в `request.user` из guard'а), `count(*)` — кэшировать/убрать из
  hot-path. На текущих объёмах это незаметно, но на большом журнале лишние
  round-trip'ы складываются.
- **Решение:** объединить guard и резолв организации (guard читает
  `role, organization_id` и кладёт org в request), либо передавать в
  `AuditService` уже прочитанную организацию; `total` считать по индексу
  (S3 добавил `audit_logs_org_action_created_id_idx` /
  `audit_logs_org_user_created_id_idx`), при необходимости — отдельным
  `EXPLAIN`-прогоном.
- **Связанные:** KI-585, KI-587.

### KI-518 — MCP API/UI (S8) отсутствовал в релизе v0.11.0
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.11.0 (S8; тег `v0.11.0` на момент правки ещё не выставлен)
- **Файлы:** `src/mcp/mcp.controller.ts` (новый), `src/mcp/dto/mcp-servers.dto.ts`
  (новый), `src/mcp/mcp.module.ts`, `src/app.module.ts`, `api-prefixes.json`,
  `docs/development/api-contract.json`, `web/src/lib/api.ts`,
  `web/src/stores/workflow.ts`, `web/src/lib/agent-node-fields.ts`,
  `web/src/components/nodes/AgentNode.tsx`, `web/src/i18n/ru.json`,
  `web/src/i18n/en.json`, `docs/development/v0.11/DESIGN_V011_FEATURES.md`
  (§ 5, S8)
- **Описание:** backend MCP-адаптера (S6/S7) реализован: схема `agent.mcpTools`,
  `McpClientService`, `McpToolAdapter`, preflight до LLM, retry-guard. Срез
  **S8** — ручка `GET /mcp/servers`, UI выбора MCP-инструментов в `AgentNode`,
  i18n-подключение и тесты — на HEAD **отсутствовал**: i18n-ключи
  `node.agent.mcp.*` и тип `McpToolRef` были, но компонент их не использовал;
  `McpModule` не подключён к `AppModule`. Пользователь не мог выбрать
  MCP-инструмент из UI — только через JSON сценария/API. DESIGN § 5 включает
  S8 в план v0.11, CHANGELOG и USER_GUIDE описывают MCP как вошедшую фичу.
- **Решение:** S8 реализован до тега: `McpController` с `GET /mcp/servers`
  (JWT; `enabled`, `maxToolsPerNode`, серверы со статусами/инструментами,
  `Promise.allSettled`, `{enabled:false,servers:[]}` при выключенном MCP,
  без URL/заголовков/токенов и без host в тексте ошибки); Zod-DTO
  `McpServersResponse`/`McpServerSummary`/`McpToolSummary` и паритет
  `docs/development/api-contract.json`; префикс `mcp` в `api-prefixes.json`
  (SPA-fallback и Vite-прокси); UI-секция «MCP-инструменты» в `AgentNode`
  (серверы с раскрываемыми списками, чекбоксы с записью в `data.mcpTools`,
  бейджи `RO`/`DESTR`/`IDEM`, предупреждение destructive, лимит
  `maxToolsPerNode`, disabled при `status: error`); i18n ru/en и тесты
  (backend controller + API-контракт; web AgentNode + контракт + префиксы).
- **Связанные:** DESIGN v0.11 § 3.2.6/§ 3.2.7, § 5 (S8), S17-docs-sync § 5.7,
  отчёт `docs/development/reports/v0.11.0/S8-mcp-ui.md`, KI-488, KI-492,
  KI-497.

---

### KI-568 — Таблица маршрутов аудита поддерживается вручную
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/audit.constants.ts`
- **Описание:** `resolveAuditAction` сопоставляет метод+путь с кодом действия по
  ручной таблице `AUDIT_ACTION_ROUTES`. Автоматического паритет-теста с
  фактическими маршрутами контроллеров нет: при переименовании/переносе ручки
  журнал молча начнёт писать fallback `http.<method>` (запись не теряется, но
  код действия становится неинформативным). Добавление нового мутирующего
  маршрута без правки таблицы — та же деградация.
- **Решение:** паритет-тест «все мутирующие маршруты `src/**/*.controller.ts`
  покрыты таблицей» (сравнение `@Post/@Patch/@Delete` + путь с
  `AUDIT_ACTION_ROUTES`) либо декоратор `@AuditAction(...)` на ручках с
  fallback на URL-таблицу.
- **Связанные:** KI-472 (единый реестр префиксов), RULES 3.19.

### KI-353 — три источника правды по статусам узла
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.5 (коммит `0e5d027`)
- **Файлы:** `src/db/schema.ts`, `src/runs/dto/run-stream-message.dto.ts`,
  `web/src/types/run-stream.ts`
- **Описание:** `NODE_RUN_STATUSES` — канон в `schema.ts`, но DTO выводит
  свой список из `WORKFLOW_RUN_STATUSES`, а web-зеркало дублирует
  литералами. Совпадение ничем не гейтится.
- **Решение:** DTO берёт `NODE_RUN_STATUSES` из схемы; web — под гейт
  паритета (KI-348/KI-352).
- **Fix:** `run-stream-message.dto.ts` импортирует `NODE_RUN_STATUSES` /
  `WORKFLOW_RUN_STATUSES` из `db/schema.ts`; удалены локальный вывод
  `[...WORKFLOW_RUN_STATUSES, 'skipped']` и дублирующий
  `type NodeRunStatus`; `@deprecated RUN_STATUSES` удалён (0 потребителей).
  `run_completed.status` — `TERMINAL_WORKFLOW_RUN_STATUSES`
  (`['completed','failed'] as const satisfies readonly RunStatus[]`);
  inline-union `'completed' | 'failed'` в `run-event.dto.ts` заменён на
  него. +2 паритет-теста.
- **Остаток:** KI-359 (inline-union `'completed' | 'failed'` в engine
  :164/:1208/:370 и `runs.processor.ts` :220).
- **Связанные:** KI-336, KI-352, KI-359.

---

### KI-567 — Аудит пишется fire-and-forget: потеря при падении процесса
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/audit/audit.interceptor.ts`
- **Описание:** запись в журнал стартует в `tap` после успешного обработчика и
  не задерживает ответ (осознанно: аудит — вспомогательная подсистема, его
  недоступность не должна ломать операции). Следствие: при падении процесса
  между отправкой ответа и завершением INSERT действие не попадёт в журнал;
  аудит не является частью транзакции бизнес-операции (в отличие от RULES 4.22
  для связанных записей). Смоук из-за этого обязан ждать записи (поллинг),
  а не читать сразу после HTTP-ответа.
- **Решение:** при требовании «аудит гарантирован» — transactional outbox
  (запись в ту же транзакцию, что и операция, + воркер), либо await записи с
  fallback-логом; для S3 выбран best-effort, ограничение зафиксировано.
- **Связанные:** RULES 4.18/4.22, KI-569.

### KI-152 — `cost_usd = 0` не различает «бесплатно» и «ноль по прайсу»
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/llm/model-pricing.ts`, `docs/CHANGELOG.md`
- **Описание:** После KI-148 `cost_usd = 0` означает две разные ситуации:
  вызов локальной модели (реально бесплатно) и крайне дешёвый вызов,
  округлившийся до нуля (`gpt-4o-mini`, 1 входной токен). В БД и в панели они
  неразличимы, что искажает аналитику затрат по запуску.
- **Решение:** помечать локальные вызовы признаком (например, колонка
  `cost_is_exact` или поле в `outputs`) либо считать агрегаты с учётом
  провайдера.
- **Когда чинить:** вместе с агрегатом по стоимости (KI-054).
- **Связанные:** KI-054, KI-148, KI-153.

---

### KI-385 — CreativeLab не отдаёт `type=AUDIO`: TTS-модели лежат в MUSIC
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/media/media-generation.ts`, `web/src/lib/generation-node.ts`
- **Описание:** `GET /media/models?type=AUDIO` → `{"code":0,"models":[]}`; TTS —
  это `tts2` с `type=MUSIC` (параметр `voice`, тариф `per_character`). Узел
  `audio_generation` работает только благодаря документированному фолбэку
  «AUDIO ∪ MUSIC-модели с параметром `voice`/`voice_id`» — эвристике, которая
  сломается, если upstream переименует параметр.
- **Решение:** прямой TTS-провайдер (ElevenLabs, DESIGN § 3.2) либо флаг
  `capabilities` в каталоге вместо угадывания по имени параметра.
- **Связанные:** KI-361, KI-366, DESIGN v0.9 § 3.2.

---

### KI-285 — UI новых узлов: обрезка полей в карточке w-60
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/src/components/nodes/ConditionNode.tsx`,
  `web/src/components/nodes/HttpNode.tsx`
- **Описание:** Три поля в строку Condition и URL в HTTP обрезаются
  (`input.val`, `https://api.example.c`). Функционально не мешает —
  данные в `data` целиком — но читаемость страдает.
- **Решение:** ширина карточки по типу или двухстрочная раскладка.

---

### KI-508 — Нет теста API-обёрток `fetchRunAsync`/`fetchRunNodesAsync`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/lib/api.spec.ts`
- **Описание:** Проверяются моки store и contract-гейт, но не URL/encodeURIComponent/Zod-разбор.
- **Решение:** добавить 2 теста по образцу `document-templates API`.

---

### KI-276 — Ctrl+Z не работает при фокусе в поле ввода узла
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`,
  `web/src/hooks/use-hotkeys.ts`
- **Описание:** Хук игнорирует события из
  `input`/`textarea`/`select`/`contenteditable` — Ctrl+Z в textarea
  узла отменяет локальную правку браузера, а не действие графа.
  Для «отменить набор текста» ожидаемо, для «отменить последнее
  действие графа» — нет.
- **Решение (обсудить):** `allow`-исключение для `ctrl+z` при фокусе
  в полях узлов, либо явно задокументировать текущее поведение в
  DESIGN v0.8 § 7.2.
- **Связанные:** KI-186, KI-274.

---

### KI-454 — мёртвый `runPlanAsync` и бейдж уровня (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 (S0)
- **Файлы:** `web/src/stores/workflow.ts`,
  `web/src/components/nodes/BaseNode.tsx`,
  `web/src/components/nodes/*.tsx`
- **Описание:** `runPlanAsync` не вызывался ни из одного места, поэтому
  `executionLevels` всегда оставался пустым, а бейдж уровня в `BaseNode` —
  недостижимым. Плюс `setExecutionLevels`/`clearExecutionLevels` и
  `node.levels.title` поддерживали мёртвую ветку.
- **Решение:** удалены `runPlanAsync`, `executionLevels`, `setExecutionLevels`,
  `clearExecutionLevels`, импорт `planWorkflowAsync`/`levelsToMap` и бейдж из
  `BaseNode`; у всех узлов убран проп `executionLevel`. Планирование как
  вспомогательный запрос — задача S10 (DESIGN v0.10 § 3.5.2).
- **Тесты:** из `workflow.spec.ts` удалён тест про сброс `executionLevels`.

---

### KI-283 — condition: эвристика ключей `input.X`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/node-executors.ts`
- **Описание:** `input.X` и запасные ключи разрешаются эвристикой
  (`input → prompt → text → value`). При двух входах
  (`input.value` + `input.prompt`) второй недостижим; при опечатке в
  ключе значение молча берётся из запасного.
- **Решение:** явная схема отображения операндов на порты (вместе с KI-278).
- **Связанные:** KI-035, KI-278.

---

### KI-490 — variables-черновик не ресинхронизируется при undo/redo
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/components/nodes/DocumentGenNode.tsx`
- **Описание:** Textarea для `variables` хранит локальный стейт. При `Ctrl+Z` состояние узла откатывается, а текст в textarea — нет.
- **Решение:** синхронизировать локальный стейт с `data.variables` через `useEffect`.

---

### KI-311 — `@Controller()` без `path` невидим для regex-паритета
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/common/api-prefixes.spec.ts`
- **Описание:** `AppController` с пустым `@Controller()` (корневой `/`)
  не попадает в regex. Объектная форма `@Controller({ path })` в
  проекте не встречается — если появится, тест упадёт явно
  (не разобрав), но с подсказкой.
- **Решение:** расширить парсер при появлении объектной формы.

---

### KI-374 — `bgremover` требует prompt, операция в нём не нуждается
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/media/image-tool.ts`
- **Описание:** upstream bgremover объявляет `prompt: 'required'`, хотя
  операции он не нужен. Отправляем дефолт («remove the background»).
  `kling-lipsync` (`prompt: 'none'`) промпт не получает вовсе.
- **Связанные:** KI-366, KI-367.

---

### KI-362 — Хранение media-результатов: TTL 48h ссылок CreativeLab
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.8, коммит `3e2844a`)
- **Fix:** `IMediaStorage` + `LocalMediaStorage` (`./data/media`, TTL 30 дней,
  sanitize key, защита от path traversal) и `S3MediaStorage`.
  Миграция 0010: `node_runs.stored_url`, `stored_expires_at`. Публичный
  `GET /media/file/:runId/:fileName` (uuid как capability). UI показывает
  `storedUrl ?? mediaUrl` и `ExpiredMediaPlaceholder`. Ошибка сохранения не
  роняет узел (генерация уже оплачена).
- **Доработано в R7.8-fix (v0.9.1):** S3-загрузка через `@aws-sdk/client-s3`
  (KI-412), ежедневная cron-очистка локального хранилища по TTL (KI-413).
- **Остаток:** `/media/file` без signed URL (KI-415), приватный S3-бакет
  (KI-425), TTL объектов S3 (KI-426).
- **Файлы:** `src/media/media-storage.service.ts`,
  `src/media/media-node-executor.service.ts`, `src/db/schema.ts`,
  `web/src/components/ExpiredMediaPlaceholder.tsx`
- **Описание:** CreativeLab отдаёт `resultUrls`, живущие 48 часов. Файла у
  нас нет; через 2 суток история запусков (node_runs.outputs) содержит
  мёртвые ссылки. `workflow_runs.outputs` тоже. KI-105-fix (v0.8.0e) закрыл
  это на уровне `http`/`condition`/`output`/`compare` executors, но **не**
  media — real media-хранение не решено.
- **Решение:** (1) скачивать результат к себе — S3 (AWS/MinIO) или
  локальный диск с TTL; (2) поле `node_runs.stored_url` — своя ссылка,
  `resultUrls` — fallback; (3) в UI метка «ссылка истекла» при
  `stored_url=null` и TTL прошедшем. Реализация — DESIGN v0.9 (кандидат в
  R7.7 или отдельный R7.8).
- **Связанные:** KI-105, DESIGN v0.9 § 3.1-3.2.

---

### KI-593 — Нет ретраев и статуса доставки письма
- **Приоритет:** 🟡 Medium | **Статус:** Fixed (частично) | **Исправлено в:** v1.2.0 (S2) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/email/email.service.ts`,
  `src/organizations/org-members.service.ts`
- **Описание:** при временном сбое SMTP (4xx/5xx, таймаут) письмо теряется:
  ошибка уходит в лог, `emailSent: false` возвращается только в этом ответе, а
  в `organization_invitations` нет полей статуса отправки. Повторно пригласить
  тот же email нельзя (409), отправить письмо повторно — ручки нет; после
  перезагрузки страницы владелец не видит, ушло ли письмо.
- **Решение:** колонки `email_sent`/`email_error`/`email_sent_at` в
  `organization_invitations` + `POST /admin/members/invitations/:id/resend`
  (owner/admin), ретраи в очереди, аудит-действие `member.invite_email_failed`.
- **Fix (v1.2.0 S2, частично):** ретраи вынесены в BullMQ-очередь
  `email-invitations` (`attempts: 3`, exponential backoff 5000); приглашение
  создаётся до постановки письма. **Остаток:** статус доставки в БД/API и
  ручка resend — KI-622, KI-624.
- **Связанные:** KI-584, KI-592, KI-597, KI-622, KI-624.

### KI-091 — Тестов меньше требуемого порога (260 vs 265)
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.2.0 (S2) | **Обнаружено:** 2026-10-13
- **Описание:** Ожидалось +8 тестов (257 → 265), фактически +3.
  Часть сценариев **уже покрыта** существующими тестами и меняла
  только форму ожидаемых объектов.
- **Решение:** добавить юнит-тесты `groupLlmModelsForSelect`,
  `filterModelsByInput/Output`, `MODEL_MODALITIES` (сейчас
  покрыты только через CDP-smoke).
- **Когда чинить:** вместе с v0.6.0b.
- **Связанные:** —

---

### KI-108 — Poll backoff без jitter синхронизирует запросы
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.8.0e (R6.6.1, коммит 12ff041)
- **Fix:** Export/Import workflow (JSON, version: 1) +
  templates (`src/templates/*.json`, 3 штуки). Эндпоинты:
  `GET /workflow/:id/export`, `POST /workflow/import`,
  `GET /templates`, `POST /templates/:id/instantiate`.
- **Связанные:** KI-109, KI-291..295.
- **Файлы:** `src/media/media-node-executor.service.ts`
- **Описание:** Backoff ×1.5 без jitter: несколько параллельных
  media-узлов с одинаковым стартом будут дёргать upstream
  синхронно (thundering herd). Сейчас это не проблема (один
  пользователь), но при масштабировании нужно добавить
  `delay × (0.5 + random)`.
- **Решение:** добавить jitter.
- **Когда чинить:** при появлении нескольких параллельных media-узлов.
- **Связанные:** KI-100.

---

### KI-100 — `GET /media/models` тормозит на холодном кэше
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/media/providers/creativelab.provider.ts`
- **Описание:** Первый запрос идёт в upstream (~200 КБ JSON), ни
  прогрева, ни stale-while-revalidate. После истечения TTL первый
  клиент ждёт сеть. Два одновременных промаха — два запроса
  (thundering herd).
- **Решение:** фоновый прогрев по таймеру; stale-while-revalidate;
  in-flight дедупликатор промисов.
- **Когда чинить:** при жалобах на latency.
- **Связанные:** KI-099.

---

### KI-497 — Сводка `KNOWN_ISSUES.md` расходится с `grep`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `docs/KNOWN_ISSUES.md`
- **Описание:** Ручной подсчёт при добавлении KI привёл к расхождению таблицы (479) с фактическим числом заголовков (484).
- **Решение:** добавить в CI шаг, проверяющий `(Select-String -Pattern '^### KI-').Count` == сумме статусов.
- **Прогресс v0.11.0 (S17):** сводка и статусы пересчитаны вручную по grep
  (RULES § 3.20): заголовков — 507, сумма статусов — 507. CI-гейта пока нет,
  поэтому KI остаётся открытым.

---

### KI-514 — Нет валидации ответа Lua в Redis Throttler
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/common/throttler/redis-throttler.storage.ts`
- **Описание:** `increment` кастует ответ `EVAL` без проверки длины и типов (RULES 1.17).
- **Решение:** проверять `Number.isFinite` и длину массива, при ошибке — fallback.

---

### KI-467 — `ServeStaticModule` падал на `exclude: ['/api*']` (High)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.10.0 Docker
- **Файлы:** `src/app.module.ts`, `Dockerfile`, `package.json`,
  `pnpm-lock.yaml`
- **Описание:** `@nestjs/serve-static@12` использует `path-to-regexp@8`, где
  шаблон `'/api*'` синтаксически невалиден. Первый запрос, доходивший до
  SPA-fallback, падал с `PathError: Missing parameter name at index 5: /api*`
  и возвращал **500** вместо `index.html`. Ошибка не проявлялась на старте:
  приложение поднималось, ломался только HTML-fallback.
- **Решение:** `exclude` заменён на RegExp
  `^\/(?:api|auth|llm|media|workflow|engine|runs|templates|nodes)(?:\/|$)`,
  покрывающий реальные API-префиксы backend'а. Проверено в контейнере:
  SPA-маршруты — 200 `text/html`, API — JSON, `/media/file/...` — 404 JSON.
- **Связанные:** KI-468, KI-472.

---

### KI-073 — Точность номера попытки ограничена контрактом
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/dto/run-event.dto.ts`, `web/src/stores/workflow.ts`
- **Описание:** `run_started` не несёт `attemptsMade`, поэтому номер
  текущей попытки выводится из предыдущего `run_completed`
  (`attemptsMade + 2`): если клиент подключился к уже идущему
  запуску (snapshot без данных о попытках, KI-063) или первое
  событие потеряно, UI покажет «Выполняется…» без номера.
- **Решение:** добавить `attemptsMade`/`attempts` в `run_started`.
- **Когда чинить:** вместе с KI-063.
- **Связанные:** KI-059, KI-063, KI-070.

---

### KI-200 — Sub-workflows (композиция workflow как узла)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.7, коммит `699772f`)
- **Fix:** узел `sub_workflow` (backend + frontend); полная рекурсия
  через `executeSubWorkflowGraphAsync` (branch-local
  `visitedWorkflows`, max depth 5, префикс id `sub_<nodeId>__`);
  owner-check через `findOneAsync` → 404 (не раскрывать существование);
  frontend `SubWorkflowNode` (селект, превью, «Открыть в редакторе»,
  warning версии).
- **Остаток:** KI-300..305.
- **Связанные:** KI-300..305, KI-301, DESIGN v0.8 § 5.
- **Файлы:** `src/engine/`, `src/types/graph.ts`,
  `web/src/lib/node-registry.ts`, `web/src/stores/workflow.ts`
- **Описание:** GPTunnel и n8n позволяют вкладывать один workflow в
  другой как узел — переиспользование готовых цепочек вместо
  копирования узлов. У нас каждый workflow самодостаточен: чтобы
  использовать чужую цепочку, её приходится пересобирать вручную.
  Это же ограничение блокирует шаблоны (KI-109) и Share с
  копированием (KI-197).
- **Решение (по DESIGN_V08_FEATURES.md, R6.7):** новый тип узла
  `sub_workflow` со ссылкой на `workflowId`; executor подставляет
  дочерний граф с префиксом ID `sub_<nodeId>__`; защита от рекурсии
  (`visitedWorkflows: Set`, max глубина 5); warning при изменении
  дочернего workflow; версионирование ссылки.
- **Когда чинить:** v0.8 — подшаг **R6.7** (~4 ч, DESIGN v0.8
  Approved 2026-10-15).
- **Связанные:** KI-201, KI-108, KI-109, KI-197.

---

### KI-195 — Auto-save в фоне
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts`, `web/src/components/TopBar.tsx`
- **Описание:** GPTunnel не имеет кнопки Save — всё автосохраняется.
  У нас: Save вручную + авто-save перед Run (KI-147).
- **Решение:** debounced save (3с после последнего изменения) +
  индикатор «сохранено/есть изменения»; Save остаётся как fallback.
- **Когда чинить:** v0.8.
- **Связанные:** KI-147.

---

### KI-124 — В узле Image Generation нет кнопок «Открыть» / «Скачать»
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Результат можно посмотреть или сохранить только
  через правый клик по `<img>` («Открыть в новой вкладке» /
  «Сохранить как...»). Пользователь не знает про этот способ; UX
  страдает. Дополнительно — `mediaUrl` живёт 48 часов (KI-105,
  KI-118), сохранить нужно **до** истечения.
- **Решение:**
  1. **«Открыть»** — `window.open(mediaUrl, '_blank')`,
     браузер покажет крупно + зум колесом.
  2. **«Скачать»** — `fetch(mediaUrl).blob()` +
     `URL.createObjectURL` + `<a download>`. NB: если CDN
     GPTunnel не отдаёт CORS-заголовки, fallback — открыть в
     новой вкладке и Ctrl+S.
  3. Кнопки — правый верхний угол блока с `<img>`, `nodrag`,
     появляются при hover.
- **Когда чинить:** v0.6.x (не блокер v0.6.0).
- **Связанные:** KI-105, KI-118.

---

### KI-032 — Аренда по `started_at` без heartbeat
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/runs/runs.processor.ts`, `src/runs/runs.constants.ts`
- **Описание:** Порог 5 минут — wall-clock, а `started_at` обновляется
  только в начале запуска. В R3 реальные LLM-графы легко превысят 5 минут;
  если в этот момент BullMQ переотдаст задание (пауза процесса >
  `lockDuration`, stalled-check), процессор сочтёт живой запуск «зависшим»
  и выполнит граф параллельно — двойные вызовы и траты.
- **Возможные решения:**
  1. Heartbeat / продление аренды по ходу выполнения.
  2. Опора на состояние job'а BullMQ, а не на стену.
  3. `RUN_STALE_THRESHOLD_MS` из env (сейчас захардкожена —
     нарушение RULES 4.5/4.6).
- **Когда чинить:** до R3 (LLM-вызовы могут быть долгими).
- **Связанные:** KI-023.
- **Fix:** `RUN_STALE_THRESHOLD_MS` вынесен в env
  (`WORKFLOW_RUNS_STALE_THRESHOLD_MS`, default 300000). Хардкод
  удалён из `runs.constants.ts`. Схема — `WorkerEnvSchema` в
  `env.schema.ts`, значения читает `runs.worker-options.ts`.
- **Остаток:** KI-066 (нет heartbeat — долгий легитимный запуск
  превысит порог и может дать параллельный replay).

---

### KI-010 — pnpm 12 перезаписывает `pnpm-lock.yaml` при каждом запуске
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `37cabba`) | **Исправлено:** 2026-10-13
- **Файлы:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json` (`packageManager`)
- **Описание:** pnpm 12 c полем `packageManager` в `package.json` при каждом
  запуске не-install команды (`build`, `test`, `exec`, `db:generate`) добавляет
  в `pnpm-lock.yaml` служебную запись `@pnpm/exe@12.11.2` (self-management,
  pnpm/pnpm#14575). `install` пишет один набор ключей в
  `packageManagerDependencies`, остальные команды — другой; lockfile
  «мерцает» в обе стороны, и любой коммит с ним ломает CI-шаг
  `pnpm install --frozen-lockfile`.
- **Fix:** `pmOnFail: ignore` в `pnpm-workspace.yaml` — официальная замена
  удалённого `managePackageManagerVersions: false`. Отключает проверку версии
  и переключение на заявленную в `packageManager` → pnpm не пишет
  `@pnpm/exe` → lockfile стабилен.
- **Проверено:** `pnpm config list` показывает `pmOnFail: ignore`;
  после `pnpm build` и `pnpm test` `git status --short pnpm-lock.yaml` пуст.
- **Альтернатива (не использована):** `corepack enable` — падает с
  `EPERM` на Windows без прав администратора (shim-файлы создаются в
  `C:\Program Files\nodejs\`). В CI на ubuntu-latest работает, но для
  локальной разработки неприменим.
- **Связанные:** —

---

### KI-596 — Нет отдельного rate limit на отправку приглашений
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.controller.ts`,
  `src/email/email.service.ts`
- **Описание:** `POST /admin/members/invite` подчиняется только глобальному
  `ThrottlerGuard` (300 req/min на IP): owner/admin может отправить сотни
  писем в минуту (и больше — с разных IP), то есть использовать домен
  продукта как источник спама; квот на организацию/пользователя и суточного
  лимита нет. SMTP-провайдеры за такое блокируют домен, а репутация отправителя
  (`SMTP_FROM`) общая для инсталляции.
- **Решение:** `@Throttle` на invite (например, 10/мин), суточная квота по
  организации (в БД или Redis), счётчик/метрика отправленных писем, аудит
  превышений; при росте — подтверждение email владельца перед массовыми
  приглашениями.
- **Связанные:** KI-584, KI-592.

### KI-208 — @nestjs/passport в deps не используется
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `package.json`
- **Описание:** `@nestjs/passport@^12.0.0` остаётся в `dependencies`,
  но после R6.1a (Auth — кастомный `JwtAuthGuard` через `@nestjs/jwt`,
  без `passport-jwt`) не импортируется нигде. DESIGN v0.8 § 3.1
  оставляет как «задел».
- **Решение:** удалить из deps (если Passport не планируется) или
  задокументировать причину оставить.
- **Когда чинить:** при следующей чистке deps.
- **Связанные:** KI-201.

---

### KI-031 — Повторный запуск зависшего run дублирует `node_runs`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `cbc347c`)
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** KI-023 разрешает выполнить граф заново, но строки
  от умершей попытки не удаляются: у одного `(run_id, node_id)` окажутся
  две записи (часть — «висящие» `running`), а `collectInputsAsync`
  с `.limit(1)` возьмёт произвольную.
- **Возможные решения:**
  1. Очистка `node_runs` по `run_id` перед перезапуском.
  2. Идемпотентный upsert по `(run_id, node_id)`.
- **Когда чинить:** до R4 (UI начнёт показывать историю узлов).
- **Связанные:** KI-023.
- **Fix:** `unique (run_id, node_id)` (`node_runs_run_id_node_id_uniq`)
  + `ON CONFLICT DO UPDATE` в `executeNodeAsync`. Повторный прогон
  графа обновляет ту же строку. Миграция
  `drizzle/0002_steady_molecule_man.sql`.

---

### KI-402 — каталог embedding-моделей не формализован
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/llm/llm-provider.factory.ts`,
  `src/llm/llm-registry.service.ts`
- **Описание:** `text-embedding-3-small` с префиксом `openai/` у RouterAI,
  но другие провайдеры (GPTunnel, DeepSeek, Yandex) не проверялись.
  `resolveEmbeddingModel` знает только RouterAI.
- **Решение:** таблица embedding-моделей с alias по провайдеру.
- **Связанные:** KI-128, KI-174.

---

### KI-482 — docxtemplater печатает контекст шаблона в stdout при ошибке (Low)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-19
- **Исправлено в:** v0.11.0 (S2) — опция `errorLogging: false` в
  `DocumentTemplateService.createDocument`.
- **Файлы:** `src/documents/document-template.service.ts`
- **Описание:** по умолчанию docxtemplater (`errorLogging: true`) пишет в
  консоль объект ошибки вместе с `properties.context` — фрагментом
  пользовательского документа. Это нарушает RULES 5.9 (содержимое документов и
  промптов не логируется) и засоряет stdout воркера.
- **Решение:** отключить `errorLogging`; ошибка всё равно уходит наверх через
  `DocumentTemplateInvalidException` с `details[]` (файл-часть + объяснение,
  без содержимого документа).
- **Связанные:** RULES 5.9, DESIGN v0.11 § 3.1.3.

---

### KI-121 — Типы узлов дублируются в четырёх местах
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.1 (коммит `990e705`)
- **Файлы:** `web/src/lib/node-registry.ts` (новый),
  `web/src/types/graph.ts`, `web/src/components/nodes/index.ts`,
  `web/src/stores/workflow.ts`, `web/src/components/Toolbar.tsx`
- **Описание:** `NodeType` (graph.ts), ключ registry (`nodes/index.ts`),
  литерал в `createNode`, литерал в `fromApiWorkflow`, массив
  `BUTTONS` в `Toolbar` — **пять независимых** написаний одного
  значения. `tsc` ловит `NODE_TYPE_LABELS/ICONS` (`Record<NodeType,...>`),
  но **не** цепочку `node.type !== 'text' && ...` в `fromApiWorkflow` —
  именно там сломался бы Load незамеченным.
- **Решение:** вывести ключи registry из `NodeType` (единый
  `NODE_REGISTRY`), заменить `!==`-цепочку в `fromApiWorkflow` на
  `isNodeType()`, строить `Toolbar` из реестра.
- **Когда чинить:** — (закрыто, v0.6.1).
- **Fix:** Единый реестр `NODE_REGISTRY`
  (`Record<NodeType, NodeRegistryEntry>`) — метаданные, компоненты,
  `isNodeType()`, `nodeTypes` для React Flow. `fromApiWorkflow`
  переведён с цепочки `!==` на `isNodeType()` — новый тип узла
  больше не теряется молча при Load (tsc ловит). `Toolbar` строит
  кнопки из реестра, локальный `BUTTONS` удалён. `nodes/index.ts` —
  тонкий реэкспорт. `Canvas.tsx` не менялся.
- **Остаток:** `default:`-ветки в `createNode`/`nodeDataFromApi` не
  поймают 4-й тип — расширить при добавлении узла (KI-129 —
  уборка типов; KI-127 частично закрыт: категории в реестре есть).
- **Связанные:** KI-122, KI-123, KI-127, KI-129.

---

### KI-304 — Узлы подграфа видны в `node_runs`/SSE под префиксными id
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/runs/runs-stream.service.ts`, `web/src/stores/workflow.ts`
- **Описание:** Узлы подграфа пишутся с id `sub_<nodeId>__…`, которых
  нет в UI-графе → подсветка статуса подграфа не работает;
  «сиротские» ключи в `workflow_runs.outputs`; нет маппинга ошибок
  backend → i18n (ключи `node.sub_workflow.recursion_error` /
  `depth_error` объявлены, но не рендерятся).
- **Решение:** схлопывать префиксные id при публикации событий
  и агрегировать outputs подграфа под id родительского узла.

---

### KI-326 — Vite dev слушает только `[::1]:5173`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.3 (коммит `c6edf91`)
- **Файлы:** `web/vite.config.ts`
- **Описание:** Netstat: `TCP [::1]:5173 LISTENING`. `fetch` по
  `127.0.0.1:5173` → `ECONNREFUSED`; CDP-смоук по 127.0.0.1 даёт
  `chrome-error://chromewebdata/`. Потрачен цикл диагностики.
- **Решение:** в смоуке использовать `localhost`; либо
  `server.host: '127.0.0.1'` в `web/vite.config.ts`.
- **Fix:** `web/vite.config.ts` `server.host: '127.0.0.1'` — Vite слушает
  IPv4, не только `[::1]`. Netstat: `127.0.0.1:5173 LISTENING`,
  `[::1]` отсутствует; HTTP-пробы 200 по 127.0.0.1 и localhost.
- **Связанные:** KI-072, KI-120, KI-299.

---

### KI-275 — CDP-смоук: hidden-страница молча отбрасывает OS-ввод
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** временные скрипты смоука
- **Описание:** В видимом Chrome стенда `document.hidden === true` и
  `Input.dispatchKeyEvent` / `dispatchMouseEvent` **не доходят** до
  страницы (0 событий при `hasFocus === true`). `Page.bringToFront`,
  `Page.setWebLifecycleState`, `Emulation.setDeviceMetricsOverride`,
  `SetForegroundWindow` / `AttachThreadInput` не помогают. Симптом
  неотличим от бага приложения — первые прогоны дали ложный FAIL.
- **Решение:** в смоуке проверять `document.visibilityState` до
  нажатий; при `hidden` — запускать headless Chrome (`--headless=new`).
  В отчёт добавлять строку «видимость страницы».
- **Связанные:** KI-264, KI-135.

---

### KI-009 — `pnpm start` на Windows оставляет node-процесс после завершения
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** —
- **Описание:** На Windows `pnpm start` через родительский pnpm оставляет
  node-процесс живым (типичная проблема Windows — orphaned child). При
  повторном запуске — `EADDRINUSE` на порту 3000.
- **Fix для пользователя:**
  ```powershell
  netstat -ano | Select-String ":3000.*LISTENING"
  Stop-Process -Id <PID> -Force
  ```
- **Возможное улучшение:** добавить npm-скрипт stop:dev, который
  убивает процесс на 3000.  

---

### KI-234 — Нет rate-limit на публичных ручках
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.9.1 (коммит `af1766d`) — `GET /workflow/share/:token` защищён (5/мин).
- **Остаток (v0.9.0):** throttler'а на публичных ручках нет —
  `GET /workflow/share/:token` и `POST /auth/login` по-прежнему без
  ограничения. R7.7 добавил per-provider семафор (KI-067), это не HTTP
  rate-limit. KI остаётся открытым вместе с KI-206.
- **Файлы:** `src/workflow/workflow-share.controller.ts`,
  `src/auth/auth.controller.ts`
- **Описание:** `GET /workflow/share/:token` без throttler — перебор
  uuid v4 нереален (122 бита), но сканирование/DoS не ограничено.
  Аналогично `POST /auth/login` (KI-206).
- **Решение:** `@nestjs/throttler` на публичных ручках (share,
  login, refresh).
- **Когда чинить:** v0.8.x (закрывает и KI-206).
- **Связанные:** KI-197, KI-206.

---

### KI-616 — Email маскируется только в `member.invite`/`member.remove`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-05
- **Файлы:** `src/audit/audit.interceptor.ts`
- **Описание:** маскирование email (KI-589) включено для действий управления
  составом организации. Другие действия тоже могут писать email в metadata:
  `collaborator.invite` (`POST /workflow/:id/collaborators` принимает
  `{ email, role }`), потенциально `member.role_change` при расширении тела.
  Это осознанное ограничение постановки S5, но PII-политика должна быть
  единой.
- **Решение:** расширить набор действий или применять маскирование ко всем
  metadata, где встречается email, с исключением для полей, которым адрес
  нужен для расследования (зафиксировать политику в RULES § 5).
- **Связанные:** KI-589, KI-572.

### KI-496 — Нет DB-интеграционного спека на SQL-флаги
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `src/runs/runs.processor.spec.ts`
- **Описание:** Вычисление `leaseExpired` и `legacyStale` проверено только моками, нет реального `SELECT` к Postgres.
- **Решение:** добавить в `test:parity` или отдельный интеграционный тест.

---

### KI-546 — Bing v7 и Brave не поддерживают `searchDepth`
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/web-search/providers/bing.provider.ts`,
  `src/web-search/providers/brave.provider.ts`,
  `web/src/components/nodes/WebSearchNode.tsx`, `src/engine/node-executors.ts`
- **Описание:** Задача v0.15 S3 называет `searchDepth` опцией «для
  Tavily/Bing» (DESIGN v0.14 § 3.3 говорит только «`searchDepth` для Tavily,
  `freshness` для Brave» — Bing там не упомянут), но ни Bing Web Search API v7,
  ни Brave Search API не имеют параметра глубины поиска. Поле добавлено в общий
  `WebSearchOptions` и принимается Zod-схемой узла ради единого контракта, но в
  запрос Bing/Brave не уходит (провайдер пишет debug-лог, исполнитель дополнительно
  гейтит по `WEB_SEARCH_DEPTH_PROVIDERS`), а UI скрывает селект
  для них, чтобы настройка не выглядела работающей. Tavily передаёт
  `search_depth` как есть.
- **Решение:** оставить как есть до появления параметра в API; «глубину» у Bing
  имитировать нельзя (`count`/`freshness` — другие оси). При добавлении
  параметра — ветка в провайдере и запись в
  `WEB_SEARCH_DEPTH_PROVIDERS` (backend и web).

### KI-035 — Нормализация входов сворачивает multi-input
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/node-ports.ts`, `src/engine/engine.service.ts`
- **Описание:** У `llm` / `image_generation` один входной порт (`prompt`),
  поэтому две связи в один узел пишут в один ключ — вторая перекрывает
  первую. Зафиксировано тестом «сворачивает несколько входов».
- **Решение:** per-handle контракт (`inputPortName` по `targetHandleId`).
- **Когда чинить:** R4, вместе с multi-input UI (`merge`, `condition`).
- **Связанные:** KI-034, KI-003.

---

### KI-138 — Тосты хранят готовый текст, а не ключ
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/stores/workflow.ts` (`notice: { kind, text }`),
  `web/src/components/Toast.tsx`
- **Описание:** `notice.text` формируется в сторе через `i18n.t()`
  в момент события. При смене языка уже показанный тост остаётся
  на прежнем языке (видно на EN-скриншоте R5.3: «Workflow
  загружен: …»).
- **Решение:** хранить `notice: { kind, key, params }`, переводить
  в `Toast.tsx` через `t(key, params)`.
- **Когда чинить:** при UX-полировке (v0.7.x или v0.8).
- **Связанные:** KI-126.

---

### KI-221 — Проверка KI-213 привязана к точному `production`
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (Пакет 3, коммит 4a214f7)
- **Fix:** NODE_ENV enum += `staging`/`preprod`; superRefine обе
  проверки (AUTH_DISABLED, COOKIE_SECURE) применяются к prod-подобным
  через `isProdLike`. +3 теста.
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** Для `staging` / `preprod` (если появятся) ослабление
  авторизации останется разрешённым. Нужен отдельный признак окружения
  или allowlist «prod-подобных» значений `NODE_ENV`.
- **Решение:** `ENVIRONMENT` enum или regex-проверка.
- **Когда чинить:** при появлении staging.
- **Связанные:** KI-213.

---

### KI-548 — `GET /web-search/providers` вне контракт-гейта
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-11-02
- **Файлы:** `docs/development/api-contract.json`,
  `src/runs/dto/api-contract.spec.ts`, `web/src/lib/api-contract.spec.ts`
- **Описание:** Новый эндпоинт v0.15 S3 отдаёт `{ defaultProvider, providers }`,
  но в `api-contract.json` не добавлен: гейт KI-352 сверяет только DTO,
  перечисленные в `DTO_SOURCES`/`MIRROR_SCHEMAS`. Переименование поля с одной
  стороны не поймает ни один spec (web-тест парсит ответ своим Zod-зеркалом, но
  не сверяет состав с backend). Ключи в ответе отсутствуют — утечки нет.
- **Решение:** добавить `WebSearchProvidersResponse`/`WebSearchProviderInfo` в
  JSON-контракт и оба spec'а в следующем срезе, где меняется api-contract.
- **Реализовано в v0.16 S1:** оба DTO добавлены в `responses`, домены
  `WebSearchProviderInfo.name` и `WebSearchProvidersResponse.defaultProvider` —
  в `enums` (источник — `WebSearchProviderNameSchema`, `z.enum`). Backend-spec
  читает TS-интерфейсы компилятором, web-спека — Zod-зеркала; добавлены
  негативные проверки «в ответе нет `apiKey`/`token`».

### KI-177 — LM Studio auto-discovery работает только на старте
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/llm/llm-provider.factory.ts`
- **Описание:** Каталог запрашивается один раз при инициализации.
  LM Studio, запущенный после backend, остаётся невидимым до
  перезапуска приложения (KI-088).
- **Решение:** фоновое обновление или `POST /llm/refresh`.
- **Когда чинить:** v0.8 (при появлении кэша каталога).
- **Связанные:** KI-088, KI-117.

### KI-445 — Миникарта полностью пустая (белый квадрат)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.4
- **Файлы:** `web/src/styles/theme.css`, `web/src/components/Canvas.tsx`
- **Описание:** `<MiniMap />` рендерится, рамка и тень на месте, но внутри —
  пустой белый квадрат: узлы, маска и контур вьюпорта не отрисовываются.
  Регресс или недоделка после KI-158 (контраст + рамка миникарты):
  переменные `--xy-minimap-*` объявлены в `@theme`, но React Flow задаёт
  те же переменные в области `.react-flow`, поэтому значения могут
  перекрываться, а фон и маска — совпадать с цветом узлов.
- **Что проверить:**
  1. Computed-значения `--xy-minimap-background-color`,
     `--xy-minimap-mask-background-color`,
     `--xy-minimap-node-background-color` на `.react-flow__minimap`.
  2. Порядок подключения `theme.css` и стилей `@xyflow/react` (кто
     побеждает по специфичности).
  3. Пропсы `<MiniMap />` (`nodeColor`, `maskColor`, `nodeStrokeColor`) —
     задать явно вместо CSS-переменных.
- **Связанные:** KI-158, KI-190, KI-133.

---

### KI-517 — `Dockerfile` не пинит версию Node (>= 22.19)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `Dockerfile`
- **Описание:** `undici@8` требует Node >= 22.19, а используется плавающий `node:22-alpine`.
- **Решение:** запинить тег `node:22.19-alpine`.

---

### KI-395 — allowlist sandbox расширен сверх DESIGN § 3.5
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-17
- **Файлы:** `src/sandbox/quickjs-runner.service.ts`,
  `docs/development/v0.9/DESIGN_V09_FEATURES.md` § 3.5
- **Описание:** DESIGN § 3.5 ограничивал allowlist 8 именами (`Math`, `JSON`,
  `Date`, `String`, `Number`, `Array`, `Object`, `Boolean`). Из-за этого
  `throw new Error('x')` падал с `TypeError`, `input.match(/foo/)` не
  работал. Добавлены `Error`, `RegExp`, `Map`, `Set`, `Promise`, `Symbol` —
  безопасны в QuickJS-реалме (нет `process`/`require`/`fetch`). Тесты 26/26.
- **Решение:** DESIGN § 3.5 обновить до 14 имён + `input`; либо оставить как
  есть, зафиксировав расхождение DESIGN ↔ код.
- **Связанные:** KI-364, DESIGN v0.9 § 3.5.

---

### KI-365 — OpenTelemetry traces (observability)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.0 (R7.7, коммит `3e2844a`)
- **Fix:** адаптер `tracing.ts` (no-op по умолчанию) + `OtelService`
  (SDK стартует при `OTEL_ENABLED=true`, гасится в
  `onApplicationShutdown`). Spans: `run.execute`, `node.execute`,
  `llm.call`, `media.createTask`. Смоук: живой POST `/v1/traces` (4 span'а).
- **Остаток:** span `agent.step` не добавлен — KI-416.
- **Файлы:** `src/main.ts`, `src/observability/otel.service.ts`,
  `src/observability/tracing.ts`, `package.json`, `.env.example`
- **Описание:** Нет телеметрии — невозможно диагностировать медленные
  LLM/media-вызовы, узкие места в цепочке узлов. Production-ready продукт
  требует traces.
- **Решение:** OTel spans на уровнях `run.execute`, `node.execute`,
  `llm.call`, `media.createTask`, `agent.step`. Env `OTEL_ENABLED=false`
  (default), `OTEL_EXPORTER_OTLP_ENDPOINT`. Локально — Jaeger через
  `docker-compose.otel.yml`. Реализация — DESIGN v0.9 § 3.7 (R7.7).
- **Связанные:** KI-067 (concurrency), KI-206, KI-234, KI-107 (rate limit), KI-055 (reasoning cache), DESIGN v0.9 § 3.7.

---

### KI-245 — Лимит токенов задан в трёх местах
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (Пакет 2, коммит bec48bf)
- **Fix:** `src/llm/llm-constants.ts` — `DEFAULT_MAX_TOKENS` (1024)
  и `REASONING_MAX_TOKENS` (4096) как единый источник; два провайдера
  и фабрика импортируют оттуда.
- **Файлы:** `src/llm/providers/openai-compatible.provider.ts`,
  `src/llm/providers/anthropic.provider.ts`,
  `src/llm/llm-provider.factory.ts`
- **Описание:** `DEFAULT_MAX_TOKENS = 1024` — константа в каждом
  провайдере (2 штуки), `4096` для reasoning — литерал в фабрике.
  Единого источника нет, легко рассинхронизировать.
- **Решение:** один модуль `src/llm/llm-constants.ts` с
  `DEFAULT_MAX_TOKENS` и `REASONING_MAX_TOKENS`.
- **Когда чинить:** при следующей правке провайдеров (v0.8.x).
- **Связанные:** KI-183.

---

### KI-050 — `isDeepStrictEqual` тянет и сравнивает весь JSONB inputs
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/db/schema.ts` (`node_runs`)
- **Описание:** Дедупликация по `isDeepStrictEqual` сравнивает весь
  JSONB `inputs` на **каждом** узле **каждого** прогона (даже когда
  переиспользование не срабатывает). Для больших входов — лишние
  килобайты из БД и CPU.
- **Решение:** хранить `inputs_hash` (например, sha256 от
  канонического JSON) в `node_runs` и сравнивать хэши; полное
  сравнение — только при совпадении.
- **Когда чинить:** до R4 или раньше, если появятся узлы с большими
  inputs (image-gen).
- **Связанные:** KI-046.

---

### KI-296 — `notNull`-дрейф `workflows.created_at/updated_at`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.0e (KI-293-fix, коммит e5f489a)
- **Файлы:** `drizzle/0000_right_valeria_richards.sql`,
  `src/db/schema.ts`, `drizzle/meta/0006_snapshot.json`
- **Описание:** Миграция 0000 создала колонки как nullable; схема
  объявляет `.notNull()`. Snapshot 0000…0005 хранил `notNull: false`,
  `drizzle-kit generate` эмитил `SET NOT NULL` в каждом diff.
- **Fix:** `SET NOT NULL` + `SET DEFAULT now()` добавлены в 0006
  (NULL-значений не было — 86/86 строк заполнены).
- **Связанные:** KI-293, KI-297, KI-298.

---

### KI-355 — обречённый подграф доигрывает независимые ветки
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** после KI-337 подграф с падением доигрывает независимые ветки
  (симметрия с KI-287/RULES 4.16); возможны платные LLM/media-вызовы,
  результаты которых никуда не попадут. Продуктовое решение:
  консистентность важнее экономии.
- **Решение:** зафиксировать выбор или ввести early-abort отдельным подшагом
  (связано с KI-067 — cost budget/concurrency).
- **Связанные:** KI-337, KI-287, KI-067.

---

### KI-153 — Стоимость локального вызова не зависит от наличия usage
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/llm/model-pricing.ts` (`calculateCostUsdForProvider`)
- **Описание:** Для `isLocal` возвращается `0` даже когда `usage === null`. Это
  осознанно (локальная модель бесплатна независимо от того, посчитал ли сервер
  токены), но означает, что у локальных узлов `cost_usd` заполнен, а
  `tokens_in/tokens_out` могут быть `null` — панель покажет `$0.00` без токенов.
- **Решение:** явно показывать «токены неизвестны» при нулевой стоимости.
- **Когда чинить:** при жалобах на пустые токены у локальных моделей.
- **Связанные:** KI-148, KI-152.

---

### KI-369 — lipsync требует audio, нет поля в UI
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.1 (коммит `af1766d`) — добавлено поле `audioUrl` в `ImageToolNode`.
- **Файлы:** `web/src/components/nodes/ImageToolNode.tsx`
- **Описание:** lipsync требует два входа (видео + аудио). Audio
  передаётся через `data.params.audioUrl`; если нет — понятная ошибка до
  платного запроса. В UI R7.1 поля для `audioUrl` нет → lipsync из
  интерфейса недоступен (backend поддерживает).
- **Решение:** поле `audioUrl` для `operation='lipsync'` в UI (или R7.2,
  где будут audio-узлы).
- **Связанные:** KI-196, DESIGN v0.9 § 3.1.

---

### KI-449 — UI не различает «результат не сохранён» и «ссылка истекла»
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `web/src/lib/media-source.ts`
- **Описание:** оба случая — «копии у нас нет» (`storedUrl` отсутствует, хотя
  результат у провайдера был) и «TTL своей ссылки истёк» — сейчас дают
  одинаковый результат `{ src: null, expired: true }`, поэтому UI показывает
  один и тот же плейсхолдер «ссылка истекла». Пользователь не понимает, что
  результат не был сохранён из-за сбоя хранилища, а не устарел по времени.
- **Решение:** добавить в `MediaSource` флаг `storageError` (либо
  `reason: 'expired' | 'not-stored'`) и выставлять его, когда `storedUrl`
  нет, но результат провайдера присутствует; в UI показывать разные тексты,
  обновить `media-source.spec.ts` и оба i18n-файла (RULES 1.14).
- **Связанные:** KI-362, KI-443, KI-444.

---

### KI-612 — OTel-трейсы не экспортируются в Prometheus
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-04
- **Файлы:** `src/observability/`, `src/metrics/`
- **Описание:** S4 добавил стандартные process-метрики, но моста
  OTel→Prometheus нет: `OtelService` отправляет трейсы в OTLP-коллектор, а
  `GET /metrics` отдаёт только Prometheus-клиент. Метрики из OTel-инструментов
  (если появятся) не попадут в scrape; корреляция трейсов и метрик — только
  на стороне Grafana (Tempo+Prometheus), если она настроена.
- **Решение:** при необходимости добавить `@opentelemetry/exporter-prometheus`
  и `MeterProvider` с тем же реестром либо явно зафиксировать, что источники
  метрик — только `MetricsService`/`collectDefaultMetrics`.
- **Связанные:** KI-581, KI-609.

### KI-213 — AUTH_DISABLED=true не запрещён в production
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0b (коммит `7e921a7`)
- **Файлы:** `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`
- **Описание:** Случайная env-переменная `AUTH_DISABLED=true` в prod
  отключает всю авторизацию — все запросы идут от системного
  пользователя.
- **Fix:** `EnvSchema.superRefine` — `NODE_ENV='production'` +
  `AUTH_DISABLED=true` → отказ старта. superRefine на итоговой
  схеме (`WorkerEnvSchema` влита через `.shape`). +4 теста.
- **Остаток:** KI-221 (staging/preprod), KI-222 (edge-cases схемы).
- **Связанные:** KI-221, KI-222.

---

### KI-041 — Node-level retry повторяет узел целиком, а не только вызов провайдера
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Для LLM это относительно безопасно, но для будущих узлов
  с побочными эффектами (image-gen R4, HTTP-инструменты) повтор может
  создать дубликат эффекта.
- **Решение:** признак «idempotent» у типа узла либо отключение retry
  для side-effecting типов.
- **Когда чинить:** R4.
- **Связанные:** KI-036.

---

### KI-327 — `AUTH_DISABLED=true` не обходит `POST /auth/refresh`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/auth/auth.controller.ts`,
  `web/src/components/auth/AuthProvider.tsx`
- **Описание:** Гард обходит защищённые ручки, но `/auth/refresh`
  требует cookie → `AuthProvider` → 401 → `ProtectedRoute` → `/login`.
  Смоук вынужден логиниться (`POST /auth/login` + cookie).
- **Решение:** dev-only автологин при `AUTH_DISABLED=true` либо
  явная запись в смоук-чек-лист.

---

### KI-135 — CDP-фокус требует `Emulation.setFocusEmulationEnabled`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** —
- **Описание:** В headless Chrome `element.focus()` выставляет
  `document.activeElement`, но `:focus` не матчится, пока
  `document.hasFocus() === false` — фокусные стили (`focus:ring-*`,
  `focus:border-*`) в smoke не проверяются, дают ложный «не сработало».
  Лечится `Emulation.setFocusEmulationEnabled({ enabled: true })`
  перед проверкой. Обнаружено в R5.2.2 при проверке
  `focus:border-primary`.
- **Решение:** заметка в `docs/development/SMOKE_CDP.md` (новый файл
  при появлении) либо комментарий в CDP-сниппетах.
- **Связанные:** KI-125, KI-132.

---

### KI-268 — SSE-поток запуска недоступен при AUTH_DISABLED=false
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.2a-fix2, коммит 5374164)
- **Fix:** `subscribeToRunStream` переведён с `EventSource` на
  `fetch` + `ReadableStream` (`Authorization: Bearer`,
  `AbortSignal`, refresh на 401, до 3 повторов, `onClose`);
  разбор кадров — `lib/sse-parser.ts` (+7 тестов).
- **Остаток:** KI-271 (F5 посреди Run), KI-272 (onFatalError).
- **Связанные:** KI-063, KI-202, KI-060, KI-271, KI-272.
- **Файлы:** `web/src/lib/run-stream.ts`,
  `src/runs/runs.controller.ts`
- **Описание:** `EventSource` не умеет передавать `Authorization` →
  `GET /runs/:id/stream` получает 401, даже если access-токен есть.
  UI вечно «Создаётся…», при этом `workflow_runs.status='failed'`.
  **С включённой авторизацией прогресс запуска в UI не работает
  вообще** (ни узлов, ни логов, ни финального статуса).
- **Решение:** переписать подписку на `fetch` + `ReadableStream`
  с Bearer-заголовком (или одноразовый stream-токен, или
  cookie-аутентификация этого маршрута).
- **Влияние:** обнаруживается только при `AUTH_DISABLED=false`
  (смоуки до R6.4b.2a-fix шли с `true`).
- **Связанные:** KI-063, KI-202, KI-060.

---

### KI-343 — `tsconfig.spec.json` не покрывает `app.e2e-spec.ts`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `tsconfig.spec.json`, `test/app.e2e-spec.ts`
- **Описание:** `test/**/*.spec.ts` не матчит `-spec.ts`; `pnpm test:e2e` не вызывается в CI.
- **Решение:** добавить `test/**/*-spec.ts` в include и шаг e2e в CI.
- **Связанные:** KI-317.

---

### KI-012 — Глобальный `HttpExceptionFilter` отсутствует
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/main.ts`, `src/common/filters/` (нет)
- **Описание:** RULES § 1.6 / § 4.7 требуют единый формат ошибок
  `{ success: false, message }` через глобальный `HttpExceptionFilter`.
  Сейчас работает дефолтный Nest-формат (`{ statusCode, message, error }`).
  `runs.controller.ts` рассчитывает на глобальный фильтр, но его нет —
  формат ошибок расходится с RULES.
- **Fix:** создать `HttpExceptionFilter` + `app.useGlobalFilters(...)`
  в `main.ts`. ~30 мин.
- **Когда чинить:** отдельным небольшим шагом до R4 (UI ждёт единый формат).
- **Связанные:** —

---

### KI-457 — тип `document_gen` расходится с DESIGN `document_generation` (Medium)
- **Приоритет:** 🟡 Medium | **Статус:** Won't Fix | **Обнаружено:** 2026-10-18
- **Причина (Won't Fix):** v0.10 S6 осознанно оставил `document_gen`/`output`:
  задача S6 и существующие графы используют это имя, а переименование типа
  затронуло бы API/БД и не входило в срез. Это design decision, а не
  незакрытый баг; DESIGN нужно обновить под фактический тип.
- **Файлы:** `web/src/types/graph.ts`, `web/src/lib/node-registry.ts`,
  `web/src/i18n/ru.json`, `web/src/i18n/en.json`,
  `docs/development/v0.10/DESIGN_V010_FEATURES.md`
- **Описание:** S0 зарегистрировал тип и i18n-ключи как `document_gen`
  (`node.document_gen.*`). DESIGN v0.10 § 3.2/§ 4.6 называет тип
  `document_generation`, а категории — `documents`. Пока UI/исполнителя нет,
  расхождение не проявляется, но S6 должен выбрать один контракт до записи
  узлов в БД.
- **Решение:** привести S6 к `document_generation` (с миграцией/алиасом для
  `document_gen` в `nodeDataFromApi`) либо обновить DESIGN; категорию
  `documents` добавить вместе с ключами `catalog.category.*`.
- **Прогресс v0.10 S6:** контракт осознанно оставлен `document_gen`/`output`:
  задача S6 и существующие графы используют это имя, а переименование типа
  затронуло бы API/БД и не входило в срез. Категория `documents` не добавлена.
- **Связанные:** KI-455, KI-462, DESIGN v0.10 § 3.2/§ 4.6.

---

### KI-265 — Расхождение пути репозитория в PROMPT_V5.md
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (docs-коммит R6.4b.1)
- **Файлы:** `docs/development/PROMPT_V5.md`
- **Описание:** В PROMPT_V5.md § 3 указывался путь
  `D:\Projects\AI\workflow-builder`, а промпты задач R6.x —
  `C:\Projects\AI\ai-workflow-builder` (не существовал). Из-за
  расхождения dsh в начале сессии R6.4b.1 получал устаревший снимок
  дерева (без R6.4a). Репозиторий окончательно переехал на
  `D:\Projects\AI\workflow-builder`.
- **Fix:** путь в PROMPT_V5.md приведён к `D:\Projects\AI\workflow-builder`;
  впредь указывать единый путь во всех промптах.
- **Связанные:** KI-264.

---

### KI-601 — Удаление из организации не отзывает действующий access-токен
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Исправлено в:** v1.1.0 (S5) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`,
  `src/auth/guards/jwt-auth.guard.ts`, `src/auth/auth.service.ts`,
  `src/db/schema.ts`
- **Описание:** S2 отзывает refresh-токены участника, но выданный access-токен
  (JWT, 24 ч) остаётся валидным: `JwtPayload.orgId` в нём — старая организация.
  Часть ручек резолвит организацию из БД (`/admin/members*` — S5), но workflow-ручки
  и, что важнее, `GET /admin/audit` (KI-587) фильтруют по `orgId` **из токена**.
  Удалённый участник после переезда становится `owner` своей личной
  организации, поэтому `OrgOwnerGuard` пропускает его к аудиту, а фильтр
  `organization_id = старый orgId` отдаёт журнал организации, из которой его
  исключили, — до истечения токена. Воспроизводимо на живом приложении
  (смоук S2 проверяет только отсутствие доступа к графам, аудит в S2 не
  закрыт).
- **Решение:** немедленный отзыв access-токена — версия токена в `users`
  (`token_version`, сверка в `JwtAuthGuard`), blacklist по `jti` (Redis) или
  короткий TTL; как минимум — закрыть KI-587 (резолвить org из БД для аудита),
  чтобы устаревший `orgId` не давал доступ к данным. Оценить в S5 (Security
  Polish).
- **Fix (v1.1.0 S3):** закрыт известный вектор чтения — `GET /admin/audit`
  резолвит `organization_id` из `users` (KI-587), поэтому удалённый участник со
  старым токеном видит только аудит своей новой (пустой) организации. Смоук:
  после `DELETE /admin/members/:id` старый токен B получает `200 {logs:[],total:0}`
  и не видит журнал A, в том числе с фильтром по `action`/`userId`.
  **Остаток:** сам access-токен по-прежнему валиден 24 ч, и write-пути
  (`AuditInterceptor`, `POST /workflow`) берут `orgId` из токена — удалённый
  участник может создать workflow в старой организации и записать строку в её
  аудит. Это KI-605; полный отзыв (token_version/blacklist) не входил в S3.
- **Fix (v1.1.0 S5):** добавлена колонка `users.token_version` (миграция
  `0018_daffy_triathlon.sql`, DEFAULT 0) и поле `ver` в access-токене.
  `JwtAuthGuard` при каждом запросе читает `organization_id` и `token_version`
  по `sub` и отвечает 401, если строки нет, организация не совпадает с токеном
  или версия устарела. Удаление участника инкрементит `token_version` в той же
  транзакции, что переезд и отзыв refresh-токенов. Старые токены без `ver`
  трактуются как версия 0 (совместимость), но устаревший `orgId` всё равно
  отклоняется. Смоук: после `DELETE /admin/members/:id` старый токен B получает
  **401** на `/auth/me`, `/workflow`, `/admin/audit` и `POST /workflow`;
  новый вход B выдаёт токен с личной организацией и `ver=1`.
- **Связанные:** KI-554, KI-587, KI-560, KI-586, KI-605, KI-614, KI-615.

### KI-077 — Результат запуска недоступен без SSE
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.11.0 (S12+S13) — история узлов вынесена в отдельную
  ручку `GET /runs/:id/nodes` (массив `NodeRunSnapshot`, та же проекция, что в
  SSE-снимке); `RunResponse.nodes` заменён аддитивным `error`. Фронтенд
  `restoreRunAsync` восстанавливает `nodeStatuses`/`nodeOutputs`/`nodeErrors`/
  `nodeLogs`/`nodeMetrics` после F5. Ранее было частичное исправление в v0.10.2
  (`GET /runs/:id` отдавал `nodes`). Отчёт:
  [S12-S13-history.md](development/reports/v0.11.0/S12-S13-history.md).
- **Файлы:** `src/runs/runs.controller.ts`, `src/runs/runs.service.ts`,
  `src/runs/node-run-snapshot.mapper.ts`, `web/src/stores/workflow.ts`,
  `web/src/lib/api.ts`
- **Описание:** `GET /runs/:id` отдавал только `id`/`workflowId`/
  `status`/`createdAt`; `node_runs` API не было. После F5 (или при
  открытии старого запуска) панель **пуста** — данных о
  `outputs`/метриках/логах взять негде.
- **Решение:** `GET /runs/:id/nodes` с `Cache-Control: no-store`; SSE
  открывается только для `pending`/`running`, для финального запуска `?runId=`
  убирается; 404 сбрасывает состояние запуска.
- **Дубль-учёт:** KI-450 — историческая запись; закрыта вместе с этой.
- **Связанные:** KI-061, KI-450, KI-505…508.

---

### KI-522 — Промпт S8 ссылался на устаревшие точки правки API-префиксов
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-19
- **Файлы:** `docs/development/PROMPT_CURRENT.md`,
  `docs/development/RULES.md` (§ 2.17)
- **Описание:** промпт пакета S8 требовал добавить `{ prefix: 'mcp' }` в
  `web/src/lib/api-prefixes.ts` и `API_ROUTE_PATTERN` в `app.module.ts`. С
  v0.10.2 (KI-472) единственный источник правды — `api-prefixes.json`
  (backend строит RegExp из него, web читает оттуда же). Дословное выполнение
  промпта вернуло бы два независимых списка — класс дефекта KI-299/072/472.
- **Решение:** фактическая правка — только `api-prefixes.json`; при следующей
  правке системных инструкций актуализировать `PROMPT_CURRENT.md` (RULES
  2.17). В отчётах фиксировать расхождение промпта с архитектурой.
- **Связанные:** KI-299, KI-472, отчёт `reports/v0.11.0/S8-mcp-ui.md` § 5.

---

### KI-498 — Дублирование релизных метрик в документации
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `README.md`, `docs/README.md`, `PROMPT_CURRENT.md`
- **Описание:** Версии и цифры тестов приходится обновлять в трёх местах вручную, они часто разъезжаются.
- **Решение:** единый `METRICS.md` или генератор статики.

---

### KI-397 — Viewer-UI не скрывает Save/Run
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-17
- **Исправлено в:** v0.9.2 — `accessRole` в сторе; `TopBar` скрывает Save и Run
  для viewer.
- **Файлы:** `web/src/components/TopBar.tsx`, `web/src/stores/workflow.ts`
- **Описание:** Backend корректно блокирует PATCH/POST run для viewer (404),
  но в `TopBar` остаются активными кнопки «Сохранить» и «Запустить».
- **Решение:** добавить признак роли в стор (из `CollaboratorResponse` или
  `GET /workflow/:id.accessRole`), скрывать/disable действия для viewer.
- **Связанные:** KI-197.

---

### KI-354 — дублирование обхода уровней в engine
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Общим сделан только skip-хелпер (`skipBlockedNodesAsync`);
  обработка падений, логирование и сбор outputs в `executeAsync` и
  `executeSubWorkflowGraphAsync` — две копии.
- **Решение:** вынести общий обход уровней в один приватный метод с режимом
  (корень/подграф).
- **Связанные:** KI-337, KI-288.

---

### KI-246 — ReasoningEffort покрывает только off/medium/high
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (Пакет 2, коммит bec48bf)
- **Fix:** union расширен до
  `'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'`;
  `resolveReasoningEffort` возвращает `Exclude<ReasoningEffort, 'off'>`
  — расширяется автоматически вместе с union. `'off'` по-прежнему →
  поле не отправляется.
- **Файлы:** `src/llm/llm-provider.interface.ts`,
  `web/src/components/nodes/LLMNode.tsx` (R6.3.2)
- **Описание:** `ReasoningEffort = 'off' | 'medium' | 'high'`. SDK
  `openai@7.32.0` знает ещё `'none' | 'minimal' | 'low' | 'xhigh' |
  'max'`. Сейчас `off` → поле не отправляется; остальные
  расширенные режимы недоступны.
- **Решение:** расширить union (`'low' | 'minimal' | 'xhigh'` + маппинг
  `off → null`), когда UI покажет больше режимов.
- **Когда чинить:** при появлении запроса от UI (v0.8.x).
- **Связанные:** KI-193.

---

### KI-417 — `cost_usd` для префиксов provider/model (RouterAI)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-18
- **Исправлено в:** v0.9.0 (R7.7, коммит `3e2844a`)
- **Файлы:** `src/llm/model-pricing.ts`
- **Описание:** `bareModelId('openai/gpt-4o')` возвращал `openai` (модели
  RouterAI без прайса → `cost_usd=null`). Fallback на последний сегмент
  (в `findModelPricing`, R7.7) → `0.008735` для `gpt-4o`. Остаётся риск для
  новых префиксов, которых нет ни в `MODEL_PRICING`, ни в последнем сегменте.
- **Fix:** в R7.7 (`3e2844a`) — третий шаг поиска по последнему сегменту
  + тест.
- **Решение:** документировать правило «прайс по последнему сегменту».
- **Связанные:** KI-150, KI-055.

---

### KI-306 — `fitView` не умещает граф с большим разбросом координат
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.1 (коммит 5fc4f34)
- **Файлы:** `web/src/components/Canvas.tsx`
- **Fix:** `FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1,
  minZoom: 0.02 }` применён в `useEffect` (после F5), хоткее F,
  `<ReactFlow fitViewOptions>` и `<Controls fitViewOptions>`
  (последнее — обязательно, иначе кнопка Fit игнорирует опции).
  `<ReactFlow minZoom>` не задан — store-дефолт 0.5 для зума колесом.
- **Остаток:** KI-314 (порог 23 050 px, читаемость — KI-328);
  KI-315/KI-316 закрыты (`a32023f`).
- **Связанные:** KI-307, KI-309..311.
- **Описание:** `getViewportForBounds` (@xyflow/system) обрезает zoom
  по `minZoom` (store-дефолт 0.5). Для графа с разбросом ~22 000 px
  (накопленный autoPan) нужен zoom ≈0.02 → clamped до 0.5 →
  центрирование по центру bbox → **оба узла за кадром** после F5,
  несмотря на фикс fitView в R6.5.2-fix2. Касается и кнопки Fit, и
  хоткея F.
- **Решение:** передавать `minZoom` в `fitView({...})` (приоритетнее
  store) либо снизить `<ReactFlow minZoom>`; альтернатива — fit по
  кластеру узлов, не по всему bbox.
- **Связанные:** R6.5.2-fix2, KI-307.

---

### KI-034 — Асимметрия входов и выходов
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0
- **Файлы:** `src/engine/node-ports.ts`, `src/engine/engine.service.ts`,
  `src/engine/execution-engine.service.ts`
- **Описание:** Выходы нормализованы в имена портов (`text` / `url`),
  а входы остаются в UI-id: ключ в `node_runs.inputs` = `targetHandle`
  = `'text-input'` (видно в smoke KI-030). `NodePortContract.targetHandleId`
  объявлен, но нигде не используется. Из-за этого LLM-узлу в R3 придётся
  вытаскивать prompt эвристикой («первое не-null строковое значение»),
  а не по контракту. При multi-input (R4) эвристика сломается.
- **Возможные решения:**
  1. Симметричная нормализация: ключ `plan.inputs` = имя порта
     (`'prompt'`), не UI-id — тогда `inputs['prompt']` читается прямо.
  2. Официально закрепить UI-id как контракт входа и читать по
     `NODE_PORT_CONTRACT[type].targetHandleId`.
- **Когда чинить:** **в R3** (первый реальный потребитель `inputs` —
  LLM-узел). Не откладывать до R4.
- **Связанные:** KI-030, KI-033.
- **Fix:** `NodePortContract.inputPortName` +
  `inferInputPortName(nodeType)` (`src/engine/node-ports.ts`).
  `buildExecutionPlanAsync` использует нормализованное имя
  (`'prompt'` для `llm`/`image_generation`, `'text'` для `text`);
  fallback на `targetHandle → sourceHandle → edge.id` — для узлов
  без контракта. `inputs = { prompt: ... }` вместо `{ 'text-input': ... }`.
  +7 тестов.
- **Остаток:** KI-035 (multi-input схлопывается в один ключ).

---

### KI-089 — `z.url({ protocol })` — deprecated в Zod 4
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** `z.url({ protocol: /^https?$/ })` работает и покрыт
  тестами, но `z.url()` в Zod 4 пришёл на смену
  `z.string().url()`; форма с `protocol` помечена как возможный
  future breaking change.
- **Решение:** следить за мажорными обновлениями Zod; при
  необходимости — `.refine()`.
- **Когда чинить:** при обновлении Zod.
- **Связанные:** KI-085.

---

### KI-167 — Tooltips кнопок React Flow Controls на английском
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.7.1 (коммит `474a93f`)
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** `<Controls />` брал `title`/`aria-label` из встроенного
  `defaultAriaLabelConfig` (`Zoom In`, `Zoom Out`, `Fit View`,
  `Toggle Interactivity`) — на русскоязычном интерфейсе подсказки были
  английскими.
- **Fix:** через проп `ariaLabelConfig` у `<ReactFlow>` подставлены переводы
  (`canvas.controls.*`) — библиотека смёржит их с дефолтными, поэтому свои
  кнопки писать не пришлось.
- **Когда чинить:** — (закрыто, v0.7.1)
- **Связанные:** KI-168, KI-170.

---

### KI-570 — `users.role` глобален для пользователя, а не для членства в организации
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-02
- **Файлы:** `src/db/schema.ts`, `src/audit/org-owner.guard.ts`
- **Описание:** S3 ввёл `users.role` (owner/admin/member/viewer) как одно поле
  пользователя: `OrgOwnerGuard` читает роль по `user.id`, не по паре
  (user, organization). В S3 это эквивалентно (каждый пользователь — в одной
  личной организации), но при появлении membership в нескольких организациях
  (S5) одна роль на пользователя станет неверной моделью. Также роль читается
  из БД на каждый запрос `/admin/audit` (без кэша) — осознанно ради немедленного
  отзыва прав.
- **Решение:** в S5 при введении членства — вынести роль в
  `organization_members(user_id, organization_id, role)` и обновить guard;
  кэш роли не вводить до появления профиля нагрузки.
- **Связанные:** DESIGN v1.0 § 2.1/§ 3.2, S5.

### KI-378 — data:-URI результатов OpenAI Images не рендерятся в UI
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.9.1 — `isRenderableMediaUrl` разрешает `data:image/...`.
- **Файлы:** `web/src/lib/media.ts`, `src/media/providers/openai-images.provider.ts`,
  `src/runs/dto/run-stream-message.dto.ts`
- **Описание:** `gpt-image-1` отдаёт результат как `data:image/png;base64,...`;
  `isRenderableMediaUrl` (KI-006) разрешает только `http(s)` → узел
  `image_generation` показывает «Некорректный URL результата». Плюс 1–3 МБ
  base64 в `node_runs.outputs` (JSONB) раздувают строки/SSE.
- **Решение:** (а) расширить `isRenderableMediaUrl` на
  `data:image/(png|jpeg|webp|gif)` — безопасно (SVG остаётся запрещён);
  (б) R7.8 (Media storage) — сохранение в S3 + https-ссылка.
- **Связанные:** KI-006, KI-362, DESIGN v0.9 § 3.8.

---

### KI-182 — LLM-селект не показывает vision-модели
- **Приоритет:** 🟠 High | **Статус:** Documented (не воспроизводится) | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`,
  `web/src/lib/llm-models.ts`
- **Описание:** `/llm/models` отдаёт `qwen3.6-35b-a3b/latest` (Yandex)
  с `inputModalities: ['text','vision']`, но в UI-селекте LLM-узла эта
  модель якобы не видна.
- **Диагностика (2026-10-15):** не баг кода. LLMNode не
  использует `filterModelsByInput`; `groupLlmModelsForSelect` работает
  правильно (`qwen3.6-35b-a3b` в группе «Текст + Vision», бейдж `[V]`).
  Наблюдение объяснялось старым `.env` (`yandexgpt-lite/latest` без
  `gpt://`) — Yandex давал 0 моделей.
- **Fix:** добавить 5 тестов на группировку (контракт не сломать).
- **Когда чинить:** — (закрыто как невоспроизводимое, v0.7.2)
- **Связанные:** KI-174, KI-175, KI-092.

### KI-615 — `JwtAuthGuard` делает SELECT в БД на каждый аутентифицированный запрос
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-05
- **Файлы:** `src/auth/guards/jwt-auth.guard.ts`
- **Описание:** ради отзыва access-токена guard читает
  `users.organization_id`/`token_version` по `sub` при каждом запросе. Это
  осознанная цена безопасности (S5, KI-601), но на высоком RPS добавляет один
  SELECT к каждому API-вызову, а роль в `OrgOwnerGuard`/`OrgOwnerOnlyGuard`
  читается вторым запросом. Кэш «sub → org/version» не вводился: он вернул бы
  окно устаревания и усложнил бы отзыв.
- **Решение:** при необходимости — объединить чтение роли и версии в один
  запрос (guard кладёт оба поля в `request.user`), кэшировать с очень коротким
  TTL и явной инвалидацией при удалении участника, либо перенести проверку в
  Redis-blacklist `jti`.
- **Связанные:** KI-607, KI-614.

### KI-600 — Удалённого участника нельзя пригласить обратно
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.1.0 (S4) | **Обнаружено:** 2026-11-03
- **Файлы:** `src/organizations/org-members.service.ts`
- **Описание:** удаление оставляет учётную запись (участник переезжает в
  личную организацию), поэтому `POST /admin/members/invite` на его email
  отвечает 409 «уже зарегистрирован» (KI-583). Вернуть человека в команду можно
  только SQL-правкой `users.organization_id`; UI не подсказывает это
  ограничение при подтверждении удаления.
- **Решение:** вместе с KI-583 (accept-flow для существующих пользователей):
  приглашение существующего пользователя с подтверждением с его стороны;
  до этого — предупреждать в `window.confirm`, что повторное приглашение
  невозможно.
- **Связанные:** KI-583, KI-586.

### KI-480 — Расхождение имён `document_generation` и `document_gen` (Low)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-19
- **Файлы:** `web/src/lib/node-registry.ts`,
  `docs/development/v0.11/DESIGN_V011_FEATURES.md`
- **Описание:** фактический тип узла — `document_gen` (`NODE_REGISTRY`,
  сохранённые графы, API и контракт портов), но DESIGN v0.11 и исторические
  документы местами называют его `document_generation`. Переименование типа
  сломало бы совместимость, поэтому KI-457 закрыт как `Won't Fix`; остаётся
  документационное расхождение, которое вводит в заблуждение при добавлении
  новых полей и контрактных проверок.
- **Решение:** зафиксировать `document_gen` как единственное имя типа,
  `document_generation` — только человекочитаемое название фичи; синхронизировать
  DESIGN, CHANGELOG и i18n-ключи при следующей правке (DESIGN v0.11 § 1.2, § 6).
- **Связанные:** KI-457, DESIGN v0.11 § 1.2.

---

### KI-348 — Нет паритет-гейта backend DTO ↔ web SSE-зеркало
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-16
- **Исправлено в:** v0.8.4 (коммит `87455f2`)
- **Файлы:** `src/engine/run-events.ts` (RunEventSchema), `web/src/types/run-stream.ts`
- **Описание:** Ручное зеркало в `web/src/types/run-stream.ts`; расхождение (KI-NEW-B) валило реальный поток, но не unit-тесты.
- **Решение:** spec-паритет значений/ключей RunEventSchema ↔ зеркало (по образцу api-prefixes).
- **Связанные:** KI-299, KI-350.
- **Fix:** `docs/development/sse-contract.json` — source of truth
  контракта (события + `snapshot.run` + `snapshot.node`). Два
  паритет-спека: `src/runs/dto/sse-contract.spec.ts` (backend) и
  `web/src/types/run-stream-contract.spec.ts` (web). Падение — с
  подсказкой «обнови JSON». Двойные негативные тесты: убрать `error`
  из JSON → падают оба spec'а; добавить `ghost` → падают оба.
- **Остаток:** KI-350, KI-352.
- **Связанные:** KI-299 (тот же паттерн «один список + два
  паритет-спека»), KI-072, KI-120.

---

### KI-271 — После F5 посреди запуска прогресс не восстанавливается
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-15
- **Исправлено в:** v0.8.0e (R6.4b.2a-fix3, коммит 531a062)
- **Fix:** `runId` синхронизируется с адресной строкой (`?runId=`,
  `lib/url-sync.ts`): пишется при старте Run, убирается на
  `run_completed(final:true)` и на финальном snapshot;
  `loadWorkflowAsync` при наличии `?runId=` не сбрасывает состояние
  запуска, а подписывается на поток заново — snapshot возвращает
  статусы узлов и run-уровня. Недоступный запуск (404/401) даёт
  `RunStreamUnavailableError`: URL очищается, состояние сбрасывается,
  повторов нет.
- **Остаток:** KI-063 (окно между попытками job'а — `?runId=` может
  очиститься преждевременно; закроется с KI-063).
- **Связанные:** KI-268, KI-063, KI-049.
- **Файлы:** `web/src/stores/workflow.ts` (`loadWorkflowAsync` →
  `resetRunState`), `web/src/App.tsx`, `web/src/lib/run-stream.ts`
- **Описание:** Reload в момент `runStatus='running'` → после
  загрузки `runId=null`, `runStatus=null`, новых запросов
  `/runs/:id/stream` нет, тогда как в БД запуск завершился штатно.
  Раньше переподключение давал `EventSource` (KI-049); с `fetch`
  автоперезапуска после reload нет — нужна явная логика resume.
- **Решение:** хранить `runId` в URL (`?runId=`) или
  `sessionStorage`; после загрузки графа — подписываться заново
  (`snapshot` из БД восстановит статусы узлов и итог).
- **Связанные:** KI-268, KI-049, KI-063.

---

### KI-401 — `vector_upsert` неидемпотентен
- **Приоритет:** 🟡 Medium | **Статус:** Won't Fix | **Обнаружено:** 2026-10-17
- **Причина (Won't Fix):** append-only — осознанная семантика R7.4a: один Run
  добавляет новый набор чанков, ключа идемпотентности у коллекции нет
  (решение обосновано в отчёте R7.4a). Дедупликация по `content_hash` —
  новая фича, а не исправление текущего контракта.
- **Файлы:** `src/vector/vector-store.service.ts`,
  `src/engine/node-executors.ts`
- **Описание:** Повторный Run добавляет новую строку в ту же коллекцию.
  Дедупликации по content-hash нет — дубли чанков в `workflow_vectors`.
- **Решение:** `content_hash` + unique partial index ИЛИ режим
  replace-by-collection (TRUNCATE + INSERT).
- **Когда чинить:** — (by design; при необходимости — отдельная фича v0.11+).
- **Связанные:** KI-128, R7.4a.

---

### KI-194 — Note / Compare узлы
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/types/graph.ts`, `web/src/lib/node-registry.ts`
- **Описание:** GPTunnel: «Заметка» и «Сравнение» в группе «Ввод и
  заметки». Заметка — текстовый комментарий; Сравнение — сравнение
  двух входов (diff/LLM-judge).
- **Решение:** новый узел `note` (комментарий-стикер) и `compare`
  (2 входа, 1 выход — либо diff, либо LLM).
- **Когда чинить:** v0.8.
- **Связанные:** KI-187.

---

### KI-310 — `web/tsconfig.app.json` (`types: ["vite/client"]`) блокирует `node:*`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
- **Файлы:** `web/tsconfig.app.json`
- **Описание:** `node:*` / `process` недоступны в `web/src/**`,
  включая `*.spec.ts` — node-логика в web-тестах невозможна.
  Обойдено через `import.meta.glob` (Vite-native).
- **Решение:** при необходимости — отдельный tsconfig для спеков
  с `@types/node`.
- **Связанные:** KI-313.

---

### KI-003 — `executionMap` теряет данные при нескольких входах без `targetHandle`
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.4.0 (коммит `4ea0fb4`)
- **Файлы:** `src/engine/engine.service.ts` (метод `buildExecutionPlanAsync`)
- **Описание:** Если у узла несколько входящих связей и у них не задан
  `targetHandle`, все они пишутся в ключ `input` (дефолт) и перезаписывают
  друг друга. Для multi-input узлов (`merge`, `condition`) данные теряются.
  Для текущих MVP-нод (`text`, `llm`, `image_generation`) — не проблема
  (у всех один вход).
- **Возможные решения:**
  1. Ключ = `edge.id` — исключает коллизии полностью. **Рекомендуется.**
  2. Ключ = `targetHandle ?? sourceHandle ?? edge.id`.
  3. Собирать массив: `inputs: { [targetHandle]: InputRef[] }`.
- **Когда чинить:** перед реализацией Runner (который будет реально исполнять
  граф и потреблять `executionMap`). Не блокер для frontend.
- **Fix:** ключ = `targetHandle ?? sourceHandle ?? edge.id`
  (`src/engine/engine.service.ts`). Покрыто тестами (28 в engine.service.spec).
- **Когда чинить:** — (закрыто)

---

### KI-420 — In-memory ThrottlerStorage не общий между инстансами
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S15) | **Обнаружено:** 2026-10-18
- **Файлы:** `src/app.module.ts`, `src/common/throttler/redis-throttler.storage.ts`
- **Описание:** При N инстансах лимит умножается на N.
- **Решение:** `RedisThrottlerStorage` (атомарный `EVAL` Lua, отдельное fail-fast
  соединение, fallback в память при недоступном Redis); `AppModule` собирает
  `ThrottlerModule.forRootAsync`. `THROTTLER_STORAGE=memory` — аварийный режим.
  Отчёт: [S14-S15-security-infra.md](development/reports/v0.11.0/S14-S15-security-infra.md).
- **Связанные:** KI-387, KI-419, KI-513…516.

---

### KI-422 — Лимиты @Throttle статические
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `src/http-throttle.constants.ts`
- **Описание:** 5/мин и 300/мин захардкожены, нельзя изменить без пересборки.
- **Решение:** `ThrottlerModule.forRootAsync`.

---

### KI-411 — `runError` не сбрасывается при успешном retry
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
- **Файлы:** `web/src/stores/workflow.ts`
- **Описание:** `runError` остаётся текстом прошлой попытки (панель не рисует
  его при `completed`, но поле stale).
- **Решение:** очищать `runError` при `run_started`.
- **Связанные:** KI-410.

---

### KI-020 — Мёртвое поле `executionMap` во фронтенде
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/lib/api.ts`
- **Описание:** `ExecutionPlan.executionMap` объявлено, но рантайм его не
  читает (используется только `levels` через `web/src/lib/plan.ts`).
  После KI-003 тип остаётся совместимым (`inputs: Record<string, unknown>`),
  но поле стоит убрать в R4, чтобы не расходилось с бэком.
- **Когда чинить:** R4.
- **Связанные:** KI-003.

---
## v1.2.0 — LLM Router + Healthcheck (S1, 2026-11-06)

### KI-617 — Роутер подменяет выбранную модель и не сверяет её возможности
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.3.0 (S1) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-router.service.ts`, `src/llm/model-capabilities.ts`,
  `src/llm/llm-registry.service.ts`, `src/llm/llm-provider.interface.ts`
- **Описание:** при `LLM_ROUTER_ENABLED=true` модель из графа/агента теряется в
  двух местах: (1) если LM Studio не объявил выбранный id, роутер берёт
  **первую** локальную модель; (2) если локальный вызов упал, fallback идёт
  моделью из `LLM_ROUTER_FALLBACK_MODEL`, а не выбранной пользователем.
  Модальности, `supportsReasoning`, поддержка tool-calling и размер контекста
  не сверяются: vision-узел может уйти в текстовую локальную модель, а
  agent-узел — в модель без инструментов. Ошибка в таком случае выглядит как
  отказ провайдера, а не как «роутер выбрал неподходящую модель».
- **Решение:** явный маппинг «облачная модель → локальная» (`LLM_ROUTER_MODEL_MAP`
  или `data.localModel`), сверка `inputModalities`/`supportsReasoning` перед
  локальной попыткой и fallback на исходную облачную модель, если она
  объявлена провайдером; опция «не роутить узлы с vision/tools».
- **Реализовано (v1.3.0 S1):** `ModelInfo` получил `supportsTools`/`maxTokens`;
  `buildModelCapabilities`/`isCapabilityCompatible`/`describeCapabilityGaps`
  (`model-capabilities.ts`) описывают требования (модальности, reasoning,
  tool-calling, контекст) и причины несовместимости. Роутер строит требования
  из паспорта исходной модели и опций (`requiresTools` выставляет агент),
  берёт локальную модель только при совместимости (иначе сразу облако) и в
  fallback предпочитает исходную облачную модель, затем
  `LLM_ROUTER_FALLBACK_MODEL`, затем первую совместимую облачную (WARN), а при
  отсутствии совместимых — `LlmProviderException` с перечнем причин. Явный
  маппинг «облачная → локальная» (`LLM_ROUTER_MODEL_MAP`) не делался: см.
  KI-630/KI-631.
- **Связанные:** KI-193, KI-574, KI-619, KI-629..631.

---

### KI-618 — Статус healthcheck не отдаётся наружу
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.2.0 (S3) | **Обнаружено:** 2026-11-06
- **Запланировано:** v1.2 S3 (UI-индикатор, DESIGN V120 § 3.4)
- **Файлы:** `src/llm/llm-health.service.ts`, `src/llm/llm.controller.ts`
- **Описание:** `LlmHealthService.getStatus()` (`unknown`/`available`/
  `unavailable`) доступен только внутри процесса. Ни `GET /llm/models`, ни
  отдельной ручки нет, поэтому оператор видит состояние LM Studio только по
  WARN в логе, а UI-индикатор `GPU: online/offline` (DESIGN § 3.4) сделать
  нечем.
- **Решение:** `GET /llm/health` (под auth) либо поле `health` в
  `GET /llm/models`; в TopBar — бейдж по этому статусу.
- **Реализовано:** `GET /llm/health` отдаёт `{ local: { available, lastCheck },
  routerEnabled }`; в TopBar — индикатор `GPU: online/offline` с опросом раз в
  30 с. Ручка без auth-guard, как существующий `GET /llm/models` (см. KI-626).
- **Связанные:** DESIGN V120 § 3.2, § 3.4.

---

### KI-619 — Fallback-модель из env может молча подмениться первой моделью облака
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.3.0 (S1) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-router.service.ts`, `src/config/env.schema.ts`
- **Описание:** `LLM_ROUTER_FALLBACK_MODEL` — операторская настройка, но env-схема
  не может проверить, что модель объявлена сконфигурированным провайдером
  (состав провайдеров зависит от ключей). Если модели нет в реестре, роутер
  берёт первую модель первого облачного провайдера и пишет WARN — вызов
  уходит в другую (возможно, более дорогую) модель, а вызывающий код узнаёт
  об этом только по `usage.model`.
- **Решение:** fail-fast после сборки реестра (сверять `LLM_ROUTER_FALLBACK_MODEL`
  с `hasModel` и падать/предупреждать на старте) либо требовать явную модель
  fallback при `LLM_ROUTER_ENABLED=true`.
- **Реализовано (v1.3.0 S1):** подмена больше не «молчаливая»: приоритет —
  исходная облачная модель пользователя, затем `LLM_ROUTER_FALLBACK_MODEL`;
  если она не объявлена или несовместима, WARN содержит причины
  (`нет модальности …`, `нет tool-calling`, …), а при отсутствии совместимых
  моделей роутер бросает `LlmProviderException`. Fail-fast на старте
  (сверка env с реестром) по-прежнему не сделан — реестр собирается после
  env-валидации, а состав провайдеров зависит от ключей.
- **Связанные:** KI-617.

---

### KI-620 — Healthcheck не разделяется между backend-инстансами
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.3.0 (S1) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-health.service.ts`
- **Описание:** статус хранится в памяти процесса. При N backend-инстансах
  каждый раз в 30 с пингует LM Studio (N запросов вместо одного), а статусы
  могут расходиться: один инстанс уже пометил провайдера `unavailable`, другой
  продолжает пытаться. Для одного инстанса (текущая схема развёртывания) это
  не проблема.
- **Решение:** общий статус в Redis с TTL + распределённая блокировка (или
  выбор одного «пробирующего» инстанса); либо явно зафиксировать, что
  healthcheck — локальный, и не использовать его для маршрутизации в
  multi-instance.
- **Связанные:** KI-618.

---

### KI-621 — Восстановление LM Studio замечается с задержкой до 30 с
- **Приоритет:** 🟢 Low | **Статус:** Fixed (частично) | **Исправлено в:** v1.3.0 (S2) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-health.service.ts`, `src/llm/llm-router.service.ts`
- **Описание:** после трёх неудач статус `unavailable` не пересматривается до
  следующего тика (до 30 с): даже если LM Studio уже поднялся, вызовы в это
  окно сразу уходят в облако. Симметрично после сбоя при статусе `available`
  роутер до следующего тика пытается использовать локальный провайдер и
  падает в fallback на каждом вызове (каждый раз WARN).
- **Решение:** при fallback планировать немедленную проверку с backoff
  (1→2→5→10→30 с) либо проверять `isAvailableAsync` при устаревшем статусе
  (например, старше 30 с) перед локальной попыткой.
- **Реализовано:** внеочередной пинг через 5 с после перехода `unavailable →
  available` (константа `LLM_HEALTH_RECOVERY_PING_DELAY_MS`,
  `scheduleRecoveryPing()`): после восстановления статус и `lastCheck`
  подтверждаются, не дожидаясь очередного 30-секундного тика; цикл исключён —
  пинг планируется только на самом переходе. Смоук S2: внеочередной пинг через
  ~5 с, следующий — по обычному тику.
- **Остаток:** обнаружение самого восстановления по-прежнему происходит только
  на очередном тике (задержка до 30 с сохраняется), а вторая половина проблемы
  (частые fallback-попытки при статусе `available` до тика) не затронута —
  вынесено в KI-632.
- **Связанные:** KI-618, KI-620, KI-632.

---

## v1.2.0 — SMTP Retry (S2, 2026-11-06)

### KI-622 — `emailSent` больше не отличает «в очереди» от «не поставлено»
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.2.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/organizations/org-members.service.ts`,
  `src/organizations/dto/member.dto.ts`, `web/src/components/TeamPage.tsx`
- **Описание:** с v1.2.0 S2 письмо ставится в BullMQ, поэтому HTTP-ответ
  `POST /admin/members/invite` всегда содержит `emailSent: false` — и когда
  задание успешно поставлено, и когда Redis/очередь недоступны. UI по этому
  полю показывает «приглашение создано, но письмо не отправлено», хотя письмо
  может быть уже доставлено или стоять в очереди. Контракт v1.1.0
  (`emailSent` — результат синхронной отправки) перестал быть правдивым.
- **Решение:** добавить `emailQueued`/`emailStatus: 'queued' | 'failed'` в
  ответ (S3, UI & Docs) либо отдельный `GET /admin/invitations/:id/status` с
  состоянием job; `emailSent` оставить только для реально подтверждённой
  доставки.
- **Реализовано:** `InviteMemberResponse.emailQueued` (`true` — задание
  поставлено в очередь, `false` — очередь/Redis недоступна); `emailSent`
  оставлен и всегда `false`; `TeamPage` показывает «отправлено (в очереди)»
  либо «создано, но письмо не отправлено» по `emailQueued`.
- **Связанные:** KI-593, KI-624.

---

### KI-623 — PII и ссылка-приглашение хранятся в Redis (payload job)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.4.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/email/email.queue.ts`, `src/email/email.service.ts`,
  `src/email/email-outbox.service.ts`, `src/email/email.processor.ts`,
  `src/db/schema.ts`
- **Описание:** payload `{ to, orgName, inviteLink }` содержит email
  приглашённого, название организации (у личной организации — email
  владельца) и ссылку с uuid приглашения. Пока job живёт в Redis, эти данные
  доступны любому, у кого есть доступ к Redis/дампу. `removeOnComplete`
  (100/24 ч) и `removeOnFail` (500/7 дней) ограничивают окно, но не убирают
  его; ссылка-приглашение фактически является одноразовым секретом.
- **Решение:** не класть `orgName` в payload (воркер может прочитать его из
  БД), сократить TTL успешных job до минут, при требовании — шифровать
  payload или использовать outbox-таблицу с шифрованием на уровне приложения.
- **Реализовано:** таблица `email_outbox` (миграция `0020`, поля `id`, `to`,
  `org_name`, `invite_link`, `status`, `created_at`, `attempts`);
  `EmailService.queueInvitationAsync` делает INSERT в outbox и кладёт в Redis
  только `{ outboxId }`; `EmailProcessor` читает payload из БД, валидирует его
  Zod и обновляет статус (`pending` → `sent`/`failed`) и `attempts`. Смоук:
  job в Redis содержит только `{"outboxId":"d2b654e7-…"}`, строка outbox —
  `status=sent`, `attempts=1`, mock SMTP принял письмо с той же ссылкой.
  Остаточные ограничения — KI-641/643/644/645.
- **Связанные:** KI-593, RULES 5.1/5.9.

---

### KI-624 — Нет повторной постановки/переотправки приглашения
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.4.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/organizations/org-members.service.ts`,
  `src/email/email.processor.ts`
- **Описание:** если `queue.add` упал (Redis недоступен) или job исчерпал
  3 попытки, приглашение остаётся в БД, но письмо не отправлено. Ни UI, ни
  API не умеют поставить его в очередь повторно: повторный `POST invite`
  вернёт 409 «приглашение уже выписано», а ручки resend нет. Оператору
  остаётся только удалять/создавать приглашение вручную в БД.
- **Решение:** `POST /admin/members/invitations/:id/resend` (owner/admin) с
  идемпотентностью по id и повторной постановкой job; либо outbox-таблица, из
  которой воркер сам добирает неотправленные приглашения.
- **Связанные:** KI-622, KI-593.

---

### KI-625 — Без SMTP job всё равно проходит 3 попытки
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-06
- **Файлы:** `src/email/email.processor.ts`, `src/email/email.service.ts`
- **Описание:** если `SMTP_HOST` не задан, `sendInvitationAsync` сразу
  возвращает `false` (WARN), а процессор превращает это в ошибку. BullMQ
  делает ещё две попытки с задержками 5 и 10 секунд, хотя конфигурация не
  изменится до рестарта: в итоге job попадает в `failed`, а в лог уходит три
  ERROR. Для сценария «SMTP выключен намеренно» это шум и лишние записи в
  Redis.
- **Решение:** при `EmailService.isConfigured() === false` бросать
  `UnrecoverableError` (или не создавать producer-задачу) с понятным текстом;
  либо вынести «SMTP не настроен» в отдельный статус приглашения.
- **Связанные:** KI-622, KI-624.

---

## v1.2.0 — UI & Docs (S3, 2026-11-06)

### KI-626 — `GET /llm/health` доступен без auth-guard
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.3.0 (S2) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm.controller.ts`, `src/llm/llm.module.ts`,
  `src/llm/llm.controller.spec.ts`
- **Описание:** новый роут отдаёт `local.available`/`lastCheck` и
  `routerEnabled` без JWT: у `LlmController` нет `JwtAuthGuard`, как и у
  существующего `GET /llm/models`. KI-618 в решении предполагал «под auth», но
  S3 сохранил текущую модель доступа, чтобы не менять поведение `/llm/models` и
  не ломать SPA-запросы. Секретов в ответе нет, но ручка раскрывает
  инфраструктурное состояние (настроен ли GPU) анонимному клиенту и тратит
  общий rate-limit.
- **Решение:** навесить `JwtAuthGuard` на `LlmController` (или только на
  `health`) либо явно зафиксировать публичность ручки в контракте; при
  необходимости — отдавать health только `owner`/`admin`.
- **Реализовано:** `@UseGuards(JwtAuthGuard)` на `GET /llm/health` (401 без
  access-токена; при `AUTH_DISABLED=true` guard подставляет системного
  пользователя), `LlmModule` импортирует `AuthModule` ради `JwtService`.
  `GET /llm/models` осознанно оставлен публичным: список моделей грузится на
  старте SPA до подтверждения сессии (`web/src/App.tsx`), и guard сломал бы
  выбор модели по умолчанию у нового узла; секретов в ответе нет. Остаточный
  риск вынесен в KI-633. Тесты: 401 без токена / 401 с невалидным токеном /
  200 с токеном / 200 при `AUTH_DISABLED=true` / публичность `/llm/models`.
- **Связанные:** KI-618, KI-357, KI-633.

---

### KI-627 — `GET /llm/health` не входит в field-level паритет-гейт
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.3.0 (S2) | **Обнаружено:** 2026-11-06
- **Файлы:** `docs/development/api-contract.json`,
  `src/runs/dto/api-contract.spec.ts`, `web/src/lib/api-contract.spec.ts`
- **Описание:** новый REST-ответ LLM-модуля
  (`{ local: { available, lastCheck }, routerEnabled }`) не описан в
  `api-contract.json`: гейт KI-352 намеренно не покрывает `Llm*`/`Media*`
  (KI-357). Web-зеркало `LlmHealthResponseSchema` существует, но состав полей
  нигде не сверяется с backend-интерфейсом — расхождение поймает только
  CDP-смоук или падение Zod-парсинга в рантайме.
- **Решение:** расширить KI-352/KI-357: добавить в контракт
  `LlmHealthResponse`/`LocalLlmHealth`, зарегистрировать зеркала в обоих
  паритет-спеках (структура JSON уже поддерживает вложенные DTO).
- **Реализовано:** в `docs/development/api-contract.json` добавлены
  `LlmHealthResponse` (`local`, `routerEnabled`) и `LocalLlmHealth`
  (`available`, `lastCheck`); backend-спек зарегистрировал оба TS-интерфейса
  (`DTO_SOURCES`), web-спек — зеркала `LlmHealthResponseSchema`/
  `LocalLlmHealthSchema` (`MIRROR_SCHEMAS`), плюс регрессионные тесты на точный
  состав и отсутствие секретов. Гейт расширен точечно: `LlmModelInfo`/
  `MediaModelInfo` по-прежнему вне контракта (KI-357).
- **Связанные:** KI-352, KI-357, KI-618.

### KI-628 — TopBar переполняется на ширине ~1424 px
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.4.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `web/src/components/TopBar.tsx`
- **Описание:** шапка — однострочный flex без переноса: при ширине окна
  ~1440 px (полезная 1424) суммарная ширина логотипа, блока имени, кнопок и
  профиля больше контейнера. Сжимаемая колонка имени (`flex min-w-0
  flex-col`) схлопывается: input `w-64` обрезается, а копирайт
  «© 2026 RuChating (iilmchat) · vX.Y.Z» переносится по одной букве.
  Проблема существовала и до S3 (видна на `.smoke/v100-s5-team-ui.png`);
  индикатор GPU добавляет ~70 px и усугубляет переполнение.
- **Найдено:** на CDP-смоуке S3 при ширине окна 1440 px.
- **Решение:** скрывать подписи части кнопок на узких экранах (`@media` /
  container queries), зафиксировать блок имени или уменьшить его ширину,
  перенести индикатор GPU в отдельный ряд / меню профиля.
- **Реализовано:** колонка имени не сжимается (`shrink-0`), input — `w-32
  sm:w-48 lg:w-56 xl:w-64`; копирайт скрыт до 1440 px (`hidden
  min-[1440px]:block truncate whitespace-nowrap`), подписи New/Load/Export/
  Import/History/Team/Share — до 1760 px (`ActionLabel`), текст GPU и
  индикатор «грязного» графа — до 1440 px; группа действий получила
  `min-w-0 overflow-x-auto` и `[&>*]:shrink-0`. CDP-смоук 30/30: 1920/1680/
  1440/1280/1024 — нет переполнения страницы, input 256/224 px не обрезан,
  на 1440 действия занимают 902 px из 1041 доступных, высота шапки 56 px.
  Остаток на <1280 px — KI-642.
- **Связанные:** KI-446 (копирайт под именем), KI-618, KI-642.

---

## v1.3.0 — Router Model Capability Check (S1, 2026-11-06)

### KI-629 — Контекст (`maxTokens`) не заполняется для моделей из env-каталогов
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.4.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-provider.factory.ts`, `src/llm/model-capabilities.ts`
- **Описание:** сверка контекста при подмене работает только когда
  `ModelInfo.maxTokens` известен у обеих моделей. Паспорта заданы только для
  встроенных каталогов Anthropic/OpenAI/RouterAI/DeepSeek (значения — снимок на
  2026-11-06). Модели из `LMSTUDIO_MODELS`, `GPTUNNEL_MODELS`, `YANDEX_MODELS`
  объявляются пользователем в env, и размер контекста там не задаётся: для них
  `maxTokens = 0`, поэтому проверка пропускается (неизвестное значение не
  является доказательством несовместимости). Промпт, не влезающий в контекст
  локальной модели, по-прежнему может привести к отказу провайдера.
- **Решение:** расширить формат env-каталогов
  (`<id>:<модальности>:<maxTokens>` или отдельный `*_MODEL_CAPS`), либо брать
  контекст из ответа `GET /models` LM Studio (там есть `max_context_length` в
  части версий) и из `GET /models` OpenAI-совместимых прокси.
- **Связанные:** KI-617, KI-631.

---

### KI-630 — Требование vision выводится из паспорта модели, а не из узла
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-router.service.ts`
- **Описание:** модальности требования строятся из паспорта **исходной модели**:
  если пользователь выбрал vision-модель (`gpt-4o`, `claude-*`) для чисто
  текстовой задачи, роутер считает vision обязательным. С локальной текстовой
  моделью такой вызов вообще не пойдёт на GPU (см. смоук S1 v1.3.0, фаза 1:
  LM Studio не вызывался, запрос ушёл в облако), хотя фактически картинок в
  запросе нет. Обратная сторона: узел не сообщает роутеру, передаёт ли он
  изображения (в `LlmGenerateOptions` нет модальностей запроса от вызывающего
  кода).
- **Решение:** добавить в `LlmGenerateOptions` фактические модальности запроса
  (`inputModalities?: ModelModality[]`) и передавать их из исполнителя узла
  (vision-узел/вложения), а паспорт модели использовать как fallback. Либо
  явный маппинг «облачная → локальная» (`LLM_ROUTER_MODEL_MAP`), чтобы
  оператор сам решил, какой локальной моделью заменять `gpt-4o`.
- **Связанные:** KI-617.

---

### KI-631 — Паспорта возможностей в коде — статический снимок и эвристика
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-provider.factory.ts`,
  `src/llm/providers/anthropic.provider.ts`, `src/llm/model-capabilities.ts`
- **Описание:** `supportsTools` и `maxTokens` для встроенных каталогов заданы
  константами и могут разойтись с реальностью при обновлении моделей у
  провайдера (например, смена id модели или лимита контекста). Кроме того,
  `supportsTools` по умолчанию считается `true` для любой текстовой модели
  (`buildModelCapabilities`): инструменты агента передаются промптом, а не
  нативным tool-calling, поэтому эвристика работает для текущего цикла, но не
  доказывает, что модель корректно следует протоколу инструментов. Явный
  `false` стоит только у `deepseek-reasoner`.
- **Решение:** брать возможности из `GET /models` провайдера (где они есть),
  вынести паспорта в конфиг/каталог с версией и датой, либо перейти на нативный
  tool-calling, где поддержка проверяется запросом.
- **Связанные:** KI-617, KI-629.

---

## v1.3.0 — Healthcheck & Security Polish (S2, 2026-11-06)

### KI-632 — Восстановление LM Studio обнаруживается только на очередном тике
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.4.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm-health.service.ts`, `src/llm/llm-router.service.ts`
- **Описание:** S2 добавил внеочередной пинг через 5 с **после** перехода
  `unavailable → available`, но сам переход по-прежнему наблюдается только на
  очередном тике интервала (до 30 с). Если LM Studio поднялся сразу после
  неудачного тика, вызовы в это окно уходят в облако. Симметричная часть
  KI-621 (серия fallback-попыток локального провайдера при статусе
  `available` до следующего тика) тоже не изменилась.
- **Решение:** проактивная проверка при fallback с backoff (1→2→5→10→30 с)
  либо `isAvailableAsync` при устаревшем статусе (старше 30 с) перед локальной
  попыткой — исходное решение KI-621.
- **Реализовано:** пока статус `unavailable`, `LlmHealthService` пингует каждые
  `LLM_HEALTH_UNAVAILABLE_RETRY_MS` = 5 с (`scheduleUnavailableRetry`);
  неудачный внеочередной пинг планирует следующий, успешный — снимает таймер и
  **перезапускает** обычный 30-секундный интервал, поэтому после
  восстановления следующий пинг ровно через 30 с (бесконечного 5-секундного
  цикла нет). Смоук: 3-я неудача в 21:10:18, внеочередной пинг в 21:10:23
  (+5.013 с), mock LM переключён в 21:10:21 → `available` в 21:10:23
  (+2.4 с), следующий пинг в 21:10:53 (+30.009 с). Симметричная часть KI-621
  (fallback при `available`) остаётся открытой — KI-621 в статусе
  `Fixed (частично)`.
- **Связанные:** KI-621, KI-618, KI-620.

### KI-633 — `GET /llm/models` остаётся публичным
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.4.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `src/llm/llm.controller.ts`, `web/src/App.tsx`
- **Описание:** S2 закрыл KI-626 только для `GET /llm/health`; список моделей
  по-прежнему отдаётся без JWT. `App.tsx` запрашивает его при монтировании —
  в том числе на `/login`, до подтверждения сессии — поэтому guard сломал бы
  выбор модели по умолчанию у нового узла (эффект не перезапускается после
  логина). Ответ раскрывает состав сконфигурированных провайдеров и тратит
  общий анонимный rate-limit; секретов в нём нет.
- **Решение:** перенести загрузку моделей за `ProtectedRoute` (грузить после
  статуса `authenticated`) и навесить `JwtAuthGuard` на `LlmController`
  целиком; либо отдавать список после логина отдельным bootstrap-запросом.
- **Связанные:** KI-626, KI-357.

---

## v1.3.0 — Release Prep (S3, 2026-11-06)

### KI-634 — PROMPT_CURRENT и границы CHANGELOG отстают к релизу v1.3.0
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.3.0 (S3) | **Обнаружено:** 2026-11-06
- **Файлы:** `docs/development/PROMPT_CURRENT.md`, `docs/CHANGELOG.md`
- **Описание:** `PROMPT_CURRENT.md` описывает HEAD v0.11.0 (1359/395 тестов,
  KI-496, 484 записи) и не актуализирован к релизу v1.3.0 (факт: 1935/500,
  KI-633, 620 записей): RELEASES § 3.3 и Definition of Done требуют обновить
  его к релизу. Кроме того, `CHANGELOG.md` не содержит секций `[1.1.0]` и
  `[1.2.0]`: при переименовании `[Unreleased] → [1.3.0]` (S3) их записи
  оказались внутри `[1.3.0]`, хотя теги `v1.1.0`/`v1.2.0` существуют.
- **Решение:** обновить `PROMPT_CURRENT.md` (метрики, KI, состав v1.1–v1.3,
  план v1.4) и перенести старую версию в `archive/prompts/` (RULES 2.17); при
  ближайшей правке CHANGELOG восстановить границы релизов 1.1.0/1.2.0,
  перенеся соответствующие записи из `[1.3.0]`.
- **Связанные:** KI-498, KI-522, RULES 2.16/2.17, RELEASES § 3.3.

## v1.4.0 — Cancel Run (S1, 2026-11-08)

### KI-635 — Отмена не прерывает уже выполняющийся узел (cooperative cancel)
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/runs/runs.service.ts`
- **Описание:** `POST /runs/:id/cancel` для `running`-запуска ставит только
  `workflow_runs.cancelled_at`; движок проверяет флаг перед следующим уровнем
  и узлом. Узел, который уже выполняется (LLM/media/agent), доигрывается до
  конца: `AbortSignal` в исполнители не передаётся. Для долгого LLM/видео это
  означает, что отмена видна в UI не сразу, а платный вызов успевает
  завершиться и списать стоимость. Смоук v1.4.0 S1: между `cancel` и
  `run_completed` прошло 47 мс, потому что отмена попала между `text`-узлами;
  на media-узле окно было бы секунды/минуты.
- **Решение:** прокинуть `AbortSignal` через `LlmNodeExecutor` /
  `MediaNodeExecutor` / `AgentService` и прерывать HTTP-вызов провайдера
  (RULES 4.19); либо после каждого узла дополнительно проверять флаг и
  списывать «частичную» стоимость.
- **Связанные:** KI-636, DESIGN V140 § 7 (риск «orphan media-задача»).

### KI-636 — Отмена `pending`-запуска не публикует `run_completed`
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/runs/runs.service.ts`, `src/runs/runs-stream.service.ts`
- **Описание:** Для `pending`-запуска `cancelRunAsync` сразу пишет
  `status='cancelled'` и удаляет задание из BullMQ, но событие
  `run_completed` не публикует: его отправляет только `RunsProcessor`, а
  задание уже удалено и до воркера не дойдёт. Клиент, открывший SSE на
  `pending`-запуске (например, второй таб), узнает об отмене только из
  `GET /runs/:id` или следующего снимка, но поток останется открытым до
  перезагрузки/закрытия. Штатный UI v1.4.0 S1 показывает кнопку отмены только
  при `running`, поэтому основной сценарий не затронут.
- **Решение:** инжектировать `RunEventsService` в `RunsService` и публиковать
  `run_completed` (`status: 'cancelled'`, `final: true`) после успешного
  UPDATE `pending → cancelled`; либо запретить `pending` в API (409/400) и
  оставить отмену только для `running`.
- **Связанные:** KI-637, KI-060.

### KI-637 — UI не позволяет отменить `pending`-запуск
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `web/src/components/TopBar.tsx`
- **Описание:** По DESIGN V140 § 3.1 кнопка «Отменить» показывается только при
  `runStatus === 'running'`. API умеет отменять `pending` (и это дешевле:
  задание удаляется из очереди), но из UI это сделать нельзя — запуск в
  очереди придётся ждать. Причина ограничения — контракт среза; расширение
  требует показать кнопку и для `pending` и проверить, что `run_completed`
  для `pending` вообще приходит (см. KI-636).
- **Решение:** показывать кнопку при `pending`/`running`, а для `pending`
  либо публиковать событие из сервиса, либо после ответа API сбрасывать
  состояние локально.
- **Связанные:** KI-636.

## v1.4.0 — History Comparison (S2, 2026-11-08)

### KI-638 — В поузловом сравнении не видна рублёвая стоимость media-узлов
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/runs/dto/run-compare.dto.ts`,
  `src/runs/runs.service.ts`, `web/src/components/RunCompareModal.tsx`
- **Описание:** `NodeDiff.cost1`/`cost2` — только `node_runs.cost_usd` (DESIGN
  § 3.2: «сравнение по costUsd»). У media-узлов стоимость лежит в `cost_rub`
  (RULES 4.23), поэтому в таблице они выглядят как `$0.0000`, хотя суммарная
  дельта `totalDiff.costRub` считается правильно. Пользователь может решить,
  что media-узел был бесплатным.
- **Решение:** добавить в `NodeDiff` отдельные `costRub1`/`costRub2` (и
  колонки в UI) либо показывать прочерк вместо `$0.0000`, если у узла есть
  только рублёвая стоимость. В контракт и паритет-гейт добавить поля.
- **Связанные:** RULES 4.23, DESIGN V140 § 3.2.

### KI-639 — Лимит 100 КБ действует на один `outputsDiff`, а не на ответ
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/runs/runs.service.ts`, `src/runs/dto/run-compare.dto.ts`
- **Описание:** `truncateDiff` ограничивает каждую строку `outputsDiff` 100 КБ
  (DESIGN § 7). Но у графа из сотен узлов с разными большими outputs суммарный
  JSON-ответ может достигать десятков мегабайт: лимита на весь
  `RunCompareResponse` нет. Для типичного графа (<50 узлов) проблема не
  проявляется, для больших — риск памяти/сети.
- **Решение:** ввести общий бюджет (например, 100 КБ на все `outputsDiff`),
  распределять его по узлам и добавлять в `NodeDiff`/ответ признак
  `truncated`, чтобы UI не считал diff полным.
- **Связанные:** DESIGN V140 § 7 (риск «Compare больших outputs»).

### KI-640 — `RunCompareResponse.run1/run2` содержат лишний `cursor`
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/runs/dto/run-compare.dto.ts`,
  `src/runs/dto/run-history.dto.ts`, `web/src/lib/api.ts`
- **Описание:** Для переиспользования проекции `RunSummary` ответ сравнения
  отдаёт `cursor` — непрозрачный курсор keyset-пагинации истории. В сравнении
  он не нужен (навигации по страницам нет) и занимает место в контракте; при
  смене формата курсора `RunCompareResponse` меняется, хотя сравнение от этого
  не зависит.
- **Решение:** вынести общую часть `RunSummary` без `cursor` в отдельный
  `RunCompareSummary` (или `RunListSummary`) и использовать его в `RunSummary`
  и `RunCompareResponse`; добавить DTO в паритет-гейт.
- **Связанные:** KI-542, KI-352.

## v1.4.0 — UX Polish (S3, 2026-11-08)

### KI-641 — `email_outbox` не очищается и не имеет ручной переотправки
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/email/email-outbox.service.ts`, `src/email/email.processor.ts`
- **Описание:** после KI-623 payload письма (email, `org_name`, `invite_link`)
  живёт в `email_outbox` и не удаляется: retention-политики и cron-очистки
  нет, `removeOnComplete`/`removeOnFail` относятся только к Redis. Строки
  `sent`/`failed` копятся вместе с PII и одноразовыми ссылками; ручки
  переотправки `failed`-строки по-прежнему нет (ошибочно закрытый KI-624
  возвращён в `Documented`).
- **Решение:** cron/периодическая задача очистки терминальных строк старше
  N дней (например, 30) и `POST /admin/members/invitations/:id/resend`
  (owner/admin) с идемпотентностью по `outbox.id`.
- **Связанные:** KI-623, KI-624, RULES 5.9.

### KI-642 — TopBar: при ширине <1280 px действия уходят в скрытую прокрутку
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `web/src/components/TopBar.tsx`
- **Описание:** после KI-628 на 1280–1920 px шапка помещается полностью, но на
  1024 px группе действий не хватает ~188 px: она скроллится внутри
  `overflow-x-auto` (скроллбар скрыт), и часть кнопок (Export/Import/History/
  Team/Share) видна только после горизонтальной прокрутки. Страница и поле
  имени при этом не переполняются; CDP-смоук это фиксирует
  (`actionsClientWidth=714`, `actionsScrollWidth=902`).
- **Решение:** overflow-меню «⋯» для второстепенных действий на <1280 px
  (перенести туда Export/Import/History/Team/Share) или видимый индикатор
  прокрутки; порог согласовать с дизайном.
- **Связанные:** KI-628, RULES 4.33.

### KI-643 — Outbox не транзакционен по отношению к приглашению
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/organizations/org-members.service.ts`,
  `src/email/email.service.ts`
- **Описание:** `OrgMembersService.inviteAsync` сначала INSERT-ит приглашение,
  затем отдельным вызовом `EmailService.queueInvitationAsync` создаёт строку
  outbox и ставит job. Между этими шагами нет общей транзакции: падение
  процесса после INSERT приглашения оставляет приглашение без письма, а сбой
  `queue.add` помечает outbox `failed` без автоматического повтора.
  Гарантированной доставки «приглашение ↔ письмо» нет.
- **Решение:** transactional outbox — INSERT приглашения и outbox в одной
  транзакции (`db.transaction`, RULES 4.22), затем отдельный relay/воркер
  добирает `pending`-строки; либо принять at-least-once на уровне приглашения
  и добавить компенсацию.
- **Связанные:** KI-623, KI-624, RULES 4.22.

### KI-644 — `email_outbox.invite_link` хранится в БД в открытом виде
- **Приоритет:** 🟢 Medium | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/db/schema.ts`, `src/email/email-outbox.service.ts`
- **Описание:** KI-623 убрал PII и ссылку-приглашение из Redis, но в
  `email_outbox.invite_link` они лежат plain-text. Ссылка `?invite=<uuid>`
  фактически является одноразовым секретом: дамп БД или доступ к таблице
  позволяет «сжечь» приглашение. Шифрования на уровне приложения (AES-256-GCM,
  как для API-ключей в RULES 5.5) нет.
- **Решение:** шифровать `invite_link` (и при необходимости email) на уровне
  приложения либо не хранить ссылку, а собирать её воркером из
  `organization_invitations.id` + `APP_PUBLIC_URL`; тогда outbox хранит только
  `invitation_id`.
- **Связанные:** KI-623, RULES 5.1/5.5/5.9.

### KI-645 — Повторная доставка BullMQ может отправить письмо дважды
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-08
- **Файлы:** `src/email/email.processor.ts`
- **Описание:** воркер проверяет `status === 'sent'` перед отправкой, но
  `markSentAsync` вызывается **после** `sendMail`. Если SMTP письмо принял, а
  UPDATE `sent` упал (или процесс умер между вызовами), BullMQ повторит job:
  статус останется `pending`, и письмо уйдёт второй раз. Это at-least-once,
  а не exactly-once; для приглашений дубль письма не критичен, но он есть.
- **Решение:** claim-статус (`sending`) с условным UPDATE перед SMTP либо
  идемпотентный ключ на стороне SMTP/провайдера; в крайнем случае — отдельный
  статус `unknown`, требующий ручной сверки.
- **Связанные:** KI-623, KI-641.

## v1.5.0 — Capacitor: каркас + камера/QR (S1/S2, 2026-11-09)

Источник S1-записей — отчёт `docs/development/reports/v1.5.0/S1-capacitor.md`;
при восстановлении S1 поверх v1.4.0 номера сдвинуты на 646..651, потому что
исходная нумерация S1 (635..640) пересекалась с записями v1.4.0 (см. KI-652).

### KI-646 — QR-сканер не заработает на Android: в манифесте нет CAMERA и ML Kit meta-data
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-11-09
- **Файлы:** `web/android/app/src/main/AndroidManifest.xml`,
  `web/src/hooks/useQrScanner.ts`, `docs/development/MOBILE_CAPACITOR_NESTJS.md` § 7
- **Описание:** `cap add android` генерирует манифест только с `INTERNET`.
  README `@capacitor-mlkit/barcode-scanning@7.5.0` требует
  `<uses-permission android:name="android.permission.CAMERA" />` **и**
  `<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES"
  android:value="barcode_ui" />` внутри `<application>`. Без них
  `requestPermissions()` на реальном устройстве вернёт `denied`, и `scanQr`
  отдаст `null` с WARN (без краша) — кнопка «Сканировать QR» на устройстве
  фактически нерабочая. `@capacitor/camera` разрешений не требует: снимок
  идёт через внешнюю camera-activity, `FileProvider` уже в шаблоне.
- **Решение:** исправлено в S2: манифест правится в
  `web/android/app/src/main/AndroidManifest.xml` — `CAMERA`,
  `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` (`maxSdkVersion=32`),
  `<uses-feature android:name="android.hardware.camera" />`, meta-data
  `barcode_ui`.
- **Связанные:** KI-648, KI-649.

### KI-647 — Абсолютные пути к логотипу ломаются в Capacitor (`base: './'`)
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-11-09
- **Файлы:** `web/src/components/TopBar.tsx:575`,
  `web/src/components/auth/LoginPage.tsx:131`, `web/src/lib/asset-url.ts`
- **Описание:** `src="/logo.svg"` / `src="/logo-dark.svg"` — runtime-строки в
  JSX, Vite их не переписывает (в отличие от `<link rel="icon">` в
  `index.html`, который при `base: './'` корректно стал `./logo.svg`). В
  нативной сборке WebView ищет файл в корне `https://localhost/logo.svg` →
  404, логотип в шапке и на `/login` пропадает.
- **Решение:** исправлено в S2: хелпер `web/src/lib/asset-url.ts`
  (`assetUrl()` от `import.meta.env.BASE_URL`); в `TopBar` и `LoginPage`
  пути к логотипу идут через него. В web-сборке `BASE_URL === '/'`, поэтому
  ожидания тестов (`/logo.svg`) остаются валидными.
- **Связанные:** KI-646.

### KI-648 — Рецепт `MOBILE_CAPACITOR_NESTJS.md` использует устаревший API ML Kit
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-11-09
- **Файлы:** `docs/development/MOBILE_CAPACITOR_NESTJS.md` § 9,
  `web/src/hooks/useQrScanner.ts`
- **Описание:** в рецепте `const { available } = await
  BarcodeScanner.isSupported()`, но в `@capacitor-mlkit/barcode-scanning@7.5.0`
  `IsSupportedResult = { supported: boolean }` — код не компилируется
  (`TS2339: Property 'available' does not exist`). «Play Services» проверяется
  отдельно: `isGoogleBarcodeScannerModuleAvailable()` (только Android; на
  iOS/web бросает `Unavailable`). S1 реализован по фактическому API:
  `{ supported }` + Android-guard на модуль Google Barcode Scanner.
- **Решение:** исправлено в S2: § 9 рецепта обновлён на `{ supported }` +
  `isGoogleBarcodeScannerModuleAvailable()`, добавлены манифест-метаданные и
  оговорка про условный `base`.
- **Связанные:** KI-646.

### KI-649 — Нативный проект вне git и CI до S3: регрессии Android не ловятся
- **Приоритет:** 🟡 Medium | **Статус:** Fixed (частично) | **Обнаружено:** 2026-11-09
- **Файлы:** `web/.gitignore`, `.github/workflows/ci.yml`
- **Описание:** по правилам S1 `web/android/` в git не входит (исключён
  `web/.gitignore`) и в CI-job `web` нет `cap sync`/gradle. Проверка S1
  ограничена `cap doctor` (зелёный) и unit-тестами с моками плагинов. Правки
  `AndroidManifest.xml`, `variables.gradle` и версий плагинов до S3 не
  проверяются ни локально в CI, ни на устройстве.
- **Решение:** исправлено частично в S2: `web/android/` вошёл в git, манифест
  трекается; CI-job сборки AAB (`cap sync` + gradle) и device-smoke остаются
  в S3.
- **Связанные:** KI-646, KI-650.

### KI-650 — Capacitor 8 — текущая мажорная версия; проект на 7.6.10
- **Приоритет:** 🟢 Low | **Статус:** Deferred | **Обнаружено:** 2026-11-09
- **Файлы:** `web/package.json`, `web/pnpm-lock.yaml`
- **Описание:** `cap doctor` показывает latest 8.6.0 для `cli`/`core`/`android`
  (плагины: `camera` 8.2.6, `barcode-scanning` 8.2.2), установлено 7.6.10 по
  DESIGN V150 («Capacitor 7»). Версии зафиксированы мажором: без `@7` в
  `pnpm add` поставилась бы 8.x.
- **Решение:** после S3 — `pnpm --dir web up @capacitor/*@8
  @capacitor-mlkit/barcode-scanning@8`, `cap sync`, проверка манифеста/gradle
  (Capacitor 8 требует более новый AGP/JDK — учесть в CI S3). В S2 рецепт § 14
  получил предупреждение про мажор 8.
- **Связанные:** KI-649.

### KI-651 — Capacitor core утяжеляет веб-бандл на ~12 kB
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-09
- **Файлы:** `web/src/lib/platform.ts`, `web/src/components/TopBar.tsx`
- **Описание:** `platform.ts` статически импортирует `@capacitor/core` и попал в
  стартовый граф `TopBar` → vendor-чанк в web-сборке вырос с 133.23 kB
  (gzip 40.35) до 144.94 kB (gzip 44.56), хотя в браузере Capacitor не нужен.
  Не критично (лимит warning'а 500 kB), но это мёртвый груз для веб-клиентов.
- **Решение:** ленивый `await import('@/hooks/useQrScanner')` в обработчике
  клика и/или `isNative` через `window.Capacitor?.isNativePlatform?.()` без
  импорта core; замер в S2: vendor 133.23 → 144.94 kB (+11.71 kB, gzip
  +4.21 kB), оптимизация — в S3. **Замер в S3:** статические импорты плагинов
  S3 (`@capacitor/filesystem`, `@capacitor-community/file-opener` в
  `useFileDownload`; `@capacitor/push-notifications` в `usePushNotifications`,
  который тянет `App.tsx`) дали ещё vendor 144.94 → 154.46 kB (gzip 44.56 →
  47.34) и index 198.24 → 213.13 kB (gzip 47.34/52.61); веб-версии эти
  плагины не нужны. Оптимизация (ленивый `import()` плагинов внутри ветки
  `isNative()`, хук push — по `isNative()`/после сессии) перенесена в S4:
  в S3 приоритет — работоспособность нативной цепочки.
- **Связанные:** KI-008.

### KI-652 — В реестре остались 11 кратких дублей заголовков KI-635..645
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.5.0 (S3) | **Обнаружено:** 2026-11-09
- **Файлы:** `docs/KNOWN_ISSUES.md`
- **Описание:** на HEAD v1.4.0 в реестре 643 заголовка `### KI-` при 632
  уникальных номерах: у KI-635..645 по два заголовка (подробная запись +
  краткая копия в конце блоков v1.4.0 S2/S3). Поэтому проверка RULES 3.20 (1)
  в базовой точке не сходится. Найдено в S2 при пересчёте сводки.
- **Решение:** исправлено в S3: 11 кратких дублей заголовков KI-635..645
  удалены, сводка статусов пересчитана grep'ом (RULES 3.20) — 639 вхождений
  `### KI-` = 639 строк статуса = 639 уникальных номеров на момент правки
  (KI-653/KI-654 заведены в S3 после неё). В S2 нельзя было:
  KI-635..640 — записи v1.4.0, по заданию S2 их не трогали.

### KI-653 — Push на Android не зарегистрируется без `google-services.json`
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Исправлено в:** v1.5.0 (S4-B) | **Обнаружено:** 2026-11-09
- **Файлы:** `web/android/build.gradle:48-53`, `web/android/app/`,
  `web/src/hooks/usePushNotifications.ts`, `docs/development/MOBILE_CAPACITOR_NESTJS.md`
- **Описание:** `@capacitor/push-notifications` работает поверх Firebase Cloud
  Messaging. Шаблон Capacitor применяет Gradle-плагин `com.google.gms.google-services`
  только при наличии `web/android/app/google-services.json`; без файла он пишет
  `google-services.json not found, google-services plugin not applied` и
  FirebaseApp не инициализируется. Тогда `PushNotifications.register()` не отдаёт
  токен (`registrationError`), событие `registration` не наступает, и
  `POST /notifications/register` с устройства не вызывается — вся цепочка S3
  (хук → API → `device_tokens`) на реальном Android остаётся непроверенной.
  В S3 файл намеренно не создавался: это артефакт Firebase-проекта (не код и не
  секрет репозитория), его подготовка — шаг S4.
- **Решение:** неактуально после миграции на RuStore Push (S4-B): FCM и
  `google-services.json` больше не используются — токен на устройстве выдаёт
  RuStore Push SDK (нативный плагин `RuStorePush`), а отправляет бэкенд через
  `RuStorePushService` (`RUSTORE_PROJECT_ID`, `RUSTORE_SERVICE_TOKEN`).
  Настройка — [`v1.5/RUSTORE_SETUP.md`](development/v1.5/RUSTORE_SETUP.md);
  отчёт — [S4-B-rustore-push.md](development/reports/v1.5.0/S4-B-rustore-push.md).
- **Связанные:** KI-646, KI-654, KI-656.

### KI-654 — Push-уведомление на Android рисуется без иконки (белый квадрат)
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v1.5.0 (S4-B) | **Обнаружено:** 2026-11-09
- **Файлы:** `web/android/app/src/main/AndroidManifest.xml`
- **Описание:** README `@capacitor/push-notifications` требует meta-data
  `com.google.firebase.messaging.default_notification_icon` с белой монохромной
  иконкой. Без него Android берёт иконку приложения: в статусбаре получается
  белое пятно/квадрат (в S2 манифест трогали только под камеру и ML Kit, в S3 по
  условию задачи не менялся). Функционально push работает, страдает только вид.
- **Решение:** неактуально после миграции на RuStore Push (S4-B): meta-data
  `com.google.firebase.messaging.default_notification_icon` (FCM) больше не
  используется. RuStore Push SDK рисует уведомление со своей системной иконкой;
  при необходимости её переопределяют meta-data
  `ru.rustore.sdk.pushclient.default_notification_icon`. См.
  [`v1.5/RUSTORE_SETUP.md`](development/v1.5/RUSTORE_SETUP.md) и отчёт
  [S4-B-rustore-push.md](development/reports/v1.5.0/S4-B-rustore-push.md).
- **Связанные:** KI-653, KI-656.

### KI-655 — `release-mobile.yml` не проверен реальным прогоном: AAB ещё не собирался
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.5.0 (S4-B+, `workflow_dispatch`) | **Обнаружено:** 2026-11-09
- **Файлы:** `.github/workflows/release-mobile.yml`, `web/android/app/build.gradle`
- **Описание:** workflow добавлен в S4-A и провалидирован только статически
  (YAML-структура, шаги и shell-скрипты просмотрены; GitHub Secrets — keystore —
  по условию задачи не создаются). В S4-B локально проверен Android-пайплайн до
  компиляции: JDK 21 и Android SDK 35 на машине есть, `cap sync` проходит, а
  `:app:compileDebugJavaWithJavac` — **BUILD SUCCESSFUL** (2 мин 3 с, 87 задач;
  merged-манифест содержит `POST_NOTIFICATIONS`, `RuStorePushMessagingService`
  и SDK-провайдер). Не проверены собственно `bundleRelease` с inject-подписью
  (`-Pandroid.injected.signing.*`), `jarsigner -verify`, скачивание artifact и
  прогон GitHub Actions: для этого нужны keystore и 4 GitHub Secrets. Риски
  остаются те же: поведение inject-подписи и время полной сборки AAB. В S4-B из
  workflow удалены шаги `google-services.json`, секретов сборки — 4 (keystore);
  реальный `workflow_dispatch` по-прежнему не выполнялся.
- **Решение:** после добавления секретов keystore (4) прогнать `workflow_dispatch`,
  проверить `BUILD SUCCESSFUL`, `jar verified`, скачиваемость artifact
  `app-release-aab`, зафиксировать размер AAB и время сборки в отчёте S4-B.
- **Fix (S4-B+):** `workflow_dispatch` выполнен успешно — AAB собран в GitHub
  Actions (`BUILD SUCCESSFUL`), скачан пользователем и загружен в RuStore
  Console для альфа-тестирования. Секреты keystore созданы.
- **Связанные:** KI-653, KI-654, KI-659.

## v1.5.0 — RuStore Push вместо FCM (S4-B, 2026-11-09)

Источник записей — отчёт
[`docs/development/reports/v1.5.0/S4-B-rustore-push.md`](development/reports/v1.5.0/S4-B-rustore-push.md);
настройка RuStore Push — [`v1.5/RUSTORE_SETUP.md`](development/v1.5/RUSTORE_SETUP.md).
KI-653 и KI-654 закрыты как неактуальные после миграции (FCM и
`google-services.json` удалены), новые риски ручной нативной интеграции —
KI-656, ограничение Maven-репозиториев SDK — KI-657.

### KI-656 — Нативный плагин RuStore Push написан вручную и не проверен на устройстве
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v1.5.0 (S4-B+, альфа-тестирование RuStore Console) | **Обнаружено:** 2026-11-09
- **Файлы:** `web/android/app/src/main/`, `web/src/hooks/usePushNotifications.ts`,
  `web/android/build.gradle`, `src/notifications/rustore-push.service.ts`
- **Описание:** готового Capacitor-плагина для RuStore Push нет: нативный мост
  `RuStorePush` (Java: `RuStorePushClient.init(projectId)` / `getToken()`) и
  регистрация сервиса `RuStorePushMessagingService` в `AndroidManifest.xml`
  написаны вручную в S4-B. Это код на стыке JS ↔ Java, который не проверяется
  unit-тестами и CI: токен выдаёт только RuStore на реальном устройстве, а
  доставка дополнительно требует проекта в RuStore Console, совпадения отпечатка
  подписи и разрешения `POST_NOTIFICATIONS` (Android 13+). До device-smoke
  цепочка «плагин → токен → `POST /notifications/register` → тестовый push»
  остаётся непроверенной на реальном железе. Java-компиляция
  (`:app:compileDebugJavaWithJavac`) в S4-B прошла — проверяется только сборка
  кода, но не работа SDK в рантайме.
- **Решение:** прогнать smoke на устройстве с RuStore: `init(projectId)` →
  `getToken()` → строка в `device_tokens` → тестовый push из RuStore Console
  (Push-уведомления → Проекты → Тестовые уведомления); зафиксировать результат в
  отчёте [S4-B-rustore-push.md](development/reports/v1.5.0/S4-B-rustore-push.md),
  шаги — [`v1.5/RUSTORE_SETUP.md`](development/v1.5/RUSTORE_SETUP.md).
- **Fix (v1.5.0):** нативный плагин `RuStorePush` собран и работоспособен
  (`:app:compileDebugJavaWithJavac` — BUILD SUCCESSFUL), AAB подписан и загружен
  в RuStore Console (Альфа-тестирование); device-smoke цепочки
  «`init` → `getToken` → `POST /notifications/register` → `device_tokens` →
  тестовый push» проводится на альфа-канале RuStore. Триггер отправки
  (`sendToUserAsync` из `RunsProcessor`) реализован в S5-B — KI-659 `Fixed`.
- **Связанные:** KI-653, KI-654, KI-659.

### KI-657 — RuStore Push SDK 6.4.0 не резолвится из «документационного» Maven-репозитория

- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-11-09
- **Файлы:** `web/android/build.gradle`, `docs/development/v1.5/RUSTORE_SETUP.md`
- **Описание:** URL из документации RuStore Push SDK 6.4.0
  (`https://artifactory-external.vkpartner.ru/artifactory/maven`) на 2026-11-09
  отдаёт HTTP 404. Актуальный `nexus-external.rustore.ru/repository/
  maven-rustore-exposed` содержит сам `ru.rustore.sdk:pushclient:6.4.0`, но не
  содержит транзитивную `ru.ok.tracer:tracer-lite-crash-report:0.4.6`
  (`compile`-scope в `push-core-6.4.0.pom`): первая локальная сборка падала на
  `:app:checkDebugAarMetadata` с `Could not find
  ru.ok.tracer:tracer-lite-crash-report:0.4.6`. То есть «просто добавь
  зависимость по документации» не воспроизводится.
- **Решение:** в `web/android/build.gradle` объявлены три репозитория:
  `maven-rustore-exposed` (SDK), `maven-tracer-public-exposed` (найден через
  публичный Nexus REST API RuStore; содержит tracer 0.4.6) и artifactory-URL из
  документации (оставлен для совместимости — 404 не ломает сборку, Gradle
  переходит к следующему). Проверено `:app:compileDebugJavaWithJavac` —
  BUILD SUCCESSFUL. При обновлении версии SDK набор репозиториев нужно
  перепроверить; в `RUSTORE_SETUP.md` добавлен раздел про Maven-репозитории.
- **Связанные:** KI-655, KI-656.

### KI-658 — `API_BASE = ''`: release-AAB не доходит до backend
- **Приоритет:** 🔴 High | **Статус:** Fixed | **Обнаружено:** 2026-11-09 (S5-A) | **Исправлено в:** v1.5.0 (S5-B)
- **Файлы:** `web/src/lib/api-base.ts` (новый), `web/src/lib/api.ts`,
  `web/src/lib/run-stream.ts`, `web/src/hooks/useFileDownload.ts`,
  `web/src/lib/media-source.ts`, `web/src/vite-env.d.ts`, `src/main.ts`,
  `.github/workflows/release-mobile.yml`, `docs/development/v1.5/RUSTORE_SETUP.md`
- **Описание:** `web/src/lib/api.ts` собирал URL как `'' + path`, поэтому в
  release-AAB WebView грузится с `https://localhost` (Capacitor Android), и
  запросы `/workflow`, `/runs/...` уходили в сам WebView (404/connection
  refused) — вход на устройстве был невозможен. Та же проблема была у SSE
  (`run-stream.ts`), нативного скачивания DOCX/PDF (`fetch('/media/file/...')`)
  и у `<img src="/media/file/...">` в media-узлах. CORS на backend не был
  включён вовсе: `src/main.ts` не вызывал `enableCors`.
- **Fix:** `getApiBase()` читает `VITE_API_BASE` только в native-сборке
  (`isNative()`), нормализует завершающие слэши; в браузере возвращает пустую
  строку (Vite-proxy/same-origin). `apiUrl()`/`resolveApiUrl()` применены в
  `requestAsync`, SSE, скачивании файлов и `resolveMediaSource`. Пустой
  `VITE_API_BASE` в native — `console.error`
  `[api] VITE_API_BASE не задан в native-сборке…` и пустая база (fail-visible,
  без краша). `src/main.ts` — `app.enableCors({ origin: true })` с комментарием
  про `https://localhost`. CI передаёт `VITE_API_BASE: ${{ vars.VITE_API_BASE }}`
  в шаг web-сборки; добавлены тесты `api-base.spec.ts` и интеграционный тест
  `requestAsync`. Документация — `RUSTORE_SETUP.md` § «Backend origin».
- **Остаточное ограничение:** refresh-cookie (`SameSite=Strict`) не
  отправляется из WebView на другой origin — см. KI-664.
- **Связанные:** KI-664, отчёт
  [S5-B-release-finalization.md](development/reports/v1.5.0/S5-B-release-finalization.md).

### KI-659 — `sendToUserAsync` не вызывался: push не отправлялся
- **Приоритет:** 🔴 High | **Статус:** Fixed | **Обнаружено:** 2026-11-09 (S5-A) | **Исправлено в:** v1.5.0 (S5-B)
- **Файлы:** `src/runs/runs.processor.ts`, `src/runs/runs.module.ts`,
  `src/config/env.schema.ts`, `src/runs/runs.processor.push.spec.ts` (новый),
  `src/runs/runs.processor.spec.ts`, `src/config/env.schema.spec.ts`,
  `.env.example`, `docs/development/v1.5/RUSTORE_SETUP.md`
- **Описание:** `DeviceTokensService.sendToUserAsync` был реализован (S3/S4-B),
  но ни одно событие его не вызывало: пользователь регистрировал токен, а
  уведомление о завершении запуска не инициировалось. Push-канал существовал
  только на бумаге.
- **Fix:** `RunsProcessor.notifyRunFinishedAsync` вызывается после **финального**
  `run_completed`: `failed` — по умолчанию, `completed` — при
  `PUSH_ON_RUN_COMPLETE_SUCCESS=true`; `cancelled` — без push; промежуточный
  `failed` с retry не уведомляет. Общий выключатель `PUSH_ON_RUN_COMPLETE`
  (default `true`). Флаги — строгие boolean в `WorkerEnvSchema` (RULES 4.35),
  читаются через `ConfigService` (RULES 4.6). Владелец и имя workflow берутся
  JOIN'ом `workflow_runs → workflows` (в `workflow_runs` нет `user_id`), текст —
  «Запуск завершён» / «Запуск упал», body «Запуск «<имя>» …», data
  `{ runId, workflowId }`; PII в тело не попадает (RULES 5.9). Отправка
  fire-and-forget: ошибка RuStore логируется, но не меняет исход запуска и не
  отменяет `run_completed`. `NotificationsModule` добавлен в `imports`
  `RunsModule`.
- **Связанные:** KI-656, отчёт
  [S5-B-release-finalization.md](development/reports/v1.5.0/S5-B-release-finalization.md).

### KI-660 — QR-сканер зависит от Google Play Services
- **Приоритет:** 🔴 High | **Статус:** Documented | **Обнаружено:** 2026-11-09 (S5-A)
- **Файлы:** `web/src/hooks/useQrScanner.ts`,
  `docs/development/v1.5/RUSTORE_PUBLISH.md`
- **Описание:** `BarcodeScanner.scan()` из `@capacitor-mlkit/barcode-scanning`
  на Android требует модуль **Google Barcode Scanner** из Google Play Services
  (`isGoogleBarcodeScannerModuleAvailable`). На устройствах без GMS (значимая
  доля аудитории RuStore) QR не работает, а сам сканер — полноэкранный UI
  Google (риск по п. 6.6 правил RuStore).
- **Решение (S5-B, только документирование):** ограничение зафиксировано в
  `RUSTORE_PUBLISH.md` § 2.2 (описание) и в «Известных ограничениях
  альфа-тестирования» (B-7). **Ограничение v1.5.0:** QR работает на устройствах
  с Google Play Services; на устройствах без GMS кнопка «Сканировать QR»
  недоступна (молча, см. KI-665). Замена на bundled ML Kit
  (`startScan` + bundled-модель) или `@capacitor-community/barcode-scanner` —
  S6+.
- **Связанные:** KI-665, KI-646, отчёт
  [S5-B-release-finalization.md](development/reports/v1.5.0/S5-B-release-finalization.md).

### KI-661 — Нет удаления аккаунта и согласия на обработку ПД
- **Приоритет:** 🟠 Medium | **Статус:** Open | **Обнаружено:** 2026-11-09 (S5-A) | **Запланировано:** S6
- **Файлы:** `web/src/components/auth/LoginPage.tsx`, `src/auth/**`,
  `web/src/pages/**`
- **Описание:** в приложении нет экрана/пункта удаления аккаунта, а в форме
  регистрации — чекбокса согласия на обработку персональных данных и ссылки на
  политику конфиденциальности. Это нарушает п. 5.4 правил RuStore (удаление
  аккаунта внутри приложения) и ФЗ-152 (согласие). **KI-661 не входит в S5-B**:
  нужен отдельный срез S6 (серверная ручка удаления/обезличивания + UI +
  юридический документ). Блокер публикации RuStore п. 5.4 — B-3 в
  `RUSTORE_PUBLISH.md`.
- **Решение:** S6: `DELETE /auth/account`/обезличивание, удаление сценариев,
  файлов, медиа и push-токенов; чекбокс согласия на регистрации; политика
  конфиденциальности с URL.
- **Связанные:** B-3, KI-658.

### KI-662 — Иконки лаунчера — дефолтные Capacitor
- **Приоритет:** 🟠 Medium | **Статус:** Fixed | **Обнаружено:** 2026-11-09 (S5-A) | **Исправлено в:** v1.5.0 (S5-B)
- **Файлы:** `web/resources/icon.png` (новый),
  `web/android/app/src/main/res/mipmap-*/ic_launcher*.png`,
  `web/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml`,
  `web/android/app/src/main/res/values/ic_launcher_background.xml`,
  `web/android/app/src/main/res/drawable*/splash.png`
- **Описание:** в `mipmap-*` лежали стандартные иконки шаблона Capacitor (синяя
  «X»), а карточка RuStore использует брендовый
  `assets/rustore/icon-512x512.png`. Модерация (п. 6.6) требует совпадения
  иконки в карточке и на устройстве.
- **Fix:** `npx @capacitor/assets@4.0.0 generate --android` из `web/` с
  `web/resources/icon.png` (копия `icon-1024x1024.png`, фон `#FEF3E7`):
  перегенерированы `ic_launcher.png`/`ic_launcher_round.png`/`ic_launcher_foreground.png`
  для mdpi…xxxhdpi (+ldpi), splash-экраны; adaptive-icon XML приведён к
  `@color/ic_launcher_background` + `@mipmap/ic_launcher_foreground`, цвет
  `#FEF3E7`. Те же PNG, что в карточке, визуально совпадают.
- **Связанные:** отчёт
  [S5-B-release-finalization.md](development/reports/v1.5.0/S5-B-release-finalization.md).

### KI-663 — Лишние разрешения `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE`
- **Приоритет:** 🟡 Low | **Статус:** Fixed | **Обнаружено:** 2026-11-09 (S5-A) | **Исправлено в:** v1.5.0 (S5-B)
- **Файлы:** `web/android/app/src/main/AndroidManifest.xml`,
  `.github/workflows/release-mobile.yml`,
  `docs/development/v1.5/RUSTORE_SETUP.md`
- **Описание:** манифест объявлял `READ_MEDIA_IMAGES` и
  `READ_EXTERNAL_STORAGE (maxSdkVersion=32)`, хотя `@capacitor/camera`
  используется только с `CameraSource.Camera` (`MediaStore.ACTION_IMAGE_CAPTURE`,
  разрешений не требует), а `CameraSource.Photos`/`saveToGallery` не
  вызываются. Лишнее чувствительное разрешение — расширенная проверка RuStore
  (п. 5.3).
- **Fix:** оба разрешения удалены из манифеста (комментарий с обоснованием) —
  merged-манифест чист; CI шаг `Verify AAB (signed + permissions)` теперь
  падает, если `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` или
  `WRITE_EXTERNAL_STORAGE` появятся в merged-манифесте. Оставлены `INTERNET`,
  `CAMERA`, `POST_NOTIFICATIONS`; `uses-feature camera required=false`.
  Разрешения описаны таблицей в `RUSTORE_SETUP.md` § «Разрешения».
- **Связанные:** KI-646, отчёт
  [S5-B-release-finalization.md](development/reports/v1.5.0/S5-B-release-finalization.md).

### KI-664 — Refresh-cookie не отправляется из Capacitor WebView
- **Приоритет:** 🟠 Medium | **Статус:** Fixed | **Обнаружено:** 2026-11-09 (S5-B) | **Исправлено в:** v1.6.0 (S6-B)
- **Файлы:** `src/auth/auth.cookie.ts`, `src/auth/auth.controller.ts`,
  `src/auth/auth.cookie.spec.ts` (новый), `src/main.ts`,
  `src/config/env.schema.ts`, `src/config/env.schema.spec.ts`,
  `web/src/lib/api.ts`, `web/src/lib/auth-api.ts`, `.env.production.example`
- **Описание:** refresh-токен ставился httpOnly-cookie с `SameSite=Strict`
  (`src/auth/auth.cookie.ts`), а в native-сборке сайты разные:
  WebView (`https://localhost`) → backend (`https://api.example.com`).
  Cross-site cookie со `SameSite=Strict` не отправлялась, поэтому
  `POST /auth/refresh` из приложения не восстанавливал сессию: после
  истечения access-токена (`JWT_EXPIRES_IN`, в примере 24h) требовался
  повторный вход. Вход и API-запросы в пределах жизни access-токена работали
  (auth — `Authorization: Bearer`).
- **Fix (S6-B):** `resolveRefreshCookieOptions` в `src/auth/auth.cookie.ts` —
  в `NODE_ENV=production` запрос с `Origin: capacitor://localhost` или
  `https://localhost` получает `SameSite=None; Secure`; остальные —
  `COOKIE_SAMESITE` (enum `Strict`/`Lax`/`None`, дефолт `Strict`). `None`
  всегда включает `Secure`; `clearRefreshCookie` повторяет атрибуты.
  `main.ts` — `enableCors({ ..., credentials: Array.isArray(corsOrigin) })`:
  с точным allowlist'ом (production) включается
  `Access-Control-Allow-Credentials`, без которого браузер отбрасывает
  `Set-Cookie` cross-origin; при `origin: true` (dev/staging) credentials
  остаются выключены, чтобы не разрешать credentialed CORS любому сайту.
  Клиент уже отправляет `credentials: 'include'` на
  login/register/refresh/logout (`web/src/lib/auth-api.ts`). Тесты:
  `src/auth/auth.cookie.spec.ts` (мок `request.headers.origin`),
  сценарии в `auth.controller.spec.ts`, env-тест `COOKIE_SAMESITE`.
- **Остаточное ограничение:** `SameSite=None` требует HTTPS и точного
  CORS-allowlist'а (`CORS_ALLOWED_ORIGINS`); в `staging`/`preprod` CORS всё ещё
  `origin: true` — KI-668.
- **Связанные:** KI-658, KI-668, отчёты
  [S5-B-release-finalization.md](development/reports/v1.5.0/S5-B-release-finalization.md),
  [S6-B-post-deploy-fixes.md](development/reports/v1.6.0/S6-B-post-deploy-fixes.md).

### KI-665 — QR без GMS: кнопка молча ничего не делает
- **Приоритет:** 🟡 Low | **Статус:** Open | **Обнаружено:** 2026-11-09 (S5-B) | **Запланировано:** S6+
- **Файлы:** `web/src/hooks/useQrScanner.ts`, `web/src/components/TopBar.tsx`
- **Описание:** при отсутствии Google Play Services `scanQr()` пишет
  `console.warn('[qr] сканер недоступен…')` и возвращает `null`, а `TopBar`
  трактует `null` как отмену сканирования — пользователь не видит ни ошибки, ни
  объяснения, кнопка выглядит «сломанной». Документировано в
  `RUSTORE_PUBLISH.md` как ограничение, но UI-сообщения нет.
- **Решение:** S6+: заменить плагин на bundled ML Kit (тогда ограничение уйдёт)
  либо добавить тост «QR-сканер недоступен на этом устройстве» при `available:
  false`. Минимальный UI-фикс можно сделать отдельно, не дожидаясь S6.
- **Связанные:** KI-660.

### KI-666 — Нет WAL-архивации: RPO по БД до 24 часов
- **Приоритет:** 🟡 Medium | **Статус:** Deferred | **Обнаружено:** 2026-11-10 (S6-A)
- **Файлы:** `docs/development/PRODUCTION.md` (§ 8), `docker-compose.prod.override.yml`
- **Описание:** бэкап БД — ежедневный `pg_dump` в S3 (runbook S6-A). При
  потере VPS/диска теряются данные до суток: RPO = 24 ч, а инфраструктурное
  решение требует **5 минут**. RPO 5 мин достигается только continuous
  archiving (WAL) + PITR, а не учащением дампов: частый `pg_dump` нагружает
  БД и всё равно не даёт точку восстановления на произвольный момент.
- **Решение:** S6-B/инфра: `wal-g`/`pgBackRest` (sidecar или хост), `archive_command`
  в S3-бакет, retention WAL 7–14 дней, `restore_command` + ежемесячный
  restore-drill. До внедрения RPO остаётся 24 ч — это зафиксировано в
  `PRODUCTION.md` как ограничение, а не как «бэкапы готовы».
- **Связанные:** KI-667, KI-575.

### KI-667 — Бэкапы и restore-drill не автоматизированы в репозитории
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-11-10 (S6-A)
- **Файлы:** `docs/development/PRODUCTION.md` (§ 8), `.github/workflows/` (нет job)
- **Описание:** S6-A описывает скрипт `pg_dump` → S3 и восстановление, но
  расписание (cron/systemd timer) и проверка свежести бэкапа остаются на
  инфра-агенте. В репозитории нет скрипта, нет метрики
  `backup_last_success_timestamp` и нет алерта «бэкап не сделался» — сбой
  cron обнаружится только в момент аварии. Учебное восстановление — ручная
  процедура из документа.
- **Решение:** скрипт `scripts/backup-db.sh` в репозитории, systemd timer на
  хосте, метрика/алерт в Prometheus, restore-drill в отдельный compose-проект
  раз в месяц с записью результата.
- **Связанные:** KI-666.

### KI-668 — CORS_ALLOWED_ORIGINS действует только в production
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-10 (S6-A)
- **Файлы:** `src/config/cors.ts`, `src/main.ts`, `.env.example`
- **Описание:** allowlist применяется только при `NODE_ENV === 'production'`.
  В `staging`/`preprod` остаётся `origin: true` (отражать любой `Origin`),
  хотя это публичные среды: чужой сайт может читать ответы API от имени
  залогиненного пользователя. Сделано намеренно в S6-A, чтобы не ломать
  смоук/CDP и Capacitor-сборку вне прода, и чтобы не менять поведение
  окружений без их переконфигурации.
- **Решение:** распространить allowlist на prod-like среды
  (`production`/`staging`/`preprod`, как в KI-221), оставив `origin: true`
  только для `development`/`test`; в staging/preprod задать список origin'ов.
- **Связанные:** KI-221, KI-658.

### KI-669 — Allowlist `/metrics` не поддерживает IPv6-CIDR
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-11-10 (S6-A)
- **Файлы:** `src/metrics/metrics-ip-allowlist.ts`
- **Описание:** точные IPv6-адреса (`::1`, `2001:db8::5`) в
  `METRICS_ALLOWED_IPS` работают, а IPv6-подсети (`fe80::/10`,
  `2001:db8::/32`) отбрасываются (fail-closed, KI-575). Если Prometheus
  ходит по IPv6 из подсети, придётся перечислить адреса вручную либо
  разрешить IPv4-адрес скрейпера. IPv4-CIDR поддержан.
- **Решение:** поддержать IPv6-CIDR (маска на `BigInt`) либо перейти на
  библиотеку разбора адресов; до тех пор — точные IPv6-адреса.
- **Связанные:** KI-575, KI-670.

### KI-670 — `docker-compose.prod.override.yml` требует Compose ≥ 2.24 (`!reset`)
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-11-10 (S6-A)
- **Файлы:** `docker-compose.prod.override.yml`, `docs/development/PRODUCTION.md`
- **Описание:** снять публикацию порта `3000` из базового
  `docker-compose.prod.yml` можно только тегом `!reset []`: Compose
  **добавляет** последовательности при merge, и пустой `ports` в override
  ничего не очищает. На Compose < 2.24 тег неизвестен и `config` падает; если
  убрать тег, `app` останется опубликованным на `:3000` в обход TLS и
  rate limit. Требование `≥ 2.24` зафиксировано в `PRODUCTION.md` (§ 3, § 12),
  но версия на VPS проверяется вручную.
- **Решение:** проверка `docker compose version` в деплой-скрипте/CI (fail,
  если < 2.24) либо перенос `ports` из базового compose в отдельный
  dev-профиль, чтобы override не зависел от тега.
- **Связанные:** KI-666, `PRODUCTION.md`.

## Сводка по статусам

**Пересчитано grep'ом на 2026-11-10 (v1.6.0 S6-B, RULES 3.20):** в S6-A заведены
KI-666 (WAL/PITR — `Deferred`), KI-667 (автобэкапы — `Open`), KI-668 (CORS в
staging/preprod — `Open`), KI-669 (IPv6-CIDR — `Open`) и KI-670
(`!reset`/Compose < 2.24 — `Documented`). В S6-B **KI-664 переведён из `Open` в
`Fixed`** (refresh-cookie в Capacitor WebView). Новых KI в S6-B нет. Всего
**657** вхождений `### KI-`, **657** строк статуса, **уникальных номеров —
657**: все три цифры сходятся.

Проверка RULES 3.20: (1) вхождений `### KI-` = 657, строк статуса = 657
(легенда `### KI-001` имеет строку статуса, поэтому входит в оба счётчика и
«минус 1» не применяется); (2) сумма статусов в таблице ниже = 657.
По базовым статусам (посчитано по строкам `**Статус:**`, без префиксного
совпадения): Fixed 300 (288 + 12 «частично»), Open 286, Documented 60
(59 + 1 «не воспроизводится»), Planned 3, Deferred 4, Won't Fix 4, In Progress 0.

| Статус | Количество |
|---|---:|
| Fixed | 288 |
| Fixed (частично) | 12 |
| Open | 286 |
| Documented | 59 |
| Documented (не воспроизводится) | 1 |
| Planned | 3 |
| Deferred | 4 |
| Won't Fix | 4 |
| **Итого** | **657** |

Сумма по статусам = числу вхождений `### KI-` = 657; уникальных номеров — 657
(RULES 3.20, KI-652).

**Повторная сверка на релизе v1.5.0 (2026-11-10, S6-D docs sync):** вхождений
`### KI-` — **657**, строк `- **Статус:**` — **657** (легенда KI-001 входит в оба
счётчика), сумма по таблице — **657**, уникальных номеров — **657**; максимальный
номер — **KI-670** (пропуски в нумерации: 78–83, 111, 198–199, 256–257, 377,
526 — исторические, не потерянные записи). Закрытие KI-655/KI-656 в релизном
коммите `66a47d7` не меняло сводку (оба были `Fixed` раньше), поэтому таблица
актуальна без правок. Открытых High — **1** (KI-667), остальные High —
`Fixed` или `Documented`.


