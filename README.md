# IIChatTools AI Workflow Builder

[![CI](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.10.0-blue.svg)](docs/CHANGELOG.md)
[![Backend tests](https://img.shields.io/badge/backend_tests-1123-brightgreen.svg)](docs/development/RELEASES.md)
[![Frontend tests](https://img.shields.io/badge/frontend_tests-375-brightgreen.svg)](docs/development/RELEASES.md)
[![License](https://img.shields.io/badge/license-proprietary-lightgrey.svg)](#лицензия)

> **Визуальный конструктор AI-сценариев.** Собирайте LLM-, медиа- и агентные
> workflow на холсте, запускайте их в фоне и наблюдайте за результатом в
> реальном времени.

**Версия:** `v0.10.0` · **Стек:** NestJS 12 · React 19 · PostgreSQL 17 + pgvector ·
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
  вложенные сценарии (sub-workflows).
- **Производительность:** route-level code-split для всех 22 узлов — основной
  чанк уменьшен с **774 kB до 141 kB**.

### ⚙️ Выполнение

- **BullMQ + Redis:** фоновые запуски, ретраи job'а и отдельных узлов,
  изоляция очередей между инстансами (`BULLMQ_PREFIX`).
- **История в PostgreSQL:** `workflow_runs`, `node_runs`, версии workflow,
  аудит действий.
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

### 🧠 Состояние и агенты

- **pgvector:** векторные коллекции, upsert и semantic search.
- **Memory-узлы:** чтение и запись долговременной памяти сценария.
- **Agent node:** LLM-цикл с 7 инструментами (HTTP, vector, memory и др.),
  SSRF-защитой, hard-cap и span `agent.step` в OTel.

### 🔎 Контент и файлы

- **Web Search (`web_search`):** поиск через Tavily, топ-N источников
  `{ title, url, snippet }` и готовый текст для следующего LLM-узла.
- **Document Generation (`document_gen`):** Markdown или JSON → DOCX
  (заголовки, списки, код, таблицы, инлайн-разметка) с сохранением в
  local/S3 и кнопкой скачивания.
- **Safe Filesystem (`read_file`/`write_file`):** чтение и запись TXT/CSV/JSON
  в изолированном `./data/workspace/{workflowId}/` с защитой от path traversal
  и лимитом 5 МБ на файл.

### 🔐 Совместная работа и безопасность

- **Auth:** JWT + refresh-токены, сессии и защищённые маршруты.
- **Share:** публичные read-only ссылки и collaborative-доступ с ролями
  **owner / editor / viewer**.
- **Rate limiting:** 5 запросов/мин на login и share, 300/мин общий лимит;
  корректная работа за reverse proxy (`TRUST_PROXY`).
- **Секреты:** ключи провайдеров шифруются AES-256-GCM; Husky блокирует
  коммиты с паттернами реальных ключей.

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
| [MANUAL_TESTING_GUIDE.md](docs/qa/MANUAL_TESTING_GUIDE.md) | QA | 129 ручных кейсов и чек-лист приёмки |
| [GETTING_STARTED.md](docs/development/GETTING_STARTED.md) | разработчики | Разворачивание проекта за ~20 минут |
| [ARCHITECTURE.md](docs/development/ARCHITECTURE.md) | разработчики | Архитектура, контракты и Docker-развёртывание |
| [RULES.md](docs/development/RULES.md) | разработчики | Правила кода, docs, workflow и безопасности |
| [PROMPT_CURRENT.md](docs/development/PROMPT_CURRENT.md) | ассистент / dsh | Актуальные системные инструкции и метрики |
| [RELEASES.md](docs/development/RELEASES.md) | релиз-менеджер | Пошаговый чек-лист выпуска версии |
| [CHANGELOG.md](docs/CHANGELOG.md) | все | История версий (Keep a Changelog) |
| [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | все | Реестр известных проблем и ограничений |

---

## Статус проекта

| Показатель | Значение |
|---|---|
| Версия | **v0.10.0** |
| Backend-тесты | **1123** (17 skipped) |
| Frontend-тесты | **375** |
| Типов узлов | **22** |
| KI-реестр | **KI-472** — последний номер; всего **460** записей |
| CI | GitHub Actions: build, typecheck, migrations, tests (backend + web) |
| Docker | multi-stage образ + `docker-compose.prod.yml`, публикация в GHCR |

---

## Лицензия

**Proprietary.** © 2026 RuChating (iilmchat). Все права защищены.
