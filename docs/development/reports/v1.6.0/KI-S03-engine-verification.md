---
title: "KI-спринт 03: верификация устаревших KI движка"
date: 2026-11-19
version: v1.6.0
steps: [S03]
status: done
related_ki: [KI-038, KI-041, KI-042, KI-049]
---

# KI-спринт 03 — отчёт

## 1. Файлы

Только документация: `docs/KNOWN_ISSUES.md` (4 статуса и Fix-заметки),
`docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`,
`docs/development/reports/README.md`. Код не изменялся.

## 2. Build / test

Не требуется (docs-only): предыдущий коммит `5dc320d` прошёл `pnpm build`
0/0 и `pnpm test` — 2138 passed.

## 3. Диагностика

- **KI-038:** в `ExecutionEngineService` метрики шага маппятся в колонки
  `node_runs` через `toNodeRunMetrics` (`tokensIn`, `tokensOut`, `costUsd`,
  `costRub`, кэш-токены, `costStatus`); `logs` пишутся в тот же UPDATE и в
  событие `node_completed`. Требование KI выполнено в v0.11 S11.
- **KI-041:** `isRetryableNodeError` не помечает side-effecting типы
  (`http`, `condition`, `output`, `compare`, `document_gen`); повтор узла для
  LLM/media безопасен, а KI-046 защищает от повторной оплаты при job-retry.
- **KI-042:** `NODE_RETRY_*` в `env.schema.ts`; `calculateRetryDelayMs`
  использует `Retry-After`, экспоненту, потолок и джиттер.
- **KI-049:** `RunsStreamService` шлёт первым сообщением `snapshot` из
  `workflow_runs` + `node_runs` через `NodeRunSnapshotMapper` — подключившийся
  в середине retry клиент видит переиспользованные узлы.

## 4. Smoke

Код не менялся; smoke предыдущего спринта остаётся действительным (CI
`CI` и `Docker Publish` по `70f4224` — success).

## 5. Что не так

- Статусы в реестре отставали от кода на 4 KI — исправлено; это не новая
  проблема и не регресс.
- Отдельного события `node_reused` нет: при желании его можно добавить как
  расширение контракта, но текущий снимок закрывает сценарий KI-049.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Реестр — единственный источник истины о статусе (RULES 2.4/3.20), поэтому
устаревшие записи закрываются по факту проверки кода без искусственных
правок: код уже соответствует требованиям, новые изменения только добавили
бы риск регресса.
