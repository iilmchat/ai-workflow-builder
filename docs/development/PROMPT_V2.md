# PROMPT_V2.md — Стартовый промпт для нового чата

**Версия промпта:** v2.0
**Дата:** 2026-10-13
**Актуальный релиз:** v0.3.0 (MVP замкнут: canvas + ноды + CRUD + Engine + API)
**Текущий этап:** Runner (BullMQ + LLM-провайдеры + SSE-стриминг)

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
- **Не вставляй сразу блок команд + здесь-строку** — PowerShell парсит весь блок до выполнения.
- `Stop-Process -Id <PID>` — **не работает**, `<` зарезервирован. Указывать число: `-Id 20696`.

---

## § 1. Ссылка на репозиторий

- **GitHub:** https://github.com/iilmchat/ai-workflow-builder
- **Ветка:** `main`
- **Текущий релиз:** v0.3.0 (2026-10-13)
- **Рабочий путь:** `D:\Projects\AI\workflow-builder`

### Последние коммиты

- `7330d89` — `docs: update CHANGELOG and PROMPT_V1 after Frontend Task 3`
- `afb3d0c` — `feat(web): API integration — save/load/run workflow`
- `d0d1bfc` — `docs: update CHANGELOG and PROMPT_V1 after Frontend Task 2`
- `67c06c3` — `feat(web): custom nodes (Text / LLM / Image Generation)`
- `246d8b8` — `docs: update CHANGELOG and PROMPT_V1 after Frontend Task 1`
- `fb1c0ea` — `feat(web): initial React Flow canvas + toolbar`
- `cab9edf` — `feat(engine): topological sort + validation + execution plan`
- `4be9cdf` — `feat(workflow): implement CRUD via Drizzle + Zod`

### История коммитов — полный список (24)

`23a4b2e → a257616 → ac9625b → ea09d31 → deddd4e → 326f295 → f890bd5 → f931feb → 99c506b → aa642e4 → f76e9b7 → 4be9cdf → fd1da75 → b76139a → cedb79e → 785fd0c → bdebc6f → cab9edf → 8344e94 → b9b404f → fb1c0ea → 246d8b8 → 67c06c3 → d0d1bfc → afb3d0c → 7330d89`

---

## § 2. Правила оформления (ОБЯЗАТЕЛЬНО)

**`docs/development/RULES.md` — v1.0.0.**

Ключевые разделы:
- **§ 1** — базовые правила (17 правил).
- **§ 2** — документация (CHANGELOG в том же коммите).
- **§ 3** — workflow (маленькие шаги, `git add -A`).
- **§ 4** — технические правила TS/NestJS/ESM/Drizzle (31 правило).
- **§ 5** — безопасность.
- **§ 6** — git.

**Самые важные:**

- **§ 4.1 (backend)** — `.js` в относительных импортах ESM. **Backend — да. Frontend — НЕТ** (Vite сам резолвит).
- **§ 4.28** — NestJS **не читает `.env`** автоматически. `import 'dotenv/config'` в `main.ts`.
- **§ 4.30** — `drizzle-kit` в Windows молчит при ошибках. Запускать через `migrate.ts`.
- **§ 4.31** — `localhost` может резолвиться в IPv6 `::1`. В Docker — `127.0.0.1`. Порт **5433** (не 5432!).
- **§ 3.2** — 1 шаг = 1 коммит.

**Дополнительно (опыт этой сессии, добавить в RULES v1.1):**

- **Необязательные пропы React Flow (`nodeTypes`, `onNodesChange`) не ловит tsc.** Проверка — только в браузере.
- **`pnpm start` на Windows оставляет orphaned node-процесс.** После stop — проверять `netstat -ano | Select-String ":3000|:5173"`.
- **`Stop-Process -Id <PID>`** — PowerShell, `<` зарезервирован, передавать число.
- **`web/node_modules` и `node_modules`** — два независимых (backend и frontend).
- **MD-файлы с внутренними code-блоками** — 4 бэктика снаружи.

---

## § 3. Текущее состояние (v0.3.0)

### Стек

**Backend:**
- NestJS 12, TypeScript 6 (strict, ESM), Vitest
- Drizzle ORM 0.45 + node-postgres (`pg`)
- PostgreSQL 17 (Docker, порт **5433** — см. § 6)
- BullMQ 6 + ioredis (установлены, не подключены)
- Zod 4, Pino
- 68 unit-тестов

**Frontend (`web/`):**
- Vite 8, React 19, TypeScript 6 (strict, ESM — **без .js в импортах**)
- @xyflow/react v12 (React Flow)
- Zustand 5
- Tailwind CSS v4 (@tailwindcss/vite, без JS-конфига)
- Zod (валидация ответов API)

**Инструменты:**
- pnpm 12 (в `packageManager`)
- dsh (DeepSeek Harness) — Web UI на `http://127.0.0.1:3080`

### Архитектура

**Backend — 3 модуля:**
- **WorkflowModule** — CRUD (`/workflow`, 5 endpoints).
- **EngineModule** — validation + topological sort + execution plan (`/engine`, 3 endpoints).
- **NodesModule** — пустой скелет.
- **DbModule** — `@Global()`, токены `DRIZZLE` + `DB_SCHEMA`.

**Frontend — компоненты:**
- `Canvas` (ReactFlow + Background + Controls + MiniMap + nodeTypes).
- `Toolbar` (3 кнопки: Text / LLM / Image Generation).
- `TopBar` (editable name + Load / Save / Run).
- `LoadModal` (список workflow).
- `Toast` (inline-уведомления).
- Ноды: `TextNode`, `LLMNode`, `ImageGenNode` + `BaseNode`.
- Store: `useWorkflowStore` (nodes, edges, currentWorkflowId, executionLevels, actions).

### Схема БД

```
workflows (id, userId, name, description, nodes jsonb, edges jsonb,
           version, createdAt, updatedAt)
  ├── workflow_runs (id, workflowId, status, inputs, outputs, error,
  │                  snapshot, startedAt, finishedAt) [CASCADE]
  │     └── node_runs (id, runId, nodeId, nodeType, status, inputs,
  │                    outputs, error, logs, tokensIn, tokensOut,
  │                    costUsd, durationMs, startedAt, finishedAt) [CASCADE]
```

### Формат Graph DTO

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

### API endpoints

| Метод | URL | Тело / ответ |
|---|---|---|
| POST | `/workflow` | Create + Zod → 201 Created |
| GET | `/workflow?userId=&limit=&offset=` | Массив |
| GET | `/workflow/:id` | Один или 404 |
| PATCH | `/workflow/:id` | Partial + `.refine` против пустого |
| DELETE | `/workflow/:id` | 204 No Content |
| POST | `/engine/validate` | 200 + `{valid, errors[], warnings[]}` |
| POST | `/engine/sort` | `{order: string[]}` или 400 |
| POST | `/engine/plan` | `{order, levels, executionMap}` или 400 |

### Метрики

- **24 коммита**, все запушены, CI зелёный.
- **68 backend-тестов**, все зелёные.
- **9 KI** (KI-001..009): 1 шаблон, 3 Documented, 3 Planned, 2 Low.
- **Bundle frontend:** 506 kB JS, 27 kB CSS.
- **DB:** 3 таблицы в Docker (Postgres 17-alpine, порт 5433).

---

## § 4. Roadmap — сейчас: Runner

### 🎯 Цель следующей итерации

Замкнуть цикл: **нарисовал → сохранил → запустил → LLM выполнил узлы → увидел результат**.

Сейчас Run показывает только план (badges). Runner будет реально **исполнять** узлы.

### Разбивка на 4 подзадачи (R1..R4)

**R1 — BullMQ-инфраструктура (≈40 мин):**
1. Redis в `docker-compose.yml` (порт 6379, named volume).
2. `RunsModule` в backend:
   - `RunsController` (`POST /runs`, `GET /runs/:id`, `GET /runs/:id/stream`).
   - `RunsService` — создание Run + запись в `workflow_runs`.
   - `RunsProcessor` (BullMQ Worker) — скелет.
3. Регистрация `BullModule.forRootAsync` с `ConfigService` (Redis URL из env).
4. Обновить `.env.example` + `docker-compose.yml`.

**R2 — Executor (≈1.5 ч):**
1. `ExecutionEngineService.executeAsync(runId, graph)` — обход `executionMap`.
2. Последовательное выполнение узлов (parallel — позже).
3. Persistence: `node_runs` — insert / update статуса на каждом шаге.
4. Обновление `workflow_runs.status`: `pending → running → completed/failed`.
5. Публикация прогресса в Redis pub/sub (канал `run:{id}`).

**R3 — LLM-провайдеры (≈2 ч):**
1. Интерфейс `ILLMProvider`:
   ```ts
   interface ILLMProvider {
     name: string;
     models: string[];
     generateAsync(prompt: string, options): AsyncIterable<string>;
   }
   ```
2. `AnthropicProvider` (SDK `@anthropic-ai/sdk`).
3. `OpenAIProvider` (SDK `openai`).
4. `ProviderRegistry` — выбор по `node.data.model`.
5. API-ключи — в `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
6. Узлы `TextNode` → output без изменений; `LLMNode` → вызов провайдера.

**R4 — SSE + frontend (≈1.5 ч):**
1. `GET /runs/:id/stream` — SSE, публикация событий из Redis pub/sub:
   - `run_started`, `node_started`, `node_delta`, `node_completed`,
     `run_completed`, `error`.
2. Frontend `TopBar`: кнопка Run → POST /runs → eventSource → подписка.
3. Подсветка нод по статусу (`running` — синий, `completed` — зелёный,
   `error` — красный).
4. Финальный результат — в модалке или панели снизу.

### После Runner (v0.4.0+)

- **Image-провайдеры** (Replicate / FAL / OpenAI Images).
- **Auth** (JWT + Passport, заменить `demo-user`).
- **Multiuser** (фильтр по `userId`).
- **Frontend в CI** (KI-005).
- **Playwright smoke-тест** (ловить KI-007).
- **Parallel execution** (уровни из Engine → `Promise.all`).
- **Узел `http`** (внешние API).
- **Узел `condition`** (ветвление).

---

## § 5. Формат работы

1. **Полные файлы** с JSDoc на русском.
2. **Путь к файлу** в начале каждого блока.
3. **Правка существующего** — точечный diff (Найти / Заменить на).
4. **Новый файл** — целиком.
5. **Несколько правок в одном файле** — нумеровать (Правка 4.1, Правка 4.2).
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

### Не выдумывай

**Если файла нет** — скажи «Нужен файл X». **Если не уверен в API** — попроси проверить.
**Не предлагай «примерно так»** — только точные команды.

### Перед началом работы — дождись «ДА»

Не начинай писать код без подтверждения плана. Исключение — прямое «делай» / «приступай».

---

## § 6. Известные подводные камни (specific to this project)

### Окружение

- **PostgreSQL в Docker на порту 5433** (не 5432 — Windows-сервис `postgresql-x64-17` занимает 5432).
- **Docker контейнер:** `workflow-builder-db` (postgres:17-alpine).
- **Проверка:** `docker ps --filter "name=workflow-builder-db"`.
- **Настройка trust** в `pg_hba.conf` — только для dev.
- **`pnpm start` на Windows** оставляет orphaned node — после stop проверяй `netstat -ano | Select-String ":3000|:5173"`.
- **Vite слушает `[::1]:5173`** (IPv6) — `http://localhost:5173` работает, `127.0.0.1:5173` может не ответить.

### Backend (NestJS + ESM)

- **`.js` в относительных импортах обязателен** (`import { X } from './y.js'`).
- **NestJS не читает `.env`** — `import 'dotenv/config'` первой строкой в `main.ts`.
- **`drizzle-kit migrate` в Windows молчит при ошибках** — использовать `tsx migrate.ts`.
- **`drizzle-kit generate`** работает, `migrate` — нет. Не путать.

### Frontend (Vite + React)

- **НЕ `.js` в импортах** (Vite сам резолвит). Это отличается от backend.
- **`@xyflow/react`, не `reactflow`** — v12 переименован.
- **`nodrag`** на input / textarea / select внутри нод — иначе drag ноды конфликтует с вводом.
- **`useReactFlow().updateNodeData`** — предпочтительнее `setNodes` + ручной поиск.
- **`nodeTypes` регистрировать через `useMemo`** — иначе re-render на каждом рендере.
- **`fitViewOptions: { maxZoom: 1 }`** — иначе 1-2 ноды растягиваются на весь экран.
- **Vite proxy** — `/workflow` и `/engine` → `http://localhost:3000`.
- **Не забывать проп `nodeTypes`** — tsc не поймает (необязательный проп).

### Vitest / тесты

- **`vi.fn()`** вместо `jest.fn()`.
- **`Test.createTestingModule`** вместо `new Service()`.
- **Drizzle моки** сложны — предпочитать in-memory или testcontainers.

### Git

- **Нейтральный author:** `dev@workflow-builder.local` (не менять).
- **`pnpm-lock.yaml` и `web/pnpm-lock.yaml`** — оба коммитить.
- **`web/node_modules` + `node_modules`** — два независимых.

---

## § 7. Стандартные команды

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

**Backend build + test:**
```powershell
cd D:\Projects\AI\workflow-builder
pnpm build
pnpm test
pnpm lint
```

**Frontend build:**
```powershell
cd D:\Projects\AI\workflow-builder\web
pnpm build
```

**Drizzle:**
```powershell
cd D:\Projects\AI\workflow-builder
pnpm db:generate   # миграция из изменений schema.ts
pnpm db:migrate    # применить
pnpm db:studio     # Drizzle Studio
```

**Commit:**
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

**dsh Web UI:**
```powershell
npx @deepseek-ai/dsh web
# → http://127.0.0.1:3080
```

---

## § 8. Начни с вопроса

Прочитай правила и это сообщение. Затем задай мне вопросы:

1. **Что делаем сегодня:**
   - **R1. BullMQ-инфраструктура** (Redis + RunsModule skeleton)?
   - Или сначала **fix CI** (KI-005 — добавить frontend в CI)?
   - Или **improve UI** (что-то в существующем canvas)?
2. **Есть ли pending-изменения** в рабочем дереве? (dsh может писать в фоне).
3. **Есть ли требования**, которых нет в документах?
4. **Нужны ли файлы**, которых у тебя нет?
5. **Какой путь к проекту** — `D:\Projects\AI\workflow-builder`?

**Контекст R1 (Runner, R1 — BullMQ setup):**
- Redis ещё нет в `docker-compose.yml` — добавить.
- `@nestjs/bullmq` + `ioredis` установлены, но не подключены.
- `RunsModule` — новый модуль.
- Endpoint `POST /runs` — создание Run, постановка в очередь.
- Worker — скелет без логики выполнения (она в R2).

**Контекст KI-005 (fix CI):**
- `.github/workflows/ci.yml` — сейчас только backend.
- Добавить job с `working-directory: web` → `pnpm install` + `pnpm build`.
- Простой fix, ~20 минут.

**Готов? Приступаем.**