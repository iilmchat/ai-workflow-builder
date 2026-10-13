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

### Fixed
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