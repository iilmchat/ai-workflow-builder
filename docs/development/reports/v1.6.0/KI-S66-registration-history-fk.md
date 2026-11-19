---
title: "KI-спринт 66: регистрация, история и каскад участников"
date: 2026-11-19
version: v1.6.0
steps: [S66]
status: done
related_ki: [KI-539, KI-543, KI-557, KI-559]
---

# KI-спринт 66 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/auth/auth.service.ts`, `auth.service.spec.ts` | +16 / −2 — ConflictException на 23505, +тест |
| `web/src/components/RunHistoryModal.tsx` | +21 — polling history каждые 5 с |
| `src/db/schema.ts`, `drizzle/0024_*.sql` | +4 / −1 — CASCADE на invited_by |
| `docs/KNOWN_ISSUES.md`, `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `reports/README.md` | статусы и сводки |

## 2. Build / test

`pnpm build` — 0/0; backend 2161 passed; `pnpm --dir web build` — 0/0;
web 651 тест. Гейт реестра OK.

## 3. Диагностика

- **KI-557:** pre-check email вне транзакции — параллельная регистрация
  упиралась в `users_email_unique` и отдавала 500.
- **KI-559:** `invited_by` без `ON DELETE CASCADE` — удаление организации
  падало на 23503 из-за порядка каскадов.
- **KI-543:** история загружалась один раз при открытии модалки.
- **KI-539:** `started_at DEFAULT now()` смешивает ожидание в очереди с
  временем выполнения у запусков, упавших до старта.

## 4. Smoke

Тест регистрации: `transaction` отклоняется с `code: '23505'` → `ConflictException`.
Миграция 0024 меняет FK на `ON DELETE cascade`; Drizzle-схема и SQL согласованы
(сгенерировано `pnpm db:generate`). Polling гасится при закрытии модалки.

## 5. Что не так

- KI-539 отложен: исправление меняет миграцию и контракт `RunSummary.durationMs`.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Все три исправления точечные: обработка unique violation на границе БД,
фоновый опрос без мигания UI и каскад FK вместо ручной очистки участников.
