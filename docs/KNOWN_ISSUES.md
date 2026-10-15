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

### KI-120 — Vite proxy: `/media` забыт при добавлении узла Image Generation
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.6.0b.2.5
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

### KI-128 — Узлы-сервисы с внутренним конфигом (концепт)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** —
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

### KI-150 — `cost_usd` не заполняется для моделей вне прайс-листа
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/llm/model-pricing.ts`, `web/src/components/RunResultPanel.tsx`
- **Описание:** Для моделей RouterAI/GPTunnel/DeepSeek/Yandex прайс-лист пуст,
  поэтому `costUsd` остаётся `null` и панель не показывает стоимость вовсе —
  пользователь видит токены без цены и не может оценить расход.
- **Решение:** наполнять `MODEL_PRICING` тарифами провайдеров или брать цену из
  их API; до этого честно подписывать «цена неизвестна» вместо пустоты.
- **Когда чинить:** v0.8 (нужны тарифы).
- **Связанные:** KI-052, KI-055, KI-151.

---

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

### KI-155 — Frontend не может тестировать компоненты
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-14
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

### KI-177 — LM Studio auto-discovery работает только на старте
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/llm/llm-provider.factory.ts`
- **Описание:** Каталог запрашивается один раз при инициализации.
  LM Studio, запущенный после backend, остаётся невидимым до
  перезапуска приложения (KI-088).
- **Решение:** фоновое обновление или `POST /llm/refresh`.
- **Когда чинить:** v0.8 (при появлении кэша каталога).
- **Связанные:** KI-088, KI-117.

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

### KI-183 — maxTokens не учитывает reasoning-модели
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
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


### KI-185 — Вставка узла в связь (hover на edge)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel при hover на связь показывает «+» с
  подсказкой «Вставить ноду в связь» (и «×» для удаления). У нас
  удаление — только Delete/Backspace; вставки нет.
- **Решение:** `onEdgeMouseEnter` → показать «+» посередине
  (`EdgeLabelRenderer`), клик — открыть каталог узлов, после выбора
  разбить edge на два (source→new, new→target).
- **Когда чинить:** v0.8 (Canvas UX).
- **Связанные:** KI-162, KI-127.

### KI-186 — Хоткеи: расширенный список
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
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

### KI-187 — Комментарии/аннотации на холсте
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`, `web/src/stores/workflow.ts`
- **Описание:** GPTunnel позволяет оставлять текстовые заметки на
  холсте (C). У нас нет.
- **Решение:** тип узла `comment` (или отдельный слой annotations);
  i18n; сохранение в workflow.
- **Когда чинить:** v0.8.
- **Связанные:** KI-194.

### KI-188 — Режимы Курсор / Рука (S / H)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel: S — selection, H — pan (рука). У нас — обе
  через мышь (без hotkey).
- **Решение:** `panOnDrag` toggle + хук `useHotkeys`.
- **Когда чинить:** v0.8.
- **Связанные:** KI-186.

### KI-189 — Направляющие / snap при перетаскивании
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel показывает направляющие для выравнивания
  узлов, Ctrl временно отключает привязку. У нас — свободное
  перетаскивание без выравнивания.
- **Решение:** `snapToGrid` + custom guides (React Flow helper);
  hotkey Ctrl для отключения.
- **Когда чинить:** v0.8.
- **Связанные:** KI-186.

### KI-190 — Мини-карта: toggle + hotkey
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel: мини-карта включается/выключается через
  правую панель. У нас — всегда показана (KI-158 — контраст).
- **Решение:** toggle в правой панели + сохранение в localStorage.
- **Когда чинить:** v0.8.
- **Связанные:** KI-158.

### KI-191 — Дублировать узел (Ctrl+D)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts`, `web/src/components/Canvas.tsx`
- **Описание:** GPTunnel: Ctrl+D дублирует выделенные узлы (с offset).
  У нас — нет.
- **Решение:** store.duplicateNodes(ids) с offset +15/+15; hotkey.
- **Когда чинить:** v0.8.
- **Связанные:** KI-186.

### KI-192 — System prompt у LLM-узла
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/components/nodes/LLMNode.tsx`,
  `web/src/types/graph.ts`, `src/llm/llm-node-executor.service.ts`
- **Описание:** GPTunnel позволяет задать System prompt в LLM-узле
  (отдельно от user prompt, который приходит по связи). У нас
  только user prompt.
- **Решение:** поле `systemPrompt` в `LlmNodeData`; textarea в узле
  (сворачиваемая); `role: 'system'` в messages перед user.
- **Когда чинить:** v0.8 (High — часто нужно).
- **Связанные:** KI-180, KI-193.

### KI-193 — Режим размышления (Reasoning) для LLM
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-15
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

### KI-195 — Auto-save в фоне
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `web/src/stores/workflow.ts`, `web/src/components/TopBar.tsx`
- **Описание:** GPTunnel не имеет кнопки Save — всё автосохраняется.
  У нас: Save вручную + авто-save перед Run (KI-147).
- **Решение:** debounced save (3с после последнего изменения) +
  индикатор «сохранено/есть изменения»; Save остаётся как fallback.
- **Когда чинить:** v0.8.
- **Связанные:** KI-147.

### KI-196 — Медиа-инструменты (upscale, bg-removal, lipsync, 3D, motion)
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/media/providers/creativelab.provider.ts`
- **Описание:** GPTunnel: Photoshop / Видеоредактор / 3D-сцена /
  Моушн-ролик / Удалить фон / Липсинк / Апскейл / Хромакей / Обрезка.
  У нас — только генерация (text-to-image).
- **Решение:** отдельные узлы-инструменты под каждый тип (для каждого
  — свой payload, могут использовать image-input).
- **Когда чинить:** v0.9.
- **Связанные:** KI-128, KI-105, KI-181.

### KI-197 — Публичный share workflow (read-only ссылка)
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/workflow/` (новый эндпоинт), `src/db/schema.ts`,
  `web/src/components/TopBar.tsx`
- **Описание:** В GPTunnel есть «Поделиться»: toggle «Доступ по ссылке»
  (любой по ссылке видит и делает копию), «Участники» (приглашение по
  ID с ролью Просмотр/Редактирование), «Разрешить копирование»
  (toggle). У нас workflow доступен только владельцу, публичной ссылки
  нет — поделиться графом невозможно.
- **Решение:** (1) `shareToken` (uuid) в `workflows`; (2) эндпоинт
  `GET /workflow/share/:token` без auth; (3) read-only UI-режим
  (баннер «Только просмотр», disable редактора); (4) опционально
  copy-to-my-account. Участники-по-ID — v0.9+.
- **Когда чинить:** v0.8 (ссылка) / v0.9 (участники).
- **Связанные:** KI-087, KI-098, KI-107.

---

### KI-200 — Sub-workflows (композиция workflow как узла)
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-15
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
- **Остаток (R6.1b.2, frontend):** LoginPage / AuthProvider /
  ProtectedRoute / fetch interceptor (401 → refresh).
- **Связанные:** KI-202..208.

---

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

### KI-206 — Нет rate limiting / refresh / logout
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/auth/`
- **Описание:** MVP R6.1a: без rate-limit на `/auth/login` (брутфорс
  не ограничен); нет refresh-токена (R6.1b), нет logout/revocation.
- **Решение:** `@nestjs/throttler` для login; refresh + logout в R6.1b.
- **Когда чинить:** R6.1b (refresh/logout) + v0.8.x (throttle).
- **Связанные:** KI-201.

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

### KI-217 — `@types/express` не объявлен в devDependencies
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `package.json`, `src/auth/auth.controller.ts`
- **Описание:** `Request` / `Response` из `express` используются в
  `auth.controller.ts`, но `@types/express` приходит транзитивно через
  `@nestjs/platform-express` — при смене зависимостей типы могут пропасть.
- **Решение:** явный `@types/express` в devDependencies.
- **Когда чинить:** при следующей чистке deps.
- **Связанные:** —

---

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

### KI-220 — `COOKIE_SECURE=false` разрешён в production
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/config/env.schema.ts`, `src/auth/auth.cookie.ts`
- **Описание:** Аналогично KI-213 — в prod `COOKIE_SECURE=false` явно
  разрешён и приведёт к отправке refresh-cookie по http. Secure-флаг
  по умолчанию берётся от `NODE_ENV`, но явный `false` его перебивает.
- **Решение:** superRefine (production + `COOKIE_SECURE=false` → отказ)
  или принудительный `secure: true` в prod, игнорируя env.
- **Когда чинить:** v0.8.x (security, как KI-213).
- **Связанные:** KI-213, KI-201.

---

### KI-221 — Проверка KI-213 привязана к точному `production`
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-15
- **Файлы:** `src/config/env.schema.ts`
- **Описание:** Для `staging` / `preprod` (если появятся) ослабление
  авторизации останется разрешённым. Нужен отдельный признак окружения
  или allowlist «prod-подобных» значений `NODE_ENV`.
- **Решение:** `ENVIRONMENT` enum или regex-проверка.
- **Когда чинить:** при появлении staging.
- **Связанные:** KI-213.

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

## Сводка по статусам

| Статус | Кол-во |
|--------|--------|
| Fixed | 76 |
| In Progress | 0 |
| Planned | 1 |
| Deferred | 0 |
| Documented | 7 |
| Open | 128 |
| Won't Fix | 1 |
| **Всего** | **213** |

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