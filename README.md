# IIChatTools AI Workflow Builder

[![CI](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml)

**Visual node-based editor for LLM workflows.**

Backend (NestJS 12 + ESM + Drizzle ORM + PostgreSQL 17).
Frontend (React 19 + @xyflow/react + Vite + Tailwind v4).

© 2026 RuChating (iilmchat)

---

## Features

- **Визуальный редактор графа** — React Flow: узлы Text / LLM / Image Generation,
  типизированные порты и связи.
- **Реальное выполнение в фоне** — BullMQ + Redis, история в PostgreSQL
  (`workflow_runs`, `node_runs`) с ретраями job'а и узлов.
- **LLM-workflow: 6 провайдеров** (Anthropic, OpenAI, RouterAI, GPTunnel,
  DeepSeek, Yandex, LM Studio) — список моделей отдаётся через
  `GET /llm/models` (только сконфигурированные провайдеры).
- **Генерация изображений** через GPTunnel CreativeLab
  (Flux, DALL·E, Gemini Image, Nano Banana, Midjourney) — узел Image
  Generation с селектом media-модели, `aspect_ratio` и превью результата
  прямо в узле; стоимость в рублях (`cost_rub`).
- **SSE-стриминг прогресса** — `GET /runs/:id/stream`: snapshot состояния и
  события узлов в реальном времени.
- **Подсветка нод по статусу** — серый → синий → зелёный/красный прямо на
  холсте, с номером текущей попытки.
- **Панель результата** — по клику на ноду: outputs (JSON), метрики
  (длительность, токены, стоимость), ошибка и логи ретраев.

## Stack

- **Backend**: NestJS 12, TypeScript 6 (strict, ESM), Vitest
- **Database**: PostgreSQL 17 + Drizzle ORM
- **Queue**: BullMQ + Redis
- **LLM**: 6 провайдеров (chat) — Anthropic (Claude), OpenAI (GPT), RouterAI,
  GPTunnel, DeepSeek, Yandex AI Studio, LM Studio
- **Media**: GPTunnel CreativeLab — IMAGE / VIDEO / AUDIO / MUSIC / 3D
  (в v0.6.0 — генерация изображений)
- **Frontend**: React 19 + Vite + @xyflow/react v12 + Zustand + Tailwind v4

## Getting Started

**First time here?** Смотрите [docs/development/GETTING_STARTED.md](docs/development/GETTING_STARTED.md) — пошаговое разворачивание за ~20 минут.

## Local Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker Desktop (for PostgreSQL + Redis)

### Backend

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL and Redis
docker compose up -d

# 3. Copy env template
cp .env.example .env
# (dev password: devpass123)

# 4. Apply migrations
pnpm db:migrate

# 5. Start dev server
pnpm start:dev
# → http://localhost:3000
```

### Frontend

```bash
cd web
pnpm install
pnpm dev
# → http://localhost:5173
```

Vite проксирует `/workflow`, `/engine`, `/llm` и `/runs` (SSE) на
`http://localhost:3000`, поэтому перед запуском фронтенда поднимите backend.

## Scripts

| Command | Description |
|---|---|
| `pnpm start:dev` | Dev server with watch |
| `pnpm build` | Production build |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm lint` | Lint (oxlint, type-aware) |
| `pnpm db:generate` | Generate Drizzle migration from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio (web UI) |
| `cd web && pnpm dev` | Frontend dev server (Vite, port 5173) |

## Documentation

- [`docs/development/RULES.md`](docs/development/RULES.md) — rules for TS/NestJS/ESM/Drizzle (v1.1.0)
- [`docs/development/GETTING_STARTED.md`](docs/development/GETTING_STARTED.md) — пошаговое разворачивание
- [`docs/development/PROMPT_V2.md`](docs/development/PROMPT_V2.md) — starting prompt for new sessions
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — version history
- [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) — known issues registry

## License

Proprietary. © 2026 RuChating (iilmchat).
