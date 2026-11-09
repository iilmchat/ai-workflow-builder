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
