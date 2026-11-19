---
title: "KI-спринты 56–58: контракты портов, env и шаблоны"
date: 2026-11-19
version: v1.6.0
steps: [S56, S57, S58]
status: done
related_ki: [KI-458, KI-473, KI-476, KI-477, KI-480, KI-484, KI-485, KI-486, KI-487, KI-488, KI-489, KI-490]
---

# KI-спринты 56–58 — отчёт

12 KI: 9 `Fixed`, 3 `Documented`.

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/engine/node-ports.ts`, `.spec.ts` | +12 / −6, +5 / −5 — source-only контракт `read_file` |
| `src/engine/node-executors.ts` | +1 / −1 — актуальная ссылка KI-474 |
| `src/config/env.schema.ts` | +13 / −1 — граница lease TTL, cross-check heartbeat/stale |
| `src/db/schema-parity.spec.ts` | +9 — SQL-тип custom-колонок через `getSQLType()` |
| `web/src/components/nodes/DocumentGenNode.tsx` | +51 / −6 — текст ошибки API, ресинхронизация `variables` |
| `docs/development/v0.11/DESIGN_V011_FEATURES.md` | +1 / −1 — `document_gen` как имя типа |
| `docs/KNOWN_ISSUES.md` | +74 / −19 — 12 статусов, сводка 420/40/95 |
| `docs/CHANGELOG.md`, `ROADMAP_KI.md` | +12, +15 / −12 — записи и лог |
| `docs/development/reports/v1.6.0/KI-S56-S58-env-and-docs.md` | настоящий отчёт |

## 2. Build / test

`pnpm build` 0/0, `pnpm typecheck`, `pnpm test` — **2159 passed / 26 skipped**;
`pnpm --dir web build` 0/0, `pnpm --dir web lint` (0 errors),
`pnpm --dir web test` — **648 passed**; гейт реестра OK.

## 3. Диагностика

- **KI-473/476:** устаревшая ссылка в комментарии и уже работающий CI-гейт
  реестра (KI-001 больше не дублирует поле статуса).
- **KI-477/480:** контракт `read_file` объявлял фиктивный target-порт, а DESIGN
  называл узел `document_generation` вместо фактического `document_gen`.
- **KI-484/487:** env-значения без верхней границы/кросс-проверки позволяли
  фактически отключить обнаружение падения worker'а.
- **KI-485/486:** все `PgCustomColumn` маппились в `bytea`; drizzle-kit кавычит
  SQL-тип — безвредно для текущего `bytea`.
- **KI-488:** общего runtime-модуля между backend и отдельным пакетом web нет.
- **KI-489/490:** ошибки API шаблонов сводились к generic-тексту, а локальный
  черновик `variables` не ресинхронизировался при undo/redo.
- **KI-458:** флаг `PGVECTOR_ENABLED` проверяется движком, но не инструментами
  агента.

## 4. Smoke

- `read_file` теперь source-only (`targetHandleId`/`inputPortName` = `null`),
  тест контракта обновлён; `inferInputPortName` даёт безопасный `input`.
- `WORKFLOW_RUN_LEASE_TTL_MS` ≤ 24 ч; `heartbeat < staleThreshold` проверяется
  на итоговой схеме — несовместимые значения отклоняются.
- `schema-parity` берёт SQL-тип `PgCustomColumn` из Drizzle, а не хардкодит `bytea`.
- DocumentGenNode показывает конкретный `error.message` и ресинхронизирует
  `variables` только при внешнем изменении (курсор при наборе не дёргается).
- DESIGN v0.11 фиксирует `document_gen`; комментарий CSV обновлён.
- Реестр: Fixed 420, Open 40, Documented 95; гейт OK.

## 5. Что не так

- KI-458/486/488 закрыты как `Documented`: нужны plumbing `ConfigService` в
  агент, следующий custom SQL-тип и shared-пакет соответственно.
- `getSQLType()` доступен не у всех версий Drizzle — fallback `bytea` оставлен;
  при обновлении ORM стоит перепроверить гейт.
- CDP-смоук в браузере не проводился.
- Три спринта закоммичены одним коммитом из-за непрерывной сессии.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

- Явный `null` в контракте source-only узла честнее фиктивного `text-input`:
  будущий type-aware резолвер не сможет «найти» несуществующий вход.
- Cross-checks env добавлены на итоговой схеме, где видны обе группы полей,
  а не внутри отдельных Zod-объектов.
- Для `variables` выбран ref «последней собственной записи»: он отличает
  внешнее изменение от обычного набора и сохраняет позицию курсора.
- `Documented` применён там, где фикс требует смены контракта или инфраструктуры;
  триггеры возврата зафиксированы в реестре.
- Отчёт — один на три спринта; docs обновлены в этом же коммите.
