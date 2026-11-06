---
title: "S1: LLM Router и healthcheck LM Studio (v1.2.0)"
date: 2026-11-06
version: v1.2.0
steps: [S1]
status: accepted
related_ki: [KI-617, KI-618, KI-619, KI-620, KI-621]
related_adr: [0011]
---

# Отчёт S1 — LLM Router + Healthcheck (v1.2.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**125 passed (125 файлов), 1879 passed / 2 skipped (1881)**, `pnpm test:parity` —
**13/13**, `pnpm test:e2e` — **1/1**, `pnpm lint` — **0 errors / 2 warnings**
(оба преэкзистующие, `openai-images.provider.spec.ts`). Смоук на живом
приложении — **18/18**: mock LM Studio обслуживает вызов, при 500 и при
ECONNREFUSED роутер уходит в mock облака, WARN без промпта.

**Точка старта.** На входе — HEAD `6a11aeb` («docs: add GPU inference backend
pattern»), CI зелёный. Во время сессии параллельно появились docs-коммиты
`09fa861` (удаление дублей KI-614..616) и `7956b7a` (DESIGN v1.2), поэтому
работа велась поверх `7956b7a`. Источник — DESIGN V120 § 3.1–3.2, правила —
`docs/development/RULES.md` v1.10.0.

**Сделано:** `ILlmProvider.isAvailableAsync()`; `LmStudioProvider` с пингом
`GET /v1/models`; `LlmRouterService` (LM Studio → облачный fallback,
`LLM_ROUTER_ENABLED`, `LLM_ROUTER_FALLBACK_MODEL`); `LlmHealthService`
(30 с, 3 неудачи → `unavailable`, `setInterval().unref()`); `LlmService`
делегирует роутеру; семафоры и span `llm.call` перенесены в роутер.
**Новые KI:** KI-617..621 (§ 6).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/llm/llm-router.service.ts](../../../../src/llm/llm-router.service.ts) *(new)* | 430 | Роутер: локальный LM Studio → облачный fallback, env, семафоры, span `llm.call`, таймаут на попытку |
| [src/llm/llm-health.service.ts](../../../../src/llm/llm-health.service.ts) *(new)* | 230 | Периодический пинг LM Studio (30 с), 3 неудачи → `unavailable`, `unref`, `OnModuleInit/Destroy` |
| [src/llm/providers/lmstudio.provider.ts](../../../../src/llm/providers/lmstudio.provider.ts) *(new)* | 58 | `LmStudioProvider extends OpenAiCompatibleProvider` — только `isAvailableAsync` (пинг `/models`) |
| [src/llm/llm-router.service.spec.ts](../../../../src/llm/llm-router.service.spec.ts) *(new)* | 377 | 12 тестов: выключатель, GPU, fallback по ошибке/health, модель, signal, повтор |
| [src/llm/llm-health.service.spec.ts](../../../../src/llm/llm-health.service.spec.ts) *(new)* | 222 | 10 тестов: порог 3, сброс, кэш статуса, параллельные пинги, таймер start/stop |
| [src/llm/providers/lmstudio.provider.spec.ts](../../../../src/llm/providers/lmstudio.provider.spec.ts) *(new)* | 92 | 4 теста: 2xx/не-2xx/сеть/слэш в baseURL |
| Этот отчёт *(new)* | — | 7 разделов по RULES 2.15/2.18 |

**Итого нового production-кода:** 718 строк (3 файла).
**Итого новых тестов:** 691 строка (3 файла).

Артефакты смоука (gitignored, `.smoke/`): `v120-s1-mocks.mjs` — 171 строка,
`v120-s1-llm-router-smoke.mjs` — 366, `.json` — 154, backend-лог — 134.

### 1.2 Изменённые файлы — production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/llm/llm-provider.interface.ts](../../../../src/llm/llm-provider.interface.ts) | +24/−3 | `isAvailableAsync()` в контракте; JSDoc `isLocal` теперь про роутер |
| [src/llm/providers/openai-compatible.provider.ts](../../../../src/llm/providers/openai-compatible.provider.ts) | +22/−0 | `protected baseURL`; `isAvailableAsync() → true` у облака |
| [src/llm/providers/anthropic.provider.ts](../../../../src/llm/providers/anthropic.provider.ts) | +14/−0 | `isAvailableAsync() → true` |
| [src/llm/llm-provider.factory.ts](../../../../src/llm/llm-provider.factory.ts) | +3/−2 | LM Studio создаётся как `LmStudioProvider` |
| [src/llm/llm-registry.service.ts](../../../../src/llm/llm-registry.service.ts) | +32/−0 | `findLocalProvider()` / `findCloudProvider()` |
| [src/llm/llm.module.ts](../../../../src/llm/llm.module.ts) | +7/−0 | Провайдеры `LlmHealthService`, `LlmRouterService` |
| [src/llm/llm.service.ts](../../../../src/llm/llm.service.ts) | +20/−74 | Тонкая обёртка: вызов делегируется роутеру; семафоры/span ушли туда |
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +40/−0 | `LlmRouterEnvSchema` (`LLM_ROUTER_ENABLED` строго, `LLM_ROUTER_FALLBACK_MODEL`) |

**Итого по production:** **+162 / −79** (без нового кода).

### 1.3 Изменённые файлы — тесты

| Файл | +/− | Что |
|---|---:|---|
| [src/llm/llm.service.spec.ts](../../../../src/llm/llm.service.spec.ts) | +48/−78 | Мок роутера вместо провайдера; `isLocal` от роутера; model не переопределяется |
| [src/llm/llm-registry.service.spec.ts](../../../../src/llm/llm-registry.service.spec.ts) | +2/−0 | `isAvailableAsync` в заглушке контракта |
| [src/llm/providers/openai-compatible.provider.spec.ts](../../../../src/llm/providers/openai-compatible.provider.spec.ts) | +9/−0 | Облачный `isAvailableAsync` не делает fetch |
| [src/config/env.schema.spec.ts](../../../../src/config/env.schema.spec.ts) | +40/−0 | Дефолты, строгий boolean, пустая fallback-модель |

**Итого по тестам:** **+790 / −78** (включая 691 строку новых спеков).

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +17/−0 | `[Unreleased] → Added`: S1, ссылка на отчёт, ограничения KI-617..621 |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +105/−1 | Новые KI-617..621; восстановлена сводка (608 записей) |
| [docs/development/adr/0011-llm-router-layer.md](../../adr/0011-llm-router-layer.md) *(new)* | 85 | ADR-0011: роутер как единственный слой маршрута/таймаута/healthcheck |
| [.env.example](../../../../.env.example) | +12/−0 | Секция LLM Router: `LLM_ROUTER_ENABLED`, `LLM_ROUTER_FALLBACK_MODEL` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | Строка v1.2.0 S1 |
| Этот отчёт *(new)* | — | 7 разделов |

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **125 passed (125 файлов), 1879 passed / 2 skipped (1881)**, 41.9 с |
| `pnpm test:parity` | **13/13** |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule`) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |
| Смоук (живое приложение) | **18/18 PASS**, 0 FAIL |

Прирост к HEAD (S5, 122 файла / 1848 passed): root **+3 файла, +31 тест**
(1848→1879; 122→125). Раскладка: router +12, health +10, lmstudio +4,
llm.service +1, env +3, openai-compatible +1. Скипнутые 2 теста — прежние
`openai-images.integration` (нет ключа Images, `skipIf`). Миграций нет:
фича чисто серверная и in-memory.

---

## 3. Диагностика

### 3.1 Главная находка: общий `AbortSignal` ломал fallback после таймаута

До S1 `LlmService.generateAsync` сам ставил `signal: AbortSignal.timeout(60_000)`
и передавал его провайдеру. Если бы роутер просто переиспользовал этот
`options.signal` для второй попытки, таймаут LM Studio (60 с) отменял бы и
облачный вызов: fallback стартовал бы с уже `aborted` signal и падал мгновенно.
Пользователь видел бы ошибку «AbortError» вместо ответа облака — ровно в том
сценарии, ради которого роутер и делается.

Решение: **таймаут ставится на каждую попытку** в `LlmRouterService.callAsync`
(`options.signal ?? AbortSignal.timeout(60_000)`), а `LlmService` больше не
создаёт signal. Явный signal вызывающего кода (отмена) остаётся общим для обеих
попыток; если local упал при `options.signal.aborted === true`, fallback **не**
делается — это отмена пользователя, а не технический сбой. Тест
`«таймаут создаётся на каждую попытку»` фиксирует, что signal'ы разные и второй
не отменён.

### 3.2 Почему healthcheck кэширует статус, а не пингует на каждый вызов

Пинг `GET /v1/models` на каждый LLM-вызов — это +1 HTTP round-trip к
локальному серверу перед каждым платным/бесплатным вызовом, причём
последовательный (latency складывается). Поэтому `LlmHealthService` держит
`status: unknown | available | unavailable`:

- `available` — доверяем последней проверке (следующая ≤30 с);
- `unavailable` — не дёргаем сервер до следующего тика;
- `unknown` — проверяем по факту (старт, первые 1–2 неудачи).

При `unknown` параллельные запросы не порождают N пингов: `probeInFlight`
склеивает их в один (`Promise` переиспользуется). Тест
`«параллельные isAvailableAsync дают один пинг»` это проверяет.

### 3.3 Почему семафоры и span переехали в роутер

До S1 `LlmService` резолвил провайдера и оборачивал **его** вызов в
`ProviderSemaphoreRegistry` и span `llm.call`. После появления fallback
«провайдер» перестал быть известен до вызова: при ошибке LM Studio фактическим
провайдером становится облако. Если оставить семафор в `LlmService` на
исходном провайдере, лимит LM Studio применялся бы к облачному вызову, а лимит
облака не применялся бы вовсе. Поэтому роутер сам берёт слот
`this.semaphores.runAsync(provider.name, …)` для **фактически** используемого
провайдера и сам создаёт span `llm.call`, охватывающий обе попытки. Атрибуты
`llm.provider`, `llm.local`, `llm.wait_ms`, токены проставляются после успеха;
добавлен `llm.model_used` (видно подмену модели).

### 3.4 Почему `LmStudioProvider` — наследник, а не отдельная реализация

В проекте LM Studio технически не отдельный протокол: это
`OpenAiCompatibleProvider` с `isLocal: true` (v0.5.0). Дублировать
`generateAsync`/`embedAsync`/разбор ошибок ради одного пинга — лишний код и
риск расхождения. Наследник переопределяет только `isAvailableAsync`, а базовый
класс отдаёт `true` для облака. Поле `baseURL` стало `protected` — наследнику
нужен адрес для `GET /models`. Фабрика теперь создаёт `LmStudioProvider`;
`instanceof OpenAiCompatibleProvider` в существующих тестах продолжает работать.

### 3.5 Как выбирается локальная модель

Если в графе/агенте выбран id, который LM Studio объявил, — он и уходит
(тест «модель не подменяется»). Если нет (`gpt-4o-mini`, `claude-*` в LM
Studio отсутствуют), берётся **первая** модель локального каталога: отправка
облачного id гарантированно вернула бы 400/404. Подмена логируется на уровне
`debug`, а не `warn`, чтобы не спамить на каждый вызов. Это осознанный
компромисс и одновременно ограничение — KI-617.

### 3.6 Почему fallback-модель резолвится в таком порядке

`LLM_ROUTER_FALLBACK_MODEL` — операторская настройка, но env-схема не видит
реестр провайдеров (он собирается позже, из ключей). Поэтому порядок:
1. если fallback-модель объявлена **облачным** провайдером — используем её;
2. иначе — первая модель первого облачного провайдера + WARN;
3. иначе — `LlmProviderException`: облака нет, fallback невозможен.

Локальный провайдер для fallback не выбирается даже если объявил эту модель:
мы как раз уходим с локального. Ограничение «модель могла подмениться»
зафиксировано в KI-619.

### 3.7 Строгий разбор boolean

`LLM_ROUTER_ENABLED` разбирается как `union([boolean, enum(['true','false'])])`
с `transform` (RULES 4.35): `z.coerce.boolean()` превратил бы строку `'false'`
в `true` и включил роутинг «сам». Пустая строка — «не задано» → `false`
(KI-084). В `LlmRouterService` тот же принцип продублирован на случай
`ConfigService` без `validateEnv` (юнит-тесты): принимаются только boolean,
`'true'` и `'false'`, остальное → default.

### 3.8 Реестр KI: сводка потерялась в параллельном docs-коммите

На HEAD после `09fa861` в `docs/KNOWN_ISSUES.md` было **603** записи и 603
строки статуса, но блока «Сводка по статусам» не было — после docs-коммита он
отсутствовал. Пересчёт grep'ом дал фактическое распределение Fixed 263,
Open 282, Documented 42 — оно отличается от прежней сводки 260/285/42.
Сводка восстановлена по факту (RULES 3.20), затем добавлены KI-617..621:
итог **608** записей. Это не «наши» 3 перемещённых статуса — они уже были в
файле до S1; сводка была устаревшей.

### 3.9 Мок LM Studio и `closeAllConnections()`

Чтобы сэмулировать **выключенный** сервер (ECONNREFUSED), недостаточно
`server.close()`: Node/undici переиспользует keep-alive сокет, и следующий
`fetch` может уйти в уже открытое соединение. Поэтому мок после ответа на
`/__lm/close` вызывает `server.closeAllConnections?.()`. Без этого третий
сценарий смоука мог бы «успешно» дойти до закрытого сервера и не проверить
сетевой fallback.

### 3.10 Почему healthcheck запускается всегда

`LlmHealthService.onModuleInit` стартует независимо от
`LLM_ROUTER_ENABLED`: статус нужен будущему UI-индикатору (DESIGN § 3.4), а
`findLocalProvider()` возвращает `undefined` без LM Studio — тогда пингов нет
вовсе. При настроенном, но выключенном роутере это один `GET /models` в 30 с;
осознанная цена за готовый индикатор (см. § 5, п. 7).

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder` (миграции
применены), Redis `127.0.0.1:6379`, backend — `node dist/main.js` на **3100**
(3000 занят сторонним контейнером), mock LM Studio — `127.0.0.1:3098`,
mock облака — `127.0.0.1:3099`. Env смоука: `LLM_ROUTER_ENABLED=true`,
`LLM_ROUTER_FALLBACK_MODEL=gpt-4o-mini`,
`LMSTUDIO_BASE_URL=http://127.0.0.1:3098/v1`,
`LMSTUDIO_MODELS=mock-local-model`, `OPENAI_BASE_URL=http://127.0.0.1:3099/v1`.
Скрипт `.smoke/v120-s1-llm-router-smoke.mjs`; итог **18/18 PASS, 0 FAIL**,
`generatedAt = 2026-11-05T23:55:39.431Z`.

### 4.1 Каталог и healthcheck

| Проверка | Факт |
|---|---|
| `GET /llm/models` | 200, 19 моделей, включая `lmstudio:mock-local-model` и `openai:gpt-4o-mini` |
| Пинги `/v1/models` | 2: один при сборке провайдеров, один — healthcheck при старте |
| Healthcheck в работе | `lmModels` растёт и после старта (интервал 30 с) |

### 4.2 GPU доступен

| Проверка | Факт |
|---|---|
| run #1 (`gpt-4o-mini`) | `completed` |
| outputs LLM-узла | `local answer` |
| chat-запросы LM Studio | 1 |
| chat-запросы облака | 0 |
| Модель в запросе | `mock-local-model` (выбранная `gpt-4o-mini` локально не объявлена → первая локальная) |

### 4.3 LM Studio отвечает 500

| Проверка | Факт |
|---|---|
| run #2 | `completed` |
| outputs LLM-узла | `cloud answer` |
| chat-запросы LM Studio | +1 (неудачный) |
| chat-запросы облака | +1 (fallback) |
| WARN в логе | `LM Studio: вызов модели "mock-local-model" не удался ([lmstudio] 500 mock LM Studio chat-error) — fallback на облачную модель "gpt-4o-mini"` |

### 4.4 LM Studio выключен (ECONNREFUSED)

| Проверка | Факт |
|---|---|
| run #3 | `completed` |
| outputs LLM-узла | `cloud answer` |
| chat-запросы облака | +1 (второй fallback) |
| WARN в логе | `LM Studio: вызов модели "mock-local-model" не удался ([lmstudio] Connection error.) — fallback …` |
| Промпт в логе | отсутствует (RULES 5.9) |

### 4.5 Порог healthcheck на живом процессе

После закрытия mock LM Studio healthcheck продолжил пинговать сервер и на
третьей неудаче (штатный 30-секундный интервал) записал:

```
[Nest] 22596  - 06.11.2026, 02:56:59   WARN [LlmHealthService]
LM Studio недоступен 3 проверки подряд — локальный провайдер исключён из
роутинга до восстановления
```

Это подтверждает, что `setInterval` реально тикает, `unref()` не мешает
процессу, а порог 3 работает на живом приложении (юнит-тесты проверяют то же
детерминированно).

### 4.6 Уборка

Организация smoke удалена каскадом (`DELETE FROM organizations`, `rowCount=1`).
Backend и mock-серверы остановлены; порты 3100/3098/3099 освобождены.
Артефакты: `.smoke/v120-s1-llm-router-smoke.json` (154 строки),
`.smoke/v120-s1-backend.log`, `.smoke/v120-s1-mocks.log` — все gitignored.

---

## 5. Что не так

1. **Роутер подменяет модель и не сверяет возможности (KI-617, 🟡 Medium).**
   Выбранная в графе модель игнорируется: локально уходит первая модель
   LM Studio, а fallback — модель из env. `inputModalities`,
   `supportsReasoning`, tool-calling и размер контекста не проверяются:
   vision-узел может уйти в текстовую модель, agent-узел — в модель без
   инструментов; ошибка будет выглядеть как отказ провайдера.
2. **Статус healthcheck не виден снаружи (KI-618, 🟢 Low, Planned).**
   `getStatus()` доступен только внутри процесса; ни `GET /llm/models`, ни
   отдельной ручки нет. UI-индикатор `GPU: online/offline` (DESIGN § 3.4)
   пока сделать нечем — только WARN в логе.
3. **Fallback-модель из env может молча подмениться (KI-619, 🟢 Low).**
   Если `LLM_ROUTER_FALLBACK_MODEL` не объявлена облачным провайдером, роутер
   берёт первую модель первого облака и пишет WARN; вызов уходит в другую
   (возможно, более дорогую) модель, а вызывающий код видит это только по
   `usage.model`. Fail-fast на старте не сделан, потому что реестр собирается
   после env-валидации.
4. **Healthcheck не разделяется между инстансами (KI-620, 🟢 Low).**
   Статус in-memory: N backend-инстансов дают N пингов каждые 30 с и могут
   расходиться (один уже `unavailable`, другой ещё роутит на GPU).
5. **Восстановление LM Studio замечается с задержкой до 30 с (KI-621, 🟢 Low).**
   После `unavailable` статус не пересматривается до следующего тика; после
   сбоя при `available` роутер до тика пытается local и падает в fallback на
   каждом вызове (WARN на каждый вызов).
6. **`LlmService` потерял прямую проверку модели.** Раньше `resolveByModel`
   вызывался в сервисе (ошибка «Модель не поддерживается» до семафора); теперь
   это делает роутер. Поведение и текст ошибки те же, но стек вызовов стал на
   один кадр глубже — в отчётах об ошибках это видно.
7. **При `LLM_ROUTER_ENABLED=false` healthcheck всё равно пингует LM Studio**
   (если он настроен) — раз в 30 с. Это цена готовности UI-индикатора; при
   выключенной фиче запросы всё равно уходят. Если это станет проблемой,
   healthcheck можно включать только при `LLM_ROUTER_ENABLED=true` или при
   запросе статуса.
8. **Смоук-сценарии ограничены.** Живой прогон проверяет успех, 500 и
   ECONNREFUSED; сценарий «3 неудачи → unavailable → следующий run не трогает
   local» проверен юнит-тестами и логом healthcheck, но не отдельным run'ом
   после порога (это потребовало бы ждать до 90 с либо управляемого интервала).
9. **Параллельный docs-коммит удалил сводку KI.** На HEAD `09fa861` блок
   «Сводка по статусам» отсутствовал, фактическое распределение отличалось от
   прежней сводки (Fixed 263/Open 282 вместо 260/285). Сводка восстановлена по
   grep (RULES 3.20), итог 608; это факт про репозиторий, а не про S1-код.
10. **`pnpm lint` — 2 преэкзистующих warning'а** в
    `openai-images.provider.spec.ts` (чужие файлы); массовое переформатирование
    не делали.
11. **В корне репозитория появились untracked-файлы `819`, `831`, `896`**
    (5–6 байт, содержимое — числа), timestamp 02:39:17 — одновременно с
    docs-коммитом `09fa861`; к S1 они отношения не имеют и не удалялись, чтобы
    не вмешиваться в параллельный процесс. `git status` их показывает.
12. **Полного integration-теста «роутер + BullMQ + реальный провайдер» в
    `pnpm test` нет.** Роутер покрыт юнит-тестами, сквозной путь проверен
    смоуком на mock'ах; для CI без живого LM Studio это осознанно.
13. **`LLM_ROUTER_ENABLED` и fallback-модель не задокументированы в README.**
    Они добавлены в `.env.example`; README описывает провайдеров, но не
    перечисляет env-переменные — обновление README не требовалось (RULES 2.3).
14. **Путь репозитория в постановке (`C:\Projects\AI\ai-workflow-builder`) не
    существует.** Работа велась в фактическом checkout
    `D:\Projects\AI\workflow-builder` (он же cwd сессии); все пути в отчёте —
    от него.

---

## 6. Новые KI

Всего **5**: KI-617..621. Реестр пересчитан grep'ом (RULES 3.20): **608**
записей `### KI-`, 608 строк статуса, номера уникальны. На входе было 603/603;
прежняя сводка (260 Fixed / 285 Open) отсутствовала и не совпадала с фактом —
восстановлена (Fixed 263 / Open 282 / Documented 42), затем добавлены новые.

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-617](../../../KNOWN_ISSUES.md) | 🟡 Medium | Open | Роутер подменяет выбранную модель и не сверяет модальности/reasoning/tools |
| [KI-618](../../../KNOWN_ISSUES.md) | 🟢 Low | Planned | Статус healthcheck не отдаётся API/UI (индикатор — v1.2 S3) |
| [KI-619](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Fallback-модель из env может подмениться первой моделью облака |
| [KI-620](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Healthcheck не разделяется между backend-инстансами |
| [KI-621](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Восстановление LM Studio замечается с задержкой до 30 с |

Сводка: **Fixed 263 + Fixed (частично) 6 + Open 283 + Documented 45 +
Documented (не воспроизводится) 1 + Planned 4 + Deferred 2 + Won't Fix 4 =
608**. Обновлены `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`,
`.env.example`, `docs/development/reports/README.md`; добавлен ADR-0011.

---

## 7. Обоснование решений

### 7.1 Почему роутер, а не ветвление внутри `LlmService`

`LlmService` — публичный фасад для executor'ов и агента; если бы fallback жил
там, сервис одновременно отвечал бы за резолв провайдера, семафоры, tracing,
таймауты и маршрутизацию. Вынесение в `LlmRouterService` даёт одну точку
принятия решения и позволяет тестировать маршрут без Nest-контекста
executor'ов. `LlmService` остался тонкой обёрткой — его API не изменился, все
вызовы (`llm-node-executor`, `agent.service`) продолжили работать без правок.

### 7.2 Почему таймаут на попытку, а не на маршрут

Таймаут на весь маршрут означал бы, что при медленном LM Studio (60 с) у
облака не остаётся бюджета времени, а общий `AbortSignal` после срабатывания
таймаута отменяет и fallback. Таймаут на попытку даёт каждому провайдеру
полные 60 с (RULES 4.19), а отмена пользователя по-прежнему общая: если
`options.signal` уже `aborted`, роутер не делает fallback. Цена — потенциально
до 120 с на один LLM-вызов при двух таймаутах; это меньше lock'а BullMQ
(5 мин) и осознанно.

### 7.3 Почему 3 неудачи, а не 1

Одиночный таймаут при загрузке модели в память или коротком зависании
LM Studio не должен выключать GPU-бэкенд. Три подряд (при пинге раз в 30 с)
дают запас ~90 с: короткий сбой переживаем, устойчивая недоступность
фиксируется. Успешная проверка сбрасывает счётчик и возвращает провайдера в
роутинг — обратного «ручного включения» не нужно.

### 7.4 Почему статус healthcheck — in-memory, а не в Redis

Healthcheck отвечает на вопрос «доступен ли LM Studio **из этого процесса**».
При одном инстансе (текущая схема) Redis дал бы лишнюю зависимость и окно
устаревания. Для нескольких инстансов это ограничение зафиксировано в KI-620:
там же предложен общий статус с TTL/лидером. Вводить Redis сейчас — значит
добавить ещё один отказ (Redis) в путь, который должен работать и без него.

### 7.5 Почему `findLocalProvider()` ищет по `isLocal`, а не по имени `lmstudio`

Флаг `isLocal` — уже существующий контракт провайдера (KI-148): он же
определяет стоимость `0`. Роутер, healthcheck и расчёт стоимости используют
один признак, поэтому будущий локальный бэкенд (не LM Studio) подхватится без
правок. Поиск по имени `'lmstudio'` был бы хардкодом и разошёлся бы с
фабрикой.

### 7.6 Почему fallback идёт в `LLM_ROUTER_FALLBACK_MODEL`, а не в модель из графа

Постановка S1 требует именно env-модель fallback. Плюс: оператор управляет
ценой/качеством резерва централизованно, независимо от того, какие модели
выбраны в десятках графов. Минус — выбранная пользователем модель теряется
(часть KI-617). Если fallback-модель не объявлена, роутер не падает сразу, а
берёт первую модель первого облака с WARN: при живом облаке это лучше, чем
отказ узла; при отсутствии облака — честная `LlmProviderException`.

### 7.7 Почему healthcheck не зависит от `LLM_ROUTER_ENABLED`

Флаг выключает **маршрутизацию**, а не наблюдаемость. DESIGN § 3.4 требует
индикатор GPU в UI; если healthcheck стартует только с роутером, индикатор
будет пустым при выключенной фиче. Пинг появляется только когда LM Studio
настроен (`findLocalProvider()`), и стоит один `GET /models` в 30 с. Это
осознанный компромисс, зафиксированный в § 5, п. 7.

### 7.8 Почему WARN только на ошибке вызова, а недоступность — `debug`

Если LM Studio выключен, роутер пропускает local по статусу health'а и пишет
`debug`, а healthcheck — один WARN при переходе в `unavailable`. Иначе при
каждом LLM-вызове в лог уходил бы WARN, и шум скрыл бы реальные ошибки. WARN
на ошибке локального **вызова** остаётся: это событие, которое случилось
только что и требует внимания.

### 7.9 Почему тесты используют моки, а не реальный LM Studio

CI не имеет GPU/LM Studio; юнит-тесты должны быть детерминированными.
`LlmRouterService` тестируется на заглушках `ILlmProvider` (12 тестов),
`LlmHealthService` — на управляемом `isAvailableAsync` (10), провайдер — на
подменённом `fetch` (4). Реальный HTTP-путь проверяет смоук с mock LM Studio;
настоящий LM Studio в этой сессии недоступен, поэтому smoke использует mock.

### 7.10 Почему отчёт выводится целиком

RULES 2.15/2.18: краткий отчёт скрывает детали. В S1 важны и компромисс с
подменой модели (KI-617), и найденный баг с общим `AbortSignal`, и состояние
реестра KI после параллельного docs-коммита. Полный отчёт сохранён в
`docs/development/reports/v1.2.0/S1-llm-router.md` и выведен в чат целиком.
