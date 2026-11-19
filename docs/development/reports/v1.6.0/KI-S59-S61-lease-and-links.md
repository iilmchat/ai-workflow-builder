---
title: "KI-спринты 59–61: аренда, ссылки и защита от поздних ответов"
date: 2026-11-19
version: v1.6.0
steps: [S59, S60, S61]
status: done
related_ki: [KI-491, KI-492, KI-493, KI-494, KI-495, KI-496, KI-498, KI-499, KI-502, KI-503, KI-504, KI-505]
---

# KI-спринты 59–61 — отчёт

12 KI: 6 `Fixed`, 6 `Documented`.

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/runs/run-lease.service.ts` | +16 / −5 — генерация heartbeat, защита от старых тиков |
| `src/engine/execution-engine.service.ts` | +9 / −1 — `leaseExpiresAt: null` при финале |
| `web/src/components/nodes/DocumentGenNode.tsx` | +21 / −1 — refresh шаблонов по focus/visibility |
| `web/src/stores/workflow.ts` | +7 / −1 — guard позднего ответа `restoreRunAsync` |
| `scripts/check-markdown-links.mjs`, `package.json`, `.github/workflows/ci.yml` | +3, +1, +3 — `pnpm check:links` в CI |
| `docs/KNOWN_ISSUES.md` | +76 / −19 — 12 статусов, сводка 426/28/101 |
| `docs/CHANGELOG.md`, `ROADMAP_KI.md` | +10, +15 / −12 — записи и лог |
| `docs/development/reports/v1.6.0/KI-S59-S61-lease-and-links.md` | настоящий отчёт |

## 2. Build / test

`pnpm build` 0/0, `pnpm typecheck`, `pnpm test` — **2159 passed / 26 skipped**;
`pnpm --dir web build` 0/0, `pnpm --dir web lint` (0 errors),
`pnpm --dir web test` — **648 passed**; гейты реестра и ссылок OK.

## 3. Диагностика

- **KI-491/493/494/495:** шаблоны кэшировались до F5; старый heartbeat-тик
  мог перепланироваться после повторного `startAsync`; lease оставался в БД
  после финала; Set `#stopped` мог расти — последнее уже чистилось в `startAsync`.
- **KI-502/503/504/496/498:** integration-тесты и генератор метрик требуют
  отдельной инфраструктуры; `cacheSavingsUsd` есть в REST-снимке, но не в
  событии `node_completed` агента.
- **KI-499:** проверка ссылок была только во временных скриптах.
- **KI-505:** при быстрой смене workflow поздний ответ REST мог записать
  состояние другого запуска.

## 4. Smoke

- Heartbeat-тики несовпадшейся генерации игнорируются; `finishRunAsync`
  пишет `leaseExpiresAt: null`.
- Список шаблонов обновляется на `focus`/`visibilitychange`.
- `restoreRunAsync` сравнивает `currentWorkflowId` до и после `Promise.all`
  и не применяет поздний ответ.
- `pnpm check:links` проверяет активные markdown-документы, архивные отчёты
  с историческими путями исключены; шаг добавлен в CI.
- Реестр: Fixed 426, Open 28, Documented 101, сумма 657; оба гейта OK.

## 5. Что не так

- KI-492/496/498/502/503/504 закрыты как `Documented`: shared-пакет,
  integration-спеки, генератор метрик и расширение SSE-контракта требуют
  отдельных изменений инфраструктуры/сборки.
- Link-checker намеренно проверяет только «живые» документы — в архиве
  остаются устаревшие относительные пути.
- CDP-смоук в браузере не проводился.
- Три спринта закоммичены одним коммитом из-за непрерывной сессии.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

- Генерация heartbeat дешевле и надёжнее попыток угадать состояние по
  `#timers`: старый тик не может повлиять на новый цикл.
- Guard `currentWorkflowId` выбран вместо `AbortSignal`: не требует изменений
  сигнатур `requestAsync` и покрывает гонку целиком.
- Link-checker ограничен активными документами — иначе архивные отчёты
  давали бы десятки ложных срабатываний.
- `Documented` использован для задач, где «фикс» — отдельная инфраструктурная
  миграция; триггеры возврата записаны в реестре.
- Отчёт — один на три спринта; docs обновлены в этом же коммите.
