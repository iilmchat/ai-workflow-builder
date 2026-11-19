---
title: "KI-спринт 63: throttler и контраст pending-узлов"
date: 2026-11-19
version: v1.6.0
steps: [S63]
status: done
related_ki: [KI-512, KI-513, KI-514, KI-515]
---

# KI-спринт 63 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/common/throttler/redis-throttler.storage.ts` | +45 / −8 — локальный тип, валидация Lua, ленивое соединение |
| `src/common/throttler/redis-throttler.storage.spec.ts` | +26 / −4 — 3 новых теста, обновлён shutdown-тест |
| `web/src/styles/theme.css` | +4 — токен `--color-node-border-pending` (light/dark) |
| `web/src/components/nodes/BaseNode.tsx`, `BaseNode.spec.tsx` | +1 / −1 — новый класс рамки |
| `docs/KNOWN_ISSUES.md`, `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `reports/README.md` | статусы и сводки |

## 2. Build / test

`pnpm build` — 0/0; throttler-спек — 8 passed; `pnpm --dir web build` — 0/0;
web — 70 файлов / 650 тестов. Гейт реестра OK.

## 3. Диагностика

- **KI-513/514/515** — три проблемы в одном файле throttler'а: deep-import
  внутреннего типа пакета, невалидируемый ответ `EVAL`, соединение, создаваемое
  даже при `THROTTLER_STORAGE=memory`.
- **KI-512** — `pending` был единственным статусом без отдельного токена рамки.

## 4. Smoke

Тесты: `duplicate()` не вызывается в конструкторе и вызывается один раз при
первом `increment`; некорректный ответ Lua уходит в in-memory fallback;
`quit()` вызывается только если соединение создавалось. BaseNode проверяет
новый класс `border-node-border-pending`.

## 5. Что не так

- При каждом новом обращении после shutdown соединение будет пересоздано —
  штатный сценарий (сервис уже останавливается).

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Локальный структурный тип убирает зависимость от внутренней раскладки пакета;
валидация ответа Lua — на границе внешних данных (RULES 1.17); lazy-соединение
исключает лишний Redis-клиент в memory-режиме.
