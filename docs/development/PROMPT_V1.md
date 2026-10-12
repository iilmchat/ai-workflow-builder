# PROMPT_V1.md — Стартовый промпт для нового чата

**Версия промпта:** v1.0
**Дата:** 2026-10-12
**Актуальный релиз:** v0.1.0 (2026-10-13)
**Статус:** CRUD + Engine готовы. В работе — Frontend (React Flow canvas).

---

## § 0. Главное правило форматирования

**Не более одного уровня code fence'ов в твоём ответе.**

- Обычный код — тройной бэктик, **не вкладывать** внутрь другого.
- Пример внутри markdown-блока — **4-пробельный отступ**.
- Команда (inline) — `pnpm build`.
- **MD-файлы, содержащие внутренние code-блоки** — оборачивать в **4 бэктика**.

**Большие MD-файлы** (README, RULES, CHANGELOG, KNOWN_ISSUES, RELEASES, DESIGN*):
только **точечный diff** («Найти X / Заменить на Y») или **отдельная секция**.

**PowerShell-специфика:**
- `<<'EOF'` (bash heredoc) **НЕ работает** — используй `@'...'@ | Out-File .file -Encoding utf8NoBOM`.
- Multi-line команды — через backtick `` ` `` в конце строки.
- **Не вставляй сразу блок команд + здесь-строку** — PowerShell парсит весь блок до выполнения.

---

## § 1. Ссылка на репозиторий

- **GitHub:** _(добавить при создании репо)_
- **Ветка:** `main` (или `master` — переименовать)
- **Текущий релиз:** v0.1.0 (2026-10-12).

### История коммитов

- `23a4b2e` — `chore: initial NestJS 12 skeleton with ESM + vitest + drizzle`
- `a257616` — `feat: scaffold workflow, engine, nodes modules`
- `ac9625b` — `feat: add Drizzle schema + PostgreSQL integration + docs`
- `ea09d31` — `chore: add docker-compose.yml for local PostgreSQL`
- `deddd4e` — `docs: replace NestJS default README with project overview`
- `326f295` — `chore: add .env.example template`
- `f890bd5` — `docs: fix markdown formatting in README`
- `f931feb` — `ci: add GitHub Actions workflow`
- `f76e9b7` — `fix: move allowBuilds to pnpm-workspace.yaml`
- `4be9cdf` — `feat(workflow): implement CRUD via Drizzle + Zod`
- `fd1da75` — `docs: add CI status badge`
- `bdebc6f` — `docs: update CHANGELOG and PROMPT_V1 after CRUD + PATCH fix`
- `<новый hash>` — `feat(engine): topological sort + validation + execution plan`

---

## § 2. Правила оформления (ОБЯЗАТЕЛЬНО)

**`docs/development/RULES.md` — v1.0.0 (2026-10-12).**

Ключевые разделы:

- **§ 1** — базовые правила (17 правил, включая strict TS, Zod-валидация).
- **§ 2** — документация (CHANGELOG в том же коммите, 4 бэктика для MD).
- **§ 3** — workflow (маленькие шаги, `git add -A`, build 0/0).
- **§ 4** — технические правила TS/NestJS/ESM/Drizzle (31 правило).
- **§ 5** — безопасность.
- **§ 6** — git.

**Самые важные для нового проекта:**

- **§ 4.1** — `.js` в относительных импортах ESM. Не забывать никогда.
- **§ 4.28** — NestJS **не читает `.env`** автоматически. `import 'dotenv/config'` в `main.ts`.
- **§ 4.30** — `drizzle-kit` в Windows молчит при ошибках. Запускать через скрипт `drizzle-orm/migrator`.
- **§ 4.31** — `localhost` может резолвиться в IPv6 `::1`. В Docker — `127.0.0.1`.
- **§ 2.10** — 4 бэктика снаружи для MD с кодом.
- **§ 3.2** — 1 шаг = 1 коммит.

---

## § 3. Текущее состояние (v0.1.0)

### Стек

- **Backend:** NestJS 12, TypeScript 6 (strict, ESM), Vitest, Drizzle ORM, PostgreSQL 17, BullMQ + Redis (установлены, не подключены), Zod, Pino.
- **Frontend:** _(пока не начат)_ React 19 + Vite + @xyflow/react.
- **БД:** PostgreSQL 17 в Docker (`workflow-builder-db`).
- **Инструменты:** pnpm 12, dsh (DeepSeek Harness) для генерации кода.

### Архитектура — 3 слоя

- **Controllers** — HTTP endpoints.
- **Services** — бизнес-логика (Workflow, Engine, Nodes).
- **Data (Drizzle)** — БД-операции, схема.

### Метрики

- **3 модуля** (Workflow, Engine, Nodes).
  - **Workflow** — CRUD реализован (5 endpoints).
  - **Engine** — validation + topological sort + execution plan.
  - **Nodes** — пустой скелет.
- **3 таблицы** БД (workflows, workflow_runs, node_runs).
- **68 тестов** (7 базовых + 24 CRUD + 10 PATCH fix + 27 Engine).
- **CI**: зелёный (build + test на push).
- **KI:** 3 (KI-001 шаблон, KI-002 validateGraphAsync async-нейминг, KI-003 executionMap collisions).
- **Релизы**: v0.1.0 (scaffold + Drizzle + CRUD + Engine).

---

## § 4. Roadmap текущей сессии

### Пункт A — ✅ Сделан: CRUD Workflow (v0.1.0)

- 5 REST endpoints, Zod-валидация, 24 теста, lint clean.
- См. commit `4be9cdf`.

### Пункт B — ✅ Сделан: Engine (v0.2.0)

- `EngineService` — Kahn's algorithm + DFS cycle detection + levels.
- `EngineController` — 3 endpoints.
- 29 тестов.
- См. commit `<hash>`.

### Пункт C — Сейчас: Frontend (React Flow canvas)

1. Отдельный пакет `web/` (Vite + React 19 + TypeScript).
2. React Flow (`@xyflow/react` v12).
3. 3 кастомных нода: `TextNode`, `LLMNode`, `ImageGenNode`.
4. Панель добавления нод (левая панель / toolbar).
5. Сохранение / загрузка графа через `/workflow` API.
6. Кнопка «Run» (пока — вызов `/engine/plan`, отображение порядка).

### Пункт D — После frontend: Runner

- BullMQ queue + worker.
- LLM-провайдеры (Anthropic / OpenAI / локальные).
- Image-generation провайдеры.
- SSE-стриминг прогресса.

---

## § 5. Формат работы

1. **Полные файлы** с JSDoc на русском.
2. **Путь к файлу** в начале каждого блока кода.
3. **Правка существующего** — точечный diff (Найти / Заменить на).
4. **Новый файл** — выводить целиком.
5. **Несколько правок в одном файле** — нумеровать: Правка 4.1, Правка 4.2.
6. **Новые зависимости** — с версиями и указанием (`dependencies` / `devDependencies`).
7. **Сводка в конце**: что сделано / что проверить.
8. **Новые проблемы** → `KI-XXX` в `docs/KNOWN_ISSUES.md`.
9. **Новые UI-строки** → оба i18n-файла (RU + EN) — правило 1.14.
10. **Новый узел** → 1 файл + 1 строка регистрации в `NodeRegistry`.
11. **`CHANGELOG.md` — в КАЖДОМ коммите с кодом** (RULES § 2.1).
12. **Обновление `package.json` `version`** — только при релизе.

### Обязательные секции в конце ответа

- 🔨 **Build + test** — команды + ожидание (0/0; N/N тестов).
- 🚀 **Commit** — here-string + `git add -A` + `push`.
- 🧪 **Smoke** — что проверить (сценарии / DevTools / SQL).
- 📊 **Сводка** — статус + что жду.
- 🎯 **Что дальше** — предложение следующего шага (с оценкой).

### Если чего-то не хватает

**Не выдумывай.** Скажи явно: «Нужен файл X». Дождись. Не предлагай «примерно так».

### Перед началом работы — дождись «ДА»

Не начинай писать код, пока пользователь не подтвердил план / DESIGN / предыдущий шаг.
Исключение: прямое «делай» / «приступай».

### Рабочий путь

- **Основной (Windows):** `D:\Projects\AI\workflow-builder`.

### Стандартные команды

**Остановить приложение:**

    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*workflow-builder*" } | Stop-Process -Force

**Build + test:**

    cd D:\Projects\AI\workflow-builder
    pnpm build
    pnpm test

**Запуск (dev):**

    cd D:\Projects\AI\workflow-builder
    pnpm start:dev

UI: `http://localhost:3000`. PostgreSQL: `localhost:5432`.

**Drizzle:**

    pnpm db:generate   # создать миграцию из изменений схемы
    pnpm db:migrate    # применить миграции к БД
    pnpm db:studio     # Drizzle Studio (веб-UI для БД)

**Commit:**

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

---

## § 6. Известные подводные камни

### Общие

- **ESM-импорты** — всегда `.js` в относительных путях (RULES § 4.1).
- **NestJS не читает `.env`** — `import 'dotenv/config'` в `main.ts` (RULES § 4.28).
- **`drizzle-kit` молчит при ошибках в Windows** — запускать через скрипт `drizzle-orm/migrator` (RULES § 4.30).
- **`localhost` может быть IPv6** — использовать `127.0.0.1` (RULES § 4.31).
- **`.resx`-ключи** — не применимо (у нас JSON i18n), но **дубликаты ключей в JSON → последний wins**. Проверять.
- **Кэш браузера** после правок JS/CSS — `Ctrl+Shift+R` + DevTools → Disable cache.
- **`pnpm-lock.yaml`** — коммитить всегда вместе с `package.json`.
- **БД-контейнер** — `docker ps --filter "name=workflow-builder-db"` для проверки.
- **`.env`** — не коммитить никогда.
- **`dist/`** — в `.gitignore`.

### Drizzle

- **`$type<RunStatus>()`** — для типизации enum-полей (status).
- **relations** — обязательны для `db.query.*.findMany({ with: ... })`.
- **`drizzle-kit push`** — только для разработки, в prod — `migrate`.
- **`jsonb` default** — `default([])` (не `default('[]'::jsonb)`).

### Тесты

- **Vitest + NestJS** — `Test.createTestingModule` вместо `new Service()`.
- **`vi.fn()`** вместо `jest.fn()`.
- **Mock Drizzle** — сложно мокать; лучше использовать in-memory или testcontainers.

---

## § 7. Начни с вопроса

Прочитай правила и это сообщение. Затем задай мне вопросы:

1. **Что делаем сегодня:**
   - **A. CRUD Workflow** (Service + Controller + DTO + тесты)?
   - **B. Engine** (топологическая сортировка + валидация графа)?
   - **C. Frontend** (React Flow + 3 нода)?
2. **Есть ли требования, которых нет в документах?**
3. **Нужны ли файлы, которых у тебя нет?**
4. **Какой путь к проекту** — `D:\Projects\AI\workflow-builder`?

**Готов? Приступаем.**