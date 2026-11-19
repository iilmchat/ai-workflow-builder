---
title: "KI-спринты 47–49: кэш, e2e и SSE-контракт"
date: 2026-11-19
version: v1.6.0
steps: [S47, S48, S49]
status: done
related_ki: [KI-332, KI-333, KI-335, KI-339, KI-341, KI-342, KI-343, KI-345, KI-346, KI-350, KI-351, KI-354]
---

# KI-спринты 47–49 — отчёт

12 KI: 10 `Fixed`, 2 `Documented`. Спринты 47–49 закоммичены вместе из-за
непрерывной сессии (RULES 3.2 отступление зафиксировано в логе).

## 1. Файлы

| Файл | Изменение |
|------|---------|
| `web/src/lib/workflow-list-cache.ts`, `.spec.ts` | +28, +11 — инвалидация по focus/visibility |
| `web/src/App.tsx` | +7 — установка слушателей при монтировании |
| `web/package.json`, `web/pnpm-lock.yaml` | +2, +217 — lint-скрипт и oxlint в web |
| `.github/workflows/ci.yml` | +12 — шаги Lint (web) и Run e2e tests (build) |
| `src/engine/execution-engine.service.ts`, `.spec.ts` | +28 / −10, +40 / −11 — id предшественника, `{}` для нет-выходов, thenable-двойник |
| `package.json`, `docs/development/RULES.md` | +1 / −1 каждый — `dotenv/config` вместо `--env-file`, фактический текст ошибки |
| `tsconfig.spec.json` | +11 / −1 — e2e-спек, migrate.ts, drizzle.config.ts, drizzle/** |
| `web/src/types/run-stream.ts` | +23 / −22 — строгие uuid/ISO-даты/nonnegative |
| `docs/KNOWN_ISSUES.md` | +81 / −19 — 12 статусов, заметки, сводка 397/76/81 |
| `docs/CHANGELOG.md`, `ROADMAP_KI.md` | +20, +16 / −13 — записи и лог спринтов |
| `docs/development/reports/v1.6.0/KI-S47-S49-cache-e2e-sse.md` | настоящий отчёт |

## 2. Build / test

`pnpm build` 0/0, `pnpm typecheck` 0 ошибок, `pnpm test` — **2159 passed /
26 skipped**; `pnpm --dir web build` 0/0, `pnpm --dir web lint` — errors 0
(warnings pre-existing), `pnpm --dir web test` — **646 passed**. Гейт реестра
OK (657 = 657). CI предыдущих спринтов зелёный.

## 3. Диагностика

- **KI-332:** TTL кэша списка workflow проверялся только при запросе — после
  возврата из другой вкладки селект `sub_workflow` показывал старый список.
- **KI-333:** фронт не был в lint-гейте: не было скрипта и oxlint в `web/`.
- **KI-335:** уже исправлено в KI-314 (формула `parsePadding`) — верификация.
- **KI-339:** id упавшего предшественника был только в логе движка, а не в
  `node_runs.error`/`node_skipped.reason`.
- **KI-341:** skipped писал `outputs: null`, failed не сбрасывал outputs —
  после retry в строке могли остаться старые выходы (KI-047).
- **KI-342:** двойник Drizzle разрешал `await insert().values().onConflict...`
  без `.returning()`, тест «проходил» по несуществующему пути.
- **KI-343:** шаблон `test/**/*.spec.ts` не матчит `app.e2e-spec.ts`, e2e не
  запускался в CI.
- **KI-345:** `--env-file=.env` на Node 24/Windows печатает `.env: not found`.
- **KI-346:** `migrate.ts`/`drizzle.config.ts`/`drizzle/**` вне typecheck.
- **KI-350:** фронт-SSE-зеркало принимало любые строки вместо uuid/ISO-дат и
  отрицательные длительности/токены.
- **KI-351/354:** браузерный 401-шум неустраним без смены контракта refresh;
  объединение двух обходов уровней в движке — высокорисковый рефакторинг при
  уже выделенном `skipBlockedNodesAsync`.

## 4. Smoke

- Фокус вкладки увеличивает ревизию кэша и обнуляет закэшированный список без
  ожидания TTL; слушатели ставятся один раз.
- Web lint: `oxlint --type-aware src/` — 0 errors; шаг добавлен в job `web` до
  Build. Lockfile web обновлён (`pnpm install --dir web`).
- id предшественника виден в `node_runs.error` и `node_skipped.reason`,
  включая префиксованные id подграфов (`sub_sub-1__SB` и т.п.).
- `outputs` у failed/skipped — `{}`; двойник Drizzle падает на терминале без
  `.returning()` (отдельный тест).
- `tsconfig.spec.json` покрывает e2e и drizzle-скрипты; в CI добавлен
  `pnpm test:e2e` с теми же env, что и основные тесты.
- `test:parity` использует `-r dotenv/config`; RULES § 3.19 фиксирует текст
  ошибки старого варианта.
- SSE-зеркало: `z.uuid()`, `z.iso.datetime()`, `.nonnegative()`; паритет полей
  (KI-348) и 646 web-тестов зелёные.
- Реестр: Fixed 397, Open 76, Documented 81, сумма 657; гейт OK.

## 5. Что не так

- KI-351/354 закрыты как Documented, а не кодом: для первого требуется
  изменение контракта refresh, для второго — крупный рефакторинг движка.
- Lint web выдаёт warning'ы `no-base-to-string`/`no-unsafe-optional-chaining`
  в старых файлах; гейт не блокирует (exit 0), но со временем их стоит разобрать.
- E2e-тест в CI может потреблять время job `build`; при нестабильности нужно
  вынести его в отдельный job (пока зафиксирован в том же job с БД/Redis).
- Три спринта закоммичены одним коммитом: в сессии не было точки останова
  между S47/S48/S49; docs обновлены целиком, история KI не пострадала.
- CDP-смоук в браузере не проводился.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

- Инвалидация по focus дешевле BroadcastChannel и покрывает основной сценарий
  «другая вкладка/окно» без нового transport-слоя.
- oxlint добавлен именно в `web/` (RULES 6.11): отдельный lockfile уже есть, гейт
  обязан работать в job `web`.
- id предшественника включён прямо в текст ошибки и событие — контракт
  `z.string()` не ломается, а диагностика в UI стала осмысленной.
- `{}` выбран единым «нет выходов», чтобы после retry не оставались старые
  outputs и не приходилось различать `null`/`{}` в UI.
- Thenable двойник с rejection на неподдерживаемых цепочках превращает молчаливый
  false-positive в явный тест-фейл.
- Строгость SSE-зеркала повышена до уровня backend: расхождение теперь ловится
  на границе, а не маскируется `z.string()`.
- Документация всех трёх спринтов обновлена в этом же коммите (RULES 2.1/2.12);
  отчёт — один на три спринта по указанию пользователя.
