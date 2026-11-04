---
title: "S4: Метрики — официальный клиент, status, llm_call, process и Grafana (v1.1.0)"
date: 2026-11-04
version: v1.1.0
steps: [S4]
status: accepted
related_ki: [KI-574, KI-576, KI-577, KI-581, KI-582, KI-609, KI-610, KI-611, KI-612, KI-613]
related_adr: [0009]
---

# Отчёт S4 — Metrics Improvement (v1.1.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` (с `DATABASE_URL`) —
**122 passed (122 файла), 1837 passed / 2 skipped (1839)**, `pnpm test:parity` —
**13/13**, `pnpm test:e2e` — **1/1**, `pnpm --dir web build` — exit 0,
`pnpm --dir web test` — **54 passed (54 файла), 493 passed**, `pnpm lint` —
**0 errors / 2 warnings** (оба преэкзистующие,
`openai-images.provider.spec.ts`). Смоук на живом приложении — **18/18**:
реальный agent-run через mock OpenAI, живой `GET /metrics` с `nodejs_`/`process_`/
`llm_call_`, `status="success"` и `status="error"`, JSON дашборда и
scrape-config, чистая БД.

**Точка старта.** HEAD `8a2c571` («feat(v1.1.0): S3 — Audit Filters & Security
Fix»), CI зелёный. Источник — `docs/development/v1.1/DESIGN_V110_FEATURES.md`
§ 3.4, KI-574/576/577/581/582, правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** `prom-client` заменён на `@prometheus-io/client@0.16.1`;
`agent_step_duration_seconds` получила `status` (`success`/`error`) и
`AgentService` пишет ошибки LLM; добавлена
`llm_call_duration_seconds{model,status}`; включены `collectDefaultMetrics`;
`LlmRegistryService.hasModel` ограничивает кардинальность `model`; добавлены
`infra/prometheus/prometheus.yml` и `infra/grafana/dashboard.json` (3 панели).
**Закрыто KI:** KI-574, KI-576, KI-577; KI-581/582 — частично.
**Новые KI:** KI-609..613 (§ 6). ADR-0009. Смоук 18/18.

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [infra/prometheus/prometheus.yml](../../../../infra/prometheus/prometheus.yml) *(new)* | 25 | Scrape-job `workflow-builder`: `/metrics`, `localhost:3000`, интервал 15 с, external labels |
| [infra/grafana/dashboard.json](../../../../infra/grafana/dashboard.json) *(new)* | 341 | Дашборд Grafana: HTTP latency p95, Run duration p95 по типам узлов, Agent errors (`status="error"` для `agent_step` и `llm_call`) |
| [docs/development/adr/0009-metrics-v110-s4.md](../../adr/0009-metrics-v110-s4.md) *(new)* | 84 | ADR-0009: официальный клиент, status-label, llm_call, кардинальность, process-метрики, последствия |
| Этот отчёт *(new)* | — | 7 разделов по RULES 2.15/2.18 |

**Итого нового кода/конфигов:** 366 строк (dashboard 341 + prometheus 25).
Артефакты смоука (gitignored, `.smoke/`): `v110-s4-metrics-smoke.mjs` — 407
строк, `v110-s4-mock-llm.mjs` — 116, `v110-s4-metrics-smoke.json` — 108,
`v110-s4-backend.log`.

### 1.2 Изменённые файлы — production-код

| Файл | +/− | Что |
|---|---:|---|
| [src/metrics/metrics.service.ts](../../../../src/metrics/metrics.service.ts) | +102/−17 | `@prometheus-io/client`; `status` в `agent_step_duration_seconds`; `llm_call_duration_seconds`; `collectDefaultMetrics`; методы `observeAgentStep(model,status,…)`/`observeLlmCall`; обновлён JSDoc контракта |
| [src/agent/agent.service.ts](../../../../src/agent/agent.service.ts) | +118/−15 | try/catch вокруг LLM-вызова (`success`/`error`), `llm_call` в `executeToolAsync`, `readLlmCallModel`, `metricModelLabel`/`recordLlmCallMetric`, санитизация model-label |
| [src/llm/llm-registry.service.ts](../../../../src/llm/llm-registry.service.ts) | +19/−0 | `hasModel(modelId)` — проверка id без исключения (для label кардинальности) |
| [src/metrics/metrics.controller.ts](../../../../src/metrics/metrics.controller.ts) | +1/−1 | JSDoc: реестр `@prometheus-io/client` вместо `prom-client` |
| [package.json](../../../../package.json) | +1/−1 | `prom-client` → `@prometheus-io/client@^0.16.1` |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | +12/−13 | Lockfile после замены зависимости (3 пакета) |

**Итого по production:** **+253 / −47** (включая dependency/lockfile).

### 1.3 Изменённые файлы — тесты

| Файл | +/− | Что |
|---|---:|---|
| [src/metrics/metrics.service.spec.ts](../../../../src/metrics/metrics.service.spec.ts) | +80/−20 | 10 тестов: 5 доменных метрик, `process_*`/`nodejs_*`, отсутствие дублей HELP, `model/status` у agent и llm_call, изоляция реестров |
| [src/agent/agent.service.spec.ts](../../../../src/agent/agent.service.spec.ts) | +149/−11 | `status=success/error` шага, 3 теста `llm_call` (success, error без падения цикла, `unknown`-модель), мок `hasModel`/`observeLlmCall` |
| [src/llm/llm-registry.service.spec.ts](../../../../src/llm/llm-registry.service.spec.ts) | +11/−0 | `hasModel` для известных/неизвестных/пустых id без исключения |
| [src/agent/agent.integration.spec.ts](../../../../src/agent/agent.integration.spec.ts) | +3/−1 | Мок реестра получил `hasModel` (иначе реальный `AgentService` падал — см. § 3.9) |

**Итого по тестам:** **+243 / −32**.

### 1.4 Документация

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +52/−0 | `[Unreleased]`: Added (S4-метрики и инфра), Changed (миграция клиента), Fixed (KI-574/576/577, частично 581/582), Documented (KI-609..613) |
| [docs/KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) | +127/−40 | KI-574/576/577 → Fixed (S4), KI-581/582 → Fixed (частично), раздел S4 (KI-609..613), удалены 4 дубля KI-605..608, сводка 600 |
| [README.md](../../../../README.md) | +8/−0 | Раздел «Метрики и наблюдаемость»: 5 доменных метрик, `process_*`/`nodejs_*`, ссылки на `infra/` |
| [docs/development/reports/README.md](../README.md) | +1/−0 | Строка S4 в реестре отчётов |
| [docs/development/adr/0009-metrics-v110-s4.md](../../adr/0009-metrics-v110-s4.md) *(new)* | 84 | ADR-0009 |
| этот отчёт *(new)* | — | 7 разделов |

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (с `DATABASE_URL`) | **122 passed (122 файла), 1837 passed / 2 skipped (1839)**, 30.9 с |
| `pnpm test:parity` | **13/13** (схема БД не менялась) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule`) |
| `pnpm --dir web build` | **exit 0** (`tsc -b` + `vite build`) |
| `pnpm --dir web test` | **54 passed (54 файла), 493 passed**, 40.8 с |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |
| Смоук (живое приложение) | **18/18 PASS**, 0 FAIL |

Прирост к HEAD (S3): root **+5 тестов** (1832→1837 passed, файлов 122→122:
+1 metrics, +3 agent, +1 registry); web не менялся (493, 54 файла). Миграций
БД нет: S4 меняет только метрики/зависимости/инфраструктуру.

---

## 3. Диагностика

### 3.1 Совместимость API `@prometheus-io/client@0.16.1`

Перед заменой импортов прочитаны `node_modules/@prometheus-io/client/index.d.ts`
и `index.js`: экспортируются те же `Registry`, `Histogram`, `Counter`,
`Summary`, `Gauge`, `collectDefaultMetrics`, `register`, `contentType`.
Конфигурация `collectDefaultMetrics` принимает `register` (единственное число)
и `prefix`; конструкторы гистограмм/счётчиков — `name`/`help`/`labelNames`/
`buckets`/`registers`. `Registry.contentType` по умолчанию —
`text/plain; version=0.0.4; charset=utf-8` (проверено unit-тестом и живым
запросом к `/metrics`). Поэтому правка `metrics.service.ts` свелась к замене
импорта и
добавлению новых метрик; формат экспозиции для Prometheus не изменился.

### 3.2 `status` в шаге агента: что именно обёрнуто в try/catch

В `runAgentAsync` замеряется только вызов `this.llm.generateAsync(...)`.
`try/catch` стоит вокруг него, а не вокруг всей итерации: иначе ошибка
инструмента, парсинга ответа или бюджет-гарда тоже попала бы в
`agent_step_duration_seconds{status="error"}`, хотя это не ошибка LLM-шага.
При ошибке метрика пишется с `status="error"` и ошибка **пробрасывается**
дальше в существующий retry-guard (`guardRunError`), поэтому поведение
ретраев не изменилось. Успешный шаг пишется с `status="success"` до обработки
ответа — длительность отражает именно вызов модели.

### 3.3 `llm_call`: почему инструментация в `executeToolAsync`

`llm_call` — инструмент, который вызывает модель внутри tool-шага. Метрику
нужно атрибутировать агенту/инструменту, а не всем LLM-вызовам процесса
(последние уже покрыты спанами `llm.call` и стоимостью). Поэтому замер стоит в
`AgentService.executeToolAsync`: он знает имя инструмента, его аргументы и
модель агента. `readLlmCallModel` берёт `input.model` (если задана) либо
`context.model`; `executeToolAsync` ловит ошибку инструмента и возвращает её
модели как текст, поэтому `status="error"` пишется, но цикл не падает — это
ожидаемая семантика (`llm_call` не роняет запуск). Длительность включает
сам вызов модели и разбор результата инструментом; это то, что видит
пользователь tool-шага.

### 3.4 Кардинальность `model`: почему `hasModel`

`model` — label гистограмм, а значение приходит из двух недоверенных
источников: `node.model` (пользовательский граф) и `input.model` инструмента
`llm_call` (строка, которую сформировала модель). Без проверки каждый
«выдуманный» id создавал бы новую серию Prometheus — классический путь к
взрыву кардинальности и падению scrape. Добавлен
`LlmRegistryService.hasModel(modelId)` (проверка по `Map` без исключения) и
`metricModelLabel`: известный id сохраняется, неизвестный превращается в
`unknown` (одна серия на все неподдерживаемые). Это применено и к шагу агента
(раньше `node.model` уходил в label как есть), и к `llm_call`. Тесты:
`llm-registry.service.spec.ts` и `agent.service.spec.ts` (ghost-model →
`unknown`).

### 3.5 Process-метрики: тот же реестр, без префикса

`collectDefaultMetrics({ register: this.registry })` вызывается в конструкторе.
Метрики получают имена `process_cpu_user_seconds_total`,
`process_resident_memory_bytes`, `nodejs_eventloop_lag_seconds`,
`nodejs_heap_size_used_bytes`, `nodejs_gc_duration_seconds` и т. д.
Собственные метрики — `http_*`, `run_*`, `agent_*`, `llm_call_*`; пересечений
нет, поэтому `prefix` не задаётся (иначе пришлось бы менять имена доменных или
получать `workflow_builder_process_*`). Коллекторы ленивые: значения
собираются при `registry.metrics()`, то есть на `GET /metrics`. Тест проверяет
наличие `process_*`/`nodejs_*`, пять доменных семейств и отсутствие дублей
`# HELP` (дубль имени дал бы ошибку регистрации, но проверяется и вывод).

### 3.6 Grafana и Prometheus: что именно в файлах

`infra/grafana/dashboard.json` — валидный Grafana 10+ dashboard
(`schemaVersion: 39`, uid `workflow-builder-overview`, datasource-переменная
`DS_PROMETHEUS`). Три панели:
1. **HTTP latency (p95)** —
   `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))`;
2. **Run duration (p95, by node type)** —
   `histogram_quantile(0.95, sum by (le, node_type) (rate(run_execution_duration_seconds_bucket[5m])))`;
3. **Agent errors (status=error)** — два target'а:
   `sum by (model) (rate(agent_step_duration_seconds_count{status="error"}[5m]))`
   и `sum by (model) (rate(llm_call_duration_seconds_count{status="error"}[5m]))`.

`infra/prometheus/prometheus.yml` — `scrape_interval: 15s`, job
`workflow-builder`, `metrics_path: /metrics`, target `localhost:3000`,
`env: local`. Файлы проверяются смоуком (JSON парсится, панели и target
сверяются); в CI отдельного рендер-теста нет (KI-610).

### 3.7 Смоук: mock OpenAI + реальный движок, а не подмена сервиса

Чтобы `llm_call_duration_seconds` появилась в экспозиции **живого** приложения,
а не только в unit-тесте, поднят mock OpenAI-совместимый сервер
(`.smoke/v110-s4-mock-llm.mjs`, порт 3099). Backend запущен с
`OPENAI_BASE_URL=http://127.0.0.1:3099/v1` и `OPENAI_API_KEY=smoke-live-key`
(порт 3100, потому что 3000 занят сторонним контейнером Grafana). Сценарий:
регистрация → workflow с узлом `agent` (`model: gpt-4o-mini`,
`tools: ['llm_call']`) → `POST /runs` → BullMQ/Redis → реальный
`AgentService` → mock отдаёт `{"tool":"llm_call",…}`, затем текст для
`llm_call`, затем `{"final":"готово"}`. Это проходит через настоящий
`OpenAiCompatibleProvider` (OpenAI SDK), `LlmService`, `EngineService` и
`MetricsService` — mock заменяет только сеть провайдера, а не код метрик.

Второй запуск переключает mock в `mode=error` (HTTP 500): провайдер кидает
retryable-ошибку, запуск завершается `failed`, а в `/metrics` появляется
`agent_step_duration_seconds_count{...status="error"}`. Так проверены оба
статуса end-to-end.

### 3.8 Диагностика смоука: три ошибки в самом скрипте

1. **Первый запуск** упал на `Failed to parse URL ...3100http://127.0.0.1:3099/__reset`:
   helper `request` всегда добавлял `BASE` к пути, а для mock-сервера нужен
   другой origin. Добавлен `mockRequest`.
2. **Ложный `✗` при `SMOKE: 7/8 PASS, 0 FAIL`**: в `check(name, ok, details)`
   объект `details` раскрывался после `status`, и поле `details.status`
   (HTTP-код) перезаписывало `'PASS'/'FAIL'`. Аналогично позже `result`
   перезаписался ответом узла. Поля проверки переименованы (`result` —
   статус проверки, доменные детали — `httpStatus`/`nodeStatus`/`answer`).
3. **Счётчики накапливаются между прогонами одного процесса backend**:
   `llm_call_duration_seconds_count` после второго прогона стал `2`, а
   проверка ждала ровно `1`. Ассерты переведены на `>= 1`/`>= 2` (идемпотентный
   смоук), при этом серии и модель проверяются точно.

### 3.9 Полный прогон поймал сломанный интеграционный мок

`pnpm test` упал в `agent.integration.spec.ts`: `TypeError:
this.registry.hasModel is not a function`. Причина — интеграционный тест
собирает `LlmRegistryService` как `useValue` только с
`resolveEmbeddingProviderAsync`; после добавления `hasModel` реальный
`AgentService` вызвал отсутствующий метод. Это ровно тот класс, который
unit-тесты с частичным моком не ловят. В мок добавлен
`hasModel: vi.fn(() => true)`; после этого полный прогон зелёный. Урок
зафиксирован в § 5: частичные моки DI-объектов ломаются при расширении
интерфейса.

### 3.10 Реестр KI: дубли после docs-шага S3

На HEAD `8a2c571` в реестре было **604 заголовка при 600 уникальных номерах**:
краткие копии KI-605..608 остались после docs-шага S3 (подробные записи уже
были). Причём краткая копия KI-605 имела статус `Open`, а подробная —
`Fixed (частично)`. Дубли удалены; реестр пересчитан grep'ом (RULES 3.20):
**600 записей, 600 статусов, номера уникальны**. Сводка обновлена:
Fixed 255, Fixed (частично) 5, Open 287, Documented 43,
Documented (не воспроизводится) 1, Planned 3, Deferred 2, Won't Fix 4.

### 3.11 Что не менялось

Формат `GET /metrics`, `Content-Type`, `Cache-Control: no-store`, отсутствие
JWT на ручке (KI-575) и имена четырёх старых метрик не менялись. Единственное
изменение контракта — добавление label `status` к `agent_step_duration_seconds`
и новая `llm_call_duration_seconds`. Запросы без `status` продолжат работать
(Prometheus агрегирует серии), но их p95 теперь смешивает успехи и ошибки —
это осознанно и отражено в ADR-0009.

---

## 4. Smoke (живое приложение)

**Окружение:** PostgreSQL 17 `127.0.0.1:5433/workflow_builder` (контейнер
`workflow-builder-db`), Redis `127.0.0.1:6379`, backend — `node dist/main.js`
на **3100** (3000 занят сторонним Grafana-контейнером), mock OpenAI на 3099.
Скрипт `.smoke/v110-s4-metrics-smoke.mjs` (407 строк). Итог: **18/18 PASS,
0 FAIL**; `generatedAt = 2026-11-04T20:53:28Z`, организация
`8edb778b-ea6a-4494-a111-70bc17ce53d7` (удалена).

### 4.1 Экспозиция до запусков

| Проверка | Факт |
|---|---|
| `GET /metrics` | 200; `Content-Type` содержит `text/plain`, `version=0.0.4`, `charset=utf-8` (сервис отдаёт их в порядке реестра, Express переставляет параметры) |
| `nodejs_*` | есть (`nodejs_eventloop_lag_seconds` и др.) |
| `process_*` | есть (`process_cpu_user_seconds_total` и др.) |
| HELP/TYPE 5 доменных метрик | `http_request_duration_seconds`, `run_execution_duration_seconds`, `run_cost_total`, `agent_step_duration_seconds`, `llm_call_duration_seconds` |
| `llm_call_duration_seconds` до вызовов | `# HELP`/`# TYPE` присутствуют (серий ещё нет) |

### 4.2 Успешный agent-run через mock OpenAI

| Проверка | Факт |
|---|---|
| Запуск | `status=completed` |
| Узел `agent` | `nodeType=agent`, `status=completed`, `outputs.result="готово"` |
| `llm_call_duration_seconds_count` | `{model="gpt-4o-mini",status="success"}` ≥ 1 |
| `llm_call_duration_seconds_sum` | > 0 секунд |
| `agent_step_duration_seconds_count` | `{model="gpt-4o-mini",status="success"}` ≥ 2 (два LLM-шага) |

### 4.3 Ошибка LLM (mock 500)

| Проверка | Факт |
|---|---|
| Запуск | `status=failed` |
| `agent_step_duration_seconds_count` | `{model="gpt-4o-mini",status="error"}` ≥ 1 |
| Причина | mock вернул HTTP 500 → `LlmProviderException` (retryable), retry-guard отработал |

### 4.4 Инфраструктура и уборка

| Проверка | Факт |
|---|---|
| `infra/grafana/dashboard.json` | 3 панели: HTTP latency, Run duration, Agent errors; JSON валиден |
| `infra/prometheus/prometheus.yml` | `metrics_path: /metrics`, target `localhost:3000` |
| Уборка | организация smoke удалена каскадом; пользователей `smoke-s4-%` — 0 |
| Серверы | backend и mock остановлены (RULES 3.14) |

---

## 5. Что не так

1. **`engines.node` не зафиксирован (KI-609, 🟢 Low).** Новый клиент требует
   Node `^22 || ^24 || >=26`; CI — Node 22, локально — 24, поэтому сейчас всё
   работает. Но `package.json` не объявляет ограничение, а на Node 20/23
   установка/работа не гарантированы. Пакет 0.x — API может меняться.
2. **Дашборд не проверяется в CI и не содержит alert rules (KI-610, 🟢 Low).**
   Смоук парсит JSON и сверяет три панели, но не рендерит их и не сверяет
   `expr` с именами метрик. Переименование метрики даст «No data» молча.
   Provisioning datasource и алерты не добавлены (DESIGN § 3.4 требовал
   только dashboard + prometheus.yml).
3. **`collectDefaultMetrics` на каждый инстанс и без снятия (KI-611,
   🟢 Low).** В проде сервис один, но тесты создают десятки экземпляров;
   `PerformanceObserver` для GC не отключается. Для текущих тестов это
   незаметно, но при пересоздании сервиса в долгом процессе — утечка
   наблюдателей.
4. **Моста OTel→Prometheus нет (KI-612, 🟢 Low).** `OtelService` отправляет
   трейсы в OTLP-коллектор; метрики из OTel-инструментов в `/metrics` не
   попадают. Источники метрик — только `MetricsService` и
   `collectDefaultMetrics`.
5. **Scrape-target `localhost:3000` — локальный пример (KI-613, 🟢 Low).** В
   Docker-сети Prometheus увидит себя, а не backend; нужен
   `host.docker.internal` или DNS-имя сервиса. Конфиг не является
   production-манифестом.
6. **Контракт `agent_step_duration_seconds` изменился: добавлен `status`.**
   Старые запросы без фильтра продолжат работать, но их p95 теперь смешивает
   успешные шаги и ошибки. Дашборды, которым нужен «нормальный» p95, обязаны
   добавить `status="success"`. Это осознанное изменение (KI-576), но оно
   требует внимания при обновлении внешних дашбордов.
7. **`model="unknown"` скрывает детали.** Если модель не объявлена в реестре
   (или модель «выдумала» id), метрика показывает `unknown`. Это защита от
   кардинальности, но диагностика «какая именно модель тормозила» для таких
   вызовов теряется — в логах остаётся реальный id.
8. **Смоук использует mock-LLM, а не реального провайдера.** Это сознательно
   (детерминизм, без платных вызовов), и mock проходит через настоящий
   `OpenAiCompatibleProvider`/`LlmService`/движок. Но сетевые особенности
   реального провайдера (TLS, прокси, 429) в смоуке не проверяются; они
   покрыты интеграционными тестами провайдеров.
9. **Ошибка LLM в смоуке может ретраиться несколько раз.** Проверка
   `status="error"` считает `>= 1`, а не точное число: BullMQ/node-retry
   могут дать несколько записей. Это не дефект, но число нестабильно.
10. **Набор default-метрик зависит от платформы.** `nodejs_gc_*` и
    `process_resources` появляются не на всех Node/ОС; тест проверяет только
    гарантированные `nodejs_eventloop_lag_seconds`/`nodejs_heap_size_used_bytes`
    и `process_*`.
11. **Нет теста, что `expr` дашборда ссылается на существующую метрику.**
    Сейчас имена совпадают вручную; при следующем переименовании это не
    поймается (входит в KI-610).
12. **`pnpm lint` — 2 преэкзистующих warning'а** в
    `openai-images.provider.spec.ts` (не наши файлы); массовое
    переформатирование не делали.
13. **Реестр KI на HEAD содержал 4 дубля** KI-605..608 после docs-шага S3
    (подробная запись KI-605 — `Fixed (частично)`, краткая — `Open`).
    Удалены, сводка пересчитана: 600/600.
14. **`pnpm test` без `DATABASE_URL` пропускает DB-спеки.** В этом прогоне
    (с `DATABASE_URL`) пропущены только 2 теста `openai-images.integration`
    (нет ключа Images, `skipIf`), а DB-спеки выполнялись. Это свойство
    конфига, не регресс; parity дополнительно запускается отдельной командой.

---

## 6. Новые KI

Всего **5**: KI-609..613. Реестр пересчитан grep'ом (RULES 3.20): **600**
записей `### KI-`, 600 статусов, номера уникальны (было 604 заголовка при 600
уникальных — удалены 4 кратких дубля KI-605..608).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-609](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `@prometheus-io/client@0.16.1` требует Node 22/24/26+, `engines.node` проекта не зафиксирован |
| [KI-610](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | Grafana dashboard статичен: панели не проверяются в CI, alert rules/provisioning нет |
| [KI-611](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `collectDefaultMetrics` регистрируется на каждый инстанс, GC-наблюдатель не снимается |
| [KI-612](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | OTel-трейсы не экспортируются в Prometheus (моста нет) |
| [KI-613](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Scrape-target `localhost:3000` зависит от способа запуска Prometheus |

**Закрытые KI:** KI-574 (Fixed — миграция клиента), KI-576 (Fixed — status),
KI-577 (Fixed — llm_call).
**Частично:** KI-581 (default-метрики есть, OTel-моста нет — KI-612),
KI-582 (dashboard+scrape есть, алертов/provisioning нет — KI-610).
**Исправлено в реестре по ходу:** удалены 4 дубля KI-605..608.

Сводка: **Fixed 255 + Fixed (частично) 5 + Open 287 + Documented 43 +
Documented (не воспроизводится) 1 + Planned 3 + Deferred 2 + Won't Fix 4 =
600**. Обновлены `docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `README.md`,
`reports/README.md`, ADR-0009.

---

## 7. Обоснование решений

### 7.1 Почему официальный клиент, хотя он 0.x

`prom-client` официально заменён на `@prometheus-io/client`; оставаться на
deprecated-пакете — откладывать миграцию и накапливать риск. API совместим
(проверено по `.d.ts` и тестами), формат экспозиции не изменился, поэтому
переход дешёвый. 0.x-статус компенсирован фиксацией версии (`^0.16.1`), тестами
контракта экспозиции и смоуком; ограничение по Node вынесено в KI-609, а не
«спрятано» в lockfile.

### 7.2 Почему `status` — label, а не отдельная метрика ошибок

`agent_step_errors_total{reason}` потребовал бы второй гистограммы/счётчика,
отдельного контракта и ещё одной строки в дашборде. `status` на существующей
гистограмме даёт и error-rate (`rate(..._count{status="error"}[5m])`), и
latency ошибок (`histogram_quantile` с фильтром), сохраняя одну метрику и
одно место записи. Плата — изменение контракта (см. § 5.6), зафиксированное в
CHANGELOG/ADR.

### 7.3 Почему `llm_call` инструментирован в `executeToolAsync`, а не в `LlmService`

`LlmService.generateAsync` вызывается и агентом, и LLM-узлом, и `llm_call`.
Метрика «длительность `llm_call`» должна атрибутироваться конкретному
инструменту агента, иначе она неотличима от обычного LLM-шага и смешает
разные сценарии. `executeToolAsync` — единственное место, где известны имя
инструмента, его аргументы, модель агента и факт ошибки; там же уже есть
замер для логов. Отдельная метрика на `LlmService` была бы «средней
температурой по больнице» и дублировала бы спаны `llm.call`.

### 7.4 Почему `hasModel`, а не свободный `model`-label

Свободный label из пользовательского графа/ответа модели — прямой путь к
кардинальности. Варианты: (а) убрать `model` вовсе — теряется разрешение по
моделям, которое уже было; (б) хешировать/обрезать — всё равно неограниченно;
(в) сверять с реестром и писать `unknown` — одна серия, предсказуемый размер.
Выбран (в). `hasModel` не бросает исключение (в отличие от `resolveByModel`),
поэтому вызов метрики не может уронить шаг агента из-за неизвестной модели.

### 7.5 Почему default-метрики в тот же реестр и без префикса

Отдельный реестр/default-экспортёр усложнил бы `getMetrics` (нужно было бы
склеивать два текста) и сломал бы изоляцию тестов. Тот же реестр даёт один
`registry.metrics()` и один `Content-Type`. Префикс не задаётся, потому что
имена `process_*`/`nodejs_*` уже стандартные и не пересекаются с доменными;
искусственный `workflow_builder_` сломал бы совместимость с типовыми
дашбордами/алертами Prometheus и увеличил бы длину имён. Коллекторы ленивые —
на `GET /metrics`, а не на каждом запросе приложения.

### 7.6 Почему в дашборде ровно три панели

Постановка S4 просила три панели: HTTP latency, Run duration, Agent errors.
Добавлять стоимость/узлы/алерты без требования — значит тащить в S4 ещё один
контракт и тесты; они вынесены в KI-610/будущие срезы. Панель Run duration
использует `run_execution_duration_seconds` (длительность узлов) — отдельной
гистограммы «всего запуска» в метриках нет, и вводить её в S4 не просили.

### 7.7 Почему смоук — реальный agent-run с mock-LLM, а не вызов `MetricsService`

Прямой вызов `observeLlmCall` доказал бы только, что гистограмма пишет серию;
он не проверяет, что `AgentService` действительно инструментирует `llm_call`,
что `model` резолвится, что `status` пишется при ошибке и что `/metrics`
отдаёт всё это в живом процессе. Mock OpenAI позволяет провести **весь** путь
(HTTP → BullMQ → engine → agent → provider → metrics) детерминированно и без
платных вызовов; заменена только сеть провайдера. Порт 3100 выбран, потому
что 3000 занят сторонним контейнером — это не изменение продукта, а условие
окружения.

### 7.8 Почему `engines.node` не зафиксирован в этом срезе

Это изменение `package.json`, которое влияет на установку/CI и требует
отдельного решения (поддерживать ли Node 20). В S4 важнее было зафиксировать
факт ограничения в KI-609 и не ломать текущий CI (Node 22) «находу». Явное
`engines.node: ">=22"` — маленькая, но отдельная правка с проверкой
`pnpm install` на всех поддерживаемых версиях.

### 7.9 Почему отчёт выводится целиком

RULES 2.15/2.18: краткий отчёт скрывает детали. В S4 таких деталей много:
изменение контракта `agent_step_duration_seconds`, кардинальность `model`,
остаточные ограничения (KI-609..613), а также ошибки самого смоука и
сломанный интеграционный мок, которые были найдены и исправлены. Полный
отчёт сохранён в `docs/development/reports/v1.1.0/S4-metrics.md` и выведен в
чат целиком.
