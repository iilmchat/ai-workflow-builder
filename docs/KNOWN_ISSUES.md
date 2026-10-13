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
- **Исправлено в:** v0.3.2 (коммит `4ea0fb4`)
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
- **Исправлено в:** v0.3.2 (коммит `37cabba`) | **Исправлено:** 2026-10-13
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
- **Исправлено в:** v0.3.2 (коммит `4ea0fb4`)
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
- **Исправлено в:** v0.3.2 (коммит `4ea0fb4`)
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
- **Исправлено в:** v0.3.2 (коммит `4ea0fb4`)
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
- **Исправлено в:** v0.3.3 (коммит `d2a06ed`)
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
- **Исправлено в:** v0.3.3 (коммит `b1065be`)
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
- **Исправлено в:** v0.3.3 (коммит `a7a9da0`)
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
- **Исправлено в:** v0.3.5 (коммит `cbc347c`)
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
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-13
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
- **Исправлено в:** v0.3.4 (коммит `<hash R3>`)
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
- **Исправлено в:** v0.3.5 (коммит `cbc347c`)
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
- **Исправлено в:** v0.3.5 (коммит `cbc347c`)
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
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/llm-registry.service.ts`,
  `src/llm/providers/*.provider.ts`
- **Описание:** `listModels()` возвращает 4 модели, даже если ключ
  есть только у одного провайдера. UI покажет недоступные модели.
- **Решение:** добавить `isConfigured` провайдеру и фильтровать
  список для UI.
- **Когда чинить:** R4 (вместе с UI выбора модели).
- **Связанные:** —

---

### KI-040 — Job-level retry (BullMQ) сейчас no-op для терминальных запусков
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.3.5 (коммит `<hash>`)
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
- **Исправлено в:** v0.3.5 (коммит `7be74d1`)
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
- **Исправлено в:** v0.3.5 (коммит `7be74d1`)
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
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `src/llm/model-pricing.ts`
- **Описание:** Если провайдер не отдал `usage` (`inputTokens` и
  `outputTokens` = null), `calculateCostUsd` подставляет `?? 0` и
  возвращает `0`. В `node_runs.cost_usd = 0` неотличим от бесплатного
  вызова; для биллинга «неизвестно» и «ноль» — разные вещи.
- **Решение:** вернуть `null`, если **оба** счётчика null; если один —
  считать по известному. Либо хранить признак «метрики недоступны».
- **Когда чинить:** вместе с KI-039 или отдельным микро-шагом (R4-prep).
- **Связанные:** KI-038, KI-053.

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

## Сводка по статусам

| Статус | Кол-во |
|--------|--------|
| Fixed | 15 |
| In Progress | 0 |
| Planned | 2 |
| Deferred | 0 |
| Documented | 6 |
| Open | 32 |
| Won't Fix | 0 |
| **Всего** | **55** |

---

## Правила ведения

1. Любая найденная проблема / ограничение → запись с номером `KI-XXX`.
2. Даже если это «не баг» — запись нужна для истории.
3. Приоритет: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low.
4. Статус: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved.
5. Для Fixed — обязательно указывается «Исправлено в: vX.Y.Z» и список файлов.
6. Для Deferred — указывается «Запланировано: vX.Y.Z» и причина отсрочки.