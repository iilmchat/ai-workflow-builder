# PROMPT_V2.md — Стартовый промпт для нового чата

**Версия промпта:** v2.0
**Дата:** 2026-10-13
**Актуальный релиз:** v0.3.0 (MVP: canvas + ноды + CRUD + Engine + API)
**Текущий этап:** Runner (BullMQ + LLM-провайдеры + SSE)
**Репозиторий:** https://github.com/iilmchat/ai-workflow-builder
**Рабочий путь:** `D:\Projects\AI\workflow-builder`

---

## § 0. Главное правило форматирования

**Не более одного уровня code fence в ответе.**

- Обычный код — тройной бэктик, **не вкладывать внутрь другого**.
- Пример внутри markdown-блока — **4-пробельный отступ**.
- Команда (inline) — `pnpm build`.
- **MD-файлы, содержащие внутренние code-блоки** — оборачивать в **4 бэктика** снаружи.

**Большие MD-файлы** (README, RULES, CHANGELOG, KNOWN_ISSUES, PROMPT_*):
только **точечный diff** («Найти X / Заменить на Y») или отдельная секция.
Никогда — целиком.

**PowerShell-специфика:**
- `<<'EOF'` (bash heredoc) **НЕ работает** — используй `@'...'@ | Out-File .file -Encoding utf8NoBOM`.
- Multi-line команды — через backtick `` ` `` в конце строки.
- `Stop-Process -Id <PID>` — **не работает**, `<` зарезервирован. Указывать число.
- **Не вставляй сразу блок команд + здесь-строку** — PowerShell парсит весь блок до выполнения.

---

## § 1. Что это за проект

**IIChatTools AI Workflow Builder** — визуальный редактор LLM-workflow
(по образцу n8n / ComfyUI / Flowise). Пользователь строит граф на canvas
(Text → LLM → Image Generation и т.д.), сохраняет в БД, запускает —
LLM выполняет узлы последовательно, результат отображается в UI.

**Цель MVP (v0.3.0) достигнута:** полный цикл «нарисовал → сохранил →
загрузил → посмотрел план выполнения» работает.

**Следующий этап:** Runner — реальное выполнение графа через BullMQ + LLM-провайдеры.

---

## § 2. Стек (детально)

### Backend

- **NestJS 12**, **TypeScript 6** (strict, **ESM**).
- **Drizzle ORM** 0.45 + **node-postgres** (`pg`) — БД.
- **PostgreSQL 17** (Docker, **порт 5433**).
- **Vitest** 4 — тесты (**68 тестов**).
- **Zod** 4 — валидация на границах.
- **Pino** — структурированные логи.
- **BullMQ** 6 + **ioredis** — установлены, **не подключены** (в R1 подключим).
- **@nestjs/passport** + **@nestjs/jwt** — установлены, **не подключены** (в будущем).

### Frontend (`web/`)

- **Vite** 8 + **React** 19 + **TypeScript** 6 (strict, **ESM**).
- **@xyflow/react** v12 (React Flow) — canvas.
- **Zustand** 5 — state management.
- **Tailwind CSS** v4 (плагин `@tailwindcss/vite`, без JS-конфига).
- **Zod** — валидация API-ответов.
- Bundle: **506 kB JS** + 27 kB CSS.

### Инструменты

- **pnpm** 12 (`packageManager` в `package.json`).
- **Docker** — PostgreSQL (Redis в R1).
- **dsh** (DeepSeek Harness) — Web UI на `127.0.0.1:3080` (для генерации кода).
- **GitHub Actions** — CI (build + test backend на push).

---

## § 3. Структура проекта

```
ai-workflow-builder/
├── src/                              ← NestJS backend
│   ├── main.ts                       ← import 'dotenv/config' первой строкой
│   ├── app.module.ts
│   ├── common/pipes/
│   │   └── zod-validation.pipe.ts    ← ZodValidationPipe.create(schema)
│   ├── db/
│   │   ├── schema.ts                 ← workflows / workflow_runs / node_runs
│   │   └── db.module.ts              ← @Global(), токены DRIZZLE + DB_SCHEMA
│   ├── workflow/
│   │   ├── dto/                      ← CreateWorkflowSchema / UpdateWorkflowSchema
│   │   ├── workflow.service.ts       ← CRUD через Drizzle
│   │   └── workflow.controller.ts    ← 5 endpoints
│   ├── engine/
│   │   ├── dto/                      ← Node / Edge / Graph Zod-схемы
│   │   ├── engine.service.ts         ← Kahn's algorithm + DFS cycle detection
│   │   └── engine.controller.ts      ← 3 endpoints (validate / sort / plan)
│   └── nodes/                        ← пустой скелет (для R3)
├── web/                              ← React frontend (свой package.json)
│   └── src/
│       ├── App.tsx                   ← TopBar + Canvas
│       ├── main.tsx
│       ├── components/
│       │   ├── Canvas.tsx            ← ReactFlow + nodeTypes
│       │   ├── Toolbar.tsx           ← 3 кнопки
│       │   ├── TopBar.tsx            ← name + Save/Load/Run
│       │   ├── LoadModal.tsx
│       │   ├── Toast.tsx
│       │   └── nodes/
│       │       ├── BaseNode.tsx      ← presentation wrapper
│       │       ├── TextNode.tsx      ← textarea + nodrag
│       │       ├── LLMNode.tsx       ← select моделей
│       │       ├── ImageGenNode.tsx  ← placeholder
│       │       └── index.ts          ← nodeTypes registry
│       ├── lib/
│       │   ├── api.ts                ← Zod-валидированный fetch
│       │   └── plan.ts               ← levelsToMap
│       ├── stores/workflow.ts        ← Zustand store
│       └── types/graph.ts            ← Graph DTO
├── drizzle/                          ← SQL миграции
├── docs/
│   ├── development/
│   │   ├── RULES.md                  ← правила разработки
│   │   ├── GETTING_STARTED.md        ← разворачивание с нуля
│   │   ├── PROMPT_V2.md              ← этот файл
│   │   ├── ARCHITECTURE.md           ← (планируется)
│   │   └── RELEASES.md               ← чек-лист релиза
│   ├── CHANGELOG.md
│   └── KNOWN_ISSUES.md
├── docker-compose.yml                ← Postgres 17 (порт 5433)
├── migrate.ts                        ← wrapper для drizzle-kit (Windows fix)
├── drizzle.config.ts
├── package.json                      ← backend
├── pnpm-lock.yaml
├── .env.example
└── .github/workflows/ci.yml
```

---

## § 4. Текущее состояние (v0.3.0)

### Backend — 3 модуля

**WorkflowModule** (`/workflow`):
- `POST /workflow` → 201 (body: `{userId, name, description?, nodes, edges}`)
- `GET /workflow?userId=&limit=&offset=` → 200
- `GET /workflow/:id` → 200 / 404
- `PATCH /workflow/:id` → 200 (не пустое body)
- `DELETE /workflow/:id` → 204

**EngineModule** (`/engine`):
- `POST /engine/validate` → 200 `{valid, errors[], warnings[]}`
- `POST /engine/sort` → 200 `{order[]}` / 400 при цикле
- `POST /engine/plan` → 200 `{order[], levels[][], executionMap{}}`

**NodesModule** — пустой скелет (в R3 подключим).

### Frontend — компоненты

- **Canvas** — ReactFlow + Background + Controls + MiniMap + `nodeTypes`.
- **Toolbar** — 3 кнопки (Text / LLM / Image Generation).
- **TopBar** — editable name + Load / Save / Run.
- **LoadModal** — список workflow (open / delete).
- **Toast** — inline-уведомления.
- **3 кастомные ноды** — с типизированными портами (T синий / G зелёный).
- **Store** (`useWorkflowStore`) — nodes, edges, currentWorkflowId,
  executionLevels, saveWorkflowAsync, loadWorkflowAsync, runPlanAsync.

### Работающие сценарии

1. Backend на `http://localhost:3000`, frontend на `http://localhost:5173`.
2. Нарисовать граф → Save → в URL `?workflowId=...` → F5 восстанавливает.
3. Load → модалка → выбрать workflow → граф подгружается.
4. Run → `POST /engine/plan` → badges уровней на нодах.

### Метрики

- **68 backend-тестов** (7 base + 24 CRUD + 10 PATCH fix + 27 Engine).
- **9 KI** (KI-001 шаблон + 8 реальных: KI-002..009).
- **26 коммитов**, CI зелёный.
- **Bundle frontend:** 506 kB JS + 27 kB CSS.

### Схема БД

```
workflows
  ├─ id uuid PK
  ├─ userId text, name text, description text
  ├─ nodes jsonb default [], edges jsonb default []
  ├─ version integer default 1
  ├─ createdAt, updatedAt timestamp
  │
  └── workflow_runs (CASCADE)
        ├─ id uuid PK, workflowId uuid FK
        ├─ status text (pending/running/completed/failed/cancelled)
        ├─ inputs jsonb, outputs jsonb, error text
        ├─ snapshot jsonb (копия графа на момент запуска)
        ├─ startedAt, finishedAt timestamp
        │
        └── node_runs (CASCADE)
              ├─ id uuid PK, runId uuid FK
              ├─ nodeId text, nodeType text
              ├─ status text
              ├─ inputs jsonb, outputs jsonb, error text, logs jsonb
              ├─ tokensIn, tokensOut integer
              ├─ costUsd numeric(10,6)
              ├─ durationMs integer
              ├─ startedAt, finishedAt timestamp
```

### Graph DTO

```jsonc
{
  "nodes": [
    { "id": "A", "type": "text", "position": {"x": 0, "y": 0},
      "data": { "value": "..." } }
  ],
  "edges": [
    { "id": "e1", "source": "A", "sourceHandle": "text-output",
      "target": "B", "targetHandle": "text-input" }
  ]
}
```

---

## § 5. Roadmap — сейчас: Runner

**Цель:** замкнуть цикл — `нарисовал → сохранил → запустил → LLM выполнил
узлы → результат виден в UI`.

### Разбивка на 4 подзадачи

**R1 — BullMQ-инфраструктура (≈40 мин):**
1. Redis в `docker-compose.yml` (порт 6379, named volume, healthcheck).
2. `REDIS_URL` в `.env.example`.
3. `RunsModule`:
   - `POST /runs {workflowId}` — создать Run (snapshot графа в БД),
     поставить job в BullMQ queue `workflow-runs`.
   - `GET /runs/:id` — прочитать из `workflow_runs`.
   - `RunsProcessor` (BullMQ Worker) — **скелет**: логирует job,
     помечает `status = 'completed'`. Реальный executor в R2.
4. `BullModule.forRootAsync` в `app.module.ts` (Redis URL из env).
5. Обновить `.env.example`.

**R2 — Executor (≈1.5 ч):**
1. `ExecutionEngineService.executeAsync(runId, graph)` —
   обход `executionMap` из EngineService.
2. Последовательное выполнение узлов.
3. Persistence: `node_runs` — insert / update статуса на каждом шаге.
4. Обновление `workflow_runs.status`: `pending → running → completed/failed`.
5. Публикация прогресса в Redis pub/sub (`run:{id}`).

**R3 — LLM-провайдеры (≈2 ч):**
1. Интерфейс `ILLMProvider`:
   ```ts
   interface ILLMProvider {
     name: string;
     models: string[];
     generateAsync(prompt: string, options): AsyncIterable<string>;
   }
   ```
2. `AnthropicProvider` (`@anthropic-ai/sdk`).
3. `OpenAIProvider` (`openai`).
4. `ProviderRegistry` — выбор по `node.data.model`.
5. API-ключи в `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
6. Узлы `TextNode` → output без изменений; `LLMNode` → вызов провайдера.

**R4 — SSE + frontend (≈1.5 ч):**
1. `GET /runs/:id/stream` — SSE из Redis pub/sub:
   `run_started`, `node_started`, `node_delta`, `node_completed`,
   `run_completed`, `error`.
2. Frontend `TopBar`: Run → POST /runs → EventSource → подписка.
3. Подсветка нод по статусу (`running` — синий, `completed` — зелёный,
   `error` — красный).
4. Финальный результат — модалка или панель снизу.

### После Runner (v0.4.0+)

- Image-провайдеры (Replicate / FAL / OpenAI Images).
- Auth (JWT + Passport, заменить `demo-user`).
- Multiuser (фильтр по `userId`).
- Frontend в CI (KI-005).
- Playwright smoke-тест (ловить KI-007).
- Parallel execution (уровни из Engine → `Promise.all`).
- Узел `http` (внешние API), `condition` (ветвление).

---

## § 6. Формат работы

1. **Полные файлы** с JSDoc на русском.
2. **Путь к файлу** в начале каждого блока.
3. **Правка существующего** — точечный diff (Найти / Заменить на).
4. **Новый файл** — целиком.
5. **Несколько правок в одном файле** — нумеровать (Правка 4.1, 4.2).
6. **Новые зависимости** — с версиями и указанием (`dependencies` / `devDependencies`).
7. **Сводка в конце**: что сделано / что проверить.
8. **Новые проблемы** → `KI-XXX` в `docs/KNOWN_ISSUES.md`.
9. **`CHANGELOG.md` — в КАЖДОМ коммите с кодом** (RULES § 2.1).
10. **Новый tool / endpoint** → 1 файл + 1 строка регистрации.

### Обязательные секции в конце ответа

- 🔨 **Build + test** — команды + ожидание.
- 🚀 **Commit** — here-string + `git add -A` + `push`.
- 🧪 **Smoke** — что проверить.
- 📊 **Сводка** — статус + что жду.
- 🎯 **Что дальше** — предложение следующего шага.

### Если чего-то не хватает

**Не выдумывай.** Скажи «Нужен файл X». **Если не уверен в API** — попроси проверить.

### Перед началом работы — дождись «ДА»

Не начинай писать код без подтверждения плана. Исключение — прямое «делай».

---

## § 7. Известные подводные камни

### Окружение

- **PostgreSQL на порту 5433** (не 5432 — Windows-сервис `postgresql-x64-17`
  занимает 5432).
- **Docker:** контейнер `workflow-builder-db` (postgres:17-alpine).
- **`pnpm start` на Windows оставляет orphaned node** — после stop
  проверяй `netstat -ano | Select-String ":3000|:5173"` (KI-009).
- **Vite слушает `[::1]:5173`** (IPv6) — `http://localhost:5173`
  работает, `127.0.0.1:5173` может не ответить.
- **Два `node_modules`** — backend (`node_modules`) и frontend
  (`web/node_modules`).

### Backend (NestJS + ESM)

- **`.js` в относительных импортах обязателен**
  (`import { X } from './y.js'`).
- **NestJS не читает `.env`** — `import 'dotenv/config'` первой строкой
  в `main.ts`.
- **`drizzle-kit migrate` в Windows молчит при ошибках** — использовать
  `tsx migrate.ts`.
- **Postgres в Docker с `trust`** для dev — не для prod.

### Frontend (Vite + React)

- **НЕ `.js` в импортах** (Vite сам резолвит) — **отличается от backend**.
- **`@xyflow/react`, не `reactflow`** — v12 переименован.
- **`nodrag`** на input / textarea / select внутри нод.
- **`useReactFlow().updateNodeData`** — предпочтительнее `setNodes`.
- **`nodeTypes` регистрировать** — проп необязательный, tsc не поймает
  (KI-007).
- **`fitViewOptions: { maxZoom: 1 }`** — иначе узлы растягиваются.
- **Vite proxy** — `/workflow` и `/engine` → `http://localhost:3000`.

### Тесты

- **`vi.fn()`** вместо `jest.fn()`.
- **`Test.createTestingModule`** вместо `new Service()`.

---

## § 8. Стандартные команды

**Остановить всё:**
```powershell
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*workflow-builder*" } |
    Stop-Process -Force
```

**Backend (dev):**
```powershell
cd D:\Projects\AI\workflow-builder
pnpm start:dev
# → http://localhost:3000
```

**Frontend (dev):**
```powershell
cd D:\Projects\AI\workflow-builder\web
pnpm dev
# → http://localhost:5173
```

**Build + test (backend):**
```powershell
pnpm build
pnpm test
pnpm lint
```

**Build (frontend):**
```powershell
cd web
pnpm build
```

**Drizzle:**
```powershell
pnpm db:generate   # миграция из изменений schema.ts
pnpm db:migrate    # применить
pnpm db:studio     # Drizzle Studio
```

**Commit (PowerShell here-string):**
```powershell
cd D:\Projects\AI\workflow-builder
git add -A
git status --short

@'
<type>(<scope>): <subject>

пункт 1
пункт 2

Build 0/0. Tests N/N.
'@ | Out-File -FilePath .commit-msg.txt -Encoding utf8NoBOM
git commit -F .commit-msg.txt
Remove-Item .commit-msg.txt
git push origin main
```

---

## § 9. Документы в репозитории

- **`docs/development/RULES.md`** v1.0.0 — правила разработки
  (TS/NestJS/ESM/Drizzle, 31 техническое правило).
- **`docs/development/GETTING_STARTED.md`** — разворачивание с нуля.
- **`docs/development/PROMPT_V2.md`** — этот файл.
- **`docs/CHANGELOG.md`** — история версий (Keep a Changelog).
- **`docs/KNOWN_ISSUES.md`** — реестр KI-001..009 (витрина на GitHub Issues).
- **`docs/development/KI_GITHUB_SYNC.md`** — синхронизация KNOWN_ISSUES ↔ GitHub Issues (подход B — витрина).
- **`docs/development/RELEASES.md`** — чек-лист релиза.

---

## § 10. Начни с вопроса

Прочитай правила и это сообщение. Затем задай мне вопросы:

1. **Что делаем сегодня:**
   - **R1. BullMQ-инфраструктура** (Redis + RunsModule skeleton)?
   - Или сначала **fix CI** (KI-005 — добавить frontend в CI, ~20 мин)?
   - Или **improve UI** (что-то в существующем canvas)?
2. **Есть ли pending-изменения** в рабочем дереве? (dsh может писать в фоне).
3. **Есть ли требования**, которых нет в документах?
4. **Нужны ли файлы**, которых у тебя нет?
5. **Какой путь к проекту** — `D:\Projects\AI\workflow-builder`?

**Контекст R1 (Runner — BullMQ setup):**
- Redis ещё нет в `docker-compose.yml`.
- `@nestjs/bullmq` + `ioredis` установлены, но не подключены.
- `RunsModule` — новый модуль.
- `POST /runs` — создание Run, постановка в очередь.
- Worker — скелет без логики выполнения (она в R2).

**Контекст KI-005 (fix CI):**
- `.github/workflows/ci.yml` — сейчас только backend.
- Добавить job с `working-directory: web` → `pnpm install` + `pnpm build`.
- Простой fix, ~20 минут.

**Готов? Приступаем.**
