---
title: "KI-спринты 44–46: холст, гейты и PATCH-семантика"
date: 2026-11-19
version: v1.6.0
steps: [S44, S45, S46]
status: done
related_ki: [KI-307, KI-308, KI-309, KI-310, KI-311, KI-313, KI-320, KI-321, KI-323, KI-324, KI-325, KI-327]
---

# KI-спринты 44–46 — отчёт

12 KI: 11 `Fixed`, 1 `Documented`. Коммиты: S44 `dc1d795`, S45 `261577a`,
S46 — текущий.

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/nodes/*` (controller/module/service + spec'ы) | −55 — удалён мёртвый модуль (KI-308) |
| `api-prefixes.json`, `src/app.module.ts`, `src/common/api-prefixes.spec.ts` | удалён префикс `nodes`, 14 → 13, комментарии |
| `web/src/components/Canvas.tsx` | +6 — `autoPanOnNodeDrag={false}` |
| `web/src/lib/api-prefixes.spec.ts` | +30 / −2 — комментарии и конкатенация литералов |
| `web/tsconfig.spec.json`, `tsconfig.json`, `tsconfig.app.json`, `node-types.spec.ts` | +28 / −4 — отдельный tsconfig спеков с `@types/node` |
| `docs/development/SMOKE_CDP.md` | +13 / −1 — § 7 про `/unknown/foo` и § 6 ретраев ввода |
| `src/db/schema-parity.spec.ts` | +13 — расширение карты типов (KI-320) |
| `src/workflow/workflow.service.ts`, `.spec.ts` | +36 / −8, +8 / −2 — SQL `CASE WHEN` версии, `updatedAt`, `graphVersion` |
| `web/src/lib/graph-hash.ts`, `.spec.ts` | +3, +9 — тип узла в хэше |
| `src/auth/auth.controller.ts`, `auth.service.ts`, `auth.controller.spec.ts` | +12, +27, +17 — dev-автологин `/auth/refresh` |
| `docs/KNOWN_ISSUES.md` | +84 / −19 — 12 статусов, заметки, сводка 387/88 |
| `docs/CHANGELOG.md`, `ROADMAP_KI.md` | +20, +16 / −13 — записи спринтов и лог |
| `docs/development/reports/v1.6.0/KI-S44-S46-patch-auth-parity.md` | настоящий отчёт |

## 2. Build / test

`pnpm build` 0/0, `pnpm typecheck`, `pnpm test` — **2158 passed / 26 skipped**
(140 файлов, 4 skipped); `pnpm --dir web build` 0/0, `pnpm --dir web test` —
**645 passed** (70 файлов); `node scripts/check-known-issues.mjs` — OK. CI
S44/S45 — success по всем job'ам.

## 3. Диагностика

- **KI-307:** React Flow при drag за край автоматически панорамировал холст,
  прибавляя смещение вьюпорта к flow-координатам (−500 → −1304…−1368).
- **KI-308:** `@Controller('nodes')` с пустым телом, модуль и сервис нигде не
  использовались, но префикс числился в реестре и проксировался вхолостую.
- **KI-309:** регулярка spec'а матчила литералы и комментарии, но не видела
  `'/work' + 'flow'`.
- **KI-310:** `types: ["vite/client"]` в `tsconfig.app.json` блокировал `node:*`
  во всех web-спеках.
- **KI-311/313:** уже частично закрыты инфраструктурой (парсер контроллеров
  знает корневую форму) и памяткой; требовалось подтверждение/уточнение.
- **KI-320/321:** гейт паритета схемы знал только 6+1 типов и не проверял
  длины/порядок/констрейнты; полная проверка констрейнтов — отдельный
  контракт метаданных, а порядок колонок в БД отличается из-за миграций.
- **KI-323/325:** решение об инкременте принималось по SELECT до UPDATE —
  два конкурентных одинаковых PATCH давали +2; `updatedAt` двигался даже на
  идемпотентном Save.
- **KI-324:** хэш фронта не включал `type`, backend deep-equal включал.
- **KI-327:** при `AUTH_DISABLED=true` гард пускал запросы, но `/auth/refresh`
  без cookie отвечал 401, и `AuthProvider` уводил на `/login`.

## 4. Smoke

- Холст: `autoPanOnNodeDrag={false}`; ручная панорама и Fit не затронуты.
- Удалённые контроллеры: тест паритета API_PREFIXES зелёный на 13 префиксов,
  `nodes` больше нет ни в реестре, ни в spec-ожиданиях.
- Префикс-спек: `'/work' + 'flow/items'` → `['workflow']`; комментарии
  `//`/`/* */` не создают ложных префиксов; legacy-тесты не изменились.
- Web tsconfig: `tsc -b` собирает приложение и спекы; тест импортирует
  `node:path` через `posix.join`; jest-dom-матчеры подключены через
  `src/test/setup.ts` в include. 645 тестов зелёные.
- Паритет схемы: `PgVarchar/PgBigInt/PgDoublePrecision/PgReal/PgDate/PgTime/
  PgInterval/PgArray/PgEnum` добавлены в карту; DB-гейт в CI без изменений.
- PATCH: сгенерированный SQL содержит `CASE WHEN … IS DISTINCT FROM …` и
  `"workflows"."version" + 1`; идентичный граф не передаёт `updatedAt`;
  метаданные по-прежнему его обновляют.
- Хэш: смена `type` узла меняет хэш, кэш по ссылкам работает (KI-253).
- Dev-автологин: `POST /auth/refresh` без cookie при `AUTH_DISABLED=true`
  возвращает 200, вызывает `devSignInAsync(DEMO_USER_ID)` и ставит cookie.
- Реестр: 657 записей, Fixed 387 / Open 88 / Documented 80; гейт OK.

## 5. Что не так

- KI-321 закрыт как `Documented`: length/order/constraints остаются вне
  гейта. Триггеры возврата — появление `varchar`/`enum` или инцидент с
  дрейфом ограничений; индексы pgvector проверяются отдельным спеком.
- KI-311 закрыт «по факту»: парсер уже разбирал все три формы декоратора,
  изменён только комментарий после KI-308.
- `devSignInAsync` не имеет отдельного throttle (как и `/auth/login` в dev);
  при `AUTH_DISABLED=true` production запрещён env-схемой.
- SQL `CASE WHEN` использует `JSON.stringify(dto.nodes)` как параметр —
  порядок ключей в jsonb каноничен, поэтому результат совпадает с
  deep-equal по содержимому, но теперь сравнение идёт в БД, а не в JS.
- CDP-смоук в браузере не проводился; правила в SMOKE_CDP.md остаются
  памяткой для временных скриптов вне репозитория.
- `pnpm lint` — 2 pre-existing `no-base-to-string` в
  `openai-images.provider.spec.ts` (не наши файлы); `pnpm build` — 0/0.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

- KI-307 решён отключением только `autoPanOnNodeDrag`, а не всей панорамы:
  режим «Рука» и колесо пользователю нужны.
- Мёртвый модуль `src/nodes/` удалён целиком вместе с префиксом — пустой
  `@Controller` не должен числиться в API-реестре.
- Для KI-309 предобработка исходника (комментарии + склейка) дешевле и
  надёжнее, чем попытка парсить AST в тесте префиксов.
- KI-310 — отдельный tsconfig спеков: приложение не получает `node:*`, а
  тесты спокойно используют `node:path`.
- KI-323 — SQL-условие вместо транзакции: не меняется тестовая двойника
  двойника Drizzle и нет блокировки строк; при этом гонка идентичных PATCH
  устранена.
- KI-325 — `updatedAt` не двигается только для полностью идентичного графа;
  метаданные остаются полноценным обновлением.
- KI-327 — dev-автологин на стороне backend, чтобы `AuthProvider` не
  перенаправлял на `/login` в CI; production-ветка недостижима по env.
- Отчёт — один на три спринта по указанию пользователя; docs обновлялись в
  каждом коммите (RULES 2.1/2.12/3.17).
