---
title: "KI-спринт 33: документация, правила и тесты утилит"
date: 2026-11-19
version: v1.6.0
steps: [S33]
status: done
related_ki: [KI-210, KI-211, KI-212, KI-218]
---

# KI-спринт 33 — отчёт

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `docs/development/v0.8/DESIGN_V08_FEATURES.md` | +2 / −2 — Package удалён из описания auth |
| `src/common/utils/parse-duration.spec.ts` | +22 (новый) — 3 теста |
| `docs/KNOWN_ISSUES.md` | 4 статуса, сводка пересчитана (657 = 657) |
| `docs/CHANGELOG.md`, `docs/development/ROADMAP_KI.md`, `docs/development/reports/README.md` | сводки |

## 2. Build / test

`pnpm exec vitest run src/common/utils/parse-duration.spec.ts` — **3 passed**;
полные build/test перед коммитом. Гейт реестра OK.

## 3. Диагностика

- **KI-210:** DESIGN уже описывал кастомный guard; после KI-208 удалена
  последняя формулировка про `@nestjs/passport` в deps.
- **KI-211:** правило 7 «Правил ведения» уже было добавлено.
- **KI-212:** заметка `git notes` для `88f53e4` уже существует в origin.
- **KI-218:** `parseDurationToMs` покрыт только косвенно — добавлены прямые тесты.

## 4. Smoke

Тесты: `30s`/`15m`/`1h`/`7d` → корректные мс; пробелы.trim(); неверный формат
(`10`, `5w`, `-1h`, кириллица) → Error. Наличие заметки проверено через `git notes show 88f53e4` (уже была в origin).

## 5. Что не так

- Интеграционный тест ротации на реальной БД (вторая часть KI-218) остаётся
  инфраструктурной задачей — требует testcontainers или выделенной БД.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

Там, где исправление уже в репозитории/origin, KI закрывается проверкой без
дублирования правок. Юнит-тесты добавлены точечно, без изменения prod-кода.
