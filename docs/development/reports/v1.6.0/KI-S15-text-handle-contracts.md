---
title: "KI-спринт 15: target-handle TextNode и контрактные гейты"
date: 2026-11-19
version: v1.6.0
steps: [S15]
status: done
related_ki: [KI-349, KI-356, KI-357, KI-370]
---

# KI-спринт 15 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `web/src/components/nodes/TextNode.tsx` | +6 — target-handle `text-input` |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm --dir web build` — 0/0; `pnpm --dir web test` — 598 passed.
Backend не менялся.

## 3. Диагностика

- **KI-349:** планировщик видел вход по контракту, но React Flow не находил хэндл
  у `TextNode` — связь рисовалась висячей (36 warning в смоуке B2).
- **KI-356:** клиентский Zod отбрасывает лишнее поле `shareToken`, дефект
  не проявляется; DTO затронет три ручки и контрактный гейт.
- **KI-357:** расширение паритет-гейта требует согласования optional/nullable
  и типов модальностей.
- **KI-370:** маршрутизация в `MediaNodeExecutor` рабочая и покрыта спеками;
  перенос в реестр — рефакторинг без выигрыша в поведении.

## 4. Smoke

Web build и 598 тестов зелёные. Handle добавлен с тем же id, что и в
`NODE_PORT_CONTRACT['text'].targetHandleId`.

## 5. Что не так

- KI-356/KI-357/KI-370 отложены; триггеры возврата зафиксированы в реестре.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Минимальная правка UI закрывает реальный визуальный дефект. Контрактные и
архитектурные KI объединены со связанными задачами, чтобы не делать дважды
работу над одним и тем же DTO/реестром.
