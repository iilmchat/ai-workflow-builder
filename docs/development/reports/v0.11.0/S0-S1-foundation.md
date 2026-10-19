---
title: "S0+S1: Foundation + миграции"
date: 2026-10-19
version: v0.11.0
steps: [S0, S1]
status: accepted
---

# Отчёт S0+S1 — Foundation + миграции

Не коммитил, `git add -A` не использовал: все изменения — на диске (`git status` = 12 M + 5 ??).

## 1. Файлы

| Файл | +/- |
|---|---|
| `src/config/env.schema.ts` | +277 / −7 |
| `src/config/env.schema.spec.ts` | +271 / −0 |
| `src/db/schema.ts` | +81 / −0 |
| `src/db/schema-parity.spec.ts` | +6 / −0 |
| `src/runs/runs.service.spec.ts` | +2 / −0 |
| `src/runs/runs-stream.service.spec.ts` | +2 / −0 |
| `.env.example` | +54 / −0 |
| `web/src/types/graph.ts` | +50 / −0 |
| `web/src/stores/workflow.ts` | +66 / −0 |
| `web/src/i18n/ru.json` | +17 / −0 |
| `web/src/i18n/en.json` | +17 / −0 |
| `drizzle/meta/_journal.json` | +14 / −0 |
| `drizzle/0012_document_templates.sql` *(new)* | 17 строк |
| `drizzle/0013_run_lease.sql` *(new)* | 1 строка |
| `drizzle/meta/0012_snapshot.json` *(new)* | 878 строк |
| `drizzle/meta/0013_snapshot.json` *(new)* | 884 строки |
| `docs/development/v0.11/api-contract-drafts.json` *(new)* | 30 строк |

Изменения по сути:
- **S0.1**: 22 ключа v0.11 в `EnvSchema` пятью группами (`DocumentTemplateEnvSchema`, `McpEnvSchema`, `RunLeaseEnvSchema`, `NodeRetryEnvSchema`, `ThrottlerEnvSchema`) + `HTTP_NODE_ALLOW_PRIVATE_NETWORKS` в существующую `NetworkSafetyEnvSchema`; все группы влиты через `.shape`; кросс-проверка `LEASE_TTL >= 2 × HEARTBEAT` — в существующий `superRefine` (рядом с KI-213/220/221). `.env.example` — 6 секций строго по заданию, `ALLOW_PRIVATE_IPS`/`MEDIA_URL_SIGNING_SECRET` не тронуты.
- **S0.2**: `DocumentGenNodeData += mode/templateId/variables`, `AgentNodeData += mcpTools` (аддитивно), `McpToolRef` + `MCP_MAX_TOOLS_PER_NODE_LIMIT`; в `nodeDataFromApi` добавлена валидация jsonb и сохранение полей в Save/Load (KI-129: отсутствующие поля не создаются).
- **S0.3**: `node.document_gen.mode.*`, `node.agent.mcp.*`, плоский `template.*` — в оба файла, паритет зелёный.
- **S0.4**: черновик контракта, первое поле — предписанный `_comment`; основной `api-contract.json`/`sse-contract.json` не тронуты.
- **S0.5**: +16 тестов в `env.schema.spec.ts` (дефолты, обе границы каждого int-ключа, строгие boolean, superRefine lease).
- **S1**: `document_templates` (uuid-ссылки, `bytea` customType, 2 CHECK, индекс) + `workflow_runs.lease_expires_at`; две отдельные миграции; parity-маппинг `PgCustomColumn → 'bytea'`.

## 2. Build / test

`build 0/0, backend 1211/1211 (было 1195, +16 новых), web 375/375, typecheck 0`.

- `pnpm build` → exit 0, ни одного warning.
- `pnpm typecheck` → 0 ошибок.
- `pnpm test` → 86 файлов passed / 3 skipped, **1211 passed, 18 skipped** (skips — DB-спеки без `DATABASE_URL`).
- CI-подобный прогон `node --env-file=.env vitest run` → **89/89 файлов, 1227 passed, 2 skipped** (все DB-интеграционные прошли).
- `pnpm test:parity` → **10/10**.
- `pnpm --dir web test` → **375/375**; `pnpm --dir web build` → зелёный.
- `pnpm lint` → 0 warnings, 0 errors.
- `pnpm db:generate` (повторно) → «No schema changes»; `pnpm db:migrate` → «✅ Миграции применены».

## 3. Диагностика

- Перед правками `drizzle-kit generate` дал baseline «No schema changes» — дрейфа snapshot не было.
- Миграции генерировал **двумя проходами** (`--name document_templates`, затем `--name run_lease`), чтобы получить ровно 0012 и 0013, как в задании; SQL руками не редактировал.
- Drizzle отрендерил custom-тип в кавычках: `"content" "bytea" NOT NULL`. Для `bytea` это валидно (имя типа в `pg_catalog` — `bytea`, quoted-lowercase резолвится), `db:migrate` применился, `\d+ document_templates` подтвердил `bytea`, оба CHECK и оба FK. Поэтому SQL не правил.
- CHECK-ограничения пришлось объявить в `schema.ts` через `check(...)` (в TS-сниппете DESIGN их не было, но в DESIGN SQL они обязательны): так drizzle сгенерировал `document_templates_bytes_check` и `document_templates_content_size_check` штатно.
- Parity: у custom-колонок Drizzle `columnType === 'PgCustomColumn'` (проверил по исходникам drizzle-orm), поэтому карта дополнена `PgCustomColumn: 'bytea'`; `numeric_precision/scale` не участвуют (колонка не `PgNumeric`).
- После добавления nullable-колонки в `WorkflowRun` (`$inferSelect` делает `leaseExpiresAt: Date | null` обязательным ключом) `pnpm typecheck` упал в двух существующих фикстурах — добавил `leaseExpiresAt: null` в `runs.service.spec.ts` и `runs-stream.service.spec.ts` (только типизация, поведение тестов не менялось).
- Prettier-check репозитория: HEAD-файлы не fully prettier-clean, поэтому `prettier --write` по изменённым файлам давал большой несвязанный churn. Откатил его и оставил минимальный diff (новый код — в стиле окружающего); форматтер в CI не участвует.

## 4. Smoke

- `node dist/main` → «Nest application successfully started»; env-валидация с реальным `.env` прошла, все маршруты (включая `/templates`, `/runs`, `/mcp` пока нет — по плану S6) смаппились.
- Зарегистрировал smoke-пользователя, `GET /templates` с JWT → **200, 3 шаблона** (`http-llm`, `text-llm`, `text-llm-image`) — старый endpoint не сломан. `GET /auth/me` → 200.
- `GET /` → 200.
- Round-trip новых полей через API (эмуляция Save → F5 → Load): `POST /workflow` с `document_gen.mode='template'`, `templateId`, `variables` и `agent.mcpTools`, затем `GET /workflow/:id` → поля сохранены без потерь:
  `document_gen: {"mode":"template","templateId":"1111…","variables":{"amount":42,"client":"ACME"}}`, `agent: {"mcpTools":[{"tool":"read_file","server":"filesystem"}]}`.
- F5 в живом браузере и `<MiniMap />` визуально не проверял (браузерной автоматизации в сессии нет): UI-код в этом пакете не менялся, `minimap.spec.ts` (5 тестов) и `graph-*` спеки зелёные, web build зелёный.
- Smoke-строки из локальной БД удалил; сервер остановлен, порт 3000 свободен.

## 5. Что не так / отступления от ТЗ

1. **CHECK в Drizzle-схеме** добавлены сверх TS-сниппета DESIGN (но ровно по DESIGN SQL § 3.1.1) — иначе миграция не содержала бы обязательных ограничений, а ручная правка SQL запрещена.
2. **Индекс** сгенерирован `btree (workflow_id, created_at)` (ASC), в DESIGN SQL — `created_at DESC`. Следовал явному Drizzle-сниппету из задания (там `.desc()` нет); btree сканируется в обе стороны, функционально эквивалентно.
3. **`heartbeat < staleThreshold`** из DESIGN § 3.3.1 не реализован: в S0.1 задан только `TTL >= 2×heartbeat`. Дополнительно это условие конфликтует с заявленным диапазоном: при дефолтном `WORKFLOW_RUNS_STALE_THRESHOLD_MS=300000` и `WORKFLOW_RUN_HEARTBEAT_MS=300000` (верхняя граница) `heartbeat < stale` невыполнимо. Нужно решение в S3 (см. KI-кандидат).
4. **`WORKFLOW_RUN_LEASE_TTL_MS` без верхней границы** — DESIGN задаёт только нижнюю (через superRefine); целое, дефолт 90000.
5. **`createNode` для `document_gen`/`agent` не расширял**: новые узлы пока создаются без `mode`/`mcpTools` (backend подставляет `inline`/`[]`). UI-селекты появятся в S5/S8 — в S0 не хотел трогать UI-логику.
6. **Тестов на `nodeDataFromApi` для `document_gen`/`agent` не добавлял** — их не было; по заданию отдельная KI-251. Существующий round-trip тест `workflow-nodes.spec.ts` покрывает только http/condition/output/compare/sub_workflow/collaborators.
7. **Boolean-флаги** сделаны строго по RULES 4.35; при этом пустая строка трактуется как «не задано» (KI-084) — `z.preprocess(emptyToUndefined, z.enum(['true','false']).default('false').transform(...))`. Передача `boolean` из JS-конфига (как у legacy-флагов `SANDBOX_ENABLED`) отвергается — только строки; S6/S14 должны использовать строки.
8. **`MCP_MAX_TOOLS_PER_NODE_LIMIT = 20`** продублирован на фронте (backend-константы в `mcp.types.ts` ещё нет, она появится в S6). Дублирование отражено в KI-кандидате.
9. **Имена миграций**: использовал `--name`, получились `0012_document_templates.sql`/`0013_run_lease.sql` вместо случайных `<hash>`; содержимое — штатный drizzle-output.
10. **Черновик контракта** дополнительно содержит `McpServerSummary`/`McpToolSummary` (вложенные схемы `McpServersResponse`) и секцию `refs` для `RunNodeSnapshotAddition` → `sse-contract.json#/snapshot/node`: плоский формат `responses` не выражает вложенность/ссылку. Паритет-спеки для черновика нет, как и требовалось.
11. `.env.example`: новые секции добавлены в конец файла (в порядке § 4.3), старые блоки, включая `ALLOW_PRIVATE_IPS`, не тронуты; `MEDIA_URL_SIGNING_SECRET` не тронут.
12. Backend +16 тестов вместо ожидаемых +8..15: табличные проверки «дефолт + обе границы» дали 16 (ровно по числу новых ключей), искусственно сокращать не стал.

## 6. Новые KI (номера в реестр внесёт пользователь)

1. **KI-кандидат**: `WORKFLOW_RUN_LEASE_TTL_MS` не имеет верхней границы — значение порядка `10^12` фактически отключает обнаружение падения worker'а. Предложение: max + связка со `WORKFLOW_RUNS_STALE_THRESHOLD_MS` в S3.
2. **KI-кандидат**: `schema-parity` маппит **все** `PgCustomColumn` в `bytea`. Второй custom-тип с другим SQL-типом пройдёт гейт молча. Предложение: для custom-колонок брать `column.getSQLType()` (или маппинг по `dataType()`), а не одну глобальную запись.
3. **KI-кандидат**: drizzle-kit кавычит custom SQL-тип (`"bytea"`). Для `bytea` ок, но для алиасов (`"integer"` и т.п.) такой DDL упадёт; при следующем custom-типе проверить генерацию.
4. **KI-кандидат**: DESIGN § 3.3.1 требует `heartbeat < staleThreshold`, но с дефолтным stale=300000 это делает недостижимой верхнюю границу heartbeat=300000. Нужно либо поднять stale, либо убрать условие, либо уменьшить max heartbeat.
5. **KI-кандидат**: дублирование константы `MCP_MAX_TOOLS_PER_NODE_LIMIT` (frontend/backend) до появления shared-типов в S6.
6. Наблюдение без KI: в `workflow-nodes.spec.ts` нет Load-тестов для `agent`/`document_gen` (покрытие — KI-251, не дублировал).

## 7. Обоснование решений

- **Группы env-схем** (`...EnvSchema.shape`) вместо плоского списка — существующий стиль файла: каждая группа тестируется изолированно, `EnvSchema` остаётся единственным источником дефолтов, а cross-cutting проверка живёт в общем `superRefine`, где видны оба значения.
- **Строгий boolean через `z.enum` + preprocess пустой строки** — RULES 4.35 (не `z.coerce.boolean()`), при этом не ломаем KI-084 для пустых переменных `.env`.
- **`superRefine` для lease именно в `EnvSchema`** — heartbeat и TTL объявлены в разных группах; проверка в группе не увидела бы второе значение.
- **Аддитивные опциональные поля типов + валидация на границе jsonb** — старые графы компилируются и сохраняются без новых полей; значения без типа из jsonb не должны доходить до backend-схемы (RULES 1.17), а валидные — переживать Save/Load (KI-122/129).
- **`bytea` через `customType`** — в pg-core нет встроенного типа; CHECK-и объявлены в схеме, чтобы миграция была декларативной и snapshot соответствовал БД (ручной SQL запрещён).
- **Две отдельные миграции** — по заданию (0012 таблица, 0013 колонка), проще откатывать по отдельности; обе аддитивны, backfill не нужен (DESIGN § 4.2).
- **Не трогал `api-contract.json`/`sse-contract.json`/`NODE_REGISTRY`/`package.json`** — паритет v0.10 и 22 типа узлов остаются нетронутыми; всё новое — в черновике и аддитивных полях.

---

**Коммит (сделает пользователь):**

```
feat(v0.11.0): S0+S1 — env-ключи, типы узлов, миграции 0012/0013
...
Refs: DESIGN v0.11 § 3.1.1, § 3.1.2, § 3.2.7, § 3.3.1, § 4.3, § 5 (S0,S1)
```
