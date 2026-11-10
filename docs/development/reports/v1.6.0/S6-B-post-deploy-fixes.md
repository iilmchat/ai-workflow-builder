---
title: "S6-B: Post-Deploy Fixes & PRODUCTION.md Update (v1.6.0)"
date: 2026-11-10
version: v1.6.0
steps: [S6-B]
status: accepted
related_ki: [KI-664]
related_adr: []
---

# S6-B: Post-Deploy Fixes & PRODUCTION.md Update (v1.6.0)

Прод впервые поднят на FirstVDS: <https://ai-workflow-builder.ru>
(94.250.252.142), каталог `/srv/workflow-builder`. Инфра-агент разворачивает
образ из GHCR по digest. После деплоя обнаружился блокер: runtime-стадия
`Dockerfile` не копировала `api-prefixes.json`, и на проде файл временно
монтировался volume'ом. S6-B закрывает блокер в репозитории, фиксирует в
`PRODUCTION.md` фактические параметры прода и готовит backend к Android-сборке
(KI-664).

Работа выполнена **без коммита**: коммит делает пользователь. Секретов в коде и
документации нет.

## 1. Файлы (+/−)

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `Dockerfile` | изменён | 5 / 0 | `COPY --from=builder --chown=node:node /app/api-prefixes.json ./api-prefixes.json` в runtime-стадию, до `USER node` |
| `src/auth/auth.cookie.ts` | изменён | 151 / 9 | `RefreshCookieSameSite`, `isCapacitorOrigin`, `isRefreshCookieSameSite`, `resolveRefreshCookieOptions`; `setRefreshCookie`/`clearRefreshCookie` принимают `{ sameSite, secure }`; `SameSite=None` принудительно включает `Secure` |
| `src/auth/auth.cookie.spec.ts` | новый | 134 / 0 | 10 unit-тестов: мок `request.headers.origin`, оба Capacitor-origin'а, обычный origin, вне production, `COOKIE_SAMESITE=Lax/None`, мусор в env, `isCapacitorOrigin`, `isRefreshCookieSameSite` |
| `src/auth/auth.controller.ts` | изменён | 33 / 5 | `@Req()` в `register`/`login`; единый `refreshCookieOptions(request)` для установки, ротации и очистки cookie |
| `src/auth/auth.controller.spec.ts` | изменён | 69 / 3 | мок `NODE_ENV`/`COOKIE_SAMESITE`; 4 сценария: Capacitor → `None; Secure`, обычный origin → `Strict`, вне production → `Strict`, `Lax` из env |
| `src/config/env.schema.ts` | изменён | 18 / 0 | `COOKIE_SAMESITE` — строгий enum `Strict`/`Lax`/`None`, дефолт `Strict`, пустая строка = «не задано» (KI-084) |
| `src/config/env.schema.spec.ts` | изменён | 26 / 0 | 3 теста: дефолт/пустая строка, `Lax`/`None`, отказ на `strict` — через `toMatchObject` |
| `src/main.ts` | изменён | 15 / 4 | `credentials` в `enableCors` только при точном allowlist'е (`Array.isArray(corsOrigin)`), чтобы браузер принял cross-origin `Set-Cookie` и `origin: true` не открывал credentialed CORS |
| `.env.production.example` | изменён | 19 / 8 | `COOKIE_SAMESITE=Strict` + комментарий `# Для Android/Capacitor: COOKIE_SAMESITE=None`; медиа — фактический `local` + TTL 90, S3-блок закомментирован как TODO |
| `.env.example` | изменён | 4 / 0 | `COOKIE_SAMESITE=Strict` с пояснением про Capacitor |
| `docs/development/PRODUCTION.md` | изменён | 153 / 47 | Факты прода: `/srv/workflow-builder`, домен/IP, `local` TTL 90 дней, бэкапы `pg_dump \| age` 03:30 MSK/30 дней, `METRICS_ALLOWED_IPS=127.0.0.1,::1,172.18.0.0/16`, Caddy `--force-recreate`, § 13 «Известные проблемы» (`api-prefixes.json`) |
| `docs/CHANGELOG.md` | изменён | 24 / 0 | `[Unreleased] → Fixed` (Dockerfile) и `Changed` (cookie SameSite, KI-664) |
| `docs/KNOWN_ISSUES.md` | изменён | 42 / 25 | KI-664 → `Fixed` (v1.6.0 / S6-B) с описанием фикса; сводка пересчитана по строкам статуса |
| `docs/development/reports/README.md` | изменён | 1 / 0 | строка отчёта S6-B |
| `docs/development/reports/v1.6.0/S6-B-post-deploy-fixes.md` | новый | этот файл | отчёт по RULES 2.18 |

**Итог:** 13 изменённых файлов (`+560 / −101`) и 2 новых файла
(`auth.cookie.spec.ts` +134, отчёт +223).

## 2. Build / test

| Проверка | Команда | Результат |
|---|---|---|
| Сборка backend | `pnpm build` | 0 errors / 0 warnings |
| Типы (spec + src) | `pnpm typecheck` | OK |
| Тесты (весь backend) | `pnpm test` | **2041 passed / 26 skipped** (133 файла passed, 4 skipped) |
| Целевые тесты S6-B | `vitest run src/auth/auth.cookie.spec.ts src/auth/auth.controller.spec.ts src/config/env.schema.spec.ts` | **122 passed** |
| Линт | `pnpm lint` | 0 errors, 2 pre-existing warning в `openai-images.provider.spec.ts` (не связаны с S6-B) |
| Docker-образ | `docker build -t wf-test .` | OK; `api-prefixes.json` в образе, модуль загружается (см. § 4) |

## 3. Диагностика

**Путь к файлу.** `src/common/api-prefixes.ts` строит путь от `import.meta.url`:
в собранном виде это `/app/dist/common/api-prefixes.js`, `dirname` →
`/app/dist/common`, два уровня вверх → `/app`, итог —
`/app/api-prefixes.json` (`readFileSync` при импорте модуля, fail-fast).
Значит, в runtime-стадии файл должен лежать **в корне** `/app`, рядом с
`dist/`, а не внутри `dist/`. Добавленный `COPY` кладёт его именно туда и
делает владельцем `node` (`--chown=node:node`), чтобы чтение работало после
`USER node`.

**Почему старый образ падал.** Runtime-стадия копировала `package.json`,
`node_modules`, `dist`, `web/dist`, `drizzle`, `drizzle.config.ts` и
`docker-entrypoint.sh`, но не `api-prefixes.json`. Модуль импортируется при
старте (через `app.module.ts`/`ServeStatic`), поэтому процесс завершался с
`Не прочитан единый реестр API-префиксов: /app/api-prefixes.json`, а не
отдавал 404/SPA — это осознанный fail-fast (KI-472).

**Контекст сборки.** `.dockerignore` не исключает `api-prefixes.json`
(исключены `dist`, `node_modules`, `.env*`, `docs`, `test` и т.п.), поэтому
`COPY --from=builder` получает файл из стадии builder без дополнительных
правок.

**Проверка Docker.** Локально доступен Docker 29.8.1; `docker build -t wf-test .`
прошёл, слой `runner 10/11` — это новый `COPY`, файл в контейнере принадлежит
`node`, а `dist/common/api-prefixes.js` читает реестр без ошибки (см. § 4).
Прод-образ при этом **не пересобран**: это делает CI/инфра-агент после пуша
(см. § 5).

**Cookie.** Значение `SameSite` для `Set-Cookie` формируется в одном месте:
`AuthController.refreshCookieOptions()` → `resolveRefreshCookieOptions()`.
`COOKIE_SAMESITE` читается через `ConfigService` (RULES 4.6) и уже
валидирован `EnvSchema`; `Origin` сравнивается с точным набором
`https://localhost` / `capacitor://localhost`, а не с подстрокой.

## 4. Smoke

| # | Проверка | Результат |
|---|---|---|
| 1 | `docker build -t wf-test .` | OK, образ собран из рабочего дерева (слой `runner 10/11` — новый `COPY`) |
| 2 | `docker run --rm --entrypoint ls wf-test -la /app/api-prefixes.json` | `-rwxr-xr-x 1 node node 1426 … /app/api-prefixes.json` |
| 2a | `docker run --rm --entrypoint node wf-test -e "import('./dist/common/api-prefixes.js')…"` | `prefixes: 15 health: true` — модуль находит и валидирует реестр из `/app` |
| 3 | `pnpm exec vitest run …` (cookie/controller/env) | **122 passed** |
| 4 | `POST /auth/login`, `Origin: capacitor://localhost`, `NODE_ENV=production` | `Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=None; Path=/auth` |
| 5 | `POST /auth/login`, обычный `Origin`, production | `SameSite=Strict` + `Secure` |
| 6 | `POST /auth/login`, `Origin: https://localhost`, не production | `SameSite=Strict` (детект только в production) |
| 7 | `COOKIE_SAMESITE=Lax` | `SameSite=Lax` |
| 8 | `validateEnv(baseEnv)` без `COOKIE_SAMESITE` | `COOKIE_SAMESITE: 'Strict'` |
| 9 | `COOKIE_SAMESITE='strict'` (lowercase) | отказ валидации (`safeParse.success === false`) |

Сценарии 4–7 проверены supertest'ом на реальном `AuthController`
(`auth.controller.spec.ts`), 8–9 — на `EnvSchema` (`env.schema.spec.ts`).
Прод не дёргался: боевые логины/куки — зона инфра-агента, а локальный стенд
достаточно воспроизводит заголовки Express.

## 5. Что не так

1. **Фикс Dockerfile вступает в силу только после пересборки образа.** В
   рабочем дереве `COPY` есть, но прод по-прежнему работает на старом digest'е
   и **всё ещё монтирует** `api-prefixes.json` через volume. Нужны: пуш ветки
   → CI собирает образ → публикуется новый digest → инфра-агент меняет
   `IMAGE_REF` → `up -d --no-build app` → удаляет volume-монтирование
   (`PRODUCTION.md` § 13.1). До этого шага локальный фикс на прод не влияет.
2. **Локальная Docker-сборка не равна публикации.** Даже успешный
   `docker build -t wf-test .` создаёт образ только на рабочей машине; в GHCR
   он не попадает, digest не меняется. Проверка `ls` доказывает содержимое
   слоя, но не заменяет CI.
3. **Бэкапы БД — локальные и временные.** `pg_dump | age` в 03:30 MSK с
   retention 30 дней лежит на том же хосте (`/var/backups/workflow-builder`).
   Потеря VPS/диска уничтожит и БД, и бэкапы; offsite-копии (Selectel S3) пока
   нет. Приватный ключ `age` — единственная точка восстановления: без него
   дампы не расшифровать. Это зафиксировано в `PRODUCTION.md` § 8, но не
   автоматизировано в репозитории (**KI-667**); WAL/PITR не сделаны
   (**KI-666**), RPO — до 24 ч.
4. **Медиа на проде — `local`, TTL 90 дней.** Файлы лежат в volume и не входят
   в `pg_dump`; потеря хоста = потеря медиа. Переезд на Selectel S3 оставлен
   TODO, `.env.production.example` пока описывает `local`; S3-блок
   закомментирован, чтобы шаблон не расходился с фактом.
5. **`credentials` в CORS включается только при allowlist'е.** В production
   это точный список origin'ов — безопасно. В `staging`/`preprod`
   `resolveCorsOrigin` по-прежнему возвращает `origin: true`, поэтому
   credentials выключены: cross-origin cookie из Capacitor там работать не
   будет. Это следствие **KI-668**, а не регрессия S6-B; для проверки
   Android-сборки на staging нужно сначала распространить allowlist на
   prod-like среды.
6. **Автопереключение `None` — только `NODE_ENV=production`.** В
   `development`/`test` Capacitor-origin остаётся `Strict`; иначе `Secure`-
   cookie не сохранилась бы по http. Для локальной проверки WebView нужен
   HTTPS-туннель или явный `COOKIE_SAMESITE=None` (по http браузер всё равно
   отвергнет `Secure`).
7. **`PRODUCTION.md` описывает факты, но не проверяет хост.** Путь
   `/var/backups/workflow-builder`, cron-скрипт `/usr/local/bin/wb-backup-db.sh`
   и `/etc/age/*` — эксплуатационные примеры; их фактическое наличие/имена
   должен подтвердить инфра-агент (`crontab -l`, `ls /etc/age`). Если на хосте
   пути другие, документ нужно поправить, а не «подгонять» хост.
8. **Сводка KI в S6-A была неточной.** При пересчёте по строкам
   `**Статус:**` оказалось Fixed 287 / Planned 3 (а не 285 / 5, как в таблице
   S6-A). В S6-B KI-664 переведён в Fixed, поэтому актуально: Fixed 288 (+12
   частично), Open 286, Planned 3, всего 657. Цифры сверены скриптом, а не
   «на глаз» (RULES 3.20).

## 6. Новые KI

Новых KI нет: блокер `api-prefixes.json` исправлен в этом же пакете, а
остаточные ограничения уже покрыты существующими записями.

| KI | Изменение | Статус |
|---|---|---|
| [KI-664](../../KNOWN_ISSUES.md) | Refresh-cookie в Capacitor WebView: `SameSite=None; Secure` для Capacitor-origin в production, `COOKIE_SAMESITE`, `credentials` в CORS | **Fixed** (v1.6.0 / S6-B) |

Связанные, но не закрытые: KI-666 (WAL/PITR, `Deferred`), KI-667 (автобэкапы,
`Open`), KI-668 (CORS в staging/preprod, `Open`), KI-669 (IPv6-CIDR, `Open`),
KI-670 (`!reset`/Compose < 2.24, `Documented`). Счётчики: `### KI-` = 657,
строк статуса = 657, уникальных номеров = 657.

## 7. Обоснование решений

**Почему `COPY` в корень `/app`, а не в `dist/`.** Путь вычисляется от
`import.meta.url` и поднимается на два уровня; файл в `dist/` дал бы
`/app/dist/api-prefixes.json` и снова сломал бы старт. Копирование в `/app`
повторяет layout репозитория (`src/common/api-prefixes.ts` → корень), поэтому
один и тот же относительный путь работает и в dev, и в образе (RULES 1.9).

**Почему детект по `Origin`, а не по User-Agent.** `Origin` — структурированное
значение, которое WebView присылает автоматически и которое уже проверяется
CORS-allowlist'ом; UA подделывается тривиально и меняется между версиями
Android WebView. Сравнение точное (Set), без `startsWith`: иначе
`https://localhost.evil.example.com` получил бы `SameSite=None`.

**Почему `COOKIE_SAMESITE` — enum с дефолтом `Strict`.** Cookie остаётся
безопасной по умолчанию: `Strict` не отправляется при cross-site переходах
(CSRF), а оператор может осознанно поставить `Lax`/`None`. Свободная строка
допустила бы опечатку, которая молча превратилась бы в «неизвестное значение»
и неудачный `Set-Cookie` (RULES 4.35).

**Почему автопереключение сильнее env.** `COOKIE_SAMESITE` — значение по
умолчанию, а не запрет: Android-сборка должна работать «из коробки» без
отдельной переменной, иначе KI-664 воспроизведётся на проде при первом же
релизе. При этом `None` — только для точных Capacitor-origin'ов и только в
production; веб остаётся на `Strict`.

**Почему `None` принудительно включает `Secure`.** Браузеры отвергают
`SameSite=None` без `Secure` (Chrome — с M80). Если бы `COOKIE_SECURE=false`
остался в силе, cookie бы просто не установилась, и проблема выглядела бы
«мистически». Принудительный `Secure` делает поведение предсказуемым; в
production он и так `true` (KI-220).

**Почему `credentials` только при allowlist'е.** `Access-Control-Allow-
Credentials: true` вместе с отражением любого `Origin` (`origin: true`) —
это credentialed CORS для всего интернета: браузер начнёт принимать ответы с
cookie от любого сайта. В production `resolveCorsOrigin` возвращает массив,
поэтому `Array.isArray()` — точный признак «allowlist включён». В dev
cross-origin cookie не нужна: фронтенд ходит через Vite-proxy same-origin.

**Почему `clearRefreshCookie` повторяет атрибуты.** Cookie удаляется по имени
и пути, но в WebView `SameSite=None; Secure` и `SameSite=Strict` могут
трактоваться как разные записи при неаккуратной очистке. Повтор того же
`Set-Cookie` с истёкшим `maxAge` убирает расхождения и не стоит ничего.

**Почему документация фиксирует временное состояние, а не целевое.**
`PRODUCTION.md` — runbook эксплуатации, а не манифест. Если написать «медиа в
S3», а на проде `local`, при аварии будут искать несуществующий бакет. Поэтому
текущие значения (`local`, TTL 90, локальные бэкапы, volume для
`api-prefixes.json`) описаны явно, а целевые — помечены TODO и KI. Это
соответствует правилу «документация отражает HEAD/факт, а не желаемое»
(RULES 3.21).
