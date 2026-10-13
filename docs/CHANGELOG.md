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

- **Runner — v0.5.0: мультипровайдерная поддержка LLM (2026-10-13):**
  - `LlmProviderFactory` — конфиг-массив провайдеров из env.
    Провайдер попадает в список **только если задан его ключ**
    (LM Studio — при непустом `LMSTUDIO_MODELS`).
  - `OpenAiCompatibleProvider` — единый класс для любого
    OpenAI-совместимого API (`/chat/completions`): OpenAI,
    RouterAI, DeepSeek, Yandex AI Studio, LM Studio.
  - `AnthropicProvider` — без изменений (свой SDK).
  - Конфликт id моделей: **первый провайдер побеждает**,
    `logger.warn`. Порядок фабрики — единственный источник
    приоритета.
  - **KI-084:** `emptyToUndefined` через `z.preprocess` — пустая
    строка в env = undefined. `.env.example` копируется как есть.
  - **KI-085:** `httpUrl = z.url({ protocol: /^https?$/ })` —
    только http/https.
  - `.env.example` — секции Anthropic / OpenAI / RouterAI /
    DeepSeek / Yandex / LM Studio.
  - +21 тест (236 → 257).
  - Smoke: `GET /llm/models` возвращает модели нескольких
    провайдеров одновременно.

### Fixed
- **KI-084** — пустой `OPENAI_BASE_URL=` больше не роняет старт.
- **KI-085** — `z.url()` теперь отсекает не-http(s) схемы.

- **Runner — R5.0: `OPENAI_BASE_URL` (2026-10-13):**
  - `OPENAI_BASE_URL` в env — для OpenAI-совместимых API (RouterAI,
    DeepSeek, Yandex, LM Studio). Прокидывается в SDK `openai`
    как `baseURL`; без переменной — дефолт SDK.
  - `.env.example` — примеры URL для RouterAI / DeepSeek / Yandex.
  - +7 тестов (229 → 236).

### Known Issues
- KI-084 (пустой `OPENAI_BASE_URL=` в `.env` роняет старт),
  KI-085 (`z.url()` не ограничивает схему http/https).

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
