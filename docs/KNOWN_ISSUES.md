# Известные проблемы IIChatTools AI Workflow Builder

Файл ведётся с версии 0.1.0 (октябрь 2026).
Формат: `KI-XXX` — название, приоритет, статус, файлы.

Приоритеты: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
Статусы: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved

---

## v0.1.0 — Initial scaffold (2026-10-12)

> На старте проекта реестр пуст. Все проблемы, найденные при разработке,
> добавляются сюда с номерами `KI-001`, `KI-002`, ...

### KI-001 — Шаблон записи (Documented)
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-12
- **Файлы:** —
- **Описание:** Это шаблон. Реальные проблемы начинаются с `KI-002`. Каждая
  запись содержит: приоритет, статус, файлы, описание проблемы, возможные
  решения, оценку, связанные KI.
- **Формат полей:**
  - **Приоритет:** 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low
  - **Статус:** Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved
  - **Исправлено в:** vX.Y.Z (для Fixed)
  - **Запланировано:** vX.Y.Z (для Planned / Deferred)
- **Связанные:** —

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

### KI-004 — React Flow: лицензия `hideAttribution` при платных плагинах
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
- **Файлы:** `web/src/components/Canvas.tsx` (`proOptions={{ hideAttribution: true }}`)
- **Описание:** Отключили watermark React Flow в dev. В v12 MIT это разрешено,
  но при подключении проприетарных плагинов (`@xyflow/pro`) условия меняются.
- **Что проверить перед prod:** актуальная лицензия React Flow +
  всех плагинов. Если условия требуют attribution — вернуть.
- **Не блокер:** dev-only.

---

### KI-005 — Frontend не покрыт CI (нет сборки `web/` в GitHub Actions)
- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** v0.3.1
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

### KI-008 — Zod в клиентском бандле добавляет ~100 kB
- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-10-13
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

### KI-021 — У `node_runs` нет `created_at`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/schema.ts`
- **Описание:** В отличие от `workflow_runs` (после KI-015), у `node_runs`
  нет `created_at` — только `started_at`/`finished_at`. Решить до R4:
  нужен ли столбцу «создан».
- **Когда чинить:** до R4.
- **Связанные:** KI-015, KI-018.

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

### KI-025 — `workflow_runs.outputs` дублирует выходы всех узлов
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** При больших графах раздувает jsonb и дублирует
  `node_runs.outputs`. Решить: хранить только терминальные выходы или ссылки.
- **Когда чинить:** до R4.
- **Связанные:** —

---

### KI-026 — Нет таймаута и отмены выполнения
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`, `src/engine/node-executors.ts`
- **Описание:** `runNode` синхронный, `AbortSignal` не прокинут. Статус
  `cancelled` есть в схеме, но перевести в него запуск нечем (RULES 4.19).
- **Когда чинить:** до R3 (LLM-вызовы) и до R4 (кнопка Stop).
- **Связанные:** KI-024.

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

### KI-028 — Дублирование `toMessage` в 4 файлах
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.service.ts`, `src/runs/run-events.service.ts`,
  `src/runs/runs.processor.ts`, `src/engine/execution-engine.service.ts`
- **Решение:** вынести в `src/common/utils/to-message.ts`.
- **Когда чинить:** при следующей правке одного из файлов.
- **Связанные:** —

---

### KI-029 — Нет следа узла, если падение до INSERT в `node_runs`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Сбой `collectInputsAsync` или самого INSERT выбрасывается
  наружу: строки `node_runs` нет, узел не виден в UI, хотя run помечен failed.
- **Когда чинить:** до R4 (UI начнёт показывать узлы).
- **Связанные:** —

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

### KI-042 — Retry-After из 429 игнорируется, backoff не настраивается
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** Задержки захардкожены (500 мс × 2^(n−1), 3 попытки).
  Реальный провайдер при 429 присылает `Retry-After`, который стоит
  уважать; значения — вынести в env (RULES 4.5/4.6).
- **Когда чинить:** до R4 или раньше, если начнутся массовые 429.
- **Связанные:** KI-036, KI-016.

---

### KI-043 — `node_runs.logs` — свободный текст
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/db/schema.ts` (`node_runs.logs`), `src/engine/execution-engine.service.ts`
- **Описание:** Записи вида «попытка 1/3 упала: … — повтор через 500 мс»
  читаемы, но не структурированы. Для UI (R4) и агрегатов (сколько ретраев,
  какая ошибка) лучше JSON-объекты (сейчас `$type<string[]>`).
- **Когда чинить:** R4.
- **Связанные:** KI-036.

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

### KI-048 — Нет предохранителя по стоимости повторов
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/engine/execution-engine.service.ts`,
  `src/runs/runs.processor.ts`
- **Описание:** До 3 job-попыток × 3 node-попыток = до 9 вызовов
  провайдера на узел за запуск, и каждый job-retry прогоняет **весь
  граф** заново (KI-046).
- **Решение:** бюджет/лимит вызовов на запуск или circuit breaker
  по 429 (связан с KI-042).
- **Когда чинить:** перед прод-запуском.
- **Связанные:** KI-036, KI-040, KI-042, KI-046.

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

### KI-055 — Прайс-лист статичен и неполон
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/model-pricing.ts`
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

### KI-061 — Нет `GET /runs` (список запусков)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.controller.ts`, `src/runs/runs.service.ts`
- **Описание:** Есть POST/GET:id/stream, но нет `GET /runs` —
  нельзя получить историю запусков workflow (и отфильтровать по
  `workflowId`).
- **Когда чинить:** R4.2, если UI покажет историю.
- **Связанные:** —

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

### KI-066 — У run-аренды нет heartbeat
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-13
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

### KI-067 — `concurrency` глобальный, нет fairness
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.worker-options.ts`, `src/config/env.schema.ts`
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

### KI-068 — У фронтенда нет тестовой инфраструктуры и lint-скрипта
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

### KI-072 — Префиксы API для Vite-прокси перечисляются вручную
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Обнаружено:** 2026-10-13
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

### KI-075 — `node_completed` / `node_failed` не несут метрики и логи
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/dto/run-event.dto.ts`,
  `web/src/stores/workflow.ts`
- **Описание:** Токены, стоимость и записи ретраев (KI-036) приходят
  только в `snapshot`, поэтому панель показывает их лишь после
  переподключения к потоку. При живом выполнении видны только
  длительность (из `node_completed`) и текст ошибки.
- **Решение:** добавить `metrics`/`logs` в события завершения узла
  (или отдельное `node_metrics`).
- **Когда чинить:** R4.4.
- **Связанные:** KI-038, KI-043.

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

### KI-077 — Результат запуска недоступен без SSE
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/runs/runs.controller.ts`,
  `src/runs/runs.service.ts`, `web/src/stores/workflow.ts`
- **Описание:** `GET /runs/:id` отдаёт только `id`/`workflowId`/
  `status`/`createdAt`; `node_runs` API нет. После F5 (или при
  открытии старого запуска) панель **пуста** — данных о
  `outputs`/метриках/логах взять негде.
- **Решение:** `GET /runs/:id/nodes` (или расширение ответа
  запуска).
- **Когда чинить:** R4.4.
- **Связанные:** KI-061.

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

### KI-088 — `LMSTUDIO_MODELS` не имеет автообнаружения
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-provider.factory.ts`
- **Описание:** Список моделей LM Studio задаётся вручную в env,
  хотя сервер отдаёт их через `GET /v1/models`. Если в env модель
  указана, а в LM Studio её нет — ошибка всплывёт только на
  вызове.
- **Решение:** опционально `GET {LMSTUDIO_BASE_URL}/models` при
  старте; env — override.
- **Когда чинить:** v0.6.0.
- **Связанные:** —

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

### KI-091 — Тестов меньше требуемого порога (260 vs 265)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Описание:** Ожидалось +8 тестов (257 → 265), фактически +3.
  Часть сценариев **уже покрыта** существующими тестами и меняла
  только форму ожидаемых объектов.
- **Решение:** добавить юнит-тесты `groupLlmModelsForSelect`,
  `filterModelsByInput/Output`, `MODEL_MODALITIES` (сейчас
  покрыты только через CDP-smoke).
- **Когда чинить:** вместе с v0.6.0b.
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

### KI-103 — `MediaProviderException` не различает, какой провайдер упал
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/media/media-provider.interface.ts`
- **Описание:** Исключение содержит только строку `[creativelab] ...`.
  Когда media-провайдеров станет несколько, для диагностики
  понадобится отдельное поле `provider`.
- **Решение:** добавить поле `provider` (как `retryable`).
- **Когда чинить:** при появлении второго провайдера.- **Связанные:** KI-095.

---

### KI-104 — Повтор узла учитывает только LLM-исключения
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-14
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

### KI-105 — URL-ы результата живут 48 часов и нигде не продлеваются
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
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

### KI-108 — Poll backoff без jitter синхронизирует запросы
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
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

### KI-109 — Конфликт портов 5433: контейнер и локальная служба PostgreSQL
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-14
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

### KI-116 — `aspect_ratio` рендерится только если у модели есть `options`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** Условие рендера — `aspectRatioParam?.options !==
  undefined`. Если upstream вернёт `aspect_ratio` как `string` без
  `options` (сейчас — `enum`), селект не появится.
- **Решение:** добавить контролы для `number`/`string`/`boolean`.
- **Связанные:** KI-092.

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

### KI-118 — Результат media-генерации — внешняя ссылка 48 ч
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `web/src/components/nodes/ImageGenNode.tsx`
- **Описание:** `mediaUrl` живёт 48 часов и не кэшируется у нас. При
  повторном открытии старого run `<img>` будет битым, а определить
  «ссылка истекла» по ответу `<img>` нельзя.
- **Решение:** скачивать результат к себе (S3/local) либо
  плейсхолдер «ссылка истекла» в UI.
- **Связанные:** KI-105.

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

## Сводка по статусам

| Статус | Кол-во |
|--------|--------|
| Fixed | 27 |
| In Progress | 0 |
| Planned | 2 |
| Deferred | 0 |
| Documented | 6 |
| Open | 51 |
| Won't Fix | 1 |
| **Всего** | **87** |

---

## Правила ведения

1. Любая найденная проблема / ограничение → запись с номером `KI-XXX`.
2. Даже если это «не баг» — запись нужна для истории.
3. Приоритет: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low.
4. Статус: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved.
5. Для Fixed — обязательно указывается «Исправлено в: vX.Y.Z» и список файлов.
6. Для Deferred — указывается «Запланировано: vX.Y.Z» и причина отсрочки.