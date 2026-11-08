# DESIGN v1.4 — Run Control (Cancel) & History Comparison

**Файл:** `docs/development/v1.4/DESIGN_V140_FEATURES.md`
**Версия:** 1.0 (2026-11-08)
**Статус:** Draft
**Закрывает:** Новые фичи (Cancel, Compare)
**Связанные:** KI-628, KI-632

## 1. Контекст

После v1.3.0 у нас есть всё для Enterprise: мультитенантность, аудит, метрики, GPU-роутер. Но два важных UX-пробела:
1. **Нет отмены запуска.** Долгий граф (LLM + media) нельзя прервать — пользователь ждёт до конца.
2. **Нет сравнения запусков.** История показывает список, но нельзя увидеть, чем отличается успешный запуск от упавшего.

## 2. Что делаем

1. **Cancel Run:** `POST /runs/:id/cancel`. Движок проверяет флаг отмены перед каждым уровнем. UI: кнопка «Отменить» в TopBar.
2. **History Comparison:** `GET /runs/:id1/compare/:id2`. UI: модалка с side-by-side diff (outputs, длительность, стоимость).
3. **UX Polish:** KI-628 (TopBar overflow), KI-632 (recovery detection), KI-623 (PII in Redis).

## 3. Технические срезы

### 3.1 Срез 1 — Cancel Run
- **Миграция:** `workflow_runs.cancelled_at timestamptz` (nullable).
- **API:** `POST /runs/:id/cancel` → 200 `{ status: 'cancelled' }` или 409.
- **Движок:** `ExecutionEngineService` проверяет `cancelled_at` перед каждым уровнем и каждым узлом. Бросает `RunCancelledException` (non-retryable). `RunsProcessor` ловит и помечает `cancelled`.
- **UI:** Кнопка «Отменить» в TopBar (только при `status === 'running'`).

### 3.2 Срез 2 — History Comparison
- **API:** `GET /runs/:id1/compare/:id2` → `{ run1, run2, diffs: { outputs, duration, cost } }`.
- **UI:** Модалка `RunCompareModal` (выбор двух запусков из истории).
- **Diff:** Сравнение по `nodeId`, `status`, `outputs` (deep equal), `durationMs`, `costUsd`.

### 3.3 Срез 3 — UX Polish
- **KI-628:** Адаптивный TopBar (схлопывание подписей при < 1440px).
- **KI-632:** Внеочередной пинг при `fallback` (вместо ожидания 30 с).
- **KI-623:** Перенос payload email-очереди из Redis в БД (outbox).

## 4. Совместимость
- `cancelled_at` nullable, старые запуски не затронуты.
- Compare — новый эндпоинт, старые не меняются.

## 5. План работ

| # | Подшаг | ~сессий | Зависит от | Выход |
|---|---|---:|---|---|
| S1 | Cancel Run (API + Engine + UI) | 1.5 | — | Кнопка отмены, корректная остановка |
| S2 | History Comparison (API + UI) | 1.0 | — | Модалка сравнения |
| S3 | UX Polish (KI-628, 632, 623) | 1.0 | — | Адаптивный TopBar, recovery, outbox |
| S4 | Релиз v1.4.0 | 1.0 | все | Docs, тег |

**Итого:** ~4-5 сессий.

## 6. Что НЕ входит в v1.4.0
- Мульти-организации (`organization_members`, KI-583) — v1.5+.
- Webhook / Schedule триггеры — v1.5+.
- Billing — v1.6+.

## 7. Риски
| Риск | Митигация |
|---|---|
| Отмена во время media-вызова может оставить orphan-задачу | Проверять `cancelled_at` после каждого узла, abort signal |
| Compare больших outputs | Лимит 100 КБ на diff, сводка |
