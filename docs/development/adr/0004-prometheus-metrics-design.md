# ADR 0004: Метрики Prometheus — интерсептор, подписи и best-effort запись (v1.0.0 S4)

**Дата:** 2026-11-03
**Статус:** Accepted
**Связано:** DESIGN v1.0 § 2.3, § 3.3; RULES 4.15/4.18/4.23/5.9; KI-574..582

## Контекст

DESIGN v1.0 § 2.3 требует экспорт метрик для Prometheus/Grafana:
`http_request_duration_seconds`, `run_execution_duration_seconds`,
`run_cost_total`, кастомные гистограммы для узлов, эндпоинт `/metrics` без auth
(для скрейпера). Метрики нужны для дежурства и алертов, но не должны влиять на
поведение API, раздувать память процесса и раскрывать пользовательские данные.

## Решение

1. **Собственный `Registry` в `MetricsService`, а не глобальный `register`.**
   Тесты создают несколько инстансов, а глобальный реестр prom-client давал бы
   «Already registered metric». Изоляция реестра также не пускает в экспозицию
   скрытые коллекторы библиотеки.
2. **Метрики и подписи — контракт:** `http_request_duration_seconds{method,
   route,status}`, `run_execution_duration_seconds{node_type,status}`,
   `run_cost_total{currency}` (USD/RUB раздельно, RULES 4.23),
   `agent_step_duration_seconds{model}`. Запись — только через методы
   `MetricsService`, потребители не знают prom-client.
3. **HTTP-метрики — глобальный `MetricsInterceptor` (APP_INTERCEPTOR)**, самый
   внешний слой (регистрируется до `AuditInterceptor`): `performance.now()` +
   `finalize` (пишет и успех, и ошибку, и отмену клиентом), статус — из
   `response.statusCode`, сама `/metrics` не наблюдается. Подпись `route` —
   шаблон (`request.route.path` Express) или фактический путь с заменой UUID на
   `:id`, чтобы кардинальность была ограничена.
4. **`GET /metrics` без `JwtAuthGuard`** — прямое требование DESIGN § 3.3:
   скрейпер не умеет JWT. Защита — сетевая (ingress/reverse-proxy allowlist);
   в экспозиции только агрегаты с ограниченными подписями, без пользовательских
   данных. `MetricsModule` — `@Global()`, чтобы движок и агент получали сервис
   без правок их `imports`.
5. **Интеграция в движок.** `ExecutionEngineService.executeNodeAsync` замеряет
   полный жизненный цикл узла (completed/failed, ошибка пробрасывается);
   стоимость наблюдается в `executeNodeRunAsync` **только после** успешного
   UPDATE `node_runs` и публикации `node_completed` — упавшая/повторная попытка
   стоимость не засчитывает.
6. **Интеграция в агент.** `AgentService` замеряет основной вызов
   `llm.generateAsync` каждого шага цикла и пишет
   `agent_step_duration_seconds{model}` только при успехе (у метрики нет
   status-лейбла). Вложенный tool-вызов `llm_call` не инструментирован (KI-577).
7. **Best-effort.** Сбой записи метрики логируется (`Logger.warn`) и не влияет
   на ответ (RULES 4.18): метрики — вспомогательная подсистема. Регистр живёт в
   памяти процесса (KI-579).

## Последствия

**Лучше:**
- `/metrics` отдаёт все четыре метрики в формате Prometheus 0.0.4, скрейпится
  без auth; подписи ограничены, память не растёт от количества объектов.
- HTTP-метрика покрывает 4xx/5xx и отмены, потому что пишется в `finalize`.
- Метрики движка/агента включены без правок их модулей (`@Global`).
- Сбой метрик не ломает пользовательские операции; `MetricsService` — единая
  точка записи, подписи нельзя «разъехать» между вызывающими.

**Хуже / ограничения:**
- `prom-client` deprecated upstream — нужна миграция на `@prometheus-io/client`
  (KI-574); ручка `/metrics` открыта, защита — сетевая (KI-575).
- Агентские метрики не видят отказов LLM-шагов (нет status-лейбла, KI-576) и
  вложенный `llm_call` (KI-577).
- Переиспользованные узлы KI-046 считаются completed с ~0 с (KI-578);
  fallback-нормализация route знает только UUID (KI-580).
- Нет default process-метрик/OTel-моста (KI-581) и дашбордов/алертов в
  репозитории (KI-582); multi-instance — скрейп каждого pod (KI-579).
