# Production: развёртывание на VPS

**Версия:** v1.6.0 (S6-A) · **Обновлено:** 2026-11-10
**Стек:** Docker Compose (app + db + redis + caddy) · Ubuntu 24.04 · FirstVDS

Документ описывает **эксплуатацию** production-стека: первый деплой, проверки,
обновление образа по digest, откат, бэкапы, мониторинг и типовые отказы.
Код и конфигурация уже в репозитории — хост (SSH, UFW, Docker) настраивает
инфра-агент отдельно.

---

## 1. Что лежит в репозитории

| Файл | Назначение |
|---|---|
| `docker-compose.prod.yml` | Базовый стек: `app` (образ из `Dockerfile` или GHCR), `db` (pgvector/pg17), `redis` (7-alpine). |
| `docker-compose.prod.override.yml` | Прод-надстройка: единственная точка входа `caddy`, лимиты памяти, ротация логов, healthcheck `/health`, loopback-порты для отладки. Требует Compose ≥ 2.24 (`!reset`). |
| `Caddyfile` | TLS (Let's Encrypt) и reverse proxy `app:3000`. Домен заменить перед деплоем. |
| `.env.production.example` | Шаблон `.env` для VPS: только заглушки, секретов нет (RULES 5.1). |
| `src/health/health.controller.ts` | `GET /health` — проверка БД (`SELECT 1`) и Redis (`PING`); 200/503. |
| `src/metrics/metrics-ip.guard.ts` | Allowlist `GET /metrics` по IP (`METRICS_ALLOWED_IPS`). |

---

## 2. Топология

```text
                    Internet
                       │  :80, :443/tcp, :443/udp
                 ┌─────▼─────┐
                 │   caddy   │  TLS, HTTP→HTTPS, X-Forwarded-For
                 └─────┬─────┘
                       │ compose network: app:3000
                 ┌─────▼─────┐        ┌─────────┐       ┌───────────┐
                 │    app    │───────▶│   db    │       │   redis   │
                 │  :3000    │───────▶│  :5432  │       │   :6379   │
                 └───────────┘        └─────────┘       └───────────┘
                       ▲  /health, /metrics                ▲
                       └──── только с хоста / из сети ─────┘
```

- Наружу опубликованы **только** порты `caddy`. `app` доступен лишь внутри
  compose-сети (`expose: 3000`), `ports` базового файла снимается тегом
  `!reset` в override — без него Compose **добавил** бы `3000` к списку.
- `db` и `redis` проброшены на `127.0.0.1` (`5434`/`6380`) только для отладки
  с хоста (`psql`, `redis-cli`); из интернета они закрыты.
- `TRUST_PROXY=true` обязателен: за Caddy `req.ip` иначе — это IP контейнера
  прокси, и общий rate limit (`ThrottlerGuard`) считался бы на всех клиентов
  одним счётчиком (KI-419).

---

## 3. Предпосылки

1. **DNS:** A-запись (и AAAA, если есть IPv6) `app.<домен>` → IP VPS.
2. **Порты:** UFW/облачный firewall открывает `22`, `80/tcp`, `443/tcp`,
   `443/udp`. Порты `3000`, `5432`, `6379` наружу **не** открываются никогда.
3. **Docker:** Engine 27+ и Compose **≥ 2.24** (тег `!reset`); проверить:
   `docker compose version`. Старее — KI-670.
4. **Секреты:** `JWT_SECRET` (≥ 32 символа), пароль PostgreSQL, ключи S3,
   сервисный токен RuStore (если push включён). Генерировать, например,
   `openssl rand -hex 32`. В git они не попадают.
5. **Каталог:** `/opt/workflow-builder` (любой, но пути в командах ниже — от
   него). Репозиторий клонируется целиком: `Caddyfile` и compose-файлы читаются
   из рабочей копии.

---

## 4. Первый деплой

```bash
# 1. Код и шаблон окружения
git clone <repo-url> /opt/workflow-builder
cd /opt/workflow-builder
cp .env.production.example .env
chmod 600 .env                 # секреты не должны быть world-readable

# 2. Заполнить ВСЕ заглушки <...> в .env (редактор, не sed: значения с / и @)
#    Обязательно: POSTGRES_PASSWORD, JWT_SECRET, S3_*, CORS_ALLOWED_ORIGINS,
#    METRICS_ALLOWED_IPS (подсеть compose), INSTANCE_ID.

# 3. Домен в Caddyfile
#    app.example.com { ... }  →  app.<домен> { ... }

# 4. Проверка итоговой конфигурации (без запуска)
docker compose -f docker-compose.prod.yml \
               -f docker-compose.prod.override.yml config --quiet

# 5. Сборка и запуск (первый деплой — из исходников)
docker compose -f docker-compose.prod.yml \
               -f docker-compose.prod.override.yml up -d --build

# 6. Статус: db/redis — healthy, app — healthy, caddy — running
docker compose -f docker-compose.prod.yml \
               -f docker-compose.prod.override.yml ps
```

Миграции применяет `docker-entrypoint.sh` образа при старте `app` — отдельный
шаг не нужен, но первый запуск на пустой БД занимает дольше (см. `start_period`
healthcheck'а: 40 с).

### Переменные, которые важны именно на проде

| Переменная | Значение в проде | Почему |
|---|---|---|
| `NODE_ENV` | `production` | Включает fail-fast проверки `EnvSchema` (`COOKIE_SECURE`, `AUTH_DISABLED`, CORS). |
| `TRUST_PROXY` | `true` | IP клиента из `X-Forwarded-For` Caddy; иначе rate limit — один на всех. Строгий boolean: `1`/`yes` не принимаются (RULES 4.35). |
| `COOKIE_SECURE` | `true` | Refresh-cookie только по HTTPS; `false` в проде роняет старт (KI-220). |
| `CORS_ALLOWED_ORIGINS` | `https://app.<домен>,https://localhost,capacitor://localhost` | Пустое значение — **отказ старта** (S6-A): CORS не открывается «всему интернету». |
| `DATABASE_URL` | `postgres://<user>:<pass>@db:5432/<db>` | Внутри compose перекрывается сборкой из `POSTGRES_*`; строка нужна для запуска образа без compose. |
| `POSTGRES_USER/PASSWORD/DB` | свои значения | Их использует контейнер `db`; пароль должен совпадать с `DATABASE_URL`. |
| `REDIS_URL` | `redis://redis:6379` | Очереди BullMQ + общий rate limit. |
| `MEDIA_STORAGE_BACKEND` | `s3` | `local` потеряет файлы вместе с контейнером. |
| `S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY` | свои | S3-совместимое хранилище (Yandex Object Storage, MinIO, R2). |
| `INSTANCE_ID` | `wf-prod-01` | Маркер инстанса в job'ах BullMQ (в Docker hostname эфемерный, KI-387/391). |
| `OTEL_ENABLED` | `false` | `true` только когда есть OTLP-коллектор (SDK держит фоновый экспортёр). |
| `SANDBOX_ENABLED` | `true` | Режим `sandbox` узла `condition`; выключен по умолчанию в коде (безопасность), в проде включается осознанно. |
| `JWT_SECRET` | ≥ 32 символа | Подпись access-токенов; смена разлогинивает всех. |
| `METRICS_ALLOWED_IPS` | `127.0.0.1,::1,172.18.0.0/16` + IP внешнего скрейпера | `/metrics` без JWT: доступ только из доверенных сетей. |
| `THROTTLER_STORAGE` | `redis` (дефолт) | Общие счётчики rate limit между инстансами (KI-420); `memory` — только аварийный откат. |

---

## 5. Проверка после деплоя (smoke)

```bash
# 1. Health: 200 и обе зависимости up
curl -sS -i https://app.<домен>/health

# 2. Метрики: снаружи (не из allowlist) — 403, с разрешённого адреса — 200
curl -sS -o /dev/null -w '%{http_code}\n' https://app.<домен>/metrics

# 3. CORS preflight: заголовок должен вернуться только для origin из allowlist
curl -sS -i -X OPTIONS https://app.<домен>/workflow \
  -H 'Origin: https://app.<домен>' \
  -H 'Access-Control-Request-Method: GET'

# 4. Контейнеры и логи
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml ps
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml logs --tail=100 app
```

Ожидаемый `GET /health` при живых зависимостях:

```json
{ "status": "ok", "details": { "db": "up", "redis": "up" } }
```

Проверка отказа (на однотипной среде или в окно обслуживания):

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml stop redis
curl -sS -i https://app.<домен>/health     # 503 + {"status":"error","details":{"db":"up","redis":"down"}}
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml start redis
```

Docker-проверка `app` бьёт в `http://127.0.0.1:3000/health`: `healthy`
означает «API реально может обслуживать запросы» (БД и Redis живы).

---

## 6. Обновление образа по digest

Тег (`latest`, `v1.6.0`) можно перезаписать — digest нельзя. Поэтому в проде
фиксируется digest собранного образа: он однозначно определяет содержимое и
позволяет откатиться на байт-в-байт тот же образ.

```bash
# digest опубликованного образа (тот, что собран в CI)
docker buildx imagetools inspect ghcr.io/<owner>/workflow-builder:v1.6.0
# либо после pull:
docker image inspect --format '{{index .RepoDigests 0}}' \
  ghcr.io/<owner>/workflow-builder:v1.6.0
```

В `.env` на VPS:

```env
IMAGE_REF=ghcr.io/<owner>/workflow-builder@sha256:<digest>
```

Применение:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  pull app
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  up -d --no-build
curl -sS https://app.<домен>/health     # 200 → обновление успешно
```

`IMAGE_REF` перекрывает пару `IMAGE_NAME`/`IMAGE_TAG` (см.
`docker-compose.prod.yml`). Без `IMAGE_REF` работает прежняя схема
`IMAGE_NAME` + `IMAGE_TAG`.

> **Миграции вперёд.** Образ применяет миграции при старте. Drizzle не умеет
> откатывать схемы, поэтому откат digest'а безопасен, только если новые
> миграции обратно совместимы (добавление колонок/индексов). Если релиз менял
> данные несовместимо — откат делается восстановлением БД из бэкапа (§ 8),
> а не сменой digest'а.

---

## 7. Откат (rollback)

1. Вернуть **предыдущий** `IMAGE_REF` (digest) в `.env` — именно digest, не
   тег: тег могли перезаписать.
2. Применить:

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
     up -d --no-build app
   curl -sS https://app.<домен>/health
   ```

3. Проверить логи и `/health` в течение 5 минут после отката:

   ```bash
   docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
     logs --tail=200 app
   ```

4. Если схема БД уже несовместима со старым кодом — восстановить дамп из § 8
   (бэкап) и только потом запускать старый образ. Данные, созданные после
   дампа, будут потеряны: это крайняя мера.

Откат конфигурации (`.env`, `Caddyfile`) — тот же принцип: файлы хранятся в
git, `git diff`/`git checkout` на хосте, затем `restart`.

---

## 8. Бэкапы

### PostgreSQL

Ежедневный логический дамп в S3 (cron на хосте, не в контейнере):

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cd /opt/workflow-builder
set -a; . ./.env; set +a          # POSTGRES_USER/POSTGRES_DB из .env
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "/var/backups/workflow-builder/db-${STAMP}.dump"
aws s3 cp "/var/backups/workflow-builder/db-${STAMP}.dump" \
  "s3://<backup-bucket>/db/db-${STAMP}.dump" --endpoint-url "https://s3.example.com"
find /var/backups/workflow-builder -name '*.dump' -mtime +14 -delete
```

- **RPO при ежедневном дампе — до 24 ч.** Более короткий RPO (5 мин) требует
  WAL-архивации (PITR) — это **отложено** (KI-666), а не забыто.
- **Восстановление** (проверять на копии, не на проде):

  ```bash
  docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
    exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
    < db-<STAMP>.dump
  ```
- Раз в месяц — **учебное восстановление** в отдельный compose-проект и
  проверка `GET /health` + входа в UI. Непроверенный бэкап бэкапом не считается.

### Медиа (S3)

- Включить **versioning** и **lifecycle** (удаление старых версий) на бакете
  `workflow-builder-media`.
- Бакет не публичный: приложение отдаёт presigned-ссылки (`S3_PUBLIC_BUCKET=false`).
- Файлы не в БД: `pg_dump` их не содержит, поэтому бакет — отдельная точка
  бэкапа (репликация в другой регион/бакет по политике провайдера).

### Прочее

- `.env` и `Caddyfile` — в git (секреты — только в `.env` на хосте): восстановление
  конфигурации = checkout.
- Volume `caddy-data` (сертификаты) можно не бэкапить: Caddy получит их заново,
  но при частых пересозданиях есть риск упереться в лимиты Let's Encrypt.

---

## 9. Метрики, алерты, мониторинг

- **Prometheus** (`infra/prometheus/prometheus.yml`) скрейпит `/metrics`.
  В Docker источник — IP контейнера из подсети compose, поэтому добавьте её в
  `METRICS_ALLOWED_IPS` (например `172.18.0.0/16`). Снаружи ручка отвечает 403.
- **Grafana:** `infra/grafana/dashboard.json`.
- **Алерты (минимум):**
  - `GET /health` != 200 дольше 2 минут (Caddy/uptime-монитор);
  - контейнер `app` в состоянии `unhealthy` или рестартует;
  - доля 5xx > 1% за 5 минут;
  - очередь `workflow-runs` растёт (BullMQ waiting) — воркер не справляется;
  - диск хоста > 85%, `mem_limit` контейнера близок к лимиту (OOM-kill);
  - истечение TLS-сертификата < 14 дней (Caddy обновляет сам, алерт — на сбой).
- **Uptime-проверка** — внешняя, на `/health` (не на `/`): она должна падать,
  когда лежит БД или Redis, а не только когда упал процесс.

---

## 10. Логи и диск

- `json-file` с ротацией `max-size=10m`, `max-file=3` на каждый сервис
  (override): худший случай ~30 МБ на сервис, старые логи не съедают диск.
- Просмотр: `docker compose ... logs -f app` (осторожно: логи содержат
  метаданные запросов, но не промпты и не секреты — RULES 5.3/5.9).
- Чистка образов после обновлений: `docker image prune -f` (по cron, раз в
  неделю) — иначе каждый деплой оставляет слой.

---

## 11. Безопасность (чек-лист)

- [ ] UFW: разрешены только `22`, `80`, `443` (tcp), `443/udp`.
- [ ] SSH: ключи, `PermitRootLogin no`, пароли выключены.
- [ ] `.env` — `chmod 600`, владелец root/deploy; в git его нет.
- [ ] `AUTH_DISABLED=false`, `COOKIE_SECURE=true`, `NODE_ENV=production`
      (иначе приложение не стартует — это защита).
- [ ] `CORS_ALLOWED_ORIGINS` — ровно те origin'ы, что нужны (домен + Capacitor).
- [ ] `METRICS_ALLOWED_IPS` — loopback + подсеть Prometheus + резервный IP
      (`62.109.1.230`), без `0.0.0.0/0`.
- [ ] `/admin/*` закрыт `JwtAuthGuard` (+`OrgOwnerGuard`/`OrgOwnerOnlyGuard`) —
      проверяется кодом, но извне убедиться: `curl -o /dev/null -w '%{http_code}' -X POST https://app.<домен>/admin/members/invite` → 401.
- [ ] `SANDBOX_ENABLED=true` — только осознанно (исполнение пользовательского JS).
- [ ] Секреты не логируются (`RULES 5.3`): не включать DEBUG-уровень Pino в проде.

---

## 12. Типовые отказы

| Симптом | Причина | Что делать |
|---|---|---|
| `app` падает при старте: «CORS_ALLOWED_ORIGINS обязателен при NODE_ENV=production» | Пустой allowlist | Заполнить `CORS_ALLOWED_ORIGINS` в `.env`, `up -d`. |
| `app` падает: «COOKIE_SECURE=false недопустим в production» | Ослабили cookie | Вернуть `true`: HTTPS терминирует Caddy. |
| `GET /metrics` → 403 | IP не в allowlist (или Prometheus в другой подсети) | Добавить IP/подсеть в `METRICS_ALLOWED_IPS`, перезапустить `app`. |
| Caddy отдаёт 502 | `app` не прошёл healthcheck / упал | `docker compose ... logs app`; `curl 127.0.0.1:3000/health` внутри сети. |
| Все клиенты получают 429 одновременно | `TRUST_PROXY=false` за Caddy | Поставить `TRUST_PROXY=true`. |
| Refresh-cookie не ставится | `COOKIE_SECURE=false` или доступ по HTTP | Включить HTTPS, `COOKIE_SECURE=true`. |
| `docker compose config`: unknown tag `!reset` | Compose < 2.24 | Обновить Compose (KI-670) или убрать `!reset` и вручную удалить `ports` у `app` в базовом файле. |
| `db`/`redis` недоступны с хоста | Порты на loopback, но контейнер не поднят | `docker compose ... ps`, `logs db`. |
| Диск заполняется | Логи без ротации / старые образы | Проверить override, `docker image prune -f`. |

---

## 13. Связанные документы и KI

- Отчёт: [`reports/v1.6.0/S6-A-production-readiness.md`](reports/v1.6.0/S6-A-production-readiness.md).
- `docs/KNOWN_ISSUES.md`: KI-575 (`/metrics`), KI-419 (`TRUST_PROXY`),
  KI-658 (CORS/Capacitor), KI-666 (WAL/PITR), KI-667 (автобэкапы),
  KI-668 (CORS в staging/preprod), KI-669 (IPv6-CIDR), KI-670 (`!reset`).
- `docs/development/ARCHITECTURE.md` — порты и сервисы.
- `docs/development/GETTING_STARTED.md` § 7 — базовый локальный prod-стек.
