# IIChatTools AI Workflow Builder

[![CI](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/iilmchat/ai-workflow-builder/actions/workflows/ci.yml)

**Visual node-based editor for LLM workflows.**

Backend (NestJS 12 + ESM + Drizzle ORM + PostgreSQL 17).
Frontend (React 19 + @xyflow/react) — в разработке.

© 2026 RuChating (iilmchat)

---

## Stack

- **Backend**: NestJS 12, TypeScript 6 (strict, ESM), Vitest
- **Database**: PostgreSQL 17 + Drizzle ORM
- **Queue**: BullMQ + Redis (planned)
- **LLM**: Anthropic / OpenAI / local (planned)
- **Frontend**: React 19 + Vite + @xyflow/react (planned)

## Local Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker Desktop (for PostgreSQL)

### Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL
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
## Scripts

| Command | Description |
|---|---|
| `pnpm start:dev` | Dev server with watch |
| `pnpm build` | Production build |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm db:generate` | Generate Drizzle migration from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio (web UI) |
## Documentation

- [`docs/development/RULES.md`](docs/development/RULES.md) — rules for TS/NestJS/ESM/Drizzle
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — version history
- [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) — known issues registry
- [`docs/development/PROMPT_V1.md`](docs/development/PROMPT_V1.md) — starting prompt for new sessions

## License

Proprietary. © 2026 RuChating (iilmchat).
