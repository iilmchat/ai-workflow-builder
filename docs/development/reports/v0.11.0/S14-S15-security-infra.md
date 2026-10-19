---
title: "S14+S15: Security & Infra — SafeHttpClient (SSRF), Redis Throttler, Nest assets"
date: 2026-10-19
version: v0.11.0
steps: [S14, S15]
status: accepted
related_ki: [KI-292, KI-420, KI-434, KI-435, KI-478, KI-025, KI-409]
related_adr: []
---

# Отчёт S14+S15 — Security & Infra

**Статус:** реализовано; код и документация лежат в рабочем дереве, коммитов в
этой сессии нет (`git add -A` не использовался). `pnpm build` — 0/0,
`pnpm typecheck` — 0, `pnpm lint` — 0 warnings / 0 errors, `pnpm test` —
99 files passed / 3 skipped, **1417 passed / 18 skipped**. Живой smoke на
PostgreSQL 17 + Redis 7 — **10/10** проверок (два инстанса, общий лимит;
`GET /templates` из `dist` без `src/templates`).

**Точка старта.** HEAD `ffeee36` (после S12+S13). На старте сессии в рабочем
дереве уже был единственный незакоммиченный diff — `docs/KNOWN_ISSUES.md`
(KI-505…508, предыдущая сессия). Во время этой сессии параллельно работала
**сессия S16 (Dark Theme)**: в рабочем дереве появились изменения `web/**`,
`docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`, `docs/development/reports/README.md`
и новый `S16-dark-theme.md`. S14/S15 их **не касался** (кроме точечных
docs-вставок в CHANGELOG и строки в `reports/README.md`); изменения S16 в мой
diff не входят. Подробности — § 3.1.

---

## 1. Файлы (+/−)

Backend, новые файлы (5):

| Файл | + | Что |
|---|---:|---|
| [src/common/http/safe-http.client.ts](../../../../src/common/http/safe-http.client.ts) | +667 | `SafeHttpClient` (DESIGN § 3.5.1): один `dns.lookup` с проверкой всех адресов, денлист имён/IP, `undici.Agent` с `connect.lookup` (pinning IP, KI-435), `redirect: 'manual'` с перепроверкой `Location` (лимит 5, KI-434), `AbortSignal.any([signal, timeout])`, потоковый лимит тела 1 МБ; ошибки `SafeHttpDnsException`/`SafeHttpResponseTooLargeException`; `createPinnedLookup` |
| [src/common/http/safe-http.client.spec.ts](../../../../src/common/http/safe-http.client.spec.ts) | +568 | Таблица атак DESIGN § 3.5.1 (127.0.0.1, `[::1]`, 169.254.169.254, `2130706433`, `0x7f.1`, `localhost.`, `metadata.google.internal`, редирект на 10.0.0.5, `ftp://`/`file://`), DNS rebinding (pinning), лимит хопов, лимит тела, таймаут/сигнал, 303/307 |
| [src/common/throttler/redis-throttler.storage.ts](../../../../src/common/throttler/redis-throttler.storage.ts) | +194 | `RedisThrottlerStorage` (DESIGN § 3.5.2, KI-420): `duplicate()` с `maxRetriesPerRequest: 1`/`enableOfflineQueue: false`, атомарный `EVAL` Lua, ключ `${prefix}:${throttler}:${tracker}`, fallback в память с throttle warn'ов, `onApplicationShutdown` → `quit()` |
| [src/common/throttler/redis-throttler.storage.spec.ts](../../../../src/common/throttler/redis-throttler.storage.spec.ts) | +211 | 7 тестов: duplicate-опции, успешный increment/ключ/аргументы Lua, блокировка, fallback, throttle warn раз в минуту, shutdown |
| [src/common/throttler/redis-throttler.module.ts](../../../../src/common/throttler/redis-throttler.module.ts) | +23 | Провайдеры `ThrottlerStorageService` + `RedisThrottlerStorage` для `ThrottlerModule.forRootAsync` (фабрика не видит провайдеров родителя) |

Backend, изменённые файлы (20):

| Файл | +/− | Что |
|---|---:|---|
| [src/common/utils/network-safety.ts](../../../../src/common/utils/network-safety.ts) | +109/−300 | Остались примитивы (`isPrivateIp`, `isBlockedIpAddress`, `normalizeHostname`, `isBlockedHostname`, `isMetadataHostname`, `isMetadataIpAddress`, `SsrfBlockedException`, `TooManyRedirectsException`, `DnsLookupAsync`). Удалены `assertPublicHttpUrlAsync`/`fetchWithSsrfGuardAsync` и их хелперы — второй SSRF-путь больше не нужен (v0.11 S14) |
| [src/common/utils/network-safety.spec.ts](../../../../src/common/utils/network-safety.spec.ts) | +43/−223 | Оставлены/добавлены тесты предикатов и денлиста имён; тесты удалённого guard'а перенесены в `safe-http.client.spec.ts` |
| [src/engine/node-executors.ts](../../../../src/engine/node-executors.ts) | +64/−97 | `executeHttpNode(data, inputs, httpClient, options)`; тело больше не обрезается — лимит 1 МБ enforced клиентом (KI-025); удалены `truncateToBytes`/`AbortSignal.timeout`/`fetchWithSsrfGuardAsync`; `allowPrivateNetworks` из `HTTP_NODE_ALLOW_PRIVATE_NETWORKS` |
| [src/engine/execution-engine.service.ts](../../../../src/engine/execution-engine.service.ts) | +23/−13 | Инжектится `SafeHttpClient`; читается `HTTP_NODE_ALLOW_PRIVATE_NETWORKS` (вместо `ALLOW_PRIVATE_IPS`), передаётся в исполнитель |
| [src/agent/agent-tools.ts](../../../../src/agent/agent-tools.ts) | +23/−37 | `http_request` ходит через `context.httpClient.fetchAsync`; `allowPrivateNetworks` не передаётся (агент всегда закрыт) |
| [src/agent/agent.service.ts](../../../../src/agent/agent.service.ts) | +9/−26 | Инжектится `SafeHttpClient`, поле `allowPrivateIps` и чтение `ALLOW_PRIVATE_IPS` удалены, контекст инструментов содержит `httpClient` |
| [src/agent/agent.types.ts](../../../../src/agent/agent.types.ts) | +10/−19 | `AgentToolContext`: `fetchAsync`/`dnsLookupAsync`/`allowPrivateIps` → `readonly httpClient: SafeHttpClient` |
| [src/app.module.ts](../../../../src/app.module.ts) | +26/−9 | `ThrottlerModule.forRootAsync` с `RedisThrottlerStorage`; `THROTTLER_STORAGE=memory` → in-memory |
| [src/runs/runs.module.ts](../../../../src/runs/runs.module.ts) | +8/−1 | Провайдер `SafeHttpClient` для `ExecutionEngineService` и `AgentService` |
| [src/config/env.schema.ts](../../../../src/config/env.schema.ts) | +14/−27 | `ALLOW_PRIVATE_IPS` удалён из `NetworkSafetyEnvSchema`; остаётся `HTTP_NODE_ALLOW_PRIVATE_NETWORKS` |
| [src/config/env.schema.spec.ts](../../../../src/config/env.schema.spec.ts) | +1/−34 | Тесты `ALLOW_PRIVATE_IPS` удалены; `HTTP_NODE_*` переименован в S14 |
| [src/templates/template-loader.service.ts](../../../../src/templates/template-loader.service.ts) | +7/−5 | Комментарии: `dist/templates` — основной путь (assets), фолбэк на `src/templates` — только для `tsx`/dev (KI-292) |
| [src/agent/agent-tools.spec.ts](../../../../src/agent/agent-tools.spec.ts) | +48/−25 | Контекст с `httpClient`-моком; проверка аргументов запроса клиента |
| [src/agent/agent-tools.ssrf.spec.ts](../../../../src/agent/agent-tools.ssrf.spec.ts) | +135/−189 | Переписан вокруг настоящего `SafeHttpClient` с фейковым транспортом: localhost/127.0.0.1/::1/metadata/DNS→private/redirect→metadata, безопасный редирект, «всегда закрыт» |
| [src/agent/agent.service.spec.ts](../../../../src/agent/agent.service.spec.ts) | +25/−31 | Глобальный `fetch` заменён провайдером `SafeHttpClient`; два теста используют `httpFetchAsync` |
| [src/agent/agent.integration.spec.ts](../../../../src/agent/agent.integration.spec.ts) | +24/−16 | Интеграционный сценарий `http_request → final` через подменённый клиент |
| [src/engine/node-executors.spec.ts](../../../../src/engine/node-executors.spec.ts) | +286/−180 | Все `http`-тесты через фейковый клиент; тело >1 МБ → `SafeHttpResponseTooLargeException`; allowPrivateNetworks/metadata; удалён `vi.mock('node:dns/promises')` |
| [src/engine/execution-engine.service.spec.ts](../../../../src/engine/execution-engine.service.spec.ts) | +96/−100 | Провайдер `SafeHttpClient`; `http`-тесты без глобального fetch; два «падающих» теста явно настраивают отказ клиента |
| [src/media/media-storage.integration.spec.ts](../../../../src/media/media-storage.integration.spec.ts) | +6/−0 | Заглушка `SafeHttpClient` для DI |
| [nest-cli.json](../../../../nest-cli.json) | +8/−1 | `assets`: `templates` → `dist`, `watchAssets` (KI-292) |

Инфраструктура/зависимости:

| Файл | +/− | Что |
|---|---:|---|
| [package.json](../../../../package.json) | +1 | `undici@^8.12.2` (DESIGN § 4.4) |
| [pnpm-lock.yaml](../../../../pnpm-lock.yaml) | +12/−3 | lock после `pnpm add undici@^8.12.2` |
| [Dockerfile](../../../../Dockerfile) | +4/−5 | Удалён обход `COPY /app/src/templates` — JSON в `dist` (KI-292) |
| [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) | +6 | Гейт `test -f dist/templates/text-llm.json` после `pnpm build` |
| [.env.example](../../../../.env.example) | +9/−9 | `ALLOW_PRIVATE_IPS` удалён; описание `HTTP_NODE_ALLOW_PRIVATE_NETWORKS`/Throttler актуализировано |

Документация:

| Файл | +/− | Что |
|---|---:|---|
| [docs/CHANGELOG.md](../../../CHANGELOG.md) | ≈+44 / −8 | `Added` (Redis throttler), `Changed` (SSRF-флаги, throttler по умолчанию), `Fixed` (KI-292), `Security` (`SafeHttpClient`); ссылка на отчёт |
| [docs/development/reports/README.md](../README.md) | +1 | Строка отчёта S14-S15 |
| `docs/development/reports/v0.11.0/S14-S15-security-infra.md` *(new)* | — | этот отчёт |

Артефакты smoke (gitignored, не deliverable): `.smoke/s14-s15-smoke.mjs`,
`s14-s15-smoke-report.json`, `s14-s15-app-3197.log`, `s14-s15-app-3198.log`.

**Итого:** 27 tracked-файлов изменено (25 кодовых/инфраструктурных — **+997 /
−1350**, плюс `CHANGELOG.md` и `reports/README.md`) + 5 новых файлов
(+1663 строки). Чистое изменение кода — **+1310 строк**; крупнейшие новые
файлы — сам клиент (+667) и его таблица атак (+568).

`web/**`, `docs/KNOWN_ISSUES.md` и `docs/development/reports/v0.11.0/S16-*`
принадлежат параллельной сессии S16 и в этот пакет не входят.
Миграций/схемы БД пакет не меняет.

---

## 2. Build / test

`pnpm build` — **0 errors / 0 warnings** (assets скопированы:
`dist/templates/{http-llm,text-llm,text-llm-image}.json`) · `pnpm typecheck` —
**0** · `pnpm lint` — **0 warnings / 0 errors** · `pnpm test` — **99 файлов
passed / 3 skipped, 1417 passed / 18 skipped** · `pnpm build:migrate` не
затрагивался.

Прирост к HEAD `ffeee36`: **+2 spec-файла** (`safe-http.client.spec.ts`,
`redis-throttler.storage.spec.ts`), **+21 активный тест** (1417 − 1396).
Skipped — прежние DB-интеграционные/e2e без окружения. `web/` в S14/S15 не
менялся (его собирает/тестирует параллельная S16).

---

## 3. Диагностика

1. **Параллельная сессия S16 в том же рабочем дереве.** На старте S14/S15 diff
   был только `docs/KNOWN_ISSUES.md`; в 14:41–14:46 появились `web/**`,
   S16-отчёт и правки `CHANGELOG.md`/`KNOWN_ISSUES.md`/`reports/README.md`
   (S16 прямо ссылается на «незакоммиченные backend-правки S14/S15»). Чтобы не
   смешать пакеты, я менял только backend/docs S14-S15. `pnpm test` и смоук
   прогонялись по backend; S16-изменения `web/**` не входят ни в § 1, ни в
   тестовые цифры.
2. **`ThrottlerStorageRecord` не реэкспортируется из `@nestjs/throttler@6.7.1`.**
   `import type { ThrottlerStorageRecord } from '@nestjs/throttler'` → `TS2724`.
   Тип взят из `@nestjs/throttler/dist/throttler-storage-record.interface.js`
   (у пакета нет `exports`-карты, subpath резолвится). Это же — кандидат KI-513.
3. **`*/` внутри JSDoc.** Комментарий с литералом `templates/**/*.json`
   закрыл JSDoc раньше времени → 31 ошибка `TS2304` в
   `template-loader.service.ts`. Формулировка заменена на «JSON-шаблоны
   ассетами»; сам `nest-cli.json` содержит паттерн (это JSON, не комментарий).
4. **Удаление `ALLOW_PRIVATE_IPS` — не косметика.** Флаг читали
   `AgentService` и `ExecutionEngineService`, а также его проверяли
   `env.schema.spec.ts`/`agent-tools.ssrf.spec.ts`/`node-executors.spec.ts`.
   После S14 у агента флага нет вовсе (безопасность), у узла — только
   `HTTP_NODE_ALLOW_PRIVATE_NETWORKS`; схема, `.env.example` и тесты приведены
   в соответствие.
5. **Удалён второй SSRF-путь.** `assertPublicHttpUrlAsync`/
   `fetchWithSsrfGuardAsync` больше не вызываются из production-кода. Оставлять
   их значило бы иметь два расходящихся guard'а (и старые тесты, «зелёные» на
   неиспользуемом коде). Функции и их хелперы удалены; `network-safety.spec.ts`
   сокращён до предикатов, таблица атак переехала в
   `safe-http.client.spec.ts`.
6. **`AbortSignal.any` + уже отменённый сигнал.** Первая версия теста «сигнал
   вызывающего прерывает запрос» зависла на 5 с: `controller.abort()` успевал
   сработать до вызова фейкового транспорта, а `addEventListener('abort')` на
   уже отменённом `AbortSignal` событие не получает. Фейк теперь проверяет
   `init.signal.aborted` (production-`undici` в этом случае отклоняет запрос
   сам). Это не дефект клиента, а ловушка теста.
7. **Лимит тела: truncate → throw.** По DESIGN § 3.5.1 клиент обязан
   прервать запрос при превышении `maxResponseBytes`. Прежний `executeHttpNode`
   молча обрезал тело до 1 МБ; теперь узел падает
   `SafeHttpResponseTooLargeException`. Тесты обновлены, поведение — осознанное
   изменение (см. § 5.4).
8. **Два теста движка «падали» из-за закрытого порта.** `KI-287`/`KI-288`
   использовали `http://127.0.0.1:1/never` и полагались на сетевой отказ. С
   фейковым клиентом запрос успешен → тесты стали зелёными не по той причине.
   В обоих явно настроен `httpFetchAsync.mockRejectedValueOnce(...)` —
   проверяется именно обработка падения, а не порт.
9. **`vi.mock('node:dns/promises')` больше не нужен.** Узел `http` не резолвит
   DNS сам — это делает инжектированный клиент. Моки DNS убраны из
   `node-executors.spec.ts` и `execution-engine.service.spec.ts`, иначе тесты
   «проверяли» бы неиспользуемую ветку.
10. **Конкурентный smoke.** `src/templates` на время smoke переименован в
    `src/__templates_smoke_backup__` (возвращён в `finally`); приложение при
    этом пишет в лог `Шаблоны загружены: 3 из 3 (…\dist\templates)` — значит,
    фолбэк действительно не использовался. S16 в это время трогал только
    `web/**`.
11. **`undici@8` требует Node ≥ 22.19.** Локально Node 24; CI — `node-version: 22`
    (последний 22.x ≥ 22.19); `Dockerfile` — `node:22-alpine` (Docker Hub
    отдаёт последний 22.x). Docker-образ в этой сессии не собирался (см. § 5.1).
12. **`pnpm add undici@^8.12.2`** подтянул 8.12.2 и обновил lockfile
    (+12/−3); `undici` уже был транзитивной зависимостью, но теперь явная
    (DESIGN § 4.4).

---

## 4. Smoke (живые PostgreSQL 17 + Redis 7, два backend-инстанса)

Запуск: `node .smoke/s14-s15-smoke.mjs` (Node 24). Скрипт:
- временно **убирает `src/templates`** (проверка «только `dist/templates`»);
- поднимает два инстанса `dist/main.js` на `:3197`/`:3198` с реальными
  `.env`-PG/Redis, `AUTH_DISABLED=true`, `THROTTLER_STORAGE=redis`,
  `THROTTLER_KEY_PREFIX=throttle:smoke-s14-s15`;
- ждёт `GET /` → 200, проверяет `GET /templates` на обоих;
- чистит throttle-ключи, затем шлёт **160 + 160** запросов `GET /templates`
  через два инстанса (батчами по 40);
- гасит процессы, возвращает `src/templates`, чистит ключи, пишет JSON-отчёт.

| Проверка | Результат |
|---|---|
| оба инстанса поднялись | ✅ `:3197`, `:3198` |
| `GET /templates` на `:3197` | ✅ 200, массив из **3** шаблонов (`http-llm`, `text-llm`, `text-llm-image`) |
| `GET /templates` на `:3198` | ✅ 200, те же 3 шаблона |
| источник шаблонов | ✅ лог: `Шаблоны загружены: 3 из 3 (C:\…\dist\templates)` — `src/templates` отсутствовал |
| суммарно 200-х при 320 запросах | ✅ ровно **300** (лимит `HTTP_THROTTLE_DEFAULT_LIMIT`) |
| 301-й и далее | ✅ **20 × 429** |
| инстанс A (`:3197`) | ✅ все 160 — 200 (до лимита) |
| инстанс B (`:3198`) | ✅ 140 × 200, затем **20 × 429** — видит общий счётчик |
| заголовок `Retry-After` у 429 | ✅ `60000` |
| итог | **10/10, exit code 0** |

JSON: `.smoke/s14-s15-smoke-report.json`; логи: `.smoke/s14-s15-app-3197.log`,
`.smoke/s14-s15-app-3198.log`. Throttle-ключи и временный каталог убраны.

**Дополнительно — откат `THROTTLER_STORAGE=memory`.** Инстанс поднят на
`:3199` с `THROTTLER_STORAGE=memory`: `GET /templates` → 200 и те же 3 шаблона,
в логе нет `Throttler Redis недоступен`, `Nest application successfully
started`. DI-ветка `memory` работоспособна (см. § 5.6 про лишнее ленивое
Redis-соединение).

**Что smoke доказывает.** Без Redis-хранилища инстанс B отдал бы свои 160
ответов 200 (у каждого инстанса свой счётчик), а суммарно было бы 320. Факт
«300 успешных + 20 × 429 ровно на втором инстансе» доказывает, что счётчик
общий. `GET /templates` при отсутствующем `src/templates` доказывает, что
assets работают без Docker-обхода.

**Что smoke не проверил.** Реальный сетевой путь `SafeHttpClient` (pinning/TLS
SNI) — локальный upstream по HTTPS с валидным сертификатом не поднимался;
pinning проверен юнит-тестами `createPinnedLookup` и клиента с фейковым
транспортом. Docker-образ не собирался.

---

## 5. Что не так

1. **Docker-образ не собирался.** Правка `Dockerfile` (удаление
   `COPY /app/src/templates`) проверена логически и гейтом `dist/templates`, но
   `docker build` в сессии не запускался: локального `node:22-alpine` нет, pull
   тяжёлый, а CI-workflow `docker-publish` не входит в локальный прогон. Риск:
   если `nest build` в образе по какой-то причине не скопирует assets, гейт CI
   это поймает только на push.
2. **Параллельная S16.** Два пакета правят `docs/CHANGELOG.md` и
   `reports/README.md` одновременно. Я вставлял свои записи точечно и
   перечитывал файл, но при следующей правке S16 возможен конфликт
   (последний писатель побеждает). Перед коммитом нужно глазами сверить
   CHANGELOG/README и `git status`.
3. **`ALLOW_PRIVATE_IPS` удалён — breaking env-изменение.** Инсталляции,
   которые включали флаг для localhost/LM Studio, после v0.11 должны
   использовать `HTTP_NODE_ALLOW_PRIVATE_NETWORKS=true` для узла `http`;
   `http_request` агента вернуть нельзя (это цель S14). Значение в старом
   `.env` не ломает старт (неизвестные ключи Zod пропускает), но молча
   перестаёт действовать.
4. **Тело > 1 МБ теперь ошибка узла, а не обрезанный ответ.** Для графов,
   которые рассчитывали на «первые 1 МБ» (парсинг большого JSON), узел начнёт
   падать `SafeHttpResponseTooLargeException`. Это требование DESIGN § 3.5.1;
   альтернатива (truncate) оставляла бы в `node_runs.outputs` невалидный JSON.
5. **DNS-сбой теперь fail closed.** Ранее (v0.10.2) нерезолвящееся имя
   пропускалось к `fetch` и давало сетевую ошибку; теперь — сразу
   `SafeHttpDnsException`. Это осознанно (без адреса нельзя прибить IP), но
   меняет текст ошибки в `node_runs.error` для части сбоев.
6. **`THROTTLER_STORAGE=memory` всё равно создаёт Redis-соединение.**
   `RedisThrottlerStorage` инжектится в фабрику `forRootAsync` всегда и в
   конструкторе делает `base.duplicate()`, даже когда выбрано in-memory
   хранилище. Мини-смоук `memory`-режима отработал (инстанс на `:3199`,
   `GET /templates` → 200), warn'ов нет, но лишний объект/подписка на реконнект
   остаются (ioredis коннектится лениво — первая команда не выполняется).
   Кандидат KI-515.
7. **Lua-ответ не валидируется в рантайме.** `increment` приводит результат
   `EVAL` к `[number, number, number, number]` без проверки длины/типов
   (RULES 1.17). Ошибочный/чужой ответ (например, после смены скрипта) даст
   `NaN` в счётчиках вместо fallback. Кандидат KI-514.
8. **Deep import типа throttler'а.** `@nestjs/throttler/dist/…interface.js`
   сломается, если пакет добавит `exports`-карту или переименует файл.
   Кандидат KI-513.
9. **Нет автоматического гейта «два инстанса → общий лимит».** Проверено
   ручным smoke; в CI нет Redis-service (есть только PostgreSQL), поэтому
   регрессия `THROTTLER_STORAGE=redis` → in-memory не будет поймана на push.
   Кандидат KI-516.
10. **`app.module.spec.ts` отсутствует** (и раньше не было). DESIGN допускал
    «если есть»; wiring `SafeHttpClient`/`RedisThrottlerStorage` проверен
    smoke'ом и тестами модуля, но не отдельным тестом `AppModule`. Создавать
    спеку с полным bootstrap'ом ради этого не стал (нужны БД/Redis/Chokidar).
11. **Базовый образ Docker не запинен на ≥ 22.19.** `undici@8` требует
    Node ≥ 22.19; `node:22-alpine` сейчас это выполняет, но тег плавающий.
    Кандидат KI-517 (pin/явная проверка в Dockerfile).
12. **Смоук не создаёт реальных пользователей/workflow** (в отличие от S12-S13):
    только `GET /templates`, поэтому нет риска мусора в dev-БД. Это плюс, но
    означает, что сценарий не проверяет вспомогательные ручки.
13. **`pnpm lint` — 0 warnings.** Прежний pre-existing warning
    (`DocumentTemplateNotFoundException` в `node-executors.ts`) исчез ещё в S12;
    в этом пакете новых предупреждений нет.
14. **`docs/KNOWN_ISSUES.md` не правил.** Реестр в рабочем дереве изменён
    параллельной S16 (KI-509…512 + пересчёт сводки). Закрытия и новые KI
    оформлены точечными diff'ами в § 6 — их нужно применить после согласования
    нумерации (RULES 2.12/3.20), чтобы не перетереть правки S16.

---

## 6. Новые KI

Номера — после текущего максимума реестра (**KI-512**, добавлен S16 в рабочем
дереве). В `KNOWN_ISSUES.md` не вносил: файл изменён параллельной сессией,
нумерацию подтверждает пользователь (практика S0…S13).

1. **KI-513-кандидат (Low, хрупкость зависимости).** `ThrottlerStorageRecord`
   не экспортируется из `@nestjs/throttler@6.7.1`; тип берётся deep-import'ом
   `@nestjs/throttler/dist/throttler-storage-record.interface.js`. При
   добавлении `exports`-карты или переименовании файла сборка упадёт.
   Решение: объявить локальный структурный тип (4 поля) и не зависеть от
   внутреннего пути пакета, либо обновлять вместе с мажором throttler'а.
2. **KI-514-кандидат (Low, валидация внешних данных).** `increment`
   (`redis-throttler.storage.ts`) кастует ответ `EVAL` к
   `[number, number, number, number]` без проверки (RULES 1.17). Некорректный
   ответ даст `NaN`/`undefined` в заголовках лимита вместо fallback.
   Решение: проверять длину и `Number.isFinite`, при несоответствии — warn +
   fallback.
3. **KI-515-кандидат (Low, ресурсы).** При `THROTTLER_STORAGE=memory`
   `RedisThrottlerStorage` всё равно создаётся и делает `duplicate()`
   (соединение не используется). Решение: создавать Redis-хранилище лениво
   или выбирать провайдер по env до инстанцирования.
4. **KI-516-кандидат (Low, CI/смоук).** Нет автоматической проверки
   «два инстанса → общий лимит»: в CI нет Redis-service, сценарий — только
   ручной `.smoke/s14-s15-smoke.mjs`. Решение: CI-job с `redis:7` + запуск
   двух `dist/main.js` и проверка 429 через второй инстанс.
5. **KI-517-кандидат (Low, Docker/совместимость).** `undici@8` требует
   Node ≥ 22.19 (`engines`), а `Dockerfile` использует плавающий
   `node:22-alpine`. Сейчас это последний 22.x, но старый приватный mirror
   может отдать <22.19. Решение: запинить `node:22.19-alpine` (или выше) и
   добавить `node -v`-проверку в Dockerfile.

**Закрываются этим пакетом:** KI-292 (S15), KI-420 (S15), KI-435 (S14).
KI-434 и KI-478 уже `Fixed` (v0.10.2), но их реализация заменена на
`SafeHttpClient` — предлагается дописать строку `Fix (v0.11 S14)`.

Точечные diff'ы (RULES 2.12; **не применял**):

**KI-292** — найти:
```text
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-16
```
заменить на:
```text
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S15) | **Обнаружено:** 2026-10-16
```
и после блока `- **Файлы:** … Dockerfile` добавить:
```text
- **Fix:** `assets` в `nest-cli.json` (`templates`), Docker-обход
  `COPY /app/src/templates` удалён, CI-гейт `test -f dist/templates/text-llm.json`;
  `TemplateLoaderService` берёт `dist/templates` основным путём.
```

**KI-420** — найти:
```text
- **Приоритет:** 🟡 Medium | **Статус:** Open | **Обнаружено:** 2026-10-18
```
заменить на:
```text
- **Приоритет:** 🟡 Medium | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S15) | **Обнаружено:** 2026-10-18
```
и после `- **Решение:** Redis-storage для throttler.` добавить:
```text
- **Fix:** `RedisThrottlerStorage` (`src/common/throttler/redis-throttler.storage.ts`):
  отдельное fail-fast соединение, атомарный Lua `EVAL`, fallback в память;
  `ThrottlerModule.forRootAsync` в `AppModule`, `THROTTLER_STORAGE=memory` — откат.
```

**KI-435** — найти:
```text
- **Приоритет:** 🟢 Low | **Статус:** Open | **Обнаружено:** 2026-10-18
```
заменить на:
```text
- **Приоритет:** 🟢 Low | **Статус:** Fixed | **Исправлено в:** v0.11.0 (S14) | **Обнаружено:** 2026-10-18
```
и после блока `- **Файлы:** … network-safety.ts` добавить:
```text
- **Fix:** `SafeHttpClient` (`src/common/http/safe-http.client.ts`): один
  `dns.lookup` + проверка всех адресов, выбранный IP прибивается через
  `undici.Agent({connect.lookup})`; DNS-сбой — fail closed.
```

**KI-434 / KI-478** (уже `Fixed`) — после блока `- **Файлы:**` каждого
добавить строку:
```text
- **Fix (v0.11 S14):** переведён на `SafeHttpClient`; старый
  `fetchWithSsrfGuardAsync` удалён, SSRF-путь один.
```

После применения пересчитать сводку **grep'ом** (RULES 3.20), не по памяти.

---

## 7. Обоснование решений

1. **`undici.request` + `Agent`, а не глобальный `fetch`.** Требование KI-435 —
   «проверенный адрес = адрес соединения». `fetch` не позволяет подменить
   резолвер на уровне сокета; `Agent({ connect: { lookup } })` — минимальный
   способ прибить IP, сохранив TLS SNI (`servername`), `Host` и HTTP-семантику.
   Версия `undici` — явная зависимость (`^8.12.2`), как в DESIGN § 4.4.
2. **Один DNS-резолв на хоп, проверка всех адресов, pinning первого.** Если
   проверять только «первый» адрес или выбирать публичный из списка, клиент мог
   бы подключиться к приватному (порядок адресов контролирует атакующий).
   Поэтому: все адреса проверяются, затем выбирается первый и прибивается.
   Каждый редирект — новый хоп и новый резолв (новый хост = новая проверка),
   внутри хопа второго резолва нет.
3. **DNS-сбой — fail closed.** Если имя не разрешилось, прибить нечего;
   пропускать запрос означало бы вернуть DNS rebinding через «второй резолв
   внутри соединения». Это изменение прежнего поведения v0.10.2 осознанно и
   зафиксировано в JSDoc/§ 5.5.
4. **`redirect: 'manual'` внутри клиента, а не в вызывающем коде.** Один
   клиент — один обход редиректов для узла и агента; вызывающий код не может
   «забыть» `manual`. `Location` резолвится относительно текущего URL,
   максимум 5 хопов, 303 и 301/302+POST → GET без тела (как браузер).
5. **Metadata-алиасы заблокированы всегда.** `169.254.169.254`,
   `metadata.google.internal`, `instance-data` — это instance-credentials, а не
   «внутренний сервис». Даже `HTTP_NODE_ALLOW_PRIVATE_NETWORKS=true` их не
   разрешает; `localhost`/RFC1918 при этом флаге разрешены (доверенный
   self-hosted, DESIGN § 3.5.1).
6. **`http_request` не имеет выключателя.** LLM не должен ходить во внутреннюю
   сеть; отдельный от узла `http` флаг для агента создал бы обходной путь через
   prompt injection. Поэтому `ALLOW_PRIVATE_IPS` удалён, а не оставлен
   «только для агента».
7. **Старый guard удалён, а не оставлен рядом.** Два SSRF-пути (старый на
   `fetch` + новый на `undici`) неизбежно разойдутся: часть правок попадёт
   только в один. Production-потребителей у старых функций не осталось —
   удаление безопасно; тесты мигрированы, таблица атак теперь одна.
8. **Клиент — DI-провайдер, а не глобальный синглтон.** `AgentService` и
   `ExecutionEngineService` живут в `RunsModule`; провайдер в этом модуле даёт
   один экземпляр и честный DI (RULES 1.3). Контракт `AgentToolContext`
   содержит `httpClient` (DESIGN § 3.5.1), поэтому `agent-tools.ts` остаётся
   чистой константой без Nest-DI, а тесты подставляют клиент с фейковым
   транспортом.
9. **Транспорт клиента вынесен в тип `SafeHttpTransportAsync`.** Это
   единственный способ проверить редиректы/лимиты без реальной сети; при этом
   default-транспорт — настоящий `undici.request`, а pinning проверяется
   отдельно через `createPinnedLookup` и «двойной резолв» в тесте rebinding.
10. **Лимит тела — потоковый и fail-fast.** `maxResponseBytes` соблюдается при
    чтении (chunk-и наружу не отдаются), при превышении соединение закрывается
    и бросается `SafeHttpResponseTooLargeException`. Для `node_runs.outputs`
    (jsonb) и транскрипта агента это лучше, чем молчаливая обрезка: в БД не
    попадает невалидный JSON (KI-025).
11. **Отдельное fail-fast Redis-соединение.** Общий `REDIS_TOKEN` настроен на
    `maxRetriesPerRequest: null` (нужно BullMQ/pub-sub); на нём `EVAL` при
    мёртвом Redis висел бы в offline-очереди, и fallback не сработал бы.
    `duplicate()` с `maxRetriesPerRequest: 1`/`enableOfflineQueue: false` даёт
    ошибку сразу. Своё соединение закрывается в `onApplicationShutdown`
    (RULES 4.12).
12. **Lua, а не INCR + PEXPIRE по отдельности.** Атомарность: два параллельных
    запроса не должны прочитать `hits = limit − 1` и оба пройти. Скрипт
    атомарно инкрементит, ставит TTL только на первом хите и создаёт
    `…:blocked` после превышения.
13. **Fallback в память, а не 500.** Redis — обязательная инфраструктура, но
    rate limit не должен ронять API: при недоступном Redis BullMQ/SSE уже
    деградировали, и временный счёт по инстансу лучше, чем ошибка на каждом
    запросе. Warn троттлится раз в минуту, чтобы не спамить.
14. **Отдельный `RedisThrottlerModule`.** `ThrottlerModule.forRootAsync` не
    видит провайдеров родительского модуля: `RedisThrottlerStorage` должен быть
    в `imports` динамического модуля. `RedisModule` глобальный и экспортирует
    `REDIS_TOKEN`, поэтому модуль только связывает провайдеры.
15. **Assets в `nest-cli.json` вместо Docker-`COPY`.** Docker-обход лечил
    симптом в одном окружении: `node dist/main` локально/в CI всё равно
    зависел от `src/`. Assets — штатное решение Nest; Docker-строка удалена,
    CI-гейт `test -f dist/templates/text-llm.json` ловит регрессию, а
    `TemplateLoaderService` сохраняет фолбэк на `src/templates` только для
    `tsx`/dev (в образе `src/` нет).
16. **Тесты — на фейковом транспорте, а не на локальном HTTP-сервере.**
    Реальный upstream потребовал бы портов, таймингов и (для HTTPS/pinning)
    сертификатов; юнит-тесты с моком DNS/транспорта проверяют именно
    инварианты защиты. Живой сетевой путь и два инстанса проверены смоуком.
17. **Docs — по RULES 2.1/2.18, без правки реестра.** CHANGELOG (Added/
    Changed/Fixed/Security) со ссылкой на отчёт, строка в `reports/README.md`,
    сам отчёт с frontmatter. `KNOWN_ISSUES.md` не правил: он изменён
    параллельной S16, закрытия/новые KI оформлены diff'ами (§ 6), нумерацию
    подтверждает пользователь.

---

## Черновик commit message (не коммитил)

```text
feat(v0.11.0): S14+S15 — SafeHttpClient (SSRF) + Redis Throttler + nest assets

S14 (KI-434/435/478, DESIGN § 3.5.1):
- src/common/http/safe-http.client.ts: один dns.lookup с проверкой всех
  адресов, денлист private/loopback/link-local/metadata, pinning IP через
  undici.Agent({connect.lookup}), redirect: 'manual' с перепроверкой Location
  (лимит 5), AbortSignal.any([signal, timeout]), потоковый лимит 1 МБ.
- Узел http и http_request агента переведены на клиент; ALLOW_PRIVATE_IPS
  удалён, у узла — HTTP_NODE_ALLOW_PRIVATE_NETWORKS, агент всегда закрыт.
- Старые assertPublicHttpUrlAsync/fetchWithSsrfGuardAsync удалены.
- Тесты: таблица атак DESIGN § 3.5.1, DNS rebinding, redirect/лимиты/таймаут.

S15 (KI-420/292, DESIGN § 3.5.2/§ 3.5.3):
- src/common/throttler: RedisThrottlerStorage (duplicate fail-fast, Lua EVAL,
  fallback in-memory, throttle warn, shutdown quit) + module;
  ThrottlerModule.forRootAsync в AppModule, THROTTLER_STORAGE=memory — откат.
- nest-cli.json assets templates → dist; Dockerfile без COPY src/templates;
  CI-гейт dist/templates/text-llm.json; комментарии TemplateLoaderService.

Docs: reports/v0.11.0/S14-S15-security-infra.md, reports/README, CHANGELOG
(Added/Changed/Fixed/Security).

Smoke: PG17+Redis7, 2 инстанса — GET /templates из dist (10/10), общий лимит
300: 300×200 + 20×429 (второй инстанс), Retry-After=60000.

Refs: DESIGN v0.11 § 3.5.1, § 3.5.2, § 3.5.3, § 5 (S14, S15);
KI-292, KI-420, KI-434, KI-435, KI-478.
```
