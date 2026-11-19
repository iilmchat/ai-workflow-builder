---
title: "KI-спринт 22: гигиена env, типов и утилит"
date: 2026-11-19
version: v1.6.0
steps: [S22]
status: done
related_ki: [KI-013, KI-020, KI-021, KI-028]
---

# KI-спринт 22 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/db/db.module.ts` | +4 / −2 — `ConfigService` вместо `process.env` |
| `src/main.ts` | +2 / −1 — PORT через `configService` |
| `web/src/lib/api.ts` | +1 / −5 — удалён `executionMap` из `ExecutionPlan` |
| `src/common/utils/to-message.ts` | +13 (новый) — общий `toMessage` |
| `src/engine/execution-engine.service.ts`, `src/runs/runs.processor.ts` | −8 локальных копий, импорт утилиты |
| `docs/KNOWN_ISSUES.md` | 4 статуса, сводка пересчитана (657 = 657) |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm build` — 0/0; `pnpm --dir web build` — 0/0; `pnpm test` — 2144 passed,
26 skipped; гейт реестра OK.

## 3. Диагностика

- **KI-013:** два прямых чтения `process.env` оставались после введения
  `ConfigModule` — нарушение RULES 4.6.
- **KI-020:** `executionMap` в типе `ExecutionPlan` не читался ни одним
  потребителем (используется только `levels`).
- **KI-021:** `started_at`/`finished_at` покрывают жизненный цикл строки
  `node_runs`; отдельный `created_at` дублировал бы `started_at`.
- **KI-028:** два из четырёх файлов из формулировки уже не имели `toMessage`;
  в двух оставшихся функция дублировалась.

## 4. Smoke

Build backend/web зелёные, все тесты проходят после замены импортов. Общая
утилита сохраняет поведение: `Error.message` либо `String(error)`.

## 5. Что не так

- В других сервисах (`agent`, `mcp`, `llm`) остаются свои `toMessage` — KI-028
  покрывал четыре файла run/engine; остальные — отдельные дубли при случае.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Правки чисто гигиенические и не меняют поведение: env через DI, мёртвый тип
удалён, утилита переиспользована. KI-021 отложен, потому что миграция ради
дублирующего поля не даёт выигрыша.
