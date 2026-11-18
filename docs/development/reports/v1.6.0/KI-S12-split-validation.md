---
title: "KI-спринт 12: валидация share-графа и контракт sort"
date: 2026-11-19
version: v1.6.0
steps: [S12]
status: done
related_ki: [KI-241, KI-244, KI-269, KI-275]
---

# KI-спринт 12 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/engine/engine.service.ts` | +12 / −2 — фильтр аннотаций в `topologicalSortAsync` |
| `src/engine/engine.service.spec.ts` | +8 — тест KI-269 |
| `web/src/lib/share-api.ts` | +3 / −2 — `ApiNodeSchema`/`ApiEdgeSchema` в `SharedWorkflowSchema` |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm exec vitest run src/engine/engine.service.spec.ts` — **48 passed**;
`pnpm --dir web build` — 0/0; `pnpm --dir web test` — 598 passed.
Полные backend build/test перед коммитом.

## 3. Диагностика

- **KI-269:** `topologicalSortAsync` индексировал все узлы, включая `comment`,
  тогда как `buildExecutionPlanAsync` их отфильтровывал (KI-266).
- **KI-241:** `SharedWorkflowSchema` использовал `z.array(z.unknown())`, поэтому
  некорректная форма узлов проходила и ломала страницу.
- **KI-244:** каталог Anthropic фиксирован в провайдере; env-список изменит
  публичный контракт и потребует web-зеркала.
- **KI-275:** сбои CDP-ввода вызваны скрытостью страницы на стенде.

## 4. Smoke

Юнит-тест: граф `[text A, comment NOTE]` → `topologicalSortAsync` возвращает
`['A']`. Web: сборка и 598 тестов зелёные (Zod-схема share не сломала
существующие контракты).

## 5. Что не так

- В `ShareViewPage` осталось приведение `as unknown as AppNode[]`, но данные
  теперь валидированы Zod; полное удаление cast требует discriminated union
  между API и `AppNode` (связано с KI-131).
- KI-244/KI-275 отложены по причинам из раздела 3.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Фильтр аннотаций вынесен в тот же подход, что и у `/engine/plan`, — без
изменения DTO и HTTP-контракта. Валидация share-графа стоит на границе API,
где уже есть Zod, и переиспользует существующие схемы, не создавая новые.
