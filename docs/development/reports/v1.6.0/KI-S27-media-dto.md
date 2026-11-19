---
title: "KI-спринт 27: media-DTO и селекты ImageGen"
date: 2026-11-19
version: v1.6.0
steps: [S27]
status: done
related_ki: [KI-102, KI-103, KI-115, KI-116]
---

# KI-спринт 27 — отчёт

## 1. Файлы

Только документация: `docs/KNOWN_ISSUES.md`, `docs/CHANGELOG.md`,
`docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md`.
Код не менялся.

## 2. Build / test

Не требуется (docs-only); предыдущий коммит `1fa02b1` зелёный, гейт реестра OK.

## 3. Диагностика

- **KI-103:** `MediaProviderException` уже хранит `provider`, `retryable`,
  `retryAfterMs` — структурированная диагностика доступна.
- **KI-102:** дублирования camelCase/snake_case в реальном каталоге не найдено;
  passthrough намеренно сохраняет неизвестные поля.
- **KI-115:** дефолт `aspectRatio` в UI не пишется в `data`, но executor
  отправляет порт только при явном значении — upstream применяет свой дефолт.
- **KI-116:** upstream сейчас отдаёт `aspect_ratio` как enum с `options`.

## 4. Smoke

Код не менялся. Сводка реестра 657 = 657.

## 5. Что не так

- KI-102/115/116 закрыты как Documented/Deferred с триггерами возврата.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Фактическое состояние кода фиксируется без правок: там, где поле уже есть
(KI-103), и там, где проблема гипотетична (KI-102/116), изменение кода
добавило бы риск без выигрыша.
