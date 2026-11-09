# Changelog

Все значимые изменения проекта **IIChatTools AI Workflow Builder** документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Проект придерживается [Semantic Versioning](https://semver.org/lang/ru/).

Типы изменений:
- **Added** — новая функциональность
- **Changed** — изменения в существующей функциональности
- **Deprecated** — функции, помеченные как устаревшие
- **Removed** — удалённая функциональность
- **Fixed** — исправления
- **Security** — исправления уязвимостей и утечек
- **Documented** — задокументированные баги

---
## [Unreleased]

### Added

- **RuStore Push вместо FCM (v1.5.0 S4-B)**
  ([отчёт](development/reports/v1.5.0/S4-B-rustore-push.md)): доставка
  push-уведомлений переведена с Firebase Cloud Messaging на RuStore Push.
  **Backend:** `src/notifications/rustore-push.service.ts` — `RuStorePushService`
  (`sendAsync(token, title, body, data?)`, `isConfigured()`), отправка
  `POST https://vkpns.rustore.ru/v1/projects/<projectId>/messages:send` с
  `Authorization: Bearer <serviceToken>`; `DeviceTokensService.sendToUserAsync`
  — fan-out по всем android-токенам пользователя (`Promise.allSettled`).
  Env: `RUSTORE_PROJECT_ID` (не секрет) и `RUSTORE_SERVICE_TOKEN` (секрет);
  обе опциональны — без них приложение поднимается, а отправка пишет WARN и
  возвращает 0 доставленных. **Android:** RuStore Push SDK 6.4.0
  (`ru.rustore.sdk:pushclient`; Maven-репозитории RuStore
  `nexus-external.rustore.ru/.../maven-rustore-exposed` и
  `.../maven-tracer-public-exposed` для транзитивного `ru.ok.tracer`;
  URL из документации `artifactory-external.vkpartner.ru/artifactory/maven`
  на 2026-11-09 отдаёт 404 — оставлен для совместимости, KI-657) и нативный
  Capacitor-плагин `RuStorePush` (`init(projectId)` / `getToken()`); `web`-сборка
  получает Project ID через `VITE_RUSTORE_PROJECT_ID` (GitHub Actions repository
  **variable**, не секрет). Java-плагин и сервис скомпилированы локально:
  `:app:compileDebugJavaWithJavac` — BUILD SUCCESSFUL (2 мин 3 с), merged-манифест
  содержит `POST_NOTIFICATIONS`, `RuStorePushMessagingService` и SDK-провайдер.
  Инструкция —
  [`RUSTORE_SETUP.md`](development/v1.5/RUSTORE_SETUP.md).

### Changed

- **Регистрация push-токена (v1.5.0 S4-B):** `usePushNotifications` работает
  через нативный плагин `RuStorePush`, а не через `@capacitor/push-notifications`;
  контракт `POST /notifications/register` (`{ token, platform }`, upsert в
  `device_tokens`) не изменился.
- **CI mobile (v1.5.0 S4-B):** `.github/workflows/release-mobile.yml` больше не
  восстанавливает `google-services.json`; `Cleanup secrets` удаляет только
  keystore; web-сборка получает `VITE_RUSTORE_PROJECT_ID` из
  `vars.RUSTORE_PROJECT_ID`; секретов сборки — 4 (keystore), переменная
  Project ID — отдельно.
- **Docs (v1.5.0 S4-B):** `v1.5/FIREBASE_SETUP.md` заменён на
  `v1.5/RUSTORE_SETUP.md`; обновлены `KEYSTORE_SETUP.md` (4 секрета +
  `VITE_RUSTORE_PROJECT_ID` как variable), `MOBILE_CAPACITOR_NESTJS.md` (§ 11
  push, § 18 CI/CD), DESIGN v1.5 (статус и риски S4-B), `USER_GUIDE.md` и
  `MANUAL_TESTING_GUIDE.md` (push/ограничения/`MOBILE-09`), `docs/README.md`.

### Removed

- **FCM/Firebase (v1.5.0 S4-B):** `@capacitor/push-notifications` вместе с
  `google-services.json`-цепочкой, Gradle-плагин `com.google.gms:google-services`,
  файл `web/android/app/google-services.json` из сборочного сценария, GitHub
  Secret `GOOGLE_SERVICES_JSON`, документ
  `docs/development/v1.5/FIREBASE_SETUP.md` (заменён на `RUSTORE_SETUP.md`).

### Fixed

- **KI-653 (Fixed):** push на Android больше не зависит от
  `google-services.json` — неактуально после миграции на RuStore Push (S4-B).
- **KI-654 (Fixed):** FCM-meta-data иконки уведомления больше не используется —
  неактуально после миграции на RuStore Push (S4-B).

### Documented

- **KI-656 (Medium, Planned):** нативный плагин RuStore Push написан вручную
  (JS ↔ Java) и требует тестирования на устройстве с RuStore — отчёт
  [S4-B-rustore-push.md](development/reports/v1.5.0/S4-B-rustore-push.md),
  инструкция [`RUSTORE_SETUP.md`](development/v1.5/RUSTORE_SETUP.md).
- **KI-657 (Medium, Documented):** RuStore Push SDK 6.4.0 не резолвится из
  Maven-URL, указанного в документации (`artifactory-external.vkpartner.ru` —
  404), а транзитивный `ru.ok.tracer:tracer-lite-crash-report:0.4.6` отсутствует
  в `maven-rustore-exposed`; в `web/android/build.gradle` добавлен рабочий
  репозиторий `maven-tracer-public-exposed`, сборка проверена.
- **RuStore Push: настройка и ограничения (v1.5.0 S4-B):** Project ID и Service
  Token выдаются в RuStore Console (Push-уведомления → Проекты); push доходит
  только на устройство с RuStore, если приложение добавлено в RuStore Console и
  отпечаток подписи установленной сборки совпадает с консолью; на Android 13+
  нужно разрешение `POST_NOTIFICATIONS`; тестовая отправка — из консоли
  (Тестовые уведомления).

## [1.5.0] — 2026-11-09

**Minor-релиз: Android Mobile App (Capacitor).**

### Added

- **CI/CD и release-prep (v1.5.0 S4-A)**
  ([отчёт](development/reports/v1.5.0/S4-release-prep.md)): workflow
  `.github/workflows/release-mobile.yml` — сборка подписанного AAB по тегу
  `v*` и вручную (`workflow_dispatch`): `CAPACITOR=1 pnpm --dir web build` →
  `cap sync android` → Java 21 + Android SDK 35 → `bundleRelease` с
  inject-подписью из Secrets; проверка `jarsigner -verify` и разрешений
  merged-манифеста; AAB — в артефактах 30 дней; `Cleanup secrets` в
  `if: always()`. Секреты защищены `web/android/.gitignore`
  (`google-services.json`, `release.keystore`). Инструкции пользователю:
  `docs/development/v1.5/FIREBASE_SETUP.md` (Firebase/FCM, KI-653) и
  `KEYSTORE_SETUP.md` (keystore, подпись, Play Console); рецепт
  `MOBILE_CAPACITOR_NESTJS.md` § 18. Версии `1.5.0`, обновлены
  `CHANGELOG`/`README`/`docs/README`/`PROMPT_CURRENT`/гайды.
- **Files & Push: уведомления, скачивание DOCX (v1.5.0 S3)**
  ([отчёт](development/reports/v1.5.0/S3-files-push.md)): `POST
  /notifications/register` (JWT; идемпотентный UPSERT `device_tokens`,
  организация — из БД по `users`) и миграция `0021_dizzy_reptil.sql` —
  таблица `device_tokens` (`token` UNIQUE, `platform` android/ios/web, FK на
  `users`/`organizations`); нативное скачивание/открытие DOCX
  (`web/src/hooks/useFileDownload.ts`); push-инициализация
  (`web/src/hooks/usePushNotifications.ts`).
- **Capacitor: каркас + камера/QR (v1.5.0 S1)** ([отчёт](development/reports/v1.5.0/S1-capacitor.md)):
  `@capacitor/core`, `@capacitor/android`, `@capacitor/camera`, `@capacitor-mlkit/barcode-scanning`,
  `@capacitor/cli` (в `web/package.json`). `web/capacitor.config.ts`, `web/android/` (без build/).
  `web/vite.config.ts`: условный `base` (`CAPACITOR=1` → `./`, иначе `/`).
  `web/src/lib/platform.ts` (`isNative`/`isAndroid`/`isIOS`/`isWeb`),
  `web/src/lib/qr-payload.ts` (uuid/share-URL → путь),
  `web/src/hooks/useCamera.ts`, `web/src/hooks/useQrScanner.ts`.
  В `TopBar`: кнопка QR (`data-topbar-scan-qr`, только native).
- **Отмена запуска (v1.4.0 S1, DESIGN V140 § 3.1)**
  ([отчёт](development/reports/v1.4.0/S1-cancel.md)): миграция
  `0019_plain_kang.sql` — `workflow_runs.cancelled_at`; `POST
  /runs/:id/cancel` (JWT, владелец/`editor`); `RunsService.cancelRunAsync`
  (pending → `cancelled` + удаление job, running → только `cancelled_at`,
  терминальные → 409, чужие → 404); `RunCancelledException` и проверки
  `cancelled_at` перед каждым уровнем/узлом в `ExecutionEngineService`;
  `RunsProcessor` закрывает отменённый запуск `cancelled` без retry;
  кнопка «Отменить» в `TopBar` (`running`), SSE `run_completed` со статусом
  `cancelled`. Новые ограничения — KI-635..637.
- **Сравнение запусков (v1.4.0 S2, DESIGN V140 § 3.2)**
  ([отчёт](development/reports/v1.4.0/S2-compare.md)): `GET
  /runs/:id1/compare/:id2` (JWT, владелец/`editor` для обоих запусков);
  `RunsService.compareRunsAsync` — объединение `node_runs` по `nodeId`,
  статусы/длительности/стоимости, diff outputs `{ changed, onlyRun1,
  onlyRun2 }` с лимитом 100 КБ, суммарные дельты `durationMs`/`costUsd`/
  `costRub`; контракт `RunCompareResponse`/`NodeDiff`/
  `RunCompareTotalDiff` в `api-contract.json`; `RunCompareModal` (side-by-side
  таблица, подсветка красный/зелёный), чекбоксы выбора двух запусков и
  кнопка «Сравнить» в `RunHistoryModal`. Новые ограничения — KI-638..640.
- **UX Polish (v1.4.0 S3, DESIGN V140 § 3.3)**
  ([отчёт](development/reports/v1.4.0/S3-ux-polish.md)): адаптивный TopBar
  (копирайт — до 1440 px, подписи New/Load/Export/Import/History/Team/Share —
  до 1760 px, колонка имени `shrink-0`, прокручиваемая группа действий);
  внеочередной healthcheck LM Studio каждые 5 с при `unavailable` с возвратом
  к обычным 30 с после восстановления; таблица `email_outbox` (миграция
  `0020`) — payload письма-приглашения в БД, в Redis только `outboxId`,
  воркер читает payload из БД и обновляет `status`/`attempts`.

### Changed

- **Payload email-очереди (v1.4.0 S3, KI-623):** вместо
  `{ to, orgName, inviteLink }` в Redis уходит `{ outboxId }`;
  `EmailProcessor` читает email/организацию/ссылку из `email_outbox`.
- **`LLM_HEALTH_RECOVERY_PING_DELAY_MS` → `LLM_HEALTH_UNAVAILABLE_RETRY_MS`**
  (5 с): пинг теперь выполняется **пока** провайдер `unavailable`, а не после
  перехода в `available`; после успеха обычный интервал перезапускается.
- **Реестр `api-prefixes.json` (v1.5.0 S3):** добавлен префикс `notifications`
  (`POST /notifications/register`); SPA-fallback backend'а и Vite-proxy видят
  ручку без правок `app.module.ts` (KI-472).

### Fixed

- **KI-652:** удалены 11 кратких дублей заголовков KI-635..645 в
  `docs/KNOWN_ISSUES.md`; сводка статусов пересчитана grep'ом (RULES 3.20).
- **KI-623:** PII и ссылка-приглашение больше не хранятся в Redis — payload
  перенесён в `email_outbox`.
- **KI-628:** TopBar не переполняется на 1440/1280 px; поле имени не
  обрезается, копирайт не переносится по буквам.
- **KI-632:** восстановление LM Studio обнаруживается внеочередным пингом
  через 5 с, а не на очередном 30-секундном тике.

### Documented

- **KI-646..651:** AndroidManifest без CAMERA/ML Kit, `src="/logo.svg"` под `base: './'`,
  устаревший API в рецепте, `web/android/` вне git, Capacitor 8 vs 7, вес бандла.
- **KI-653 (High, S4-B):** push на Android не зарегистрируется без
  `google-services.json` (Gradle-плагин Google Services не применяется,
  FirebaseApp не инициализируется — ожидает ручных шагов пользователя).
- **KI-654 (Low, S4-B):** push-уведомление рисуется без белой монохромной
  иконки, которую требует README плагина (белый квадрат в статусбаре).
- **KI-655 (Medium, S4-B):** `.github/workflows/release-mobile.yml` не проверен
  реальным прогоном — AAB ещё не собирался (локально нет JDK/Android SDK,
  Secrets создаёт пользователь); первый `workflow_dispatch` — в S4-B.
- **KI-651:** замер в S3 — плагины filesystem/file-opener/push дали ещё
  vendor 144.94 → 154.46 kB (gzip +2.78) и index 198.24 → 213.13 kB;
  ленивая загрузка плагинов отложена в S4.
- **KI-624:** возвращён в `Documented` — ручки повторной отправки в коде нет,
  статус `Fixed` был выставлен ошибочно.
- **KI-641, KI-642, KI-643, KI-644, KI-645:** retention/повтор outbox,
  прокрутка действий TopBar на <1280 px, нетранзакционный outbox, plaintext
  `invite_link` в БД, возможный дубль письма при сбое `markSentAsync`.
- **KI-635, KI-636, KI-637:** cooperative cancel, отсутствие
  `run_completed` для отменённого `pending`, недоступность отмены
  `pending` из UI.
- **KI-638, KI-639, KI-640:** рублёвая стоимость media-узла не видна в
  поузловом diff, лимит 100 КБ на один diff (не на весь ответ), лишний
  `cursor` в `run1/run2`.

## [1.2.0] — 2026-11-06

**Minor-релиз: LLM Router & SMTP Retry (GPU Integration).**

### Added

- **LLM Router (S1):** `LlmRouterService` с fallback LM Studio → облако. `LlmHealthService`. `ILlmProvider.isAvailableAsync`. Исправлен баг с общим `AbortSignal`.
- **SMTP Retry (S2):** BullMQ-очередь `email-invitations`.
- **UI & Docs (S3):** `GET /llm/health`, индикатор GPU в TopBar, `emailQueued`.
- **ADR-0011, 0012.**

### Changed

- **`InviteMemberResponse.emailSent`:** Всегда `false` (письмо в очереди).

### Fixed

- **KI-593 (частично):** Ретраи SMTP.
- **KI-618:** `GET /llm/health`.
- **KI-622:** `emailQueued`.

### Documented

- **KI-617, 619..621, 623..628.**

## [1.1.0] — 2026-11-05

**Minor-релиз: Enterprise Polish (SMTP, Team Management, Audit Filters, Metrics, Security).**

### Added

- **SMTP & Invitations (S1, KI-584).**
- **Team Management (S2, KI-586).**
- **Audit Filters (S3, KI-585).**
- **Metrics Improvement (S4).**
- **Security (S5):** `token_version`, write-path isolation, email masking.

### Changed

- **JWT Payload:** Добавлено поле `ver`.

### Fixed

- **KI-584, 586, 585, 601, 605, 589.**

### Documented

- **KI-592..616.**


### Added

- **Cancel Run (v1.4.0 S1):** `POST /runs/:id/cancel` (JWT, owner/editor). Миграция `0019_plain_kang.sql` (`cancelled_at`). Движок проверяет флаг перед каждым уровнем/узлом, бросает `RunCancelledException` (non-retryable). SSE `run_completed` принимает `status: 'cancelled'`. UI: кнопка «Отменить» в TopBar при `running`.

### Documented

- **KI-635..637:** Отмена не прерывает уже выполняющийся узел (cooperative cancel), отмена pending не публикует SSE, UI не отменяет pending.

### Added

- **History Comparison (v1.4.0 S2):** `GET /runs/:id1/compare/:id2` (сравнение двух запусков, editor). `RunCompareModal` — side-by-side таблица с diff outputs, длительности и стоимости. Чекбоксы выбора двух запусков в `RunHistoryModal`.

### Documented

- **KI-638..640:** Стоимость media-узла только в USD (в diff), лимит 100 КБ на один diff, `cursor` в ответе сравнения.

## [1.4.0] — 2026-11-08

**Minor-релиз: Run Control (Cancel) & History Comparison.**

### Added

- **Cancel Run (S1, KI-628):** `POST /runs/:id/cancel`. Флаг `cancelled_at` в БД. Движок проверяет перед каждым уровнем/узлом (`RunCancelledException`). SSE `run_completed` принимает `cancelled`. UI: кнопка «Отменить» в TopBar.
- **History Comparison (S2):** `GET /runs/:id1/compare/:id2`. `RunCompareModal` — side-by-side diff (outputs, длительность, стоимость).
- **UX Polish (S3):** Адаптивный TopBar (KI-628). Быстрое восстановление LM Studio (пинг каждые 5 с при `unavailable`, KI-632). Email Outbox — PII перенесены из Redis в БД (KI-623).

### Changed

- **Email Queue:** Payload в Redis теперь содержит только `{ outboxId }`. Все данные (email, orgName, inviteLink) — в таблице `email_outbox`.

### Fixed

- **KI-623:** PII в Redis (Outbox).
- **KI-628:** TopBar переполнение.
- **KI-632:** Быстрое обнаружение восстановления LM Studio.

### Documented

- **KI-635..645:** Cooperative cancel, отмена pending, UI для pending, стоимость media в diff, лимит diff, `cursor` в сравнении, retention outbox, TopBar на <1280px, транзакционность outbox, plaintext invite link, at-least-once доставка.
## [1.3.0] — 2026-11-06

### Added

- **Сверка возможностей модели при подмене роутером (v1.3.0 S1; KI-617)**
  ([отчёт](development/reports/v1.3.0/S1-router-model-check.md)):
  `ModelInfo` получил `supportsTools` и `maxTokens` (контекст), а
  `LlmRegistryService` — нормализованный паспорт модели
  (`getCapabilities`) и поиск первой совместимой модели
  (`findCompatibleRoute`). Новый модуль `model-capabilities.ts` описывает
  требования подмены (модальности, reasoning, tool-calling, контекст) и
  причины несовместимости. `LlmRouterService` больше не подменяет модель
  вслепую: локальная берётся только если совместима, иначе вызов сразу уходит в
  облако; приоритет fallback — исходная облачная модель пользователя →
  `LLM_ROUTER_FALLBACK_MODEL` (если совместима) → первая совместимая облачная
  модель (WARN с причинами) → `LlmProviderException` «нет облачной модели,
  совместимой…». `LlmGenerateOptions.requiresTools` выставляет агент, чтобы его
  шаг не уводился в модель без tool-calling. Каталоги Anthropic/OpenAI/
  RouterAI/DeepSeek пополнены паспортами (`supportsTools`, `maxTokens`).
  Тесты: **+25** (capabilities 12, router +7, registry +6), backend
  **1926 passed**; смоук **10/10**: vision + текстовая локальная → исходная
  облачная `gpt-4o` (LM Studio не вызывался), vision + vision-локальная →
  локальный вызов, локальный сбой без совместимого облака → `failed` с
  понятной ошибкой. **KI-617** закрыт. Ограничения — KI-629..631.
- **Индикатор GPU и `emailQueued` (v1.2.0 S3, DESIGN V120 § 3.4;
  KI-618, KI-622)** ([отчёт](development/reports/v1.2.0/S3-ui-docs.md)):
  `GET /llm/health` отдаёт `{ local: { available, lastCheck }, routerEnabled }`
  (`LlmHealthService.getLastCheckAt()`, `LlmRouterService.isEnabled()`); в
  `TopBar` — зелёная/серая точка `GPU: online/offline` с опросом раз в 30 с и
  `data-gpu-status` для CDP-смоука. `InviteMemberResponse` получил
  `emailQueued` — результат постановки письма в BullMQ; `emailSent` сохранён и
  всегда `false`. `TeamPage` различает «Приглашение отправлено (в очереди)» и
  «создано, но письмо не отправлено» по `emailQueued`. Контракт
  `api-contract.json` и оба паритет-спека обновлены; README — разделы
  «LLM Router» и «SMTP Retry», актуализирована таблица «Статус проекта».
  Тесты: backend **+10** (1901 passed), web **+6** (499 passed); смоук
  **18/18** (GPU online/offline, `emailQueued: true`, задание в очереди).
  **KI-618** и **KI-622** закрыты. Ограничения — KI-626..628.
- **LLM Router и healthcheck LM Studio (v1.2.0 S1, DESIGN V120 § 3.1–3.2)**
  ([отчёт](development/reports/v1.2.0/S1-llm-router.md)):
  `ILlmProvider.isAvailableAsync()` — облачные провайдеры отвечают `true` без
  сетевого запроса, `LmStudioProvider` пингует `GET /v1/models` с таймаутом
  3 с. Новый `LlmRouterService`: при `LLM_ROUTER_ENABLED=true` вызов сначала
  идёт в LM Studio (модель — выбранная, если она объявлена локально, иначе
  первая локальная), при ошибке — WARN и повтор в облако моделью
  `LLM_ROUTER_FALLBACK_MODEL` (default `gpt-4o-mini`). Таймаут 60 с ставится
  на каждую попытку, поэтому истёкший таймаут LM Studio не отменяет fallback.
  `LlmHealthService` раз в 30 с пингует LM Studio; после 3 неудач подряд
  статус `unavailable`, и роутер пропускает GPU; `setInterval.unref()` и
  остановка в `onModuleDestroy`. `LlmService` делегирует вызов роутеру,
  семафоры провайдеров (KI-067) и span `llm.call` (KI-365) перенесены туда же.
  Env: `LLM_ROUTER_ENABLED` (default false, строгий boolean),
  `LLM_ROUTER_FALLBACK_MODEL`. Тесты: +26 (router/health/lmstudio), смоук
  18/18 на mock LM Studio и mock облака (local → 500 → fallback →
  ECONNREFUSED → fallback). Ограничения — KI-617..621.
- **Очередь писем-приглашений с ретраями (v1.2.0 S2, DESIGN V120 § 3.3)**
  ([отчёт](development/reports/v1.2.0/S2-smtp-retry.md)):
  `EmailModule` регистрирует очередь BullMQ `email-invitations` (`attempts: 3`,
  exponential backoff 5000, `removeOnComplete`/`removeOnFail`, prefix/db из
  `BULLMQ_PREFIX`/`REDIS_QUEUE_DB`). `EmailService.queueInvitationAsync` ставит
  job `{ to, orgName, inviteLink }` и возвращает управление сразу;
  `sendInvitationAsync` остаётся реальной SMTP-отправкой и вызывается
  `EmailProcessor` (`@Processor`, `WorkerHost`), который при `false` бросает
  ошибку — BullMQ повторяет job. `OrgMembersService.inviteAsync` больше не ждёт
  SMTP: приглашение создаётся в БД, письмо ставится в очередь, ответ несёт
  `emailSent: false` (контракт v1.1.0 сохранён; отличать «в очереди» от «не
  поставлено» API пока не умеет — KI-622). Payload валидируется Zod в воркере,
  битые данные — `UnrecoverableError`. Env не менялся. Тесты: +12
  (queue/processor), обновлены org-members/email/controller спеки; смоук 18/18
  на mock SMTP: 451 → retry через 5 с → 250, и 3 отказа → job failed,
  приглашение остаётся в БД. Ограничения — KI-622..625. **KI-593** закрыт
  частично (ретраи есть; статус доставки и resend — KI-622/624).
- **Отзыв access-токена и защита write-путей (v1.1.0 S5, KI-601/KI-605)**
  ([отчёт](development/reports/v1.1.0/S5-security.md)):
  колонка `users.token_version` (миграция `0018_daffy_triathlon.sql`, DEFAULT 0)
  и поле `ver` в access-токене. `JwtAuthGuard` при каждом запросе сверяет
  `organization_id` и `token_version` с БД: удалённый/переехавший участник
  получает 401 на любом маршруте, не дожидаясь истечения 24 ч. Удаление
  участника инкрементит версию в транзакции. `WorkflowService.createAsync`/
  `importAsync` принимают только `userId` и резолвят организацию из `users`;
  контроллеры `workflow`/`templates` передают `sub`. `AuditInterceptor` пишет
  организацию из payload, уже сверенного guard'ом с БД. Для
  `member.invite`/`member.remove` email в metadata маскируется
  (`a***@example.com`, KI-589). Смоук 16/16: старый токен B → 401 на
  `/auth/me`, `/workflow`, `/admin/audit`, `POST /workflow`; новый вход
  работает с личной организацией.
- **Метрики: status агента, `llm_call`, process-метрики, Grafana (v1.1.0 S4,
  DESIGN V110 § 3.4, KI-576/577/581/582)**
  ([отчёт](development/reports/v1.1.0/S4-metrics.md)):
  `agent_step_duration_seconds` получила label `status`
  (`success`/`error`) — ошибки LLM больше не смешиваются с успешными шагами;
  добавлена отдельная гистограмма `llm_call_duration_seconds{model,status}`
  для платного вызова внутри tool-шага агента. В `MetricsService` включены
  стандартные `collectDefaultMetrics` (CPU, RSS, heap, event loop, GC,
  handles) с префиксами `process_*`/`nodejs_*`, не конфликтующими с доменными.
  `LlmRegistryService.hasModel` ограничивает `model`-label известными
  моделями (`unknown` для произвольной строки из графа/`llm_call`), чтобы не
  раздувать кардинальность Prometheus. Добавлены `infra/prometheus/prometheus.yml`
  (scrape `/metrics`, target `localhost:3000`) и `infra/grafana/dashboard.json`
  с панелями HTTP latency p95, Run duration p95 и Agent errors.
  Смоук на живом приложении — 18/18: реальный agent-run через mock OpenAI,
  `curl /metrics` с `nodejs_`/`process_`/`llm_call_`, `status="success"` и
  `status="error"` (mock 500). Ограничения — KI-609..613.

- **Фильтры журнала аудита (v1.1.0 S3, DESIGN V110 § 3.3, KI-585)**
  ([отчёт](development/reports/v1.1.0/S3-audit-filters.md)):
  `GET /admin/audit` принимает `action` (точный код действия), `userId` (uuid
  автора), `from`/`to` (границы `created_at` включительно; `YYYY-MM-DD` —
  UTC-сутки, полный ISO-8601 — момент). Условия попадают и в страницу, и в
  `count(*)`, поэтому `total` описывает отфильтрованный журнал; keyset-курсор
  работает вместе с фильтрами. Мусорные значения и `from > to` — 400. Миграция
  `0017_kind_gorilla_man.sql` добавляет индексы
  `(organization_id, action, created_at, id)` и
  `(organization_id, user_id, created_at, id)`. UI `TeamPage`: селекты действия
  и автора, `<input type="date">` для `from`/`to`, «Сбросить»; изменение
  фильтра перезапрашивает первую страницу, «Загрузить ещё» сохраняет фильтры.
  i18n: `audit.filter.*`, `audit.empty_filtered`,
  `audit.action.member.role_change`/`member.remove` (ru/en). Ограничения —
  KI-606..608.

- **Управление командой: смена роли и удаление участника (v1.1.0 S2, DESIGN V110 § 3.2)** ([отчёт](development/reports/v1.1.0/S2-team-management.md)):
  `PATCH /admin/members/:userId` (смена роли `admin|member|viewer`, только
  `owner`; 400 на свою роль и на `owner`, 404 на участника чужой организации) и
  `DELETE /admin/members/:userId` (204; только `owner`; 400 на себя и владельца,
  404 на чужую организацию). Новый `OrgOwnerOnlyGuard` (роль из БД, не из
  токена), `UpdateMemberRoleSchema`/`MemberParamSchema` в
  `src/organizations/dto/member.dto.ts`. Удаление в одной транзакции: графы
  участника в организации переводятся владельцу, его строки
  `workflow_collaborators` удаляются, участник переезжает в новую личную
  организацию с ролью `owner`, активные refresh-токены отзываются. Аудит:
  действия `member.role_change` и `member.remove`. UI `TeamPage`: селект роли и
  кнопка «Удалить» (`window.confirm`) в строке участника, видны только владельцу
  и не показываются для строки владельца; ошибки действия выводятся над
  списком. i18n: `team.role.update`, `team.member.remove`,
  `team.confirm.remove`, `team.error.cannot_remove_self`,
  `team.member.action_failed` (ru/en). Ограничения — KI-599..604.
- **SMTP и письма-приглашения (v1.1.0 S1, DESIGN V110 § 3.1)** ([отчёт](development/reports/v1.1.0/S1-smtp.md)):
  зависимость `nodemailer` (+ `@types/nodemailer`); новый `src/email/`
  (`EmailService`: `createTransport` по `SMTP_*`, таймауты 10/10/20 с,
  маскирование email в логах; HTML+text шаблон с темой «Приглашение в
  организацию {orgName}» и кнопкой «Присоединиться»; `buildInvitationLink` →
  `<APP_PUBLIC_URL>/login?invite=<uuid>`; `EmailModule`). Env: `SMTP_HOST`,
  `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
  (строгий boolean, RULES 4.35) и `APP_PUBLIC_URL` (default
  `http://localhost:3000`). `OrgMembersService.inviteAsync` после создания
  приглашения отправляет письмо; `POST /admin/members/invite` возвращает
  `emailSent`. Без SMTP — WARN, `emailSent: false` и приглашение в БД
  (fallback); сбой SMTP — ERROR, 201 сохраняется. UI различает «письмо
  отправлено» и «создано, но не отправлено» (`team.invite.success_no_email`).
  Ограничения — KI-592..597.
- **Команда организации и журнал аудита в UI (v1.0.0 S5, DESIGN § 2.1/§ 3.2)** ([отчёт](development/reports/v1.0.0/S5-team-ui.md)):
  API — `GET /admin/members` (участники организации и ожидающие приглашения,
  `Cache-Control: no-store`, доступен любому участнику) и
  `POST /admin/members/invite` (только owner/admin; `email` + роль
  `admin|member|viewer`, 400 на роль `owner`, 409 на занятый email и повторный
  инвайт). Новая таблица `organization_invitations` (миграция
  `0016_numerous_gambit.sql`: `id`, `organization_id`/`invited_by` FK CASCADE,
  CHECK роли, UNIQUE `(organization_id, email)`, индекс по `email`) и
  «сжигание» приглашения при регистрации: пользователь создаётся в организации
  пригласившего с назначенной ролью (в одной транзакции). Действие
  `member.invite` добавлено в таблицу маршрутов аудита. UI — модалка
  «Команда и аудит» (`web/src/components/TeamPage.tsx`) и кнопка 👥 «Команда» в
  `TopBar`: вкладка «Участники» (состав, роли, пометка «вы», ожидающие
  приглашения, форма приглашения для owner/admin) и вкладка «Аудит»
  (дата/пользователь/действие/ресурс, keyset-пагинация по `nextCursor`, только
  owner/admin). Зеркала контракта — `web/src/lib/org-api.ts`,
  `web/src/lib/audit-api.ts`, `web/src/types/organization.ts`; i18n-ключи
  `team.*`, `audit.*`, `topbar.team` в обоих языках.
- **Метрики Prometheus (v1.0.0 S4, DESIGN § 3.3)** ([отчёт](development/reports/v1.0.0/S4-metrics.md)):
  зависимость `prom-client@^15.1.3`; `MetricsService` с собственным `Registry`
  и четырьмя метриками: `http_request_duration_seconds{method,route,status}`,
  `run_execution_duration_seconds{node_type,status}`,
  `run_cost_total{currency}` (USD/RUB раздельно, RULES 4.23),
  `agent_step_duration_seconds{model}`. Глобальный `MetricsInterceptor` (APP_
  INTERCEPTOR до `AuditInterceptor`) измеряет каждый HTTP-запрос через
  `performance.now()` + `finalize` (успех/ошибка/отмена), не наблюдает сам
  `/metrics`, подпись `route` — шаблон (`/workflow/:id`), а не фактический URL.
  `GET /metrics` без авторизации (скрейпер Prometheus) отдаёт
  `text/plain; version=0.0.4` с `Cache-Control: no-store`; префикс `metrics`
  добавлен в `api-prefixes.json`. Интеграция: движок пишет длительность каждого
  узла и стоимость успешных LLM/media-узлов; `AgentService` — длительность
  каждого успешного LLM-шага. Ограничения — KI-574..582.
- **Журнал аудита действий (v1.0.0 S3, DESIGN § 3.2)** ([отчёт](development/reports/v1.0.0/S3-audit.md)):
  таблица `audit_logs` (`id` uuid PK, `created_at` timestamptz,
  `user_id`/`organization_id` uuid NOT NULL FK CASCADE, `action` text,
  `resource_id` uuid nullable, `metadata` jsonb) + индекс keyset-пагинации
  `audit_logs_org_created_id_idx`; миграция `0015_short_risque.sql`. Глобальный
  `AuditInterceptor` пишет успешные мутирующие запросы (`POST`/`PATCH`/`DELETE`)
  с действием по URL+методу (`workflow.create`/`update`/`delete`,
  `collaborator.*`, `document_template.*`, `run.start`, …), автором и
  организацией из токена, `resource_id` из ответа/`params`, очищенным от
  секретов телом (лимит 16 KiB). `AuditService` — запись и keyset-чтение;
  `GET /admin/audit?limit=20&cursor=…` (JwtAuthGuard + OrgOwnerGuard, только
  owner/admin, только своя организация, `Cache-Control: no-store`).
  Роль пользователя — `users.role` (`owner|admin|member|viewer`, CHECK), при
  регистрации создатель организации получает `owner`; существующим
  пользователям миграция проставила `owner` (каждый — единственный член личной
  организации). `admin` добавлен в единый реестр `api-prefixes.json`.
  Ограничения — KI-565..573.
- **Изоляция workflow по организациям (v1.0.0 S2, DESIGN § 3.1)** ([отчёт](development/reports/v1.0.0/S2-isolation.md)):
  все выборки и записи workflow/runs/document-templates/sub_workflow ограничены
  `organization_id` из access-токена. Введён `WorkflowAccess { userId, orgId }`
  и `toWorkflowAccess(user)` (контроллеры собирают контекст только из токена);
  предикаты `workflowAccessFilter`/`workflowAccessListFilter`/
  `workflowOwnerFilter`/`accessibleWorkflowIdsSubquery` дополнены
  org-условием. Org-scoped: `WorkflowService` (13 методов + участники),
  `RunsService`/`RunsController`/`RunsHistoryController`/`RunsStreamService`,
  `DocumentTemplatesService`/Controller и lookup `sub_workflow` (контекст
  движка получает `rootUserId` + `rootOrgId`). Публичная share-ссылка
  (`GET /workflow/share/:token`) намеренно остаётся capability без org-фильтра.
  Фильтр «владелец **или** участник» сохранён — S2 добавляет к нему арендатора,
  а не заменяет его. Кросс-организационный инвайт участника → 404, список
  участников — только своя организация. Ограничения — KI-559..564.
- **Organizations DB & Auth — фундамент мультитенантности (v1.0.0 S1, DESIGN
  § 3.1)** ([отчёт](development/reports/v1.0.0/S1-orgs-db.md)): таблица
  `organizations` (`id` uuid `defaultRandom`, `name` text NOT NULL,
  `created_at` timestamptz); `users.organization_id` и
  `workflows.organization_id` — uuid NOT NULL, FK `ON DELETE CASCADE` на
  `organizations`, индексы `users_organization_id_idx`/
  `workflows_organization_id_idx`. Миграция `0014_heavy_iron_patriot.sql`
  добавляет колонки nullable (на непустой БД `ADD COLUMN ... NOT NULL` без
  DEFAULT упал бы), идемпотентный backfill
  `src/db/migrations/backfill-organizations.ts` (вызывается из `migrate.ts`
  после `migrate()`) заводит каждому существующему пользователю
  «Personal Workspace - {email}», привязывает его workflow и только затем
  включает NOT NULL; демо-пользователь получает детерминированную организацию
  `00000000-0000-0000-0000-000000000002`. Регистрация создаёт организацию и
  пользователя в одной транзакции, `JwtPayload` несёт `orgId`. Отложенные
  ограничения — KI-552..558.
- **Web Search: провайдеры Bing и Brave (v0.15 S3, DESIGN V014 § 3.3)** ([отчёт](development/reports/v0.15.0/S1-web-search.md)):
  узел `web_search` поддерживает три провайдера — Tavily (дефолт), Bing Web
  Search API v7 и Brave Search API. `WEB_SEARCH_PROVIDER` расширен до
  `tavily | bing | brave`, ключи Bing/Brave опциональны (без ключа провайдер не
  предлагается). `WebSearchOptions` дополнен `searchDepth` (Tavily:
  `basic`/`advanced`) и `freshness` (Tavily `time_range`, Bing `freshness`,
  Brave `freshness`); узел получил селекты провайдера (когда сконфигурировано
  больше одного), глубины и свежести. Новый эндпоинт
  `GET /web-search/providers` (JWT) отдаёт провайдера по умолчанию и флаг
  «ключ задан» без самих ключей. Bing v7 и Brave не поддерживают глубину
  поиска — KI-546; недоступный провайдер (нет ключа или stale-выбор) помечается
  в селекте disabled-опцией — KI-547.
- **Run History UI (v0.14 S2, DESIGN V014 § 3.2)** ([отчёт](development/reports/v0.14.0/S2-history-ui.md)):
  кнопка «История» (🕒) в `TopBar` (активна только для сохранённого workflow;
  для `viewer` скрыта — история требует `editor`, KI-537) открывает модалку
  `RunHistoryModal` со списком запусков: статус (иконка + цвет), дата,
  длительность (`durationMs`) и стоимость (`costUsd`/`costRub`), пагинация
  «Назад/Вперёд» (`limit=20`). Клик по запуску закрывает модалку, сбрасывает
  выбранный узел и восстанавливает прогон в панели результата
  (`restoreRunAsync`, как после F5). `fetchWorkflowRunsAsync` — тонкая обёртка
  над `GET /workflow/:id/runs` с Zod-разбором. i18n: `history.*` в ru/en.
  F5 после открытия старого запуска не восстанавливает панель — KI-541.
- **Run History API (v0.14 S1, DESIGN V014 § 3.1)** ([отчёт](development/reports/v0.14.0/S1-history-api.md)):
  `GET /workflow/:id/runs?limit=20&offset=0` отдаёт историю запусков workflow
  `{ runs: RunSummary[], total }` (сначала новые). `RunSummary`: `id`, `status`,
  `createdAt`, `startedAt`, `finishedAt`, `durationMs` (`finished_at −
  started_at`), `costUsd`/`costRub` (суммы `node_runs`). Пагинация
  `limit`/`offset` валидируется Zod'ом; права — владелец или участник с ролью
  `editor`, чужой workflow/`viewer` → 404 (KI-202). `RunHistoryResponse` и
  `RunSummary` добавлены в `docs/development/api-contract.json` и паритет-спеки
  backend/web.
- **PDF-режим узла `document_gen` (v0.12 S1, DESIGN § 3.1, KI-463)** ([отчёт](development/reports/v0.12.0/S1-S2-pdf.md)):
  `PdfRenderer` (`src/documents/pdf-renderer.service.ts`) на `pdfkit` с
  встроенным Noto Sans (`src/documents/assets/NotoSans-Regular.ttf`, OFL) —
  H1–H3, абзацы, списки, код с серым фоном и кликабельные ссылки; при
  отсутствии шрифта — fallback на Helvetica с warning. Исполнитель выбирает
  рендерер по `format`, сохраняет файл с расширением `.pdf` и
  `mimeType: application/pdf`; `DocumentGenerationNodeDataSchema` больше не
  отвергает `pdf`. В `DocumentGenNode` добавлен селект DOCX/PDF (при переходе
  в template формат сбрасывается на DOCX), подпись ссылки и `download`
  учитывают формат. Зависимости: `pdfkit` + `@types/pdfkit`; ассеты
  копируются в `dist` через `nest-cli.json`.

### Changed

- **Release Prep v1.3.0 (S3)** ([отчёт](development/reports/v1.3.0/S3-release.md)):
  версии `package.json` и `web/package.json` → `1.3.0`; `[Unreleased]`
  закреплён как `[1.3.0] — 2026-11-06`, сверху добавлена пустая секция
  `[Unreleased]`; сводка KI пересчитана grep'ом (621 запись), удалены дубли
  KI-632/633, KI-623/628/629 возвращены в Documented (были помечены закрытыми
  без изменений кода), заведён KI-634; обновлены README, `docs/README`,
  `USER_GUIDE` (раздел «Что нового в v1.0–v1.3», ограничения 1.3.0) и
  `MANUAL_TESTING_GUIDE` (+9 кейсов блока V1.3, итого 148). Финальные гейты:
  build 0/0, typecheck 0, backend **1935**, web **500**, parity/e2e зелёные.
- **Паритет-гейт для `GET /llm/health` (v1.3.0 S2, KI-627)**
  ([отчёт](development/reports/v1.3.0/S2-healthcheck.md)):
  в `docs/development/api-contract.json` добавлены `LlmHealthResponse`
  (`local`, `routerEnabled`) и `LocalLlmHealth` (`available`, `lastCheck`);
  backend-спек регистрирует TS-интерфейсы ответа, web-спек — зеркала
  `LlmHealthResponseSchema`/`LocalLlmHealthSchema`, оба получили
  регрессионные тесты на точный состав. Расширение точечное: `LlmModelInfo` и
  `MediaModelInfo` остаются вне гейта (KI-357).
- **Контракт access-токена: поле `ver` и сверка с БД (v1.1.0 S5, KI-601):**
  `JwtPayload` дополнен `ver` (`users.token_version`), токены без него
  трактуются как версия 0. `JwtAuthGuard` после проверки подписи делает один
  SELECT по `sub` и отклоняет токен при несовпадении организации/версии; в
  `request.user` кладётся актуальный `orgId` из БД. `POST /workflow` и
  `POST /workflow/import` больше не принимают организацию из контроллера —
  `WorkflowService` резолвит её по `userId` (KI-605).
- **Миграция Prometheus-клиента (v1.1.0 S4, KI-574):** зависимость
  `prom-client@15.1.3` заменена на `@prometheus-io/client@0.16.1` (официальный
  клиент Prometheus, Apache-2.0). Импорты `Registry`/`Histogram`/`Counter`/
  `collectDefaultMetrics` обновлены; API и формат экспозиции совместимы
  (`text/plain; version=0.0.4; charset=utf-8`). Требование пакета к Node
  (`^22 || ^24 || >=26`) зафиксировано в KI-609.
- **Query-параметры `GET /admin/audit` и контракт (v1.1.0 S3, KI-585):**
  `AuditQuerySchema` расширена `action`/`userId`/`from`/`to`; `from > to`,
  невалидные даты/uuid/код действия — 400. В
  `docs/development/api-contract.json` добавлена секция `queryParams`
  (`GET /admin/audit`); состав REST-ответов не менялся — паритет-гейты зелёные.
  `AuditService.listAsync` принимает `userId` (`sub`) и сам резолвит организацию:
  сигнатура `(access, limit, cursor)` заменена на
  `(userId, limit, cursor, filter)`.
- **Политика доступа к управлению составом организации (v1.1.0 S2):**
  `PATCH`/`DELETE /admin/members/:userId` закрыты `OrgOwnerOnlyGuard` — только
  `owner`, роль читается из БД при каждом запросе (не из access-токена, KI-554);
  `POST /admin/members/invite` остаётся доступен `owner`/`admin` (S5). Ответ
  `PATCH` — существующий `OrganizationMemberSummary` (контракт не менялся),
  `DELETE` — 204 без тела; `api-contract.json` и паритет-гейты не правились.
- **Ответ `POST /admin/members/invite` — `InviteMemberResponse` (v1.1.0 S1):**
  к прежним полям приглашения добавлен `emailSent: boolean` — SMTP принял
  письмо. Новый DTO в backend (`src/organizations/dto/member.dto.ts`) и
  web-зеркале (`InviteMemberResponseSchema`), запись в
  `docs/development/api-contract.json` и в обоих паритет-спеках. UI различает
  «письмо отправлено» и «приглашение создано, письмо не отправлено» (новый
  ключ `team.invite.success_no_email` в ru/en).
- **`UserPublic` отдаёт организацию и роль (v1.0.0 S5, KI-555):**
  `GET /auth/me`, `POST /auth/login`, `/auth/register`, `/auth/refresh`
  возвращают `user.organizationId` (uuid) и `user.role`
  (`owner|admin|member|viewer`); поля читаются из строки `users`, а не из JWT
  (KI-554). Зеркала `web/src/lib/auth-api.ts` и `web/src/stores/auth.ts`
  дополнены полями, публичный REST-контракт — DTO `UserPublic`,
  `OrganizationMemberSummary`, `OrganizationInvitationSummary`,
  `OrganizationMembersResponse`, `AuditLogSummary`, `AuditLogsResponse` и
  тремя доменами ролей; `GET /admin/members*` резолвят организацию из БД по
  `sub`, поэтому устаревший `orgId` в токене не уводит операцию в чужой
  арендатор.
- **Метрики как отдельная подсистема (v1.0.0 S4):** новый `@Global()`
  `MetricsModule` (не требует правок `imports` у `EngineModule`/`AgentModule`);
  `MetricsService` инжектится в `ExecutionEngineService` и `AgentService`.
  Новый префикс `metrics` в `api-prefixes.json` (SPA-fallback и Vite-proxy
  подхватывают автоматически). `prom-client` помечен upstream как deprecated
  (замена — `@prometheus-io/client`) — KI-574.
- **Роль пользователя и административный доступ (v1.0.0 S3):** `users.role`
  (`owner|admin|member|viewer`, NOT NULL default `member`, CHECK
  `users_role_check`); `registerAsync` создаёт создателя личной организации
  сразу `owner`; миграция 0015 проставила `owner` всем существующим
  пользователям. Новый префикс `admin` в `api-prefixes.json` (SPA-fallback и
  Vite-proxy подхватывают его автоматически).
- **Кросс-организационные объекты → 404 (v1.0.0 S2, DESIGN § 3.1):**
  `GET /workflow`, `GET/PATCH/DELETE /workflow/:id`, export/share/collaborators,
  `GET /workflow/:id/runs`, `POST /runs`, `GET /runs/:id*`,
  `/workflow/:id/document-templates*` и `sub_workflow`-ссылки для workflow
  другой организации отвечают 404 — так же, как для несуществующего (KI-202,
  факт существования не раскрывается). Доступ к графу = совпадение организации
  **и** (владелец | участник); `orgId` берётся только из подписанного токена,
  через body/query его не подменить.
- **JWT-контракт: `orgId` обязателен (v1.0.0 S1, DESIGN § 3.1/§ 4):**
  `JwtPayload = { sub, email, orgId }`; `AuthService.loginAsync`/
  `rotateRefreshTokenAsync` берут `orgId` из `users.organization_id`,
  `registerAsync` создаёт личный workspace и выдаёт токен с его id. Создание и
  импорт workflow пишут `organization_id` из токена
  (`WorkflowService.createAsync`/`importAsync`); фильтрация выборок по
  арендатору — S2.
- **Фикстуры и схемы тестов:** `Workflow`/`User` в тестах и интеграционных
  спеках получили `organization_id`; parity-гейт KI-298 покрывает
  `organizations` (обязательные таблицы — шесть).

### Security

- **Auth-guard на `GET /llm/health` (v1.3.0 S2, KI-626)**
  ([отчёт](development/reports/v1.3.0/S2-healthcheck.md)):
  `@UseGuards(JwtAuthGuard)` на `GET /llm/health` — без access-токена 401 «Нет
  токена», при `AUTH_DISABLED=true` guard подставляет системного пользователя;
  `LlmModule` импортирует `AuthModule` ради `JwtService`. `GET /llm/models`
  осознанно оставлен публичным: список моделей грузится на старте SPA до
  подтверждения сессии, секретов в ответе нет; остаточный риск — KI-633.
  Тесты: 401 без токена, 401 с невалидным токеном, 200 с токеном, 200 при
  `AUTH_DISABLED=true`, публичность `/llm/models`. Смоук: 401/200 на живом
  backend.
- **Отзыв access-токена при удалении из организации (v1.1.0 S5, KI-601)**
  ([отчёт](development/reports/v1.1.0/S5-security.md)): `users.token_version` +
  `JwtPayload.ver`; `JwtAuthGuard` сверяет организацию и версию с БД на каждом
  запросе, поэтому устаревший access-токен удалённого участника не даёт доступа
  ни к чтению, ни к записи. `OrgMembersService.removeMemberAsync` инкрементит
  версию в транзакции. Смоук: 401 на `/auth/me`, `/workflow`, `/admin/audit`,
  `POST /workflow` старым токеном; новый вход B — личная организация, `ver=1`.
  Остатки (logout, SELECT на запрос) — KI-614/KI-615.
- **Write-пути не доверяют `orgId` из токена (v1.1.0 S5, KI-605):**
  `WorkflowService.createAsync`/`importAsync` резолвят организацию из `users`,
  `AuditInterceptor` использует payload, сверенный guard'ом; удалённый участник
  больше не может создать workflow в старой организации и записать строку в её
  аудит. Проверено смоуком (16/16).
- **Маскировка email в аудите (v1.1.0 S5, KI-589):** для действий
  `member.invite`/`member.remove` metadata рекурсивно маскируется
  (`a***@example.com`); полный адрес в журнал не попадает. Тесты и смоук
  подтверждают отсутствие полного email.
- **Организация журнала аудита резолвится из БД (v1.1.0 S3, KI-587/KI-601)**
  ([отчёт](development/reports/v1.1.0/S3-audit-filters.md)):
  `GET /admin/audit` больше не доверяет `orgId` из access-токена — контроллер
  передаёт только `sub`, `AuditService` читает `users.organization_id` и
  фильтрует журнал по нему. Удалённый участник со старым токеном видит только
  аудит своей новой (пустой) организации, а не журнал организации, из которой
  его исключили; нет строки `users` — 401. Смоук: 31/31, включая удаление
  участника и повторное чтение журнала старым токеном. Остаток: write-пути
  по-прежнему берут `orgId` из токена (KI-605), полный отзыв access-токена не
  реализован (KI-601 — Fixed (частично)).
- **`/metrics` без авторизации — только для сетевого скрейпера (v1.0.0 S4):**
  ручка намеренно открыта (Prometheus не умеет JWT, DESIGN § 3.3), поэтому её
  нельзя публиковать наружу: доступ должен ограничиваться ingress/reverse-proxy
  allowlist (scrape-сеть). Экспозиция содержит только агрегаты с ограниченными
  подписями (маршруты, статусы, типы узлов, модели, валюты) — без
  пользовательских данных и секретов. Требование к эксплуатации — KI-575.
- **Аудит действий и доступ к журналу только для owner/admin (v1.0.0 S3):**
  мутирующие HTTP-запросы журналируются с автором и арендатором; секретные поля
  (`password`/`token`/`secret`/`apiKey`/`authorization`/`cookie`) вырезаются из
  metadata на любой глубине, тело ограничено 16 KiB. `GET /admin/audit`
  защищён `JwtAuthGuard` + `OrgOwnerGuard` (роль читается из БД на каждый
  запрос) и изолирован по организации. Запись best-effort: сбой аудита
  логируется и не ломает операцию пользователя; `/auth/*` и неудачные
  запросы пока не аудируются — KI-566/KI-569.
- **Изоляция арендаторов на уровне SQL (v1.0.0 S2, DESIGN § 3.1):**
  `workflows.organization_id` добавлен в каждый предикат доступа к workflow и в
  подзапрос «доступные workflow» для запусков/истории/шаблонов;
  `sub_workflow` загружает подграф только в организации корневого запуска.
  Кросс-организационная строка `workflow_collaborators` (legacy) больше не даёт
  доступа, а её email не показывается в списке участников — чужой PII не
  утекает. Публичная share-ссылка остаётся capability-моделью (доступ по
  токену, без org-фильтра) — это осознанное исключение по постановке S2.
- **Старые access-JWT без `orgId` отклоняются (v1.0.0 S1, DESIGN § 4):**
  `JwtAuthGuard` после проверки подписи требует непустой `orgId` и отвечает 401
  «Токен устарел, войдите заново…». Действующая refresh-cookie восстанавливает
  сессию через `POST /auth/refresh` (новый access уже с `orgId`); иначе —
  повторный вход. Поведение задокументировано в KI-553.

### Fixed

- **KI-621 — внеочередной пинг после восстановления LM Studio (v1.3.0 S2;
  Fixed (частично))** ([отчёт](development/reports/v1.3.0/S2-healthcheck.md)):
  при переходе `unavailable → available` `LlmHealthService` через 5 с
  (`LLM_HEALTH_RECOVERY_PING_DELAY_MS`) выполняет подтверждающий пинг, не
  дожидаясь очередного 30-секундного тика. Бесконечного цикла нет: пинг
  планируется только на самом переходе, `unref()` не удерживает event loop,
  `stop()` снимает и его. Обнаружение восстановления по-прежнему происходит на
  очередном тике — остаток вынесен в KI-632. Тесты: +3 (fake timers: ровно
  +5 с, отмена `stop()`, неудачный внеочередной пинг не зацикливается).
- **KI-601 — отзыв access-токена (v1.1.0 S5)**
  ([отчёт](development/reports/v1.1.0/S5-security.md)): `users.token_version`
  (миграция 0018) и `ver` в JWT; `JwtAuthGuard` сверяет версию и организацию с
  БД, удаление участника инкрементит версию. Тесты: `jwt-auth.guard.spec.ts`,
  `auth.service.spec.ts`, `org-members.service.spec.ts`; смоук — старый токен
  B получает 401 на всех проверенных ручках.
- **KI-605 — write-пути читают организацию из БД (v1.1.0 S5)**
  ([отчёт](development/reports/v1.1.0/S5-security.md)):
  `WorkflowService.createAsync`/`importAsync` принимают `userId` и резолвят
  `users.organization_id`; контроллеры передают `sub`; `AuditInterceptor`
  пишет организацию из сверенного payload. `workflow.service.spec.ts`
  проверяет SELECT по `users`, 401 без пользователя и запись org из БД.
- **KI-589 — email в metadata аудита замаскирован (v1.1.0 S5)**
  ([отчёт](development/reports/v1.1.0/S5-security.md)): для
  `member.invite`/`member.remove` email рекурсивно маскируется в body/params;
  `a***@example.com`, полный адрес не сохраняется. Тесты
  `audit.interceptor.spec.ts` (4 кейса) и смоук.
- **KI-574 — миграция на `@prometheus-io/client` (v1.1.0 S4)**
  ([отчёт](development/reports/v1.1.0/S4-metrics.md)): `prom-client` удалён,
  официальный клиент установлен; API реестра/гистограмм/счётчика и
  `Content-Type` не изменились, все метрики и тесты переведены без правок
  контракта.
- **KI-576 — `status` в метрике шага агента (v1.1.0 S4)**
  ([отчёт](development/reports/v1.1.0/S4-metrics.md)): успешные шаги —
  `status="success"`, ошибки LLM — `status="error"` (с длительностью); ошибка
  по-прежнему пробрасывается в retry-guard. Дашборд считает error-rate через
  `rate(agent_step_duration_seconds_count{status="error"}[5m])`.
- **KI-577 — инструментация `llm_call` (v1.1.0 S4)**
  ([отчёт](development/reports/v1.1.0/S4-metrics.md)): гистограмма
  `llm_call_duration_seconds{model,status}` пишется в `executeToolAsync`;
  модель санитизируется по реестру, ошибка инструмента не роняет цикл.
- **KI-581 (частично) — process-метрики (v1.1.0 S4)**
  ([отчёт](development/reports/v1.1.0/S4-metrics.md)): `collectDefaultMetrics`
  в изолированном реестре — `process_*`/`nodejs_*`; мост OTel→Prometheus
  остался (KI-612).
- **KI-582 (частично) — Grafana/Prometheus в репозитории (v1.1.0 S4)**
  ([отчёт](development/reports/v1.1.0/S4-metrics.md)): dashboard JSON с тремя
  панелями и scrape-config; alert rules/provisioning — KI-610.
- **KI-585 — фильтры аудита (API + UI) (v1.1.0 S3, DESIGN V110 § 3.3)**
  ([отчёт](development/reports/v1.1.0/S3-audit-filters.md)): журнал можно
  фильтровать по действию, автору и датам; `total` считается по тому же
  предикату, что страница (KI-571); индексы под фильтры в миграции 0017;
  UI-контролы и сброс фильтров. Тесты: `audit.dto.spec.ts`,
  `audit.service.spec.ts`, `admin-audit.controller.spec.ts`, `TeamPage.spec.tsx`,
  `audit-api.spec.ts`; смоук 31/31.
- **KI-587 — `GET /admin/audit` читает организацию из БД (v1.1.0 S3)**
  ([отчёт](development/reports/v1.1.0/S3-audit-filters.md)): `AdminAuditController`
  передаёт `AuditService.listAsync` только `user.sub`; организация читается из
  `users.organization_id`, поэтому устаревший `orgId` в токене не открывает
  чужой/старый журнал. В S2 KI был ошибочно помечен «Fixed» — исправлено в
  реестре и подтверждено тестами + смоуком.
- **KI-601 (частично) — устаревший access-токен не даёт читать аудит старой
  организации (v1.1.0 S3)** ([отчёт](development/reports/v1.1.0/S3-audit-filters.md)):
  закрыт известный вектор чтения журнала; сам токен по-прежнему живёт 24 ч, и
  write-пути берут `orgId` из него — остаток вынесен в KI-605.
- **KI-586 — управление участниками организации (v1.1.0 S2, DESIGN V110 § 3.2)**
  ([отчёт](development/reports/v1.1.0/S2-team-management.md)): владелец может
  менять роль и исключать участников; удаление — выход из организации с
  передачей графов владельцу, удалением участия в workflow и отзывом
  refresh-токенов; журнал получает `member.role_change`/`member.remove`.
  Остатки (выбор стратегии переноса графов, невозможность повторного
  приглашения, отзыв access-токена, несогласованность прав admin) — KI-599..604.
- **KI-584 — приглашения доставляются письмом (v1.1.0 S1, DESIGN V110 § 3.1)**
  ([отчёт](development/reports/v1.1.0/S1-smtp.md)): добавлен SMTP-транспорт
  (`nodemailer`) и шаблон письма; `OrgMembersService.inviteAsync` отправляет
  письмо после создания приглашения, `POST /admin/members/invite` отдаёт
  `emailSent`. При ненастроенном SMTP — прежний fallback: WARN, `emailSent:
  false`, приглашение в БД и 201; при сбое SMTP — ERROR и тот же результат.
  Смоук: без SMTP — 201 + WARN; с mock-SMTP письмо реально получено (тема,
  получатель, ссылка `/login?invite=<uuid>`); при недоступном SMTP — ERROR,
  `emailSent: false`.
- **KI-555 / KI-573 / KI-554 (частично): профиль с организацией и UI аудита
  (v1.0.0 S5)** ([отчёт](development/reports/v1.0.0/S5-team-ui.md)):
  `GET /auth/me` отдаёт `orgId` и роль (KI-555), журнал `GET /admin/audit`
  доступен из UI с keyset-пагинацией (KI-573). KI-554 закрыт частично:
  `/admin/members*` проверяют членство по БД, `GET /admin/audit` по-прежнему
  фильтрует по `orgId` из токена — остаток вынесен в KI-587. Приглашение в
  организацию пишется в журнал как `member.invite`.
- **История запусков: keyset-пагинация (v0.16 S1, KI-542)** ([отчёт](development/reports/v0.16.0/S1-tech-debt.md)):
  `GET /workflow/:id/runs` листается непрозрачным курсором
  (`RunSummary.cursor`, `?cursor=`) вместо `offset`. Сервис фильтрует
  `(created_at, id) < (cursor.createdAt, cursor.id)` при порядке
  `created_at DESC, id DESC`, поэтому новые запуски между страницами больше не
  сдвигают окно (нет дублей и пропусков). Курсор несёт микросекундную точность
  `timestamptz` (ISO-строка из `to_char(... 'US')`), а не JS `Date` — иначе
  tie-break по `id` мог бы пропускать запуски одной миллисекунды. В
  `RunHistoryModal` кнопки
  страниц заменены на «Загрузить ещё» с дописыванием и дедупликацией.
  `offset` удалён из контракта (индекс KI-540 — отдельная задача).
- **История: F5 после клика по запуску (v0.16 S1, KI-541):** клик в модалке
  пишет `?runId=` через `history.replaceState` и вызывает
  `restoreRunAsync(..., { preserveRunIdInUrl: true })`; терминальный запуск
  больше не теряет параметр, и F5 восстанавливает панель результата.
- **Единый неймспейс статусов (v0.16 S1, KI-545):** `run.status.*`,
  `run.status.node.*`, `history.status.*` и `node.status.skipped` сведены в
  `status.*`; TopBar, панель результата и история показывают одинаковые
  подписи («Ожидает», «Выполняется», «Завершён», «Ошибка», «Отменён»).
- **Web Search в контракт-гейте (v0.16 S1, KI-548):**
  `WebSearchProvidersResponse`/`WebSearchProviderInfo` добавлены в
  `docs/development/api-contract.json` и оба паритет-спека; домен провайдера
  кодируется в `enums` (`z.enum`), проверено отсутствие ключей в ответе.
- **MCP: WARN о ненайденных именах allowlist (v0.16 S1, KI-534):** при
  подключении `stdio`-сервера `McpClientService` перечисляет в WARN имена из
  `MCP_STDIO_ENV_ALLOWLIST`, которых нет ни в `env` сервера, ни в окружении
  (без значений, один раз на сервер).

### Documented

- **Ограничения S2 healthcheck (v1.3.0):** восстановление LM Studio
  обнаруживается только на очередном тике интервала (до 30 с), а вторая
  половина KI-621 (частые fallback-попытки при `available` до тика) не
  затронута — KI-632; `GET /llm/models` остаётся публичным, потому что SPA
  грузит список моделей до подтверждения сессии, — KI-633.
- **Ограничения S5 (v1.1.0):** logout не отзывает access-токен — `token_version`
  инкрементится только при удалении участника, а не при выходе (KI-614);
  `JwtAuthGuard` делает SELECT в БД на каждый аутентифицированный запрос
  (KI-615); маскирование email включено только для `member.invite`/
  `member.remove`, `collaborator.invite` по-прежнему пишет адрес (KI-616).
- **Ограничения метрик S4 (v1.1.0):** `@prometheus-io/client@0.16.1` требует
  Node 22/24/26+, а `engines.node` проекта не зафиксирован — KI-609; Grafana
  dashboard статичен, панели не проверяются в CI, alert rules нет — KI-610;
  `collectDefaultMetrics` регистрируется на каждый инстанс `MetricsService` и
  не снимается при shutdown — KI-611; моста OTel→Prometheus по-прежнему нет —
  KI-612; scrape-target `localhost:3000` требует правки для Docker/k8s —
  KI-613.
- **Ограничения аудита S3 (v1.1.0):** удалённый участник со старым токеном
  по-прежнему может писать в старую организацию (`POST /workflow` и
  `AuditInterceptor` берут организацию из токена) — KI-605; список действий в
  UI-фильтре захардкожен и требует правки при добавлении действия — KI-606;
  страница журнала делает четыре запроса к БД (роль guard'а, резолв организации,
  `count(*)`, страница) — KI-607; UI не предотвращает `from > to` и показывает
  400 как общую ошибку загрузки — KI-608.
- **Ограничения управления командой (v1.1.0 S2):** удаление необратимо и
  принудительно передаёт графы участника владельцу без выбора стратегии
  (KI-599); удалённого участника нельзя пригласить обратно без SQL-правки
  (KI-600); действующий access-токен не отзывается — устаревший `orgId` может
  дать доступ к аудиту старой организации до 24 ч (KI-601, усиливает KI-587);
  pending-приглашения удалённого и `created_by` его шаблонов остаются
  (KI-602); роль `admin` не управляет составом, хотя DESIGN § 2.1 называет её
  ролью управления командой (KI-603); подтверждение удаления — только
  `window.confirm`, undo нет (KI-604).
- **Ограничения SMTP-приглашений (v1.1.0 S1):** письмо отправляется синхронно
  внутри HTTP-запроса — SMTP-задержка входит в latency инвайта (KI-592);
  ретраев и статуса доставки нет, при временном сбое письмо теряется
  (KI-593); параметр `?invite=<uuid>` UI не использует — регистрация «сжигает»
  приглашение по email (KI-594); шаблон только русский (KI-595); отдельного
  rate limit на отправку приглашений нет (KI-596); `emailSent` не хранится в
  БД, статус виден только в ответе на инвайт (KI-597), а `true` означает
  «SMTP принял», не «доставлено»; версии `nodemailer` и `@types/nodemailer`
  различаются мажорно (KI-598).
- **Ограничения команды организации (v1.0.0 S5):** приглашение работает только
  для ещё не зарегистрированных email — перенос существующего пользователя
  между организациями не поддержан (KI-583); письма не отправляются, доставка
  приглашения — вне S5 (KI-584); смены роли и удаления участника из организации
  нет — только приглашение (KI-586); в UI аудита нет фильтров по
  действию/пользователю/дате (KI-585); несколько организаций могут пригласить
  один email — «сжигается» самое старое приглашение, остальные остаются
  ожидающими (KI-588); email приглашённого хранится в metadata аудита в
  открытом виде (KI-589).
- **Ограничения метрик S4 (v1.0.0):** `prom-client` помечен deprecated
  upstream — нужна миграция на `@prometheus-io/client` (KI-574); `/metrics`
  без auth публиковать нельзя — только сетевая защита периметра (KI-575);
  `agent_step_duration_seconds` без status-лейбла — ошибки агентских шагов не
  наблюдаются (KI-576); агентский `llm_call` не инструментирован (KI-577);
  переиспользованные узлы (KI-046) считаются completed с ~0 с (KI-578); реестр
  на процесс — multi-instance скрейп на стороне Prometheus (KI-579);
  fallback-подпись route нормализует только UUID (KI-580); нет default
  process-метрик и моста OTel→Prometheus (KI-581); дашбордов/алертов Grafana в
  репозитории нет (KI-582).
- **Ограничения аудита S3 (v1.0.0):** политика retention/immutability не
  определена — CASCADE удаляет журнал вместе с арендатором (KI-565); мутирующие
  `/auth/*` (login/register/refresh/logout) не аудируются — нужен сервисный
  вызов в S5 (KI-566); запись fire-and-forget может потеряться при падении
  процесса (KI-567); таблица route→action поддерживается вручную без
  паритет-теста (KI-568); неудачные 4xx/5xx мутации не журналируются (KI-569);
  `users.role` — глобальная роль, не членство в организации (KI-570); `total`
  в `GET /admin/audit` — отдельный `count(*)` (KI-571); metadata может
  содержать пользовательские промпты/графы (KI-572, RULES 5.9); UI аудита
  появится в S5 (KI-573).
- **Ограничения изоляции S2 (v1.0.0):** удаление организации может упасть на
  FK `workflow_collaborators.invited_by` (KI-559); legacy кросс-организационные
  участники не используются и не чистятся (KI-560); необязательный
  `WorkflowAccess` оставляет внутренние пути без фильтра (KI-561); SQL-shape
  тесты зависят от внутренностей Drizzle (KI-562); совместная работа между
  организациями недоступна до S5 — все пользователи в личных организациях
  (KI-563); нет DB-инварианта «организация workflow = организация владельца»
  (KI-564).
- **Ограничения keyset-пагинации (v0.16 S1):** `RunSummary.cursor` дублирует
  `nextCursor` (KI-549); `offset` удалён без deprecation-окна — старый клиент
  молча получает первую страницу (KI-550); счётчик «Показано N из M» может
  опережать список, если запуск появился при открытой модалке (KI-551).
- **Ограничения мультитенантности S1 (v1.0.0):** `document_templates` и
  `workflow_runs` пока без `organization_id` — S2 (KI-552); старые access-JWT
  дают 401 до refresh/повторного входа (KI-553); guard не сверяет `orgId` с БД
  (KI-554); `/auth/me` не отдаёт арендатора (KI-555); NOT NULL включается
  backfill-скриптом, обход `pnpm db:migrate` оставит колонки nullable (KI-556);
  гонка регистрации с одинаковым email → 500 вместо 409 (KI-557); политика
  `ON DELETE CASCADE` организации продуктом не определена (KI-558).

## [0.14.0] — 2026-11-02

**Minor-релиз: Run History Browser.**

### Added

- **Run History API (S1, KI-537):** Эндпоинт `GET /workflow/:id/runs` с пагинацией, агрегацией стоимости и длительности из `node_runs`. Новый `RunsHistoryController`.
- **Run History UI (S2):** Модальное окно «История» с кнопкой в TopBar (🕒). Отображает статус, дату, длительность и стоимость запусков. Клик по запуску открывает панель результатов (`restoreRunAsync`).

### Fixed

- **Округление длительности:** Исправлен баг, при котором 119.5 секунд отображались как «1 мин 60 с».

### Documented

- **KI-541..545:** Ограничения UI истории (F5 после клика, пагинация со сдвигом, отсутствие real-time обновлений, разница в i18n статусах).
- **Web Search (S3):** Расширение провайдеров (Bing, Brave) перенесено в v0.15.0.
## [0.13.0] — 2026-11-02

**Patch-релиз: MCP Hardening & UI.**

### Added

- **MCP stdio Env Allowlist (KI-529):** `MCP_STDIO_ENV_ALLOWLIST` позволяет безопасно передавать переменные окружения (например, токены) в дочерние MCP-процессы.
- **MCP stdio Cwd Isolation (KI-530):** Процессы запускаются в изолированных папках `./data/mcp/{serverName}`, добавлен WARN при запуске без Docker.
- **UI Badge (KI-531):** В узле `AgentNode` добавлен бейдж `LOCAL` для stdio-серверов.

### Fixed

- **KI-532:** `isPidAlive` теперь различает `EPERM` (жив) и `ESRCH` (мертв), что предотвращает orphan-процессы.

### Documented

- **KI-533..536:** Ограничения stdio (глобальный allowlist, отсутствие канонизации путей, диагностика).
## [0.12.0] — 2026-11-02

**Minor-релиз: PDF Generation, MCP stdio & SafeHttpClient Binary.**

### Added

- **PDF Generation (S1+S2, KI-463):** `PdfRenderer` на `pdfkit` + `NotoSans`. Узел `document_gen` теперь поддерживает формат `pdf` в inline-режиме (Markdown/JSON → PDF). Кириллица, списки, ссылки, заголовки. Fallback на Helvetica, если шрифт не найден.
- **MCP stdio (S4, KI-526):** `StdioClientTransport` для запуска локальных MCP-серверов (через `child_process.spawn`). Защита от orphan-процессов (`SIGTERM` → `SIGKILL`), denylist команд. Env `MCP_ENABLE_STDIO` (default `false`).
- **SafeHttpClient Binary (S3, KI-525):** Метод `fetchBufferAsync` для безопасного скачивания бинарных файлов (pinned DNS, лимит байт). Провайдер `OpenAI Images` переведен на него.

### Fixed

- **KI-528:** `SafeHttpClient.discardAsync` ронял процесс (`undici` 8) на редиректе из-за uncaught `RequestAbortedError`. Исправлено.

### Documented

- **KI-527:** PDF-таблицы выводятся плоским текстом (в отличие от DOCX).
- **KI-529..532:** Ограничения MCP stdio (env, изоляция) и UI.
## [0.11.1] — 2026-10-19

**Patch-релиз: отключение внутренних ретраев SDK, fallback `image_tool` и
OpenAI Images `applyToolAsync`.**

### Fixed

- **KI-500: двойной retry SDK + движок** ([отчёт](development/reports/v0.11.1/S1-hardening.md)):
  OpenAI-совместимый и Anthropic-провайдеры создают SDK-клиенты с
  `maxRetries: 0`; повторы 429/5xx выполняет только движок
  (`NODE_RETRY_MAX_ATTEMPTS`), поэтому до 9 платных upstream-вызовов на узел
  больше не возникает. Тесты фиксируют опции конструктора и ровно N попыток
  движка; smoke с локальным upstream 429 — 1 HTTP-запрос на провайдер.
- **KI-418: `image_tool` — операции без модели** ([отчёт](development/reports/v0.11.1/S1-hardening.md)):
  `upscale` подтверждён fallback-цепочкой FAL `clarity-upscaler` → Replicate
  `real-esrgan`; `chromakey` скрыт из UI (`UI_IMAGE_TOOL_OPERATIONS`), потому
  что ни один каталог не объявляет модель хромакея. Старые workflow с
  `chromakey` открываются с пометкой «недоступно», без молчаливой подмены
  операции (KI-069).
- **KI-380: OpenAI Images — `applyToolAsync` через `/v1/images/edits`**
  ([отчёт](development/reports/v0.11.1/S2-openai-images.md)):
  провайдер скачивает входное изображение в буфер (лимит 25 МБ, PNG/JPEG/WebP),
  собирает `multipart/form-data` с `image`, `prompt`, `model` и параметрами
  операции и разбирает ответ `url`/`b64_json` тем же `toTaskResult`, что и
  генерацию. Поддержаны `upscale` и `bg_removal`; остальные операции и
  `dall-e-3` отвергаются до платного запроса. Идемпотентность — по
  `idempotencyKey`.

### Changed

- **Релизная подготовка v0.11.1 (S17)** ([отчёт](development/reports/v0.11.1/S17-release.md)):
  `package.json`/`web/package.json` → `0.11.1`; `[Unreleased]` переименован в
  `[0.11.1] — 2026-10-19`, сверху добавлена пустая секция; README/docs README,
  USER_GUIDE, MANUAL_TESTING_GUIDE и RELEASES синхронизированы по метрикам
  (1439 backend / 419 frontend, 513 KI, 0 Open High); сборка web очищена от
  предупреждения JSON-import.

## [0.11.0] — 2026-10-19

**Minor-релиз: DOCX-шаблоны, MCP Adapter, надёжность запусков (Run Lease,
Retry, History), SSRF-защита, Redis Throttler и тёмная тема. 22 типа узлов.**

### Added

- **Redis-хранилище Throttler (v0.11 S15, DESIGN § 3.5.2, KI-420)** ([отчёт](development/reports/v0.11.0/S14-S15-security-infra.md)):
  `RedisThrottlerStorage` (`src/common/throttler/redis-throttler.storage.ts`) —
  `ThrottlerStorage` на отдельном fail-fast соединении (`duplicate()` с
  `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`), атомарный `EVAL`
  Lua-скрипта, ключ `${THROTTLER_KEY_PREFIX}:<throttler>:<tracker>`, fallback на
  `ThrottlerStorageService` при недоступном Redis (warn не чаще раза в минуту),
  `onApplicationShutdown` → `quit()`. `AppModule` собирает
  `ThrottlerModule.forRootAsync`; `THROTTLER_STORAGE=memory` — аварийный и
  тестовый режим.
- **Тёмная тема — семантические токены статусов узлов (v0.11 S16, DESIGN § 2.8/§ 3.6, KI-448)** ([отчёт](development/reports/v0.11.0/S16-dark-theme.md)):
  в `web/src/styles/theme.css` (`@theme` + `.dark`) добавлены
  `--color-node-bg-pending/-running/-completed/-failed/-cancelled/-skipped` и
  `--color-node-border-running/-completed/-failed/-cancelled/-skipped`,
  а также `--color-status-info/success/danger/warning-foreground` и
  `--color-status-warning-bg/-border` для статусного текста и предупреждающих
  плашек. Утилиты `bg-node-bg-*`/`border-node-border-*`/`text-status-*` —
  литеральные классы (Tailwind v4 сканирует исходники, RULES 4.32), но цвет
  берут из переменной, поэтому переключаются вместе с `.dark`.
- **История запусков — API и восстановление после F5 (v0.11 S12+S13, DESIGN § 3.4.2/§ 3.4.3, KI-077)** ([отчёт](development/reports/v0.11.0/S12-S13-history.md)):
  новый `NodeRunSnapshotMapper` (`src/runs/node-run-snapshot.mapper.ts`) — единый
  маппер `node_runs` для SSE-снимка и `GET /runs/:id/nodes` (переподпись
  `stored_url`, `cacheSavingsUsd` по модели узла, ISO-даты), его используют
  `RunsStreamService` и `RunsService`; `RunResponse` получил аддитивное поле
  `error: string | null`. Ручка `GET /runs/:id/nodes` отдаёт массив
  `NodeRunSnapshot` (тот же формат, что в SSE-снимке), чужой запуск → 404,
  `Cache-Control: no-store`. Фронтенд: `fetchRunAsync`/`fetchRunNodesAsync`
  (`web/src/lib/api.ts`), `restoreRunAsync` в `stores/workflow.ts` —
  параллельно восстанавливает статус и карты `nodeStatuses`/`nodeOutputs`/
  `nodeErrors`/`nodeLogs`/`nodeMetrics`; SSE открывается только для
  `pending`/`running`, для финального запуска `?runId=` убирается; 404 сбрасывает
  состояние запуска и показывает toast. Общий маппинг с `applySnapshot`
  вынесен в `mapsFromNodes`.
- **Метрики Agent-узла (v0.11 S11, DESIGN § 3.4.1, KI-433)** ([отчёт](development/reports/v0.11.0/S10-S11-retry-metrics.md)):
  `AgentService` агрегирует кэш-токены шагов (`cacheReadTokens`/`cacheCreationTokens`),
  `AgentRunResult` и `AgentNodeMetrics` (`src/agent/agent.types.ts`) отдают их
  движку; новый `toNodeRunMetrics(step)` — единый маппинг LLM/agent/media/plain
  в колонки `node_runs`, им заполняются `UPDATE` и событие `node_completed`.
  У узла `agent` теперь пишутся `tokens_in`/`tokens_out`/`cost_usd` **и**
  `cache_read_tokens`/`cache_creation_tokens` (до S11 кэш-колонки были `NULL`).
- **Run Lease / Heartbeat (v0.11 S9, DESIGN § 3.3.1, KI-066)** ([отчёт](development/reports/v0.11.0/S9-run-lease.md)):
  новый `RunLeaseService` (`src/runs/run-lease.service.ts`): `startAsync`/`renewAsync`/`stop`,
  продление `workflow_runs.lease_expires_at` через `UPDATE … WHERE status = 'running'`
  (`WORKFLOW_RUN_HEARTBEAT_MS` = 30 с, `WORKFLOW_RUN_LEASE_TTL_MS` = 90 с, `timer.unref()`),
  сбой БД в тике — `warn` без падения запуска, `onApplicationShutdown` гасит все таймеры.
  `ExecutionEngineService` ставит стартовый lease в `markRunRunningAsync`, запускает heartbeat
  после перевода в `running` и гасит его в `finally`. `RunsProcessor` считает запуск зависшим
  по `lease_expires_at` (`leaseExpired`) с fallback на `started_at` для строк без аренды
  (`legacyStale`): легитимно долгий запуск больше не переигрывается параллельно.
- **Docs Sync (v0.11 S17)** ([отчёт](development/reports/v0.11.0/S17-docs-sync.md)):
  README (DOCX-шаблоны, MCP, run lease, `docxtemplater`/`pizzip`), ARCHITECTURE
  (`DocumentsModule`/`McpModule`, режим `template` у `DocumentGenNode`,
  `RunLeaseService` в § 5.2, точки расширения), GETTING_STARTED
  (`WORKFLOW_RUN_HEARTBEAT_MS`, `WORKFLOW_RUN_LEASE_TTL_MS`, `MCP_ENABLED`/`MCP_SERVERS`),
  PROMPT_CURRENT v8.1 (+ архив v8.0), RELEASES (проверка отчётов и ссылок в
  CHANGELOG); в промпте обновлены метрики, Open High и списки KI.
- **MCP Adapter (S6+S7, DESIGN § 3.2):** `src/mcp` — `McpClientService` (connect-mutex, HTTP/SSE, TTL-кэш каталога, reconnect), `McpToolAdapter` (имена `mcp__server__tool`, JSON Schema → Zod, нормализация контента). `AgentService`: preflight MCP до LLM, side-effect retry-guard, правило про недоверенный контент. Зависимость `@modelcontextprotocol/sdk`. Серверы задаются только операторским env-реестром `MCP_SERVERS`, фича выключена по умолчанию (`MCP_ENABLED=false`).
- **MCP API/UI (v0.11 S8, DESIGN § 3.2.6/§ 3.2.7, KI-518)** ([отчёт](development/reports/v0.11.0/S8-mcp-ui.md)):
  ручка `GET /mcp/servers` (`McpController`, JWT) отдаёт `enabled`,
  действующий `maxToolsPerNode` и серверы реестра со статусами
  `ok`/`error`/`disabled` и инструментами (включая аннотации); сбой одного
  сервера изолируется `Promise.allSettled`, URL/заголовки/токены не отдаются,
  при `MCP_ENABLED=false` — `{ enabled: false, servers: [] }` со статусом 200.
  DTO `McpServersResponse`/`McpServerSummary`/`McpToolSummary` описаны
  Zod-схемами и включены в паритет `docs/development/api-contract.json`.
  В `AgentNode` — секция «MCP-инструменты»: серверы с раскрываемыми списками
  инструментов, чекбоксы, бейджи `RO`/`DESTR`/`IDEM`, предупреждение у
  destructive, лимит `maxToolsPerNode` (disabled + подсказка), недоступный
  сервер — disabled с текстом; выбор пишется в `data.mcpTools`, i18n ru/en,
  data-атрибуты `data-agent-mcp-server`/`data-agent-mcp-tool` для smoke.
- **Docs:** Создан DESIGN v0.11.0 (шаблоны DOCX, MCP Adapter, Reliability fixes). Отчёты сессий: [S0-S1](development/reports/v0.11.0/S0-S1-foundation.md), [S2-S3](development/reports/v0.11.0/S2-S3-document-templates.md), [S4-S5](development/reports/v0.11.0/S4-S5-document-templates-engine.md), [S6-S7](development/reports/v0.11.0/S6-S7-mcp-adapter.md), [S8](development/reports/v0.11.0/S8-mcp-ui.md), [S9](development/reports/v0.11.0/S9-run-lease.md), [S10-S11](development/reports/v0.11.0/S10-S11-retry-metrics.md), [S17](development/reports/v0.11.0/S17-docs-sync.md).
- **Docs:** Зарегистрированы KI-478..480.
- **API и метрики (KI-077/450, KI-433, KI-472):** история узлов запуска отдаётся
  ручкой `GET /runs/:id/nodes` — массивом `NodeRunSnapshot`, общей проекцией с
  SSE (`src/runs/node-run-snapshot.mapper.ts`), чтобы UI восстанавливался после
  F5 без SSE; `docs/development/api-contract.json` дополнен `NodeRunSnapshot`
  и аддитивным `error` в `RunResponse` (в v0.10.2 `nodes` отдавался прямо в
  `GET /runs/:id`; в v0.11 S12 вынесен в отдельную ручку — см. Changed).
  Метрики Agent (токены и `cost_usd` цикла) пишутся в
  `node_runs` наравне с LLM-узлами. API-префиксы сведены в единый
  `api-prefixes.json`: из него строятся RegExp SPA-fallback'а backend'а и
  Vite-прокси, дублирование списков устранено.
- **DOCX-шаблоны — API (v0.11 S3, DESIGN § 3.1.5)** ([отчёт](development/reports/v0.11.0/S2-S3-document-templates.md)): новый
  `DocumentTemplateService` (`src/documents/document-template.service.ts`) на
  `docxtemplater` 3.71 + `pizzip` 3.3: компиляция шаблона, список простых
  плейсхолдеров, рендер с `nullGetter` (отсутствующая переменная → пустая
  строка + `missingVariables`) и `resolveTemplateVariables` (объект /
  массив → `{items}` / JSON-строка, sanitize ключей `__proto__`/`constructor`/
  `prototype`). До docxtemplater архив проверяется fail-closed: сигнатура
  `PK`, обязательные `[Content_Types].xml` и `word/document.xml`, запрет
  макросов (`vbaProject.bin`, `macroEnabled`), лимиты распакованного
  размера/записей/коэффициента сжатия, скан XML/rels на `<!DOCTYPE`/
  `<!ENTITY` (XXE). Ошибки — `DocumentTemplateInvalidException` с кодом
  `invalid-zip | invalid-docx | syntax | render`.
- **DOCX-шаблоны — API (v0.11 S3, DESIGN § 3.1.5):** маршруты
  `GET/POST /workflow/:id/document-templates`, `GET …/:templateId/file`,
  `DELETE …/:templateId` (`src/documents/document-templates.controller.ts`).
  Загрузка через `FileInterceptor` (memory storage, лимит 5 МБ, 413 на
  oversize), права `viewer`/`editor` через `workflowAccessFilter` (403 для
  viewer, 404 для чужого workflow), компиляция шаблона до INSERT, хранение
  `sha256`/`bytes`/`placeholders`/`content` в `document_templates`,
  `DocumentTemplateSummary` в `docs/development/api-contract.json`; лимиты —
  из `DOCUMENT_TEMPLATE_*` env.
- **DOCX-шаблоны — режим `template` (v0.11 S4, DESIGN § 3.1.7)** ([отчёт](development/reports/v0.11.0/S4-S5-document-templates-engine.md)):
  исполнитель `document_gen` принимает `DocumentGenerationDeps` (`documentService`,
  `mediaStorage`, `templateLoader`, `templateRenderer`, `workflowId`) и умеет
  `mode='template'`: загрузка шаблона workflow (`loadAsync`, чужой шаблон →
  non-retryable `DocumentTemplateNotFoundException`), подстановка переменных
  (`resolveTemplateVariables`), рендер `docxtemplater`, лимит 10 МБ и
  `saveGeneratedAsync`. В `outputs` добавлены `mode`/`templateId`/
  `templateName`/`missingVariables`, в `logs` — warning о незаполненных
  плейсхолдерах; inline-режим не изменился. Движок передаёт `workflowId` только
  для template-режима (без лишнего SELECT).
- **DOCX-шаблоны — UI узла `document_gen` (v0.11 S5, DESIGN § 3.1.8)** ([отчёт](development/reports/v0.11.0/S4-S5-document-templates-engine.md)):
  селект режима «Текст/Шаблон», список шаблонов workflow и загрузка `.docx`
  (`FormData`, KI-479), чипы плейсхолдеров, JSON-переменные (только без входящей
  связи), удаление шаблона (disabled для `viewer`), жёлтая подсказка
  `Не заполнено: …` по `missingVariables` после Run; i18n-ключи в `ru.json`/
  `en.json`, data-атрибуты для smoke.

### Changed

- **SSRF-флаги и лимит тела узла `http` (v0.11 S14, DESIGN § 3.5.1, KI-434/435/478).**
  `ALLOW_PRIVATE_IPS` удалён из `EnvSchema` и `.env.example`: он отключал
  защиту сразу у узла `http` и у инструмента агента, что противоречит
  DESIGN § 3.5.1. Приватные сети для узла `http` разрешает только
  `HTTP_NODE_ALLOW_PRIVATE_NETWORKS=true`; `http_request` не отключается.
- **Throttler по умолчанию на Redis (v0.11 S15, KI-420).** `AppModule` собирает
  `ThrottlerModule.forRootAsync` с `RedisThrottlerStorage`: несколько
  backend-инстансов делят один лимит. `THROTTLER_STORAGE=memory` возвращает
  прежнее поведение (счётчики по инстансу).
- **Статусы узлов и медиа-плейсхолдеры переведены на токены темы (v0.11 S16, DESIGN § 3.6, KI-448)** ([отчёт](development/reports/v0.11.0/S16-dark-theme.md)):
  `BaseNode` (`STATUS_BORDER`/`STATUS_BACKGROUND`) больше не использует
  `bg-blue-50`/`bg-green-50`/`bg-red-50`/`border-*-500`; `pending`…`skipped`
  получают токены темы, кнопка удаления — `hover:bg-node-bg-failed
  hover:text-foreground`. Тот же аудит: кнопка скачивания DOCX
  (`DocumentGenNode`) — `bg-node-bg-completed`/`border-node-border-completed`/
  `text-foreground`; плейсхолдеры `running`/`failed` в `ImageGen`, `ImageTool`,
  `VideoGen`, `AudioGen`, `MusicGen` — `bg-node-bg-running`/`bg-node-bg-failed`
  + `text-foreground`; плейсхолдер невалидной ссылки и плашка отсутствующих
  переменных шаблона — `--color-status-warning-*`; статусный текст
  `WriteFileNode`, `WebSearchNode`, `SubWorkflowNode`, `ImageToolNode` и
  `RunResultPanel` — `text-status-*-foreground` (иначе `text-green-700`/
  `text-red-700` на тёмном фоне ниже AA). Кнопка удаления `CommentNode` — та же
  пара ховера, что в `BaseNode`.
- **`GET /runs/:id` больше не отдаёт `nodes` (v0.11 S12, DESIGN § 3.4.2, KI-077).**
  Поле было добавлено в v0.10.2 (KI-450) и дублировало SSE-снимок; теперь
  история узлов приходит из `GET /runs/:id/nodes` — массива `NodeRunSnapshot`
  в том же формате, что SSE. `docs/development/api-contract.json` обновлён:
  у `RunResponse` `nodes` заменён на `error` (`string | null`), добавлен
  `NodeRunSnapshot`; паритет-спеки backend и web синхронизированы.
  Клиенты, читавшие `run.nodes`, должны использовать новую ручку.

### Fixed

- **KI-292** — `nest build` копирует JSON-шаблоны в `dist/templates`: в
  `nest-cli.json` объявлены `assets` (`templates/**`), Docker-обход
  `COPY --from=builder /app/src/templates` удалён, CI проверяет
  `test -f dist/templates/text-llm.json`; `TemplateLoaderService` считает
  `dist/templates` основным путём, фолбэк на `<repo>/src/templates` остаётся для
  `tsx`/dev.
- **KI-448** — тёмная тема: светлые фоны статусных узлов заменены токенами
  темы; в `.dark` карточки получают тёмные заливки и светлые рамки, контраст
  текста статусов поднят выше AA (проверено CDP-смоуком, 14/14).
- **Повтор узлов при временных ошибках media/LLM (v0.11 S10, DESIGN § 3.3.2, KI-104)** ([отчёт](development/reports/v0.11.0/S10-S11-retry-metrics.md)):
  структурный `RetryableProviderError` + `isRetryableProviderError`
  (`src/common/errors/retryable-provider.error.ts`); движок проверяет
  `isRetryableProviderError(error) || isRetryableNodeError(error)`, поэтому
  429/5xx/таймаут media-провайдера теперь действительно повторяются (раньше
  условие знало только `LlmProviderException`, и media сразу уходил в `failed`).
  Задержка — `min(NODE_RETRY_MAX_DELAY_MS, max(base·2^(n−1), retryAfterMs) +
  jitter)`, настройки читаются из `ConfigService` (`NODE_RETRY_*`, Zod-схема S1),
  `Retry-After` переносится в `LlmProviderException`/`MediaProviderException`.
- **Multipart-загрузка из UI (KI-479):** `sendAsync` (`web/src/lib/api.ts`)
  больше не ставит `Content-Type: application/json`, если тело — `FormData`,
  и не перезаписывает явно заданный заголовок: браузер сам добавляет
  `multipart/form-data; boundary=…`. Повтор запроса после refresh сохраняет
  тело (boundary генерируется заново). Закрыто тестом
  `web/src/lib/api.spec.ts`.
- **Media и S3 (KI-412, 413, 415, 451, 464):** HMAC-подписи ссылок локального
  хранилища (`?expires=&sign=`, env `MEDIA_URL_SIGNING_SECRET`,
  `MEDIA_URL_TTL_SECONDS`); переподпись по `storage_key`
  (`refreshStoredUrlByKeyAsync`), media-узлы пишут ключ в `node_runs`, для
  старых строк сохранён fallback по URL; ленивая загрузка S3 SDK
  (`src/media/s3-sdk.ts`) с откатом на `local`, если пакет или конфигурация
  недоступны; TTL-очистка media и workspace (`WORKSPACE_TTL_DAYS`) через
  BullMQ cron.

### Security

- **`SafeHttpClient` — SSRF, DNS rebinding и redirect guard (v0.11 S14, DESIGN § 3.5.1, KI-434/435/478)** ([отчёт](development/reports/v0.11.0/S14-S15-security-infra.md)):
  новый `src/common/http/safe-http.client.ts` на `undici@8`: **один**
  `dns.lookup` с проверкой всех адресов, денлист приватных/локальных/metadata
  имён и IP (включая decimal/hex формы), pinning выбранного IP через
  `Agent({ connect: { lookup } })` (TLS SNI и `Host` остаются исходными),
  `redirect: 'manual'` с перепроверкой каждого `Location` относительно текущего
  URL (лимит 5 хопов), `AbortSignal.any([signal, timeout])`, потоковый лимит
  тела 1 МБ. Узел `http` и `http_request` агента переведены на клиент;
  `http_request` **всегда** блокирует приватные адреса, узлу `http` приватные
  сети разрешает только `HTTP_NODE_ALLOW_PRIVATE_NETWORKS=true`
  (metadata-алиасы остаются в блоке и тогда). Прежние
  `fetchWithSsrfGuardAsync`/`assertPublicHttpUrlAsync` удалены — SSRF-путь один.

### Docs

- **Релизная подготовка v0.11.0 (S17)** ([отчёт](development/reports/v0.11.0/S17-release.md)):
  `package.json`/`web/package.json` → `0.11.0`; `[Unreleased]` переименован в
  `[0.11.0] — 2026-10-19`, сверху добавлена пустая секция `[Unreleased]`;
  `USER_GUIDE.md` (v0.11.0: DOCX-шаблоны, MCP, тёмная тема, heartbeat,
  восстановление после F5) и `MANUAL_TESTING_GUIDE.md` (v0.11.0: +8 кейсов
  блока V0.11 — шаблоны, MCP, heartbeat, история; всего 137) актуализированы по
  RULES § 2.16; `README.md`/`docs/README.md`/`RELEASES.md` — метрики и
  ожидаемые числа; `KNOWN_ISSUES.md` — пересчёт сводки grep'ом (507 записей),
  закрытие KI-420/KI-435, актуализация KI-077, новые KI-518 (MCP API/UI, S8)
  и KI-519 (ожидаемые метрики в RELEASES).
- **Тёмная тема (v0.11 S16):** отчёт [S16-dark-theme.md](development/reports/v0.11.0/S16-dark-theme.md);
  KI-448 переведён в `Fixed`, зарегистрированы KI-509 (бейджи TopBar/LLMNode —
  светлые плашки), KI-510 (Toast/модалки/логин — светлые литералы), KI-511
  (`dark:` не привязан к классу `.dark`) и KI-512 (рамка `pending`-узла в
  тёмной теме, 1.72:1). Сводка реестра пересчитана grep'ом: 500 записей.
- **Аудит реестра KI (2026-10-19):** закрыто 12 устаревших KI из аудита —
  9 переведены в `Fixed` (KI-118, 361, 363, 366, 371, 373, 382, 456, 238)
  и 3 — в `Won't Fix` (KI-233, 457, 401). Дополнительно KI-196 разделён:
  пять операций `image_tool` закрыты, остаток 3D/Motion вынесен в KI-475.
  Добавлены KI-475..477; KI-450 помечен дублем KI-077; KI-292 понижен до Low.
  Сводка реестра на момент аудита: 248 Open, 205 Fixed, 4 Won't Fix, всего
  465 записей; после регистрации KI-478..480 — 251 Open, всего 468.
- **DOCX-шаблоны (v0.11 S2+S3):** KI-479 переведён в `Fixed`; зарегистрированы
  KI-481 (порядок `asText()` и проверки `uncompressedSize` в псевдокоде
  DESIGN § 3.1.3 делает fail-closed неработоспособным — исправлено в коде
  порядком проверок и примечанием в DESIGN) и KI-482 (docxtemplater по
  умолчанию печатает контекст шаблона в stdout — отключено `errorLogging`,
  RULES 5.9). `api-contract.json` дополнен `DocumentTemplateSummary`.

---

## [0.10.1] — 2026-10-19

**Patch-релиз после v0.10.0. Синхронизация и аудит.**

### Fixed
- Синхронизированы версии package.json и web/package.json (0.10.1).
- Проведён полный аудит KNOWN_ISSUES.md: закрыты устаревшие KI, починен счётчик (Open сократилось до 251).
- Зарегистрированы новые KI (KI-478..480).
- Создан DESIGN v0.11.

## [0.10.0] — 2026-10-19

**Minor-релиз: Web Search, Document Generation, Safe Filesystem, Docker/GHCR и
отдача SPA из NestJS. 18 → 22 типа узлов.**

### Added

- **Web Search (`web_search`, v0.10 S1–S2):** узел поиска через Tavily.
  Вход `prompt` (запрос от Text/LLM), выход `text` — нумерованный список
  источников для следующего LLM. `maxResults` 1–10 (default 5), в выходах
  `results[{title,url,snippet}]` без `rawContent` (KI-459). Env:
  `WEB_SEARCH_PROVIDER=tavily`, `TAVILY_API_KEY`; без ключа приложение
  стартует, узел падает понятной ошибкой. 429/5xx/timeout — retryable.
  Контракт портов `search-output → text` добавлен в `node-ports.ts` (KI-460).
- **Document Generation (`document_gen`, v0.10 S3+S6):** Markdown/JSON → DOCX
  через библиотеку `docx`, сохранение в MediaStorage (local/S3) и кнопка
  «Скачать DOCX». Markdown: H1–H6 (в DOCX H1–H3), абзацы, маркированные и
  нумерованные списки, fenced code, GFM-таблицы, bold/italic/inline-code/ссылки.
  JSON: `{ title?, blocks: [{ type: 'heading'|'paragraph'|'list', text, level?, ordered? }] }`.
  Лимиты: 1 000 000 символов / 1 МБ входа, 10 МБ результата. PDF не
  реализован (KI-463).
- **Safe Filesystem (`read_file`, `write_file`, v0.10 S7–S8):** работа с
  текстовыми файлами в `./data/workspace/{workflowId}/`. `read_file` —
  source-only (нет входного порта), путь только из `data.path`; `write_file`
  принимает текст по связи, путь — из `data.path`. Относительные пути,
  защита от `..`/абсолютных путей/NUL, лимит 5 МБ, автосоздание каталогов,
  UTF-8. Разбор JSON/CSV и `overwrite=false` — v0.11.
- **Docker-инфраструктура:** multi-stage [Dockerfile](../Dockerfile)
  (`node:22-alpine`, pnpm 12.11.2, `pnpm prune --prod`), `.dockerignore`,
  `docker-entrypoint.sh`, `docker-compose.prod.yml` (app + pgvector/pg17 +
  redis 7), non-root пользователь `node`, healthcheck, volume для
  `/app/data`.
- **ServeStatic:** NestJS отдаёт собранный React из `web/dist` тем же
  процессом, что и API. SPA-fallback для `/` и `/workflow/share/*` через
  middleware до роутера; API-префиксы и `/media/file/...` не перехватываются
  (KI-467, KI-468).
- **GitHub Container Registry:** workflow
  `.github/workflows/docker-publish.yml` — push в `main`, теги `v*`,
  `workflow_dispatch`; версия из `package.json`; теги `latest`,
  `sha-<short>`, `vX.Y.Z`; кэш BuildKit.
- **Env:** `TAVILY_API_KEY`, `WEB_SEARCH_PROVIDER`, `PGVECTOR_ENABLED`
  (KI-455); `WEB_SEARCH_*`/`WORKSPACE_*` из DESIGN не добавлялись — v0.10
  использует фиксированный endpoint Tavily и `./data/workspace`.
- **Тесты:** backend — 1123 passed (17 skipped), frontend — 375 passed;
  22 типа узлов, 460 записей KI.

### Changed

- **UI — логотип:** SVG/PNG-логотип (светлый и тёмный варианты) в шапке,
  на экране входа и favicon (`web/public/logo*.svg`, `logo*.png`).
- **UI — копирайт и версия:** строка
  `© 2026 RuChating (iilmchat) · vX.Y.Z` в шапке; версия берётся из
  `web/package.json` (`APP_VERSION`).
- **Архитектура — `storage_key`:** миграция `0011_lonely_riptide.sql`
  добавляет nullable `node_runs.storage_key`; сгенерированные документы и
  media сохраняют ключ объекта. Переподпись S3 пока идёт по URL (KI-464).
- **Node registry:** 18 → 22 типа; `web_search`/`read_file`/`write_file` —
  категория «Инструменты», `document_gen` — «Вывод»; `read_file` —
  source-only (KI-456).
- **Vite:** явный `base: '/'` — Docker-образ отдаёт SPA с корня, а не с
  `/api/`.
- **Docs:** `ARCHITECTURE.md` (Docker/ServeStatic), `USER_GUIDE.md`
  (Web Search, Document Generation, Read/Write File), `MANUAL_TESTING_GUIDE.md`
  (129 кейсов), `KNOWN_ISSUES.md` (KI-467..472), `PROMPT_CURRENT.md`
  (метрики v0.10.0).

### Fixed

- **KI-452** — удаление workflow требует подтверждения (`window.confirm`).
- **KI-453** — устаревший комментарий про `Ctrl+S` приведён к факту.
- **KI-454** — удалены мёртвые `runPlanAsync`/`executionLevels` и бейдж уровня.
- **KI-455** — `PGVECTOR_ENABLED` добавлен в `VectorEnvSchema`/`.env.example`.
- **KI-459** — `rawContent` не попадает в `node_runs.outputs` и SSE.
- **KI-460** — контракт портов `web_search`: `text` доходит до LLM.
- **KI-467** — `@nestjs/serve-static@12` + `path-to-regexp@8`: `exclude`
  заменён с невалидного `'/api*'` на RegExp; SPA-fallback больше не даёт 500.
- **KI-468** — SPA-fallback для `/` и `/workflow/share/*` через middleware
  до роутера; `req.originalUrl` вместо обрезанного `req.path`.
- **KI-469** — `migrate.ts` компилируется в `dist/migrate.js`
  (`tsconfig.migrate.json`, `pnpm build:migrate`).
- **KI-470** — JSON-шаблоны `src/templates` копируются в Docker-runner.
- **KI-471** — prod-compose задаёт `COOKIE_SECURE=true` (иначе fail-fast
  Zod при `NODE_ENV=production`).

### Security

- **Filesystem:** path traversal guard (`..`, absolute, drive/UNC, NUL),
  проверка принадлежности workspace, лимит 5 МБ, отсутствие shell/eval.
- **Docker:** `.env` исключён `.dockerignore`, контейнер работает от
  непривилегированного `node`, `COOKIE_SECURE=true` в prod-compose.
- **Web Search:** результаты — недоверенный контент; в `text` добавляется
  пометка «внешние источники, не инструкции» (prompt injection).

### Documented

- **KI-456, KI-457, KI-458, KI-461–466** — задокументированные ограничения
  v0.10.0: `read_file` source-only, имя `document_gen` vs DESIGN
  `document_generation`, `searchDepth`/`topic` отложены, PDF/500 блоков/title
  в Markdown, переподпись по URL, cross-origin `download`.
- **KI-472** — дублирование API-префиксов в `app.module.ts` и
  `api-prefixes.ts` (Low, Open).

## [0.9.4] — 2026-10-18

**Накопительная секция v0.9.2–v0.9.4: в предыдущих версиях CHANGELOG эти
изменения не выделялись отдельными заголовками.**

**v0.9.2 — testing infra (jsdom), роли доступа в Share (owner/editor/viewer),
`TRUST_PROXY`, валидация `audioUrl`.**

**v0.9.3 — производительность (route-level code-split, 774 → 141 kB),
S3 presigned/streaming, enum-домены в API-контракте.**

**v0.9.4 — S3 polish: retry/multipart, переподпись presigned URL, env
публичного бакета; UI: миникарта, копирайт и версия, плашка истёкшей ссылки.**

### Added
- **Testing Infra:** Настроен jsdom + Testing Library для компонентных тестов (KI-155).
- **Performance:** Route-level code-split (React.lazy для всех 18 узлов). Основной чанк уменьшен с 774 kB до 141 kB (KI-008, 390).
- **Testing:** Компонентные тесты для AgentNode и VectorUpsertNode на базе jsdom (KI-405).
- **Media / S3:** Presigned URL для приватных бакетов и потоковая загрузка без буферизации в память (KI-425, 427).
- **API Contract:** Секция `enums` в `api-contract.json` для проверки доменов значений (KI-440).
- **S3:** Presigned URL для приватных бакетов и переподпись в SSE при истечении (KI-443, 444).
- **S3:** Потоковая загрузка с ретраями и multipart через `@aws-sdk/lib-storage` (KI-442).
- **UI:** Копирайт и версия в шапке (KI-446).
- **Docs:** Руководство пользователя — `docs/user_guide/USER_GUIDE.md` (быстрый старт, обзор интерфейса, 18 узлов с бизнес-кейсами, Share/роли, бюджет, ограничения v0.9.1).
- **Docs:** Гайд по ручному тестированию — `docs/qa/MANUAL_TESTING_GUIDE.md` (116 кейсов: Auth, Canvas, Engine, LLM/Media, Vector/Agent, Share/Access, S3/Storage, Edge Cases, регресс контрактов, чек-лист приёмки).

### Fixed
- **Share:** `GET /workflow` возвращает collaborative workflows с `accessRole` (owner/editor/viewer). Список участников включает владельца первой строкой (KI-397, 398, 399).
- **Share:** Роль `owner` больше не проходит в инвайт: `InviteCollaboratorPayloadSchema` ограничен `viewer`/`editor` (как backend), JSDoc зеркала ролей синхронизирован (KI-437).
- **Security:** `TRUST_PROXY` для корректного Rate Limiting за nginx (KI-419).
- **UI:** Валидация `audioUrl` в `ImageToolNode` (KI-424).
- **Docs:** Обновлены устаревшие комментарии в спеках web (KI-439).
- **UI:** Миникарта теперь окрашивает узлы по статусу и имеет контур вьюпорта (KI-445).
- **UI:** Плашка «Ссылка истекла» для медиа без `storedUrl` (KI-444).

### Documented
- **KI-438..441** — новые KI v0.9.2.
- **KI-442..447** — новые KI (S3 retry, presigned refresh, minimap, copyright, route-lazy).
- **KI-448..451** — новые KI v0.9.4.

## [0.9.1] — 2026-10-18

**Patch-релиз после v0.9.0. Rate limiting, стабильный INSTANCE_ID, медиа-фиксы.**

### Added
- **HTTP Rate Limiting (KI-206, KI-234):** `@nestjs/throttler` (5/мин на login/share, 300/мин общий).
- **UI lipsync (KI-369):** Поле `audioUrl` в `ImageToolNode`.
- **Медиа-дефолты (KI-367):** Дефолтные модели для upscale (FAL/Replicate) и trim (@VideoEdit).
- **R7.8-fix:** Реализован `S3MediaStorage` (PutObjectCommand, TTL) и `MediaCleanupService` (BullMQ cron, KI-412, KI-413).
- **Agent Infrastructure:** Учет стоимости (CostBudgetService), SSRF-защита, OTel span `agent.step` (KI-407, 409, 416).
- **LLM Providers:** Prompt caching для Anthropic, исправлен RouterAI Embeddings (KI-406, 414).

### Fixed
- **KI-391:** Стабильный `INSTANCE_ID` (`hostname:PORT`) для BullMQ.
- **KI-367:** Частично закрыт (остаток по chromakey — KI-418).
- **KI-263, 330, 331:** UI-фиксы Share-страницы и вставки узлов.
- **KI-378:** Отображение `data:image/...` в UI.

### Documented
- **KI-418..424** — новые KI v0.9.1 (см. KNOWN_ISSUES.md).
- **KI-425..430** — новые KI v0.9.1 (см. KNOWN_ISSUES.md).
- **KI-431..436** — новые KI v0.9.1.

## [0.9.0] — 2026-10-18

**Minor-релиз v0.9.0 после v0.8.5. Медиа-инструменты и бюджет, генерация
video/audio/music, прямые image-провайдеры, Vector DB / Memory, Agent,
Share-участники, observability, sandbox и media-storage.**

Восемь подшагов R7.1..R7.8.

### Added

- **R7.1:** `image_tool` (upscale/bg-removal/chromakey/trim/lipsync) +
  Cost budget (KI-048).
- **R7.2:** `video_generation`, `audio_generation`, `music_generation`
  (KI-361).
- **R7.3:** Прямые image-провайдеры: Replicate, FAL, OpenAI Images
  (KI-363).
- **R7.4a:** Vector DB / Memory — 4 узла (pgvector, KI-128).
- **R7.4b:** Agent node (LLM loop + 7 tools, KI-128).
- **R7.6:** Share-участники по ID (workflow_collaborators, роли
  viewer/editor, KI-197).
- **R7.7:** Reasoning cache tokens (KI-055, KI-150), OpenTelemetry traces
  (KI-365), per-provider semaphore (KI-067, KI-206, KI-234).
- **R7.8:** Media storage (local + S3 stub, TTL, KI-362).

### Fixed

- **R7.2b:** Изоляция BullMQ (`BULLMQ_PREFIX`, `REDIS_QUEUE_DB`,
  `instanceId` — KI-387), честный pricing каталога (KI-384).
- **R7.5:** QuickJS-WASM sandbox для condition-узла (KI-364).
- **R7.4b:** Устаревшая `nodeErrors` после job-retry (KI-410).
- **R7.7:** Прайс по last segment для RouterAI-префиксов (KI-417).

### Documented

- **KI-366..417** — все новые KI v0.9 (см. KNOWN_ISSUES.md).

## [0.8.5] — 2026-10-16

**Patch после v0.8.4. Единый источник статусов + паритет-гейт REST-контракта.**

Два подшага.

### Changed

- **Backend — единый источник статусов (KI-353):**
  `run-stream-message.dto.ts` импортирует `NODE_RUN_STATUSES` /
  `WORKFLOW_RUN_STATUSES` из `db/schema.ts`; удалены `@deprecated`-псевдоним
  `RUN_STATUSES` (0 потребителей), локальный вывод списка и дублирующий
  `type NodeRunStatus`. Добавлен `TERMINAL_WORKFLOW_RUN_STATUSES`
  (`['completed','failed'] as const satisfies readonly RunStatus[]`) —
  используется в `run-event.dto.ts`. Миграция не нужна
  (`pnpm db:generate` → No schema changes).

### Added

- **API-паритет-гейт REST-контракта (KI-352):**
  `docs/development/api-contract.json` — source of truth для 4 REST-ответов
  (RunResponse, ShareTokenDto, SharedWorkflow, ExportWorkflowDto); два
  паритет-спека (backend + web); паттерн — из KI-348 (`sse-contract.json`).

### Fixed

- **KI-352** — паритет-гейт REST-контракта (`a889991`).
- **KI-353** — единый источник статусов, удаление `RUN_STATUSES` (`0e5d027`).

### Documented

- **KI-356** — workflow без backend-DTO (Medium).
- **KI-357** — REST-зеркала вне гейта (Medium).
- **KI-358** — REST-ответы без Zod (Low).
- **KI-359** — inline-union'ы финальных статусов (Low).

## [0.8.4] — 2026-10-16

**Patch после v0.8.3. Skip-статус в схеме, skip-семантика подграфов,
`run.error` в SSE-снимке, паритет-гейт backend ↔ web.**

Два подшага после v0.8.3.

### Added

- **Backend — skip в схеме (KI-336):** `WORKFLOW_RUN_STATUSES` (без
  skipped) + `NODE_RUN_STATUSES = [...WORKFLOW_RUN_STATUSES, 'skipped']`;
  типы `RunStatus` / `NodeRunStatus`; `node_runs.status` →
  `$type<NodeRunStatus>()`. Миграция не нужна (колонка text без CHECK).
  `RUN_STATUSES` — `@deprecated`-псевдоним (0 потребителей, удаление
  в v0.8.5).
- **Backend — skip-семантика подграфов (KI-337):** общий хелпер
  `skipBlockedNodesAsync` используется и корневым `executeAsync`, и
  `executeSubWorkflowGraphAsync`; подграф доигрывает независимые ветки
  (симметрия с KI-287/RULES 4.16); `node_runs` и `node_skipped` — с
  префиксом `sub_<nodeId>__`.
- **Backend + web — `run.error` в SSE-снимке (KI-347):**
  `RunSnapshotSchema.error: z.string().nullable()`;
  `runs.service.getRunRowAsync` (owner-check переиспользован);
  `applySnapshot` пишет `runError`.
- **Паритет-гейт backend ↔ web SSE (KI-348):**
  `docs/development/sse-contract.json` — source of truth;
  `src/runs/dto/sse-contract.spec.ts` + `web/src/types/run-stream-contract.spec.ts`
  падают при расхождении. Двойные негативные тесты прошли.

### Fixed

- **KI-336** — `skipped` в схеме, тип колонки `NodeRunStatus` (`ac665b1`).
- **KI-337** — skip-семантика подграфов (`ac665b1`).
- **KI-347** — `run.error` в SSE-снимке (`87455f2`).
- **KI-348** — паритет-гейт backend DTO ↔ web SSE-зеркало (`87455f2`).

### Documented

- **KI-352** — нет паритет-гейта для REST-зеркала `web/src/lib/api.ts`
  (Medium).
- **KI-353** — три источника правды по статусам узла (Medium).
- **KI-354** — дублирование обхода уровней в engine (Low).
- **KI-355** — обречённый подграф доигрывает независимые ветки (Low,
  продуктовое решение).

## [0.8.3] — 2026-10-16

**Patch-серия после v0.8.2. Три параллельных подшага + SSE-зеркало + chunk-fix.**

### Added

- **Frontend — fit readability (KI-314, 328):**
  `FIT_VIEW_OPTIONS.minZoom` 0.02 → 0.005 + новый
  `FIT_SELECTION_OPTIONS = { padding 0.3, maxZoom 1, minZoom 0.1 }`;
  `Shift+F` и кнопка «Вписать выделение».
- **Frontend — кэш списка workflow (KI-302):**
  `web/src/lib/workflow-list-cache.ts` (TTL 5 с + revision + inflightSeq);
  инвалидация в save/import/template/delete; подписка через
  `useSyncExternalStore`.
- **Frontend — SSE-зеркало node_skipped (KI-NEW-B / остаток KI-288):**
  `NODE_RUN_STATUSES = [...RunStatusSchema.options, 'skipped']`;
  `NodeRunStatusSchema` (узел) ≠ `RunStatusSchema` (запуск); вариант
  `node_skipped { runId, nodeId, nodeType, reason, skippedAt }`;
  статус skipped в BaseNode (серый пунктир) и RunResultPanel.
- **Backend — skip-статус для потомков упавших (KI-288, 290):**
  `failedIds`/`skippedIds`, `markNodeSkippedAsync`, `node_skipped` в
  RunEventSchema; предшественники из `executionMap.dependents`.
- **Backend — `http.failOnHttpError` (KI-289):**
  `HttpNodeData.failOnHttpError?: boolean`; при true и status ≥ 400 — failed.
- **Backend — type-aware `handleIdToOutputPort` (KI-301):**
  вторым аргументом `sourceNodeType?`.
- **Infra — type-check spec'ов (KI-317):**
  `tsconfig.spec.json`, `"typecheck": "tsc -p tsconfig.spec.json --noEmit"`,
  шаг `Typecheck` в CI (23 ошибки починены — только в `*.spec.ts`).
- **Infra — `test:parity` (KI-318):**
  `node --env-file=.env node_modules/vitest/vitest.mjs run
  src/db/schema-parity.spec.ts`.

### Fixed

- **KI-288** — skip-статус для потомков упавших (`aacae26`).
- **KI-289** — `http.failOnHttpError` (`aacae26`).
- **KI-290** — fallback-выходы потомков упавших не в outputs (`aacae26`).
- **KI-301** — type-aware `handleIdToOutputPort` (`aacae26`).
- **KI-302** — инвалидация кэша workflow в save (`c6edf91` + `df4f3f0`).
- **KI-314** — `minZoom: 0.005` (`c6edf91`).
- **KI-317** — `typecheck` в CI (`ca21f30`).
- **KI-318** — `test:parity` (`ca21f30`).
- **KI-319** — RULES § 3.19 (`ca21f30`).
- **KI-326** — Vite host `127.0.0.1` (`c6edf91`).
- **KI-328** — fit выделения (`c6edf91`).
- **KI-329** — share wheel/pan (`c6edf91`).
- **KI-334** — `chunkSizeWarningLimit: 710` (`952d8b6`).
- **KI-NEW-B** — фронт-SSE-зеркало `node_skipped` (`df4f3f0`).

### Documented

- **KI-330..351** — 22 новых: share UX (330/331), TTL (332), web lint
  (333), формула (335), RUN_STATUSES/skipped (336), подграфы/condition
  (337/338), retryable http (340), null vs {} (341), thenable-двойник
  (342), e2e-спек (343), test:parity enforcement (344), env-file (345),
  drizzle typecheck (346), run.error в снимке (347), паритет-гейт
  SSE-зеркало (348), TextNode target (349), мягкое зеркало (350),
  401-шум (351).

## [0.8.2] — 2026-10-16

**Patch после v0.8.1. CI-гейт схемы + инкремент version + единые fit-опции.**

Три параллельных подшага после v0.8.1.

### Added
- **Общий модуль fit-опций (KI-306/314/315/316):**
  - `web/src/lib/fit-view-options.ts` — `FIT_VIEW_OPTIONS`
    (`padding: 0.2`, `maxZoom: 1`, `minZoom: 0.02`) — единый источник
    для 5 точек вызова (авто-fit / кнопка Fit / хоткей F в Canvas +
    `fitViewOptions` на публичной share-странице).
- **CI-гейт паритета схемы (KI-298):**
  - `src/db/schema-parity.spec.ts` (new) — сверка
    `information_schema.columns` ↔ Drizzle-схема по всем `pgTable`;
    человекочитаемый отчёт о дрейфе; `describe.skipIf` без `DATABASE_URL`.
  - `.github/workflows/ci.yml` — шаг `Apply migrations` перед `pnpm test`.

### Fixed
- **KI-298** — CI-гейт паритета Drizzle-схемы и Postgres (`df2ea46`).
- **KI-300** — инкремент `workflows.version` при изменении
  `nodes`/`edges` (`8163b73`).
- **KI-315** — публичная share-страница получает `fitViewOptions`:
  CDP-замер zoom 0.154905, оба узла в кадре (`a32023f`).
- **KI-316** — асимметрия fit-операций: хоткей F = кнопка Fit
  (CDP 1.0 = 1.0; до фикса 1.82875) (`a32023f`).
- **KI-314** — `minZoom: 0.02` умещает разброс только до 23 050 px
  (Low, Open — фикс отложен, читаемость в KI-328).

### Documented
- **KI-317** — spec-файлы не проходят type-check ни на одном шаге
  (26 ошибок на HEAD).
- **KI-318** — Vitest не читает `.env` → гейт KI-298 локально silently
  skipped.
- **KI-319** — CI: шаг `Apply migrations` стал обязательным.
- **KI-320** — паритет-гейт требует ручного маппинга типов колонок.
- **KI-321** — гейт не сверяет length/order/constraints.
- **KI-322** — подграф вне топ-50 `GET /workflow` → warning недостижим.
- **KI-323** — TOCTOU: два конкурентных PATCH → `version +2`.
- **KI-324** — frontend hash vs backend deep-equal (`type`).
- **KI-325** — `updatedAt` меняется на идемпотентном PATCH.
- **KI-326** — Vite dev слушает только `[::1]:5173`.
- **KI-327** — `AUTH_DISABLED=true` не обходит `POST /auth/refresh`.
- **KI-328** — fit по bbox даёт микроскопические узлы (4–6 px при
  разбросе 21 888 px).
- **KI-329** — share `pointer-events-none` блокирует zoom/pan.

## [0.8.1] — 2026-10-16

**Patch-релиз после v0.8.0. Структурный фикс Vite-прокси.**

### Added
- **Единый реестр API-префиксов (KI-299/072/120):**
  - `web/src/lib/api-prefixes.ts` — `API_PREFIXES`
    (workflow/engine/llm/media/auth/templates/runs/nodes; флаги
    `sse` и `htmlFallback`).
  - `web/vite.config.ts` — `server.proxy` генерируется из реестра.
  - Frontend spec: все `fetch`-литералы ∈ реестр.
  - Backend spec: все `@Controller` ⊆ реестр; `stripComments()`
    против ложных срабатываний на комментариях.
  - `web/tsconfig.node.json`: `allowImportingTsExtensions: true`
    (Vite 8 configLoader: 'native').
  - Tests: backend 514 → 520 (+6), frontend 159 → 166 (+7).
  - Smoke: 22/22 PASS.

### Fixed
- **KI-306** — `fitView` для графов с большим разбросом координат:
  `FIT_VIEW_OPTIONS.minZoom: 0.02` в `useEffect`, хоткее F,
  `<ReactFlow fitViewOptions>`, `<Controls fitViewOptions>`
  (`5fc4f34`).
- **KI-307** — `autoPanOnNodeDrag` — остаётся by design (Low).

### Documented
- **KI-309** — `minZoom: 0.02` умещает разброс только до 23 050 px.
- **KI-310** — публичная share-страница без fitViewOptions.
- **KI-311** — асимметрия Fit (1.0) vs хоткей F (1.53).

## [0.8.0] — 2026-10-16

**v0.8.0 — фичи для продукта (DESIGN v0.8 § 1–13).**

7 подшагов R6.1..R6.7: Auth, Share, LLM upgrade, Canvas UX,
Node types, Export/Import/Templates, Sub-workflows.
Закрывает 16 KI v0.8 (KI-106, 108, 109, 183, 185–195, 197) + KI-200.

Всего с v0.7.2: 294 KI в реестре; Fixed 111; backend 514/514,
frontend 159/159.

### Added
- **Auth backend (R6.1a, KI-201):**
  - Миграция 0004: `users` (uuid), системный пользователь
    `00000000-0000-0000-0000-000000000001`
    (`system@workflow-builder.local`), `workflows.user_id`
    **text → uuid** с backfill (65 строк), `share_token` (задел R6.2).
  - `AuthService` — register / login / me, scrypt (node:crypto),
    `JwtService.signAsync`.
  - `JwtAuthGuard` (кастомный, `@nestjs/jwt`) + `@CurrentUser`.
  - `AuthController`: `POST /auth/register`, `POST /auth/login`,
    `GET /auth/me`.
  - `AUTH_DISABLED=true` (dev/CI) → системный пользователь.
  - `WorkflowController` / `RunsController`: guards; владелец —
    только из токена.
  - Env: `JWT_SECRET` (min 32), `JWT_EXPIRES_IN`, `AUTH_DISABLED`.
  - CI: `JWT_SECRET` + `AUTH_DISABLED` в шаге `pnpm test`.
  - Tests: 358 → 380 (+22).
- **Auth — refresh-token + logout (R6.1b.1):**
  - Миграция 0005: `refresh_tokens` (uuid, sha256-хэш, cascade FK,
    2 индекса).
  - `AuthService`: create / verify / rotate / revoke.
  - `AuthController`: `POST /auth/refresh`, `POST /auth/logout`.
  - httpOnly cookie (sameSite=strict, path=/auth, secure в prod).
  - Env: `JWT_REFRESH_EXPIRES_IN`, `COOKIE_SECURE`.
  - `cookie-parser` в deps.
  - Tests: 380 → 396 (+16).
- **Auth — fail-fast `AUTH_DISABLED` в prod (R6.1b.1-hotfix):**
  - `EnvSchema.superRefine` — `NODE_ENV=production` + `AUTH_DISABLED=true`
    → отказ старта.
  - Tests: 396 → 400 (+4).
- **Auth — frontend (R6.1b.2):**
  - `stores/auth.ts` — zustand, access-токен в ПАМЯТИ (не localStorage).
  - `lib/api.ts` — 401-интерцептор: refresh + retry (single-flight
    Promise, защита от StrictMode double-effect).
  - `lib/auth-api.ts` — login / register / refresh / logout.
  - `components/auth/` — AuthProvider (bootstrap), LoginPage,
    ProtectedRoute.
  - `main.tsx` — BrowserRouter (react-router-dom v7) + AuthProvider.
  - `App.tsx` — Routes: `/login`, `/` (ProtectedRoute).
  - `TopBar` — user-menu (email, logout).
  - Vite proxy: + `/auth`.
  - i18n: 15 ключей `auth.*` (ru/en 121/121).
  - Frontend tests: 15 → 24 (+9).
- **Frontend Auth — fix ?workflowId= после router (R6.1b.2-fix):**
  - ProtectedRoute сохраняет search при редиректе на /login.
  - LoginPage возвращает на / с сохранённым search.
  - App читает `?workflowId=` через `useSearchParams()` +
    эффект на [workflowIdParam, authStatus].
- **Share workflow (R6.2.1, backend, KI-197):**
  - `POST /workflow/:id/share` — owner → создать/обновить `share_token`
    (генерация в БД: `gen_random_uuid()`).
  - `DELETE /workflow/:id/share` — owner → revoke.
  - `GET /workflow/share/:token` — публичный, без auth, read-only;
    ответ без `userId` / `shareToken` / `updatedAt`.
  - Owner-check переиспользует `buildAccessFilter`; чужой → 404.
  - +12 тестов (400 → 412).
- **Share workflow — frontend (R6.2.2, KI-197):**
  - `TopBar` — кнопка «Поделиться» (disabled без `currentWorkflowId`).
  - `ShareModal` — создать / копировать / отозвать; предупреждение
    KI-233 («По ссылке будут видны все данные графа»).
  - `ShareViewPage` — route `/workflow/share/:token` (без
    ProtectedRoute); read-only ReactFlow + баннер «Только просмотр».
  - `lib/share-api.ts`, `lib/share-url.ts` (+ spec), `stores/share.ts`.
  - Vite: `/workflow` bypass на `/index.html` для `Accept: text/html`.
  - i18n: 14 ключей `share.*` (ru/en 135/135).
  - Frontend tests: 24 → 29 (+5).
- **LLM upgrade — backend (R6.3.1, KI-183/192/193):**
  - `LlmGenerateOptions` — `reasoningEffort: 'off' | 'medium' | 'high'`
    (system / maxTokens уже были).
  - `ModelInfo` — `supportsReasoning?`, `defaultMaxTokens?`.
  - OpenAI-совместимый: `reasoning_effort` через типизированное поле
    SDK; 'off' → поле не отправляется; `max_tokens` приоритет:
    options → ModelInfo → 1024.
  - Anthropic: `system` / `max_tokens` как раньше; reasoning — warn
    (extended thinking — v0.8.x).
  - `LlmNodeExecutor`: `data.systemPrompt` / `data.reasoningEffort` /
    `data.maxTokensOverride` → options; логируются только длины.
  - Env-формат: `<id>:<modalities>[:reasoning]`; reasoning-модели
    → `supportsReasoning=true` + `defaultMaxTokens=4096`.
  - `llm-registry`: пропускает новые поля в `GET /llm/models`.
  - +16 тестов (412 → 428).
- **LLM upgrade — frontend (R6.3.2, KI-183/192/193):**
  - `LlmNodeData` += `systemPrompt?`, `reasoningEffort?`,
    `maxTokensOverride?`.
  - `LLMNode` — сворачиваемый System prompt; `<select>` Reasoning
    (только при `supportsReasoning === true`); `<input>` Max tokens
    (placeholder = defaultMaxTokens).
  - `lib/llm-node-fields.ts` — REASONING_EFFORTS + валидаторы.
  - `lib/api.ts` — Zod-схема += `supportsReasoning` / `defaultMaxTokens`
    (иначе strip — KI-149).
  - `nodeDataFromApi` — переносит новые поля (паттерн KI-129).
  - i18n: 10 ключей `node.llm.*` (ru/en 145/145).
  - Frontend tests: 29 → 33 (+4).
- **Canvas UX part 1 (R6.4a):**
  - `edges/InsertableEdge.tsx` — кнопки «+»/«×» на связи (BaseEdge +
    interactionWidth + EdgeLabelRenderer).
  - `hooks/use-hotkeys.ts` — Ctrl+D (расширится в R6.4b).
  - `hooks/use-debounced-effect.ts` — auto-save 3000 мс.
  - `lib/graph-hash.ts`, `lib/graph-edit.ts`, `lib/graph-guides.ts`.
  - `snapToGrid + snapGrid=[8,8]` + направляющие в `<ViewportPortal>`.
  - Индикатор «✓ Сохранено / ● Есть изменения» в TopBar.
  - Frontend tests: 29 → 40 (+11).
- **Canvas UX part 2, подшаг 1 (R6.4b.1):**
  - `useHotkeys` — обратно-совместимый API (`HotkeyBinding` с
    `preventDefault` / `stopPropagation` / `allow`); приоритет
    `ctrl+*` → `shift+*` → одиночные — на этапе подписки.
  - `lib/hotkeys-utils.ts` + 18 тестов (чистый парсер).
  - `stores/workflow`: `canvasMode` / `showMinimap` / `isCatalogOpen`
    + localStorage.
  - Canvas: S (cursor), H (hand), F (fit view), M (minimap),
    Tab (каталог); `panOnDrag` / `selectionOnDrag`; курсор.
  - Условный `<MiniMap />` + панель режимов слева внизу.
  - Toolbar: каталог → `isCatalogOpen` из стора.
  - Frontend tests: 43 → 61 (+18).
- **Canvas UX part 2, подшаг 2a (R6.4b.2a):**
  - Тип узла `comment` (NODE_REGISTRY, `canBeInsertedOnEdge: false`).
  - `CommentNode` — стикер без Handle, `usePreserveCursor` +
    `useAutoResize`.
  - Хоткеи C / Shift+C (создать в центре / toggle visibility).
  - `lib/graph-payload.ts` — фильтр local-only узлов (Save/Plan).
  - CSS: `--color-comment-bg/-border/-foreground`.
  - i18n: `node.comment.label` / `.placeholder` (ru/en 154 → 156).
  - Frontend tests: 61 → 66 (+5).
  - **Остаток:** KI-266 — комментарии не персистятся (F5 → исчезают).
- **Engine — executors новых узлов (R6.5.1, KI-105):**
  - `http` — AbortSignal.timeout (30s default, cap 120s), body только
    для не-GET, ответ обрезается до 1 МБ по границе UTF-8, 4xx/5xx
    не бросают (возвращают `{ status, body }`).
  - `condition` — MVP-DSL (`>`, `<`, `>=`, `<=`, `===`, `includes`)
    без `new Function`. Маршрутизация веток — v0.8.x.
  - `output` — пропускает первое непустое входное значение под ключом
    `data.name`.
  - `compare` — `mode: 'diff'` (построчный diff, без библиотек).
  - `NodeDataValidationException extends UnsupportedNodeTypeException`.
  - `node-ports.ts`: контракты http/condition/output; compare намеренно
    без контракта (KI-278).
  - Tests: 438 → 479 (+41).
- **Engine — frontend узлов http/condition/output/compare (R6.5.2):**
  - `NodeType` += 4; `HttpNodeData` / `ConditionNodeData` /
    `OutputNodeData` / `CompareNodeData`; `AppNode` += 4.
  - 4 компонента: HttpNode (метод/URL/body/timeout), ConditionNode
    (2 выхода T/F), OutputNode (0 выходов, имя), CompareNode
    (2 входа a/b, mode=diff).
  - `NODE_REGISTRY` — 4 записи (tools / tools / output / ai);
    `canBeInsertedOnEdge: true`.
  - `BaseNode` — новый проп `dataNodeAttr` (аддитивно).
  - i18n: 27 ключей `node.{http,condition,output,compare}.*`
    (ru/en 158 → 185).
  - Frontend tests: 101 → 132 (+31).
- **Export / Import / Templates (R6.6.1, KI-108/109):**
  - `GET /workflow/:id/export` — JSON `{ version: 1, name, nodes,
    edges, exportedAt }` (без userId / shareToken / id).
  - `POST /workflow/import` — создать workflow из артефакта.
  - `GET /templates` + `POST /templates/:id/instantiate`.
  - `src/templates/*.json` — 3 шаблона (text-llm, text-llm-image,
    http-llm); handle IDs сверены с node-ports.ts.
  - `TemplateLoaderService` — fail-soft, два кандидата каталога.
  - Tests: 482 → 498 (+16).
- **Engine — продолжение независимых уровней (R6.5.2-fix, KI-287):**
  - Убран `break` в `executeAsync`; план проходится до конца.
  - Зависимые узлы получают `null` и падают сами (вариант A).
  - Tests: 479 → 482 (+3).
- **Frontend Export / Import / Templates (R6.6.2, KI-108/109):**
  - `TopBar` — 📥 «Скачать JSON» (disabled без сохранённого workflow),
    📤 «Импорт» (скрытый `input[type=file]`).
  - `LoadModal` — вкладки «Мои workflow» / «Шаблоны», карточки с
    `data-template-id`.
  - `lib/export-import-api.ts` (Zod-схемы + API-функции +
    `parseExportedWorkflowFile`).
  - `lib/download-blob.ts` (санитайз имени файла + triggerDownload).
  - i18n: +14 ключей (ru/en 185 → 199).
  - Vite proxy: `/templates` (KI-299).
  - Frontend tests: 132 → 144 (+12).
- **Sub-workflows (R6.7, KI-200):**
  - Backend: тип `sub_workflow`, `SubWorkflowNodeData` (workflowId,
    version?, inputsMap?); executor `executeSubWorkflowNode` (рекурсия
    branch-local `visitedWorkflows`, max depth 5, owner-check → 404);
    `executeSubWorkflowGraphAsync` (префикс id `sub_<nodeId>__`,
    собственный plan, тот же runId); результат — плоский `{ result }`
    из терминалов подграфа.
  - Frontend: NodeType += `'sub_workflow'`; категория `composition`;
    `SubWorkflowNode` (селект своих workflow, «Открыть в редакторе»,
    warning «новая версия»); i18n +10 (199 → 209).
  - Tests: backend 498 → 514 (+16), frontend 144 → 159 (+15).
  - Smoke: nested workflow (Save/F5/Load), Run с inner-узлами, рекурсия
    C→C → failed, «Открыть в редакторе», индикатор версии.
- **fitView после загрузки workflow + панель над миникартой
  (R6.5.2-fix2):**
  - `fitView={isEmpty}` заменён на `useEffect` с ref-защитой
    (устранена race condition при `true→false`).
  - Панель режимов перенесена в `right-6` + адаптивный
    `bottom-44`/`bottom-6`.
    
### Fixed
- **KI-201** — Auth backend (R6.1a): users, JWT-guard, `/auth/*`,
  scrypt; остаток R6.1b.1/R6.1b.2 — refresh-token, logout, frontend
  (`88f53e4`, `4b1c149`, `316c680`).
- **KI-202** — owner на `GET /runs/:id` и `/stream`; чужой run → 404
  (`4b1c149`).
- **KI-204** — `userId` удалён из `CreateWorkflowSchema` и
  `ListWorkflowsQuerySchema`; владелец — только из токена
  (`4b1c149`).
- **KI-205** — `migrate.ts` не логирует `DATABASE_URL` с паролем
  (`4b1c149`).
- **KI-213** — fail-fast `AUTH_DISABLED=true` в production
  (`7e921a7`).
- **KI-228** — `?workflowId=` терялся при миграции на react-router
  (три звена: ProtectedRoute, LoginPage, App) (`4eb4664`).
- **KI-197** — публичный share workflow (backend + frontend):
  `share_token`, `POST/DELETE /workflow/:id/share`, публичный
  `GET /workflow/share/:token`; ShareModal + ShareViewPage; Vite
  bypass для SPA (`ae5e461`, `abf88ff`).
- **KI-183** — maxTokens для reasoning-моделей: `ModelInfo.defaultMaxTokens`
  + env-суффикс `:reasoning` → 4096 (`283ce94`).
- **KI-192** — System prompt у LLM-узла (backend) (`283ce94`).
- **KI-193** — Reasoning mode (backend) (`283ce94`).
- **KI-185** — вставка узла в связь по паттерну React Flow
  (`fcd2913`).
- **KI-189** — направляющие (соседи из стора + ViewportPortal)
  (`fcd2913`).
- **KI-258** — каталог вставки: `w-72` + `placement="down"`
  (`fcd2913`).
- **KI-259** — `addNodeOnEdge`: тип без входного порта больше не удаляет
  связь; `NODE_REGISTRY.canBeInsertedOnEdge` + фильтр каталога
  (R6.4a-fix5).
- **KI-260** — `addNodeOnEdge`: узел вставляется по центру связи
  (`insertPositionOnEdge`, размер — `measured` узла того же типа)
  (R6.4a-fix5).
- **KI-261** — `addNodeOnEdge`: notice `canvas.edge.gone`, если связь
  уже удалена (R6.4a-fix5).
- **KI-188** — Cursor / Hand режимы (S / H) + `canvasMode`
  (`e923384`).
- **KI-190** — Minimap toggle (hotkey M + кнопка) (`e923384`).
- **KI-265** — путь репозитория в PROMPT_V5.md приведён к
  `D:\Projects\AI\workflow-builder` (docs-коммит).
- **KI-271** — запуск переживает F5: `?runId=` в URL восстанавливает
  подписку на SSE-поток; `RunStreamUnavailableError` отличает
  «запуска нет» (404/401 → сброс) от сетевого сбоя
  (`531a062`).
- **KI-245** — единый источник лимитов токенов
  (`llm-constants.ts`) (`bec48bf`).
- **KI-246** — `ReasoningEffort` расширен до
  `minimal`/`low`/`xhigh` (тип возврата `resolveReasoningEffort` —
  `Exclude<ReasoningEffort, 'off'>`) (`bec48bf`).
- **KI-247** — лог движка различает `выполнено`/`провалено`
  (`bec48bf`).
- **KI-186** — расширенный список хоткеев
  (S/H/F/M/Tab/C/Shift+C/Ctrl+D/Ctrl+Z/Ctrl+Shift+Z) (`e923384`,
  `2efe3f3`).
- **KI-217** — `@types/express` в devDeps (правка не потребовалась —
  уже был) (`4a214f7`).
- **KI-220** — `COOKIE_SECURE=false` в production → отказ старта
  (`4a214f7`).
- **KI-221** — `NODE_ENV=staging`/`preprod` считаются prod-подобными
  (`4a214f7`).
- **KI-236** — `workflows.createdAt/updatedAt` → `.notNull()` +
  `withTimezone` (`4a214f7`).
- **KI-274** — `matchesHotkey`: `ctrl+*` биндинги не срабатывали
  (критично — не работал `Ctrl+D`/`Ctrl+Z`) (`2efe3f3`).
- **KI-105** — узлы `http` / `condition` / `output` / `compare`
  (backend + frontend) (`1e89cdd`, `c4f2792`).
- **KI-287** — продолжение независимых уровней после падения узла
  (`987bc5a`).
- **KI-108** — Export / Import / Templates (`12ff041`).
- **KI-109** — Export / Import / Templates (`12ff041`).
- **KI-293** — timestamptz-дрейф: миграция 0006 + 4 колонки
  `withTimezone: true` в схеме; API возвращает UTC-корректные даты
  (`e5f489a`).
- **KI-296** — `workflows.created_at/updated_at`: `SET NOT NULL` +
  `SET DEFAULT now()` в 0006 (`e5f489a`).
- **KI-299** — Vite-прокси для `/templates` (`27cbc14`).
- **KI-200** — Sub-workflows (backend + frontend, `699772f`).
- **KI-306** — `fitView` при большом разбросе координат
  (minZoom) — заведён, v0.8.1.
- **KI-307** — `autoPanOnNodeDrag` — заведён, v0.8.1.

### Documented
- **Gap-анализ GPTunnel (2026-10-15) — новые KI для v0.8/v0.9:**
  - **v0.8 Canvas UX:** KI-185 (вставка узла в связь),
    KI-186 (расширенные хоткеи), KI-187 (комментарии),
    KI-188 (курсор/рука), KI-189 (направляющие/snap),
    KI-190 (миникарта-toggle), KI-191 (дублировать узел).
  - **v0.8 LLM:** KI-192 (System prompt), KI-193 (Reasoning mode).
  - **v0.8 прочее:** KI-194 (Note/Compare), KI-195 (auto-save).
  - **v0.8 Share:** KI-197 (публичная read-only ссылка).
  - **v0.9:** KI-196 (медиа-инструменты: upscale, bg-removal,
    lipsync, 3D, motion).
  - **KI-107 не тронут:** в KNOWN_ISSUES.md это «Параллельные
    media-узлы и rate limit», а не Share — детали Share
    заведены отдельным KI-197.
  - **KI-202..208** — Auth-остаток: `GET /runs/:id` без owner (🔴
    Critical), FK на users, `userId` в DTO, `migrate.ts` логирует
    URL, rate-limit/refresh/logout, scrypt-параметры,
    `@nestjs/passport` в deps.
  - **KI-209..212** — коллизии нумерации KI (CHANGELOG `[0.1.0]`
    использует KI-номера как идентификаторы фич), «Passport»-формулировки
    в DESIGN § 1/§ 3.1, пропуск KI-198/199, ошибочная ссылка на KI-106
    в сообщении коммита `88f53e4` (аннотирована через `git notes`).
  - **KI-214..222** — Auth/DB-остаток v0.8.x: нет индекса на
    `workflows(user_id)` (Medium), `refresh_tokens` не чистится
    (Medium), нет family-revocation на reuse (Medium),
    `COOKIE_SECURE=false` в prod (Medium), `@types/express`
    транзитивный, нет тестов `parseDurationToMs`, `revoked_reason`
    отсутствует, staging-NODE_ENV, edge-cases env-схемы.
  - **KI-223..227, 229..232** — Auth UX + router-остаток v0.8.x:
    bootstrap 401 vs сеть (Medium), logout best-effort (Medium),
    маппинг 400 в LoginPage, красный 401 в консоли, `meAsync` +
    alias `@/`, `syncWorkflowUrlParam` через `replaceState`,
    тесты на ProtectedRoute/App (jsdom), multi-tab refresh-rotation
    (Medium), Welcome screen с шаблонами (Medium, после KI-109).
  - **KI-233..243** — Share-остаток v0.8.x: sanitize публичного
    ответа (Medium), rate-limit публичных ручек (Medium, вместе с
    KI-206), бессрочность + аудит ссылки, `.notNull()` на
    `createdAt`/`updatedAt`, перевыпуск токена без предупреждения,
    SPA-proxy в prod (High, KI-238), предупреждение о перевыпуске
    в UI, read-only node-карточки, Zod-валидация графа в
    ShareViewPage, сообщение о сбое copy, реализация allow-copy
    (R6.6).    
  - **KI-244..247** — LLM-остаток v0.8.x: Anthropic-модели
    захардкожены (Medium), лимит токенов в трёх местах (Low),
    ReasoningEffort покрывает только off/medium/high (Low),
    лог движка «узлов=0» (Low).
  - **KI-248..251** — frontend LLM-остаток v0.8.x: `reasoningEffort`
    не сбрасывается при смене модели, union в 3 местах,
    placeholder без пояснения, нет unit-теста на `nodeDataFromApi`.
  - **KI-252..255, 259..261** — Canvas UX-остаток: узлы из Toolbar
    вне сетки, хэш на каждом изменении, Ctrl+D фокус на копию,
    structuredClone, addNodeOnEdge без входного порта (High),
    позиция узла, молчание при отсутствующей связи.    
  - **KI-262..263** — Canvas UX-остаток: `canBeInsertedOnEdge` не
    синхронизирован с Handle в компоненте (Low), перекрытие при
    тесной раскладке (Medium).
  - **KI-264** — заметка о смоук-харнессе CDP (узкий Fetch-перехват +
    `windowsVirtualKeyCode`).
  - **KI-266** — комментарии не персистятся (backend роняет run на
    незнакомом типе, `UnsupportedNodeTypeException`).
  - **KI-267** — `loadWorkflowAsync` при ошибке схемы молчит в консоль.
  - **KI-266** — комментарии-стикеры персистятся: backend исключает
    аннотации из плана выполнения (`ANNOTATION_NODE_TYPES`),
    frontend больше не отсекает `comment` при Save/Plan
    (`55beb6d`).
  - **KI-187** — комментарии/аннотации на холсте (`55beb6d`).
  - **KI-268** — SSE-поток запуска авторизуется через `fetch`
    с Bearer-заголовком (`ReadableStream`); `EventSource` не умеет
    заголовки → 401 при `AUTH_DISABLED=false`
    (`5374164`).  
  - **KI-271** — после F5 посреди запуска прогресс не восстанавливается
    (Medium).
  - **KI-272** — `onFatalError` потока не снимает «выполняется» (Low).
  - **KI-273** — расширенные хоткеи (Ctrl+A/C/V/S, Shift+Backspace) —
    отложены в v0.8.x (не критично для MVP).    
  - **KI-275** — CDP-смоук: hidden-страница молча отбрасывает OS-ввод
    (Medium).
  - **KI-276** — Ctrl+Z не работает при фокусе в поле ввода узла (Low).
  - **KI-277** — Load не чистит историю undo (Low).
  - **KI-284** — вставка compare в связь теряет операнды (Medium).
  - **KI-285** — обрезка полей в карточках новых узлов (Low).
  - **KI-286** — CDP-смоук: Ctrl+A вставляет символ; каталог требует
    scrollIntoView (Low).
  - **KI-287** — движок прерывает независимые уровни после первого
    падения (Medium, противоречит RULES 4.16).
  - **KI-288** — нет skipped-статуса (Medium).
  - **KI-289** — http не считает 4xx/5xx ошибкой (Medium).
  - **KI-290** — outputs с fallback от потомков упавших (Medium).
  - **KI-291** — workflows.version не в артефакте (Low).
  - **KI-292** — nest-cli assets для templates (Medium).
  - **KI-293** — timestamptz дрейф: API отдаёт дату на 3ч раньше
    (🟠 High).
  - **KI-294** — ImportSchema.name без max(200) (Low).
  - **KI-295** — WorkflowController Async-стиль (Low).
  - **KI-297** — устаревший комментарий в `findSharedAsync` (Low).
  - **KI-298** — `drizzle-kit generate` не сверяет схему с БД
    (Medium, корень KI-293/296).
  - **KI-300..305** — Sub-workflows-остаток: version не
    инкрементится, type-aware резолвер портов, кэш workflow, inputsMap,
    префиксные id в SSE/outputs, пустой подграф.

## [0.7.2] — 2026-10-15

**Patch-релиз после v0.7.1. Yandex env + LM Studio auto-discovery + LLM/media фиксы.**

### Added
- **Интеграции — Yandex env + LM Studio auto-discovery (KI-174/175/176/088):**
  - `YANDEX_MODELS` (env): формат `<id>:<modalities>` (короткие id +
    `YANDEX_FOLDER_ID` или полные `gpt://<folder>/<model>/<version>`).
    Парсер `parseYandexModels`. Vision через `:text+vision`.
  - `MODEL_PRICING` — yandexgpt-lite / yandexgpt / yandexgpt-32k /
    qwen3.6-35b-a3b. `bareModelId()` извлекает id из URI.
  - LM Studio: `createProvidersAsync` + `GET /v1/models` при старте.
    Env `LMSTUDIO_MODELS` — приоритет для модальностей; API — источник
    каталога. API недоступен → fallback на env.

### Fixed
- **KI-179** — LLM: fallback `reasoning` при пустом `content`;
  явная ошибка «LLM вернул пустой ответ (finish_reason=X)» (`675ca23`).
- **KI-180** — textarea для prompt в LLM-узле (auto-resize, i18n,
  backend fallback `inputs.prompt` → `data.prompt`) (`675ca23`).
- **KI-181** — media: схема принимает объектную форму ошибки
  (EXCEPTION от GPTunnel); падение yandex-art на стороне
  провайдера видно пользователю (`675ca23`).

### Documented
- **KI-182** — не баг кода (старый `.env`); добавлено 5 тестов на
  группировку моделей (`675ca23`).
- **KI-174, KI-175, KI-176** — Yandex AI Studio: env-формат каталога
  моделей (по образцу `LMSTUDIO_MODELS`), vision-модальность
  `qwen3.6-35b-a3b` (потеряна в v0.7.1), цены в `MODEL_PRICING`.
  Уточнён KI-172. Инсайт после пользовательской настройки Yandex.

## [0.7.1] — 2026-10-14

**Patch-релиз после v0.7.0. 19 KI закрыто + 9 новых Open.**

Пакеты фиксов:
- Интеграции: Yandex (реальный URI + folder_id), media-дефолт
  (flux-schnell), LMSTUDIO_MODELS id, единый источник prompt.
- UX: удаление edges/nodes, кнопка «Новый workflow»,
  word-wrap панели, auto-resize textarea, tooltips, миникарта.
- Метрики: cost_rub/tokens/cost_usd в node_completed/node_failed
  (панель без F5), cost_usd = 0 для LM Studio, формат USD.
- Run: авто-Save перед Run (устаревший snapshot).
- Ввод: сохранение курсора в контролируемых полях.

### Fixed
- **KI-075** — метрики в `node_completed`/`node_failed` (`84532f1`,
  `684211f`): cost_rub / tokensIn / tokensOut / costUsd / logs.
- **KI-147** — Run всегда Save перед запуском (`47d577f`).
- **KI-148** — cost_usd = 0 для локальных провайдеров (`f200c42`).
- **KI-149** — frontend читает метрики события (`684211f`).
- **KI-151** — формат USD с 2 знаками (`58d5672`).
- **KI-154** — дефолт media-модели: text-to-image, не bgremover
  (`29f4e19`).
- **KI-156** — LMSTUDIO_MODELS id совпадают с LM Studio
  (`29f4e19`).
- **KI-157** — сохранение курсора в контролируемых полях
  (`702d849`).
- **KI-158** — миникарта: контраст + border (`474a93f`).
- **KI-159** — Yandex URI `gpt://<folder>/<model>/latest`
  (`29f4e19`).
- **KI-160** — textarea для prompt в ImageGen (`474a93f`).
- **KI-162** — удаление edges через Delete/Backspace (`9d2f6bf`).
- **KI-163** — кнопка удаления node (`9d2f6bf`).
- **KI-164** — кнопка «Новый workflow» (`9d2f6bf`).
- **KI-165** — word-wrap в панели результата (`474a93f`).
- **KI-166** — единый источник prompt (`29f4e19`).
- **KI-167** — tooltips Controls React Flow локализованы
  (`474a93f`).
- **KI-168** — tooltip кнопки сворачивания панели (`474a93f`).
- **KI-169** — auto-resize textarea в узлах (`474a93f`).

### Added
- **Frontend тесты выросли с 2 до 10** — добавлены на чистые
  функции (`pickDefaultMediaModel`, форматтеры).
- **Backend тесты: 325 -> 341** (+16).

## [0.7.0] — 2026-10-14

**UI-срезы v0.7: тёмная тема, i18n, каталог узлов, уборка типов.**

Backend не менялся. Frontend — 4 подшага:
- R5.1: уборка типов (KI-129) + реестр на labelKey.
- R5.2: тёмная тема (KI-125, KI-132, KI-134).
- R5.3: i18n RU/EN (KI-126, KI-137, KI-141, KI-142) + CI job web.
- R5.4: каталог узлов (KI-127).

### Added
- **Frontend — v0.7.0 / R5.4: каталог узлов (KI-127):**
  - `web/src/components/NodeCatalogPopover.tsx` (новый) — поповер
    каталога: секции из `NODE_REGISTRY` по `category`, порядок из
    `NODE_CATEGORIES`, только непустые секции (`input`/`ai`/`media`).
    Поиск (i18n-aware), клавиатура (↑/↓ по кругу, Enter, Esc, `/`,
    клик вне).
  - `Toolbar`: кнопка «+» (`data-catalog-toggle`).
  - 9 ключей `catalog.*` (ru/en 84 -> 93, паритет-тест).
  - Bundle 585 -> 589 kB.
- **Frontend — v0.7.0 / R5.3: i18n RU/EN (KI-126, KI-137, KI-141,
  KI-142):**
  - `react-i18next` + `i18next`. `web/src/i18n/index.ts` —
    инициализация, `detectInitialLanguage` (localStorage ->
    navigator.language -> 'ru'), `setLanguage` (язык + localStorage
    + `<html lang>`).
  - `web/src/i18n/ru.json` + `en.json` — 84 ключа, паритет-тест
    (`i18n.spec.ts`, 2/2).
  - `node-registry`: `tLabel` / `TEMP_LABELS` удалены,
    `nodeLabelOf` -> `i18n.t()`.
  - Компоненты (`TopBar`, `Toolbar`, `BaseNode`, `TextNode`,
    `LLMNode`, `ImageGenNode`, `RunResultPanel`, `LoadModal`) —
    на `useTranslation()` + `t()`; `stores/workflow.ts` -> `i18n.t()`.
  - `TopBar`: кнопка RU/EN.
  - **CI job `web`** (install + build + test) — закрывает KI-005
    (frontend в CI) и KI-068 (frontend-тесты) частично.
  - Bundle 528 -> 585 kB (+56 kB i18next).
- **Frontend — v0.7.0 / R5.2: тёмная тема (KI-125, KI-132):**
  - `web/src/styles/theme.css` (новый) — `@theme` (светлая) +
    `.dark` (тёмная): CSS-переменные для background/foreground/
    muted/border/primary/canvas/node + маппинг React Flow
    (`--xy-*`: edge-stroke, background-pattern, controls, minimap,
    edge-label).
  - `web/src/hooks/use-theme.ts` (новый) — `useTheme()`:
    light/dark/system, `localStorage.theme`, реактивная подписка
    на `matchMedia`, класс `.dark` на `<html>`.
  - `web/index.html` — inline-script до bundle, против вспышки.
  - `TopBar` — кнопка ☀/🌙.
  - Компоненты (`TopBar`, `Toolbar`, `BaseNode`, `RunResultPanel`,
    `LoadModal`, `Canvas`) и узлы (`TextNode`, `LLMNode`,
    `ImageGenNode`) переведены на переменные.
  - Инпуты узлов — темизированы; фокус `focus:border-primary
    focus:ring-1 focus:ring-primary` (R5.2.1/R5.2.2/R5.2.3).
  - RULES 4.32: `color-mix()` вне `@theme` эмитится как невалидный
    `theme(…)` — такие значения держать отдельной переменной в
    `@theme`/`.dark` (KI-134).

### Changed
- **Frontend — v0.7.0 / R5.1: уборка типов и реестр на labelKey
  (KI-129):**
  - `NodeData` — дискриминированный union по `kind`
    (`TextNodeData | LlmNodeData | ImageGenNodeData`), `kind`
    обязателен. Подтипы `extends Record<string, unknown>` (требование
    React Flow и API-слоя).
  - `createNode` / `nodeDataFromApi` — явные `case` без `default:`;
    новый тип узла поймает tsc.
  - `imageUrl` в `nodeDataFromApi` добавляется условно — без
    `undefined`-ключей в JSON и в `Object.keys`.
  - `NODE_REGISTRY` — `labelKey` вместо `label`/`labelEn`, `icon`
    (эмодзи) вместо `iconEmoji` + `label`. `as const satisfies
    Record<NodeType, NodeRegistryEntry>`.
  - `capabilities: { externalState, userConfig }` — задел под
    KI-128.
  - `NODE_CATEGORIES` — 5 категорий (`input / ai / media / tools /
    output`), `image_generation` → `media`.
  - `Toolbar` и узлы — `tLabel(NODE_REGISTRY[type].labelKey)`;
    временный RU до R5.3 (react-i18next).

### Fixed
- **Root vitest excludes web/ (KI-137):** после R5.3 корневой
  `pnpm test` подхватывал `web/src/i18n/i18n.spec.ts` (327/327
  вместо 325/325). `include` сужен до `src/` + `test/`, добавлен
  `exclude: ['web/**']`.
- **CI: pnpm version в job web (KI-141):** `pnpm/action-setup@v4`
  падал с `Multiple versions of pnpm specified` — `version: 12`
  в YAML + `pnpm@12.11.2` в `package.json`. `with: version` убран,
  версия берётся из `packageManager`.
- **web: zod в dependencies (KI-142):** `zod` использовался в
  `web/src/**`, но не был в `web/package.json` — локально резолвился
  из корневого `node_modules`, в CI падало с TS2307 + TS7006.
  Добавлен `zod: ^4.6.6`.

## [0.6.1] — 2026-10-14

**Frontend: единый реестр узлов (KI-121, KI-122, KI-123), KI-125..129.**

### Changed
- **Frontend — v0.6.1: единый реестр узлов (KI-121, KI-122, KI-123):**
  - `web/src/lib/node-registry.ts` (новый) — `NODE_REGISTRY`
    (`Record<NodeType, NodeRegistryEntry>`): метаданные (`label`,
    `icon`, `iconEmoji`, `labelEn`, `category`), компоненты,
    `isNodeType()`, `nodeTypes` для React Flow, `nodeLabelOf()`.
  - `fromApiWorkflow` — цепочка `!==` заменена на `isNodeType()`.
    Новый тип узла больше не теряется молча при Load (tsc ловит).
  - `nodeDataFromApi` — переносит `model` / `aspectRatio` для
    `image_generation` (KI-122: до правки Load терял выбор
    пользователя, и следующий Save затирал его в БД).
  - `Toolbar` — кнопки строятся из реестра (KI-123), локальный
    `BUTTONS` удалён. Визуал v0.6.0 сохранён (эмодзи + EN-подписи
    для тулбара, RU-подписи — для шапки узла и будущего каталога).
  - `data.label` удалён из `NodeData` — заголовок узла берётся из
    реестра (`nodeLabelOf`). Читатели `data.label` (`TopBar`,
    `RunResultPanel`, `workflow.runPlanAsync`) переведены на хелпер.
  - `NODE_CATEGORIES` / `NodeCategory` + `category` у каждой записи
    реестра — скелет под каталог (KI-127 частично).
  - `nodes/index.ts` — тонкий реэкспорт; `Canvas.tsx` не менялся.

### Documented
- **KI-125** — нет тёмной темы (🟡 Medium, v0.7).
- **KI-126** — нет i18n RU/EN (🟡 Medium, v0.7). RULES 1.14.
- **KI-127** — каталог узлов с категориями (🟡 Medium, частично
  закрыт: `NODE_CATEGORIES` + `category` в реестре; поповер — v0.8).
- **KI-128** — узлы-сервисы с внутренним конфигом (🟢 Low, v0.8+).
- **KI-129** — уборка типов фронтенда: `NodeData` как
  дискриминированный union, `imageUrl` без `undefined`
  (🟢 Low, v0.7).

---

## [0.6.0] — 2026-10-14

**Media: генерация изображений через GPTunnel CreativeLab.**

Полный цикл «нарисовал → сохранил → запустил → LLM выполнил → картинка в узле». Провайдеры: 6 LLM (Anthropic, OpenAI, RouterAI, GPTunnel, DeepSeek, Yandex, LM Studio) + media-провайдер CreativeLab (57 IMAGE-моделей, Flux / DALL·E / Gemini Image / Nano Banana / Midjourney).

### Added
- **Runner — v0.6.0a: модальности моделей (2026-10-13):**
  - `ModelModality` (`text` / `vision` / `image-generation` /
    `audio` / `video` / `embedding`) + `ModelInfo` с
    `inputModalities` / `outputModalities`. Рантайм-константа
    `MODEL_MODALITIES` — для валидации env.
  - `GET /llm/models` возвращает модальности каждой модели.
  - `LMSTUDIO_MODELS` — суффикс модальностей:
    `id:modality+modality,id:modality`. Без суффикса — `text`.
  - UI: селект LLM-ноды **сгруппирован** (`Текст` /
    `Текст + Vision`), карточка узла показывает badge `[V]` для
    vision-моделей.
  - `web/src/lib/llm-models.ts` — `filterModelsByInput`,
    `filterModelsByOutput`, `groupLlmModelsForSelect`.
  - ImageGen-нода фильтрует модели по `output: image-generation`
    (пусто до v0.6.0b — image-провайдера ещё нет).
  - +3 теста (257 → 260).
  - Smoke: 9 моделей от 4 провайдеров, группы в селекте, badge
    `[V]` на `qwen/qwen2.5-vl-7b`.

- **Runner — v0.6.0b.1: GPTunnel chat (2026-10-13):**
  - GPTunnel (`https://gptunnel.ru/v1`) — OpenAI-совместимый chat.
    Два независимых API: `/v1` (chat) и `/api/v2/media` (image/
    video/audio, добавляется в v0.6.0b.2).
  - `GPTUNNEL_API_KEY`, `GPTUNNEL_BASE_URL`, `GPTUNNEL_MODELS`
    (формат `id:modality+modality,id:modality` — как
    `LMSTUDIO_MODELS`; парсер общий).
  - Провайдер включается при **ключе** и **непустом списке** —
    в отличие от LM Studio (только список).
  - Парсер `parseModelIds` обобщён: `{ envKey, labelSuffix }` в
    опциях — предупреждения называют правильную переменную.
  - +11 тестов (260 → 271).

- **Runner — v0.6.0b.2.1: media-провайдер CreativeLab (2026-10-13):**
  - `src/media/` — новый модуль для media-провайдеров, отдельный
    от `LlmModule`.
  - `IMediaProvider` + `MediaProviderException` (с `retryable`, как
    в `LlmProviderException`).
  - `CreativeLabProvider` (GPTunnel `/api/v2/media`):
    `GET /media/models?type=IMAGE` через встроенный `fetch` (Node 22),
    Zod-валидация ответа, snake_case → camelCase, кэш по типу
    (TTL 15 мин, `GPTUNNEL_MEDIA_CACHE_TTL_MS`).
  - `MediaRegistryService` + `MEDIA_PROVIDERS` токен (паттерн как
    `LLM_PROVIDERS`). Пустой список при отсутствии провайдера —
    не 404. Дедупликация id: первое побеждает.
  - `GET /media/models?type=IMAGE` — контроллер.
    `retryable` → 503, иначе → 502.
  - env: `GPTUNNEL_MEDIA_API_KEY`, `GPTUNNEL_MEDIA_BASE_URL`,
    `GPTUNNEL_MEDIA_CACHE_TTL_MS`.
  - +26 тестов (271 → 297).

- **Runner — v0.6.0b.2.2: executor для media (2026-10-14):**
  - Узел `image_generation` выполняет **реальный** CreativeLab:
    `createTask → poll → URLs`. Стаб удалён.
  - **Миграция `0003`:** `node_runs.cost_rub numeric(10,6)`.
    LLM → `cost_usd` (USD), media → `cost_rub` (RUB). Не смешиваются.
  - `src/media/dto/media-task.dto.ts` — Zod-схемы задачи.
  - `CreativeLabProvider.createTaskAsync` / `getTaskAsync` с
    `idempotency_key` (защита от двойной оплаты при retry),
    `wait: true`, таймауты 45с/15с. Классификация ошибок:
    401/403, 402, 409+code:23 (идемпотентный конфликт → возврат
    существующей задачи), 400+code:25, 410+code:21 (без
    аналога), 429/5xx — retryable. Заголовок `Deprecation: true`
    + `x-model-served` → logger.warn, запрос продолжается.
  - `MediaNodeExecutor` — DI-исполнитель с poll'ом (backoff
    2s ×1.5, cap 15s, общий таймаут 5 мин). Outputs:
    `{ mediaUrl, mediaType, taskId }`.
  - `ExecutionEngineService`: `NodeStepResult` — discriminated
    union (`plain | llm | media`). UPDATE пишет `tokens_in/out` +
    `cost_usd` для LLM, `cost_rub` — для media. UPSERT сбрасывает
    `cost_rub` (KI-047).
  - +27 тестов (297 → 324).

- **Frontend — v0.6.0b.2.3: узел image_generation (2026-10-14):**
  - `ImageGenNode` — рабочий узел: селект `GET /media/models?type=IMAGE`,
    `aspect_ratio` из `params` модели, подпись цены
    («от 0.6 ₽ / генерация»), рендер `<img src={mediaUrl}>` в теле узла.
  - `isRenderableMediaUrl` — валидация http(s) перед `<img>`
    (класс KI-006).
  - Валидация Run — `findImageNodesWithoutModel`.
  - Store: `mediaModels`, `mediaModelsLoaded`, `loadMediaModelsAsync`
    (lazy, один fetch за сессию); `NodeRunMetrics.costRub`.
  - `RunResultPanel`: `formatRub` — `"0.600000"` → `"0.60 ₽"`.
  - `costRub` в `NodeRunSnapshotSchema` (`.nullable().optional()`).
  - CDP-smoke: 55 моделей, дефолт `flux-schnell`, `<img>` по URL,
    метрика `0.60 ₽`, Run заблокирован без модели.

- **Runner — v0.6.0b.2.4: `cost_rub` в SSE snapshot (2026-10-14):**
  - `costRub: z.string().nullable().optional()` в
    `NodeRunSnapshotSchema` (backend-схема).
  - `toNodeSnapshot` — `costRub: row.costRub ?? null`.
  - +1 тест (324 → 325).

- **Frontend — v0.6.0b.2.5: `image` → `image_generation` (2026-10-14):**
  - Контракт типа узла приведён к backend: `NodeType`, `createNode`,
    `nodeDataFromApi`, `fromApiWorkflow`, registry `nodeTypes`,
    `Toolbar`, `NODE_TYPE_ICONS/LABELS`. `kind: 'image'` (UI-метка)
    сохранён.
  - CDP-smoke: Save отправляет `type: 'image_generation'`, Load
    отрисовывает узел нашим компонентом, `data.kind` не подменён.

### Fixed
- **KI-110** — WSL2 Docker proxy (`wslrelay.exe`) рвал idle TCP:
  `pg.Pool` переиспользовал мёртвый сокет, `POST /workflow` падал с
  500, ioredis сыпал `ECONNABORTED`. `pg.Pool` — `idleTimeoutMillis:
  5s`, `maxLifetimeSeconds: 30s`, `connectionTimeoutMillis: 5s`.
  `ioredis` — `keepAlive: 10s`, bounded `retryStrategy`.
- **KI-111** — `MediaTaskResponseSchema.result` — массив
  **объектов** `{ url }`, не массив строк. Схема ждала
  `z.array(z.url())`, узел `image_generation` падал за ~300 мс до
  первого poll. Схема — `z.array(z.object({ url: z.url() }))`,
  mapper — `dto.result.map(item => item.url)`.
- **KI-112** — у моделей с тарифом «по входу» (`tts2`) нет
  `price_unit`, есть `price_input`/`price_input_unit`. Схема
  требовала `price_unit: z.string()`, один такой элемент в
  коллекции ломал `safeParse` → вся пачка моделей не грузилась.
  Поле — `.optional()`, добавлены `price_input`/`price_input_unit`.
- **KI-120** — Vite proxy не знал про `/media`: UI получал HTML
  (SPA fallback) со статусом 200, `requestAsync` падал на
  `JSON.parse`, селект моделей оставался disabled. `'/media'` в
  `web/vite.config.ts`.
- **Контракт типа узла** (v0.6.0b.2.5) — frontend отправлял
  `type: 'image'`, backend ждёт `'image_generation'` (NodeDto,
  executor, engine). Каждый Run падал с «Неподдерживаемый тип узла:
  image».

---

## [0.4.0] — 2026-10-13

**MVP: визуальный редактор LLM-workflow с реальным выполнением.**

Canvas (React Flow) → Engine (топосортировка) → Runner (BullMQ + Postgres) → LLM
(Anthropic / OpenAI) → SSE → UI (подсветка нод + панель результата). Полный цикл
«нарисовал → сохранил → запустил → увидел результат» работает.

### Added

- **Frontend — R4.3b: панель результата:**
  - `RunResultPanel` (снизу, сворачивается): по клику на ноду — вывод (JSON),
    метрики (длительность/токены/стоимость), ошибка и логи ретраев (KI-036);
    без выбранного узла — статус запуска с номером попытки и `runError`.
  - Раскладка переведена на flex-колонку: `TopBar` — обычный элемент,
    `Canvas` — `flex-1 min-h-0`, панель — `shrink-0`. React Flow корректно
    ресайзится при сворачивании панели.
  - `stores/workflow.ts` — `selectedNodeId`, `nodeErrors`, `nodeLogs`,
    `nodeMetrics`; выбор снимается при удалении ноды. Фикс `attemptNumber`:
    промежуточный провал — `attemptsMade + 2` (следующая попытка), финал —
    `attemptsMade + 1` (завершившаяся).
  - Smoke (CDP): панель показывает `{ "text": "привет" }` и «2 мс», клик по
    пустому месту возвращает run-уровень, свернуть/развернуть — 48px/288px,
    консоль чистая.
- **Frontend — R4.3a: id моделей и блокировка Run:**
  - Список моделей приходит из `GET /llm/models` (R4.1b) и кэшируется в store:
    в `data.model` хранится **id** (`claude-sonnet-4-20250514`), в селекте
    показывается label. `LLM_MODELS`/`LlmModel`/`LLM_MODEL_HINTS` удалены.
  - Недоступная модель показывается как «(недоступно)» — молчаливой подмены на
    первый из списка больше нет (`nodeDataFromApi`).
  - `TopBar` блокирует Run, если в графе есть LLM-узел с недоступной моделью
    (точный тост; `POST /runs` не отправляется).
  - `vite.config.ts` — `/llm` proxy (без него `GET /llm/models` → 404).
- **Frontend — R4.2: EventSource + подсветка нод:**
  - `Run` выполняет реальный `POST /runs` и подписывается на SSE. Ноды
    подсвечиваются в реальном времени: серые → синие → зелёные (успех) /
    красные (провал).
  - `web/src/types/run-stream.ts` — Zod-схемы SSE-сообщений (зеркало backend
    `RunStreamMessageSchema`).
  - `web/src/lib/run-stream.ts` — `subscribeToRunStream` со счётчиком ошибок
    (3 → close). Таймаут «нет сообщений» **не** используется: SSE
    keep-alive-комментарии не видны в JS, и таймер оборвал бы живой долгий
    LLM-вызов.
  - `stores/workflow.ts` — `runId`/`runStatus`/`nodeStatuses`/`nodeOutputs`;
    `applySnapshot` **заменяет** карты (snapshot — источник истины при
    переподключении), `final=true` → close.
  - `BaseNode` — `border-2` + `bg-*-50` по статусу, `data-status` для e2e.
  - `TopBar` — бейдж статуса, кнопка Run блокируется во время выполнения,
    авто-Save перед Run, если workflow не сохранён.
  - `vite.config.ts` — `/runs` proxy с `timeout: 0`/`proxyTimeout: 0` (дефолт
    убил бы долгий SSE-поток).
  - Smoke (CDP, headless Chrome): провал — 3 попытки BullMQ (серый → синий →
    красный × 3, badge «Выполняется… (попытка N/M)» → «Ошибка»),
    `streamClosed: true` на `final=true`; успех (text→text) — обе ноды зелёные,
    badge «Готово». Zero console errors.
- **Runner — R4.1: SSE-поток и список моделей:**
  - `GET /runs/:id/stream` — SSE-поток прогресса запуска (`@Sse()` +
    `@SseSignal()`). Первым сообщением — `snapshot` (KI-049: run + все
    `node_runs`), далее — события из Redis pub/sub. Keep-alive `: keep-alive`
    раз в 15 с — защита от `proxy_read_timeout`.
  - `src/runs/dto/run-stream-message.dto.ts` — `RunStreamMessageSchema`
    (discriminatedUnion `RunEventSchema` + `SnapshotMessageSchema`);
    `RunEventSchema` (pub/sub-контракт) не менялся.
  - `GET /llm/models` (KI-056) — `LlmController` отдаёт
    `LlmRegistryService.listModels()` (отфильтровано по `isConfigured`,
    KI-039), без envelope.
  - 12 новых тестов (190 → 202).
- **Runner — KI-065 + KI-032: конфигурируемый воркер:**
  - `WorkerEnvSchema` в `env.schema.ts` — единый источник дефолтов и границ;
    встроена в `EnvSchema` через `.shape`, поэтому `ConfigModule` и
    `@Processor` валидируют одно и то же.
  - `src/runs/runs.worker-options.ts` — читает env в момент загрузки модуля
    (декораторы вне DI); значения валидируются Zod **до** передачи в BullMQ
    (`Number('abc') = NaN` не утечёт).
  - `@Processor(WORKFLOW_RUNS_QUEUE, WORKFLOW_RUNS_WORKER_OPTIONS)`:
    `concurrency` (default 5), `lockDuration` (default 300 000),
    `maxStalledCount` (default 2) — из env.
  - `RUN_STALE_THRESHOLD_MS` удалён из `runs.constants.ts`; значение берётся из
    `WORKFLOW_RUNS_STALE_THRESHOLD_MS` (default 300 000) — единый источник без
    расхождения prod/тестов (KI-032).
  - 12 новых тестов (217 → 229).
  - Smoke: `concurrency=2` → «max simultaneously running = 2» (до правки — 1);
    `concurrency=1` → регресс 1; env fail-fast: `0`/`100`/`abc` → `exit=1`.
- **Runner — KI-060: явный признак финальности `run_completed`:**
  - `run_completed` несёт `final: boolean` — эвристика
    `attemptsMade >= attempts - 1` ломалась на детерминированных провалах
    планирования (цикл: `executeAsync` не пробрасывает, job успешен, retry не
    будет).
  - `RunsProcessor` — **единственный** публикатор `run_completed`: только он
    знает и результат (`return`/`throw`), и состояние попыток job'а.
    `ExecutionEngineService` больше **не** публикует `run_completed`;
    `RunAttemptContext` удалён — `executeAsync(runId, graph)` снова с двумя
    аргументами. `runs-stream.service` закрывает поток чисто по `event.final`,
    `isFinalCompletion` удалён.
  - 8 новых и 5 обновлённых тестов (209 → 217).
  - Smoke A (job retry): `final=false` на 0/3 и 1/3, `final=true` на 2/3 —
    поток закрыт. Smoke B (цикл): `run_completed(final=true)` сразу, поток
    закрыт за 1.3 с (было: `curl exit=28`, соединение висело).
- **Runner — KI-059: сигнал исчерпания попыток:**
  - `RunEventSchema.run_completed` несёт `attemptsMade` и `attempts` (из job в
    процессоре); SSE-поток закрывается только на **финальном**
    `run_completed`. `attempts=null` — поток остаётся открытым (неизвестный
    лимит ≠ «повторов не будет»).
  - 7 новых тестов (202 → 209).
  - Smoke: 3 job-retry (мёртвый `ANTHROPIC_BASE_URL`) — поток открыт на 0/3 и
    1/3, закрывается после 2/3.
- **Runner — KI-039 + KI-052: провайдеры и стоимость:**
  - `ILlmProvider.isConfigured` (KI-039) — геттер `client !== null`;
    `LlmRegistryService.listModels()` фильтрует неконфигурированные провайдеры.
    `resolveByModel` **не** фильтрует (маршрутизация ≠ готовность; ошибка
    «API_KEY не задан» всплывает на вызове).
  - `calculateCostUsd` возвращает `null`, если провайдер не отдал usage
    (KI-052): `cost_usd = 0` больше не означает «бесплатный вызов».
  - 7 новых тестов (183 → 190).
- **Runner — KI-038: метрики LLM-узлов:**
  - `ILlmProvider.generateAsync` возвращает `LlmGenerateResult`
    (`{ text, usage }`) вместо `Promise<string>` (breaking change, dev-only).
  - `extractUsage` в обоих провайдерах с явным narrowing из `unknown`
    (RULES § 1.17).
  - `src/llm/model-pricing.ts` (новый) — `MODEL_PRICING` + `calculateCostUsd`.
  - `LlmNodeExecutor.executeAsync` возвращает `{ outputs, metrics }`; метрики
    пишет `ExecutionEngineService` (executor не трогает БД — он владеет
    `node_runs` и UPSERT'ом из KI-031/KI-047).
  - `node_runs.tokens_in/tokens_out/cost_usd` заполняются и сбрасываются в
    UPSERT (не «прилипают» к новой попытке).
  - 11 новых тестов (172 → 183).
- **Runner — R3: LLM-провайдеры:**
  - `src/llm/llm-provider.interface.ts` — `ILlmProvider`,
    `LlmGenerateOptions`, `LlmProviderException`.
  - `src/llm/providers/anthropic.provider.ts` — Claude Opus 4 / Sonnet 4
    (`@anthropic-ai/sdk`); `openai.provider.ts` — GPT-4o / 4o-mini (`openai`).
  - `src/llm/llm-registry.service.ts` — `resolveByModel()` + `listModels()`;
    `src/llm/llm.service.ts` — единая точка вызова + `AbortSignal` timeout 60s
    (RULES § 4.19).
  - `src/llm/llm-node-executor.service.ts` — DI-исполнитель узла `llm`
    (`node-executors.ts` остались чистыми функциями).
  - `ExecutionEngineService`: `runNode` → `runNodeAsync`,
    `executeLlmNodeStub` удалён.
  - Зависимости: `@anthropic-ai/sdk@0.133.0`, `openai@7.32.0`.
  - 17 новых тестов с замоканными SDK (124 → 148).
  - Smoke: graceful degradation без `ANTHROPIC_API_KEY` — провайдер бросает
    `LlmProviderException`, run → `failed`, `node_runs.error` заполнен; prompt
    в логи не попадает (RULES § 5.9).
- **Runner — R2.2: Executor:**
  - `ExecutionEngineService` (`src/engine/execution-engine.service.ts`):
    `executeAsync(runId, graph)` — обход `plan.levels` (`Promise.allSettled`
    внутри уровня, RULES 4.16; `for...of` между уровнями, прерывание на первом
    failed-узле); `executeNodeAsync` — INSERT `node_runs` (`running`) →
    выполнение → UPDATE (`completed`/`failed`) + публикация `node_started`,
    `node_completed`, `node_failed`; `collectInputsAsync` — параллельное чтение
    `outputs` предшественников (RULES 4.17); `markRunRunningAsync` (в
    transaction), `finishRunAsync`.
  - `src/engine/node-executors.ts`: `executeTextNode` (реальный),
    `executeLlmNodeStub`/`executeImageGenNodeStub` (заглушки),
    `UnsupportedNodeTypeException`.
  - `RunsProcessor` вместо скелета вызывает `ExecutionEngineService`,
    валидирует `snapshot` (Zod) и идемпотентен.
  - 13 новых тестов (95 → 108).
  - Smoke: линейный A→B→C — 3 `node_runs` completed, `inputs[B]` от A, полная
    цепочка событий в Redis pub/sub.
- **Runner — R2.1: подготовка executor'а:**
  - **KI-016:** очередь `workflow-runs` получила `defaultJobOptions`:
    `attempts: 3`, `backoff: exponential 2000ms`, `removeOnComplete`
    (count 100, age 24ч), `removeOnFail` (count 500, age 7д).
  - **KI-014:** jsonb-колонки типизированы через `$type<T>()`
    (`workflows.nodes/edges`, `workflow_runs.snapshot/inputs/outputs`,
    `node_runs.inputs/outputs/logs`); тип snapshot — `GraphSnapshotDto`
    (`src/engine/dto/graph-snapshot.dto.ts`).
  - **KI-015:** в `workflow_runs` добавлен `created_at timestamptz NOT NULL
    DEFAULT now()` + backfill из `started_at` (миграция
    `drizzle/0001_flippant_lockjaw.sql`); `RunResponse.createdAt` читает из
    `created_at`.
  - **KI-003:** ключ в `executionMap.inputs` — `targetHandle ?? sourceHandle ??
    edge.id` (было `targetHandle ?? 'input'`) — multi-input узлы без заданных
    портов больше не перезаписывают друг друга.
  - Pub/sub-инфраструктура: `RedisModule` (`@Global()`, отдельный ioredis-клиент),
    `RunEventSchema` (`src/runs/dto/run-event.dto.ts`), `RunEventsService`
    (`publishAsync`, `subscribeAsync` с `AbortSignal`),
    `runEventsChannel(runId)`.
  - 13 новых тестов (82 → 95).
- **Runner — R1: BullMQ-инфраструктура:**
  - `docker-compose.yml` — сервис `redis` (`redis:7-alpine`, порт 6379, named
    volume, healthcheck); `REDIS_URL=redis://127.0.0.1:6379` в `.env` и
    `.env.example` (хост `127.0.0.1`, не `localhost` — RULES 4.31).
  - `src/config/env.schema.ts` — Zod-схема env + `validateEnv()` (fail-fast при
    старте, RULES 4.5).
  - `RunsModule` (`src/runs/`): DTO (`CreateRunSchema`, Zod-payload job),
    `runs.constants.ts`, `runs.service.ts` (`createRunAsync` — INSERT run +
    snapshot графа + `queue.add`; `getRunAsync` — 404), `runs.controller.ts`
    (`POST /runs` 201, `GET /runs/:id` 200/404), `runs.processor.ts`
    (`@Processor` + `WorkerHost`, скелет), `runs.module.ts`.
  - `src/app.module.ts` — `ConfigModule.forRoot({ isGlobal, cache, validate })` +
    `BullModule.forRootAsync` (Redis URL из `ConfigService`, RULES 4.9).
  - `src/main.ts` — `app.enableShutdownHooks()` (RULES 4.12).
  - 14 новых тестов (68 → 82), включая ветку «Redis упал → run.failed» и
    controller-тесты на supertest.

### Fixed

- **KI-074** — список моделей грузится на старте; новый LLM-узел получает
  `llmModels[0].id`; `TopBar.findNodesWithUnavailableModel` блокирует Run с
  тостом при недоступной модели. Smoke: `POST /runs` не уходит.
- **KI-071** — favicon встроен SVG data-URI в `web/index.html`; консоль чистая.
- **KI-070** — промежуточный провал (`run_completed(failed, final=false)`) больше
  не переводит `runStatus` в `failed`: бейдж продолжает «Выполняется… (попытка
  N/M)», кнопка Run заблокирована до `final=true`.
- **KI-069** — UI отправлял **метку** модели («Claude Opus 4»), а не id: LLM-узел
  из редактора всегда падал с «Модель не поддерживается». Список приходит из
  `GET /llm/models`; `nodeDataFromApi` больше не подменяет неизвестную модель.
  Smoke: Save сохраняет id в `workflows.nodes[].data.model`.
- **KI-046** — job-level replay (KI-040) переигрывал весь граф, включая
  завершённые узлы, — повторные **платные** вызовы LLM при неизменных входах.
  `findReusableNodeRunAsync` проверяет `node_runs` на `status='completed'` +
  `isDeepStrictEqual(inputs)` **до** UPSERT и при совпадении возвращает
  сохранённые `outputs`, не вызывая узел и не публикуя события. +8 тестов,
  включая интеграционный A→B→C (переигрывается только C).
- **KI-047** — UPSERT не сбрасывал `outputs`/`duration_ms`, из-за чего «running»
  показывал результат прошлой попытки. Добавлены
  `outputs: null, durationMs: null`; при попадании в кэш (KI-046) строка не
  перезаписывается вовсе.
- **KI-040** — job-level retry (BullMQ `attempts: 3`) был декоративен: guard в
  `RunsProcessor` отклонял повторную доставку после того, как `executeAsync`
  ставил `failed` и бросал исключение. Guard расширен:
  `pending || isStale || isJobRetry`. Плюс `markRunRunningAsync` сбрасывает
  `error`/`finishedAt`. +5 тестов; smoke с реальным BullMQ retry (backoff
  2s/4s, 3 прогона графа, UPSERT идемпотентен).
- **KI-036** — падение LLM-узла не ретраилось. `LlmProviderException.retryable` +
  классификация 429/5xx/таймаут/сеть против 400/401/403/404
  (`src/llm/provider-errors.ts`); node-level retry: 3 попытки,
  backoff 500ms × 2^(n−1) только для `retryable`, после исчерпания — `throw`
  наружу. +5 тестов.
- **KI-037** — ошибка `buildExecutionPlanAsync` оставляла run в `pending`
  навсегда. Обёрнуто в try/catch; при ошибке — `failRunAsync` (`status='failed'`
  + `error` с деталями цикла через `describePlanError`). +1 тест.
- **KI-031** — повторный запуск зависшего run дублировал `node_runs`. Добавлен
  `unique (run_id, node_id)` + `ON CONFLICT DO UPDATE` в `executeNodeAsync`:
  повторный прогон обновляет ту же строку. Миграция
  `drizzle/0002_steady_molecule_man.sql`.
- **KI-030** — React Flow handle id (`text-output`/`image-output`) не совпадали с
  именами портов исполнителей (`text`/`url`), и `collectInputsAsync` молча клал
  `null` для **всех** UI-графов. Введён единый реестр `NODE_PORT_CONTRACT`
  (`sourceHandleId` + `outputPortName` + `targetHandleId`) и
  `handleIdToOutputPort()` (`src/engine/node-ports.ts`);
  `DEFAULT_OUTPUT_PORT_BY_NODE_TYPE` теперь **выводится** из контракта —
  рассинхрон имён невозможен. +8 тестов (116 → 124).
- **KI-034** — входы узлов нормализованы: ключ в `executionMap.inputs` и
  `node_runs.inputs` теперь **имя порта** (`prompt`/`text`), а не UI-id хендла.
  Fallback `targetHandle → sourceHandle → edge.id` сохранён для узлов без
  контракта. +7 тестов.
- **KI-022** — `executionMap` подставлял несуществующий порт `output` для связей
  без `sourceHandle`, из-за чего `collectInputsAsync` молча клал `null` (R2.2).
  Теперь `fromPort = sourceHandle ?? inferDefaultOutputPort(sourceNode.type)`:
  `text`/`llm` → `'text'`, `image_generation` → `'url'`. +4 теста.
- **KI-023** — зависший запуск при падении worker'а: `workflow_runs` навсегда
  оставался в `running`. Введён lease-guard: повторное выполнение разрешено,
  если `status='running'` и `started_at` старше `RUN_STALE_THRESHOLD_MS`;
  свежий `running` и `started_at=null` пропускаются консервативно. +4 теста.
- **KI-014, KI-015, KI-016, KI-003** — см. блок «R2.1» в `Added`: типизация
  jsonb, `created_at` с backfill, `defaultJobOptions` очереди, контракт ключей
  `executionMap`.
- **KI-010** — `pnpm` 12 перезаписывал `pnpm-lock.yaml` при каждом запуске:
  добавлен `pmOnFail: ignore` в конфиг, lockfile стабилен.

### Changed

- **Husky pre-commit hook** — блокирует коммиты, в которых встречается
  подстрока с реальным ключом Anthropic или OpenAI (`ANTHROPIC_API_KEY=`,
  `OPENAI_API_KEY=`). Заменяет ручную проверку из RULES § 3.12, дополняет
  GitHub Push Protection. `husky 9.1.7` + `lint-staged 17.6.0` (lint-staged пока
  не сконфигурирован — KI-044).
- **Контракт `executionMap`** (KI-003): ключи внутри узла больше не схлопываются
  в `'input'`, если `targetHandle` не задан. Frontend это поле не использует
  (KI-020), executor использует с R2.2.

---

## [0.3.0] — 2026-10-13

**Frontend: визуальный редактор графа (React Flow + Zustand + Tailwind v4).**

### Added

- **Frontend — Task 3: сохранение, загрузка и предпросмотр плана:**
  - `web/src/lib/api.ts` — типизированный клиент API: Zod-валидация ответов,
    `requestAsync<T>` с обработкой сетевых и HTTP-ошибок, 6 endpoints.
  - `web/src/lib/plan.ts` — `levelsToMap` (`string[][]` →
    `Record<string, number>`).
  - `TopBar` — редактируемое имя workflow, кнопки Load / Save / Run.
  - `LoadModal` — список workflow, открытие / удаление, Escape.
  - `Toast` — inline-уведомления (без библиотек).
  - Store: `currentWorkflowId`, `currentWorkflowName`, `executionLevels`,
    `saveWorkflowAsync`, `loadWorkflowAsync`, `runPlanAsync`.
  - `BaseNode` — badge уровня выполнения (серый кружок с номером).
  - Синхронизация URL: после первого Save → `?workflowId=` через
    `history.replaceState`; при перезагрузке — fetch по id.
  - `executionLevels` сбрасывается при `addNode` / `onConnect` / `load`.
  - Проверено на живом backend: Save → POST, повторный Save → PATCH того же id,
    Run на diamond A→B/C→D → `{A:1, B:2, C:2, D:3}` и badges, Load → граф
    заменён, reload `?workflowId=` → узлы восстановлены, 0 ошибок в консоли.
- **Frontend — Task 2: кастомные ноды и порты:**
  - `TextNode`, `LLMNode`, `ImageGenNode` + презентационная обёртка `BaseNode`.
  - Типизированные порты: T (синий `#3b82f6`), G (зелёный `#22c55e`), 10px +
    белая обводка + подпись рядом.
  - `TextNode` — textarea (3 строки) с плейсхолдером и `nodrag`;
    `LLMNode` — select моделей + подсказка скорости;
    `ImageGenNode` — плейсхолдер результата + disabled select.
  - Регистрация через `nodeTypes` в `ReactFlow`; сеточная раскладка 280×190;
    `fitViewOptions: { maxZoom: 1 }`; `defaultEdgeOptions: { strokeWidth: 2 }`.
  - Проверка в headless Chrome + CDP: ввод текста и смена модели доходят до
    Zustand, порты соединяются, 0 ошибок в консоли.
- **Frontend — Task 1: отдельный пакет `web/`:**
  - Vite 8 + React 19 + TypeScript 6 (strict, ESM) + Tailwind CSS v4
    (CSS-based config).
  - React Flow v12 (`@xyflow/react`) — canvas с сеткой, controls, minimap.
  - Zustand store (`useWorkflowStore`) для `nodes`/`edges`.
  - `Toolbar` с 3 кнопками (Text / LLM / Image Generation).
  - Vite proxy: `/workflow` и `/engine` → `http://localhost:3000`.
  - Dev-only `window.__wfStore` для отладки в DevTools.
  - Проверка в headless Chrome + CDP: 3 ноды, 2 связи, 0 ошибок.

---

## [0.2.0] — 2026-10-12

**Backend: CRUD workflow и Engine (топологическая сортировка).**

### Added

- **Engine:**
  - `EngineService` — топологическая сортировка (алгоритм Кана), валидация
    графа, построение плана выполнения с уровнями параллелизма.
  - DTO: `PositionSchema`, `NodeSchema`, `EdgeSchema`, `GraphSchema`
    (`src/engine/dto/`).
  - `EngineController` — 3 endpoints: `POST /engine/validate`, `/sort`, `/plan`.
  - 29 тестов (+26 service, +3 controller). Всего: **68**.
- **CRUD Workflow:**
  - `ZodValidationPipe` (`src/common/pipes/`) — валидация body/query/param через
    Zod 4, `static create(schema)` для использования в декораторах.
  - DTO: `CreateWorkflowSchema`, `UpdateWorkflowSchema`,
    `ListWorkflowsQuerySchema` (`src/workflow/dto/`).
  - `WorkflowService` — 5 методов (`createAsync`, `findAllAsync`, `findOneAsync`,
    `updateAsync`, `removeAsync`) на Drizzle ORM + pg driver.
  - `WorkflowController` — 5 REST endpoints
    (`POST/GET/GET:id/PATCH/DELETE /workflow`).
  - Multi-tenant readiness: необязательный `userId`-фильтр во всех методах.
  - 31 тест (было 7): +18 service, +8 controller, −2 заменено.

### Fixed

- **PATCH `/workflow/:id` с пустым body** возвращал 200 вместо 400.
  `UpdateWorkflowSchema` переписан без `.partial()` — defaults на
  `nodes`/`edges` больше не блокируют `.refine()`; `userId` исключён из
  update-схемы.

---

## [0.1.0] — 2026-10-12

**Первый рабочий каркас.** Проект инициализирован, поднят NestJS 12 + ESM + Vitest,
подключена PostgreSQL через Drizzle ORM, создана схема данных для workflow / runs / node_runs.

### Added
- **Инициализация проекта:**
  - NestJS 12 (ESM, TypeScript 6, strict mode).
  - Vitest как test-runner (7 тестов-заглушек).
  - oxlint + Prettier.
- **Зависимости (runtime):**
  - `@nestjs/config`, `@nestjs/bullmq`, `bullmq`, `ioredis` — очереди и конфиг.
  - `drizzle-orm` + `postgres` — PostgreSQL клиент.
  - `zod` — валидация.
  - `@nestjs/passport`, `@nestjs/jwt` — auth (задел).
  - `pino`, `nestjs-pino` — структурированные логи.
  - `dotenv` — загрузка `.env` в runtime.
- **Зависимости (dev):**
  - `drizzle-kit`, `@nestjs/testing`, `tsx`.
- **Модули-скелеты:**
  - `WorkflowModule` + Service + Controller + spec.
  - `EngineModule` + Service + Controller + spec.
  - `NodesModule` + Service + Controller + spec.
- **Drizzle / PostgreSQL:**
  - `drizzle.config.ts` — конфиг drizzle-kit с dotenv.
  - `src/db/schema.ts` — 3 таблицы: `workflows`, `workflow_runs`, `node_runs`
    + relations (one-to-many, cascade delete).
  - `src/db/db.module.ts` — `@Global()` NestJS-модуль с токенами `DRIZZLE` и `DB_SCHEMA`.
  - Миграция `drizzle/0000_*.sql`.
  - Скрипты: `db:generate`, `db:migrate`, `db:push`, `db:studio`.
- **Runtime fix:**
  - `import 'dotenv/config'` в `src/main.ts` — иначе NestJS не видит `.env`
    (в отличие от `drizzle-kit`, который читает его сам).
- **Документация:**
  - `docs/development/RULES.md` v1.0.0 — 88 правил для TS/NestJS/ESM/Drizzle.
  - `docs/CHANGELOG.md` (этот файл).
  - `docs/KNOWN_ISSUES.md` — пустой реестр.
  - `docs/development/PROMPT_V1.md` — стартовый промпт для новых чатов.

### Changed
- **Git-author** — переключён на нейтральный `dev@workflow-builder.local`
  (по аналогии с инцидентом KI-039 в IIChatTools).

### Planned

> **Внимание:** KI-номера в этом разделе — **исторические идентификаторы
> фич из плана v0.1.0**, а не ссылки на реестр `KNOWN_ISSUES.md`.
> С момента создания реестра нумерация разошлась: например, здесь
> `KI-106` = «Аутентификация», в реестре `KI-106` = «Идемпотентность
> media». Актуальные записи — только в `KNOWN_ISSUES.md` (см. KI-209).

- **KI-101** — Visual canvas для редактирования workflow (React + @xyflow/react).
- **KI-102** — LLM-провайдеры (Anthropic, OpenAI, локальные).
- **KI-103** — Image-generation провайдеры (Replicate, FAL, OpenAI Images).
- **KI-104** — BullMQ-оркестрация + SSE-стриминг прогресса.
- **KI-105** — Node types: `text`, `llm`, `image_generation`, `http`, `condition`, `output`.
- **KI-106** — Аутентификация (JWT + Passport).
- **KI-107** — Публичный share workflow (read-only ссылка).
- **KI-108** — Экспорт / импорт workflow (JSON).
- **KI-109** — Templates (пресеты: Text→Image, Text→LLM→Image, ...).

### Security
- **`.env`** — в `.gitignore`, содержит только dev-секреты
  (`workflow_dev_password` — локальный PostgreSQL в Docker).
- **Публичный репозиторий** — email автора обезличен.





















