---
title: "S6-C: Production Hardening & Registration Mode (v1.6.0)"
date: 2026-11-10
version: v1.6.0
steps: [S6-C]
status: accepted
related_ki: []
related_adr: []
---

# S6-C: Production Hardening & Registration Mode (v1.6.0)

Прод работает на <https://ai-workflow-builder.ru> (FirstVDS, 94.250.252.142,
`/srv/workflow-builder`). Инфра-агент выявил эксплуатационные проблемы, которые
решаются в коде: Selectel S3 не отдаёт CORS для path-style URL (Android не
скачивает медиа), `/auth/register` всегда открыт, а единственный LLM —
локальный LM Studio без облачного резерва. S6-C добавляет
`S3_FORCE_PATH_STYLE`, `REGISTRATION_MODE` и базовый `LLM_FALLBACK_*`, а также
фиксирует факты прода в `PRODUCTION.md`.

Работа выполнена **без коммита**; секретов в коде и документации нет.

## 1. Файлы (+/−)

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `src/config/env.schema.ts` | изменён | 64 / 0 | `S3_FORCE_PATH_STYLE` (строгий boolean, default `false`), `REGISTRATION_MODE` (`open`/`invite`), `LLM_FALLBACK_PROVIDER` (`none`/`deepseek`/`yandex`/`openai`), `LLM_FALLBACK_API_KEY` |
| `src/config/env.schema.spec.ts` | изменён | 79 / 0 | тесты новых переменных через `toMatchObject`: дефолты, пустая строка, допустимые значения, отказ на мусор |
| `src/media/media-storage.service.ts` | изменён | 58 / 21 | `S3MediaStorageOptions.forcePathStyle`; `S3Client` получает флаг из env; virtual-hosted прямой URL; `storageKeyFromUrl` понимает оба формата |
| `src/media/media-storage.service.spec.ts` | изменён | 94 / 0 | тесты `forcePathStyle=false/true`: presigned URL, прямой URL публичного бакета, переподпись virtual-hosted |
| `src/auth/auth.service.ts` | изменён | 20 / 0 | `REGISTRATION_MODE=invite` → проверка `organization_invitations` до хэширования/транзакции, иначе `ForbiddenException` |
| `src/auth/auth.service.spec.ts` | изменён | 68 / 2 | сценарии `open` без инвайта, `invite` без инвайта (403), `invite` с инвайтом (успех + «сжигание») |
| `src/llm/llm-provider.factory.ts` | изменён | 99 / 0 | `createFallbackProvider`: провайдер из отдельного `LLM_FALLBACK_API_KEY`, без дубля основного ключа; WARN без ключа |
| `src/llm/llm-provider.factory.spec.ts` | изменён | 70 / 0 | тесты `none`, `deepseek`, отсутствие ключа, отсутствие дубля, `yandex` без folder_id |
| `.env.example` | изменён | 17 / 2 | `REGISTRATION_MODE=open`, `LLM_FALLBACK_*`, `S3_FORCE_PATH_STYLE=false` с комментариями |
| `.env.production.example` | изменён | 30 / 18 | Selectel S3 (endpoint/region/bucket/public/path-style), `REGISTRATION_MODE=open`, `LLM_FALLBACK_*`, метрики с `62.109.1.230` |
| `docs/development/PRODUCTION.md` | изменён | 113 / 73 | § 2 «Инфраструктура прода (факты)», правила эксплуатации (`--force-recreate`, бэкапы, регистрация), S3/медиа, метрики, troubleshooting |
| `docs/CHANGELOG.md` | изменён | 26 / 0 | `[Unreleased] → Added` — S6-C |
| `docs/development/reports/README.md` | изменён | 1 / 0 | строка отчёта S6-C |
| `docs/development/reports/v1.6.0/S6-C-production-hardening.md` | новый | этот файл | отчёт по RULES 2.18 |

**Итог:** 13 изменённых файлов (`+739 / −116`) и 1 новый файл (отчёт, +200
строк).

## 2. Build / test

| Проверка | Команда | Результат |
|---|---|---|
| Сборка backend | `pnpm build` | 0 errors / 0 warnings |
| Типы (src + spec) | `pnpm typecheck` | OK |
| Тесты (весь backend) | `pnpm test` | **2063 passed / 26 skipped** (133 файла passed, 4 skipped) |
| Целевые тесты S6-C | `vitest run src/config/env.schema.spec.ts src/auth/auth.service.spec.ts src/media/media-storage.service.spec.ts src/llm/llm-provider.factory.spec.ts src/llm/llm-router.service.spec.ts` | **241 passed** |
| Линт | `pnpm lint` | 0 errors, 2 pre-existing warning в `openai-images.provider.spec.ts` |

## 3. Диагностика

**S3 path-style vs virtual-hosted.** `S3Client` создавался с жёстким
`forcePathStyle: true`, поэтому presigned URL и прямые ссылки имели вид
`https://s3.ru-7.storage.selcloud.ru/wf-media-iilmchat/<key>`. Selectel не
отдаёт CORS-заголовки для такого URL, и Android WebView блокирует скачивание
медиа. Флаг вынесен в `S3_FORCE_PATH_STYLE` (default `false`), клиент получает
его из env, а прямой URL публичного бакета строится как
`https://<bucket>.<host>/<key>`. `storageKeyFromUrl` теперь понимает и
path-style, и virtual-hosted — старые строки `node_runs.stored_url`
переподписываются корректно.

**Проверка реальным SDK (без сети).** Собранный `dist` и настоящий
`@aws-sdk/s3-request-presigner`:

```text
https://wf-media-iilmchat.s3.ru-7.storage.selcloud.ru/run-1/node-a.png
has-selectel-host= true
```

**Регистрация.** `organization_invitations` не имеет колонки `status`: строка
существует, пока приглашение ожидает, и удаляется при регистрации/повторном
инвайте. Поэтому «pending» = найденная запись; отдельная миграция не нужна.
Проверка режима стоит **до** `hashPasswordAsync` и `db.transaction`: без
приглашения не тратится scrypt и не создаётся ни одной строки.

**LLM fallback.** `LlmProviderFactory` уже собирает провайдеров из env и
отдаёт их реестру; `LlmRouterService` уже умеет уходить в облако, когда
LM Studio недоступен/упал. Поэтому отдельный путь вызова не добавлялся:
`createFallbackProvider` создаёт облачного провайдера из
`LLM_FALLBACK_API_KEY`, если основного ключа этого вендора нет. Дубль не
создаётся (иначе реестр получил бы двух провайдеров с одинаковыми id моделей).

## 4. Smoke

| # | Проверка | Результат |
|---|---|---|
| 1 | `getSignedUrlAsync` с Selectel endpoint, `forcePathStyle=false` | URL начинается с `https://wf-media-iilmchat.s3.ru-7.storage.selcloud.ru/` |
| 2 | `forcePathStyle=true` (MinIO) | прежний `https://s3.test/media/...` — обратная совместимость |
| 3 | Прямой URL публичного бакета, `forcePathStyle=false` | `https://media.s3.test/run-1/node-a.png` |
| 4 | Переподпись virtual-hosted URL | ключ извлекается, ссылка обновлена, старая подпись не сохраняется |
| 5 | `REGISTRATION_MODE=open`, приглашения нет | регистрация успешна, роль `owner` |
| 6 | `REGISTRATION_MODE=invite`, приглашения нет | `403 Регистрация только по приглашению`, транзакция не запускалась |
| 7 | `REGISTRATION_MODE=invite` + приглашение | успех, роль из приглашения, строка приглашения удалена |
| 8 | `LLM_FALLBACK_PROVIDER=deepseek` + ключ | провайдер `deepseek` в списке, модели `deepseek-chat`/`deepseek-reasoner` |
| 9 | `LLM_FALLBACK_PROVIDER=deepseek` без ключа | WARN `LLM_FALLBACK_API_KEY не задан`, список провайдеров пуст |
| 10 | `LLM_FALLBACK_PROVIDER=deepseek` + `DEEPSEEK_API_KEY` | один провайдер `deepseek` (без дубля) |
| 11 | `LLM_FALLBACK_PROVIDER=yandex` без `YANDEX_FOLDER_ID` | WARN, fallback пропущен |
| 12 | `validateEnv` без новых переменных | `S3_FORCE_PATH_STYLE=false`, `REGISTRATION_MODE=open`, `LLM_FALLBACK_PROVIDER=none` |
| 13 | `validateEnv` на разобранном `.env.production.example` (dummy `JWT_SECRET`) | `MEDIA_STORAGE_BACKEND=s3`, `S3_FORCE_PATH_STYLE=false`, `REGISTRATION_MODE=open`, `METRICS_ALLOWED_IPS=127.0.0.1,::1,172.18.0.0/16,62.109.1.230` |

Прод не дёргался: реальные Selectel-ключи, CORS-конфигурация бакета и ключи
LLM-провайдеров — зона инфра-агента (см. § 5).

## 5. Что не так

1. **LLM-fallback — базовая заглушка, а не проверенная схема.** Код создаёт
   провайдера из `LLM_FALLBACK_API_KEY` и отдаёт его существующему роутеру, но
   **с реальными ключами DeepSeek/Yandex/OpenAI не проверялся**. Не задаётся
   отдельная модель fallback: используются дефолтные каталоги
   (`deepseek-chat`/`deepseek-reasoner`, `gpt-4o`/`gpt-4o-mini`,
   `yandexgpt-lite`/`yandexgpt`). Если исходный вызов требует vision/tools/
   большого контекста, роутер может не найти совместимую облачную модель и
   бросить `LlmProviderException` — это осознанно (лучше ошибка, чем тихая
   подмена). Нужна проверка с настоящим ключом, лимитами и сценарием
   «LM Studio выключен».
2. **CORS для бакета Selectel настраивается вне репозитория.** Код теперь
   генерирует virtual-hosted URL, но сам бакет должен разрешать `GET` с
   `https://ai-workflow-builder.ru`, `https://localhost` и
   `capacitor://localhost`. Без правила CORS на стороне Selectel браузер всё
   равно заблокирует ответ. Это шаг инфра-агента, в коде его нет.
3. **`S3_FORCE_PATH_STYLE` по умолчанию различается в env и конструкторе.**
   Env-дефолт — `false` (требование Selectel), а `S3MediaStorageOptions` без
   явного значения сохраняет прежнее `true`, чтобы прямые тесты/интеграции не
   меняли формат URL. `createMediaStorage` всегда передаёт env-значение, то
   есть в приложении поведение однозначное; расхождение затрагивает только
   ручное конструирование класса.
4. **`REGISTRATION_MODE=invite` проверяет приглашение вне транзакции.** Между
   SELECT и транзакцией приглашение может исчезнуть (параллельный отзыв/второй
   запрос). Тогда пользователь создастся в организации приглашения, а DELETE
   удалит 0 строк; гонка двух регистраций того же email всё равно упрётся в
   уникальность `users.email`. Сценарий редкий, но транзакционная проверка
   была бы строже.
5. **`open` + fail2ban не проверены из репозитория.** `REGISTRATION_MODE=open`
   документирован, fail2ban живёт на хосте; его правила, пороги и лог в код не
   входят. Утверждение «регистрация защищена fail2ban» — факт инфра-агента,
   который нужно периодически перепроверять (`fail2ban-client status`).
6. **Факты S3/бэкапов в `PRODUCTION.md` даны инфра-агентом.** Endpoint, регион,
   бакет, offsite-выгрузка и путь `/var/backups/workflow-builder` не
   проверялись из этой сессии; документ фиксирует текущее состояние, а не
   гарантирует, что каждый шаг cron реально выполняется. Проверка —
   `crontab -l`, наличие свежего `.dump.age` и объекта в бакете.
7. **Документация переведена с `local` на `s3` для медиа.** Если на момент
   чтения прод ещё работает на `local` (образ без S6-C или не заполнены
   ключи Selectel), это расхождение с фактом: `MEDIA_STORAGE_BACKEND=s3` без
   ключей откатывается на `local` с WARN. После выкладки S6-C и заполнения
   `.env` документ и прод совпадут.

## 6. Новые KI

Новых KI нет. Ограничения S6-C — это проверки с реальными ключами и
настройками хоста (LLM-fallback, CORS бакета, fail2ban), они зафиксированы в
§ 5 и `PRODUCTION.md`; для них не нужен отдельный дефект в реестре, пока нет
воспроизводимого сбоя кода. Существующие KI не закрывались.

## 7. Обоснование решений

**Почему флаг S3, а не смена кода на virtual-hosted всегда.** MinIO и старые
S3-совместимые хранилища часто работают только в path-style: жёсткий переход
сломал бы их деплой. Env-флаг оставляет Selectel рабочую схему по умолчанию
(`false`), а оператор может вернуть `true` для своего хранилища. Строгий
boolean, а не `z.coerce.boolean()`: строка `'false'` иначе стала бы `true` и
молча вернула path-style, то есть снова сломала бы CORS.

**Почему прямой URL публичного бакета тоже virtual-hosted.** Presigned URL
строит SDK по `forcePathStyle`, а прямой URL собирался вручную. Если оставить
его path-style, публичный бакет в Android снова упрётся в CORS. Оба пути
должны давать один стиль.

**Почему переподпись понимает оба формата.** `stored_url` старых запусков
записан в path-style; после переключения флага они не должны перестать
открываться. Новые строки идут через `storage_key`, но fallback по URL нужен
для записей до v0.10 (KI-464).

**Почему отдельный `LLM_FALLBACK_API_KEY`, а не требование
`DEEPSEEK_API_KEY`.** Прод живёт на LM Studio и не должен держать основные
облачные ключи «на всякий случай». Отдельный ключ явно означает «аварийный
резерв», не участвует в обычном выборе модели и легко отзывается. Провайдер
добавляется в общий реестр, поэтому не пришлось дублировать логику
`LlmRouterService`: fallback уже покрыт тестами роутера.

**Почему проверка режима регистрации до хэширования.** `scrypt` намеренно
дорогой; отвечать `403` после него — лишняя нагрузка, которую может
использовать перебор. Проверка существования приглашения — один indexed
SELECT по `organization_invitations.email` (индекс есть с миграции 0016).

**Почему `open` остаётся дефолтом.** Это текущее поведение и требование
продукта: прод открыт для регистрации, защита — fail2ban на хосте. `invite`
включается явно для закрытого контура; делать его дефолтом значило бы
сломать существующий сценарий регистрации без приглашений.

**Почему документация разнесена на «факты» и «правила».** Факты (хостинг,
S3, метрики, LM Studio) нужны для диагностики в момент аварии, а правила
(`--force-recreate`, offsite-бэкапы, режим регистрации) — чтобы изменения
применялись одинаково. Смешивать их с общими инструкциями по деплою значило
бы снова получить runbook, который расходится с продом (RULES 3.21).
