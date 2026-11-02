---
title: "S1: Web Search Expansion (Bing + Brave)"
date: 2026-11-02
version: v0.15.0
steps: [S1]
status: accepted
related_ki: [KI-546, KI-547, KI-548]
related_adr: []
---

# Отчёт S1 — Web Search Expansion (провайдеры Bing и Brave)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **104 passed / 3 skipped
(107 файлов), 1545 passed / 18 skipped**, `pnpm --dir web test` — **52/52
файлов, 455/455 тестов**, `pnpm --dir web build` — **exit 0**, `pnpm lint` —
**0 errors / 2 warnings** (оба — pre-existing `openai-images.provider.spec.ts`,
§ 2). Смоук: реальный backend — **16/16**, провайдеры на мок-fetch — **27/27**
(§ 4).

**Точка старта.** HEAD `2bccfdc` («feat(v0.14.0): Run History Browser & API»),
CI зелёный после релиза v0.14.0. Источник — `docs/development/v0.14/DESIGN_V014_FEATURES.md`
§ 3.3, правила — `docs/development/RULES.md` v1.10.0.

**О названии пакета.** Промпт задачи озаглавлен «v0.15.0 S3», но явно требует
отчёт по пути `docs/development/reports/v0.15.0/S1-web-search.md`. Следовал
явному пути: файл отчёта — S1, содержание — срез «Web Search Expansion» из
DESIGN V014 § 3.3 (в самом DESIGN это S3).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/web-search/providers/provider-utils.ts](../../../../src/web-search/providers/provider-utils.ts) *(new)* | 127 | Общие утилиты провайдеров: `normalizeMaxResults` (1–10, дефолт 5), `truncate` (сниппет 500), `classifyHttpStatus` (401/403 — детерминировано, 429/5xx — retryable, прочие 4xx — детерминировано), `stripHtml`, `toIsoDate`, единый таймаут 15 с |
| [src/web-search/providers/tavily.provider.ts](../../../../src/web-search/providers/tavily.provider.ts) *(new; перенесён из `src/web-search/tavily.provider.ts` и расширен)* | 269 | Tavily: `search_depth` из `searchDepth`, `time_range` из `freshness`, `include_raw_content`, общая классификация ошибок, Zod-схемы ответа |
| [src/web-search/providers/tavily.provider.spec.ts](../../../../src/web-search/providers/tavily.provider.spec.ts) *(new; перенесён и расширен)* | 369 | 18 тестов: ключ/ошибки, контракт POST, `search_depth`, `time_range`, маппинг `rawContent`, 401/403/429/5xx/сеть/таймаут/JSON/схема/пустой запрос |
| [src/web-search/providers/bing.provider.ts](../../../../src/web-search/providers/bing.provider.ts) *(new)* | 295 | Bing Web Search API v7: GET `api.bing.microsoft.com/v7.0/search`, заголовок `Ocp-Apim-Subscription-Key`, `count`/`responseFilter`/`textFormat`/`freshness`, маппинг `webPages.value[]`; `searchDepth` принимается, но не отправляется (KI-546) |
| [src/web-search/providers/bing.provider.spec.ts](../../../../src/web-search/providers/bing.provider.spec.ts) *(new)* | 349 | 20 тестов: контракт GET/заголовки, `freshness` (day→Day, диапазон, year→365 дней), игнор `searchDepth`, `count`, сниппет 500, 401/403/429/5xx/сеть/таймаут/JSON/схема |
| [src/web-search/providers/brave.provider.ts](../../../../src/web-search/providers/brave.provider.ts) *(new)* | 291 | Brave Search API: GET `api.search.brave.com/res/v1/web/search`, заголовок `X-Subscription-Token`, `count`/`text_decorations=false`/`freshness`, `web.results[]`, очистка HTML из `title`/`description` (KI-546 — depth не поддерживается) |
| [src/web-search/providers/brave.provider.spec.ts](../../../../src/web-search/providers/brave.provider.spec.ts) *(new)* | 337 | 19 тестов: контракт GET/заголовки, `freshness` (day→pd, month→pm, year→py, нативный), `stripHtml`, `count`, 401/403/429/5xx/сеть/таймаут/JSON/схема |
| [src/web-search/web-search.registry.ts](../../../../src/web-search/web-search.registry.ts) *(new)* | 108 | `WebSearchRegistryService`: `defaultName` из env `WEB_SEARCH_PROVIDER`, `getProvider(name?)`, `list()` (все провайдеры + `configured`). Ошибку «ключ не задан» оставляет провайдеру (точный текст env-переменной) |
| [src/web-search/web-search.controller.ts](../../../../src/web-search/web-search.controller.ts) *(new)* | 41 | `GET /web-search/providers` под `JwtAuthGuard`: `{ defaultProvider, providers: [{ name, configured }] }`, ключи не отдаются (RULES 5.1) |
| [web/src/lib/web-search-providers.spec.ts](../../../../web/src/lib/web-search-providers.spec.ts) *(new)* | 102 | Паритет контракта web ↔ backend: `WEB_SEARCH_PROVIDER_NAMES`, `WEB_SEARCH_DEPTH_PROVIDERS`, `WEB_SEARCH_FRESHNESS_PROVIDERS` (backend-исходник читается как `?raw` через `import.meta.glob`) |
| [docs/development/reports/v0.15.0/S1-web-search.md](S1-web-search.md) *(new)* | — | этот отчёт |

### 1.2 Изменённые файлы

| Файл | +/− | Что |
|---|---:|---|
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +25/−10 | `BING_API_KEY`, `BRAVE_API_KEY` (optional, `emptyToUndefined`), `WEB_SEARCH_PROVIDER: z.enum(WEB_SEARCH_PROVIDER_NAMES)` (источник имён — контракт web-search) |
| [src/config/env.schema.spec.ts](../../../../src/config/env.schema.spec.ts) | +36/−11 | Дефолты (все ключи `undefined`), пустые ключи → `undefined`, приём tavily/bing/brave, отказ неизвестному (`google`) |
| [src/web-search/web-search.interface.ts](../../../../src/web-search/web-search.interface.ts) | +110/−8 | `WEB_SEARCH_PROVIDER_NAMES`, `WebSearchProviderName`, `WebSearchOptions.searchDepth`/`freshness`, `WebSearchProviderInfo`, `IWebSearchProviderRegistry`, `WebSearchProvidersResponse`; карты возможностей `WEB_SEARCH_DEPTH_PROVIDERS`/`WEB_SEARCH_FRESHNESS_PROVIDERS`; `IWebSearchProvider.name` сужен до union |
| [src/web-search/web-search.module.ts](../../../../src/web-search/web-search.module.ts) | +36/−36 | Регистрация Tavily/Bing/Brave + реестр; токен `WEB_SEARCH_PROVIDER` сохранён (отдаёт env-дефолт); `AuthModule` ради guard'а; экспорт реестра/провайдеров |
| [src/web-search/web-search.module.spec.ts](../../../../src/web-search/web-search.module.spec.ts) | +158/−15 | 5 тестов: дефолт Tavily, `WEB_SEARCH_PROVIDER=bing/brave`, выбор по имени, ответ `GET /web-search/providers` без ключей |
| [src/engine/node-executors.ts](../../../../src/engine/node-executors.ts) | +54/−11 | `WebSearchNodeData`: `provider`, `searchDepth`, `freshness`; Zod-схема (provider — enum, depth — enum, freshness — строка ≤64); исполнитель принимает `IWebSearchProviderRegistry`, вызывает `registry.getProvider(data.provider)`, передаёт опции через capability-гейт (`WEB_SEARCH_DEPTH_PROVIDERS`/`WEB_SEARCH_FRESHNESS_PROVIDERS`) |
| [src/engine/web-search-executor.spec.ts](../../../../src/engine/web-search-executor.spec.ts) | +115/−36 | 15 тестов: registry вместо провайдера, `data.provider`, невалидный provider, `searchDepth`, `freshness`, гейт «depth не уходит провайдеру без поддержки», остальные прежние кейсы |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +9/−10 | Инжектит `WebSearchRegistryService` вместо токена; узел `web_search` получает реестр |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +11/−6 | DI-заглушка реестра вместо токена |
| [src/media/media-storage.integration.spec.ts](../../../../src/media/media-storage.integration.spec.ts) | +11/−7 | То же в интеграционном DI-графе (узел не выполняется) |
| [src/common/api-prefixes.spec.ts](../../../../src/common/api-prefixes.spec.ts) | +3/−2 | Ожидаемый список префиксов 9 → 10 (`web-search`) |
| [api-prefixes.json](../../../../api-prefixes.json) | +1/−0 | Префикс `web-search` (Vite-proxy и SPA-fallback получают его автоматически) |
| [src/app.module.ts](../../../../src/app.module.ts) | +2/−2 | Комментарий: модуль теперь регистрирует и HTTP-ручку |
| [src/runs/runs.module.ts](../../../../src/runs/runs.module.ts) | +2/−1 | Комментарий: реестр вместо токена |
| `src/web-search/tavily.provider.ts` | −317 | Удалён: переехал в `providers/tavily.provider.ts` (269 строк) |
| `src/web-search/tavily.provider.spec.ts` | −345 | Удалён: переехал в `providers/tavily.provider.spec.ts` (369 строк) |
| [web/src/types/graph.ts](../../../../web/src/types/graph.ts) | +59/−7 | `WEB_SEARCH_PROVIDER_NAMES`/`WebSearchProviderName`, `WEB_SEARCH_DEPTH_PROVIDERS`, `WEB_SEARCH_FRESHNESS_VALUES/PROVIDERS`; `WebSearchNodeData.provider`/`freshness` |
| [web/src/lib/api.ts](../../../../web/src/lib/api.ts) | +45/−0 | `WebSearchProviderInfoSchema`, `WebSearchProvidersResponseSchema`, `fetchWebSearchProvidersAsync()` (`GET /web-search/providers` + Zod) |
| [web/src/stores/workflow.ts](../../../../web/src/stores/workflow.ts) | +41/−0 | `webSearchProviders`, `webSearchProvidersLoaded`, `loadWebSearchProvidersAsync` (лениво, кэш на сессию, ошибка не критична) |
| [web/src/components/nodes/WebSearchNode.tsx](../../../../web/src/components/nodes/WebSearchNode.tsx) | +181/−3 | `useEffect` загрузки каталога; селект провайдера при >1 сконфигурированном, при недоступном env-дефолте и при сохранённом недоступном провайдере (disabled-опции, KI-547); селект `searchDepth` только для Tavily; селект `freshness` (day/week/month/year/«за всё время») |
| [web/src/components/nodes/WebSearchNode.spec.tsx](../../../../web/src/components/nodes/WebSearchNode.spec.tsx) | +165/−0 | 7 тестов: скрытие селекта при одном провайдере, выбор провайдера, searchDepth для Tavily, скрытие depth для Bing, freshness + сброс, выбор при недоступном env-дефолте, disabled-опция сохранённого недоступного провайдера |
| [web/src/i18n/ru.json](../../../../web/src/i18n/ru.json) | +16/−0 | Ключи `node.web_search.provider*` (включая `defaultUnavailable`/`unavailable`), `freshness*`, `searchDepth*` |
| [web/src/i18n/en.json](../../../../web/src/i18n/en.json) | +16/−0 | Те же ключи по-английски (паритет проверяет `i18n.spec.ts`) |
| [web/src/lib/api.spec.ts](../../../../web/src/lib/api.spec.ts) | +32/−0 | 2 теста `fetchWebSearchProvidersAsync`: URL + Zod-разбор, отказ неизвестному провайдеру |
| [web/src/stores/workflow.spec.ts](../../../../web/src/stores/workflow.spec.ts) | +53/−0 | 2 теста `loadWebSearchProvidersAsync`: загрузка + кэш, некритичная ошибка (флаг `loaded` не выставляется) |
| [docs/CHANGELOG.md](../../../../docs/CHANGELOG.md) | +12/−0 | Запись `[Unreleased] → Added` со ссылкой на отчёт |
| [docs/KNOWN_ISSUES.md](../../../../docs/KNOWN_ISSUES.md) | +66/−0 | KI-546/547/548; KI-547 закрыт в этом же срезе (UI-фикс); заполнена пустая сводка статусов (RULES 3.20, § 3.6) |
| [README.md](../../../../README.md) | +7/−2 | Web Search: три провайдера, опции, `GET /web-search/providers` |
| [.env.example](../../../../.env.example) | +9/−2 | `WEB_SEARCH_PROVIDER` (tavily\|bing\|brave), `TAVILY_API_KEY`, `BING_API_KEY`, `BRAVE_API_KEY` |
| [docs/development/reports/README.md](../../../../docs/development/reports/README.md) | +1/−0 | Строка отчёта v0.15.0 S1 |

**Итого (без учёта предсуществующей правки `RELEASE_NOTES.md`, сделанной до
сессии):** tracked-файлы — **+1276 / −831**; новые файлы — **10 файлов /
2288 строк**. Вместе: **+3564 / −831**. Крупнейшие: `providers/tavily.provider.spec.ts`
(369), `providers/bing.provider.spec.ts` (349), `providers/brave.provider.spec.ts`
(337). Артефакты смоука (gitignored): `.smoke/v015-s1-web-search-mock-smoke.ts`,
`.smoke/v015-s1-web-search-mock-smoke.json`,
`.smoke/v015-s1-web-search-real-smoke.mjs`,
`.smoke/v015-s1-web-search-real-smoke.json`.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** (exit 0) · `pnpm typecheck` — **0**
(exit 0) · `pnpm test` — **104 passed / 3 skipped (107 файлов), 1545 passed /
18 skipped** (41.2 с) · `pnpm --dir web test` — **52/52 файлов, 455/455
тестов** (39.8 с) · `pnpm --dir web build` — **exit 0** (`tsc -b` + Vite,
`✓ built in 300ms`) · `pnpm lint` — **0 errors / 2 warnings** (оба —
`src/media/providers/openai-images.provider.spec.ts`, преэкзистующие; новый
warning `unbound-method` в `web-search-executor.spec.ts` был найден и исправлен,
§ 3.4).

Прирост к HEAD: backend **+2 файла / +53 теста** (Tavily-спек переехал без
потери кейсов и получил +2 новых; добавились Bing 20, Brave 19, модуль 5,
исполнитель 15), web **+1 файл / +15 тестов** (WebSearchNode 7, api 2,
паритет имён/карт 4, store loader 2). Целевые прогоны после финальных правок:
backend `src/web-search` + executor + env + api-prefixes — **155 passed**
(7 файлов), web WebSearchNode + api + parity + store + i18n — **66 passed**
(5 файлов).

---

## 3. Диагностика

### 3.1 Bing Web Search API v7 не имеет параметра глубины

Промпт задачи называет `searchDepth` опцией «для Tavily/Bing»; DESIGN V014
§ 3.3 формулирует иначе — «`searchDepth` для Tavily, `freshness` для Brave», и
Bing там не упомянут. Реальная документация Bing Web Search API v7 такого
параметра не содержит (есть `count`, `freshness`, `responseFilter`, `textFormat`,
`textDecorations`); у Brave Search API его тоже нет. Реализация: поле входит в
общий `WebSearchOptions` и Zod-схему узла (контракт единый), но Bing/Brave в
запрос его не кладут, пишут debug-лог, **UI не показывает селект** для них, а
исполнитель дополнительно гейтит опцию по `WEB_SEARCH_DEPTH_PROVIDERS` —
«мёртвая настройка» была бы хуже её отсутствия. Зафиксировано KI-546. Проверено
тестами `bing.provider.spec.ts`/`brave.provider.spec.ts`, тестом гейта
исполнителя и mock-смоуком.

### 3.2 Перенос Tavily в `providers/`: git видит delete+add

Чтобы структура была однородной (все три реализации в `src/web-search/providers/`),
`tavily.provider.ts` и его спек переехали. Git не распознал rename (содержимое
существенно изменилось), поэтому в diff'е это `−317`/`−345` + новые файлы на
269/369 строк. Смысловых потерь нет: все прежние кейсы Tavily сохранены,
добавлены `search_depth`/`time_range`.

### 3.3 `WebSearchModule` и `JwtAuthGuard`: тестовому модулю нужен `DbModule`

Новый контроллер под `JwtAuthGuard` заставил `WebSearchModule` импортировать
`AuthModule`, а `AuthService` зависит от `DRIZZLE`. В `web-search.module.spec.ts`
пришлось импортировать `DbModule` и фиктивный `DATABASE_URL`: `pg.Pool`
создаётся лениво, соединений нет, `moduleRef.close()` корректно закрывает пул.
Альтернатива (мокать `AuthService`) проверяла бы не реальную сборку DI-графа, а
заглушку, поэтому выбран настоящий модуль.

### 3.4 Новый lint-warning в спеке исполнителя

`expect(registry.getProvider).toHaveBeenCalledWith(...)` — ссылка на unbound
метод: oxlint дал `typescript(unbound-method)`. Исправлено: из
`createRegistry()` теперь достаётся сам мок `getProvider`, и проверяется
`expect(getProvider).toHaveBeenCalledWith('bing')`. `pnpm lint` вернулся к
базовым 2 warnings.

### 3.5 Паритет префиксов API: 9 → 10

`api-prefixes.spec.ts` требует, чтобы каждый `@Controller('...')` был в
`api-prefixes.json` и наоборот. Добавлены префикс `web-search` и запись в
`EXPECTED_CONTROLLER_PREFIXES`; тест «реестр содержит все 10 префиксов» обновлён.
Без этого Vite-прокси не проксировал бы ручку, и она отдавала бы SPA-fallback
`200 text/html` (класс KI-072/120/299).

### 3.6 Пустая «Сводка по статусам» в KNOWN_ISSUES на HEAD (найдено попутно)

На HEAD файл заканчивался заголовком `## Сводка по статусам` без содержимого —
RULES 3.20 не выполнялся. Пересчитал grep'ом и заполнил: **536** записей
`### KI-` (включая шаблон KI-001), статусы — Fixed 237, Fixed (частично) 1,
Open 278, Documented 13, Documented (не воспроизводится) 1, Planned 1,
Deferred 1, Won't Fix 4; сумма = 536. Это правка документации, а не фичи;
внесена в diff реестра (+66 строк вместе с тремя новыми KI и закрытием KI-547).
Проверка RULES 3.20: строк с маркером статуса — 537 (536 записей + одна
pre-existing строка KI-476, где маркер упомянут в описании), минус 1 = 536.
Формулировку сводки сделал без буквального маркера, чтобы сам текст не ломал
grep-проверку (замечание verifier'а).

### 3.7 Замечания независимого verifier'а и их исправление

Verifier дал вердикт **PASS WITH NITS** (0 blocker, 0 major) и независимо
перепроверил все гейты, включая `pnpm test:e2e` (boot `AppModule` с новым
графом `WebSearchModule → AuthModule → controller`) и реальный прогон
`data.provider`. Реальные замечания исправлены до финальных гейтов:

1. **KI-547 (minor, реальный UX-край):** при одном сконфигурированном
   провайдере, который не совпадает с env-дефолтом (в `.env` остался
   `WEB_SEARCH_PROVIDER=tavily`, а ключ задан только у Brave), селект
   скрывался — выбрать работающего провайдера было нельзя, каждый Run падал на
   дефолте. Исправлено: селект показывается, если env-дефолт не
   сконфигурирован; «По умолчанию» рендерится `disabled`-опцией. Заодно
   сохранённый `data.provider` без ключа показывается `disabled`-опцией
   («— нет ключа»), а не подменяется визуально первым пунктом. KI-547 → Fixed,
   добавлены 2 теста узла.
2. **RULES 3.20 (minor):** буквальный маркер статуса в тексте сводки добавлял
   лишнюю строку для grep-проверки — переформулировано без маркера.
3. **nits:** исправлена атрибуция DESIGN в KI-546 (DESIGN говорит «Tavily, а не
   Tavily/Bing»), убраны две ссылки на перемещённые файлы Tavily в отчёте
   (заменены текстом), исправлена ссылка «§ 5.9» → «§ 2», capability-карты
   backend теперь используются исполнителем (а не только в JSDoc), паритет-тест
   расширен на все три списка, добавлены тесты стора на
   `loadWebSearchProvidersAsync` (успех/кэш и ошибка).

### 3.8 Freshness был бы мёртвым кодом

После расширения `WebSearchOptions` поле `freshness` не использовалось ни
исполнителем, ни UI — провайдеры умели бы его принимать, но вызвать было некому.
Поэтому `freshness` доведён до конца: `data.freshness` в Zod-схеме узла →
`executeWebSearchNodeAsync` → провайдер, плюс селект в узле (алиасы
`day/week/month/year`, пустое — «за всё время»). Иначе расширение интерфейса
было бы формальным.

### 3.9 Zod 4 и `z.enum` с readonly-кортежем

`z.enum(WEB_SEARCH_PROVIDER_NAMES)` с `as const`-кортежем компилируется и
работает в Zod 4 (`tsc -p tsconfig.spec.json` и рантайм-тесты зелёные),
поэтому дублировать литералы в env-схеме и схеме узла не пришлось.

### 3.10 Переключение DI-токена в существующих спеках

`ExecutionEngineService` больше не инжектит `WEB_SEARCH_PROVIDER`, поэтому две
спеки (`execution-engine.service.spec.ts`, `media-storage.integration.spec.ts`)
заменяют провайдера-заглушку на заглушку реестра. Токен оставлен в модуле и
экспорте (обратная совместимость), но потребителей в прод-коде у него больше
нет.

### 3.11 i18n-паритет

Новые ключи добавлены в оба файла (`ru.json`/`en.json`) и проверены
`web/src/i18n/i18n.spec.ts`; тест узла читает реальные русские подписи из
`ru.json`, а не литералы.

---

## 4. Smoke

### 4.1 Реальный локальный backend (без ключей) — 16/16

**Окружение:** Windows 11, Node 24.21.0, pnpm 12.11.2; PostgreSQL 5433 и Redis
6379 в Docker (`workflow-builder-db`, `workflow-builder-redis`, healthy);
backend собран (`pnpm build`) и запущен как `node dist/main` на
`127.0.0.1:3000` с текущим `.env` (`AUTH_DISABLED=false`, ключей
Tavily/Bing/Brave нет). Скрипт: `.smoke/v015-s1-web-search-real-smoke.mjs`,
отчёт: `.smoke/v015-s1-web-search-real-smoke.json`.

**Сценарий.** 1) `POST /auth/register` реального пользователя; 2)
`GET /web-search/providers` без токена и с токеном; 3) `POST /workflow` с одним
узлом `web_search` (`data.query='typescript'`); 4) `POST /runs` и поллинг
`GET /runs/:id` до терминального статуса; 5) `GET /runs/:id/nodes` — статус и
текст ошибки узла; 6) то же для `data.provider='brave'`.

**Результат: 16/16 проверок, 0 падений.** Ключевые факты:

| Проверка | Факт |
|---|---|
| `GET /web-search/providers` без токена | **401** (guard работает) |
| `GET /web-search/providers` с токеном | **200**, `defaultProvider: "tavily"`, 3 провайдера, все `configured: false` |
| Ключи в ответе | нет (`api_key`/`apikey` отсутствуют) |
| Run без ключа (дефолт Tavily) | `status=failed`, узел `web-1`: `[tavily] TAVILY_API_KEY не задан` |
| Run с `data.provider='brave'` | `status=failed`, узел `web-1`: `[brave] BRAVE_API_KEY не задан` (Tavily в ошибке нет) |

Пример отчёта:

```json
{
  "providers": {
    "defaultProvider": "tavily",
    "providers": [
      { "name": "tavily", "configured": false },
      { "name": "bing", "configured": false },
      { "name": "brave", "configured": false }
    ]
  },
  "tavilyRun": {
    "id": "c1cf9097-ea23-4bee-ab21-838b39849546",
    "status": "failed",
    "nodeError": "[tavily] TAVILY_API_KEY не задан"
  },
  "braveRun": {
    "id": "5f356002-fde4-4924-81e3-9482ddb1322b",
    "status": "failed",
    "nodeError": "[brave] BRAVE_API_KEY не задан"
  }
}
```

В логе backend'а видны штатные WARN трёх провайдеров на старте
(«…не задан — web-search (…) недоступен»), падение узла и job-level retry
`1/3`, `2/3` (BullMQ `attempts: 3`, KI-040) — то есть ошибка не «проглатывается»,
а повторяется штатным механизмом; итоговый статус запуска — `failed`.

### 4.2 Провайдеры на мок-fetch (ключи есть) — 27/27

**Окружение:** тот же runtime, `pnpm exec tsx .smoke/v015-s1-web-search-mock-smoke.ts`;
сеть не используется, глобальный `fetch` подменён, ConfigService — заглушка с
тестовыми ключами. Отчёт: `.smoke/v015-s1-web-search-mock-smoke.json`.

Проверено (27 проверок, все ✅):

1. **Без ключей** — каждый из трёх провайдеров: `isConfigured=false`, вызов
   бросает `WebSearchProviderException` с текстом `TAVILY_API_KEY не задан` /
   `BING_API_KEY не задан` / `BRAVE_API_KEY не задан`.
2. **Tavily (mock):** POST на `https://api.tavily.com/search`, заголовок
   `Authorization: Bearer …`, в теле `"search_depth":"advanced"` и
   `"time_range":"week"`, маппинг результата и `rawContent`.
3. **Bing (mock):** GET на `https://api.bing.microsoft.com/v7.0/search`,
   заголовок `Ocp-Apim-Subscription-Key`, `count=4`, `freshness=Month`,
   `searchDepth` в URL **отсутствует** (KI-546), маппинг `TypeScript`.
4. **Brave (mock):** GET на `https://api.search.brave.com/res/v1/web/search`,
   заголовок `X-Subscription-Token`, `freshness=py`, HTML вычищен
   (`Vite — build tool`, `Fast frontend tooling & dev server`).
5. **Реестр:** `defaultName='bing'` из env, `getProvider('brave')`, `list()` =
   `tavily:false, bing:true, brave:true`; контроллер отдаёт
   `defaultProvider='bing'` и не содержит ключей.
6. **Исполнитель:** `data.provider='bing'` + `freshness='week'` → в запрос ушёл
   `freshness=Week` (Bing), outputs — только `{ results, text }`.
7. **Env-схема:** `WEB_SEARCH_PROVIDER=bing` + ключ Bing проходит `validateEnv`;
   `google` отвергается ошибкой старта.

Смоук перепрогнан после финальных правок (гейт capability в исполнителе) —
снова **27/27**; реальный backend-смоук тоже перепрогнан на финальной сборке —
**16/16** с теми же результатами.

### 4.3 Честные оговорки

1. **Реальных вызовов Bing/Brave/Tavily не было:** ключей в `.env` нет, поэтому
   «с ключами работает» доказано только мок-fetch'ем (проверен путь код →
   URL/заголовки/маппинг/ошибки), но не соответствие живому upstream. Это
   единственный способ проверить без операторских ключей; при первом реальном
   ключе стоит прогнать один запрос вручную.
2. **UI не проверялся в браузере (CDP):** в этой сессии не поднимался Vite и
   браузер; селекты покрыты jsdom-тестами (`WebSearchNode.spec.tsx`, 13 тестов,
   из них 7 новых) и i18n-паритетом. Визуальный CDP-смоук селектов — кандидат в
   следующий срез.
3. **Fake-ключи в мок-смоуке** (`tvly-smoke` и т.п.) никуда не уходят: fetch
   замокан, сетевого вызова нет.
4. Артефакты `.smoke/*` — gitignored, в репозиторий не входят.

---

## 5. Что не так

1. **KI-546 (🟢 Low, Documented):** Bing Web Search API v7 и Brave Search API не
   поддерживают `searchDepth`; промпт называет его опцией «для Tavily/Bing», а
   DESIGN V014 § 3.3 — только «для Tavily». Поле принимается общим контрактом, но
   в запрос этих провайдеров не уходит (provider + capability-гейт исполнителя),
   UI скрывает селект. «Имитировать» глубину через `count` было бы ложью.
2. **KI-547 (🟢 Low, Fixed в этом же срезе):** сохранённый `data.provider` мог
   указывать на провайдера без ключа, а при env-дефолте без ключа (в `.env`
   `tavily`, ключ только у Brave) селект вообще скрывался — выбрать работающего
   провайдера было нельзя. Найдено verifier'ом; исправлено: селект показывается
   при недоступном env-дефолте и при stale-выборе, недоступные варианты —
   `disabled`-опции («По умолчанию недоступен», «— нет ключа»), значение в графе
   не подменяется молча. Run по-прежнему падает понятной ошибкой backend'а.
3. **KI-548 (🟢 Low, Documented):** `GET /web-search/providers` не добавлен в
   `docs/development/api-contract.json`: паритет-гейт KI-352 сверяет только
   перечисленные DTO, переименование поля с одной стороны не поймается.
4. **DESIGN V014 § 3.3 включает Google Custom Search, промпт — только Bing и
   Brave.** Google не реализован: следовал явному списку задач промпта.
   `WEB_SEARCH_PROVIDER` при этом остаётся расширяемым (реестр + enum).
5. **Токен `WEB_SEARCH_PROVIDER` сохранён, но в прод-коде больше не
   используется** (исполнитель инжектит реестр). Оставлен осознанно для
   обратной совместимости и существующих потребителей; если внешних
   потребителей нет, в следующем срезе его можно удалить.
6. **`freshness` у Tavily** передаётся как `time_range` — это подтверждено
   документацией Tavily, но живым ключом не проверялось (см. § 4.3).
7. **`year` для Bing** разворачивается в диапазон последних 365 дней
   (`YYYY-MM-DD..YYYY-MM-DD`): у Bing нет значения `Year`. Тест фиксирует
   результат через `vi.setSystemTime`, но поведение зависит от текущей даты.
8. **Предсуществующая правка `RELEASE_NOTES.md`** в рабочем дереве была до этой
   сессии — не трогал и в отчётный diff не включаю.
9. **В HEAD «Сводка по статусам» в KNOWN_ISSUES была пуста** — это не дефект
   среза, но RULES 3.20 не выполнялся; заполнил (§ 3.6).
10. **Отчёт называется S1, а пакет в промпте — S3:** путь отчёта задан промптом
    явно; в шапке DESIGN V014 это S3. Возможная путаница в нумерации — не
    ошибка кода.
11. **Нет UI-теста на английские подписи** (тест узла использует `ru.json`);
    паритет ключей проверен отдельно, значения EN — только визуально по diff.

---

## 6. Новые KI

Добавлены в `docs/KNOWN_ISSUES.md` (формат реестра соблюдён; сводка статусов
пересчитана grep'ом, § 3.6):

| KI | Приоритет | Статус | Суть | Файлы |
|---|---|---|---|---|
| **KI-546** | 🟢 Low | Documented | Bing v7/Brave не поддерживают `searchDepth`: поле принимается контрактом, но в запрос не уходит; UI скрывает селект для них | `src/web-search/providers/bing.provider.ts`, `brave.provider.ts`, `web/src/components/nodes/WebSearchNode.tsx`, `src/engine/node-executors.ts` |
| **KI-547** | 🟢 Low | **Fixed** (в этом срезе) | `data.provider`/env-дефолт без ключа: Run падает понятной ошибкой, а UI не помечал недоступный выбор. Исправлено disabled-опциями и показом селекта при недоступном дефолте | `web/src/components/nodes/WebSearchNode.tsx`, `src/web-search/web-search.registry.ts` |
| **KI-548** | 🟢 Low | Documented | `GET /web-search/providers` вне контракт-гейта `api-contract.json` (KI-352): состав полей не сверяется с backend | `docs/development/api-contract.json`, `src/runs/dto/api-contract.spec.ts`, `web/src/lib/api-contract.spec.ts` |

KI-547 найден и закрыт в этой же сессии (см. § 3.7). Закрытий других
существующих KI нет. KI-461 (мёртвые поля DESIGN `searchDepth`/`topic`):
`searchDepth` теперь поддержан и выведен в UI, `includeAnswer`/`topic`/`days`
остаются в графе как forward-compat — KI-461 **не закрыт** целиком, требуется
отдельная правка провайдерского контракта.

---

## 7. Обоснование решений

### 7.1 Реестр вместо одного провайдера

Задача требует выбирать провайдера в узле (`data.provider`), сохраняя
поведение старых графов (env). Один `IWebSearchProvider` в DI этого не
выражает; массив тоже не даёт дефолта. `WebSearchRegistryService` — одна точка,
где живут и env-дефолт, и выбор по имени, и список `configured` для UI. Провайдер
остаётся тонким `IWebSearchProvider`, поэтому исполнитель не знает о конкретных
классах (как `LlmRegistryService` в соседнем модуле).

### 7.2 Токен `WEB_SEARCH_PROVIDER` сохранён

Удаление символа — ломающее изменение для тестов/диагностики и внешних
потребителей, а цена сохранения — 6 строк в модуле. Токен теперь отдаёт
`registry.getProvider()`, то есть семантически остался «провайдер по умолчанию из
env», а движок перешёл на реестр.

### 7.3 Отдельная ручка, а не расширение `/llm/models`

`GET /llm/models` — про модели chat/vision; подмешивать туда web-search
провайдеров значило бы менять контракт чужой ручки и зеркала web. Новая
ручка `GET /web-search/providers` под JWT (как `GET /mcp/servers`) отдаёт только
имена и флаги; ключи не сериализуются (RULES 5.1). Префикс добавлен в единый
`api-prefixes.json`, поэтому Vite-proxy и SPA-fallback подхватили его без ручных
списков.

### 7.4 Селект провайдера — только когда есть реальный выбор

Показывать селект с одним доступным провайдером бессмысленно, если он же и
env-дефолт: значение всё равно не изменит поведение. UI фильтрует `configured`
и рендерит `<select>` при `>1` провайдере, а также в двух исключениях
(KI-547): env-дефолт не сконфигурирован (иначе выбрать работающего нельзя) и в
графе сохранён недоступный провайдер (иначе селект врёт «По умолчанию»).
Недоступные варианты — `disabled`-опции, значение в графе не подменяется молча.
Первая опция — «По умолчанию (Tavily)» — соответствует
`data.provider === undefined`, то есть env. Смена провайдера пишет
`data.provider` в граф; сброс на «по умолчанию» пишет `undefined` (Zod и
сериализация `undefined`-ключ не создают).

### 7.5 Capability-карты вместо `if (provider === …)` в компоненте

`WEB_SEARCH_DEPTH_PROVIDERS` и `WEB_SEARCH_FRESHNESS_PROVIDERS` — данные, а не
ветвления. Backend использует их в исполнителе (гейт: не отправлять
неподдерживаемую опцию даже если она пришла в `data`), UI — для показа
селектов. В web есть зеркало; паритет-тест `web-search-providers.spec.ts`
сравнивает с backend все три списка (провайдеры, depth, freshness), так что
рассинхрон двух пакетов ловится. `searchDepth` показывается только Tavily
(KI-546), `freshness` — всем трём.

### 7.6 Свежесть: провайдеро-независимые алиасы + нативные форматы

UI отдаёт `day/week/month/year` (человеческие подписи), провайдер
переводит: Tavily → `time_range`, Brave → `pd/pw/pm/py`, Bing →
`Day/Week/Month`, `year` → диапазон дат. Нативные значения (`2026-01-01..…` для
Bing, `…to…` для Brave) тоже принимаются: API-клиент может передать формат
провайдера напрямую. Неизвестное значение игнорируется (поле опциональное, не
должно ронять поиск); это осознанный компромисс против ошибки валидации.

### 7.7 Общие утилиты провайдеров

Три провайдера классифицируют ошибки одинаково (`classifyHttpStatus`) и
одинаково нормализуют лимит/сниппет. Дублирование этой логики означало бы, что
429 у одного провайдера ретраится, а у другого — нет (KI-036/104). Утилиты
лежат в `providers/provider-utils.ts`, не в `web-search.interface.ts`, чтобы
публичный контракт остался типовым и не тянул `RetryableNodeException` в
потребителей интерфейса.

### 7.8 Ключи — только в заголовках, запросы не логируются

Tavily — `Authorization: Bearer`, Bing — `Ocp-Apim-Subscription-Key`, Brave —
`X-Subscription-Token`; ни один ключ не попадает в URL (URL попадает в логи
прокси) и не сериализуется в ответ ручки. Текст запроса логируется только
длиной (RULES 5.9). В ответе `GET /web-search/providers` — только имена и
`configured`; это проверено и unit-тестом, и mock-смоуком.

### 7.9 Тесты: моки fetch, реальный DI, паритеты

Провайдеры тестируются с замоканным `fetch` (без сети и ключей): проверяются
точные URL/заголовки/query/тело, маппинг и вся матрица ошибок. Модуль
проверяется с реальным Nest-DI (а не `new`), включая `GET /web-search/providers`.
Паритет трёх контрактных списков web↔backend ловит рассинхрон двух пакетов;
загрузчик конфигурации в сторе покрыт отдельными тестами (успех/кэш и ошибка).
Тест узла — jsdom на реальных русских подписях. Полные прогоны: 1545
backend-тестов и 455
web-тестов зелёные.

### 7.10 Перенос Tavily в `providers/`

Единая структура (три реализации рядом) важнее «минимального diff»: оставить
Tavily в корне, а Bing/Brave в подкаталоге — значит навсегда закрепить
несогласованность. Переезд механический, поведение расширено, старые кейсы
сохранены.

### 7.11 Документация — в том же пакете

RULES 2.1/2.4/2.18: обновлены `CHANGELOG.md` (Added + ссылка на отчёт),
`KNOWN_ISSUES.md` (KI-546/547/548, KI-547 закрыт, пересчитанная сводка),
`README.md`, `.env.example`, `reports/README.md`.
`docs/development/api-contract.json` осознанно не расширялся (KI-548) — это
отдельная задача контракт-гейта.

### 7.12 Процесс

Ни одного `git add`/`git commit` не выполнено (жёсткое правило задачи);
`git add -A` не использовался. Итоговый diff содержит только фичу и её
документацию; предсуществующая правка `RELEASE_NOTES.md` не тронута. Код и
тесты проверены независимым verifier-агентом: вердикт **PASS WITH NITS**
(0 blocker, 0 major), все гейты воспроизведены им независимо (включая
`pnpm test:e2e` — boot `AppModule` с новым графом модулей); реальные замечания
исправлены до финальных прогонов (§ 3.7). Смоук: реальный backend — **16/16**,
мок-провайдеры — **27/27**.
