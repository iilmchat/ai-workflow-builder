---
title: "KI-спринт 11: кросс-табная ротация и надёжный logout"
date: 2026-11-19
version: v1.6.0
steps: [S11]
status: done
related_ki: [KI-224, KI-231, KI-239, KI-240]
---

# KI-спринт 11 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `web/src/lib/api.ts` | +30 / −15 — Web Lock вокруг refresh, выделен `performRefreshAsync` |
| `web/src/components/TopBar.tsx` | +9 / −1 — повтор logout перед локальным выходом |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm --dir web build` — 0/0; `pnpm --dir web test` — 598 passed;
backend не менялся.

## 3. Диагностика

- **KI-231:** single-flight защищал только один таб. После KI-216 параллельная
  ротация стала опаснее: второй вызов с тем же токеном отозвал бы всё семейство.
- **KI-224:** `handleLogout` глотал ошибку и сразу чистил сессию.
- **KI-239:** токен шаринга не возвращается в `GET /workflow/:id`, localStorage
  не подходит как надёжный источник.
- **KI-240:** read-only страница использует редакторные компоненты узлов.

## 4. Smoke

Web build и все 598 тестов зелёные. Кросс-табное поведение проверяется по
контракту Web Locks (сериализация внутри origin); в jsdom locks отсутствуют —
сохраняется прежний путь, тесты не затронуты.

## 5. Что не так

- В браузерах без Web Locks multi-tab остаётся нескоординированным (fallback).
- KI-239/KI-240 отложены; функционально страница шаринга остаётся read-only.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Web Locks выбран вместо BroadcastChannel: это нативная сериализация критической
секции без ручного лидер-выбора и таймаутов. Повтор logout — минимальная
правка, не меняющая контракт API.
