---
title: "KI-спринт 05: retry сетевых ошибок и история запусков"
date: 2026-11-19
version: v1.6.0
steps: [S05]
status: done
related_ki: [KI-061, KI-062, KI-063, KI-064]
---

# KI-спринт 05 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/llm/provider-errors.ts` | +7 — классы `APIConnectionError`/`ConnectionError`/`NetworkError` в retryable |
| `src/llm/provider-errors.spec.ts` | +38 (новый) — 3 теста классификации |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm exec vitest run src/llm/provider-errors.spec.ts` — **3 passed**; полные
`pnpm build` / `pnpm test` перед коммитом.

## 3. Диагностика

- **KI-061:** `GET /workflow/:id/runs` существует с v0.14 (RunHistory API),
  покрывает историю и фильтрацию по workflowId; глобальный `GET /runs`
  несовместим с org-изоляцией.
- **KI-062:** подтверждён — `isRetryableProviderError` проверял только системный
  `code` и имена abort-ошибок; `APIConnectionError` без `code` не повторялся.
- **KI-063:** в snapshot DTO нет поля final; UI закрывает SSE по терминальному
  статусу (`isFinalStatus`), но «attempts исчерпаны» не различается.
- **KI-064:** инвариант задокументирован в JSDoc; прод-вызывающий один.

## 4. Smoke

Три юнит-теста: сетевые классы SDK → retryable, abort по сигналу → retryable,
детерминированные ошибки → не retryable.

## 5. Что не так

- KI-063 остаётся Deferred — это известное ограничение диагностики SSE, а не
  потеря функциональности.
- KI-064 Won't Fix: второй вызов есть только в integration-спеке, где SSE
  не используется; при «Run in-process» решение нужно пересмотреть.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Классификация по имени класса — минимальная правка на границе провайдера,
не меняющая контракт движка и не требующая миграции. Deferred/Won't Fix
применены там, где текущие механизмы уже покрывают сценарий, либо правка
дублировала бы событие `run_completed`.
