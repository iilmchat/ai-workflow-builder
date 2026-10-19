---
title: "S10+S11: Retry & Agent Metrics"
date: 2026-10-19
version: v0.11.0
steps: [S10, S11]
status: accepted
related_ki: [KI-104, KI-433]
related_adr: []
---

# Отчёт S10+S11 — Retry & Agent Metrics

**Статус:** реализовано; код и тесты лежат в рабочем дереве, коммитов в этой
сессии нет (`git add -A` не использовался). BUILD/TYPE тайпчек/тесты — зелёные,
smoke на живой PostgreSQL 17 + Redis 7 пройден.

**Важно про точку старта.** К HEAD `86a5295` часть задач промпта уже была
реализована в S7 (MCP, side-effect retry policy) и v0.10.2 (KI-433: базовые
токены/стоимость агента, `kind: 'agent'`). Поэтому пакет не дублирует готовое:
S10 закрывает **недостающую** половину retry (единый guard, media-ошибки,
env-конфиг, backoff/jitter/`Retry-After`), S11 — **кэш-метрики** агента и
единый маппер метрик. Подробности — § 3.1 и § 5.1.

---

## 1. Файлы (+/−)

Сравнение с HEAD `86a5295`, только код (15 изменённых + 5 новых файлов):

| Файл | +/− | Что |
|---|---:|---|
| [src/common/errors/retryable-provider.error.ts](../../../../src/common/errors/retryable-provider.error.ts) *(new)* | +51 / −0 | `RetryableProviderError` (DESIGN § 3.3.2) и структурный guard `isRetryableProviderError` |
| [src/common/errors/retryable-provider.error.spec.ts](../../../../src/common/errors/retryable-provider.error.spec.ts) *(new)* | +97 / −0 | 7 тестов guard'а: структурность, оба поля, реальные LLM/media-исключения, `RetryableNodeException` |
| [src/common/utils/retry-after.ts](../../../../src/common/utils/retry-after.ts) *(new)* | +56 / −0 | Разбор `Retry-After` (delta-seconds и HTTP-дата) → мс |
| [src/common/utils/retry-after.spec.ts](../../../../src/common/utils/retry-after.spec.ts) *(new)* | +35 / −0 | 3 теста: секунды, дата, мусор/прошлое |
| [src/llm/llm-provider.interface.ts](../../../../src/llm/llm-provider.interface.ts) | +23 / −1 | `LlmProviderException`: `readonly provider`, `retryAfterMs` |
| [src/llm/provider-errors.ts](../../../../src/llm/provider-errors.ts) | +49 / −2 | Извлечение `Retry-After` из `error.headers` (Headers и словарь), передача в исключение |
| [src/llm/providers/anthropic.provider.spec.ts](../../../../src/llm/providers/anthropic.provider.spec.ts) | +31 / −0 | 2 теста: `retryAfterMs` из `Headers` и из словаря |
| [src/media/media-provider.interface.ts](../../../../src/media/media-provider.interface.ts) | +19 / −1 | `MediaProviderException`: `retryAfterMs` |
| [src/media/providers/provider-http.ts](../../../../src/media/providers/provider-http.ts) | +8 / −2 | `buildHttpErrorAsync` заполняет `retryAfterMs` из ответа |
| [src/media/providers/provider-http.spec.ts](../../../../src/media/providers/provider-http.spec.ts) *(new)* | +60 / −0 | 429/503/401 и `isRetryableStatus` |
| [src/media/providers/creativelab.provider.ts](../../../../src/media/providers/creativelab.provider.ts) | +25 / −2 | `retryAfterMs` для 429/5xx CreativeLab (default-ветка и каталог) |
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +24 / −4 | `NODE_RETRY_DEFAULTS` — единый источник дефолтов для Zod-схемы и движка |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +265 / −86 | env-настройки retry в конструкторе, `isRetryableProviderError \|\| isRetryableNodeError`, `calculateRetryDelayMs` (экспонента + jitter + `Retry-After`), `toNodeRunMetrics`, запись кэш-метрик агента |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +162 / −16 | 3 S10-теста (media 429→3, media 401→1, `retryAfterMs`), обновлён KI-433-тест (кэш агента), `kind: 'plain'` в spy-фикстурах |
| [src/engine/node-executors.ts](../../../../src/engine/node-executors.ts) | +14 / −31 | Локальные типы метрик убраны: `AgentNodeExecution`/`AgentNodeMetrics` из `agent.types`, реэкспорт типа сохранён |
| [src/engine/agent-node-executor.spec.ts](../../../../src/engine/agent-node-executor.spec.ts) | +23 / −6 | Фикстуры `AgentRunResult`/`AgentNodeExecution` с кэш-полями |
| [src/agent/agent.types.ts](../../../../src/agent/agent.types.ts) | +71 / −1 | `AgentUsage` с кэш-токенами, `AgentNodeMetrics`, `AgentNodeExecution` (поле `metrics`), `AgentRunResult.cacheReadTokens/cacheCreationTokens` |
| [src/agent/agent.service.ts](../../../../src/agent/agent.service.ts) | +49 / −14 | `sumNullable`, агрегация `cacheReadTokens`/`cacheCreationTokens`, плоские кэш-поля в `buildResult` |
| [src/agent/agent.service.spec.ts](../../../../src/agent/agent.service.spec.ts) | +54 / −2 | Новый тест агрегации кэша; обновлены ожидания `usage` |
| [src/agent/agent.integration.spec.ts](../../../../src/agent/agent.integration.spec.ts) | +6 / −1 | Ожидание `usage` с кэш-полями |

**Итого код:** 20 файлов, **+1122 / −169** (из них 5 новых файлов: +299).

Документация (этот пакет):

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +17 / −1 | `[Unreleased] → Added/Fixed`: записи S10 и S11 со ссылками на отчёт |
| [docs/development/reports/README.md](../README.md) | +1 / −0 | строка отчёта S10-S11 |
| `docs/development/reports/v0.11.0/S10-S11-retry-metrics.md` *(new)* | +483 | этот отчёт |

Временный smoke-скрипт `.smoke/s10-s11-smoke.mjs` и его артефакты
(`s10-s11-app.log`, `s10-s11-smoke-report.json`) лежат в `.smoke/` (gitignored) —
не часть deliverable, но оставлены как доказательство § 4.

Зависимости и миграции не менялись; `.env.example` и `EnvSchema` уже содержали
`NODE_RETRY_*` с S1 — менялся только способ чтения в движке.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** · `pnpm typecheck` — **0** ·
`pnpm test` — **96 файлов passed / 3 skipped, 1379 passed / 18 skipped** ·
`pnpm lint` — **0 errors, 1 warning** (pre-existing, S4: неиспользуемый
`DocumentTemplateNotFoundException` в `src/engine/node-executors.ts`).

Прирост к состоянию S9 (93 файла / 1359 passed): **+3 spec-файла и +20 тестов**
(7 guard + 3 retry-after + 4 provider-http + 2 `retryAfterMs` в Anthropic +
3 engine retry + 1 agent cache; один тест `agent-node-executor` расширен без
увеличения числа). Skipped — прежние DB-интеграционные и e2e-спеки без своего
окружения.

---

## 3. Диагностика

1. **Часть S10/S11 уже была реализована до этого пакета.** `isSideEffectingTool`
   и `AgentRunException`-guard появились в S7 (MCP, DESIGN § 3.3.2), а
   `kind: 'agent'` и запись `tokens_in/out/cost_usd` — в v0.10.2 (KI-433). Я не
   создавал вторые копии: guard и его тесты (side-effect → `AgentRunException`,
   read-only → проброс `LlmProviderException`) уже покрыты
   `agent.service.spec.ts`, поэтому в S10 они только проверены и отражены в
   отчёте; новые тесты добавлены для недостающего (media-retry, env/задержка,
   кэш-метрики).
2. **Конфликт имён типов агента.** В HEAD метрики агента жили в
   `node-executors.ts` как `AgentNodeExecutionMetrics`, а `AgentNodeExecution`
   имел поле `usage`. DESIGN § 3.4.1 требует `AgentNodeMetrics` в
   `agent.types.ts` и поле `metrics`. Сделано: тип переехал в
   `agent.types.ts`, `AgentNodeExecution.usage` переименован в `.metrics`;
   обновлены движок и три спека. Промежуточный вариант «оставить оба имени» дал
   бы два источника правды, поэтому не выбран.
3. **`NODE_RETRY_*` уже были в `EnvSchema` (S1), но движок их не читал.**
   Константы `NODE_MAX_ATTEMPTS=3`/`NODE_RETRY_BASE_DELAY_MS=500` заменены
   полями конструктора. Для тестов и прямого конструирования сервиса
   `ConfigService.get()` может вернуть `undefined`, поэтому значения
   нормализуются `readRetryOption` с дефолтами из нового
   `NODE_RETRY_DEFAULTS` — **один** источник чисел и для Zod-схемы, и для
   движка (иначе 3/500/10000/250 дублировались бы в двух файлах).
4. **`randomInt(0, 0)` бросает `RangeError`.** Env допускает
   `NODE_RETRY_JITTER_MS=0`, поэтому при нулевом джиттере `randomInt` не
   вызывается вовсе. Это не теоретический случай: отключить джиттер — штатный
   способ сделать поведение детерминированным.
5. **`Retry-After` встречается в двух форматах.** `parseRetryAfterMs` понимает
   delta-seconds (`105`, `0.5`) и HTTP-дату (`Wed, 21 Oct … GMT`); для даты
   параметр `nowMs` вынесен в сигнатуру, чтобы тест не зависел от системных
   часов. Отрицательное значение (`-5`) отсекается **до** `Date.parse`:
   `Date.parse('-5')` трактует строку как дату, и без проверки smoke-тест
   получал `0` вместо «заголовок невалиден».
6. **`error.headers` у SDK — не всегда `Headers`.** Anthropic/OpenAI SDK кладут
   `Headers`, но часть обёрток/прокси отдаёт словарь. Извлечение сделано
   структурным: `instanceof Headers` → `.get('retry-after')`, иначе
   `record['retry-after'] ?? record['Retry-After']`. Оба варианта покрыты
   тестами Anthropic-провайдера.
7. **Двойной retry: SDK + движок (обнаружено smoke'ом).** OpenAI SDK по
   умолчанию повторяет 429/5xx (`maxRetries=2`), поэтому один attempt движка =
   до 3 запросов к upstream; при 3 attempt'ах движка — до 9 запросов. В первом
   прогоне smoke из-за этого «3 попытки» прошли **внутри SDK**, а
   `node_runs.logs` остались пустыми (движок увидел лишь успех). Smoke
   перестроен: upstream отвечает 429 на первые 8 запросов, 9-й — успешен;
   теперь видно ровно 2 retry-строки движка и 9 upstream-вызовов. Это отдельная
   проблема бюджета — кандидат KI-500 (§ 6), в рамках S10 не чинилась
   (изменение `maxRetries` у SDK — отдельное решение).
8. **Spy-тесты `runNodeAsync` и исчерпывающий маппер.** После появления
   `toNodeRunMetrics(step)` движок читает `step.kind`/`step.metrics`; старые
   spy-фикстуры возвращали `{ outputs, metrics: null }` без `kind`, и в рантайме
   маппер возвращал `undefined`. Исправлено в тестовом типе `FakeNodeStep`
   (`kind: 'plain'`) — это честно повторяет контракт движка, а не ослабляет
   продакшен-код до `switch` с `default`.
9. **`node_runs`-фейк в engine-спеке не знал кэш-колонок.** Тип `FakeNodeRun`
   расширен `cacheReadTokens`/`cacheCreationTokens`, а `seedNodeRun` их
   проставляет — иначе typecheck падал на неполной строке. Реальный UPDATE
   пишет их через spread `...toNodeRunMetrics(step)`.
10. **`retryAfterMs` заполняется не только в `buildHttpErrorAsync`.** CreativeLab
    собирает ошибки вручную (`taskErrorAsync`, ответ каталога), поэтому
    подсказка добавлена и там; иначе 429 от GPTunnel ждал бы экспоненту, а не
    `Retry-After`. Остальные ручные ветки media-ошибок — не HTTP-ответы
    (валидация входа, отсутствие ключа), подсказки там нет по смыслу.
11. **Ожидание промпта «невалидный ключ → 3 попытки» не подтвердилось.** 401 —
    детерминированная ошибка, DESIGN § 3.3.2 и S10-критерий говорят «401 → 1
    попытка». Smoke это подтверждает: `gpt-4o-mini` → 401 → 1 upstream-вызов,
    `node_runs.logs` пуст, запуск `failed` с текстом 401. Retry-сценарий проверен
    на 429 (`Retry-After`).
12. **CRLF-предупреждение git по `execution-engine.service.spec.ts`.** Файл
    перезаписывался PowerShell (`Set-Content`) при массовой правке фикстур; на
    диске он уже был CRLF, `.gitattributes` нормализует в LF при коммите. Diff
    остался точечным (162/16), не «весь файл».
13. **Prettier.** HEAD-файлы не fully prettier-clean (та же ситуация, что в
    S0-S1/S9), поэтому форматировал новые файлы и правил существующие точечно,
    держа стиль окружающего кода — без несвязанного churn.

---

## 4. Smoke (живые PostgreSQL 17 + Redis 7 + BullMQ worker)

Запуск: `node --env-file=.env .smoke/s10-s11-smoke.mjs` → `dist/main.js` на
`PORT=3199` (`AUTH_DISABLED=true` только на время smoke), локальный
OpenAI-совместимый заглушечный сервер на случайном порту (`OPENAI_BASE_URL`
→ `127.0.0.1`, ключ-заглушка `smoke-test-key`). Retry-настройки — штатные:
`NODE_RETRY_MAX_ATTEMPTS=3`, `BASE_DELAY=500`, `MAX_DELAY=10000`, `JITTER=250`.

Заглушка: `gpt-4o` → первые **8** запросов `429` с `Retry-After: 1`, 9-й —
`200` (usage: 100/20, `cached_tokens: 40`); `gpt-4o-mini` → всегда `401`.

### Сценарий 1 — LLM-узел, 429 → повтор узла

| Проверка | Результат |
|---|---|
| `workflow_runs.status` | `completed` |
| `node_runs.status` | `completed`, `error = null` |
| `node_runs.logs` | `попытка 1/3 … повтор через 1124 мс`; `попытка 2/3 … повтор через 1038 мс` (в предыдущем прогоне — 1055/1104 мс) |
| Задержка и `Retry-After` | обе паузы в диапазоне **1000–1249 мс** = `max(500·2^n, 1000) + jitter[0,250)` — подсказка провайдера победила экспоненту |
| `tokens_in` / `tokens_out` | **100 / 20** |
| `cost_usd` | **0.000400** (gpt-4o: 100 вх. + 20 вых.; кэш-скидка учтена) |
| `cache_read_tokens` / `cache_creation_tokens` | **40 / null** |
| Запросов к upstream | **9** = 3 attempt'а движка × 3 запроса SDK (`maxRetries=2`), см. § 3.7 |

### Сценарий 2 — LLM-узел, 401 (детерминированная ошибка)

| Проверка | Результат |
|---|---|
| `workflow_runs.status` | `failed` |
| `node_runs.status` | `failed`, `error = "[openai] 401 invalid api key (smoke 401)"` |
| `node_runs.logs` | **[]** — повторов нет |
| Запросов к upstream | **1** |
| Лог приложения | 2 ERROR-строки (`узел упал`, `запуск упал`) — ожидаемо для FAILED-сценария |

### Сценарий 3 — Agent-узел, метрики в `node_runs` (S11)

| Проверка | Результат |
|---|---|
| `workflow_runs.status` / `node_runs.status` | `completed` / `completed` |
| `node_type` | `agent` |
| `tokens_in` / `tokens_out` | **100 / 20** |
| `cost_usd` | **0.000400** |
| `cache_read_tokens` | **40** — до S11 колонка была `NULL` |
| `cache_creation_tokens` | `null` (OpenAI не отдаёт cache creation) |
| `node_runs.logs` | 2 JSON-шага: `llm` (с `usage.cacheReadTokens=40`) и `final` (`smoke-agent-ok`) |

### Итог smoke

Все 18 булевых проверок — `true`, exit code **0**. Пустые `logs` у 401 —
ожидаемое поведение, а не пропуск проверки (наличие повтора проверяется
сценарием 1). Json-отчёт прогона: `.smoke/s10-s11-smoke-report.json`.

**Что smoke не проверил:** media-узел (429 media-провайдера) на живой БД —
media-путь требует каталога моделей и платного провайдера; media-retry проверен
unit-тестом движка (`MediaProviderException` → 3 попытки / 401 → 1). SSE-поток
с `node_completed` отдельно не снимался — те же значения проверяются
unit-тестом события.

---

## 5. Что не так

1. **Часть промпта уже была сделана.** Пункт S10.4 (`isSideEffectingTool` +
   guard) и большая часть S11.3 (`kind: 'agent'`, токены/стоимость в
   `node_runs`) реализованы раньше — в S7 и v0.10.2. Пакет не переделывал
   работающее; в отчёте это зафиксировано, чтобы при ревью не искать «где же
   новый код S10.4».
2. **Двойной retry SDK + движок (главная находка).** `OpenAI`/`Anthropic` SDK
   повторяют 429/5xx сами (`maxRetries=2`), движок — ещё до 3 раз. Итог: до
   **9** upstream-запросов на один узел и до 9 оплат вместо 3. Смок это
   поймал: первый прогон показал 3 upstream-вызова, но пустые `logs` движка —
   успех пришёл из внутреннего retry SDK. Кандидат KI-500 (§ 6). Решение
   (выставить `maxRetries: 0` в SDK или сделать env-флаг) не принято в S10:
   это меняет поведение всех LLM-провайдеров и заслуживает отдельного шага.
3. **Одноимённые guard'ы.** В `src/llm/provider-errors.ts` уже есть
   `isRetryableProviderError(error, signal)` — классификатор SDK-ошибок, а в
   `src/common/errors/retryable-provider.error.ts` теперь
   `isRetryableProviderError(error)` — контракт движка. Семантика и сигнатуры
   разные, имена одинаковые: риск импортировать «не тот». Кандидат KI-501
   (переименовать первый в `isRetryableSdkError`).
4. **Промпт противоречит DESIGN по smoke-ожиданию.** «LLM узел с невалидным
   ключом → 3 попытки и падение» невозможно по DESIGN: 401 — non-retryable,
   S10-критерий прямо говорит «401 → 1 попытка». Сделано по DESIGN, факт
   зафиксирован в § 4.
5. **`cacheSavingsUsd` агента не попадает в SSE-событие.** В `node_completed`
   поле остаётся `null` (в снимке `run-node-snapshots` оно пересчитывается по
   `data.model`). Живая панель агента покажет кэш-токены, но экономию — только
   после обновления снимка. Кандидат KI-503.
6. **Нет DB-интеграционного спека на кэш-колонки.** `execution-engine.service.spec`
   использует in-memory двойник Drizzle: тип колонок и `numeric(12,6)`
   проверяются как строки в фейке, но реальный `UPDATE … node_runs` с
   `cache_read_tokens`/`cache_creation_tokens` исполняется только smoke'ом.
   Аналогично KI-318/KI-496. Кандидат KI-502.
7. **Env-переопределение retry в движке не покрыто тестом.** Дефолты
   (`NODE_RETRY_DEFAULTS`) и границы проверяет `env.schema.spec`, поведение
   повторов — engine-спек с дефолтным `ConfigService`-стабом. Отдельного теста
   «`NODE_RETRY_MAX_ATTEMPTS=2` → 2 попытки в движке» нет: полноценная сборка
   второго Nest-модуля в том же файле дублировала бы 20 провайдеров ради одной
   проверки. Кандидат KI-504 (Low, тестовый долг).
8. **`Retry-After` в media-провайдерах заполняется не везде.** Replicate/FAL/
   OpenAI Images идут через `buildHttpErrorAsync` — там есть; CreativeLab — в
   двух ветках. Ручные ветки `media-node-executor.service.ts` (валидация входа,
   «модель не поддерживается») не HTTP-ответы, поэтому подсказки нет — это
   корректно, но список мест легко забыть при добавлении нового провайдера.
9. **`LlmProviderException.retryAfterMs` переносится только когда ошибка
   retryable.** Для 401/400 подсказка бесполезна (повтора нет), поэтому в
   `toProviderException` она не извлекается намеренно; это покрыто тестом
   «401 → не повторяется», но не тестом «у 401 нет hint».
10. **`sleep` не отменяется при shutdown.** Пауза между повторами — обычный
    `setTimeout`; при SIGTERM worker дождётся её (до `NODE_RETRY_MAX_DELAY_MS`
    = 10 с) и только потом умрёт. Для штатного graceful shutdown это приемлемо,
    но BullMQ-лок может истечь; отдельного AbortSignal в `sleep` нет — было и
    до S10, не расширял.
11. **Smoke использует dev-переключатели** `AUTH_DISABLED=true` и локальный
    `OPENAI_BASE_URL` с ключом-заглушкой. В проде оба выключены; на код S10/S11
    не влияют. Реальный внешний провайдер не вызывался.
12. **Pre-existing lint warning** (`DocumentTemplateNotFoundException` не
    используется в `node-executors.ts`) остался из S4 — вне scope S10/S11;
    `pnpm lint` всё равно 0 errors.

---

## 6. Новые KI

Номера — по текущему максимуму реестра (**KI-499**), в `docs/KNOWN_ISSUES.md`
**не вносил**: нумерацию подтверждает пользователь (практика S0-S1/S4-S5/S9).
Кандидаты:

1. **KI-500-кандидат (High, стоимость/надёжность).** Двойной retry LLM:
   `OpenAI`/`Anthropic` SDK повторяют 429/5xx сами (`maxRetries=2`), движок —
   до `NODE_RETRY_MAX_ATTEMPTS` раз. Worst case — 9 upstream-вызовов/оплат на
   один узел; `node_runs.logs` показывает 3 попытки, а провайдер видит 9.
   Решение: `new OpenAI({ maxRetries: 0 })` / `new Anthropic({ maxRetries: 0 })`
   (или env-флаг), чтобы retry-политику определял только движок.
   Обнаружено smoke'ом S10 (§ 3.7, § 5.2).
2. **KI-501-кандидат (Low, читаемость).** Два экспорта с именем
   `isRetryableProviderError`: классификатор SDK-ошибок в
   `src/llm/provider-errors.ts` (`error, signal`) и контракт движка в
   `src/common/errors/retryable-provider.error.ts` (`error`). Решение:
   переименовать первый в `isRetryableSdkError`.
3. **KI-502-кандидат (Low, тесты/CI).** Нет DB-интеграционного спека, который
   исполняет реальный `UPDATE node_runs` с кэш-колонками для LLM/agent на живой
   PostgreSQL (юнит-тест и smoke — разные уровни; smoke в CI не гоняется).
   Решение: spec по образцу `schema-parity`/`media-storage.integration`.
4. **KI-503-кандидат (Low, наблюдаемость).** `node_completed` для `kind:
   'agent'` не содержит `cacheSavingsUsd` (у LLM-узла содержит), поэтому живая
   панель показывает экономию агента только после перезагрузки снимка.
   Решение: считать экономию по модели узла в движке (метрика агента сейчас не
   несёт `model`) или расширить `AgentNodeMetrics` полем `model`.
5. **KI-504-кандидат (Low, тестовый долг).** Нет теста «env `NODE_RETRY_*` →
   поведение движка» (чтение в конструкторе проверяется только дефолтами и
   Zod-схемой). Решение: вынести список провайдеров engine-спека в фабрику
   `createEngineModule(env)` и параметризовать `NODE_RETRY_MAX_ATTEMPTS`.

**KI-104 закрывается этим пакетом** (единый retry-маркер + media-retry
реализованы и проверены unit + smoke). Запись реестра в S10 не правил по
практике предыдущих сессий. Точечный diff для закрытия (RULES 2.12):

**Найти** (блок KI-104, целиком):
```text
### KI-104 — Повтор узла учитывает только LLM-исключения
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-14
- **Файлы:** `src/engine/execution-engine.service.ts`
- **Описание:** В `executeNodeAsync` условие повтора:
  `error instanceof LlmProviderException && error.retryable`. Для
  media-узла временная ошибка (429/5xx/таймаут, где
  `MediaProviderException.retryable = true`) повтора **не получит** —
  узел сразу `failed`. Поле `retryable` у media **декоративно**.
- **Решение:** обобщить на «провайдерская ошибка с `retryable`»:
  общий интерфейс / бренд (`LlmProviderException`,
  `MediaProviderException`).
- **Когда чинить:** v0.6.0b.2.3 или отдельным микро-шагом.
- **Связанные:** KI-036.
```
**Заменить на:**
```text
### KI-104 — Повтор узла учитывает только LLM-исключения
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-14
- **Исправлено в:** v0.11.0 (S10)
- **Fix:** структурный guard `isRetryableProviderError`
  (`src/common/errors/retryable-provider.error.ts`), которому удовлетворяют
  `LlmProviderException` и `MediaProviderException` (`provider` + `retryable` +
  `retryAfterMs`); движок проверяет
  `isRetryableProviderError(error) || isRetryableNodeError(error)`, а задержка
  считается как
  `min(NODE_RETRY_MAX_DELAY_MS, max(base·2^(n−1), retryAfterMs) + jitter)`
  (env `NODE_RETRY_*`, Zod-схема S1). Media 429 → 3 попытки, 401 → 1; smoke на
  живой БД подтверждает паузу по `Retry-After`.
- **Файлы:** `src/common/errors/retryable-provider.error.ts`,
  `src/engine/execution-engine.service.ts`,
  `src/llm/llm-provider.interface.ts`,
  `src/media/media-provider.interface.ts`.
- **Связанные:** KI-036, KI-500.
```
Сводку после закрытия пересчитать grep'ом (RULES 3.20): `Open −1`, `Fixed +1`,
итог не меняется.

**KI-433** уже `Fixed` (v0.10.2). S11 — расширение, а не переоткрытие; при
желании в запись можно добавить строку (не обязательно):

**Найти:** `- **Исправлено в:** v0.10.2 — \`executeAgentNodeAsync\` возвращает \`usage\``
**Заменить на:** `- **Исправлено в:** v0.10.2 — \`executeAgentNodeAsync\` возвращает \`usage\``
и следующей строкой `- **Дополнено в:** v0.11.0 (S11) — кэш-токены
(\`cacheReadTokens\`/\`cacheCreationTokens\`) пишутся в
\`node_runs.cache_*\`, тип \`AgentNodeMetrics\`, маппер \`toNodeRunMetrics\`.`.

---

## 7. Обоснование решений

1. **Строго по DESIGN § 3.3.2/§ 3.4.1.** Сигнатуры `RetryableProviderError`,
   формула задержки, env-имена, `toNodeRunMetrics` и таблица side-effect
   инструментов воспроизведены из дизайна; отступления (§ 3.2 — переименование,
   § 3.3 — `NODE_RETRY_DEFAULTS`) продиктованы фактическим состоянием HEAD.
2. **`NODE_RETRY_DEFAULTS` в `env.schema.ts`, а не литералы в двух местах.**
   Схема уже имеет дефолты; движку они нужны как fallback, когда
   `ConfigService` вернул `undefined` (юнит-тесты, прямое конструирование).
   Экспорт констант из `env.schema.ts` оставляет один источник чисел; при
   изменении дефолта схема и движок не разойдутся молча.
3. **`randomInt` из `node:crypto`, не `Math.random`.** Задержка влияет на
   «толпу» параллельных повторов; криптостойкость не нужна, но `node:crypto`
   не тянет зависимостей, синхронен и уже используется в проекте. Главное —
   guard на `jitterMs=0` (иначе `RangeError`, см. § 3.4).
4. **Потолок `NODE_RETRY_MAX_DELAY_MS` применяется и к `Retry-After`.** Если
   upstream просит «подожди 2 минуты», узел не должен спать 2 минуты внутри
   одного запуска: лучше повторить раньше (и, возможно, снова получить 429) или
   отдать запуск в job-level retry. Это ровно формула DESIGN.
5. **`retryAfterMs` — поле исключения, а не возврат провайдера.** Подсказка
   приходит в HTTP-заголовке ошибки, то есть в момент исключения; провайдер не
   может «вернуть» её отдельно. Поле структурно доступно guard'у и движку без
   разбора текста ошибки.
6. **Разбор `Retry-After` вынесен в `common/utils`.** Логика нужна LLM- и
   media-слоям, а `common/errors` — про контракт ошибок, не про HTTP. Отдельная
   утилита тестируется без сети и провайдеров.
7. **Структурный guard вместо `instanceof`.** Так требуют DESIGN и KI-104:
   движок не должен импортировать media-модуль ради одного условия; будущий
   MCP/сторонний провайдер сможет реализовать интерфейс без наследования от
   наших классов. Тест «structural implementation» фиксирует это.
8. **`AgentNodeMetrics` переехал в `agent.types.ts`.** Это контракт агента, и
   его импортируют и исполнитель узла, и движок; `node-executors.ts` остаётся
   реестром исполнителей. Цикл импортов — только типовый (`import type`), как и
   прежний между этими файлами (RULES 4.2).
9. **`AgentNodeExecution.metrics` вместо `.usage`.** Имена `tokensIn/Out`
   совпадают с `AgentNodeMetrics`, и движок получает один тип для `kind:
   'agent'` и `metrics`. Компромисс «оставить `usage` как alias» создал бы две
   формы одного контракта; обновление трёх тестов дешевле.
10. **`sumNullable` и «частичная» сумма.** Если часть шагов не отдала
    кэш-метрику, сумма известных полезнее `null` на весь цикл — та же семантика
    уже принята для токенов (KI-407) и стоимости (KI-052). Отдельная функция
    убирает четыре почти одинаковых тернарника.
11. **Кэш-токены агента считаются по всем шагам, включая `llm_call`.** `llm_call`
    — платный вызов инструмента; его usage уже попадал в input/output/cost,
    значит и кэш должен попадать — иначе стоимость шага и метрики цикла
    разойдутся.
12. **`toNodeRunMetrics` включает `storageKey` и media-поля, хотя DESIGN
    перечисляет только метрики.** Иначе `UPDATE` пришлось бы оставить с ручным
    `step.kind === 'media' ? … : step.storageKey`, и «шесть условий» просто
    переехали бы в другое место. Хелпер — единственная точка маппинга шага в
    колонки; `cacheSavingsUsd` в него не входит, потому что это не колонка БД
    (в снимке пересчитывается, см. § 5.5).
13. **Событие `node_completed` берёт те же значения, что `UPDATE`.** Это
    требование KI-075: панель показывает метрики сразу и не должна расходиться
    с БД после F5. Кэш-токены агента теперь тоже попадают в событие.
14. **Тесты media-retry — на движке, а не на провайдере.** Проверяется контракт
    «движок видит `MediaProviderException.retryable`»; сам факт, что провайдер
    ставит `retryable` для 429/5xx, уже покрыт спеками провайдеров (S7 и
    `provider-http.spec`). Дублировать HTTP-мок на уровне движка незачем.
15. **`retryAfterMs`-тест проверяет диапазон, а не точное число.** Джиттер
    случаен по контракту; `expect(delay).toBe(3000)` был бы флаки. Проверка
    «≥ подсказки и < подсказка + джиттер» одновременно доказывает, что
    экспонента (500 мс) не победила подсказку (3000 мс).
16. **Smoke с локальной заглушкой, а не с реальным API.** Нужны управляемые
    429/401 и `Retry-After`; реальный провайдер даёт непредсказуемые ошибки и
    стоит денег. Заглушка поднимается на `127.0.0.1` внутри smoke-скрипта,
    `OPENAI_BASE_URL` — только на время прогона.
17. **Smoke-порог 8 запросов с 429.** Это следствие двойного retry SDK
    (KI-500): чтобы движок увидел 2 неудачных attempt'а, upstream должен
    отказать 8 раз (2 attempt'а × 3 SDK-запроса + 2 запроса начала третьего).
    Порог выбран по факту (`maxRetries=2`), а не «на глаз».
18. **Docs — минимально по RULES 2.1/2.18.** CHANGELOG-записи со ссылкой на
    отчёт, строка в `reports/README.md`, сам отчёт с YAML-frontmatter.
    `KNOWN_ISSUES` не правил: номера KI подтверждает пользователь, точечные diff
    даны в § 6 (RULES 2.12). Релизные гайды (`USER_GUIDE`/`QA`) — S17, RULES 2.16.

---

## Черновик commit message (не коммитил)

```text
feat(v0.11.0): S10+S11 — retry marker & agent metrics

S10 (KI-104, DESIGN § 3.3.2):
- common/errors/retryable-provider.error.ts: RetryableProviderError +
  структурный isRetryableProviderError (LLM + media, без instanceof).
- LlmProviderException.provider + retryAfterMs; MediaProviderException.retryAfterMs;
  заполнение из Retry-After в provider-errors, provider-http, creativelab.
- common/utils/retry-after.ts: delta-seconds и HTTP-дата → мс.
- ExecutionEngineService: NODE_RETRY_* из ConfigService (NODE_RETRY_DEFAULTS),
  isRetryableProviderError || isRetryableNodeError,
  delay = min(maxDelay, max(base·2^(n-1), retryAfterMs) + jitter),
  randomInt-guard при jitter=0.
- Тесты: guard (+7), retry-after (+3), provider-http (+4), anthropic hint (+2),
  engine media 429→3 / 401→1 / retryAfterMs (+3).

S11 (KI-433, DESIGN § 3.4.1):
- AgentUsage/AgentRunResult: cacheReadTokens, cacheCreationTokens;
  AgentService.sumNullable + агрегация кэша в usage и плоских метриках.
- agent.types: AgentNodeMetrics; AgentNodeExecution.metrics вместо usage.
- ExecutionEngineService.toNodeRunMetrics: единый маппинг LLM/agent/media/plain
  в node_runs и node_completed (кэш-токены агента теперь пишутся).
- Тесты: аггрегация кэша (+1), node_runs agent cache/tokens/cost (обновлён).

Docs: reports/v0.11.0/S10-S11-retry-metrics.md, reports/README, CHANGELOG.

Smoke: локальный OpenAI-совместимый stub; 429+Retry-After → 3 попытки (9
upstream-вызовов из-за SDK maxRetries=2), 401 → 1, agent metrics в node_runs.

Refs: DESIGN v0.11 § 3.3.2, § 3.4.1, § 5 (S10, S11); KI-104, KI-433.
```
