---
title: "KI-спринт 13: ретраи HTTP и отложенные контракты портов"
date: 2026-11-19
version: v1.6.0
steps: [S13]
status: done
related_ki: [KI-278, KI-280, KI-284, KI-304]
---

# KI-спринт 13 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/engine/node-executors.ts` | +22 / −3 — `RetryableNodeException` для GET/HEAD (таймаут, 429/5xx) |
| `src/engine/node-executors.spec.ts` | +20 / +1 — тест KI-280 и импорт исключения |
| `docs/KNOWN_ISSUES.md` | 4 статуса и обоснования |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm exec vitest run src/engine/node-executors.spec.ts` — **65 passed**;
полные `pnpm build` / `pnpm test` перед коммитом.

## 3. Диагностика

- **KI-280:** retry допускался только для `LlmProviderException.retryable` и
  `RetryableNodeException`; http-узел бросал обычный `Error`.
- **KI-278/KI-284:** `compare` требует два операнта, а контракт допускает
  один вход на тип; простановка первого handle не решает задачу.
- **KI-304:** вложенные узлы пишутся с префиксными id — схлопывание без
  маппинга сломает историю подграфов.

## 4. Smoke

Юнит-тест: GET + 503 → `RetryableNodeException`; POST + 503 → обычный `Error`.
Существующие тесты KI-289 на текст ошибки остаются зелёными (сообщение
`HTTP 503` сохранилось).

## 5. Что не так

- HEAD не объявлен в `HttpNodeDataSchema` (только GET/POST/PUT/DELETE), поэтому
  ретрай применяется к GET — безопасному идемпотентному методу.
- KI-278/284/304 отложены — реальные ограничения контракта, триггеры fixed
  в реестре.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Идемпотентность определена по методу: безопасные GET/HEAD ретраятся,
побочные POST/PUT/DELETE — нет. Это не меняет DTO узла и следует существующей
модели `RetryableNodeException` в движке.
