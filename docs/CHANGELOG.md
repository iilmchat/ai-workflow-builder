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
- **Frontend — R4.2: EventSource + подсветка нод (v0.3.11):**
  - `Run` выполняет реальный `POST /runs` и подписывается на SSE.
    Ноды подсвечиваются в реальном времени: серые → синие → зелёные
    (успех) / красные (провал).
  - `web/src/types/run-stream.ts` — Zod-схемы SSE-сообщений (зеркало
    backend `RunStreamMessageSchema`).
  - `web/src/lib/run-stream.ts` — `subscribeToRunStream` со счётчиком
    ошибок (3 → close). Таймаут «нет сообщений» **не** используется:
    SSE keep-alive-комментарии не видны в JS, и таймер оборвал бы
    живой долгий LLM-вызов.
  - `stores/workflow.ts` — `runId`/`runStatus`/`nodeStatuses`/`nodeOutputs`.
    `applySnapshot` **заменяет** карты (snapshot — источник истины
    при переподключении). `final=true` → close.
  - `BaseNode` — `border-2` + `bg-*-50` по статусу; `data-status`
    для e2e.
  - `TopBar` — бейдж статуса, кнопка Run блокируется во время
    выполнения; авто-Save перед Run, если workflow не сохранён.
  - `vite.config.ts` — `/runs` proxy с `timeout: 0`/`proxyTimeout: 0`
    (дефолт убил бы долгий SSE-поток).
  - Smoke (CDP, headless Chrome): провал — 3 попытки BullMQ
    (серый → синий → красный × 3, badge «Выполняется… (попытка
    N/M)» → «Ошибка»), `streamClosed: true` на `final=true`.
    Успех (text→text) — обе ноды зелёные, badge «Готово», поток
    закрыт. Zero console errors.
- **Runner — KI-065 + KI-032: конфигурируемый воркер (v0.3.10):**
  - `WorkerEnvSchema` в `env.schema.ts` — единый источник дефолтов
    и границ; встроена в `EnvSchema` через `.shape`, поэтому
    `ConfigModule` и `@Processor` валидируют одно и то же.
  - `src/runs/runs.worker-options.ts` — читает env в момент загрузки
    модуля (декораторы вне DI). Значения валидируются Zod **до**
    передачи в BullMQ (`Number('abc') = NaN` не утечёт).
  - `@Processor(WORKFLOW_RUNS_QUEUE, WORKFLOW_RUNS_WORKER_OPTIONS)`:
    `concurrency` (default 5), `lockDuration` (default 300 000),
    `maxStalledCount` (default 2) — из env.
  - `RUN_STALE_THRESHOLD_MS` удалён из `runs.constants.ts`; значение
    берётся из `WORKFLOW_RUNS_STALE_THRESHOLD_MS` (default 300 000).
    Единый источник — без расхождения prod/тестов.
  - 12 новых тестов (217 → 229).
  - Smoke: `concurrency=2` → `max simultaneously running = 2`
    (до правки — 1). `concurrency=1` → регресс 1.
  - Env fail-fast: `0` / `100` / `abc` → `exit=1`.
- **Runner — KI-060: явный признак финальности `run_completed` (v0.3.9):**
  - `run_completed` несёт `final: boolean` (KI-060) — эвристика
    `attemptsMade >= attempts - 1` ломалась на детерминированных
    провалах планирования (цикл: `executeAsync` не пробрасывает,
    job успешен, retry не будет).
  - `RunsProcessor` — **единственный** публикатор `run_completed`:
    только он знает и результат (`return`/`throw`), и состояние
    попыток job'а. `ExecutionEngineService` больше **не** публикует
    `run_completed`. `RunAttemptContext` удалён —
    `executeAsync(runId, graph)` снова с двумя аргументами.
  - `runs-stream.service` закрывает поток чисто по `event.final`;
    `isFinalCompletion` удалён.
  - 8 новых тестов, 5 обновлённых (209 → 217).
  - Smoke A (job retry): `final=false` на 0/3, 1/3; `final=true`
    на 2/3 — поток закрыт.
  - Smoke B (цикл): `run_completed(final=true)` сразу, поток закрыт
    за 1.3 с (было: curl exit=28, висело).
- **Runner — KI-059: сигнал исчерпания попыток (v0.3.8):**
  - `RunEventSchema.run_completed` несёт `attemptsMade` и `attempts`
    (из job в процессоре). SSE-поток закрывается только на
    **финальном** `run_completed`: `completed`, или `failed` с
    `attemptsMade >= attempts - 1`. `attempts=null` — поток остаётся
    открытым (неизвестный лимит ≠ «повторов не будет»).
  - Smoke: 3 job-retry (мёртвый `ANTHROPIC_BASE_URL`) — поток
    открыт на 0/3 и 1/3, закрывается после 2/3.
  - 7 новых тестов (202 → 209).
  - **Остаток:** KI-060 (финальность нельзя надёжно вывести из
    attemptsMade/attempts при детерминированных провалах),
    KI-061 (причина провала недоступна клиенту).
- **Runner — R4.1: SSE + список моделей (v0.3.7):**
  - `GET /runs/:id/stream` — SSE-поток прогресса запуска
    (`@Sse()` + `@SseSignal()`). Первым сообщением — `snapshot`
    (KI-049: run + все `node_runs`), далее — события из Redis
    pub/sub. Закрытие — только на `run_completed(completed)`:
    при KI-040 `failed`-run может быть переигран. Keep-alive
    `: keep-alive` раз в 15 с — защита от `proxy_read_timeout`.
  - `src/runs/dto/run-stream-message.dto.ts` — `RunStreamMessageSchema`
    (discriminatedUnion `RunEventSchema` + `SnapshotMessageSchema`).
    `RunEventSchema` (pub/sub-контракт) не менялся.
  - `GET /llm/models` (KI-056) — `LlmController` отдаёт
    `LlmRegistryService.listModels()` (отфильтровано по
    `isConfigured` из KI-039). Без envelope.
  - 12 новых тестов (190 → 202).
- **Runner — KI-039 + KI-052: провайдеры и стоимость (v0.3.6):**
  - `ILlmProvider.isConfigured` (KI-039) — геттер `client !== null`.
  - `LlmRegistryService.listModels()` фильтрует неконфигурированные
    провайдеры. `resolveByModel` **не** фильтрует (маршрутизация
    ≠ готовность; ошибка «API_KEY не задан» всплывает на вызове).
  - `calculateCostUsd` возвращает `null`, если провайдер не отдал
    usage (KI-052). `cost_usd = 0` больше не означает «бесплатный
    вызов» — «неизвестно» отделено от «ноль».
  - 7 новых тестов (183 → 190).
- **Runner — KI-038: метрики LLM-узлов (v0.3.6):**
  - `ILlmProvider.generateAsync` теперь возвращает
    `LlmGenerateResult` (`{ text, usage }`) вместо `Promise<string>`.
    Breaking change, dev-only.
  - `src/llm/providers/anthropic.provider.ts` и `openai.provider.ts` —
    `extractUsage` с явным narrowing из `unknown` (RULES § 1.17).
  - `src/llm/model-pricing.ts` (новый) — `MODEL_PRICING` +
    `calculateCostUsd`.
  - `LlmNodeExecutor.executeAsync` возвращает `{ outputs, metrics }`;
    метрики пишет `ExecutionEngineService` (вариант A: executor не
    трогает БД, БД-запись остаётся в engine — он владеет `node_runs`
    и UPSERT'ом из KI-031/KI-047).
  - `node_runs.tokens_in/tokens_out/cost_usd` заполняются; в UPSERT
    сбрасываются (не «прилипают» к новой попытке).
  - 11 новых тестов (172 → 183).
- **Runner — R3: LLM-провайдеры (v0.3.4):**
  - `src/llm/llm-provider.interface.ts` — `ILlmProvider`,
    `LlmGenerateOptions`, `LlmProviderException`.
  - `src/llm/providers/anthropic.provider.ts` — Claude Opus 4 /
    Sonnet 4, `@anthropic-ai/sdk`.
  - `src/llm/providers/openai.provider.ts` — GPT-4o / 4o-mini,
    `openai`.
  - `src/llm/llm-registry.service.ts` — `resolveByModel()` +
    `listModels()`.
  - `src/llm/llm.service.ts` — единая точка вызова + `AbortSignal`
    timeout 60s (RULES § 4.19).
  - `src/llm/llm-node-executor.service.ts` — DI-исполнитель узла `llm`
    (вариант B: `node-executors.ts` остались чистыми функциями).
  - `LlmModule` — `exports: [LlmService, LlmNodeExecutor]`.
  - `ExecutionEngineService`: `runNode` → `runNodeAsync`,
    `executeLlmNodeStub` удалён.
  - Зависимости: `@anthropic-ai/sdk@0.133.0`, `openai@7.32.0`.
  - 17 новых тестов с замоканными SDK (124 → 148).
  - Smoke: graceful degradation без `ANTHROPIC_API_KEY` — провайдер
    бросает `LlmProviderException`, run → `failed`, `node_runs.error`
    заполнен; prompt в логи не попадает (RULES § 5.9).

### Changed
- **Husky pre-commit hook** (`d8a642d`) — блокирует коммиты, в которых
  встречается подстрока с реальным ключом Anthropic или OpenAI,
  (`ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`). Заменяет ручную проверку
  из RULES § 3.12. Дополняет GitHub Push Protection.
  `husky 9.1.7` + `lint-staged 17.6.0` (lint-staged пока не
  сконфигурирован — KI-044).
- **KI-034** — входы узлов нормализованы: ключ в `executionMap.inputs`
  и `node_runs.inputs` теперь **имя порта** (`prompt` / `text`),
  не UI-id хендла. Fallback на `targetHandle → sourceHandle → edge.id`
  сохранён для узлов без контракта. +7 тестов. Остаток — KI-035
  (multi-input схлопывается в один ключ).

### Known Issues
- KI-056 (`GET /llm/models` эндпоинт — R4), KI-057 (смена ключа не
  подхватывается без перезапуска), KI-058 (`isConfigured` = «ключ
  задан», не «работает»).
- KI-052 (cost 0 when usage missing), KI-053 (failed-attempt tokens
  unaccounted), KI-054 (no workflow_runs aggregate),
  KI-055 (static price list).
- KI-049 (reused nodes invisible in SSE stream), KI-050
  (deep-equal over full JSONB, prefer inputs_hash), KI-051
  (cache scoped to a single runId).
- Заведены KI-035…KI-039. Ключевой: **KI-036** (🟠 High) — падение
  узла не ретраится, `attempts: 3` из KI-016 работает только для
  инфраструктурных сбоев. Транзиентная ошибка LLM (429/500/таймаут)
  убивает run без повторов.

### Fixed
- **KI-069** — UI отправлял **метку** модели («Claude Opus 4»),
  а не id; LLM-узел из редактора всегда падал с «Модель не
  поддерживается». `LLM_MODELS`/`LlmModel`/`LLM_MODEL_HINTS`
  удалены; список приходит из `GET /llm/models` и кэшируется
  в store. `nodeDataFromApi` больше не подменяет неизвестную
  модель — селект показывает её как «(недоступно)». Smoke: Save
  сохраняет id. Плюс добавлен `/llm` proxy в `vite.config.ts`.
- **KI-070** — промежуточный провал (`run_completed(failed,
  final=false)`) больше не переводит `runStatus` в `failed`;
  бейдж продолжает «Выполняется… (попытка N/M)», кнопка Run
  заблокирована до `final=true`.
- **KI-046** — job-level replay (KI-040) переигрывал весь граф,
  включая завершённые узлы, — повторные **платные** вызовы LLM при
  неизменных входах. `findReusableNodeRunAsync` проверяет
  `node_runs` на `status='completed'` + `isDeepStrictEqual(inputs)`
  **до** UPSERT и, если совпало, возвращает сохранённые `outputs`,
  не вызывая узел и не публикуя события. +8 тестов, включая
  интеграционный A→B→C (только C переигрывается).
- **KI-047** — UPSERT не сбрасывал `outputs`/`duration_ms`, из-за чего
  «running» показывал результат прошлой попытки. Добавлены
  `outputs: null, durationMs: null`; при попадании в кэш (KI-046)
  строка не перезаписывается вовсе.
- **KI-040** — job-level retry (BullMQ `attempts: 3` из KI-016) был
  декоративен: guard в `RunsProcessor` отклонял повторную доставку
  после того, как `executeAsync` ставил `failed` и бросал исключение.
  Guard расширен: `pending || isStale || isJobRetry`, где
  `isJobRetry = job.attemptsMade > 0 && status === 'failed'`. Плюс
  `markRunRunningAsync` сбрасывает `error`/`finishedAt` (иначе UI
  видел бы «running с ошибкой», а повторная смерть worker'а — «running»
  со старым `finished_at`). +5 тестов. Smoke с реальным BullMQ retry
  (backoff 2s/4s, 3 прогона графа, UPSERT идемпотентен).
- **KI-031** — повторный запуск зависшего run дублировал `node_runs`.
  Добавлен `unique (run_id, node_id)` + `ON CONFLICT DO UPDATE` в
  `executeNodeAsync`; повторный прогон обновляет ту же строку.
  Миграция `drizzle/0002_steady_molecule_man.sql`.
- **KI-036** — падение LLM-узла не ретраилось (`attempts: 3` покрывал
  только инфраструктурные сбои). `LlmProviderException.retryable` +
  классификация 429/5xx/таймаут/сеть vs 400/401/403/404
  (`src/llm/provider-errors.ts`). Node-level retry: 3 попытки,
  backoff 500ms × 2^(n−1), только для `retryable`. После исчерпания
  — `throw` наружу. +5 тестов.
- **KI-037** — ошибка `buildExecutionPlanAsync` оставляла run в
  `pending` навсегда. Обёрнуто в try/catch; при ошибке — `failRunAsync`
  (status='failed' + `error` с деталями цикла через
  `describePlanError`). +1 тест.
- **KI-030** — React Flow handle id (`text-output` / `image-output`)
  не совпадали с именами портов исполнителей (`text` / `url`);
  `collectInputsAsync` молча клал `null` для **всех** UI-графов.
  Введён единый реестр `NODE_PORT_CONTRACT` (`sourceHandleId` +
  `outputPortName` + `targetHandleId`) и `handleIdToOutputPort()`
  (`src/engine/node-ports.ts`). `fromPort = handleIdToOutputPort(...)
  ?? inferDefaultOutputPort(...)`. `DEFAULT_OUTPUT_PORT_BY_NODE_TYPE`
  теперь **выводится** из контракта — рассинхрон имён невозможен.
  +8 тестов (116 → 124). Smoke: UI-граф (`sourceHandle='text-output'`) —
  `B.inputs` не пустой. Остаток — KI-033 (неизвестный хэндл) и
  KI-034 (асимметрия входов/выходов).
- **KI-030** — React Flow handle id (`text-output` / `image-output`)
  не совпадали с именами портов исполнителей (`text` / `url`);
  `collectInputsAsync` молча клал `null` для **всех** UI-графов.
  Введён единый реестр `NODE_PORT_CONTRACT` (`sourceHandleId` +
  `outputPortName` + `targetHandleId`) и `handleIdToOutputPort()`
  (`src/engine/node-ports.ts`). `fromPort = handleIdToOutputPort(...)
  ?? inferDefaultOutputPort(...)`. `DEFAULT_OUTPUT_PORT_BY_NODE_TYPE`
  теперь **выводится** из контракта — рассинхрон имён невозможен.
  +8 тестов. Остаток — KI-033 (неизвестный хэндл) и KI-034
  (асимметрия входов/выходов).
- **KI-022** — `executionMap` подставлял несуществующий порт `output`
  для связей без `sourceHandle`; `collectInputsAsync` молча клал `null`
  (R2.2). Теперь `fromPort = sourceHandle ??
  inferDefaultOutputPort(sourceNode.type)`: `text`/`llm` → `'text'`,
  `image_generation` → `'url'`. Реестр портов — `src/engine/node-ports.ts`
  (отдельно от `node-executors.ts`, чтобы планировщик не зависел
  от исполнителей). +4 теста (28 → 32 в `engine.service.spec`).
- **KI-023** — зависший запуск при падении worker'а: `workflow_runs`
  навсегда оставался в `running`, потому что BullMQ re-deliver
  пропускался guard'ом `status !== 'pending'`. Введён lease-guard:
  повторное выполнение разрешено, если `status='running'` и
  `started_at` старше `RUN_STALE_THRESHOLD_MS` (5 мин). Свежий
  `running` — пропускается, `started_at=null` — консервативно
  пропускается. Вариант A (не сбрасываем в `pending`). +4 теста
  (6 → 10 в `runs.processor.spec`).

### Known Issues
- KI-030 (🔴 Critical для UI-графов) — React Flow handle id
  (`text-output`/`image-output`) не совпадают с именами портов
  исполнителей (`text`/`url`). KI-022 закрыл только случай
  «`sourceHandle` не задан вовсе».
- KI-031 (🟡 Medium) — повторный запуск зависшего run дублирует
  `node_runs` (нет очистки/upsert по `(run_id, node_id)`).
- KI-032 (🟠 High) — аренда по `started_at` без heartbeat:
  `RUN_STALE_THRESHOLD_MS` захардкожена, wall-clock без продления.

### Fixed
- **KI-022** — `executionMap` подставлял несуществующий порт `output`
  для связей без `sourceHandle`, из-за чего `collectInputsAsync` молча
  клал `null` (R2.2). Теперь `fromPort = sourceHandle ??
  inferDefaultOutputPort(sourceNode.type)`: text/llm → `'text'`,
  image_generation → `'url'`. Реестр портов — `src/engine/node-ports.ts`
  (отдельно от `node-executors.ts`, чтобы планировщик не зависел от
  исполнителей). +4 теста.
- **KI-023** — зависший запуск при падении worker'а. `workflow_runs`
  навсегда оставался в `running`, потому что BullMQ re-deliver
  пропускался guard'ом `status !== 'pending'`. Введён lease-guard:
  повторное выполнение разрешено, если `status='running'` и
  `started_at` старше `RUN_STALE_THRESHOLD_MS` (5 мин). Свежий
  running — пропускается, `started_at=null` — консервативно
  пропускается. Вариант A (не сбрасываем в pending). +4 теста.

### Added
- **Runner — R2.2: Executor (v0.3.3):**
  - `ExecutionEngineService` (`src/engine/execution-engine.service.ts`):
    - `executeAsync(runId, graph)` — обход `plan.levels`:
      `Promise.allSettled` внутри уровня (RULES 4.16), `for...of`
      между уровнями. Прерывание на первом failed-узле.
    - `executeNodeAsync` — INSERT `node_runs` (`running`) → выполнение
      → UPDATE (`completed`/`failed`) + публикация `node_started`,
      `node_completed`, `node_failed`.
    - `collectInputsAsync` — параллельное чтение `outputs` предшественников
      (RULES 4.17), `null` при отсутствии порта.
    - `markRunRunningAsync` (в transaction), `finishRunAsync`.
  - `src/engine/node-executors.ts`:
    - `executeTextNode` — реальный: отдаёт `data.value` как `{ text }`.
    - `executeLlmNodeStub` — заглушка `{ text: '[LLM stub — R3]' }`.
    - `executeImageGenNodeStub` — заглушка `{ url: null }`.
    - `UnsupportedNodeTypeException` (extends Error, не HttpException).
  - `RunsProcessor` — вместо скелета вызывает `ExecutionEngineService`;
    валидирует `snapshot` (Zod); идемпотентен (`status !== 'pending'`
    → return для ретраев BullMQ).
  - `EngineModule` — `exports: [EngineService]`.
  - `RunsModule` — `imports: [EngineModule]`,
    `providers: [..., ExecutionEngineService]`.
  - 13 новых тестов (95 → 108): executor (7), processor (6).
  - Smoke: линейный A→B→C — 3 `node_runs` completed, `inputs[B]` от A,
    полная цепочка событий в Redis pub/sub.

### Known Issues
- Заведены KI-022…KI-029. Ключевые: KI-022 (дефолтный порт `output`
  не существует ни у одного узла — тихая потеря данных), KI-023
  (зависший run при падении worker'а).
- **Runner — R2.2: Executor (v0.3.3):**
  - `ExecutionEngineService` (`src/engine/execution-engine.service.ts`):
    - `executeAsync(runId, graph)` — обход `plan.levels`:
      `Promise.allSettled` внутри уровня (RULES 4.16), `for...of`
      между уровнями. Прерывание на первом failed-узле.
    - `executeNodeAsync` — INSERT `node_runs` (`running`) → выполнение
      → UPDATE (`completed`/`failed`) + публикация `node_started`,
      `node_completed`, `node_failed`.
    - `collectInputsAsync` — чтение `outputs` предшественников
      параллельно (RULES 4.17), `null` при отсутствии порта.
    - `markRunRunningAsync` (в transaction), `finishRunAsync`.
  - `src/engine/node-executors.ts`:
    - `executeTextNode` — реальный: отдаёт `data.value` как `{ text }`.
    - `executeLlmNodeStub` — заглушка `{ text: '[LLM stub — R3]' }`.
    - `executeImageGenNodeStub` — заглушка `{ url: null }`.
    - `UnsupportedNodeTypeException` (extends Error, не HttpException).
  - `RunsProcessor` — вместо скелета вызывает `ExecutionEngineService`;
    валидирует `snapshot` (Zod); идемпотентен (`status !== 'pending'`
    → return для ретраев BullMQ).
  - `EngineModule` — `exports: [EngineService]`.
  - `RunsModule` — `imports: [EngineModule]`, `providers:
    [..., ExecutionEngineService]`.
  - 13 новых тестов (95 → 108): executor (7, в т.ч. diamond, падение
    узла, UnsupportedNodeTypeException, пустой граф), processor (6,
    в т.ч. идемпотентность, битый snapshot).
  - Smoke: линейный A→B→C — 3 `node_runs` completed, `inputs[B]`
    от A, полная цепочка событий в Redis pub/sub (проверено через
    `redis-cli PSUBSCRIBE run:*` + ioredis-подписчик).

### Known Issues
- Заведены KI-022…KI-029. Ключевые: KI-022 (дефолтный порт `output`
  не существует ни у одного узла — тихая потеря данных), KI-023
  (зависший run при падении worker'а).
### Fixed
- **Runner — R2.1: подготовка executor'а (v0.3.2):**
  - **KI-016:** очередь `workflow-runs` получила `defaultJobOptions`:
    `attempts: 3`, `backoff: exponential 2000ms`, `removeOnComplete`
    (count 100, age 24ч), `removeOnFail` (count 500, age 7д).
  - **KI-014:** jsonb-колонки типизированы через `$type<T>()`:
    `workflows.nodes/edges`, `workflow_runs.snapshot/inputs/outputs`,
    `node_runs.inputs/outputs/logs`. Тип snapshot — `GraphSnapshotDto`
    (новая Zod-схема в `src/engine/dto/graph-snapshot.dto.ts`).
  - **KI-015:** в `workflow_runs` добавлен `created_at timestamptz NOT NULL
    DEFAULT now()` + backfill из `started_at` (миграция
    `drizzle/0001_flippant_lockjaw.sql`). `RunResponse.createdAt` теперь
    читает из `created_at`, а не из `started_at`.
  - **KI-003:** `EngineService.buildExecutionPlanAsync` — ключ в
    `executionMap.inputs` теперь `targetHandle ?? sourceHandle ?? edge.id`
    (было `targetHandle ?? 'input'`). Multi-input узлы без заданных
    портов больше не перезаписывают друг друга.
  - Pub/sub-инфраструктура:
    - `src/redis/redis.module.ts` — `@Global()` `RedisModule` +
      `InjectRedis()`, отдельный ioredis-клиент (не пул BullMQ).
    - `src/runs/dto/run-event.dto.ts` — `RunEventSchema` (discriminated
      union): `run_started`, `node_started`, `node_completed`,
      `node_failed`, `run_completed`.
    - `src/runs/run-events.service.ts` — `RunEventsService`
      (`publishAsync`, `subscribeAsync` с `AbortSignal`).
    - `src/runs/runs.constants.ts` — `runEventsChannel(runId)`.
  - 13 новых тестов (82 → 95): engine (+2, KI-003), runs.service
    (+1, KI-015), run-event.dto (3), run-events.service (3),
    schema.spec (4).
  - `src/workflow/workflow.service.ts` — точечный каст `nodes`/`edges`
    в `updateAsync` (следствие KI-014, см. KI-017).

### Changed
- **Контракт `executionMap`** (KI-003): ключи внутри узла больше не
  схлопываются в `'input'`, если `targetHandle` не задан. Frontend это
  поле не использует (KI-020), executor R2.2 — будет.

### Known Issues
- Заведены KI-017…KI-021. Ключевые: KI-017 (CRUD без Zod-валидации
  графа + `z.any()`), KI-018 (разнобой timestamptz / timestamp).

### Added
- **Runner — R1: BullMQ-инфраструктура (v0.3.1):**
  - `docker-compose.yml` — сервис `redis` (`redis:7-alpine`, порт 6379,
    named volume `redis-data`, healthcheck `redis-cli ping`).
  - `REDIS_URL=redis://127.0.0.1:6379` в `.env` + `.env.example`
    (хост — `127.0.0.1`, не `localhost` — RULES 4.31).
  - `src/config/env.schema.ts` — Zod-схема env + `validateEnv()`
    (fail-fast при старте, RULES 4.5).
  - `RunsModule` (`src/runs/`):
    - `dto/create-run.dto.ts` — `CreateRunSchema` (uuid workflowId).
    - `dto/execute-run-job.dto.ts` — Zod-payload job (RULES 1.17).
    - `dto/index.ts` — barrel.
    - `runs.constants.ts` — `WORKFLOW_RUNS_QUEUE`, job name `execute`.
    - `runs.service.ts` — `createRunAsync` (INSERT run + snapshot графа +
      `queue.add('execute', { runId })`), `getRunAsync` (404 при отсутствии).
    - `runs.controller.ts` — `POST /runs` (201), `GET /runs/:id` (200/404).
    - `runs.processor.ts` — `@Processor('workflow-runs')` +
      `extends WorkerHost`, скелет: логирует job и помечает run
      `status='completed'`. Executor — R2.
    - `runs.module.ts` — `registerQueue` + providers/controllers.
  - `src/app.module.ts` — `ConfigModule.forRoot({ isGlobal, cache, validate })` +
    `BullModule.forRootAsync` (Redis URL из `ConfigService`, без хардкода,
    RULES 4.9) + `RunsModule`.
  - `src/main.ts` — `app.enableShutdownHooks()` (RULES 4.12).
  - 14 новых тестов (68 → 82): DTO (3), Service (6, включая ветку
    «Redis упал → run.failed»), Controller (5, supertest 201/400/404).

### Known Issues
- Заведены KI-010…KI-016 (см. `docs/KNOWN_ISSUES.md`).
  Ключевые: KI-010 (pnpm 12 перезаписывает lockfile), KI-016
  (очередь без `defaultJobOptions` — нет ретраев).
- **Frontend — Task 3 (v0.3.0):**
  - `web/src/lib/api.ts` — типизированный клиент API: Zod-валидация ответов,
    `requestAsync<T>` с обработкой сетевых и HTTP-ошибок, 6 endpoints.
  - `web/src/lib/plan.ts` — `levelsToMap` (`string[][]` → `Record<string, number>`).
  - `TopBar` — редактируемое имя workflow, кнопки Load / Save / Run.
  - `LoadModal` — список workflow, открытие / удаление, Escape.
  - `Toast` — inline-уведомления (без библиотек).
  - Store: `currentWorkflowId`, `currentWorkflowName`, `executionLevels`,
    `saveWorkflowAsync`, `loadWorkflowAsync`, `runPlanAsync`.
  - `BaseNode`: badge уровня выполнения (серый кружок с номером).
  - Синхронизация URL: после первого Save → `?workflowId=` в
    `history.replaceState`; при перезагрузке — fetch по id.
  - `executionLevels` сбрасывается при `addNode` / `onConnect` / `load`.
  - Проверено на живом backend:
    - Save first → POST /workflow → id в URL, тост.
    - Save second → PATCH same id (без дубля).
    - Run на diamond A→B/C→D → `{A:1, B:2, C:2, D:3}` → badges в UI.
    - Load → граф заменён, план очищен.
    - Reload `?workflowId=` → 3 узла восстановлены.
    - 0 ошибок в консоли.
- **Frontend — Task 2 (v0.3.0):**
  - Кастомные ноды: `TextNode`, `LLMNode`, `ImageGenNode` +
    презентационная обёртка `BaseNode`.
  - Типизированные порты: T (синий #3b82f6), G (зелёный #22c55e),
    10px + белая обводка + подпись рядом.
  - `TextNode`: textarea (3 строки) с плейсхолдером, `nodrag`.
  - `LLMNode`: select моделей (Claude Opus 4 / GPT-4o / DeepSeek V4)
    + подсказка «Высокий / Быстрый».
  - `ImageGenNode`: плейсхолдер «Здесь появится результат» +
    disabled select «Grom Nova 1K».
  - Регистрация через `nodeTypes` в `ReactFlow`.
  - Сеточная раскладка 280×190 (вместо каскада — карточки не перекрываются).
  - `fitViewOptions: { maxZoom: 1 }` — узлы не растягиваются на весь экран.
  - `defaultEdgeOptions: { strokeWidth: 2 }` — связи видны.
  - Проверка в headless Chrome + CDP: ввод текста/смена модели доходят
    до Zustand-стора, порты соединяются, 0 ошибок в консоли.
- **Frontend — Task 1 (v0.3.0):**
  - Отдельный пакет `web/` — Vite 8 + React 19 + TypeScript 6 (strict, ESM).
  - Tailwind CSS v4 (CSS-based config).
  - React Flow v12 (`@xyflow/react`) — canvas с сеткой, controls, minimap.
  - Zustand store (`useWorkflowStore`) для `nodes`/`edges`.
  - `Toolbar` с 3 кнопками (Text / LLM / Image Generation) — каскадный
    сдвиг +40px на каждый следующий узел.
  - Vite proxy: `/workflow` → `http://localhost:3000`, `/engine` → тот же.
  - Dev-only `window.__wfStore` для отладки в DevTools.
  - Проверка в headless Chrome + CDP: 3 ноды, 2 связи, 0 ошибок.
- **Engine (v0.2.0):**
  - `EngineService` — топологическая сортировка (алгоритм Кана), валидация графа,
    построение плана выполнения с уровнями параллелизма.
  - DTO: `PositionSchema`, `NodeSchema`, `EdgeSchema`, `GraphSchema`
    (`src/engine/dto/`).
  - `EngineController` — 3 endpoints: `POST /engine/validate`, `/sort`, `/plan`.
  - 29 тестов (+26 service, +3 controller). Всего: **68**.
- **CRUD Workflow (v0.2.0):**
  - `ZodValidationPipe` (`src/common/pipes/`) — валидация body/query/param
    через Zod 4, `static create(schema)` для использования в декораторах.
  - DTO: `CreateWorkflowSchema`, `UpdateWorkflowSchema`, `ListWorkflowsQuerySchema`
    (`src/workflow/dto/`).
  - `WorkflowService` — 5 методов: `createAsync`, `findAllAsync`, `findOneAsync`,
    `updateAsync`, `removeAsync` (Drizzle ORM + pg driver).
  - `WorkflowController` — 5 REST endpoints (`POST/GET/GET:id/PATCH/DELETE /workflow`).
  - Multi-tenant readiness: необязательный `userId` фильтр во всех методах.
  - 31 тест (было 7): +18 service, +8 controller, −2 заменено.

### Fixed
- **PATCH `/workflow/:id` с пустым body** возвращает 400 вместо 200
  (v0.2.0). `UpdateWorkflowSchema` переписан без `.partial()` —
  defaults на `nodes`/`edges` больше не блокируют `.refine()`.
  `userId` исключён из update-схемы.

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

### Security
- **`.env`** — в `.gitignore`, содержит только dev-секреты
  (`workflow_dev_password` — локальный PostgreSQL в Docker).
- **Публичный репозиторий** — email автора обезличен.