---
title: "KI-спринт 17: метаданные media-результата и тарифы"
date: 2026-11-19
version: v1.6.0
steps: [S17]
status: done
related_ki: [KI-386, KI-392, KI-393, KI-402]
---

# KI-спринт 17 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/media/dto/media-task.dto.ts` | +2 / −1 — `.passthrough()` для элемента `result` |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm build` — 0/0; `pnpm exec vitest run src/media` — **292 passed**, 3 skipped.
Web не менялся.

## 3. Диагностика

- **KI-386:** Zod-схема result отбрасывала поля ответа grom-zvuk; passthrough
  сохраняет их без изменения контракта остальных полей.
- **KI-392/393:** тарифы `duration` и `pricing.plus`/`expr.units` требуют
  подтверждения upstream — ошибка приведёт к неверному бюджету.
- **KI-402:** `resolveEmbeddingModel` знает только RouterAI; другие провайдеры
  могут не предоставлять embeddings.

## 4. Smoke

Build 0/0, media-спеки зелёные. Схема с passthrough принимает старые ответы
`{ url }` без изменений.

## 5. Что не так

- Явные поля `durationSec`/`coverUrl` в web-зеркале не добавлены — данные
  доступны мапперу, но UI пока не отображает обложку/длительность.
- KI-392/393/402 отложены с триггерами возврата.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Passthrough — минимальная правка на границе API: данные перестают теряться,
контракт не ломается, а явные поля можно добавить позже без миграций.
Спекулятивные тарифы не изменяются без подтверждения провайдера.
