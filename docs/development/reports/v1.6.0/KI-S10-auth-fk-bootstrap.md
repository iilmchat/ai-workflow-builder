---
title: "KI-спринт 10: безопасность refresh-токенов и bootstrap"
date: 2026-11-19
version: v1.6.0
steps: [S10]
status: done
related_ki: [KI-203, KI-209, KI-216, KI-223]
---

# KI-спринт 10 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/auth/auth.service.ts` | +14 — family revocation при reuse refresh-токена |
| `src/auth/auth.service.spec.ts` | +3 — проверка второго UPDATE в тесте гонки |
| `web/src/lib/api.ts` | +11 / −2 — различение 401 и сетевой ошибки в bootstrap |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm exec vitest run src/auth/auth.service.spec.ts` — **32 passed**;
`pnpm --dir web build` — 0/0; `pnpm --dir web test` — **598 passed**.
Полные build/test backend перед коммитом.

## 3. Диагностика

- **KI-216** подтверждён: при `revoked.length === 0` метод просто возвращал
  `null`, оставляя остальные сессии пользователя активными.
- **KI-223** подтверждён: `catch` без анализа ошибки вызывал `clearSession()`
  при любом сбое refresh.
- **KI-203:** FK `workflows.user_id` отсутствует намеренно с учётом legacy
  `'demo-user'` и передачи графов владельцу (KI-599).
- **KI-209:** оговорка в `### Planned` CHANGELOG уже добавлена.

## 4. Smoke

Юнит-тест гонки refresh теперь проверяет, что сделаны два UPDATE: отзыв
конкретной строки и отзыв всего семейства. Web-тесты и сборка зелёные.

## 5. Что не так

- KI-223: баннер «нет связи» и retry не реализованы — результат остаётся в
  статусе `unknown`; это UX-дополнение, не потеря сессии.
- KI-203 остаётся Deferred до проверки целостности historical строк.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Оба исправления — минимальные и в уже существующих транзакциях/путях, без
изменения публичных контрактов. FK отложен, пока не будет проверена целостность
данных и политика каскадного удаления.
