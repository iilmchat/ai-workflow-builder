---
title: "KI-спринт 31: дефолты моделей и версии провайдеров"
date: 2026-11-19
version: v1.6.0
steps: [S31]
status: done
related_ki: [KI-171, KI-172, KI-173, KI-177]
---

# KI-спринт 31 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `web/src/lib/media.ts` | +4 / −2 — фильтр `deprecated` в `pickDefaultMediaModel` |
| `web/src/lib/media.spec.ts` | +8 — тест deprecated-модели |
| `docs/KNOWN_ISSUES.md` | 4 статуса, сводка пересчитана (657 = 657) |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm --dir web build` — 0/0; `pnpm --dir web test` — 67 файлов / **599 тестов**
зелёные (новый тест KI-173); гейт реестра OK.

## 3. Диагностика

- **KI-173:** приоритетная `flux-schnell` с `deprecated: true` всё равно
  выбиралась дефолтом — теперь фильтруется на обеих ветках выбора.
- **KI-172:** KI-174 уже добавил `YANDEX_MODELS` с полным URI и версией;
  константа `latest` — только дефолт для коротких id.
- **KI-171:** узлы фиксированной ширины, ResizeObserver нужен при resizable-узлах.
- **KI-177:** health-check LM Studio есть (KI-617), обновление каталога — нет.

## 4. Smoke

Тест: `[flux-schnell(deprecated), flux-dev]` → дефолт `flux-dev`. Сборка web и
все 599 тестов зелёные.

## 5. Что не так

- KI-171/KI-177 отложены с триггерами возврата.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Фильтр deprecated — минимальная правка на границе выбора модели, предотвращает
невалидный дефолт. Версия Yandex уже настраивается через env (KI-174),
поэтому дублирующая правка не нужна.
