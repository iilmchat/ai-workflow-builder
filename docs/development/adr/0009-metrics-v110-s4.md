# ADR 0009: Метрики v1.1.0 S4 — официальный клиент, status-label, llm_call и process-метрики

**Дата:** 2026-11-04
**Статус:** Accepted
**Связано:** DESIGN v1.1 § 3.4; RULES 5.9; KI-574, KI-576, KI-577, KI-581, KI-582, KI-609..613

## Контекст

1. v1.0.0 S4 добавил `MetricsService` с четырьмя метриками на `prom-client`.
   Пакет помечен upstream deprecated: «prom-client has been replaced by
   `@prometheus-io/client`» (KI-574).
2. `agent_step_duration_seconds{model}` писал только успешные шаги: у
   гистограммы не было `status`, поэтому error-rate и latency отказов агента
   по метрикам не строились (KI-576).
3. Инструмент `llm_call` делает платный LLM-вызов внутри tool-шага; его
   длительность не видна ни в `agent_step`, ни отдельно (KI-577).
4. В экспозиции не было стандартных process/runtime-метрик (CPU, RSS, heap,
   event loop, GC) и готовых конфигов Prometheus/Grafana (KI-581, KI-582).

## Решение

1. **Официальный клиент.** `prom-client` заменён на
   `@prometheus-io/client@0.16.1` (Apache-2.0, репозиторий
   `prometheus/client_js`). API `Registry`/`Histogram`/`Counter`/
   `collectDefaultMetrics` совместим, формат экспозиции остался
   `text/plain; version=0.0.4; charset=utf-8`; правки импортов механические.
2. **`status` как label, а не отдельная метрика.** `agent_step_duration_seconds`
   получила `{model,status}` (`success`/`error`). Один запрос
   `rate(..._count{status="error"}[5m])` даёт error-rate, а `histogram_quantile`
   по `status="error"` — latency отказов. Альтернатива «отдельный счётчик
   ошибок» дублировала бы серии и требовала второго контракта.
3. **`llm_call_duration_seconds{model,status}`.** Инструментация — в
   `AgentService.executeToolAsync`, а не в `LlmService`: метрика должна
   отвечать на вопрос «сколько длился `llm_call` агента», а не «все LLM-вызовы
   процесса» (последние уже покрыты спанами `llm.call` и стоимостью).
   Ведра 0.05…60 с; ошибка инструмента не прерывает цикл и пишется как `error`.
4. **Кардинальность `model`.** `model` — label, а значение приходит из
   пользовательского графа (`node.model`) или из аргументов `llm_call`,
   которые формирует модель. Произвольная строка создала бы новую серию
   Prometheus на каждый вызов. `LlmRegistryService.hasModel` (новый метод)
   проверяет id по реестру моделей; неизвестный id пишется как `unknown` —
   одна серия на все неподдерживаемые модели. Это осознанная зависимость
   метрик от реестра: лучше потерять разрешение по «модели-галлюцинации»,
   чем получить неограниченную кардинальность.
5. **Process-метрики в тот же изолированный реестр.** В конструкторе
   `MetricsService` вызывается
   `collectDefaultMetrics({ register: this.registry })`. Имена `process_*` и
   `nodejs_*` не пересекаются с доменными (`http_`, `run_`, `agent_`,
   `llm_call_`), поэтому `prefix` не задаётся; конфликт имён дал бы ошибку
   регистрации. Ленивая коллекция выполняется при `GET /metrics`.
6. **Инфраструктура в репозитории.** `infra/prometheus/prometheus.yml` —
   scrape-job `workflow-builder` (`/metrics`, `localhost:3000`, интервал 15 с).
   `infra/grafana/dashboard.json` — три панели: HTTP latency p95, Run duration
   p95 по типам узлов, Agent errors (`status="error"` для `agent_step` и
   `llm_call`). JSON проверяется смоуком; datasource — переменная
   `DS_PROMETHEUS`.

## Последствия

**Лучше:**
- Deprecated-зависимость удалена; клиент — официальный, с тестами upstream.
- Ошибки агента видны в метриках: error-rate, latency падений, ошибки
  `llm_call`; их можно алертить без логов.
- Process-метрики дают базовое дежурное наблюдение (RSS/CPU/event loop/GC)
  без отдельного экспортёра.
- Готовые конфиги позволяют поднять Prometheus+Grafana локально и не
  изобретать запросы; дашборд использует только существующие метрики.
- `model`-label ограничен реестром — кардинальность предсказуема.

**Хуже / ограничения:**
- `@prometheus-io/client@0.16.1` требует Node 22/24/26+, `engines.node`
  проекта не зафиксирован (KI-609).
- `collectDefaultMetrics` регистрируется на каждый инстанс `MetricsService`
  (GC-наблюдатель не снимается); в проде инстанс один, в тестах — много
  (KI-611).
- Дашборд статичен: переименование метрики не поймает CI, alert rules и
  provisioning не добавлены (KI-610).
- Мост OTel→Prometheus по-прежнему отсутствует (KI-612).
- Scrape-target `localhost:3000` — локальный пример; в Docker/k8s нужен
  `host.docker.internal` или DNS-имя сервиса (KI-613).
- `status`-label меняет контракт `agent_step_duration_seconds`: старые
  dashboard-запросы без `status` продолжат работать (агрегируют обе серии), но
  p95 без фильтра теперь смешивает успехи и ошибки — это осознанно, дашборд
  фильтрует по `status` там, где нужно.
