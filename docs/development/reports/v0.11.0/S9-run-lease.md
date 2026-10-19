---
title: "S9: Run Lease / Heartbeat"
date: 2026-10-19
version: v0.11.0
steps: [S9]
status: accepted
related_ki: [KI-066]
related_adr: []
---

# Отчёт S9 — Run Lease / Heartbeat

**Статус:** реализовано; код и тесты лежат в рабочем дереве. Коммитов в этой сессии я
не делал (`git add -A` не использовался). Часть промежуточных файлов S9 случайно попала
в коммит пользователя `23dd939` — по его подтверждению это ошибка `git add src/`;
история git не переписывалась, см. § 5.1.

---

## 1. Файлы (+/−)

Сравнение с состоянием до S9 (HEAD `d9a797a`, до случайных коммитов), только код:

| Файл | +/− | Что |
|---|---:|---|
| [src/runs/run-lease.service.ts](../../../../src/runs/run-lease.service.ts) *(new)* | +237 / −0 | `RunLeaseService`: `startAsync`/`renewAsync`/`stop`/`tickAsync`, таймеры с `unref()`, `#stopped`-защита, `onApplicationShutdown`, публичный `leaseTtlMs` для стартового lease |
| [src/runs/run-lease.service.spec.ts](../../../../src/runs/run-lease.service.spec.ts) *(new)* | +261 / −0 | 10 fake-timer-тестов: немедленное продление, отказ при не-`running`, сбой БД в тике, `stop`/идемпотентность/гонка, `onApplicationShutdown` |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +51 / −1 | DI `RunLeaseService`; стартовый `lease_expires_at` в `markRunRunningAsync`; `startAsync` после перевода в `running`; вынесенное тело выполнения под `try/finally { stop }` |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +81 / −0 | стаб `RunLeaseService` + 4 wiring-теста (старт/стоп, падение узла, ошибка планирования, стартовый lease) |
| [src/runs/runs.processor.ts](../../../../src/runs/runs.processor.ts) | +48 / −15 | `findRunAsync` вычисляет `leaseExpired`/`legacyStale` по часам БД; `isStale = running && (leaseExpired || legacyStale)`; lease в логах |
| [src/runs/runs.processor.spec.ts](../../../../src/runs/runs.processor.spec.ts) | +100 / −3 | lease-поля во всех running-фикстурах + 4 новых теста: `leaseExpired` vs `started_at`, живая аренда, `legacyStale` для старых строк |
| [src/runs/runs.module.ts](../../../../src/runs/runs.module.ts) | +6 / −0 | `RunLeaseService` в providers `RunsModule` |
| [src/media/media-storage.integration.spec.ts](../../../../src/media/media-storage.integration.spec.ts) | +12 / −0 | стаб `RunLeaseService`, иначе DI-граф `ExecutionEngineService` не собирается в DB-гейте |

**Итого код:** 8 файлов, **+796 / −19**.

Документация (этот пакет):

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | +10 / −1 | `[Unreleased] → Added`: запись S9 + ссылка на отчёт; в строку «Docs» добавлен S9-отчёт |
| [docs/development/reports/README.md](../README.md) | +2 / −1 | строка отчёта S9 |
| `docs/development/reports/v0.11.0/S9-run-lease.md` *(new)* | +325 | этот отчёт |

Временный smoke-скрипт `.smoke/s9-lease-smoke.mjs` — в `.gitignore` (`.smoke/`), не часть
deliverable; лог прогона `.smoke/s9-app.log` оставлен там же как доказательство § 4.

`pnpm-lock.yaml`/зависимости не менялись; миграции не добавлялись (`lease_expires_at` —
миграция `0013_run_lease.sql` из S1); env-схема не менялась (ключи из S1).

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** · `pnpm typecheck` — **0** · `pnpm test` — **93 файла passed / 3 skipped, 1359 passed / 18 skipped** · `pnpm lint` — **0 errors, 1 warning** (pre-existing, S4: неиспользуемый `DocumentTemplateNotFoundException` в `src/engine/node-executors.ts`; к S9 не относится).

Прирост: +1 spec-файл и **+18 тестов** (10 `run-lease`, 4 engine, 4 processor); было
92 файла / 1341 passed (отчёт S4+S5), стало **93 / 1359**. Skipped — прежние
DB-интеграционные и e2e-спеки без своего окружения.

---

## 3. Диагностика

1. **`${leaseTtlMs} * interval '1 millisecond'` в Drizzle.** Значение уходит параметром
   (`$1`), PostgreSQL выводит тип из оператора `double precision * interval`; `now() +
   $1 * interval` даёт `timestamptz`. Отдельный каст не нужен — проверено smoke'ом:
   `lease_expires_at` в БД реально сдвигался ровно на TTL (см. § 4), т.е. SQL валиден и
   параметр не «съел» интервал.
2. **`timer.unref()` и фейковые таймеры.** В `run-lease.service.spec.ts` используются
   `vi.useFakeTimers()`; таймеры `@sinonjs/fake-timers` поддерживают `unref()`, поэтому
   продакшен-код не пришлось ослаблять ради тестов. Фейковые таймеры включаются **после**
   сборки Nest TestingModule, чтобы DI не зависел от подмены глобальных таймеров.
3. **Проверка «`startAsync` продлевает сразу».** Тест смотрит на счётчик `returning()`:
   после `await startAsync` — 1 продление, до `HEARTBEAT_MS − 1` — всё ещё 1, после
   `HEARTBEAT_MS` — 2. Так проверяется и отсутствие окна с истёкшей арендой, и расписание.
4. **Сбой БД в тике.** Тест подменяет ошибку в фейковом `returning()`, проверяет
   `logger.warn` с `runId` и текстом ошибки и что таймер остался (`vi.getTimerCount()`),
   затем снимает ошибку и получает следующее продление. Необработанных rejection'ов нет:
   `setTimeout(() => void this.tickAsync(...))`.
5. **Гонка `stop`/`tick`.** В `tickAsync` добавлена повторная проверка `#stopped` **после**
   `await renewAsync` (не только до): иначе `stop`, сработавший во время продления, не
   отменял бы перепланирование таймера. Это покрыто отдельным тестом с «зависшим»
   `renewAsync` (deferred promise).
6. **Стартовый lease в `markRunRunningAsync`.** TTL берётся из `RunLeaseService.leaseTtlMs`
   (публичный getter), а не читается из `ConfigService` второй раз: иначе дефолт 90 000
   был бы продублирован в двух сервисах и мог разойтись с heartbeat.
7. **`try/finally` без переотступа 130 строк.** Тело выполнения вынесено в
   `executePlannedGraphAsync` (отдельный приватный метод), а `executeRunAsync` вызывает его
   под `try { … } finally { this.runLease.stop(runId); }`. Семантика KI-037/KI-036 сохранена:
   `catch` фазы планирования по-прежнему закрывает запуск `failed` и не пробрасывает
   исключение, а `catch` гасит heartbeat, если ошибка случилась после `startAsync`.
8. **`expect.anything()` для SQL-объекта.** В engine-спеке стартовый lease проверяется как
   `leaseExpiresAt: expect.anything()`: Drizzle `SQL` — объект, а не строка; исполнение SQL
   покрыто smoke'ом, юнит-тест проверяет проводку.
9. **Счётчик тестов.** `+18` — это 10 + 4 + 4; `it.each` не использовался, расхождения нет.
10. **Prettier.** HEAD-файлы репозитория не fully prettier-clean (проверено: исходные
    `execution-engine.service.ts`, `runs.processor.ts` и их спеки не проходят
    `prettier --check` уже в HEAD). Поэтому форматировал только **новые** файлы
    (`run-lease.service*`), а в существующих держал стиль окружающего кода — без
    несвязанного churn (та же практика, что в S0-S1).

---

## 4. Smoke (реальные PostgreSQL 17 + Redis 7 + BullMQ worker)

Запуск: `node --env-file=.env .smoke/s9-lease-smoke.mjs` → `dist/main.js` на `PORT=3199`
(`AUTH_DISABLED=true`, `ALLOW_PRIVATE_IPS=true` — только на время smoke),
`WORKFLOW_RUN_HEARTBEAT_MS=30000`, `WORKFLOW_RUN_LEASE_TTL_MS=90000`, stale-порог из `.env`
= 300 000 мс.

Сценарий (DESIGN § 1.4): граф **два последовательных `http`-узла**, каждый уходит на
локальный медленный сервер, который отвечает через **70 с**; суммарно **140 с** (> 2 минут).
Пока граф жив, скрипт каждые 5 с читает `workflow_runs` (`status`, `started_at`,
`lease_expires_at`, `lease_expires_at − now()`).

| Проверка | Результат |
|---|---|
| Приложение стартовало, `POST /workflow` + `POST /runs` | **201 / 201**, run `dc49c397-2804-4ff0-b60b-9e2b6ee26750` |
| `status` в процессе | `pending → running → completed` |
| `started_at` | `2026-10-19T10:27:14.752Z` — **не изменился ни в одном сэмпле** (опрос каждые 5 с за ~140 с) |
| `lease_expires_at` — стартовый | `10:28:44.759Z` (≈ `started_at + 90 с`) |
| Продления (5 разных значений) | `10:28:44.759` → `10:29:14.784` → `10:29:44.804` → `10:30:14.819` → `10:30:44.845` |
| Интервалы между продлениями | **30 025 / 30 020 / 30 015 / 30 026 мс** — heartbeat 30 с |
| `lease_expired` во время run | всегда `false` (аренда жива, heartbeat успевает) |
| Завершение | `completed` в `10:29:34.845Z`, длительность **140.093 с**, оба узла completed |
| После завершения (через 10 с) | `status=completed`, `lease_expires_at` **не изменился** (`10:30:44.845Z`) — тики остановлены |
| Ошибки heartbeat в логе | **0** строк `Heartbeat запуска…`, `ERROR`-строк в логе приложения — **0** |
| Очистка | workflow удалён (CASCADE: `workflow_runs`/`node_runs` = 0), приложение и медленный сервер остановлены, порт 3199 свободен |

**Вывод:** `lease_expires_at` продлевается живым worker'ом каждые ~30 с, `started_at`
остаётся временем старта, после завершения аренда не продлевается. Сценарий «запуск
дольше 2 минут не выглядит зависшим» подтверждён на живой БД.

> SIGKILL-сценарий из DESIGN § 3.3.1 (job redelivered до/после истечения lease) вживую
> **не проверялся**: для переотдачи нужен BullMQ stalled-таймер (`lockDuration` = 300 000 мс
> из `.env`), т.е. отдельный прогон на 5+ минут. Логика `leaseExpired`/`legacyStale`
> покрыта unit-тестами processor'а, а SQL-выражения исполнялись в этом smoke'е (worker
> читал запуск через `findRunAsync`). Ручной QA-кейс остаётся за S17.

---

## 5. Что не так

1. **Случайный коммит промежуточных файлов S9.** Пользователь подтвердил, что коммиты
   `23dd939` (S4+S5 message) и `51b139a` (KI-489..492) сделаны им вручную и что в `23dd939`
   по ошибке попали мои промежуточные `run-lease.service.ts`, `run-lease.service.spec.ts`
   и часть правок `execution-engine.service.ts`. Я коммитов не делал, историю не
   переписывал; финальное состояние S9 целиком лежит в рабочем дереве. Итоговый diff
   считается от `d9a797a` (HEAD до случайных коммитов). Отдельный риск: commit message
   `23dd939` не описывает S9-файлы — при разборе истории это будет путать.
2. **`heartbeat < staleThreshold` из DESIGN § 3.3.1 по-прежнему не реализован.** Это
   осознанное решение S0-S1: при `WORKFLOW_RUNS_STALE_THRESHOLD_MS=300000` и верхней
   границе heartbeat `300000` условие невыполнимо. В S9 env-схему не трогал (промпт этого
   не просил, ключи и `TTL >= 2×heartbeat` уже есть). Кандидат KI остаётся открытым с S0-S1.
3. **`#stopped` растёт неограниченно.** На каждый остановленный запуск в `Set<string>`
   остаётся uuid (~36 байт); для долгоживущего процесса с тысячами запусков это утечка
   «на кончике иглы». Полное решение — удалять запись после завершения in-flight тика
   (нужен epoch/generation), в S9 сознательно оставлено как в DESIGN.
4. **Остаточная гонка «повторный `startAsync` во время старого тика».** Если для того же
   `runId` вызвать `startAsync` в момент, когда старый тик уже висит на `await renewAsync`,
   старый тик после `await` может увидеть снятый `#stopped` и перепланировать лишний таймер.
   Две цепочки heartbeat безвредны для данных (обе продлевают аренду), но `stop` снимет
   только последнюю; лишняя цепочка прекратится сама, когда статус перестанет быть
   `running`. Полный фикс — generation-token (`#epochs`), вне рамок S9.
5. **`lease_expires_at` не обнуляется при завершении запуска.** После `finishRunAsync` в
   терминальной строке остаётся timestamp в будущем (≤ TTL). Все читатели проверяют
   `status`, поэтому на guard это не влияет, но метрики/дашборды, читающие lease без
   фильтра по статусу, могут принять завершённый запуск за «арендованный». Кандидат KI.
6. **SQL `leaseExpired`/`legacyStale` в юнит-тестах не исполняется.** `runs.processor.spec`
   подменяет Drizzle-цепочку и возвращает уже вычисленные флаги; реальные SQL-выражения
   проверены только smoke'ом (на `pending`-строке). DB-интеграционного спека на
   `leaseExpired=true` / `legacyStale=true` нет — кандидат KI (по образцу KI-318/319).
7. **DB-интеграционный media-спек получил заглушку heartbeat.** `media-storage.integration.spec`
   собирает `ExecutionEngineService` с `RunLeaseService`-стабом: сам media-пайплайн
   проверяется, heartbeat в нём не участвует. Это нормально для интеграции, но означает,
   что «движок + настоящий lease + БД» вместе проверяются только smoke'ом.
8. **Pre-existing warning линтера** (`DocumentTemplateNotFoundException` не используется в
   `node-executors.ts`) остался: он из S4, вне scope S9; трогать чужой код в пакете S9 не
   стал. `pnpm build`/`typecheck`/`test` он не ломает (lint в CI — 0 errors).
9. **Smoke использует dev-переключатели** `AUTH_DISABLED=true` и `ALLOW_PRIVATE_IPS=true`
   (последний — чтобы `http`-узел пошёл на 127.0.0.1). В проде оба выключены; на код S9
   они не влияют.
10. **Smoke не проверяет UI/SSE.** Задача S9 — backend reliability; визуального изменения
    нет, SSE-контракт не менялся.
11. **`.smoke/s9-app.log`** содержит WARN провайдеров без ключей (Tavily/Replicate/FAL/
    OpenAI Images) — это ожидаемое состояние `.env`, не ошибки S9.

---

## 6. Новые KI

Номера — по текущему максимуму реестра (**KI-492**), **в `docs/KNOWN_ISSUES.md` не вносил**:
нумерацию подтверждает пользователь (практика S0-S1/S4-S5). Кандидаты:

1. **KI-493-кандидат (Low, reliability).** `RunLeaseService`: повторный `startAsync` во
   время in-flight `tickAsync` того же `runId` может оставить лишнюю цепочку heartbeat
   (см. § 5.4). Решение: generation-token (`Map<runId, epoch>`), тик перепланируется только
   если epoch не изменился.
2. **KI-494-кандидат (Low, наблюдаемость).** `lease_expires_at` не сбрасывается при
   `completed`/`failed` (см. § 5.5): терминальные запуски до TTL выглядят «арендованными»
   для метрик/дашбордов. Решение: `lease_expires_at: null` в `finishRunAsync` либо
   документировать инвариант «lease читать только для running».
3. **KI-495-кандидат (Low, память).** `RunLeaseService.#stopped` не очищается после
   остановки запуска (см. § 5.3): неограниченный рост Set в долгоживущем процессе.
   Решение: `#stopped.delete(runId)` после того, как тик гарантированно завершён
   (например, вместе с cleanup epoch-записи по KI-493).
4. **KI-496-кандидат (Low, тесты/CI).** Нет DB-интеграционного спека, который исполняет
   SQL-выражения `leaseExpired`/`legacyStale` из `RunsProcessor.findRunAsync` на живой
   PostgreSQL (юнит-тест подменяет Drizzle). Решение: spec по образцу `schema-parity`/
   `media-storage.integration`, создающий строки с истёкшей арендой и `lease_expires_at
   IS NULL`.

**KI-066 закрывается этим пакетом** (heartbeat/lease реализованы и проверены smoke'ом).
Запись реестра в S9 не правил: по практике S0-S1/S4-S5 реестр и сводку синхронизирует
отдельный docs-шаг/S17. Точечный diff для закрытия (RULES 2.12):

**Найти** (блок KI-066):
```text
- **Приоритет:** 🟠 High | **Статус:** Open | **Обнаружено:** 2026-10-13
```
**Заменить на:**
```text
- **Приоритет:** 🟠 High | **Статус:** Fixed | **Обнаружено:** 2026-10-13
- **Исправлено в:** v0.11.0 (S9)
- **Fix:** `RunLeaseService` продлевает `workflow_runs.lease_expires_at`
  (`UPDATE … WHERE status = 'running'`, heartbeat 30 с, TTL 90 с);
  `ExecutionEngineService` ставит стартовый lease и гасит heartbeat в `finally`;
  `RunsProcessor` считает зависшим только запуск с истёкшей арендой
  (`legacyStale` — fallback по `started_at` для строк без аренды).
```
Сводку после закрытия пересчитать grep'ом (RULES 3.20): `Open −1`, `Fixed +1`, итог не
меняется.

---

## 7. Обоснование решений

1. **Строго по DESIGN § 3.3.1.** Структура сервиса, имена, `UPDATE … WHERE status =
   'running'`, `now()`-арифметика и точки встраивания (`startAsync` после
   `markRunRunningAsync`, `stop` в `finally`) воспроизведены из дизайна: это уже
   согласованная архитектура, и отклонения усложнили бы ревью S17.
2. **Публичный `leaseTtlMs` вместо второго чтения env.** `markRunRunningAsync` нужен тот же
   TTL, что у heartbeat. Читать `WORKFLOW_RUN_LEASE_TTL_MS` в движке означало бы два
   независимых дефолта 90 000 — классический источник расхождения конфигурации. Геттер на
   сервисе-владельце оставляет единственный источник истины (и один тест на значение).
3. **Немедленное продление в `startAsync`.** Между `markRunRunningAsync` (стартовый lease) и
   первым `setTimeout` не должно быть окна, в котором heartbeat ещё не тикнул: при TTL 90 с
   окно было бы целых 30 с. Поэтому `startAsync` сначала `renewAsync`, потом планирование.
4. **`WHERE status = 'running'`.** После терминального статуса UPDATE — no-op; heartbeat не
   может «оживить» завершённый запуск и не продлевает аренду отменённому/упавшему.
   Возврат `row !== undefined` даёт `startAsync`/`tickAsync` сигнал «строка уже не running →
   таймер не нужен».
5. **Сбой БД в тике — `warn`, не исключение.** Временная недоступность PostgreSQL не должна
   превращать живой запуск в упавший: BullMQ-лок продолжает удерживать job, следующий тик
   попробует снова. `void this.tickAsync(...)` в `setTimeout` осознан: промис не
   возвращается в event loop как unhandled rejection (RULES 4.18).
6. **`timer.unref()`.** Heartbeat не должен удерживать процесс от завершения (RULES 4.12);
   при штатном shutdown все таймеры снимает `onApplicationShutdown`.
7. **Повторная проверка `#stopped` после `await renewAsync`.** `stop` может сработать, пока
   тик ждёт БД; без второй проверки таймер перепланировался бы уже после остановки. Это
   дешёвая защита (одна проверка в Set) от конкретной гонки, которую DESIGN упоминает
   комментарием к `#stopped`.
8. **Стартовый lease — в той же транзакции, что и `status = 'running'`.** `markRunRunningAsync`
   уже использует `db.transaction` (RULES 4.22); добавление `leaseExpiresAt` туда не создаёт
   окна «running без аренды», в котором `RunsProcessor` другого инстанса мог бы решить, что
   lease NULL и применить legacy-fallback.
9. **Время — только по часам БД (`now()`), не `Date.now()`.** И продление lease, и проверка
   `leaseExpired`/`legacyStale` считаются в PostgreSQL. Это исключает влияние расхождения
   часов приложения и БД на решение «жив ли запуск» (DESIGN § 7, риски).
10. **`isStale` через два флага, а не один SQL-boolean.** `leaseExpired` и `legacyStale`
    разделены, чтобы: (а) старые строки (`lease_expires_at IS NULL`) сохранили прежнее
    поведение; (б) в логе и тестах было видно, **почему** запуск признан зависшим; (в) guard
    остался читаемым `running && (leaseExpired || legacyStale)` ровно как в DESIGN.
11. **Тело выполнения вынесено в `executePlannedGraphAsync`.** Вариант «обернуть 130 строк
    в `try` и переотступить» дал бы огромный diff без изменения логики. Отдельный метод
    оставляет `executeRunAsync` тонким (планирование + `try/finally` вокруг heartbeat), а
    тело — байт-в-байт прежним (только сдвиг по файлу), что упрощает ревью.
12. **`catch` фазы планирования тоже гасит heartbeat.** Ошибка может случиться после
    `startAsync` (например, падение публикации `run_started` в Redis). Без `stop` в `catch`
    таймер пережил бы запуск; `stop` идемпотентен, поэтому вызывается безусловно.
13. **Fallback для старых строк — не backfill.** `lease_expires_at` nullable (S1), backfill
    не нужен: строки без аренды живут по прежнему порогу `started_at +
    RUN_STALE_THRESHOLD_MS`. Это сохраняет совместимость при откате кода/БД (DESIGN § 4).
14. **Тесты — fake timers и минимальные двойники.** `RunLeaseService` зависит от БД/часов,
    поэтому проверяется через `Test.createTestingModule` (RULES 4.13) с двойником Drizzle,
    который умеет ровно одну цепочку `update().set().where().returning()`. Это быстрее и
    детерминированнее, чем DB-интеграция, а реальный SQL добирается smoke'ом.
15. **Engine-тесты проверяют проводку, а не таймеры.** Настоящий heartbeat в engine-спеке не
    нужен (он проверен в своём спеке): здесь важны только `startAsync`/`stop` в нужных
    местах и стартовый `leaseExpiresAt` в UPDATE. Поэтому — стаб `RunLeaseService`.
16. **Processor-фикстуры обновлены явными флагами.** Юнит-тест не исполняет SQL, поэтому
    running-строки в спеке получили явные `leaseExpired`/`legacyStale`; это честно
    фиксирует контракт `findRunAsync` и не даёт тестам случайно проходить на `undefined`.
17. **Env-схему не трогал.** Ключи `WORKFLOW_RUN_HEARTBEAT_MS`/`WORKFLOW_RUN_LEASE_TTL_MS`,
    диапазоны и `TTL >= 2×heartbeat` уже добавлены в S0-S1; недостающий
    `heartbeat < staleThreshold` — известное решение S0-S1 (§ 5.2), менять его в S9 без
    отдельного решения нельзя.
18. **Docs — минимально по RULES 2.1/2.18.** Добавлены запись `Added` в CHANGELOG со ссылкой
    на отчёт (RULES 2.18), строка в `reports/README.md` и сам отчёт с YAML-frontmatter.
    `KNOWN_ISSUES`/`README`/`USER_GUIDE`/`QA` — вне scope S9 (реестр и release-гайды идут в
    S17 по RULES 2.16; номера KI подтверждает пользователь).

---

## Черновик commit message (не коммитил)

```text
feat(v0.11.0): S9 — run lease / heartbeat

- RunLeaseService: startAsync/renewAsync/stop/tickAsync, heartbeat 30 s,
  lease TTL 90 s (env), timer.unref(), DB-error → warn + reschedule,
  onApplicationShutdown; публичный leaseTtlMs для стартового lease.
- ExecutionEngineService: стартовый lease_expires_at в markRunRunningAsync
  (now() + TTL по часам БД), startAsync после running, stop в finally;
  тело выполнения вынесено в executePlannedGraphAsync.
- RunsProcessor: findRunAsync считает leaseExpired/legacyStale по now();
  isStale = running && (leaseExpired || legacyStale); fallback по started_at
  для строк без аренды (миграция 0013, backfill не нужен).
- Тесты: +10 run-lease (fake timers, БД-сбой, гонка stop/tick), +4 engine
  (проводка/стартовый lease), +4 processor (leaseExpired/legacyStale).
- Docs: отчёт reports/v0.11.0/S9-run-lease.md, reports/README, CHANGELOG.

Refs: DESIGN v0.11 § 3.3.1, § 5 (S9); KI-066.
```
