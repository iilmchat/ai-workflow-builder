# Правила разработки IIChatTools AI Workflow Builder

**Версия:** 1.1.0
**Дата:** 2026-10-13
**Назначение:** единый свод правил для команды и ассистента.

При работе над проектом **все** изменения должны соответствовать этим правилам.
Нарушение → комментарий в code review + ссылка на конкретный пункт.

**Стек проекта:** NestJS 12 · TypeScript 6 (strict, ESM) · Vitest · Drizzle ORM · PostgreSQL 17 · BullMQ + Redis · Zod · Pino · React 19 + Vite + @xyflow/react (фронтенд, отдельный пакет).

---

## § 1. Базовые правила

| # | Правило |
|---|---------|
| 1.1 | Комментарии и JSDoc — **на русском языке** |
| 1.2 | JSDoc обязателен для всех **export**-членов: `@param`, `@returns`, `@throws` |
| 1.3 | DI — **только через конструктор** (никакого `ModuleRef.get()` вне тестов) |
| 1.4 | Все I/O-методы — с суффиксом **`Async`** (`createWorkflowAsync`, `runAsync`) |
| 1.5 | `public` члены — `camelCase`, `private` поля — `#private` или `private readonly` |
| 1.6 | Контроллеры: единый формат ошибок `{ success, data, message }` (через `HttpExceptionFilter`) |
| 1.7 | Сервисы: `throw new SomeException(...)`, **не гасить стек** |
| 1.8 | `Logger` (NestJS) — технические логи; отдельный `AuditService` — действия пользователя |
| 1.9 | Все пути — через `node:path` + явные проверки; для S3 — SDK с валидацией ключей |
| 1.10 | CLI — только через `execa` / `child_process.spawn` с массивом аргументов (не строковая конкатенация) |
| 1.11 | Версия приложения — через `process.env.npm_package_version` или `package.json` |
| 1.12 | Copyright: `© 2026 RuChating (iilmchat) · IIChatTools AI Workflow Builder vX.Y.Z` |
| 1.13 | Все проблемы → `docs/KNOWN_ISSUES.md` с номером `KI-XXX` |
| 1.14 | Новые UI-строки — в **оба i18n-файла** (`en.json` + `ru.json`). Проверяется тестом |
| 1.15 | Новый узел = **1 файл-обработчик + 1 регистрация** в `NodeRegistry` |
| 1.16 | **`strict: true`** в `tsconfig.json` — не отключать. `any` запрещён, `unknown` — допустим с явным narrowing |
| 1.17 | Все внешние данные (HTTP, env, JSONB из БД) — валидируются через **Zod** на границе |

---

## § 2. Документация (в том же коммите с кодом)

| # | Правило |
|---|---------|
| 2.1 | **`CHANGELOG.md`** (Keep a Changelog) — обновляется вместе с кодом, не задним числом |
| 2.2 | Секция **`[Unreleased]`** — рабочая; при релизе → `[X.Y.Z] — YYYY-MM-DD`, сверху — пустая `[Unreleased]` |
| 2.3 | **`README.md`** — обновляется при изменении API endpoints, требований, установки |
| 2.4 | **`docs/KNOWN_ISSUES.md`** — любая найденная проблема (даже «не баг») → запись с KI-XXX |
| 2.5 | **`docs/development/vX.Y/DESIGN_*.md`** — дизайн-документ для крупных фич (workflow engine, node types) |
| 2.6 | Секреты / credentials — **никогда** в git (только `.env` + `.env.example` + secret manager для prod) |
| 2.7 | После релиза — обновить `package.json` (`version`) и `CHANGELOG.md` |
| 2.8 | Ссылки на KI в commit message — обязательны, если фикс связан с реестром |
| 2.9 | **`docs/development/RELEASES.md`** — единый чек-лист релиза |
| 2.10 | **Markdown-файлы с внутренними code-блоками — выводить в 4 бэктиках снаружи** (````). Иначе при копировании из чата внешняя обёртка «съедает» внутренние fence'ы |
| 2.11 | **Большие MD-файлы (README, CHANGELOG, RULES) — НЕ выводить целиком.** Вместо этого — **точечный diff** («Найти X / Заменить на Y») или отдельная секция |
| 2.12 | **При закрытии KI-XXX — давать точечный diff на `docs/CHANGELOG.md` и `docs/KNOWN_ISSUES.md`**, а не прозу. Формат: `**Найти:**` / `**Заменить на:**` для каждой правки. Проза допустима только для новых записей KI (они целиком новые). Обоснование: ручной перенос прозы → ошибки (`Fixed` вместо `Open`, забытые KI, неверная сводка), а diff копируется без потерь |
| 2.13 | **В текстах `CHANGELOG.md` / `KNOWN_ISSUES.md` / `RULES.md` / `README.md` — не использовать буквальные паттерны API-ключей** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Husky pre-commit hook (`.husky/pre-commit`) блокирует такие коммиты. Употреблять описательно: «префикс ключа Anthropic», «подстрока с реальным ключом» и т.п. |

**Типы записей в CHANGELOG:** `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

---

## § 3. Рабочий процесс (workflow)

| # | Правило |
|---|---------|
| 3.1 | **Маленькие шаги** — крупная фича разбивается на 3-5 подшагов |
| 3.2 | **1 шаг = 1 коммит** — не смешивать несвязанные изменения |
| 3.3 | **`git add -A`** вместо selective add |
| 3.4 | **Перед коммитом** — `git status --short` для проверки untracked / staged |
| 3.5 | **После push** — проверить GitHub Actions |
| 3.6 | **Локально** — `pnpm build` **0 errors, 0 warnings** (обязательно) |
| 3.7 | **Тесты** — все зелёные перед push (`pnpm test`) |
| 3.8 | **Fallback** — при «не работает локально vs CI» — искать untracked / пропущенные файлы |
| 3.9 | **`pnpm install`** — после смены версий пакетов; **не забыть коммит `pnpm-lock.yaml`** |
| 3.10 | **Перед правкой Drizzle-схемы** — `pnpm db:generate` (создать миграцию), затем `pnpm db:migrate` |
| 3.11 | **На новой машине** — `git config user.email / user.name` **до** первого коммита (нейтральные) |
| 3.12 | **Перед push** — `git log --all -p \| Select-String 'password\|secret\|api_key'` (проверка утечек) |
| 3.13 | **Удаление мусора** — после задач удалять временные скрипты (`*-debug.ts`, `fix-*.mjs`) |
| 3.14 | **Перед `pnpm build`** — остановить запущенный `pnpm start:dev` (иначе `EADDRINUSE` / locked files) |
| 3.15 | **Перед `drizzle-kit generate`** — убедиться, что `.env` корректен и БД доступна; генератор не требует живой БД, но `migrate` — требует |
| 3.16 | **Не коммитить `dist/`, `node_modules/`, `.env`, `*.tsbuildinfo`** — покрыто `.gitignore`, но проверять `git status --short` |

---

## § 4. Технические правила TypeScript / NestJS / ESM

| # | Правило | Ошибка / причина |
|---|---------|-------------------|
| 4.1 | **ESM — обязательно `.js` в относительных импортах.** `import { X } from './y.js'` — даже если исходник `y.ts`. | `ERR_MODULE_NOT_FOUND` |
| 4.2 | `import type { ... }` для type-only импортов — снижает runtime-граф, важно при `verbatimModuleSyntax` | — |
| 4.3 | NestJS-декораторы (`@Module`, `@Injectable`) требуют **`emitDecoratorMetadata: true`** + `experimentalDecorators: true` в `tsconfig.json` | «Nest can't resolve dependencies» |
| 4.4 | **`reflect-metadata`** — импорт в `main.ts` **первой строкой** (до всего) | DI не работает |
| 4.5 | **Валидация env через Zod** — `configSchema.parse(process.env)` при старте, fail-fast | — |
| 4.6 | **`process.env.X`** — всегда через `config.get('X')` (NestJS `ConfigService`), не напрямую | Типизация + тестируемость |
| 4.7 | **`HttpExceptionFilter`** — глобальный, чтобы `{ success: false, message }` был единым для всех контроллеров | — |
| 4.8 | **`ValidationPipe`** глобально с `whitelist: true, forbidNonWhitelisted: true` + class-validator или Zod-pipe | — |
| 4.9 | **`@nestjs/bullmq`** — `BullModule.forRootAsync` с `ConfigService`, не хардкод | — |
| 4.10 | **Drizzle-клиент** — Singleton через `@Global()` `DbModule`, инжектить по токену `DRIZZLE` | — |
| 4.11 | **Drizzle JSONB-колонки** — типизировать через `$type<T>()`, T — Zod-совместимый | — |
| 4.12 | **`OnApplicationShutdown`** — закрывать пул (`postgres.end()`, `bullmq.close()`) | Иначе процесс не завершается |
| 4.13 | **Vitest + NestJS DI** — `Test.createTestingModule({ providers: [...] })`, **не** `new Service()`, если сервис зависит от других | — |
| 4.14 | **Mock'и в тестах** — не полагаться на `jest.fn()`; использовать `vi.fn()` + `vi.mock()` | Vitest ≠ Jest API |
| 4.15 | **Не использовать `any`.** Для unknown-данных — `unknown` + Zod-парсинг или type guards | strict mode |
| 4.16 | **`Promise.all` vs `Promise.allSettled`** — для оркестрации узлов workflow использовать `allSettled`, чтобы один fail не ронял весь run | — |
| 4.17 | **Никогда `await` в цикле для независимых операций** — `Promise.all(items.map(...))` | N+1 |
| 4.18 | **Ошибки в async** — всегда `try / catch` вокруг внешних вызовов (LLM, HTTP, БД), не проглатывать | — |
| 4.19 | **`AbortController`** — для длительных операций (LLM-стриминг, image-gen) — с таймаутом | — |
| 4.20 | **Стриминг в UI** — SSE (`text/event-stream`), не WebSocket, для 90% случаев | — |
| 4.21 | **Долгие задачи (image gen, LLM)** — только через BullMQ queue, не в HTTP-запросе | — |
| 4.22 | **Транзакции** — `db.transaction(async (tx) => {...})`; все связанные INSERT/UPDATE — внутри | — |
| 4.23 | **Snake_case в БД** (`user_id`), camelCase в TS — Drizzle mapping через `text('user_id')` | — |
| 4.24 | **UUID** — `uuid().primaryKey().defaultRandom()` (Postgres 13+, `gen_random_uuid()` в ядре) | — |
| 4.25 | **`jsonb` default** — `default([])` / `default({})`, не `default('[]'::jsonb)` (Drizzle сам сериализует) | — |
| 4.26 | **Foreign keys + CASCADE** — обязательны для связанных таблиц (`workflow_runs.workflow_id → workflows.id`) | — |
| 4.27 | **Не забывать `.js` в импортах Node-модулей** (`node:path`, `node:crypto`) — префикс `node:` обязателен | — |
| 4.28 | **`.env` НЕ читается автоматически в NestJS** — либо `import 'dotenv/config'` в `main.ts`, либо `@nestjs/config` + `ConfigModule.forRoot({ isGlobal: true })` | `DATABASE_URL is not set` |
| 4.29 | **`drizzle-kit generate` не требует живой БД**, но `drizzle-kit migrate` — **требует**. Проверять доступность БД перед migrate | Silent exit code 1 |
| 4.30 | **`drizzle-kit` в Windows не печатает stack trace.** При silent fail — запускать миграцию через скрипт с `drizzle-orm/migrator.migrate()` | Silent fail |
| 4.31 | **`.env` с `localhost` может резолвиться в IPv6 `::1`.** Для Docker — использовать `127.0.0.1` явно | `ECONNREFUSED ::1` |

---

## § 5. Безопасность

| # | Правило |
|---|---------|
| 5.1 | Секреты — **только** в `.env` (dev) / secret manager (prod) |
| 5.2 | `.env` в `.gitignore`, `.env.example` — коммитится с placeholder-значениями |
| 5.3 | Пароли в connection string — не логировать; Pino-редактор должен вырезать `password` |
| 5.4 | CLI — только через `execa` с массивом аргументов |
| 5.5 | Все внешние API-ключи — в БД зашифрованными (AES-256-GCM), не в plain-text JSON workflow |
| 5.6 | Периодически — `git log --all -p \| Select-String 'password\|secret\|api_key\|sk-'` |
| 5.7 | При утечке — смена ключа немедленно, потом `git filter-repo` |
| 5.8 | GitHub Secret Scanning + Push Protection — включены |
| 5.9 | **Пользовательские промпты** — не логировать целиком (PII risk); только хэш / длину |
| 5.10 | **Скриншоты / изображения** — хранить в S3 с TTL, не в БД |

---

## § 6. Git-специфичные правила

| # | Правило |
|---|---------|
| 6.1 | `.gitignore` — `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`, `drizzle/meta/` (опционально — но лучше коммитить) |
| 6.2 | `.gitattributes` — `* text=auto eol=lf` (единый LF) |
| 6.3 | LF / CRLF warnings — не критичны |
| 6.4 | Формат commit message: `<type>(<scope>): <subject>` + пустая строка + body |
| 6.5 | Типы: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `security`, `perf` |
| 6.6 | **Force-push** — только `--force-with-lease`, никогда `--force` |
| 6.7 | При merge с origin — **сначала** `git fetch`, потом анализ конфликтов |
| 6.8 | **`.env.example`** — обновлять при добавлении новой env-переменной |
| 6.9 | **Нейтральный git-author** для публичных репо: `dev@workflow-builder.local` |

---

## § 7. Отложенные задачи (актуальный список KI)

См. [`docs/KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) — полный реестр.

**На старте проекта реестр пуст.** Все найденные проблемы добавляются с номерами `KI-001`, `KI-002`, и т.д.

---

## § 8. История изменений правил

| Дата | Версия | Что добавлено |
|------|--------|---------------|
| 2026-10-12 | 1.0.0 | Стартовая версия. 17 базовых правил, 11 правил документации, 16 правил workflow, 31 техническое правило TS/NestJS/ESM/Drizzle, 10 правил безопасности, 9 git-правил. Учтён опыт IIChatTools (RULES v1.4.35) + специфика нового стека. |
| 2026-10-13 | 1.1.0 | § 2.12 — при закрытии KI давать точечный diff на docs. § 2.13 — не использовать буквальные паттерны API-ключей в MD-текстах (husky hook их блокирует) |

---

## § 9. Как использовать

**При работе над задачей:**

1. Открыть этот файл, вспомнить применимые правила.
2. Мелкими шагами, коммитить каждый шаг.
3. **В том же коммите** — обновить `CHANGELOG.md` (и `README.md` / `KNOWN_ISSUES.md` при необходимости).
4. Проверить `pnpm build` + `pnpm test` локально.
5. Push → проверить CI → merge.

**При code review:**

1. Проверить по пунктам раздела 1-2 (базовое + документация).
2. Технические замечания — по разделу 4.
3. Ссылаться на конкретный пункт: «нарушение 1.4 (нет `Async`-суффикса)».

**При онбординге нового разработчика:**

1. Прочитать этот файл **целиком**.
2. Прочитать `docs/KNOWN_ISSUES.md` (последние 5 записей).
3. Прочитать `CHANGELOG.md` (последний релиз).
4. Клонировать репо, настроить `.env`, `pnpm install`, `pnpm db:migrate`, `pnpm test`.