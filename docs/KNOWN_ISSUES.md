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
- **Приоритет:** 🟡 Medium | **Статус:** Documented | **Обнаружено:** 2026-10-13
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
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-13
- **Файлы:** `pnpm-lock.yaml`, `package.json` (`packageManager`)
- **Описание:** pnpm 12 c полем `packageManager` в `package.json` при каждом
  запуске добавляет в lockfile служебную запись `@pnpm/exe@12.11.2`
  (self-management). При попадании в коммит ломает CI-шаг
  `pnpm install --frozen-lockfile`.
- **Возможные решения:**
  1. Зафиксировать версию pnpm без self-management (`.npmrc` + `use-node-version`).
  2. Добавить в CI шаг `pnpm install --no-frozen-lockfile` — плохо.
  3. Перейти на corepack (`corepack enable && corepack prepare pnpm@12.11.2 --activate`).
- **Не блокер:** R1. Проверять `git diff pnpm-lock.yaml` перед каждым коммитом.
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
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
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

---

### KI-015 — В `workflow_runs` нет `created_at`
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-13
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

---

### KI-016 — Очередь BullMQ без `defaultJobOptions`
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-13
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

## Сводка по статусам

| Статус | Кол-во |
|--------|--------|
| Fixed | 0 |
| In Progress | 0 |
| Planned | 0 |
| Deferred | 0 |
| Documented | 1 |
| Won't Fix | 0 |
| **Всего** | **13** |

---

## Правила ведения

1. Любая найденная проблема / ограничение → запись с номером `KI-XXX`.
2. Даже если это «не баг» — запись нужна для истории.
3. Приоритет: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low.
4. Статус: Open / In Progress / Fixed / Documented / Deferred / Won't Fix / Resolved.
5. Для Fixed — обязательно указывается «Исправлено в: vX.Y.Z» и список файлов.
6. Для Deferred — указывается «Запланировано: vX.Y.Z» и причина отсрочки.