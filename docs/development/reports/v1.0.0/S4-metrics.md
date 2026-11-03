---
title: "S4: Prometheus Metrics (v1.0.0)"
date: 2026-11-03
version: v1.0.0
steps: [S4]
status: accepted
related_ki: [KI-574, KI-575, KI-576, KI-577, KI-578, KI-579, KI-580, KI-581, KI-582]
related_adr: [0004]
---

# Отчёт S4 — Prometheus Metrics (v1.0.0)

**Статус:** реализовано; коммитов в этой сессии нет (`git add`/`git commit` не
вызывались, `git add -A` не использовался). `pnpm build` — **0 errors /
0 warnings**, `pnpm typecheck` — **0**, `pnpm test` — **114 passed / 4 skipped
(118 файлов), 1710 passed / 23 skipped (1733)** без `DATABASE_URL`; с
`DATABASE_URL` — **118/118 файлов, 1731 passed / 2 skipped**,
`pnpm test:parity` — **12/12**, `pnpm test:e2e` — **1/1**, `pnpm lint` —
**0 errors / 2 warnings** (преэкзистующие). Смоук на живом приложении —
**5/5**: `GET /metrics` без auth → 200 `text/plain`, все 4 метрики
зарегистрированы; HTTP-трафик обновил `http_request_duration_seconds`
(route `/workflow`, статусы 200/201); запуск workflow обновил
`run_execution_duration_seconds{node_type="text",status="completed"}=1`;
`/metrics` не наблюдает сам себя; `run_cost_total`/`agent_step_duration_seconds`
зарегистрированы.

**Точка старта.** HEAD `1886eda` («feat(v1.0.0): S3 — Audit Logs»), CI
зелёный. Источник — `docs/development/v1.0/DESIGN_V100_ENTERPRISE.md` § 2.3/§ 3.3,
правила — `docs/development/RULES.md` v1.10.0.

**Сделано:** установлен `prom-client`; новый `src/metrics/*` (сервис с
собственным Registry, глобальный интерсептор, контроллер `GET /metrics`,
`@Global()` модуль); метрики движка (длительность узла + стоимость) и агента
(длительность LLM-шага); `metrics` в едином реестре API-префиксов.
**Новые KI:** KI-574..582 (§ 6).

---

## 1. Файлы (+/−)

### 1.1 Новые файлы

| Файл | Строк | Что |
|---|---:|---|
| [src/metrics/metrics.service.ts](../../../../src/metrics/metrics.service.ts) *(new)* | 211 | `@Injectable() MetricsService` с собственным `Registry`; 4 метрики (`http_request_duration_seconds`, `run_execution_duration_seconds`, `run_cost_total`, `agent_step_duration_seconds`) с зафиксированными подписями/бакетами; `observeHttpRequest`/`observeNodeExecution`/`observeCost`/`observeAgentStep`/`getMetrics`/`contentType` |
| [src/metrics/metrics.interceptor.ts](../../../../src/metrics/metrics.interceptor.ts) *(new)* | 176 | Глобальный интерсептор: `performance.now()` + `finalize` (успех/ошибка/отмена), статус из `response.statusCode`, skip не-HTTP и `/metrics`, подпись `route` из `request.route.path` либо нормализация UUID→`:id`; сбой метрики только логируется |
| [src/metrics/metrics.controller.ts](../../../../src/metrics/metrics.controller.ts) *(new)* | 42 | `GET /metrics` без `JwtAuthGuard`; `Content-Type` из реестра, `Cache-Control: no-store`; тонкий passthrough `getMetrics()` |
| [src/metrics/metrics.module.ts](../../../../src/metrics/metrics.module.ts) *(new)* | 26 | `@Global()` модуль: controller, `MetricsService`/`MetricsInterceptor` в providers и exports; `APP_INTERCEPTOR` регистрируется в `AppModule` |
| [src/metrics/metrics.service.spec.ts](../../../../src/metrics/metrics.service.spec.ts) *(new)* | 188 | 9 тестов: имена/labels/типы метрик, серии после `observe*`, USD/RUB раздельно, фильтрация null/0/отрицательных/NaN, изоляция нескольких инстансов, `getMetrics`/`contentType` |
| [src/metrics/metrics.interceptor.spec.ts](../../../../src/metrics/metrics.interceptor.spec.ts) *(new)* | 268 | 11 тестов: GET/POST/ошибка записываются с method/route/status, `/metrics` и не-HTTP пропускаются, route из `route.path` и UUID-fallback, сбой метрик не ломает ответ |
| [src/metrics/metrics.controller.spec.ts](../../../../src/metrics/metrics.controller.spec.ts) *(new)* | 105 | 3 теста supertest: 200, `Content-Type` text/plain (компоненты), `Cache-Control: no-store`, тело из сервиса |
| [docs/development/adr/0004-prometheus-metrics-design.md](../../adr/0004-prometheus-metrics-design.md) *(new)* | 68 | ADR: реестр, подписи/кардинальность, интерсептор, `@Global`, порядок записи стоимости, границы (KIs) |

### 1.2 Изменённые файлы

| Файл | +/− | Что |
|---|---:|---|
| [package.json](../../../../package.json) | +1/−0 | `prom-client@^15.1.3` |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | +25/−0 | Lockfile зависимости |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +92/−17 | `MetricsService` в конструкторе; `executeNodeAsync` замеряет узел (`completed`/`failed`, ошибка пробрасывается); `executeNodeRunAsync` пишет `observeCost` после успешного UPDATE + `node_completed` (retry/reuse/failure — без стоимости) |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +116/−0 | Провайдер-mock + 5 тестов S4: completed-длительность, failed-статус, стоимость USD, бесплатный узел, KI-046 reuse |
| [src/agent/agent.service.ts](../../../../src/agent/agent.service.ts) | +22/−0 | `MetricsService` в конструкторе; замер основного `llm.generateAsync` каждого шага цикла → `observeAgentStep(node.model, seconds)` после успеха |
| [src/agent/agent.service.spec.ts](../../../../src/agent/agent.service.spec.ts) | +113/−0 | Mock + 3 теста: один шаг, multi-step (tool→final), ошибка LLM — метрика не пишется |
| [src/agent/agent.integration.spec.ts](../../../../src/agent/agent.integration.spec.ts) | +4/−0 | Реальный `MetricsService` в TestingModule |
| [src/media/media-storage.integration.spec.ts](../../../../src/media/media-storage.integration.spec.ts) | +6/−0 | Реальный `MetricsService` (спека строит настоящие Engine+Agent) |
| [src/app.module.ts](../../../../src/app.module.ts) | +10/−0 | Импорт `MetricsModule`; `APP_INTERCEPTOR` `MetricsInterceptor` **до** `AuditInterceptor` |
| [api-prefixes.json](../../../../api-prefixes.json) | +1/−0 | Префикс `metrics` (SPA-exclude + Vite proxy) |
| [src/common/api-prefixes.spec.ts](../../../../src/common/api-prefixes.spec.ts) | +6/−3 | Ожидаемые controller-префиксы: 12 (включая `metrics`) |

**Итого по коду:** **11 изменённых файлов, +396 / −20** (production —
6 файлов +151/−17: package.json, lockfile, api-prefixes, app.module, движок,
агент; тесты — 5 файлов +245/−3); новые файлы — **7 файлов / 1016 строк**
(production 455: service 211 + interceptor 176 + controller 42 + module 26;
спеки 561). Всего затронуто **18 файлов** (+1412/−20).
Документация (не входит в счёт кода): `docs/CHANGELOG.md`,
`docs/KNOWN_ISSUES.md` (KI-574..582 + сводка + удаление дублей S3),
`docs/development/adr/0004-*.md`, `docs/development/reports/README.md`, этот
отчёт.

Артефакт смоука (gitignored): `.smoke/v100-s4-metrics-smoke.mjs` +
`.smoke/v100-s4-metrics-smoke.json`.

---

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` | **0 errors / 0 warnings**, exit 0 |
| `pnpm typecheck` | **0** (exit 0) |
| `pnpm test` (без `DATABASE_URL`) | **114 passed / 4 skipped (118 файлов); 1710 passed / 23 skipped (1733)**, 28.9 с |
| `pnpm test` (с `DATABASE_URL`) | **118/118 файлов; 1731 passed / 2 skipped (1733)**, 28.0 с |
| `pnpm test:parity` | **12/12** (KI-298; схема БД в S4 не менялась) |
| `pnpm test:e2e` | **1/1** (bootstrap `AppModule` с `MetricsModule`/`MetricsInterceptor`) |
| `pnpm lint` (oxlint) | **0 errors / 2 warnings** — оба преэкзистующие (`openai-images.provider.spec.ts`) |
| oxlint changed files (по командам) | 0 warnings / 0 errors в каждом скоупе |

Прирост к S3: **+3 тест-файла** (metrics service/interceptor/controller),
**+31 passed-тест** без БД (1710−1679) и **+31** с БД (1731−1700); skipped
не изменились (23/2 — DB-спеки и `skipIf` без ключа провайдера). Миграций нет —
S4 не меняет схему БД.

---

## 3. Диагностика

### 3.1 Собственный Registry вместо глобального `register`

`prom-client` по умолчанию регистрирует метрики в глобальном реестре: второй
инстанс `MetricsService` в тестах падал бы с «Already registered metric», а
скрытые коллекторы библиотеки могли бы неожиданно попасть в `/metrics`.
`MetricsService` создаёт `new Registry()` и передаёт его каждой метрике
(`registers: [this.registry]`); тесты подтверждают изоляцию двух инстансов.

### 3.2 Подпись route: шаблон, а не фактический URL

Кардинальность — главная ловушка HTTP-метрик: `/workflow/<uuid>` как label дал
бы новую серию на каждый объект. Интерсептор берёт `request.route.path` Express
(`/workflow/:id`) — смоук подтвердил `route="/workflow"` для GET/POST списка и
создания; fallback нормализует UUID-сегменты фактического пути в `:id`.
Не-uuid идентификаторы (слаги) в fallback не нормализуются — зафиксировано в
KI-580 (в реальном runtime шаблон Express всегда доступен).

### 3.3 Порядок интерсепторов и статус ответа

`MetricsInterceptor` зарегистрирован в `AppModule` **раньше** `AuditInterceptor`:
это внешний слой, поэтому длительность включает и запись аудита. Статус
`response.statusCode` в `finalize` уже финальный (Nest применяет `@HttpCode`
до интерсепторов — тот же факт подтверждён в S3 для аудита); смоук видит
статусы 200 и 201 в экспозиции. `finalize` срабатывает и при ошибке/отмене
клиентом, поэтому 4xx/5xx попадают в гистограмму.

### 3.4 `/metrics` не наблюдает сам себя

Скрейп Prometheus — тоже HTTP-запрос; без исключения он добавлял бы запись на
каждый вызов и шумел бы в дашбордах. Интерсептор пропускает путь `/metrics`
(и `/metrics/` — Express-совместимо). Смоук отдельно проверил: серий с
`route="/metrics"` в экспозиции **0**.

### 3.5 Стоимость: только успешная финальная операция

`observeCost` вызывается в `executeNodeRunAsync` **после** успешного UPDATE
`node_runs` и публикации `node_completed`, а не сразу после вызова провайдера:
если публикация события упадёт, узел будет `failed` — стоимость за неуспешный
узел считать нельзя. Retry-попытки и KI-046-reuse до этой точки не доходят.
Валюты разделены подписями (`USD`/`RUB`, RULES 4.23), нули/null/NaN
игнорируются. В dev-окружении нет ключей LLM/media, поэтому в смоуке серий
`run_cost_total` нет — метрика зарегистрирована (HELP/TYPE) и покрыта
unit-тестами (LLM-узел с `costUsd=0.0045` → инкремент USD).

### 3.6 Агентские шаги: только успешные основные вызовы

`AgentService` замеряет основной `llm.generateAsync` каждого шага цикла и
пишет `agent_step_duration_seconds{model}` после успешного ответа. Упавшие
LLM-шаги не записываются (у метрики нет status-лейбла — KI-576), вложенный
tool-вызов `llm_call` не инструментирован (KI-577). Multi-step цикл даёт по
одной записи на каждый LLM-шаг (проверено тестом tool→final).

### 3.7 Переиспользованные узлы (KI-046) в гистограмме

`executeNodeAsync` наблюдает `completed` и для узла, результат которого
переиспользован после job-level retry: метрика получает ~0 с. Это следствие
контракта «наблюдать в `executeNodeAsync`»; для дашбордов по количеству/средней
длительности это завышает counts при ретраях — зафиксировано в KI-578
(варианты: не наблюдать reuse или label `reused`).

### 3.8 `prom-client` помечен deprecated

`pnpm add prom-client` вывел предупреждение, npm-метаданные пакета:
«prom-client has been replaced by @prometheus-io/client». Постановка S4 прямо
требует `prom-client`, поэтому зависимость оставлена; риск (нет новых фиксов,
неизвестно будущее API) зафиксирован в KI-574 с планом миграции.

### 3.9 DI-риппл в движок и агент

`ExecutionEngineService` и `AgentService` получили обязательную зависимость
`MetricsService`. Чтобы не править `imports` у `EngineModule`/`AgentModule`,
`MetricsModule` объявлен `@Global()`. Спеки, строящие настоящие сервисы,
получили провайдер метрик: engine spec (mock), media-storage integration
(real; спека создаёт и Engine, и Agent), agent spec (mock), agent integration
(real). Финальный `tsc` — 0, e2e bootstrap `AppModule` — зелёный.

### 3.10 Content-Type: Express переставляет параметры

`prom-client` отдаёт `text/plain; version=0.0.4; charset=utf-8`, но Express при
отправке переупорядочивает параметры (`text/plain; charset=utf-8;
version=0.0.4`). Смоук проверяет наличие `text/plain`/`version=0.0.4`;
controller-spec сверяет компоненты, а не строку целиком. Функционально формат
корректен для Prometheus.

### 3.11 `/metrics` в реестре префиксов и под глобальным throttler

Новый `@Controller('metrics')` добавлен в `api-prefixes.json` (SPA-fallback не
перехватывает ручку, Vite-proxy работает). Глобальный `ThrottlerGuard`
применяется и к `/metrics` (300 req/min по умолчанию): при scrape-интервале
15 с это 4 req/min, запас большой; ограничение зафиксировано в KI-575 как
эксплуатационное (если скрейп пойдёт чаще/с нескольких IP — поднять лимит или
`@SkipThrottle`).

### 3.12 Мелочи по ревью Lead

- В интерсепторе используется глобальный `performance` (типы Node 22 его
  содержат), в движке/агенте — явный `import { performance } from
  'node:perf_hooks'`. Поведение идентичное, разница косметическая; унификацию
  не делали, чтобы не трогать стабильные файлы (отмечено в § 5).
- В `KNOWN_ISSUES.md` на HEAD оказался повторный краткий блок KI-565..573
  (дубль подробного), из-за чего `grep` давал 569 записей вместо 560, а статусы
  «Planned (S5)» не входили в легенду. Дубли удалены в docs-проходе S4, реестр
  пересчитан: **569** записей, номера уникальны, сводка сходится (RULES 3.20).

---

## 4. Smoke (живое приложение)

Окружение: PostgreSQL 17 (pgvector) `127.0.0.1:5433/workflow_builder`, Redis
`127.0.0.1:6379`, приложение — `node dist/main.js` (порт 3000). Старт чистый:
`MetricsModule` инициализирован, маршрут `{ /metrics, GET }` замаплен, только
ожидаемые WARN media/web-search провайдеров (ключей нет). Скрипт:
`.smoke/v100-s4-metrics-smoke.mjs`.

### 4.1 `GET /metrics` без авторизации

Ответ — **200**, `Content-Type: text/plain; charset=utf-8; version=0.0.4`,
`Cache-Control: no-store`; в теле `# HELP`/`# TYPE` для всех четырёх метрик:
`http_request_duration_seconds`, `run_execution_duration_seconds`,
`run_cost_total`, `agent_step_duration_seconds`. **PASS**.

### 4.2 HTTP-метрика после трафика

Смоук зарегистрировал пользователя, сделал `GET /workflow`, `POST /workflow`,
`GET /workflow/:id`, `POST /runs`. После этого в экспозиции есть
`http_request_duration_seconds_bucket{le="0.025",method="POST",
route="/workflow",status="201"} 1` и серии с `method="GET"`/`status="200"`;
подпись route — шаблон `/workflow`, без uuid. **PASS**.

### 4.3 Метрика выполнения узла

Workflow с одним узлом `text` запущен через `POST /runs`; движок завершил
запуск (`status=completed`, 1 узел). В экспозиции:
`run_execution_duration_seconds_count{node_type="text",status="completed"} 1`.
**PASS**.

### 4.4 Самонаблюдение `/metrics` отсутствует

Серий `route="/metrics"` в экспозиции — **0**, хотя смоук скрейпил ручку
несколько раз. **PASS**.

### 4.5 Зарегистрированные cost/agent-метрики

`# TYPE run_cost_total counter` и `# TYPE agent_step_duration_seconds
histogram` присутствуют; конкретных серий нет — в dev-окружении нет ключей
провайдеров, поэтому платных LLM/media-узлов и агентских шагов не было.
Инкременты покрыты unit-тестами (движок/агент), а не смоуком — ограничение
зафиксировано в § 5. **PASS** (регистрация).

### 4.6 Уборка и состояние БД

Организация смоука удалена (`organizationsDeleted=1`); состояние БД после
смоука: **users=69, orgs=69, workflows=160, audit_logs=0** (как до S4).
Сервер остановлен, в логах — только ожидаемые WARN и строка о завершении
запуска.

---

## 5. Что не так

1. **`/metrics` без аутентификации** — by design (DESIGN § 3.3), но защита
   только сетевая: ручку нельзя публиковать наружу (KI-575). В коде нет
   allowlist/токена, и это осознанно.
2. **`prom-client` deprecated upstream** (`@prometheus-io/client` — замена);
   выполнено требование постановки, но зависимость не развивается (KI-574).
3. **Агентские ошибки не наблюдаются**: у `agent_step_duration_seconds` нет
   status/error-лейбла, неуспешные LLM-шаги не пишутся вовсе — error-rate и
   latency отказов агента по метрикам не построить (KI-576).
4. **Агентский `llm_call` не инструментирован** — второй платный LLM-вызов
   внутри шага-инструмента не виден в latency-метриках (KI-577).
5. **Переиспользованные узлы (KI-046)** учитываются как completed с ~0 с:
   `run_execution_duration_seconds_count` завышается при job-level retry
   (KI-578).
6. **Реестр на процесс**: при нескольких backend-инстансах Prometheus должен
   скрейпить каждый pod; агрегации/Pushgateway в приложении нет, метрики
   сбрасываются при рестарте (KI-579).
7. **Fallback route-нормализация знает только UUID** — не-uuid идентификаторы
   при недоступном `request.route.path` дали бы рост кардинальности (KI-580).
8. **Нет default process-метрик** (CPU/RSS/event-loop/GC) и моста
   OTel-трейсов в Prometheus — только 4 кастомные метрики (KI-581).
9. **Нет дашбордов/алертов Grafana и scrape-config в репозитории** — мониторинг
   пока ручной (KI-582).
10. **Стоимость и агентские шаги не проверены смоуком end-to-end**: в dev нет
    ключей провайдеров, поэтому реальные инкременты `run_cost_total`/
    `agent_step_duration_seconds` покрыты только unit-тестами с моками.
11. **Нет exemplars/trace_id в метриках** — корреляция «метрика ↔ OTel-трейс»
    в Grafana недоступна (часть KI-581, отдельной задачи не заводили).
12. **`/metrics` под глобальным ThrottlerGuard** (300 req/min): для
    стандартного скрейпа хватает, но при частом опросе с одного IP возможен
    429; вариант — `@SkipThrottle` или отдельный лимит (KI-575).
13. **Косметическая несогласованность импортов `performance`**: глобальный в
    интерсепторе, `node:perf_hooks` в движке/агенте; поведение одинаковое.
14. **Prettier на HEAD не чист** — массового переформатирования не делали (как
    и в прошлых сессиях), гейты — `oxlint` и `tsc`.
15. **Docs-дефект HEAD (исправлен):** дубли KI-565..573 и статусы
    «Planned (S5)», не входящие в легенду; реестр пересчитан (569 записей,
    уникальные номера, сводка по grep). К коду отношения не имеет.

---

## 6. Новые KI

Всего **9**: KI-574..582 (реестр пересчитан grep'ом, RULES 3.20: **569**
записей, 569 статусов, номера уникальны).

| KI | Приоритет | Статус | Кратко |
|---|---|---|---|
| [KI-574](../../../KNOWN_ISSUES.md) | 🟢 Low | Open | `prom-client` deprecated upstream — миграция на `@prometheus-io/client` |
| [KI-575](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `/metrics` без auth — защита только сетевым периметром (scrape-сеть) |
| [KI-576](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | `agent_step_duration_seconds` без status/error label — отказы не наблюдаются |
| [KI-577](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Агентский `llm_call` (второй платный вызов) не инструментирован |
| [KI-578](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Переиспользованные узлы (KI-046) считаются completed с ~0 с |
| [KI-579](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Реестр на процесс: multi-instance скрейп на стороне Prometheus |
| [KI-580](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Fallback-нормализация route заменяет только UUID |
| [KI-581](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Нет default process-метрик и моста OTel→Prometheus |
| [KI-582](../../../KNOWN_ISSUES.md) | 🟢 Low | Documented | Дашбордов/алертов Grafana и scrape-config в репозитории нет |

Закрытых KI в S4 нет (новый срез). Сводка реестра: 242 Fixed +
1 Fixed(частично) + 278 Open + 35 Documented + 1 Documented(не
воспроизводится) + 6 Planned + 2 Deferred + 4 Won't Fix = **569**.
Обновлены `docs/CHANGELOG.md` (`[Unreleased]`: Added/Changed/Security/
Documented) и `docs/KNOWN_ISSUES.md` (раздел S4 + сводка + удаление дублей S3).

---

## 7. Обоснование решений

### 7.1 Почему собственный `Registry`, а не глобальный

Глобальный реестр `prom-client` — процесс-синглтон: второй экземпляр сервиса
(тесты, вложенные приложения) падает на повторной регистрации, а любые
библиотеки/коллекторы, использующие глобальный `register`, автоматически
попадают в `/metrics`. Собственный реестр даёт предсказуемую экспозицию,
изоляцию тестов и контроль над набором метрик; цена — `collectDefaultMetrics`
и сторонние метрики нужно подключать явно (KI-581).

### 7.2 Почему глобальный интерсептор, а не middleware/декораторы

`APP_INTERCEPTOR` даёт доступ к Nest-контексту (`response.statusCode`,
`request.route`) и не требует правок контроллеров; новые ручки измеряются
автоматически. `finalize` выбран вместо `tap`/`mergeMap`, потому что он
срабатывает и при успехе, и при ошибке, и при отмене клиентом, не меняя
исходный observable (важно для SSE/файловых ответов). Middleware не видит
итоговый статус после `@HttpCode`/фильтров; декораторы пришлось бы добавлять
на каждую ручку.

### 7.3 Почему route-подпись — шаблон

Prometheus label — это измерение: `/workflow/<uuid>` создаёт серию на каждый
объект и «взрывает» память приложения и Prometheus. `request.route.path` даёт
зарегистрированный шаблон бесплатно; fallback нормализует UUID. Остаточный
риск не-uuid id зафиксирован в KI-580 и не наблюдается в текущем runtime.

### 7.4 Почему `/metrics` без auth

DESIGN § 3.3 прямо требует эндпоинт для скрейпера без авторизации: Prometheus
не умеет пользовательские JWT, а basic-auth/токен — это конфигурация
промышленного окружения, не приложения. Экспозиция содержит только агрегаты
(подписи ограничены), поэтому риск утечки данных минимален; главное требование
— не публиковать ручку наружу (KI-575). Альтернатива «auth по токену» сломала
бы стандартный scrape-config и требует секретов в Prometheus.

### 7.5 Почему `@Global()` модуль

`ExecutionEngineService` и `AgentService` — глубокие сервисы (создаются
EngineModule/AgentModule и в интеграционных спеках), и добавлять `MetricsModule`
в `imports` каждого модуля ради инфраструктурной зависимости — лишний дифф.
`@Global()` (как `DbModule`, `CostBudgetModule`) даёт сервис везде;
`MetricsInterceptor` при этом регистрируется явно в `AppModule`, чтобы порядок
с `AuditInterceptor` был виден в одном месте.

### 7.6 Почему стоимость пишется только после успешного UPDATE

Метрика `run_cost_total` — про **завершённые** операции. Если публикация
`node_completed` упадёт после ответа провайдера, узел станет `failed`:
списывать его стоимость в счётчик означало бы считать деньги за неуспешный узел.
Поэтому наблюдение — после успешной записи `node_runs` и события; retries
(промежуточные попытки) и KI-046-reuse исключены по построению.

### 7.7 Почему в агенте замеряется только основной шаг

`agent_step_duration_seconds` по контракту S4 — длительность шага LLM-цикла
агента (`model`), то есть основного вызова, который принимает решение. Tool-
вызовы (включая вложенный `llm_call`) — отдельные операции с другим профилем
latency/цены; смешивать их в одной гистограмме значило бы исказить
распределение. Расширение — отдельная метрика (KI-577).

### 7.8 Почему переиспользованные узлы попадают в completed-гистограмму

Контракт S4 — «в `executeNodeAsync` замеряй время выполнения узла». KI-046
делает reuse внутри `executeNodeRunAsync` и возвращает результат почти сразу:
узел действительно «завершён» с точки зрения запуска, поэтому наблюдение
completed формально корректно, но для дашбордов по количеству executions это
завышение. Решение (skip/label) требует изменения контракта метрики — вынесено
в KI-578, чтобы не менять S4-контракт задним числом.

### 7.9 Почему запись метрик best-effort

Метрики — вспомогательная подсистема (RULES 4.18): `observe*` в интерсепторе
обёрнут в `try/catch` с `Logger.warn`, в движке/агенте `observe*` синхронны и
не бросают при валидных значениях. Ответ пользователю не должен зависеть от
того, доступен ли реестр/экспорт; цена — возможная потеря отдельной записи
метрики, что для гистограмм допустимо.

### 7.10 Почему в тестах контроллера проверяются компоненты Content-Type

Express нормализует/переставляет параметры MIME при отправке
(`version` уезжает в конец), поэтому пиннинг полной строки на HTTP-уровне был
бы тестом Express, а не нашего кода. Unit-тест сервиса фиксирует
`registry.contentType`, контроллерный supertest проверяет наличие
`text/plain`/`version=0.0.4`/`charset`, а смоук — фактический ответ живого
сервера. Так тесты не ломаются от смены порядка параметров.

### 7.11 Почему `prom-client`, несмотря на deprecation

Постановка S4 явно требует `pnpm add prom-client`; библиотека работает,
поддерживает нужный API (`Registry/Histogram/Counter`) и формат 0.0.4.
Mitigation: версия зафиксирована в `package.json`, deprecation и план миграции
на `@prometheus-io/client` зафиксированы в KI-574, чтобы решение не потерялось
при следующем обновлении зависимостей.

### 7.12 Почему не включены default process-метрики

`collectDefaultMetrics` добавляет ~10 метрик (CPU, RSS, event loop, GC) и
требует аккуратной настройки префиксов/памяти, а DESIGN § 2.3 перечисляет
только кастомные. Для S4 оставлен минимальный контракт «4 метрики», чтобы не
расширять поверхность без запроса; стандартные process-метрики и мост
OTel→Prometheus вынесены в KI-581.
