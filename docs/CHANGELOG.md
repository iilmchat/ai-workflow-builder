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