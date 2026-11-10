# Production: развёртывание на VPS

**Версия:** v1.6.0 (S6-C) · **Обновлено:** 2026-11-10
**Стек:** Docker Compose (app + db + redis + caddy) · Ubuntu 24.04 · FirstVDS
**Прод:** <https://ai-workflow-builder.ru> (94.250.252.142), каталог
`/srv/workflow-builder`.

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

## 2. Инфраструктура и топология

### Инфраструктура прода (факты)

| Параметр | Значение |
|---|---|
| Хостинг | FirstVDS, `94.250.252.142`, Ubuntu 24.04 |
| Домен | <https://ai-workflow-builder.ru> |
| Каталог | `/srv/workflow-builder` |
| S3 (медиа) | Selectel: `S3_ENDPOINT=https://s3.ru-7.storage.selcloud.ru`, `S3_REGION=ru-7`, `S3_BUCKET=wf-media-iilmchat`, `S3_PUBLIC_BUCKET=false`, `S3_FORCE_PATH_STYLE=false` (virtual-hosted — иначе Selectel не отдаёт CORS) |
| Метрики | `METRICS_ALLOWED_IPS=127.0.0.1,::1,172.18.0.0/16,62.109.1.230` |
| LLM | локальный LM Studio через reverse-SSH туннель, **22 модели**; `LLM_ROUTER_ENABLED=true`, облачный fallback — `LLM_FALLBACK_PROVIDER`/`LLM_FALLBACK_API_KEY` |
| Бэкапы БД | `pg_dump \| age` в **03:30 MSK**, retention **30 дней**, локально + offsite в S3 |
| Регистрация | `REGISTRATION_MODE=open` + fail2ban на хосте; режим `invite` — только по ожидающему приглашению |

### Топология

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

1. **DNS:** A-запись (и AAAA, если есть IPv6) `ai-workflow-builder.ru` → IP VPS.
2. **Порты:** UFW/облачный firewall открывает `22`, `80/tcp`, `443/tcp`,
   `443/udp`. Порты `3000`, `5432`, `6379` наружу **не** открываются никогда.
3. **Docker:** Engine 27+ и Compose **≥ 2.24** (тег `!reset`); проверить:
   `docker compose version`. Старее — KI-670.
4. **Секреты:** `JWT_SECRET` (≥ 32 символа), пароль PostgreSQL, ключи Selectel
   S3 (`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`), сервисный токен RuStore
   (если push включён) и ключ аварийного LLM-fallback (если включён).
   Генерировать, например, `openssl rand -hex 32`. В git они не попадают.
5. **Каталог:** `/srv/workflow-builder` (фактический путь на проде; пути в
   командах ниже — от него). Репозиторий клонируется целиком: `Caddyfile` и
   compose-файлы читаются из рабочей копии.

---

## 4. Первый деплой

```bash
# 1. Код и шаблон окружения
git clone <repo-url> /srv/workflow-builder
cd /srv/workflow-builder
cp .env.production.example .env
chmod 600 .env                 # секреты не должны быть world-readable

# 2. Заполнить ВСЕ заглушки <...> в .env (редактор, не sed: значения с / и @)
#    Обязательно: POSTGRES_PASSWORD, JWT_SECRET, CORS_ALLOWED_ORIGINS,
#    METRICS_ALLOWED_IPS (подсеть compose + внешний скрейпер), INSTANCE_ID,
#    S3_ENDPOINT/S3_BUCKET/S3_REGION/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY.

# 3. Домен в Caddyfile
#    app.example.com { ... }  →  ai-workflow-builder.ru { ... }

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
| `COOKIE_SAMESITE` | `Strict` | Значение по умолчанию для веба. Для запросов из Capacitor WebView (`Origin: capacitor://localhost` / `https://localhost`) в production код сам ставит `None; Secure` (KI-664, S6-B). |
| `CORS_ALLOWED_ORIGINS` | `https://ai-workflow-builder.ru,https://localhost,capacitor://localhost` | Пустое значение — **отказ старта** (S6-A): CORS не открывается «всему интернету». |
| `DATABASE_URL` | `postgres://<user>:<pass>@db:5432/<db>` | Внутри compose перекрывается сборкой из `POSTGRES_*`; строка нужна для запуска образа без compose. |
| `POSTGRES_USER/PASSWORD/DB` | свои значения | Их использует контейнер `db`; пароль должен совпадать с `DATABASE_URL`. |
| `REDIS_URL` | `redis://redis:6379` | Очереди BullMQ + общий rate limit. |
| `MEDIA_STORAGE_BACKEND` | `s3` | Медиа в Selectel S3; `local` (TTL 90 дней) — только аварийный откат, файлы потеряются вместе с VPS. |
| `S3_ENDPOINT` | `https://s3.ru-7.storage.selcloud.ru` | Selectel S3, регион `ru-7`. |
| `S3_BUCKET` | `wf-media-iilmchat` | Приватный бакет медиа. |
| `S3_REGION` | `ru-7` | Регион Selectel (обязателен для SigV4). |
| `S3_PUBLIC_BUCKET` | `false` | Presigned GET на час; прямой URL приватного бакета даёт 403 (KI-444). |
| `S3_FORCE_PATH_STYLE` | `false` | Virtual-hosted style: Selectel не отдаёт CORS для path-style, из-за чего Android/Capacitor не скачивает медиа (S6-C). |
| `S3_ACCESS_KEY_ID/SECRET_ACCESS_KEY` | свои | Секреты Selectel; в git не попадают. |
| `MEDIA_STORAGE_LOCAL_TTL_DAYS` | `90` | TTL локального аварийного бэкенда; cron приложения удаляет файлы старше TTL. |
| `INSTANCE_ID` | `wf-prod-01` | Маркер инстанса в job'ах BullMQ (в Docker hostname эфемерный, KI-387/391). |
| `OTEL_ENABLED` | `false` | `true` только когда есть OTLP-коллектор (SDK держит фоновый экспортёр). |
| `SANDBOX_ENABLED` | `true` | Режим `sandbox` узла `condition`; выключен по умолчанию в коде (безопасность), в проде включается осознанно. |
| `JWT_SECRET` | ≥ 32 символа | Подпись access-токенов; смена разлогинивает всех. |
| `METRICS_ALLOWED_IPS` | `127.0.0.1,::1,172.18.0.0/16,62.109.1.230` | `/metrics` без JWT: loopback + подсеть compose + внешний скрейпер. |
| `THROTTLER_STORAGE` | `redis` (дефолт) | Общие счётчики rate limit между инстансами (KI-420); `memory` — только аварийный откат. |
| `REGISTRATION_MODE` | `open` | `/auth/register` открыт, на хосте — fail2ban. `invite` — только по ожидающему приглашению (403 без него), S6-C. |
| `LLM_ROUTER_ENABLED` | `true` | Локальный LM Studio как основной маршрут, облако — fallback. |
| `LLM_FALLBACK_PROVIDER` | `none` (включается при появлении ключа) | `deepseek`/`yandex`/`openai` — аварийный облачный провайдер, если LM Studio недоступен (S6-C). |
| `LLM_FALLBACK_API_KEY` | не задан/секрет | Ключ аварийного провайдера; без него WARN и fallback пропускается. |

---

## 5. Проверка после деплоя (smoke)

```bash
# 1. Health: 200 и обе зависимости up
curl -sS -i https://ai-workflow-builder.ru/health

# 2. Метрики: снаружи (не из allowlist) — 403, с разрешённого адреса — 200
curl -sS -o /dev/null -w '%{http_code}\n' https://ai-workflow-builder.ru/metrics

# 3. CORS preflight: заголовок должен вернуться только для origin из allowlist
curl -sS -i -X OPTIONS https://ai-workflow-builder.ru/workflow \
  -H 'Origin: https://ai-workflow-builder.ru' \
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
curl -sS -i https://ai-workflow-builder.ru/health     # 503 + {"status":"error","details":{"db":"up","redis":"down"}}
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml start redis
```

Docker-проверка `app` бьёт в `http://127.0.0.1:3000/health`: `healthy`
означает «API реально может обслуживать запросы» (БД и Redis живы).

### Эксплуатация: правила применения изменений

- **`Caddyfile` и `prometheus.yml` — только через пересоздание сервиса.**
  Оба файла смонтированы single-file bind mount'ом, поэтому правка на хосте
  применяется командой:

  ```bash
  cd /srv/workflow-builder
  docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
    up -d --force-recreate caddy
  docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
    up -d --force-recreate prometheus
  ```

  `restart`/перечитывание «на лету» не использовать: контейнер может остаться
  со старым файлом, а ошибка конфигурации всплывёт позже. Перед пересозданием
  `caddy` — `caddy validate` (см. § 6).
- **Бэкапы БД:** `pg_dump | age` в **03:30 MSK**, retention **30 дней**;
  локальная копия на хосте + выгрузка offsite в S3 (см. § 8). Offsite-копия —
  обязательная часть: локальный дамп не переживёт потерю VPS.
- **Регистрация:** на проде `REGISTRATION_MODE=open` и fail2ban на хосте
  (rate limit приложения — отдельный слой). Для закрытого контура —
  `REGISTRATION_MODE=invite`: без ожидающего приглашения в
  `organization_invitations` регистрация отвечает `403`.

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
curl -sS https://ai-workflow-builder.ru/health     # 200 → обновление успешно
```

`IMAGE_REF` перекрывает пару `IMAGE_NAME`/`IMAGE_TAG` (см.
`docker-compose.prod.yml`). Без `IMAGE_REF` работает прежняя схема
`IMAGE_NAME` + `IMAGE_TAG`.

### Правка `Caddyfile`

`Caddyfile` смонтирован в контейнер томом, поэтому изменения применяются
**только пересозданием** контейнера. На проде используйте именно
`up -d --force-recreate caddy` (не `restart`: контейнер может остаться со
старым файлом/конфигом):

```bash
cd /srv/workflow-builder
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  up -d --force-recreate caddy
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  logs --tail=50 caddy
curl -sS -o /dev/null -w '%{http_code}\n' https://ai-workflow-builder.ru/health
```

`caddy validate` — до пересоздания: синтаксическая ошибка иначе оставит сайт
без TLS и reverse proxy.

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
   curl -sS https://ai-workflow-builder.ru/health
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
git, `git diff`/`git checkout` на хосте, затем `up -d` для `.env` и
`up -d --force-recreate caddy` для `Caddyfile` (см. § 6).

---

## 8. Бэкапы

### PostgreSQL

**Текущий прод:** ежедневный логический дамп, зашифрованный `age`, в **03:30
MSK**, retention **30 дней**: локальная копия в `/var/backups/workflow-builder`
**и offsite-выгрузка в S3 (Selectel)**. Скрипт и cron живут на хосте (в
репозитории их пока нет — KI-667):

```bash
#!/usr/bin/env bash
# /usr/local/bin/wb-backup-db.sh — запускается cron'ом на хосте.
set -euo pipefail
STAMP="$(TZ=Europe/Moscow date +%Y%m%dT%H%M%S)"
BACKUP_DIR=/var/backups/workflow-builder
mkdir -p "$BACKUP_DIR"
cd /srv/workflow-builder
set -a; . ./.env; set +a          # POSTGRES_USER/POSTGRES_DB из .env
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  | age -R /etc/age/backup.pub \
  > "$BACKUP_DIR/db-${STAMP}.dump.age"
# Offsite: загрузить свежий .dump.age в S3-бакет бэкапов (Selectel; aws s3 cp
# или mc cp — инструмент, установленный на хосте). Локальная копия — не бэкап.
# Retention 30 дней — и локально, и в бакете (lifecycle-правило).
find "$BACKUP_DIR" -name 'db-*.dump.age' -mtime +30 -delete
```

Cron (TZ сервера — Europe/Moscow; `03:30` — ночное окно без релизов):

```cron
30 3 * * * /usr/local/bin/wb-backup-db.sh >> /var/log/wb-backup-db.log 2>&1
```

- **Куда сохраняется:** локально `/var/backups/workflow-builder/db-*.dump.age`
  и offsite — тот же файл в S3-бакете бэкапов (Selectel). `age` шифрует дамп
  публичным ключом (`/etc/age/backup.pub`), приватный (`/etc/age/backup.key`) —
  только на хосте и в офлайн-копии; секретов в репозитории нет (RULES 5.1).
- **Offsite обязателен:** локальный дамп на том же диске не переживёт потерю
  VPS и не защищает от ошибки оператора. S3-копия — единственная защита от
  потери хоста; retention 30 дней настраивается lifecycle-правилом бакета.
- **RPO при ежедневном дампе — до 24 ч.** Более короткий RPO (5 мин) требует
  WAL-архивации (PITR) — это **отложено** (KI-666), а не забыто.
- **Восстановление** (проверять на копии, не на проде):

  ```bash
  age -d -i /etc/age/backup.key db-<STAMP>.dump.age \
    | docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
        exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists
  ```
- Раз в месяц — **учебное восстановление** в отдельный compose-проект и
  проверка `GET /health` + входа в UI. Непроверенный бэкап бэкапом не считается.

### Медиа (Selectel S3)

**Текущий прод:** `MEDIA_STORAGE_BACKEND=s3`,
`S3_ENDPOINT=https://s3.ru-7.storage.selcloud.ru`, `S3_REGION=ru-7`,
`S3_BUCKET=wf-media-iilmchat`, `S3_PUBLIC_BUCKET=false`. Файлы в приватном
бакете, UI получает presigned GET на час; просроченная ссылка переподписывается
по `storage_key`.

- **`S3_FORCE_PATH_STYLE=false` обязателен.** Selectel не отдаёт CORS-заголовки
  для path-style URL, поэтому Android/Capacitor не может скачать медиа.
  Virtual-hosted style: `https://wf-media-iilmchat.s3.ru-7.storage.selcloud.ru/<key>`.
- Включить **versioning** и **lifecycle** на бакете: удаление старых версий и
  репликация/offsite по политике провайдера. `pg_dump` медиа **не содержит**,
  поэтому бакет — отдельная точка бэкапа.
- `MEDIA_STORAGE_BACKEND=local` (`MEDIA_STORAGE_LOCAL_TTL_DAYS=90`) — только
  аварийный откат: файлы лежат в volume и теряются вместе с VPS.

### Прочее

- `.env` и `Caddyfile` — в git (секреты — только в `.env` на хосте): восстановление
  конфигурации = checkout.
- Volume `caddy-data` (сертификаты) можно не бэкапить: Caddy получит их заново,
  но при частых пересозданиях есть риск упереться в лимиты Let's Encrypt.

---

## 9. Метрики, алерты, мониторинг

- **Prometheus** (`infra/prometheus/prometheus.yml`) скрейпит `/metrics`.
  На проде `METRICS_ALLOWED_IPS=127.0.0.1,::1,172.18.0.0/16,62.109.1.230`:
  loopback — scrape с самого хоста, `172.18.0.0/16` — подсеть compose (IP
  контейнера меняется при пересоздании, поэтому разрешена подсеть, а не адрес),
  `62.109.1.230` — внешний скрейпер. Снаружи остальные адреса получают 403.
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
- [ ] `METRICS_ALLOWED_IPS` — loopback + подсеть Prometheus + внешний скрейпер
      (`127.0.0.1,::1,172.18.0.0/16,62.109.1.230` на проде), без `0.0.0.0/0`.
- [ ] `/admin/*` закрыт `JwtAuthGuard` (+`OrgOwnerGuard`/`OrgOwnerOnlyGuard`) —
      проверяется кодом, но извне убедиться: `curl -o /dev/null -w '%{http_code}' -X POST https://ai-workflow-builder.ru/admin/members/invite` → 401.
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
| Refresh-cookie не работает только в Android-приложении | WebView (`https://localhost`) и API — разные origin'ы, `SameSite=Strict` не отправляется | S6-B ставит `None; Secure` для Capacitor-origin в production (KI-664); проверить `NODE_ENV=production`, `COOKIE_SECURE=true` и `Origin` запроса. |
| `app` падает: «Не прочитан единый реестр API-префиксов: /app/api-prefixes.json» | В образе нет `api-prefixes.json` (образы до S6-B) | Обновить digest на собранный после S6-B и убрать volume-монтирование (см. § 13.1). |
| Медиа не скачивается в Android/Capacitor, в браузере — работает | S3 в path-style: Selectel не отдаёт CORS для `<endpoint>/<bucket>/…` | `S3_FORCE_PATH_STYLE=false` (virtual-hosted), пересоздать `app`. |
| `POST /auth/register` → 403 «Регистрация только по приглашению» | `REGISTRATION_MODE=invite`, а приглашения для email нет | Пригласить пользователя (`organization_invitations`) или вернуть `REGISTRATION_MODE=open`. |
| `docker compose config`: unknown tag `!reset` | Compose < 2.24 | Обновить Compose (KI-670) или убрать `!reset` и вручную удалить `ports` у `app` в базовом файле. |
| `db`/`redis` недоступны с хоста | Порты на loopback, но контейнер не поднят | `docker compose ... ps`, `logs db`. |
| Диск заполняется | Логи без ротации / старые образы | Проверить override, `docker image prune -f`. |

---

## 13. Известные проблемы

### 13.1 `api-prefixes.json` (исправлено в S6-B)

**Исторический симптом:** `app` падал на старте с
«Не прочитан единый реестр API-префиксов: /app/api-prefixes.json».

**Причина:** runtime-стадия `Dockerfile` до S6-B копировала `dist`,
`package.json`, `node_modules`, `web/dist`, `drizzle` и entrypoint, но **не**
`api-prefixes.json`. Модуль `src/common/api-prefixes.ts` строит путь от
`dist/common/api-prefixes.js` на два уровня вверх — к `/app/api-prefixes.json`,
поэтому без файла backend не стартует (fail-fast при импорте). На проде файл
временно монтировался volume'ом.

**Fix (S6-B):** в runtime-стадию добавлен
`COPY --from=builder --chown=node:node /app/api-prefixes.json ./api-prefixes.json`.
Проверка внутри образа:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.prod.override.yml \
  exec app ls -l /app/api-prefixes.json
```

Если используется образ **до S6-B**, нужно обновить `IMAGE_REF` на digest
после S6-B и убрать volume-монтирование из прод-конфигурации, затем
`up -d --force-recreate app`. Для актуального образа монтирование не нужно и
только затеняет файл из digest'а.

---

## 14. Связанные документы и KI

- Отчёты: [`reports/v1.6.0/S6-A-production-readiness.md`](reports/v1.6.0/S6-A-production-readiness.md),
  [`reports/v1.6.0/S6-B-post-deploy-fixes.md`](reports/v1.6.0/S6-B-post-deploy-fixes.md),
  [`reports/v1.6.0/S6-C-production-hardening.md`](reports/v1.6.0/S6-C-production-hardening.md).
- `docs/KNOWN_ISSUES.md`: KI-575 (`/metrics`), KI-419 (`TRUST_PROXY`),
  KI-658 (CORS/Capacitor), KI-664 (refresh-cookie в WebView — **Fixed** в
  S6-B), KI-666 (WAL/PITR), KI-667 (автобэкапы), KI-668 (CORS в
  staging/preprod), KI-669 (IPv6-CIDR), KI-670 (`!reset`).
- `docs/development/ARCHITECTURE.md` — порты и сервисы.
- `docs/development/GETTING_STARTED.md` § 7 — базовый локальный prod-стек.
