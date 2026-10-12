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