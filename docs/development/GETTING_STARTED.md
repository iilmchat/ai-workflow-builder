# GETTING_STARTED — Разворачивание проекта

**Для кого:** новый разработчик, который впервые поднимает `IIChatTools AI Workflow Builder`.
**Время:** ~20 минут на Windows, ~15 минут на macOS/Linux.
**Результат:** работающий backend (`http://localhost:3000`), frontend
(`http://localhost:5173`), PostgreSQL 17 в Docker и зелёные тесты.

---

## § 0. TL;DR (для опытных)

Если коротко — три команды:

```bash
git clone https://github.com/iilmchat/ai-workflow-builder.git
cd ai-workflow-builder
docker compose up -d && pnpm install && pnpm db:migrate && pnpm start:dev
```

И отдельно frontend:

```bash
cd web && pnpm install && pnpm dev
```

Если что-то не работает — раздел **§ 7 Troubleshooting** в конце.

---

## § 1. Что нужно установить

| Инструмент | Версия | Проверка | Зачем |
|---|---|---|---|
| **Node.js** | 22 LTS или выше | `node --version` | Runtime для backend и frontend |
| **pnpm** | 12.x (см. ниже) | `pnpm --version` | Пакетный менеджер (не npm!) |
| **Docker Desktop** | последняя | `docker --version` | PostgreSQL 17 + будущий Redis |
| **Git** | любая актуальная | `git --version` | — |
| **GitHub CLI** (опц.) | 2.40+ | `gh --version` | Клонирование + создание PR |
| **VS Code** (опц.) | последняя | — | Рекомендуется с расширениями ESLint, Prettier, Tailwind |

### Установка Node.js 22

**Windows:**
- Скачайте с [nodejs.org](https://nodejs.org/) → LTS 22.x
- Или: `winget install OpenJS.NodeJS.LTS`

**macOS:**
```bash
brew install node@22
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Установка pnpm 12

**Важно:** у проекта в `package.json` указано `"packageManager": "pnpm@12.11.2"`.
Ставьте **именно 12.x** — иначе лок-файл не сойдётся.

**Способ A (рекомендуется) — через corepack:**

```bash
corepack enable
corepack prepare pnpm@12.11.2 --activate
```

**На Windows** `corepack enable` может упасть с `EPERM` — это норма (нужны админ-права
на запись в `C:\Program Files\nodejs\`). Тогда — способ B.

**Способ B — через npm (обходной путь для Windows):**

```powershell
npm install -g pnpm@12.11.2
```

**Проверка:**

```bash
pnpm --version
# Ожидание: 12.11.2
```

### Установка Docker Desktop

**Windows:** [docs.docker.com/desktop/install/windows-install](https://docs.docker.com/desktop/install/windows-install/)
**macOS:** [docs.docker.com/desktop/install/mac-install](https://docs.docker.com/desktop/install/mac-install/)
**Linux:** `curl -fsSL https://get.docker.com | sh`

**Проверка:**

```bash
docker --version
docker compose version
docker ps
```

---

## § 2. Клонирование репозитория

```bash
cd <куда-то-где-работаете>
git clone https://github.com/iilmchat/ai-workflow-builder.git
cd ai-workflow-builder
```

### 2.1. Настройте git-author (обязательно для новых коммитов)

**Это важно** — история проекта ведётся с **нейтральным** автором. Не используйте
личный email/имя (в проекте был инцидент с утечкой email через git-историю).

```bash
git config user.name "Workflow Builder Developer"
git config user.email "dev@workflow-builder.local"
```

Проверка:
```bash
git config user.name
git config user.email
```

### 2.2. Структура проекта

```
ai-workflow-builder/
├── src/                    ← NestJS backend
├── web/                    ← React frontend (свой package.json)
├── drizzle/                ← миграции БД
├── docs/                   ← документация
│   ├── development/
│   │   ├── RULES.md                 ← правила разработки
│   │   ├── PROMPT_CURRENT.md        ← актуальный системный промпт
│   │   ├── GETTING_STARTED.md       ← этот файл
│   │   └── RELEASES.md              ← чек-лист релиза
│   ├── CHANGELOG.md
│   └── KNOWN_ISSUES.md
├── docker-compose.yml      ← PostgreSQL 17 + pgvector, Redis
├── package.json            ← backend
├── pnpm-lock.yaml          ← backend lock
└── .env.example            ← шаблон для .env
```

**Ключевое:** `web/` — это **отдельный пакет** со своим `package.json` и своим
`node_modules`. При установке зависимостей нужно заходить и в корень, и в `web/`.

---

## § 3. Поднимаем PostgreSQL в Docker

### 3.1. Что здесь важно — про порт 5433

**Порт 5432 занят** — на многих Windows-машинах есть системный
`postgresql-x64-17` (или другая версия). Если поднять контейнер на 5432, то
Windows-сервис «перебьёт» его, и вы будете отлаживать **чужой** Postgres.

**Проект использует порт `5433`** — проброс `5433:5432` в `docker-compose.yml`.
Это **не ошибка**, это осознанное решение.

### 3.2. Запуск

```bash
docker compose up -d
```

Первый запуск ~30 секунд — Docker скачает `postgres:17-alpine` (~80 MB).

**Проверка:**

```bash
docker ps --filter "name=workflow-builder-db"
```

Ожидание:
```
CONTAINER ID   IMAGE                STATUS          PORTS
xxx            postgres:17-alpine   Up 10 seconds   0.0.0.0:5433->5432/tcp
```

**Проверка порта:**

```bash
# Windows
netstat -ano | findstr ":5433"

# macOS / Linux
lsof -i :5433
```

Ожидание: одна или две строки LISTENING от Docker.

### 3.3. Если 5433 тоже занят

Смените порт в `docker-compose.yml`:

```yaml
ports:
  - "5434:5432"   # вместо 5433
```

И в `.env`:
```
DATABASE_URL=postgres://workflow:devpass123@127.0.0.1:5434/workflow_builder
```

---

## § 4. Настройка `.env`

### 4.1. Создайте `.env` из шаблона

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux / Git Bash
cp .env.example .env
```

### 4.2. Что должно быть в `.env`

Откройте `.env` в редакторе. Минимальный набор для dev:

```env
# Database (порт 5433 — НЕ 5432!)
DATABASE_URL=postgres://workflow:devpass123@127.0.0.1:5433/workflow_builder

# App
NODE_ENV=development
PORT=3000
```

### 4.3. Что НЕ надо коммитить

**`.env` в `.gitignore`.** Никогда не коммитьте — там могут быть API-ключи, когда
добавим Runner (Anthropic, OpenAI).

Если случайно закоммитили:
```bash
git rm --cached .env
git commit -m "security: remove .env from tracking"
```

---

## § 5. Backend — установка и запуск

### 5.1. Установите зависимости

```bash
pnpm install
```

Первый раз — 30-60 секунд. Скачает ~330 пакетов.

**Если увидите `ERR_PNPM_IGNORED_BUILDS`** — это **не ошибка**, а предупреждение
pnpm 12 о том, что часть пакетов имеет postinstall-скрипты (`esbuild`,
`msgpackr-extract`). Пакеты уже установлены, но их сборка заблокирована политикой
безопасности. Разрешите явно:

```bash
pnpm approve-builds
```

В интерактивном меню: пробелом отметить `esbuild` + `msgpackr-extract`, Enter.

Затем:
```bash
pnpm install
```

### 5.2. Примените миграции

```bash
pnpm db:migrate
```

Ожидание:
```
URL: postgres://workflow:devpass123@127.0.0.1:5433/workflow_builder
Применяем миграции...
✅ Миграции применены
```

**Проверка таблиц:**

```bash
docker exec -it workflow-builder-db psql -U workflow -d workflow_builder -c "\dt"
```

Ожидание: **3 таблицы** в `public` (`workflows`, `workflow_runs`, `node_runs`)
+ схема `drizzle` с таблицей `__drizzle_migrations`.

### 5.3. Запустите backend

```bash
pnpm start:dev
```

Ожидание в терминале:
```
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] DbModule dependencies initialized
[Nest] LOG [InstanceLoader] WorkflowModule dependencies initialized
[Nest] LOG [InstanceLoader] EngineModule dependencies initialized
[Nest] LOG [RouterExplorer] Mapped {/, GET} route
[Nest] LOG [RouterExplorer] Mapped {/workflow, POST} route
[Nest] LOG [RouterExplorer] Mapped {/workflow, GET} route
...
[Nest] LOG [NestApplication] Nest application successfully started
```

**Smoke-проверка:**

```bash
# В другом терминале
curl http://localhost:3000/
# Ожидание: Hello World!
```

Или через PowerShell:
```powershell
Invoke-RestMethod http://localhost:3000/ -Method Get
```

**Остановка:** `Ctrl+C`.

---

## § 6. Frontend — установка и запуск

**В отдельном терминале** (backend может продолжать работать):

```bash
cd web
pnpm install
```

Первый раз — ~40 секунд. **У `web/` свой `node_modules`** — это норма, не пугайтесь.

### 6.1. Запустите Vite

```bash
pnpm dev
```

Ожидание:
```
  VITE v8.3.4  ready in 610 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 6.2. Откройте в браузере

**http://localhost:5173/**

Что должно быть:
- Пустой canvas с точечной сеткой.
- Слева внизу — zoom controls.
- Справа внизу — minimap.
- Внизу по центру — toolbar с 3 кнопками (Text / LLM / Image Generation).
- Сверху — TopBar с полем имени и кнопками Load / Save / Run.

### 6.3. Smoke-тест

1. Нажмите **📝 Text** → появляется нода в центре.
2. Нажмите **🤖 LLM** → вторая нода.
3. Нажмите **🖼 Image Generation** → третья нода.
4. Соедините: проведите от правого порта `Text` к левому порту `LLM`.
5. В верхней панели введите имя, например «Мой первый workflow».
6. Нажмите **💾 Save** → тост «Workflow сохранён», в URL появится `?workflowId=...`.
7. Нажмите **F5** → граф восстановится из БД.
8. Нажмите **▶️ Run** → на нодах появятся badges с номерами уровней.

**Если все 8 шагов прошли** — установка завершена, можно работать.

---

## § 7. Troubleshooting

### 7.1. `pnpm: команда не найдена`

**Причина:** pnpm не установлен или не в `PATH`.

**Fix:**
```bash
npm install -g pnpm@12.11.2
# Закрыть и открыть терминал заново
pnpm --version
```

### 7.2. `Error: DATABASE_URL is not set`

**Причина:** `.env` не создан или NestJS его не видит.

**Проверка:**
```bash
# Файл .env в корне?
ls -la | grep .env

# Что внутри?
cat .env
```

**Fix:**
1. Убедитесь, что файл `.env` **в корне проекта** (рядом с `package.json`).
2. Проверьте, что `main.ts` начинается с `import 'dotenv/config';`.
3. Перезапустите `pnpm start:dev`.

### 7.3. `28P01 password authentication failed for user "workflow"`

**Причина:** Docker-контейнер запущен с другим паролем, или вы подключаетесь
к **чужому** Postgres (системному) на 5432.

**Проверка:**

```bash
# Кто реально слушает порт?
# Windows
netstat -ano | findstr ":5432"
netstat -ano | findstr ":5433"

# macOS / Linux
lsof -i :5432
lsof -i :5433
```

Если видите **два** LISTENING на 5432 — у вас Windows-сервис Postgres
перебивает Docker. **Убедитесь, что в `.env` указан порт 5433.**

**Полное решение:**

```bash
# Убить контейнер и volume (данные потеряются, но в dev это ок)
docker compose down -v

# Поднять заново
docker compose up -d

# Подождать 10 секунд
Start-Sleep -Seconds 10   # Windows
sleep 10                  # macOS/Linux

# Перезапустить миграции
pnpm db:migrate
```

### 7.4. `Error: connect ECONNREFUSED 127.0.0.1:5433`

**Причина:** Docker-контейнер не запущен.

**Fix:**
```bash
docker ps
docker compose up -d
```

Если Docker Desktop вообще не запущен — откройте его и подождите ~30 сек.

### 7.5. `drizzle-kit migrate` падает молча

**Причина:** известный баг drizzle-kit на Windows — не показывает stack trace.

**Fix:** используйте `pnpm db:migrate` — он вызывает `tsx migrate.ts` с полным
выводом ошибки. Если падает — увидите **настоящую** причину.

### 7.6. `EADDRINUSE: address already in use :::3000`

**Причина:** предыдущий `pnpm start:dev` не завершился корректно.

**Windows:**
```powershell
netstat -ano | Select-String ":3000.*LISTENING"
# Смотрим PID, например 20696
Stop-Process -Id 20696 -Force
```

**macOS / Linux:**
```bash
lsof -ti :3000 | xargs kill -9
```

### 7.7. `EADDRINUSE` на 5173

Аналогично, но для Vite:

```powershell
# Windows
netstat -ano | Select-String ":5173.*LISTENING"
Stop-Process -Id <PID> -Force
```

Или просто `Ctrl+C` в терминале, где запущен `pnpm dev`.

### 7.8. Узлы на frontend рендерятся как дефолтные (серые прямоугольники)

**Причина:** потерян проп `nodeTypes` в `Canvas.tsx`, **tsc это не ловит**
(проп необязательный) — известная проблема (KI-007).

**Fix:** проверьте `web/src/components/Canvas.tsx`:

```tsx
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}   ← это должно быть здесь!
  ...
>
```

### 7.9. `CRLF will be replaced by LF` при `git add`

**Это нормально.** Файл `.gitattributes` содержит `* text=auto eol=lf` — Git
нормализует переносы строк на LF (стандарт для Node.js). Ваши файлы на диске
**не тронутся**, только при коммите нормализуются.

**Игнорируйте эти warnings.**

### 7.10. Frontend: `pnpm install` идёт медленно

**Причина:** скачивается `@xyflow/react`, `react`, `vite`, Tailwind — ~60 пакетов.

**Норма:** 30-60 секунд при нормальном интернете.

**Если >2 минут:** проверьте прокси / VPN, попробуйте `pnpm config set registry https://registry.npmjs.org`.

---

## § 8. Работа с DeepSeek Harness (опционально)

`dsh` — это **внешний инструмент** для генерации кода, не часть проекта.
Устанавливается отдельно.

### 8.1. Установка

```bash
npx @deepseek-ai/dsh web
```

При первом запуске:
- Откроется браузер на `http://127.0.0.1:3080`.
- В настройках подключите модель (API-ключ DeepSeek).
- Выберите workspace: путь к `ai-workflow-builder`.

### 8.2. Как использовать

В Web UI dsh:
1. Выберите workspace (`workflow-builder`).
2. Введите задачу (одну атомарную, не «сделай всё»).
3. Дождитесь отчёта dsh.
4. **Проверьте вручную** результат:
   - `pnpm build` → 0 errors.
   - `pnpm test` → все зелёные.
   - Открыть в браузере и убедиться, что работает.
5. Коммит:
   ```bash
   git add -A
   git commit -m "feat(...): ..."
   git push
   ```

### 8.3. Правила работы с dsh

- **Одна задача — одна логическая единица.** Не смешивайте.
- **Не давайте доступ к папкам вне проекта.**
- **Проверяйте после каждой задачи.** Если что-то не так — `git reset --hard <hash>`.
- **Если dsh «завис»** (долго думает, повторяется) — прервите, переформулируйте.

---

## § 9. Полезные команды (шпаргалка)

### Backend

```bash
cd ai-workflow-builder

# Запуск (dev)
pnpm start:dev

# Build
pnpm build

# Тесты
pnpm test              # все
pnpm test:watch        # watch-режим
pnpm test:cov          # с покрытием

# Lint
pnpm lint

# БД
pnpm db:generate       # миграция из изменений schema.ts
pnpm db:migrate        # применить
pnpm db:studio         # Drizzle Studio (веб-UI)
```

### Frontend

```bash
cd ai-workflow-builder/web

pnpm dev               # Vite (5173)
pnpm build             # tsc + vite build
pnpm preview           # посмотреть production-сборку локально
```

### Docker

```bash
docker compose up -d           # поднять Postgres (+ Redis в будущем)
docker compose down            # остановить
docker compose down -v         # остановить + удалить volume (данные!)
docker logs workflow-builder-db --tail 50
docker exec -it workflow-builder-db psql -U workflow -d workflow_builder
```

### Git

```bash
git status --short
git log --oneline -10
git diff
git add -A
git commit -m "..."
git push
```

### Процессы (Windows)

```powershell
# Убить все node, связанные с проектом
Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "*workflow-builder*" } |
    Stop-Process -Force

# Кто слушает порты?
netstat -ano | Select-String ":3000|:5173|:5433"
```

---

## § 10. Что дальше

### 10.1. Прочитайте документацию

Обязательный минимум:
1. **`docs/development/RULES.md`** — правила разработки (TS/NestJS/ESM/Drizzle).
2. **`docs/KNOWN_ISSUES.md`** — известные проблемы и их статус.
3. **`docs/CHANGELOG.md`** — история версий.
4. **`docs/development/PROMPT_CURRENT.md`** — актуальный системный промпт для
   нового чата с ИИ.

### 10.2. Возьмите первую задачу

- Откройте `docs/development/PROMPT_CURRENT.md` — там статус, метрики и план
  следующего релиза.
- Возьмите одну подзадачу (R1, R2, R3 или R4).
- Работайте малыми шагами.

### 10.3. Как коммитить

Формат: `<type>(<scope>): <subject>`

Типы: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `security`, `perf`.

Пример:
```
feat(runs): add BullMQ queue for workflow execution

- Register BullModule.forRootAsync with REDIS_URL
- Create RunsModule with RunsService skeleton
- Add POST /runs endpoint (creates run, enqueues job)

Build 0/0. Tests 73/73.
```

### 10.4. Открывайте PR для нетривиальных изменений

Для мелких правок — push в `main` (это pet-проект).
Для крупных фич — ветка `feature/xxx` + PR.

---

## § 11. Контакты и ссылки

- **GitHub:** https://github.com/iilmchat/ai-workflow-builder
- **Issues:** https://github.com/iilmchat/ai-workflow-builder/issues
- **CI:** https://github.com/iilmchat/ai-workflow-builder/actions

**Если что-то не работает и не описано здесь:**
1. Проверьте `docs/KNOWN_ISSUES.md` — возможно, уже задокументировано.
2. Создайте Issue с описанием и логами.
3. Приложите вывод:
   - `node --version`, `pnpm --version`, `docker --version`
   - `docker ps`
   - `cat .env` (без секретов)
   - Логи из терминала

---

**© 2026 RuChating (iilmchat) · IIChatTools AI Workflow Builder v0.3.0**