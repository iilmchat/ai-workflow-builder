# IIChatTools AI Workflow Builder

[![CI](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](docs/CHANGELOG.md)
[![Backend tests](https://img.shields.io/badge/backend_tests-1935-brightgreen.svg)](docs/development/RELEASES.md)
[![Frontend tests](https://img.shields.io/badge/frontend_tests-500-brightgreen.svg)](docs/development/RELEASES.md)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey.svg)](#лицензия)

> **Визуальный конструктор AI-сценариев.** Собирайте LLM-, медиа- и агентные
> workflow на холсте, запускайте их в фоне и наблюдайте за результатом в
> реальном времени.

**Версия:** `v1.3.0` · **Стек:** NestJS 12 · React 19 · PostgreSQL 17 + pgvector ·
S3 · OpenTelemetry · Docker/GHCR
**© 2026 RuChating (iilmchat)**

---

## Что это

IIChatTools AI Workflow Builder — веб-приложение для сборки AI-пайплайнов без
кода. Пользователь перетаскивает узлы на холст, соединяет их типизированными
портами и нажимает «Запустить». Движок строит план выполнения, ставит задачи в
очередь, вызывает нужные модели и показывает прогресс прямо на графе.

Проект вырос из «текст → LLM → результат» в полноценную платформу: **22 типа
узлов**, медиа-генерация, веб-поиск, генерация DOCX, безопасная работа с
файлами, векторная память, агентный цикл, совместная работа по Share-ссылкам,
S3-хранилище и наблюдаемость через OpenTelemetry.

---

## Возможности

### 🎨 Конструктор

- **22 типа узлов** с типизированными портами: Text, LLM, Agent, Image
  Generation, Image Tool, Video / Audio / Music Generation, Condition, Compare,
  HTTP, Web Search, Document Generation, Read File / Write File, Sub-workflow,
  Vector Upsert / Query, Memory Read / Write, Output, Comment.
- **Canvas UX:** undo/redo, мультивыделение, копирование/дублирование, горячие
  клавиши, автопозиционирование, миникарта со статусами узлов.
- **Тёмная тема и i18n** (RU / EN), импорт и экспорт workflow, галерея шаблонов,
  вложенные сценарии (sub-workflows). С v0.11 статусы узлов, медиа-плейсхолдеры и
  предупреждения используют семантические токены темы — карточки остаются
  читаемыми в светлой и тёмной теме (KI-448).
- **Производительность:** route-level code-split для всех 22 узлов — основной
  чанк уменьшен с **774 kB до 141 kB**.

### ⚙️ Выполнение

- **BullMQ + Redis:** фоновые запуски, ретраи job'а и отдельных узлов,
  изоляция очередей между инстансами (`BULLMQ_PREFIX`).
- **Run Lease / Heartbeat (v0.11 S9):** запуск продлевает
  `workflow_runs.lease_expires_at` каждые 30 с (`WORKFLOW_RUN_HEARTBEAT_MS`,
  TTL — `WORKFLOW_RUN_LEASE_TTL_MS`, 90 с), поэтому легитимно долгий прогон не
  считается зависшим и не переигрывается параллельно; падение worker'а
  обнаруживается за TTL, а для старых строк без аренды сохранён fallback по
  `started_at`.
- **Отмена запуска (v1.4.0 S1):** `POST /runs/:id/cancel` (JWT, владелец или
  `editor`) отменяет `pending`-запуск сразу — `status='cancelled'`, задание
  удаляется из BullMQ — а у `running` выставляет `workflow_runs.cancelled_at`.
  Движок проверяет флаг перед каждым уровнем и узлом, останавливается и
  `RunsProcessor` закрывает запуск `cancelled`; в TopBar — кнопка «Отменить»
  при активном запуске, финал приходит SSE-событием `run_completed`
  (`status: 'cancelled'`). Отмена кооперативная: текущий узел доигрывается.
- **История в PostgreSQL:** `workflow_runs`, `node_runs`, версии workflow,
  аудит действий. С v0.11 (S12+S13) `GET /runs/:id/nodes` отдаёт снимок узлов,
  и после F5 панель результата восстанавливает статусы, выходы, ошибки, логи и
  метрики узлов без SSE (KI-077).
- **История запусков (v0.14 S1–S2; keyset — v0.16 S1):**
  `GET /workflow/:id/runs?limit=20&cursor=…` отдаёт `{ runs, nextCursor, total }` — статус,
  даты создания/старта/финиша, длительность (`finished_at − started_at`),
  стоимость (`costUsd`/`costRub` — суммы по `node_runs`) и непрозрачный `cursor`
  каждого запуска, сначала новые. Keyset-пагинация по `(created_at, id)` не
  сдвигается при появлении новых запусков (KI-542); модалка истории догружает
  страницы кнопкой «Загрузить ещё». Смотреть историю может владелец или
  участник с ролью `editor`; чужой workflow и `viewer` получают 404 (как у
  запуска, KI-202). В верхней панели — кнопка «История» (🕒): модалка со
  списком (статус, дата, длительность, стоимость); клик по запуску закрывает
  её, пишет `?runId=` и восстанавливает выбранный прогон в панели результата
  (`restoreRunAsync`, как после F5), поэтому F5 больше не теряет панель
  (KI-541). Кнопка активна только для сохранённого workflow; для `viewer`
  скрыта (история требует `editor`, KI-537).
- **Сравнение запусков (v1.4.0 S2):** `GET /runs/:id1/compare/:id2` (JWT,
  владелец или `editor` для обоих запусков) отдаёт `{ run1, run2, diffs }`:
  поузловые `nodeDiffs` (статусы, длительности, стоимость USD, diff outputs
  `{ changed, onlyRun1, onlyRun2 }` с лимитом 100 КБ) и `totalDiff` — дельты
  `durationMs`/`costUsd`/`costRub`. В модалке истории — чекбоксы двух
  запусков и кнопка «Сравнить»; `RunCompareModal` рисует side-by-side
  таблицу с подсветкой различий красным/зелёным.
- **Ретраи и надёжность:** повторы узлов при 429/5xx/таймаутах провайдеров
  (LLM и media) с экспоненциальной задержкой и `Retry-After`; в шапке — бейдж
  «попытка N/M», в панели результата — логи ретраев.
- **SSE-стриминг:** snapshot состояния и события узлов в реальном времени.
- **Панель результата:** outputs (JSON), длительность, токены, стоимость,
  ошибки и логи ретраев.

### 🤖 Модели и медиа

- **LLM-провайдеры:** Anthropic, OpenAI, RouterAI, GPTunnel, DeepSeek,
  Yandex AI Studio, LM Studio.
- **Reasoning и prompt caching** провайдеров; выбор модели и `maxTokens` —
  прямо в узле.
- **Медиа-генерация:** изображения, видео, аудио, музыка; инструменты upscale,
  удаления фона и lipsync.
- **Провайдеры медиа:** GPTunnel CreativeLab, Replicate, FAL, OpenAI Images.
- **Бюджет запуска:** лимит стоимости, учёт токенов и `cost_rub` / `cost_usd`.

### 🖥️ LLM Router

- **GPU-бэкенд и облачный fallback (v1.2 S1):** при `LLM_ROUTER_ENABLED=true`
  LLM-вызов сначала идёт в локальный LM Studio; при ошибке или таймауте —
  WARN и повтор в облако моделью `LLM_ROUTER_FALLBACK_MODEL` (по умолчанию
  `gpt-4o-mini`). Флаг по умолчанию `false`: без него поведение прежнее, все
  вызовы идут в облако. Healthcheck пингует `GET /v1/models` раз в 30 с; после
  трёх неудач подряд локальный провайдер исключается из роутинга до
  восстановления.
- **Сверка возможностей при подмене (v1.3 S1, KI-617):** у каждой модели есть
  паспорт (`inputModalities`, `supportsReasoning`, `supportsTools`, `maxTokens`).
  Локальная и fallback-модели выбираются только при совместимости с исходной:
  vision-вызов не уйдёт в текстовую модель, agent-шаг — в модель без
  tool-calling (`requiresTools`), а слишком маленький контекст кандидата
  отсекается. Приоритет fallback — исходная облачная модель пользователя →
  `LLM_ROUTER_FALLBACK_MODEL` → первая совместимая облачная (WARN) → ошибка
  «нет облачной модели, совместимой…». Ограничения — KI-629..631.
- **Индикатор GPU (v1.2 S3, KI-618; auth и паритет — v1.3 S2, KI-626/627):**
  `GET /llm/health` отдаёт `{ local: { available, lastCheck }, routerEnabled }`;
  в шапке редактора горит зелёная/серая точка `GPU: online` / `GPU: offline`,
  статус перезапрашивается каждые 30 с. Ручка требует access-токен (401 без
  него) и входит в field-level паритет-гейт `api-contract.json`
  (`LlmHealthResponse` + `LocalLlmHealth`); `GET /llm/models` остаётся
  публичным — список моделей грузится на старте SPA, до подтверждения сессии
  (решение зафиксировано в KI-626). После восстановления LM Studio healthcheck
  делает внеочередной пинг через 5 с, не дожидаясь 30-секундного тика
  (KI-621).

### 🧠 Состояние и агенты

- **pgvector:** векторные коллекции, upsert и semantic search.
- **Memory-узлы:** чтение и запись долговременной памяти сценария.
- **Agent node:** LLM-цикл с 7 инструментами (HTTP, vector, memory и др.),
  SSRF-защитой, hard-cap и span `agent.step` в OTel.
- **MCP-инструменты (v0.11 S6–S8):** подключение внешних MCP-серверов по
  Streamable HTTP/SSE через `MCP_SERVERS`; каталог инструментов с TTL-кэшем,
  JSON Schema → Zod, preflight до LLM и retry-guard для side-effect
  инструментов. Ручка `GET /mcp/servers` (JWT) отдаёт серверы, статусы и
  инструменты без URL/заголовков/токенов, а в узле «Агент» — секция выбора с
  бейджами `RO`/`DESTR`/`IDEM`, предупреждением destructive и лимитом
  `maxToolsPerNode`. `MCP_ENABLED=false` по умолчанию — фича не влияет на старт.

### 🔎 Контент и файлы

- **Web Search (`web_search`):** три провайдера — Tavily (дефолт), Bing Web
  Search API v7 и Brave Search API (`WEB_SEARCH_PROVIDER`, v0.15 S3). Узел
  отдаёт топ-N источников `{ title, url, snippet }` и готовый текст для
  следующего LLM-узла; поддерживает `maxResults`, глубину поиска Tavily и
  свежесть результатов (Tavily/Bing/Brave). Провайдер можно переопределить на
  конкретном узле, а список доступных (по заданным ключам) UI получает из
  `GET /web-search/providers` (JWT) — сами ключи наружу не отдаются.
- **Document Generation (`document_gen`):** Markdown или JSON → DOCX
  (заголовки, списки, код, таблицы, инлайн-разметка) с сохранением в
  local/S3 и кнопкой скачивания.
- **DOCX-шаблоны (v0.11 S2–S5):** загрузка корпоративных форм `.docx` с
  плейсхолдерами `{name}`/`{#items}` через
  `POST /workflow/:id/document-templates`; список, скачивание и удаление —
  `GET`/`GET …/file`/`DELETE …/:templateId`. Права `viewer` (чтение) и
  `editor` (изменение), хранение в PostgreSQL (`sha256`, `bytes`,
  `placeholders`), защита от ZIP-бомб, макросов и XXE. Узел `document_gen`
  в режиме `template` подставляет `variables` (`docxtemplater` + `pizzip`),
  показывает незаполненные плейсхолдеры (`missingVariables`) и пишет warning
  в логи. Загрузка из UI — multipart/`FormData` (KI-479).
- **Safe Filesystem (`read_file`/`write_file`):** чтение и запись TXT/CSV/JSON
  в изолированном `./data/workspace/{workflowId}/` с защитой от path traversal
  и лимитом 5 МБ на файл.
- **Метрики и наблюдаемость (v1.0 S4; v1.1 S4):** `GET /metrics` (без auth,
  только для scrape-сети) отдаёт `http_request_duration_seconds`,
  `run_execution_duration_seconds`, `run_cost_total`,
  `agent_step_duration_seconds{model,status}`,
  `llm_call_duration_seconds{model,status}` и стандартные
  `process_*`/`nodejs_*` (`collectDefaultMetrics`). Готовые конфиги —
  `infra/prometheus/prometheus.yml` и `infra/grafana/dashboard.json`
  (HTTP latency, длительность узлов, ошибки агента).

### 🔐 Совместная работа и безопасность

- **Auth:** JWT + refresh-токены, сессии и защищённые маршруты. Access-токен
  содержит версию (`ver`); `JwtAuthGuard` сверяет её и организацию с `users`
  на каждом запросе, поэтому удаление участника немедленно отзывает его старый
  access-токен (v1.1 S5, KI-601). Write-пути (`POST /workflow`, аудит) берут
  организацию из БД, а не из токена (KI-605).
- **Организации и команда (v1.0 S1/S3/S5; письма — v1.1 S1; управление — v1.1 S2):**
  пользователь состоит в организации (`users.organization_id`), роль —
  `owner`/`admin`/`member`/`viewer`; `GET /auth/me` отдаёт `organizationId` и
  `role`. `GET /admin/members` — участники и ожидающие приглашения,
  `POST /admin/members/invite` (owner/admin) выписывает приглашение по email и
  отправляет письмо со ссылкой на регистрацию через SMTP (`nodemailer`; env
  `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
  `SMTP_SECURE`, `APP_PUBLIC_URL` для абсолютной ссылки). С v1.2 S2 письмо не
  отправляется в HTTP-запросе: оно ставится в очередь BullMQ `email-invitations`
  (3 попытки, exponential backoff), а воркер догоняет отправку. Ответ несёт
  `emailQueued` (`true` — задание поставлено) и `emailSent` (всегда `false`:
  доставка не подтверждена). Если очередь недоступна, приглашение всё равно
  создаётся, а UI различает «отправлено (в очереди)» и «создано, но письмо не
  отправлено» (v1.2 S3, KI-622).
  Регистрация по приглашённому email присоединяет пользователя к организации с
  назначенной ролью. Владелец управляет составом: `PATCH /admin/members/:userId`
  меняет роль (`admin`/`member`/`viewer`), `DELETE /admin/members/:userId`
  исключает участника — это выход из организации (учётная запись и вход
  сохраняются): в одной транзакции его графы переходят владельцу, участие в
  workflow удаляется, участник переезжает в новую личную организацию, а
  refresh-токены отзываются; действия пишутся в аудит как
  `member.role_change`/`member.remove`. Журнал действий организации —
  `GET /admin/audit` (owner/admin, keyset-пагинация; фильтры `action`, `userId`,
  `from`/`to`; организация читается из БД по `sub`, поэтому устаревший `orgId`
  в access-токене не открывает журнал). В верхней панели — кнопка
  «Команда» (👥) с вкладками «Участники» и «Аудит»: у владельца в строке
  участника есть селект роли и кнопка «Удалить», на вкладке «Аудит» — фильтры
  по действию, автору и датам.
- **Share:** публичные read-only ссылки и collaborative-доступ с ролями
  **owner / editor / viewer**.
- **Rate limiting:** 5 запросов/мин на login и share, 300/мин общий лимит;
  корректная работа за reverse proxy (`TRUST_PROXY`). С v0.11 счётчики хранятся
  в Redis (`THROTTLER_STORAGE=redis`), поэтому лимит общий для всех backend-
  инстансов; при недоступном Redis — fallback в память (KI-420).
- **SSRF-защита:** единый `SafeHttpClient` для узла `http` и инструмента
  `http_request` агента — проверка всех DNS-адресов, защита от DNS rebinding,
  ручная перепроверка редиректов, лимит тела; `http_request` всегда блокирует
  приватные адреса (v0.11 S14, KI-434/435/478).
- **Секреты:** ключи провайдеров шифруются AES-256-GCM; Husky блокирует
  коммиты с паттернами реальных ключей.

### 📧 SMTP Retry

- **Очередь писем-приглашений (v1.2 S2, DESIGN V120 § 3.3):** `EmailService`
  кладёт задание `send-invitation` в BullMQ-очередь `email-invitations`
  (`attempts: 3`, exponential backoff 5 с, `removeOnComplete`/`removeOnFail`).
  HTTP-ручка приглашения отвечает сразу (201), письмо отправляет воркер
  `EmailProcessor`; недоступный SMTP ретраится, а не теряет письмо. Payload
  валидируется Zod в воркере, битые данные уходят в `UnrecoverableError`.
  Очередь использует уже существующие `REDIS_URL`, `BULLMQ_PREFIX`,
  `REDIS_QUEUE_DB`; SMTP настраивается прежними `SMTP_*` и `APP_PUBLIC_URL`.
  Ограничения (resend, PII в payload, ретраи без SMTP) — KI-623..625.

### 🗄️ Хранилище и наблюдаемость

- **S3-совместимое хранилище** (AWS S3, MinIO, R2, Yandex Object Storage):
  presigned URL, multipart-загрузка, retry, TTL-очистка.
- **OpenTelemetry:** трейсы OTLP/HTTP, Pino-логи, per-provider semaphore.
- **Docker:** multi-stage `Dockerfile` (NestJS + React), `docker-compose.prod.yml`
  (app + PostgreSQL 17 + pgvector + Redis), миграции в entrypoint и публикация
  образа в GHCR (`latest`, `sha-*`, `vX.Y.Z`).

---

## Стек

| Слой | Технологии |
|---|---|
| **Backend** | NestJS 12, TypeScript 6 (strict, ESM), Zod, Pino |
| **Frontend** | React 19, Vite 8, `@xyflow/react` 12, Zustand 5, Tailwind CSS 4, react-i18next |
| **Данные** | PostgreSQL 17 + **pgvector**, Drizzle ORM |
| **Очереди** | BullMQ 6, Redis 6 (ioredis) |
| **AI / медиа** | Anthropic, OpenAI, RouterAI, GPTunnel, DeepSeek, Yandex AI Studio, LM Studio; CreativeLab, Replicate, FAL, OpenAI Images |
| **Хранилище** | S3-совместимое (AWS SDK v3), локальная файловая система |
| **Инфраструктура** | Docker Compose, QuickJS-WASM sandbox, **OpenTelemetry**, SSE |
| **Качество** | Vitest 4, Testing Library, jsdom, oxlint, Husky + lint-staged |

---

## Быстрый старт

**Требования:** Node.js 22+, pnpm 12+, Docker Desktop.

> Для DOCX (генерация из Markdown/JSON и шаблоны) backend использует
> `docxtemplater` и `pizzip`. Отдельно ставить не нужно — они приходят с
> зависимостями при `pnpm install`; версии фиксируются в `pnpm-lock.yaml`.

```bash
# 1. Клонировать репозиторий
git clone https://github.com/iilmchat/ai-workflow-builder.git
cd ai-workflow-builder

# 2. Поднять PostgreSQL 17 + pgvector и Redis
docker compose up -d

# 3. Установить зависимости и применить миграции
pnpm install
cp .env.example .env
pnpm db:migrate

# 4. Запустить backend
pnpm start:dev
# → http://localhost:3000
```

Frontend — отдельный пакет:

```bash
pnpm --dir web install
pnpm --dir web dev
# → http://127.0.0.1:5173
```

### Production: Docker

```bash
# .env должен содержать секреты; POSTGRES_PASSWORD смените с dev-дефолта
docker compose -f docker-compose.prod.yml up -d --build
# → http://localhost:3000 — SPA и API из одного контейнера
```

Образ собирается multi-stage: backend (`dist/`, `dist/migrate.js`), frontend
(`web/dist/`) и production-зависимости. Entrypoint применяет миграции **до**
старта приложения; SPA отдаёт `ServeStaticModule`. Порты БД/Redis проброшены
только на loopback (`5434`/`6380`). В production-compose включён
`COOKIE_SECURE=true`, поэтому вход рассчитан на HTTPS/reverse proxy.

Vite проксирует `/workflow`, `/engine`, `/llm`, `/media`, `/auth`,
`/templates`, `/nodes` и `/runs` (SSE) на `http://localhost:3000`, поэтому
backend должен быть запущен первым.

Подробное разворачивание, настройка провайдеров и troubleshooting —
в [GETTING_STARTED.md](docs/development/GETTING_STARTED.md).

---

## Документация

**Полный индекс:** [**docs/README.md**](docs/README.md) — навигация по ролям,
таблицам и разделам.

| Документ | Для кого | Что внутри |
|---|---|---|
| [**docs/README.md**](docs/README.md) | все | Навигационный хаб документации |
| [USER_GUIDE.md](docs/user_guide/USER_GUIDE.md) | пользователи | Быстрый старт, интерфейс, 22 узла, Share, бюджет |
| [MANUAL_TESTING_GUIDE.md](docs/qa/MANUAL_TESTING_GUIDE.md) | QA | 137 ручных кейсов и чек-лист приёмки |
| [GETTING_STARTED.md](docs/development/GETTING_STARTED.md) | разработчики | Разворачивание проекта за ~20 минут |
| [ARCHITECTURE.md](docs/development/ARCHITECTURE.md) | разработчики | Архитектура, контракты и Docker-развёртывание |
| [DESIGN v0.11](docs/development/v0.11/DESIGN_V011_FEATURES.md) | разработчики | DOCX-шаблоны, MCP Adapter, Reliability/History |
| [RULES.md](docs/development/RULES.md) | разработчики | Правила кода, docs, workflow и безопасности |
| [PROMPT_CURRENT.md](docs/development/PROMPT_CURRENT.md) | ассистент / dsh | Актуальные системные инструкции и метрики |
| [RELEASES.md](docs/development/RELEASES.md) | релиз-менеджер | Пошаговый чек-лист выпуска версии |
| [CHANGELOG.md](docs/CHANGELOG.md) | все | История версий (Keep a Changelog) |
| [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | все | Реестр известных проблем и ограничений |

---

## Статус проекта

| Показатель | Значение |
|---|---|
| Версия | **v1.3.0** |
| Backend-тесты | **1935** (2 skipped, 128 файлов) |
| Frontend-тесты | **500** (54 файла) |
| Типов узлов | **22** |
| KI-реестр | **KI-634** — последний номер; всего **621** запись |
| CI | GitHub Actions: build, typecheck, migrations, tests (backend + web) |
| Docker | multi-stage образ + `docker-compose.prod.yml`, публикация в GHCR |

---

## Лицензия

**Proprietary.** © 2026 RuChating (iilmchat). Все права защищены.
