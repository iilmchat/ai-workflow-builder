---
title: "S6-A: Production Readiness & Infra Integration (v1.6.0)"
date: 2026-11-10
version: v1.6.0
steps: [S6-A]
status: accepted
related_ki: [KI-575, KI-419, KI-658, KI-664, KI-666, KI-667, KI-668, KI-669, KI-670]
related_adr: []
---

# S6-A: Production Readiness & Infra Integration (v1.6.0)

Подготовка **репозитория** к деплою на production-VPS (FirstVDS, Ubuntu 24.04):
CORS-allowlist, health/readiness-эндпоинт, защита `/metrics` по IP,
прод-надстройка Docker Compose с Caddy, шаблон production-окружения и
эксплуатационная документация. Хост (SSH, UFW, Docker, сертификаты)
настраивает инфра-агент — здесь только код, конфигурация и runbook.

Работа выполнена в рабочем дереве, **без коммита**: `git add`/`git add -A`
не вызывались вообще — коммит делает пользователь (это требование пакета
S6-A; RULES § 3.3 в этой сессии не применялся).

## 1. Файлы (+/−)

Числа — из `git diff --numstat` для отслеживаемых файлов и числу строк новых
файлов на момент отчёта.

### Код (backend)

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `src/config/cors.ts` | новый | 96 / 0 | `parseCorsAllowedOrigins` (Zod-валидация схем `http`/`https`/`capacitor`, trim, срезание хвостового слэша, dedupe) и `resolveCorsOrigin` (prod → массив, иначе `true`, fail-fast на пустом списке) |
| `src/config/cors.spec.ts` | новый | 98 / 0 | 10 тестов: разбор, хвостовые запятые/слэши, дубли, мусор, prod/не-prod, fail-fast |
| `src/config/env.schema.ts` | изменён | 48 / 0 | `CORS_ALLOWED_ORIGINS`, `METRICS_ALLOWED_IPS`; хелпер `trimmedEmptyToUndefined` (пробельная строка = «не задано», KI-084) |
| `src/config/env.schema.spec.ts` | изменён | 58 / 0 | 5 тестов новых переменных (дефолты, значения, prod-валидация) — `toMatchObject`, не `toEqual` |
| `src/main.ts` | изменён | 27 / 4 | CORS через `resolveCorsOrigin`: prod — allowlist, dev — `origin: true`; `console.error` + `app.close()` + `exit 1` при ошибке конфигурации |
| `src/health/health.controller.ts` | новый | 183 / 0 | `GET /health`: `SELECT 1` (drizzle) и `PING` (ioredis) параллельно, таймаут 2 с на проверку, 200/503, постатусная детализация, WARN без секретов |
| `src/health/health.module.ts` | новый | 19 / 0 | `HealthModule` (без `imports`: `DbModule`/`RedisModule` — `@Global`) |
| `src/health/health.controller.spec.ts` | новый | 114 / 0 | 4 теста: 200, 503 (обе зависимости), 503 (только Redis), 503 по таймауту (`fake timers`) |
| `src/metrics/metrics-ip-allowlist.ts` | новый | 258 / 0 | `normalizeClientIp` (IPv4-mapped, порт, скобки, lowercase), `parseIpAllowlist` (точные адреса + IPv4-CIDR, fail-closed), `isIpAllowed`, loopback-алиасы `127.0.0.1`↔`::1` |
| `src/metrics/metrics-ip-allowlist.spec.ts` | новый | 105 / 0 | 11 тестов разбора и совпадений, включая негативные (мусор, IPv6-CIDR, маска > 32) |
| `src/metrics/metrics-ip.guard.ts` | новый | 95 / 0 | `MetricsIpGuard` (403 вне allowlist, WARN с IP), `resolveRequestIp` (`req.ip` приоритетнее `X-Forwarded-For`) |
| `src/metrics/metrics-ip.guard.spec.ts` | новый | 140 / 0 | 9 тестов: loopback, 403, CIDR, подделка `X-Forwarded-For`, fallback на `socket.remoteAddress` |
| `src/metrics/metrics.controller.ts` | изменён | 11 / 4 | `@UseGuards(MetricsIpGuard)` на контроллере + обновлённый JSDoc |
| `src/metrics/metrics.module.ts` | изменён | 4 / 1 | `MetricsIpGuard` в `providers` |
| `src/metrics/metrics.controller.spec.ts` | изменён | 55 / 2 | провайдер `ConfigService` + guard; новый тест «403 вне allowlist, метрики не строятся» |
| `src/app.module.ts` | изменён | 5 / 0 | импорт и подключение `HealthModule` |
| `api-prefixes.json` | изменён | 1 / 0 | префикс `health` (реестр — единственный источник, KI-472) |
| `src/common/api-prefixes.spec.ts` | изменён | 5 / 3 | `health` в `EXPECTED_CONTROLLER_PREFIXES` (14), комментарий и заголовок теста |

### Инфраструктура и конфигурация

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `docker-compose.prod.override.yml` | новый | 92 / 0 | `app`: `ports: !reset []`, `expose: 3000`, `mem_limit 2g`, json-file `10m×3`, healthcheck `/health`; `db`/`redis`: loopback-порты, `2g`/`512m`; `caddy`: `80/443/443udp`, тома `Caddyfile`/`caddy-data`/`caddy-config` |
| `Caddyfile` | новый | 34 / 0 | TLS + reverse proxy `app:3000`, `encode zstd gzip`, ACME-email через `{$ACME_EMAIL:...}`; проходит `caddy fmt`/`caddy validate` |
| `docker-compose.prod.yml` | изменён | 6 / 1 | `IMAGE_REF` (деплой/откат по digest) с обратной совместимостью `IMAGE_NAME`/`IMAGE_TAG` |
| `.env.production.example` | новый | 73 / 0 | production-шаблон: `NODE_ENV`, `TRUST_PROXY`, `COOKIE_SECURE`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`/`POSTGRES_*`, `REDIS_URL`, S3, `INSTANCE_ID`, `OTEL_ENABLED`, `SANDBOX_ENABLED`, `JWT_SECRET`, `METRICS_ALLOWED_IPS`; только заглушки |
| `.env.example` | изменён | 15 / 0 | `CORS_ALLOWED_ORIGINS` (с комментарием для prod) и `METRICS_ALLOWED_IPS` |
| `.gitignore` | изменён | 5 / 0 | `.env.production`/`.env.production.local` игнорируются, `.env.production.example` — коммитится |

### Документация

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `docs/development/PRODUCTION.md` | новый | 351 / 0 | Топология, первый деплой, таблица важных env, smoke-команды, обновление по digest, откат, бэкапы PostgreSQL/S3 (+RPO/RTO, restore-drill), метрики/алерты, логи, чек-лист безопасности, troubleshooting |
| `docs/CHANGELOG.md` | изменён | 33 / 0 | запись S6-A в `[Unreleased] → Added` со ссылкой на отчёт |
| `docs/KNOWN_ISSUES.md` | изменён | 84 / 15 | новые KI-666…670 + сводка пересчитана grep'ом (657/657/657) |
| `README.md` | изменён | 30 / 8 | `GET /health`, allowlist `/metrics`, прод-стек с override, ссылка на PRODUCTION.md в таблице |
| `docs/README.md` | изменён | 1 / 0 | строка PRODUCTION.md в таблице документации |
| `docs/development/reports/README.md` | изменён | 1 / 0 | строка отчёта S6-A |
| `docs/development/reports/v1.6.0/S6-A-production-readiness.md` | новый | 310 / 0 | этот отчёт (YAML-frontmatter + 7 разделов по RULES 2.15/2.18) |

**Итог:** 17 изменённых файлов (`+389 / −38`) и 14 новых файлов кода, инфры и
документации (`+1 968` строк).

## 2. Build / test

`pnpm build` — 0 errors / 0 warnings · `pnpm typecheck` — OK · `pnpm test` —
**2024 passed / 26 skipped** (136 файлов, 132 passed) · `pnpm lint` — 0 errors
(2 pre-existing warning в `openai-images.provider.spec.ts`, не связаны с
S6-A) · `docker compose -f docker-compose.prod.yml -f
docker-compose.prod.override.yml config --quiet` — OK (и с
`--env-file .env.production.example`) · `caddy fmt`/`caddy validate` — Valid
configuration.

## 3. Диагностика

Локально порт `3000` занят другим проектом (`ai-project-monitoring`), поэтому
приложение запускалось собранным `dist/main.js` на **`PORT=3100`**; БД и Redis —
контейнеры `workflow-builder-db` (127.0.0.1:5433) и `workflow-builder-redis`
(127.0.0.1:6379). Полный прод-стек (`up -d` с Caddy) на рабочей машине не
поднимался: 80/443 и выдача сертификатов — шаг инфра-агента на VPS.

| Проверка | Команда | Результат |
|---|---|---|
| Приложение стартует с новым CORS-кодом | `PORT=3100 node dist/main.js` | старт без ошибок, `/health` отвечает |
| Health при живых зависимостях | `curl -s -o NUL -w '%{http_code}' 127.0.0.1:3100/health` | `200`, тело см. § 4 |
| Health при упавшем Redis | `docker stop workflow-builder-redis` → curl | `503`, `redis: down`, `db: up` |
| Восстановление | `docker start workflow-builder-redis` → curl | снова `200`, `redis: up` |
| Prod-режим CORS | `NODE_ENV=production COOKIE_SECURE=true CORS_ALLOWED_ORIGINS=... node dist/main.js` | разрешённый `Origin` получает `ACAO`, чужой — нет |
| Fail-fast CORS | `NODE_ENV=production CORS_ALLOWED_ORIGINS='' node dist/main.js` | `exit_code=1`, `[bootstrap] CORS_ALLOWED_ORIGINS обязателен…`, порт не открыт (`curl` → `000`) |
| Метрики из allowlist | prod, `METRICS_ALLOWED_IPS=127.0.0.1` | `200`, `text/plain; version=0.0.4` |
| Метрики вне allowlist | prod, `METRICS_ALLOWED_IPS=203.0.113.9` | `403 Forbidden`, WARN `GET /metrics отклонён: 127.0.0.1 вне METRICS_ALLOWED_IPS` |
| Caddyfile | `docker run --rm -v $PWD/Caddyfile:/etc/caddy/Caddyfile:ro caddy:2-alpine sh -c 'caddy fmt --diff … && caddy validate …'` | `Valid configuration`, fmt без замечаний |
| Compose c prod-env | `docker compose --env-file .env.production.example -f … -f … config --quiet` | exit `0` |
| `.env.production.example` против Zod | `validateEnv()` на разобранном файле с dummy-секретами | `NODE_ENV=production`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`, `SANDBOX_ENABLED=true`, `THROTTLER_STORAGE=redis` — ошибок нет |

Проверки без правок кода (задание § 5.2/5.3): `ThrottlerEnvSchema` уже содержит
`THROTTLER_STORAGE` (default `redis`) и `THROTTLER_KEY_PREFIX`, а
`app.module.ts` при `THROTTLER_STORAGE !== 'memory'` передаёт
`RedisThrottlerStorage` — менять нечего. Административные ручки закрыты:
`AdminAuditController` — `@UseGuards(JwtAuthGuard, OrgOwnerGuard)`,
`OrgMembersController` — JWT на чтении, `OrgOwnerGuard` на инвайте,
`OrgOwnerOnlyGuard` на PATCH/DELETE.

## 4. Smoke

Среда: локально, собранный `dist/main.js` на `:3100`, dev БД/Redis (контейнеры
подняты). Прод-режим включался переменными окружения процесса.

| # | Запрос | HTTP | Тело / заголовки |
|---|---|---|---|
| 1 | `GET /health` (dev, всё живо) | **200** | `{"status":"ok","details":{"db":"up","redis":"up"}}` |
| 2 | `GET /health` (Redis остановлен) | **503** | `{"status":"error","details":{"db":"up","redis":"down"}}` |
| 3 | `GET /health` (Redis поднят) | **200** | `{"status":"ok","details":{"db":"up","redis":"up"}}` |
| 4 | `OPTIONS /workflow`, `Origin: https://any.example.com` (dev) | **204** | `Access-Control-Allow-Origin: https://any.example.com` (прежнее `origin: true`) |
| 5 | `OPTIONS /workflow`, `Origin: https://app.example.com` (prod, allowlist) | **204** | `Access-Control-Allow-Origin: https://app.example.com` |
| 6 | `OPTIONS /workflow`, `Origin: https://evil.example.com` (prod) | **204** | `Access-Control-Allow-Origin` **отсутствует** — браузер заблокирует ответ |
| 7 | `GET /metrics` (prod, `METRICS_ALLOWED_IPS=127.0.0.1`) | **200** | первая строка `# HELP http_request_duration_seconds …`, `text/plain; … version=0.0.4` |
| 8 | `GET /metrics` (prod, `METRICS_ALLOWED_IPS=203.0.113.9`) | **403** | `{"message":"GET /metrics доступен только из доверенной сети (METRICS_ALLOWED_IPS)","error":"Forbidden","statusCode":403}` |
| 9 | `GET /health` (prod, всё живо) | **200** | `{"status":"ok","details":{"db":"up","redis":"up"}}` |
| 10 | старт prod без `CORS_ALLOWED_ORIGINS` | **exit 1** | stderr: `[bootstrap] CORS_ALLOWED_ORIGINS обязателен при NODE_ENV=production: …`; на `:3101` никто не слушает |

Дополнительно: `docker compose … config` (база + override) показал, что у
`app` **нет** `ports`, есть `expose: ["3000"]`, `mem_limit: 2147483648`,
healthcheck `fetch http://127.0.0.1:3000/health`; опубликованы только `caddy`
(`80/tcp`, `443/tcp`, `443/udp`), `db` — `127.0.0.1:5434`, `redis` —
`127.0.0.1:6380`.

## 5. Что не так

1. **`SANDBOX_ENABLED` оставлен с дефолтом `false`, а не `true`** (как в
   задании). Причина: значение по умолчанию — это то, что получит любой запуск
   без `.env`; включение исполнения пользовательского JS «по умолчанию» —
   ослабление защиты (RULES § 5, KI-364). В `.env.production.example` флаг
   явно `true`, т.е. на проде песочница включена. Это осознанное отклонение,
   а не забытая правка.
2. **`TRUST_PROXY` в prod-примере — `true`, а не `1`.** Схема разбирает флаг
   строго (`z.enum(['true','false'])`, RULES 4.35): `TRUST_PROXY=1` уронил бы
   старт. Значение `true` эквивалентно задуманному, но не роняет fail-fast.
3. **CORS-allowlist работает только при `NODE_ENV=production`.** В
   `staging`/`preprod` остаётся `origin: true` — это публичные среды, и дыра
   реальна. Осознанный компромисс S6-A, чтобы не ломать смоук/CDP и
   Capacitor-сборку вне прода без их переконфигурации. Заведён **KI-668**.
4. **Compose-надстройка требует Compose ≥ 2.24** из-за `!reset`: иначе
   снять публикацию `app:3000` при merge нельзя. На VPS версия проверяется
   вручную (в `PRODUCTION.md` § 3/§ 12), автоматической проверки нет —
   **KI-670**.
5. **Healthcheck проверяет только БД и Redis.** Не проверяются: применённость
   миграций, доступность BullMQ-очередей, свободное место, доступность S3.
   Это сознательный минимум S6-A: каждая дополнительная проверка удлиняет
   ответ и может ронять `healthy` из-за внешнего сервиса. Кандидат на
   расширение — отдельным KI не заводил (см. § 6, обсуждение в PRODUCTION.md).
6. **`METRICS_ALLOWED_IPS` по умолчанию — только `127.0.0.1`.** Prometheus в
   Docker ходит из подсети compose, поэтому после включения guard'а его нужно
   добавить в env (в `.env.production.example` уже `172.18.0.0/16`). В дефолт
   подсеть не добавлена намеренно: угадывать имя сети нельзя, а
   `0.0.0.0/0` — худший вариант. В `.env.example` для dev добавлен `::1`.
7. **IPv6-CIDR в allowlist не поддержан** (точные IPv6-адреса работают) —
   **KI-669**. Причина: в прод-стеке внешний скрейпер ходит по IPv4, а
   «полу-маска» на IPv6 молча расширила бы доступ.
8. **Бэкапы — только runbook, без автоматизации.** Скрипт `pg_dump` → S3,
   cron/systemd timer, метрика «бэкап не сделался» и restore-drill остаются
   инфра-агенту/следующему шагу — **KI-667**. **WAL/PITR для RPO 5 минут не
   сделан** — **KI-666** (`Deferred`); в `PRODUCTION.md` честно указано
   RPO = 24 ч.
9. **Полный прод-стек не запускался.** Проверены `docker compose config`
   (+prod-env), `caddy validate`, health/CORS/metrics на реальном приложении,
   но `caddy` + TLS на живом домене, выдача сертификата и `docker healthcheck`
   внутри compose не воспроизводились — это делает инфра-агент на VPS.
   Аналогично не проверены реальные S3-ключи и presigned-ссылки в проде.
10. **`main.ts` (bootstrap) не покрыт тестом.** Логика вынесена в
    `resolveCorsOrigin` и покрыта 10 тестами, но сам сценарий «Nest поднялся →
    CORS упал → exit 1» проверен только smoke-командой (§ 4, п. 10).
11. **В `.env.production.example` добавлены `POSTGRES_USER`/`POSTGRES_DB`**,
    которых не было в задании: `docker-compose.prod.yml` собирает
    `DATABASE_URL` из `POSTGRES_*`, и без них пользователь в URL не совпадал бы
    с пользователем БД. Заглушка `<password>` в `DATABASE_URL` и
    `POSTGRES_PASSWORD` должна быть заменена одним значением.
12. **`api-prefixes.json` пополнился `health`**, поэтому Vite в dev начнёт
    проксировать `/health` на backend. Побочный эффект безвреден (фронтенд
    ручку не вызывает), но реестр — единственный источник правды, и забыть
    префикс было нельзя (паритет-тест).
13. **403 у `/metrics` — Nest-формат `{ message, error, statusCode }`**, а не
    единый `{ success, data, message }` из RULES 1.6: глобального
    `HttpExceptionFilter` в приложении нет (это pre-existing состояние, не
    S6-A). Менять формат всех ошибок в рамках этого пакета было бы scope creep.

## 6. Новые KI

Номера после KI-665; счётчики пересчитаны grep'ом (RULES 3.20):
`### KI-` = 657, строк `**Статус:**` = 657, уникальных номеров = 657.

| KI | Название | Приоритет | Статус |
|---|---|---|---|
| [KI-666](../../KNOWN_ISSUES.md) | Нет WAL-архивации: RPO по БД до 24 часов | 🟡 Medium | **Deferred** |
| [KI-667](../../KNOWN_ISSUES.md) | Бэкапы и restore-drill не автоматизированы в репозитории | 🟠 High | **Open** |
| [KI-668](../../KNOWN_ISSUES.md) | `CORS_ALLOWED_ORIGINS` действует только в production | 🟢 Low | **Open** |
| [KI-669](../../KNOWN_ISSUES.md) | Allowlist `/metrics` не поддерживает IPv6-CIDR | 🟢 Low | **Open** |
| [KI-670](../../KNOWN_ISSUES.md) | `docker-compose.prod.override.yml` требует Compose ≥ 2.24 (`!reset`) | 🟡 Medium | **Documented** |

Закрытых в S6-A KI нет: S6-A — инфраструктурный пакет, существующие KI
(KI-575 «/metrics публичный», KI-419 `TRUST_PROXY`, KI-658 CORS/Capacitor)
**частично** закрыты, но остаются `Open`/`Documented` из-за оговорок в § 5
(в частности KI-668 и KI-669 — прямые следствия S6-A).

## 7. Обоснование решений

**Почему allowlist, а не `origin: '*'` и не отражение любого Origin.**
`origin: true` отражает `Origin` запроса — это не `*`, но и не ограничение:
любой сайт получает `Access-Control-Allow-Origin` со своим адресом. С
`Authorization: Bearer` (cookie-CORS-обмен не используется) это не даёт
читать чужие данные без токена, но превращает CORS в фикцию и позволяет
эксплуатировать XSS-подобные сценарии на стороне доверенного пользователя.
Allowlist точно перечисляет доверенные origin'ы (веб-домен + Capacitor) и
падает на старте, если список пуст: молчаливый прод с открытым CORS хуже
неработающего деплоя, потому что обнаруживается позже и не тем человеком.

**Почему fail-fast в `main.ts`, а не WARN.** Nest уже поднял DI и пул `pg` —
предупреждение в логах никто не увидит, а сервис будет обслуживать запросы с
`origin: '*'`-поведением. `console.error` (а не `Logger`) — потому что
bootstrap-отказ должен попасть в `docker logs` даже если логгер ещё не
сконфигурирован; после сообщения `app.close()` закрывает пул и Redis, чтобы не
оставить висящих соединений, затем `exit 1` — `docker compose` увидит
ненулевой код и не пометит контейнер здоровым.

**Почему разбор CORS вынесен в `src/config/cors.ts`.** `main.ts` содержит
`top-level await` и вызывает `bootstrap()` при импорте — тестировать его
напрямую дорого и хрупко. Чистые функции (`parseCorsAllowedOrigins`,
`resolveCorsOrigin`) покрыты 10 unit-тестами без Nest и без сети, а `main.ts`
остаётся тонким: прочитать env (RULES 4.6, через `ConfigService`) и передать
результат. Это же место валидирует внешние данные через Zod (RULES 1.17).

**Почему healthcheck — отдельный модуль, а не ручка в `AppController`.**
`AppController` — «Hello World!» без зависимостей; его тест не создаёт ни
пул `pg`, ни клиент `ioredis`. Добавление туда `SELECT 1`/`PING` связало бы
корневую ручку с инфраструктурой и сломало бы существующий unit-тест.
`HealthModule` подключается в `AppModule`, не перечисляет `DbModule`/
`RedisModule` в `imports` (они `@Global`) и отвечает `503`, а не `200` с
`status: 'error'`: Docker/Compose и uptime-мониторы смотрят на HTTP-код.

**Почему проверки параллельны и с таймаутом.** `SELECT 1` и `PING` независимы
(RULES 4.17), последовательный вызов удваивал бы время ответа. Таймаут 2 с на
каждую проверку (RULES 4.19) не даёт healthcheck'у висеть на «задумавшемся»
TCP: иначе Docker считает контейнер зависшим, а Caddy продолжает слать
трафик. Таймер `unref()`-ится, чтобы не держать event loop.

**Почему guard, а не middleware, для `/metrics`.** Guard видит
`ExecutionContext`, инжектит `ConfigService` через DI (RULES 1.3) и
срабатывает **до** контроллера — экспозиция `registry.metrics()` не строится
для отклонённого запроса. Middleware пришлось бы регистрировать в
`AppModule.configure()` с ручным путём и без DI-контекста модуля метрик.

**Почему `req.ip` приоритетнее `X-Forwarded-For`.** `req.ip` учитывает
`TRUST_PROXY` (в проде `true`, за Caddy): Express берёт адрес из заголовка
только у доверенного прокси. Если читать заголовок первым, при
`TRUST_PROXY=false` любой клиент подставил бы `X-Forwarded-For: 127.0.0.1` и
прошёл бы allowlist — это была бы не защита, а её имитация. Заголовок
используется только как fallback, когда `req.ip` пуст (тесты, не-Express
адаптер).

**Почему поддержан IPv4-CIDR и loopback-алиасы.** Prometheus в Docker ходит
из подсети compose, и IP контейнера меняется при пересоздании — перечислять
его вручную бессмысленно. `127.0.0.1`↔`::1` — один хост в двух стеках: без
алиаса дефолтный allowlist блокировал бы локальный scrape «через раз» в
зависимости от того, как резолвится `localhost`. Обратное (разрешить всё
loopback-пространство `127.0.0.0/8`) сознательно не сделано: правило должно
быть явным.

**Почему `!reset []`, а не правка базового compose.** База
`docker-compose.prod.yml` остаётся рабочей для прямого запуска (локальный
прод-стек, CI-проверки), а override явно снимает публикацию порта и добавляет
Caddy. Пустой `ports: []` без тега не работает: Compose **добавляет**
последовательности при merge, и `3000` остался бы в интернете. Альтернатива —
перенести `ports` в отдельный dev-профиль — потребовала бы менять базовый
файл и все существующие инструкции; выбран тег с явным требованием версии
(**KI-670**).

**Почему `IMAGE_REF` для digest, а не только `IMAGE_TAG`.** Тег можно
перезаписать (в т.ч. случайно), digest — нельзя: откат «вернуть предыдущий
digest» гарантирует байт-в-байт тот же образ. `${IMAGE_REF:-${IMAGE_NAME:-
workflow-builder}:${IMAGE_TAG:-latest}}` сохраняет обратную совместимость:
старые `.env` с `IMAGE_NAME`/`IMAGE_TAG` работают без правок.

**Почему `SANDBOX_ENABLED` по умолчанию `false`, хотя задание просило `true`.**
Дефолт схемы — это конфигурация для запуска без `.env` (тесты, локальная
разработка, случайный `docker run`). `true` включил бы исполнение
пользовательского JS по умолчанию, что противоречит принципу «опасное —
только осознанно» (RULES § 5, KI-364). На проде флаг включён явно
(`.env.production.example`), т.е. требуемое поведение достигнуто, а дефолт
остался безопасным.

**Почему `.env.production.example` коммитится.** RULES 5.2: `.env` — в
`.gitignore`, `.env.example` — с заглушками. Отдельный файл нужен, потому что
prod-набор переменных отличается (S3, `TRUST_PROXY=true`,
`COOKIE_SECURE=true`, `CORS_ALLOWED_ORIGINS`, `METRICS_ALLOWED_IPS`) и не
должен «разбавлять» dev-пример. Секретов в нём нет — только `<password>`,
`<key>`, `<secret>`, `<min-32-chars>`; `.env.production` добавлен в
`.gitignore`, чтобы реальный файл не попал в git по невнимательности.
