---
title: "KI-спринты 53–55: лимиты, env и маршруты"
date: 2026-11-19
version: v1.6.0
steps: [S53, S54, S55]
status: done
related_ki: [KI-400, KI-411, KI-422, KI-423, KI-428, KI-429, KI-430, KI-431, KI-432, KI-438, KI-441, KI-447]
---

# KI-спринты 53–55 — отчёт

12 KI: 9 `Fixed`, 3 `Documented`.

## 1. Файлы

| Файл | Изменение |
|------|-----------|
| `src/workflow/workflow.service.ts` | +26 / −9 — 23505 → ConflictException при duplicate-invite |
| `src/common/http-throttle.constants.ts`, `auth.controller.ts`, `app.module.ts` | +16, +9 / −1, +2 / −1 — register/refresh лимиты, env-лимит |
| `src/config/env.schema.ts`, `.env.example` | +14, +4 — `HTTP_THROTTLE_DEFAULT_LIMIT`, `PROMPT_CACHE_MIN_TOKENS` |
| `src/llm/providers/anthropic.provider.ts` | +4 / −4 — комментарий о валидируемом env |
| `web/src/stores/workflow.ts`, `.spec.ts` | +3, +13 — `runError: null` на `run_started` |
| `web/src/components/TopBar.tsx`, i18n ru/en | +31, +1 каждый — блок lipsync без аудио |
| `web/src/lib/graph-edit.ts`, `.spec.ts` | +8 / −4, +4 / −4 — зазор с учётом соседа |
| `web/src/types/media.ts`, `.spec.ts` (lib/media.spec) | +6 / −2, +2 — регистронезависимая схема URL |
| `web/src/App.tsx` | +23 / −6 — route-level lazy Canvas/ShareViewPage |
| `docs/KNOWN_ISSUES.md` | +74 / −19 — 12 статусов, сводка 411/52/92 |
| `docs/CHANGELOG.md`, `ROADMAP_KI.md` | +14, +15 / −12 — записи и лог |
| `docs/development/reports/v1.6.0/KI-S53-S55-rate-limits-routes.md` | настоящий отчёт |

## 2. Build / test

`pnpm build` 0/0, `pnpm typecheck`, `pnpm test` — **2159 passed / 26 skipped**;
`pnpm --dir web build` 0/0 (стартовый чанк 223 → 208 КБ),
`pnpm --dir web lint` (0 errors), `pnpm --dir web test` — **648 passed**;
гейт реестра OK.

## 3. Диагностика

- **KI-400:** pre-check «уже участвует» и INSERT не в транзакции — гонка давала 500.
- **KI-423/422:** строгий лимит был только у login; общий лимит захардкожен.
- **KI-411:** `runError` оставался от предыдущей попытки после успешного retry.
- **KI-428:** реальный `upsertJobScheduler` не покрыт интеграционным тестом.
- **KI-429/430:** зазор вставки не учитывал размер соседа; схема URL сравнивалась
  регистрозависимо.
- **KI-431/432/441:** env-порог кэша не валидировался; счёт в символах; trust proxy
  булевый — все три требуют решений о контракте/токенайзере/топологии.
- **KI-438/447:** lipsync без аудио уходил в backend и падал там; Canvas с
  `@xyflow/react` грузился даже на `/login`.

## 4. Smoke

- duplicate-invite с кодом 23505 превращается в 409; остальные ошибки пробрасываются.
- register — 3/час, refresh — 30/мин, общий лимит — env `HTTP_THROTTLE_DEFAULT_LIMIT`
  (default 300), зафиксирован в `.env.example`.
- `run_started` очищает `runError`; новый тест зелёный.
- Зазор вставки: `size/2 + neighbor/2 + 40`; обновлены оба expectations.
- `HTTPS://...` принимается как валидная media-ссылка.
- `PROMPT_CACHE_MIN_TOKENS` валидируется Zod (1024 default).
- Run блокируется для lipsync с пустым `audioUrl`, ключ i18n в ru/en.
- Route-level lazy вынес `Canvas`/`ShareViewPage`/`reactflow` в отдельные чанки.
- Реестр: Fixed 411, Open 52, Documented 92, сумма 657; гейт OK.

## 5. Что не так

- KI-428/432/441 закрыты как `Documented`: нужны Redis-интеграционный тест,
  token-count сервис и известная топология прокси соответственно.
- Per-route `@Throttle` остаются статическими (декоратор вычисляется на этапе
  объявления класса) — это задокументировано в константах.
- CDP-смоук в браузере не проводился; lazy-роуты проверены только сборкой.
- Три спринта закоммичены одним коммитом из-за непрерывной сессии.

## 6. Новые KI

Не найдено.

## 7. Обоснование решений

- 23505 обрабатывается точечно в сервисе, без транзакции: поведение совпадает
  с pre-check, а остальные ошибки не подменяются (RULES 1.7).
- Env-лимит добавлен только для глобального throttler'а; пер-роутные лимиты
  намеренно константы — проще аудировать.
- Для `runError` выбран `# cleared on run_started`: следующая попытка начинается
  с чистого состояния, даже если предыдущая упала.
- Зазор вставки и регистронезависимость URL — минимальные правки чистой логики
  с тестами, без изменения контрактов.
- `Documented` выбран там, где «фикс» означал бы смену контракта или
  инфраструктуры; триггеры возврата записаны в реестре.
- Отчёт — один на три спринта; docs обновлены в этом же коммите.
