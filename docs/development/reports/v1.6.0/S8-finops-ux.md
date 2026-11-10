---
title: "S8: FinOps, Performance & UX Polish"
date: 2026-11-11
version: v1.6.0
steps: [S8]
status: accepted
related_ki: [KI-113, KI-195, KI-232]
related_adr: []
---

# Отчёт S8: FinOps, производительность и UX

Шаг добавляет кэш ответов LLM (чтобы пользователь не платил дважды за
одинаковый запрос), TTL-кэш каталогов моделей, полноценный индикатор
автосохранения и welcome-экран с готовыми шаблонами. Код и тесты изменены;
коммит не делался (RULES § 2.1, § 8). HEAD на старте — `d75902f` (S7),
рабочее дерево было чистым.

## 1. Файлы (+/−)

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `src/config/env.schema.ts` | изменён | 25 / 0 | `LLM_CACHE_ENABLED` (строгий boolean, default `false`), `LLM_CACHE_TTL_SECONDS` (int 1…2 678 400, default `86_400`) в `LlmRouterEnvSchema` |
| `src/config/env.schema.spec.ts` | изменён | 24 / 0 | дефолты кэша, строгий `'true'/'false'`, положительный TTL, отказ на `0`/`abc` |
| `.env.example` | изменён | 7 / 0 | документация обеих переменных |
| `src/llm/llm-response-cache.service.ts` | новый | 284 / 0 | Redis-кэш: tenant-ключ `sha256(...)`, `get`/`set` с TTL, валидация записи, ошибки Redis не ломают вызов |
| `src/llm/llm-response-cache.service.spec.ts` | новый | 187 / 0 | 10 тестов: флаг/TTL, ключ, порядок опций, hit/miss, битая запись, недоступный Redis |
| `src/llm/llm.service.ts` | изменён | 47 / 5 | интеграция кэша: hit → `cached: true` без роутера, miss → вызов + запись, disabled/без `orgId` → прежний путь |
| `src/llm/llm.service.spec.ts` | изменён | 86 / 0 | 4 теста кэша: попадание, промах, выключенный флаг, вызов без `orgId` |
| `src/llm/llm-provider.interface.ts` | изменён | 15 / 0 | `orgId?` в `LlmGenerateOptions` (только для кэша), `cached?` в `LlmGenerateResult` |
| `src/llm/llm-router.service.ts` | изменён | 3 / 1 | `orgId` вырезается перед передачей провайдеру |
| `src/llm/llm.module.ts` | изменён | 4 / 0 | регистрация `LlmResponseCacheService` |
| `src/llm/llm-node-executor.service.ts` | изменён | 39 / 12 | `orgId` в опциях, `cached` в метриках, `outputs.cached`, `costUsd = 0` при hit |
| `src/llm/llm-node-executor.service.spec.ts` | изменён | 31 / 2 | hit не начисляет стоимость, `orgId` уходит в `LlmService`, флаг в outputs |
| `src/llm/llm-registry.service.ts` | изменён | 66 / 8 | TTL 5 мин для `listModels()` и `getCapabilities()`, `clearCache()` |
| `src/llm/llm-registry.service.spec.ts` | изменён | 44 / 0 | 4 теста кэша: тот же массив, TTL, `clearCache`, паспорт модели |
| `src/media/media-registry.service.ts` | изменён | 69 / 6 | карта `modelId → provider` на 5 мин, `clearRoutesCache()` (KI-113) |
| `src/media/media-registry.service.spec.ts` | изменён | 18 / 0 | резолв двух моделей читает каталоги один раз; сброс кэша — повторно |
| `src/engine/execution-engine.service.ts` | изменён | 29 / 9 | `rootOrgId` резолвится для графов с `llm`/`agent`; передаётся в исполнители |
| `src/engine/execution-engine.service.spec.ts` | изменён | 4 / 0 | ожидания вызова LLM-исполнителя с организацией |
| `src/engine/node-executors.ts` | изменён | 6 / 1 | `executeAgentNodeAsync(..., orgId?)` и `AgentRunner.runAgentAsync(..., orgId?)` |
| `src/agent/agent.service.ts` | изменён | 19 / 4 | `orgId` в `runAgentAsync`, LLM-вызовах и tool-context; `costUsd = 0` при `cached` |
| `web/src/components/TopBar.tsx` | изменён | 20 / 6 | индикатор «Есть изменения / Сохранение... / Сохранено» с `data-dirty-indicator` |
| `web/src/components/TopBar.spec.tsx` | изменён | 56 / 1 | 3 теста состояний индикатора |
| `web/src/components/Canvas.tsx` | изменён | 13 / 4 | `relative` для overlay, автосейв больше не помечает граф сохранённым при ошибке, комментарий о сбросе дебаунса |
| `web/src/components/WelcomeScreen.tsx` | новый | 330 / 0 | три шаблона, создание графа через `addNode`/`onConnect`, «Скрыть», «Больше не показывать» |
| `web/src/components/WelcomeScreen.spec.tsx` | новый | 119 / 0 | 7 тестов: карточки, три графа, скрытие, localStorage, условия показа |
| `web/src/components/RunResultPanel.tsx` | изменён | 11 / 1 | бейдж «Ответ из кэша» (`data-cache-hit`) |
| `web/src/i18n/ru.json`, `en.json` | изменены | по 13 / 0 | `topbar.saving`, `welcome.*`, `runResultPanel.metrics.cache_hit` |
| `docs/KNOWN_ISSUES.md` | изменён | 30 / 6 | KI-113/195/232 → `Fixed` + `Fix (S8)`; сводка 297/277 |
| `docs/CHANGELOG.md` | изменён | 18 / 0 | записи S8 в `[Unreleased]` |
| `docs/development/reports/README.md` | изменён | 1 / 0 | строка отчёта S8 |
| `docs/development/reports/v1.6.0/S8-finops-ux.md` | новый | этот файл | отчёт по RULES § 2.15/2.18 |

## 2. Build / test

| Проверка | Команда | Результат |
|---|---|---|
| Backend typecheck | `pnpm typecheck` | **0 ошибок** |
| Backend build | `pnpm build` | **0 ошибок** |
| Backend tests | `pnpm test` | **2119 passed / 26 skipped** (2145), 138 файлов passed + 4 skipped; было 2096 passed — добавлено 23 теста |
| Backend lint | `pnpm lint` | **0 ошибок**; 2 pre-existing warning в `openai-images.provider.spec.ts` |
| Web typecheck | `pnpm --dir web exec tsc -b` | **0 ошибок** |
| Web build | `pnpm --dir web build` | **успешно** (Vite, 893 мс) |
| Web tests | `pnpm --dir web test` | **587 passed**, 65 файлов; было 577 — добавлено 10 тестов |

Миграции не нужны: S8 не меняет схему БД. `pnpm db:generate` не запускался
намеренно — новых таблиц/колонок/индексов нет.

## 3. Диагностика

### 3.1. Кэш ответов LLM (FinOps)

**Ключ.** `sha256(orgId + modelId + systemPrompt + prompt + optionsJson)`.
Части разделены `\0`, опции сериализуются с сортировкой ключей; `signal`
(объект с внутренним состоянием) и `orgId` (уже в ключе) исключены. Порядок
полей в объекте опций на ключ не влияет.

**Tenant-изоляция.** `orgId` — обязательная часть ключа. Без организации кэш
не используется вообще: глобальный ключ смешал бы ответы разных арендаторов.
Организация протянута из движка: `ExecutionEngineService` резолвит
`rootOrgId` для графов, где есть `llm`/`agent` (раньше — только для
`sub_workflow`), и передаёт его в `LlmNodeExecutor`/`AgentService`. В
`LlmGenerateOptions` поле `orgId` живёт только до роутера: провайдеру оно не
уходит.

**Hit.** Возвращается сохранённый `{ text, usage, isLocal }` с `cached: true`;
роутер и провайдер не вызываются. `LlmNodeExecutor` кладёт `cached: true` в
`outputs` (видно в JSON-панели и по бейджу `data-cache-hit`) и ставит
`costUsd = 0`: повторный вызов не оплачивается. Токены исходного вызова
остаются в метриках для контекста.

**Miss.** Вызов идёт в роутер, успешный результат пишется в Redis
`SET key value EX ttl`. Ошибки не кэшируются.

**Отказоустойчивость.** `LlmResponseCacheService` ловит ошибки Redis на
чтении/записи/удалении, пишет WARN без промпта и продолжает вызов
провайдера. Кэш — оптимизация, а не точка отказа. Битое значение (не JSON
или неверная структура) удаляется, чтобы не выдаваться как ответ LLM.

**Флаг.** `LLM_CACHE_ENABLED=false` по умолчанию: существующие тесты и
поведение не меняются. `LLM_CACHE_TTL_SECONDS=86400` — сутки.

### 3.2. Кэш каталогов моделей (KI-113)

`LlmRegistryService.listModels()` собирал массив на каждый `GET /llm/models`,
а `getCapabilities()` искал модель по массивам провайдеров на каждый
LLM-вызов. Добавлен TTL-кэш 5 минут (`LLM_REGISTRY_CACHE_TTL_MS`) и
`clearCache()`; `resolveByModel` уже был O(1) по `Map`, поэтому отдельный
кэш ему не нужен.

Запись KI-113 в `KNOWN_ISSUES.md` описывает **media**-реестр
(`resolveByModelAsync` перечитывал каталоги на каждый task). Чтобы KI был
закрыт по существу, `MediaRegistryService` тоже получил карту
`modelId → provider` на 5 минут (`MEDIA_REGISTRY_ROUTES_TTL_MS`) и
`clearRoutesCache()`. Тест проверяет, что два резолва читают каталоги один
раз, а сброс кэша заставляет прочитать снова.

### 3.3. Auto-save и индикатор (KI-195)

Дебаунс 3 секунды уже был в `Canvas.tsx` (`useDebouncedEffect`). Изменения S8:

1. Индикатор в `TopBar` теперь три состояния:
   `data-dirty-indicator="dirty"` — «Есть изменения»,
   `"saving"` — «Сохранение...», `"saved"` — «Сохранено».
2. При ошибке автосохранения граф больше не помечается сохранённым: раньше
   `saveWorkflowAsync().then(() => markSaved(hash))` вызывал `markSaved` и
   после reject. Теперь `lastSavedHash` обновляет только успешный
   `saveWorkflowAsync`; при ошибке индикатор остаётся «Есть изменения».
3. Ручной Save меняет `lastSavedHash`, эффект перезапускается и снимает уже
   запланированный таймер — явный комментарий в `Canvas.tsx`.
4. Индикатор больше не скрыт до 1440 px: состояние видно и на узких экранах.

### 3.4. Welcome screen (KI-232)

`WelcomeScreen` рендерится в `Canvas.tsx` поверх холста и сам проверяет
условие: `nodes.length === 0 && currentWorkflowId === null && !hidden`.
Три карточки:

| Карточка | Граф | Пример контента |
|---|---|---|
| Генерация картинки из текста | Text → ImageGen | промпт про кота-космонавта |
| Текст → LLM → Изображение | Text → LLM → ImageGen | промпт для иллюстрации |
| HTTP-запрос с анализом | HTTP → LLM | `https://api.github.com/repos/facebook/react` |

Узлы создаются через `addNode` (те же дефолты моделей и история отмены, что
у ручного добавления), связи — через `onConnect` с явными портами
(`text-output`, `text-input`, `http-output`). «Скрыть» скрывает экран на
сессию; «Больше не показывать» пишет
`workflow-builder.welcome.hidden=1` в `localStorage` и экран не появляется
при следующем монтировании. Ошибки `localStorage` (приватный режим) не
ломают экран.

## 4. Smoke

1. `pnpm test` — 2119 passed / 26 skipped; все новые тесты кэша, реестров,
   автосохранения и welcome-экрана зелёные.
2. `pnpm --dir web test` — 587 passed (65 файлов).
3. `pnpm typecheck` и `pnpm build` — без ошибок; `tsc -b` для web — без
   ошибок; `vite build` — успешно.
4. `pnpm lint` — 0 ошибок (2 pre-existing warning).
5. Реальный Redis/LLM-вызов не выполнялся: в окружении нет запущенного Redis,
   а S8 не требует сетевого смоука. Кэш проверен юнит-тестами с моком Redis.
6. UI-смоук: welcome-экран и индикатор проверены `@testing-library/react` в
   jsdom; визуальные скриншоты не снимались (приложение не запускалось).

## 5. Что не так / отклонения

1. **KI-113 в реестре — про media, а не LLM.** Задание называет
   `LlmRegistryService.resolveByModelAsync`, но в `KNOWN_ISSUES.md` KI-113
   описывает `MediaRegistryService`. Сделаны оба кэша: LLM-каталог (как в
   задании) и media-карта (чтобы KI-113 был закрыт по существу).
2. **`RedisService` в `src/redis/` отсутствовал.** Есть только
   `RedisModule` с токеном `REDIS_TOKEN`; кэш использует его напрямую
   (`ioredis`). Отдельный `RedisService` не заводился, чтобы не плодить
   второй клиент.
3. **`orgId` пришлось протянуть через движок.** Раньше организация
   резолвилась только для `sub_workflow`. Теперь `createSubWorkflowContextAsync`
   делает join и для графов с `llm`/`agent` — иначе ключ кэша был бы без
   tenant'а. Для графов без LLM/agent лишнего запроса нет.
4. **Кэш хранит исходный `usage`.** На хите токены показываются как в первом
   вызове, но `costUsd = 0`. Это компромисс: сохранить информативность
   метрик и не списать деньги повторно. Отдельной колонки `cached` в
   `node_runs` нет — флаг живёт в `outputs` и UI-бейдже.
5. **Ключ кэша не учитывает версию промпта/схемы.** При изменении шаблона
   system-промпта старые записи живут до TTL. Для FinOps это ожидаемо
   (сутки), но при агрессивной инвалидации понадобится версия в ключе.
6. **Кэш выключен по умолчанию.** Это требование задания и способ не менять
   существующие ожидания; в проде его нужно включать осознанно после замера
   hit-rate.
7. **Auto-save уже существовал.** S8 не добавлял сам дебаунс, а довёл
   индикатор до трёх состояний и исправил ложное «Сохранено» после ошибки.
8. **Welcome-шаблоны создаются локально.** `POST /templates/:id/instantiate`
   из KI-109 не используется: в текущем срезе достаточно `addNode` +
   `onConnect`, а новый эндпоинт расширил бы scope.
9. **Агентский кэш — по шагам.** Ключ строится по полному transcript шага,
   поэтому шаги с разными историями не смешиваются; `orgId` передаётся и в
   tool-context (`llm_call`).
10. **Скриншотов нет.** Приложение не запускалось (нет Redis), UI описан
    текстом и покрыт компонентными тестами; для визуального смоука нужен
    `docker compose up` + браузер.
11. **`pnpm --dir web build` обновил `web/dist`.** Каталог игнорируется git,
    в diff не попадает.

## 6. Новые KI

Новые KI **не заводились**, чтобы не менять проверенный счёт 657 без
необходимости. Кандидаты:

1. **Версия в ключе кэша.** При смене system-промпта/модели старые ответы
   живут до TTL; можно добавить `LLM_CACHE_VERSION` в ключ.
2. **Метрики кэша.** Hit-rate, сэкономленные токены/деньги — сейчас только
   debug-лог и `cached` в outputs.
3. **Инвалидация по workflow/пользователю.** Сейчас TTL общий; при
   необходимости — namespace на workflow или ручная очистка.
4. **«Показать подсказки снова».** После «Больше не показывать» нет UI-пути
   вернуть welcome-экран; можно добавить пункт в настройки.
5. **Скриншот-смоук welcome-экрана.** Юнит-тесты проверяют логику, но не
   адаптивную вёрстку на мобильном.

## 7. Итоговое решение

Реализованы четыре фичи:

- **FinOps:** Redis-кэш ответов LLM с tenant-ключом, TTL и флагом `cached`;
  hit не вызывает провайдера и не начисляет стоимость, UI показывает бейдж.
- **Performance:** TTL-кэш каталога LLM (5 минут) и карта media-провайдеров
  (KI-113), `clearCache()`/`clearRoutesCache()` для сброса.
- **Auto-save (KI-195):** индикатор «Есть изменения / Сохранение... /
  Сохранено», ручной Save сбрасывает дебаунс, ошибка не помечает граф
  сохранённым.
- **Welcome screen (KI-232):** три шаблона, создание графа одним кликом,
  «Скрыть» и «Больше не показывать» с `localStorage`.

KI-113, KI-195 и KI-232 переведены в `Fixed` с заметками `Fix (S8)`; сводка
`KNOWN_ISSUES.md`: **657** записей, `Fixed` **297**, `Open` **277**, сумма и
уникальные номера — 657. В `CHANGELOG.md` добавлены записи в `[Unreleased]`.

Проверки: backend **2119 passed / 26 skipped**, web **587 passed**,
`pnpm typecheck`/`pnpm build`/`tsc -b`/`vite build` — без ошибок, `pnpm lint` —
0 ошибок (2 pre-existing warning). Миграции не нужны. Коммит не делался;
изменения остаются в рабочем дереве.

