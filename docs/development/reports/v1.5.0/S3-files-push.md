---
title: "S3: Файлы (DOCX) + Push (device_tokens, POST /notifications/register)"
date: 2026-11-09
version: v1.5.0
steps: [S3]
status: accepted
related_ki: [KI-651, KI-652, KI-653, KI-654]
related_adr: []
---

# Отчёт S3: файлы (DOCX) + push-уведомления (v1.5.0)

**Ветка:** `main`, HEAD `0225430` (`feat(v1.5.0): S1+S2 — Capacitor: каркас,
камера/QR, блокеры S3`). Сессия — **без коммитов**: `git add`/`git commit`
не выполнялись, `git add -A` не использовался, индекс пуст
(`git diff --cached --name-only` → 0 файлов), HEAD по-прежнему `0225430`.
Изменения оставлены в рабочем дереве.

**Задача (DESIGN V150 § 3 S3, промпт S3):**
1. фронтенд — нативное скачивание/открытие DOCX (`useFileDownload`) и
   инициализация push (`usePushNotifications`);
2. бэкенд — таблица `device_tokens` (миграция `0021`), модуль
   `src/notifications/`, `POST /notifications/register`;
3. UI — кнопка «Скачать DOCX» в `DocumentGenNode` использует нативный
   file opener; push инициализируется в `App.tsx` после аутентификации;
4. docs — закрыть KI-652 (11 кратких дублей заголовков KI-635..645).

**Правила:** `docs/development/RULES.md` v1.10.0 (в первую очередь 1.4, 1.17,
2.1, 2.12, 2.15, 2.18, 3.10, 3.17, 3.20, 4.1, 4.10, 4.13, 4.14, 4.18,
4.23–4.26, 6.11).

**Схема работы.** Часть A (бэкенд) и часть D (docs) выполнялись параллельно
двумя субагентами (`backend-dev`, `docs-curator`) в непересекающихся
write-scope, части B/C (фронтенд) — ведущим; финальные гейты, ревью diff и
этот отчёт — ведущим. Пересечений файлов между исполнителями не было
(`api-prefixes.json` — зона бэкенда, `web/src/lib/**` и `web/src/hooks/**` —
зона ведущего).

## 1. Файлы (+/−)

### A. Backend: `device_tokens` + модуль уведомлений

| Файл | +/− | Что именно |
|---|---:|---|
| `src/db/schema.ts` | +66/−0 | `DEVICE_TOKEN_PLATFORMS` (`android`/`ios`/`web`) + тип `DeviceTokenPlatform`; таблица `deviceTokens` (`uuid` PK `defaultRandom`, оба FK `ON DELETE CASCADE`, `token` с `.unique()`, `platform` с `$type<>()`, `created_at timestamptz default now()`, `index('device_tokens_user_id_idx')`, `check('device_tokens_platform_check', sql\`${table.platform} in ('android','ios','web')\`)`), типы `DeviceToken`/`NewDeviceToken`. Русский JSDoc с обоснованием UPSERT по токену и денормализации `organization_id` |
| `drizzle/0021_dizzy_reptil.sql` | +14 (new) | сгенерирован `pnpm db:generate`, руками **не** правился: `CREATE TABLE "device_tokens"`, оба `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … ON DELETE cascade`, `CREATE INDEX … USING btree ("user_id")` |
| `drizzle/meta/0021_snapshot.json` | +1506 (new) | снимок drizzle-kit (генерируется, не редактировался) |
| `drizzle/meta/_journal.json` | +7/−0 | запись `idx: 21`, `tag: 0021_dizzy_reptil` (генерируется) |
| `src/notifications/dto/register-device-token.dto.ts` | 25 (new) | `RegisterDeviceTokenSchema` (Zod): `token: z.string().min(1)`, `platform: z.enum(DEVICE_TOKEN_PLATFORMS)`; тип `RegisterDeviceTokenDto` |
| `src/notifications/device-tokens.service.ts` | 92 (new) | `DeviceTokensService` (`@Inject(DRIZZLE)`): `upsertAsync(userId, organizationId, token, platform)` — `insert().values().onConflictDoUpdate({ target: deviceTokens.token, set: { userId, organizationId } })`; `resolveOrganizationIdAsync(userId)` — один `SELECT users.organization_id` (KI-554), `UnauthorizedException` при отсутствии строки |
| `src/notifications/notifications.controller.ts` | 84 (new) | `@Controller('notifications')`, `POST register` + `@UseGuards(JwtAuthGuard)` + `@Body(ZodValidationPipe.create(RegisterDeviceTokenSchema))` + `@Header('Cache-Control','no-store')`; ответ `{ ok: true }`; организация резолвится из БД по `user.sub` |
| `src/notifications/notifications.module.ts` | 25 (new) | `imports: [DbModule, AuthModule]`, `providers: [DeviceTokensService]`, `exports: [DeviceTokensService]` |
| `src/notifications/device-tokens.service.spec.ts` | 199 (new) | 4 теста: SQL-параметры upsert'а (`onConflictDoUpdate` по `token`, `set` без `platform`/`created_at`), резолв организации, `UnauthorizedException` для удалённого пользователя, проброс ошибки драйвера |
| `src/notifications/notifications.controller.spec.ts` | 212 (new) | 6 тестов: `POST /notifications/register` возвращает `{ok:true}` и делегирует в сервис, `Cache-Control: no-store` (supertest), 400 на пустой токен / чужую платформу, 401 без токена, порядок «резолв организации → upsert» |
| `src/app.module.ts` | +5/−0 | `NotificationsModule` в `imports` (после `OrgMembersModule`, с комментарием в стиле файла) |
| `api-prefixes.json` | +1/−0 | `{ "prefix": "notifications" }` — без него Vite-proxy и SPA-fallback backend'а не видят ручку, а паритет-спеки падают |
| `src/common/api-prefixes.spec.ts` | +6/−3 | `EXPECTED_CONTROLLER_PREFIXES` 12 → 13 (+`notifications`), комментарий и заголовок теста «13 префиксов» |

### B. Frontend: файлы DOCX

| Файл | +/− | Что именно |
|---|---:|---|
| `web/src/hooks/useFileDownload.ts` | 123 (new) | `MIME_DOCX`, `MIME_PDF`, `downloadAndOpenFileAsync(url, fileName, mimeType = MIME_DOCX)`: веб-ветка — программный `<a download>`; нативная — `fetch` → `Blob` → base64 (`FileReader`, без `data:`-префикса) → `Filesystem.writeFile({ directory: Directory.Documents, recursive: true })` → `FileOpener.open({ filePath: result.uri, contentType })`. Ошибки не глотаются (RULES 4.18) |
| `web/src/hooks/useFileDownload.spec.ts` | 145 (new) | 4 теста: веб → создаётся `<a>` с `href`/`download`, `click()` вызван, плагины не тронуты; натив → `writeFile` с `data: 'aGVsbG8='` (реальный `Blob` + jsdom `FileReader`) и `FileOpener.open` с правильным `contentType`; явный `MIME_PDF`; не-2xx → `throw`, файл не пишется |
| `web/src/components/nodes/DocumentGenNode.tsx` | +80/−17 | ссылка «Скачать DOCX/PDF» получила `onClick`: в браузере событие не перехватывается (прежний `<a href download target=_blank>`), в нативе — `preventDefault()` + `downloadAndOpenFileAsync(downloadUrl, fileName ?? document.${outputFormat}, mimeType)`; `mimeType` = `outputs.mimeType` либо `MIME_PDF`/`MIME_DOCX` по формату; состояние `downloadError` и строка ошибки под ссылкой (`data-document-gen-download-error`) |
| `web/src/components/nodes/DocumentGenNode.spec.tsx` | +158/−0 | моки `@/lib/platform` (`downloadMocks.native`) и `@/hooks/useFileDownload`; 4 новых теста: в браузере клик не перехватывается и хук не зовётся; в нативе — `preventDefault` (возврат `false`) + вызов с точными аргументами; fallback-имя `document.pdf` при отсутствии `fileName`; ошибка хука → строка `download_error` + `console.error('[file-download]', …)`. Существующие 24 теста не менялись |
| `web/src/i18n/en.json`, `web/src/i18n/ru.json` | +1/+1 | `node.document_gen.download_error` (ru: «Не удалось скачать файл. Попробуйте ещё раз.»; en — аналог). Ключ `node.document_gen.download` уже существовал — второй раз не добавлялся |
| `web/package.json` | +3/−0 | `@capacitor/filesystem@^7.1.9`, `@capacitor-community/file-opener@^7.0.1` (и push — см. блок C) |
| `web/pnpm-lock.yaml` | +43/−0 | lock-файл web-пакета (RULES 6.11); `pnpm --dir web install --frozen-lockfile` — «Lockfile is up to date» |

### C. Frontend: push-уведомления

| Файл | +/− | Что именно |
|---|---:|---|
| `web/src/hooks/usePushNotifications.ts` | 108 (new) | `initPushNotificationsAsync()`: `isNative()` guard, `requestPermissions()` (`denied` → WARN и выход), **сначала** 4 `addListener` (`registration`, `registrationError`, `pushNotificationReceived`, `pushNotificationActionPerformed`), **потом** `register()`; на `registration` — `registerDeviceTokenAsync(token.value, currentPlatform())` с `catch` → `console.error`; `currentPlatform()` — через `isAndroid()`/`isIOS()` из `@/lib/platform`; модульный guard идемпотентности (`initialized`) |
| `web/src/hooks/usePushNotifications.spec.ts` | 208 (new) | моки плагина, `@/lib/api` и `@/lib/platform`; `vi.resetModules()` + динамический импорт (guard модуля); 7 тестов: web — ничего; native — 4 listeners, **порядок** (`listener:registration` до `register`), отправка токена с `android`; iOS → `ios`; отказ в разрешении → WARN и без `register`; идемпотентность (второй вызов — без дублей); ошибка отправки токена → `console.error`, не пробрасывается |
| `web/src/lib/api.ts` | +54/−0 | `DeviceTokenPlatformSchema` + тип `DeviceTokenPlatform`, `RegisterDeviceTokenSchema` (`token: z.string().min(1)`, `platform: z.enum([...])`), `registerDeviceTokenAsync(token, platform)` → `requestAsync('/notifications/register', { method: 'POST', body })` |
| `web/src/lib/api.spec.ts` | +32/−0 | 2 теста: правильный URL/метод/тело + `Content-Type: application/json`; клиентская Zod-валидация (пустой токен, `windows`) — `fetch` не вызывается |
| `web/src/App.tsx` | +13/−0 | `useEffect` по `authStatus` (`useAuthStore(state => state.status)`): `authStatus === 'authenticated'` → `void initPushNotificationsAsync()`; комментарий про 401 без сессии, native-only и StrictMode-идемпотентность |
| `web/package.json` | (в блоке B) | + `@capacitor/push-notifications@^7.0.7` |
| `web/android/app/capacitor.build.gradle` | +3/−0 | результат `cap sync`: три строки `implementation project(...)` — для `capacitor-community-file-opener`, `capacitor-filesystem`, `capacitor-push-notifications` |
| `web/android/capacitor.settings.gradle` | +9/−0 | результат `cap sync`: `include` + `projectDir` для трёх плагинов (пути в `node_modules/.pnpm/...`) |

### D. Docs cleanup (KI-652) + новые KI

| Файл | +/− | Что именно |
|---|---:|---|
| `docs/KNOWN_ISSUES.md` | +61/−74 | удалены 11 кратких дублей `### KI-635`..`### KI-645` (и вместе с ними повреждённое `как ## Сводка по статусам.0000` в дубле KI-638); KI-652 → статус `Fixed` + поле «Исправлено в: v1.5.0 (S3)» и новое «Решение»; KI-651 дополнен замером S3; заведены KI-653 (`Planned`, S4) и KI-654 (`Documented`); сводка пересчитана grep'ом |
| `docs/CHANGELOG.md` | +21/−2 | `### Added` — блок «Files & Push (v1.5.0 S3)» со ссылкой на отчёт; `### Changed` — префикс `notifications` в реестре (KI-472); `### Documented` — KI-652 → Fixed (S3), KI-653/KI-654, замер KI-651 |
| `docs/development/reports/README.md` | +1/−0 | строка `v1.5.0 · S3 · Files & Push … · 2026-11-09` со ссылкой `[S3-files-push.md](v1.5.0/S3-files-push.md)` (стиль таблицы сохранён) |
| `docs/development/v1.5/DESIGN_V150_CAPACITOR.md` | +2/−2 | срез S3 помечен «(сделано, v1.5.0)», в плане работ — «S3 … (сделано)» |
| `docs/development/reports/v1.5.0/S3-files-push.md` | (new) | этот отчёт |

### E. Не тронуто (проверено `git status`)

`web/android/app/src/main/AndroidManifest.xml`, `web/android/app/build.gradle`,
`web/android/build.gradle`, `web/android/variables.gradle` — без изменений;
`google-services.json` не создавался; `web/src/components/TopBar.tsx` — без
изменений; `RELEASE_NOTES.md` — предсуществующая модификация (untracked-артефакт
релиза S1/S2, +634/−8 ещё до сессии), не удалялась и не правилась.

## 2. Build / test

| Гейт | Команда | Результат |
|---|---|---|
| Backend build | `pnpm build` | exit 0 — **0 errors, 0 warnings** |
| Backend typecheck | `pnpm typecheck` | exit 0 — **0 ошибок** |
| Backend tests | `pnpm test` | **1958 passed**, 26 skipped, 126 файлов passed / 4 skipped (было 1948 → **+10**) |
| Schema parity | `pnpm test:parity` | **15/15 passed** (device_tokens подхвачен автоматически) |
| Миграции | `pnpm db:generate` | 1-й прогон → `0021_dizzy_reptil.sql`; повторный → «No schema changes, nothing to migrate 😴», exit 0 |
| Миграции | `pnpm db:migrate` | exit 0 — «✅ Миграции применены», применена `0021` (в `drizzle.__drizzle_migrations` 22 строки) |
| Web tests | `pnpm --dir web test` | **559 passed**, 62 файла (было 542 → **+17**) |
| Web build | `pnpm --dir web build` | exit 0 (`tsc -b` + vite; web `base: '/'`) |
| Web build (Capacitor) | `$env:CAPACITOR='1'; pnpm --dir web build` | exit 0, `base: './'` — условный base S1 цел |
| Android sync | `pnpm --dir web exec cap sync android` | exit 0 — «Found **5** Capacitor plugins» |
| Capacitor doctor | `pnpm --dir web exec cap doctor` | `[success] Android looking great! 👌` |
| Lint | `pnpm lint` (oxlint type-aware) | 0 errors, 2 предсуществующих warning'а в `src/media/providers/openai-images.provider.spec.ts` (не наши файлы) |
| Prettier | `pnpm exec prettier --check` | падает и на **нетронутых** файлах (`src/main.ts`, `src/runs/runs.service.ts`, `src/organizations/org-members.service.ts`) — предсуществующий дрейф; новые файлы выдержаны в стиле репозитория, автоформат не применялся, чтобы не смешать несвязанные правки |

Итого: **1958 + 559 = 2517 тестов**, все зелёные; build/typecheck — 0/0.

## 3. Диагностика

### 3.1. `@capacitor/filesystem@7.1.9`

- `Directory.Documents` на Android — это `getExternalFilesDir(DIRECTORY_DOCUMENTS)`
  **приватного** каталога приложения: запись не требует `WRITE_EXTERNAL_STORAGE`
  ни на одной поддерживаемой версии (scoped storage), поэтому манифест не
  трогали.
- `writeFile` принимает `data` как base64 **без** `data:`-префикса, поэтому
  `blobToBase64Async` срезает заголовок (`result.split(',')[1]`). В jsdom
  `FileReader.readAsDataURL` работает по-настоящему — мокать чтение не
  пришлось, тест проверяет реальный base64 (`hello` → `aGVsbG8=`).
- `recursive: true` создаёт промежуточные каталоги (`Documents/` может не
  существовать в свежей установке).
- v7 — последняя линейка для Capacitor 7; **не** ставили 8.1.x (latest):
  проект на Capacitor 7.6.10, апгрейд на 8 — известный KI-649, вне S3.

### 3.2. `@capacitor-community/file-opener@7.0.1`

- Плагин **сам** объявляет `FileProvider`
  (`${applicationId}.file.opener.provider`, `exported=false`,
  `grantUriPermissions=true`) в своей библиотечной `AndroidManifest.xml`;
  `<paths>` (`file_opener_paths.xml`) содержит `external-files-path path="."`,
  то есть наш файл в `getExternalFilesDir(DOCUMENTS)` покрыт — правки
  `app/src/main/AndroidManifest.xml` не нужны.
- README требует `READ_EXTERNAL_STORAGE` только для файлов **внешних**
  каталогов; у нас app-private → не нужно. Это важно: промпт запрещал трогать
  манифест, и проверка показала, что запрет безопасен.
- Требуется установленное приложение-просмотрщик (Word / Google Docs / любой
  DOCX-viewer). Если его нет, `FileOpener.open` отклоняется — ветка ошибки
  показывает `node.document_gen.download_error`, а не «тихо» ничего не делает.
- Версии линейки 7.x для Capacitor 7 (по таблице «Plugin versions» README).

### 3.3. `@capacitor/push-notifications@7.0.7`

- **Порядок listeners → `register()`** — принципиален: событие `registration`
  приходит сразу после `register()`, и слушатель, навешенный позже, может не
  успеть его поймать. В промпте-скетче порядок был обратный (`register()` и
  потом `addListener`), в реализации — как в официальном README плагина.
- Плагин объявляет в своём манифесте только `MessagingService`
  (`com.google.firebase.MESSAGING_EVENT`); `<uses-permission>` нет — README
  прямо говорит «no need to … edit your app manifest». `POST_NOTIFICATIONS`
  на Android 13+ запрашивается **в рантайме** (`requestPermissions()`, alias
  `@Permission(POST_NOTIFICATIONS)` в `PushNotificationsPlugin.java`), что мы и
  делаем.
- **Без `google-services.json` push не заработает**: `web/android/build.gradle`
  (строки 48–53) применяет `com.google.gms.google-services` только при наличии
  файла, иначе пишет `google-services.json not found, google-services plugin
  not applied. Push Notifications won't work`. FirebaseApp не
  инициализируется → `register()` отдаёт `registrationError`, токен не
  приходит. Файл в S3 намеренно не создавался → **KI-653** (S4).
- Иконка уведомления: README рекомендует
  `com.google.firebase.messaging.default_notification_icon`; без неё Android
  берёт иконку приложения (белый квадрат в статусбаре) → **KI-654** (S4).

### 3.4. `cap sync` и android-проект

- Плагинов стало **5** (было 2 + camera; сейчас: barcode-scanning, camera,
  filesystem, file-opener, push-notifications).
- `cap sync` изменил ровно **2 tracked-файла**: `web/android/app/capacitor.build.gradle`
  (+3 строки `implementation project`) и `web/android/capacitor.settings.gradle`
  (+9 строк `include`/`projectDir`). `android/app/src/main/assets/public`
  (копия `dist`) в git не входит — новых untracked-файлов нет.
- Порядок важен: `cap sync` копирует **текущий** `web/dist`, поэтому финальный
  прогон делался после сборки с `CAPACITOR=1` (иначе в assets попала бы
  web-сборка с абсолютными `/assets/...`, KI-647).
- `cap doctor` предупреждает, что latest — Capacitor 8.6.0, а стоят 7.6.10;
  это известный KI-649, статус `Documented` не менялся.

### 3.5. Имя миграции

`pnpm db:generate` даёт случайное имя (`0021_dizzy_reptil.sql`), а не
`0021_device_tokens.sql` из ТЗ. Переименовывать файл руками нельзя
(`drizzle/meta/_journal.json` и snapshot хранят `tag`) — поэтому оставлено
сгенерированное имя. Семантика SQL сверена с ТЗ построчно (см. § 4.2).

### 3.6. Тесты, которым потребовались моки

- `useFileDownload.spec.ts`: `@/lib/platform` (`native`), `@capacitor/filesystem`
  (`Filesystem.writeFile`, `Directory.Documents`), `@capacitor-community/file-opener`
  (`FileOpener.open`), глобальный `fetch` (`vi.stubGlobal`). Веб-ветка потребовала
  подменить `document.createElement` **и** `appendChild`/`removeChild`:
  заглушка-«якорь» — не `Node`, реальный `appendChild` бросил бы TypeError.
  `FileReader`/`Blob` — настоящие (jsdom).
- `usePushNotifications.spec.ts`: плагин целиком, `@/lib/api`
  (`registerDeviceTokenAsync`), `@/lib/platform`; из-за модульного guard'а
  идемпотентности — `vi.resetModules()` + динамический `import()` в каждом
  тесте; порядок «listeners до register» проверяется массивом `order`.
- `DocumentGenNode.spec.tsx`: уже существовал частичный мок `@/lib/api`
  (`importOriginal`), добавлены моки `@/lib/platform` и
  `@/hooks/useFileDownload` (включая `MIME_DOCX`/`MIME_PDF`).
- `api.spec.ts`: использованы готовые хелперы `stubFetch`/`jsonResponse`/`headersOf`.

### 3.7. Сборка: размеры чанков

| Чанк | S1/S2 | S3 | Δ |
|---|---:|---:|---:|
| `vendor` | 144.94 kB (gzip 44.56) | 154.46 kB (gzip 47.34) | +9.52 (+2.78 gzip) |
| `index` | 198.24 kB | 213.13 kB (gzip 52.61) | +14.89 |
| `i18n` | ~46.9 kB | 46.94 kB (gzip 15.20) | ≈0 |
| `DocumentGenNode` | (не замерялся отдельно, lazy) | 10.95 kB (gzip 3.22) | — |

Рост — статические импорты плагинов (`filesystem`+`file-opener` в
`DocumentGenNode`-чанке, `push-notifications` в графе `App`). Включён в **KI-651**
(ленивая загрузка плагинов перенесена в S4). Предупреждений о чанках >500 kB
нет.

## 4. Smoke (детально)

### 4.1. `cap sync android` (финальный прогон)

```
√ Copying web assets from dist to android\app\src\main\assets\public in 21.58ms
√ Creating capacitor.config.json in android\app\src\main\assets in 1.02ms
√ copy android in 43.65ms
√ Updating Android plugins in 3.68ms
[info] Found 5 Capacitor plugins for android:
       @capacitor-community/file-opener@7.0.1
       @capacitor-mlkit/barcode-scanning@7.5.0
       @capacitor/camera@7.0.5
       @capacitor/filesystem@7.1.9
       @capacitor/push-notifications@7.0.7
√ update android in 65.42ms
[info] Sync finished in 0.144s
```

### 4.2. `pnpm db:migrate` + проверка по `pg_catalog`

```
$ tsx migrate.ts
База: 127.0.0.1:5433/workflow_builder
Применяем миграции...
✅ Миграции применены
✅ Организации: backfill выполнен, organization_id заполнен, NOT NULL включён
```

Фактическое состояние таблицы (временный скрипт, удалён после прогона):

```json
[{"column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},
 {"column_name":"user_id","data_type":"uuid","is_nullable":"NO","column_default":null},
 {"column_name":"organization_id","data_type":"uuid","is_nullable":"NO","column_default":null},
 {"column_name":"token","data_type":"text","is_nullable":"NO","column_default":null},
 {"column_name":"platform","data_type":"text","is_nullable":"NO","column_default":null},
 {"column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"}]
constraints: device_tokens_organization_id_organizations_id_fk,
  device_tokens_pkey, device_tokens_platform_check,
  device_tokens_token_unique, device_tokens_user_id_users_id_fk
indexes: device_tokens_pkey, device_tokens_token_unique, device_tokens_user_id_idx
applied migrations: 22
```

### 4.3. `cap doctor`

```
Latest Dependencies:    @capacitor/cli 8.6.0, core 8.6.0, android 8.6.0, ios 8.6.0
Installed Dependencies: @capacitor/cli 7.6.10, core 7.6.10, android 7.6.10,
                        @capacitor/ios not installed
[success] Android looking great! 👌
```

### 4.4. `dist/index.html` — обе сборки

Web (`pnpm --dir web build`):
```html
<script type="module" crossorigin src="/assets/index-BEDYMqLZ.js"></script>
```

Capacitor (`$env:CAPACITOR='1'; pnpm --dir web build`):
```html
<script type="module" crossorigin src="./assets/index-ujqCYIJE.js"></script>
```

Относительный `base` из S1 не сломан; `cap sync` выполнен после
Capacitor-сборки — в `android/app/src/main/assets/public` лежит именно она.

### 4.5. `git status --short` (финал, коммитов нет, индекс пуст)

```
 M RELEASE_NOTES.md                          ← предсуществующая модификация S1/S2, не наша
 M api-prefixes.json
 M docs/CHANGELOG.md
 M docs/KNOWN_ISSUES.md
 M docs/development/reports/README.md
 M docs/development/v1.5/DESIGN_V150_CAPACITOR.md
 M drizzle/meta/_journal.json
 M src/app.module.ts
 M src/common/api-prefixes.spec.ts
 M src/db/schema.ts
 M web/android/app/capacitor.build.gradle
 M web/android/capacitor.settings.gradle
 M web/package.json
 M web/pnpm-lock.yaml
 M web/src/App.tsx
 M web/src/components/nodes/DocumentGenNode.spec.tsx
 M web/src/components/nodes/DocumentGenNode.tsx
 M web/src/i18n/en.json
 M web/src/i18n/ru.json
 M web/src/lib/api.spec.ts
 M web/src/lib/api.ts
?? docs/development/reports/v1.5.0/S3-files-push.md
?? drizzle/0021_dizzy_reptil.sql
?? drizzle/meta/0021_snapshot.json
?? src/notifications/
?? web/src/hooks/useFileDownload.spec.ts
?? web/src/hooks/useFileDownload.ts
?? web/src/hooks/usePushNotifications.spec.ts
?? web/src/hooks/usePushNotifications.ts
```

`git rev-parse --short HEAD` → `0225430`; `git diff --cached --name-only` → пусто.

**Что модифицировано в `web/android/`:** только два автогенерируемых Gradle-файла
(`app/capacitor.build.gradle` +3, `capacitor.settings.gradle` +9) — это
штатный результат `cap sync` при добавлении трёх плагинов; `AndroidManifest.xml`
и `app/build.gradle` не менялись.

### 4.6. Прочие проверки

- `Test-Path web/android/app/google-services.json` → `False` (KI-653).
- `git status --short -- web/android/app/src/main/AndroidManifest.xml` → пусто.
- `git status --short -- web/src/components/TopBar.tsx` → пусто.
- `pnpm --dir web install --frozen-lockfile` → «Lockfile is up to date» (web-lock
  синхронен, CI не упадёт на RULES 6.11).
- Временные файлы (`s3-*.mjs`, `device-tokens-check.mjs`) удалены (RULES 3.13).

### 4.7. Реестр KI — контрольный пересчёт (RULES 3.20)

```
^### KI-                       = 641
строк "**Статус:**"            = 641
уникальных номеров             = 641
разбивка: Open 281, Fixed 279, Documented 57, Fixed (частично) 12,
          Planned 4, Won't Fix 4, Deferred 3, Documented (не воспроизводится) 1
сумма                          = 641  (= 291/281/58/4/3/4/0 по базовым статусам)
"Сводка по статусам.0000"      = 0 вхождений
KI-635..645                    — ровно по одному заголовку
```

Было до S3: 650 заголовков / 650 строк статуса / 639 уникальных чисел.

## 5. Что не так (все факты и расхождения)

1. **Имя миграции** — `0021_dizzy_reptil.sql`, а не `0021_device_tokens.sql`:
   имя задаёт drizzle-kit. Переименование сломало бы `_journal.json`/snapshot.
2. **DTO использует `z.enum(DEVICE_TOKEN_PLATFORMS)`**, а не литерал
   `['android','ios','web']`: константа из `schema.ts` — единый источник с
   CHECK-ограничением БД и типом `DeviceTokenPlatform` (так же в репозитории
   сделано для `USER_ROLES`).
3. **`POST /notifications/register` отвечает 201** (NestJS-дефолт для POST), в
   ТЗ статус не задан; `@HttpCode(200)` не добавляли. Фронтенд тело не
   разбирает — важен только 2xx.
4. **Кнопка «Скачать DOCX» осталась `<a>`**, а не стала `<button>`, как в
   скетче промпта. Причина: в компоненте уже 5 тестов проверяют
   `role="link"`, `href`, `download`, `target="_blank"`; замена на `<button>`
   убрала бы «Сохранить ссылку как», middle-click и сломала бы эти тесты.
   Нативную задачу («документ открывается системным просмотрщиком») решает
   `onClick`-перехват: в браузере поведение ровно прежнее, в нативе —
   `preventDefault()` + `downloadAndOpenFileAsync`. **Функциональное
   требование выполнено, форма элемента отличается от скетча.**
5. **`showNotice` в `DocumentGenNode` нет** — в компоненте ошибки рисуются
   локальным state'ом (`uploadError`, `deleteError`, …). Сделано так же:
   `downloadError` + строка под ссылкой + `data-document-gen-download-error`.
6. **`node.document_gen.download` уже существовал** (ru/en) — добавлен только
   `node.document_gen.download_error`. Скетч предполагал два новых ключа.
7. **`outputs.mimeType` может отсутствовать** (старые запуски): MIME
   выводится из `outputs.format` (`pdf` → `MIME_PDF`, иначе `MIME_DOCX`),
   явное поле имеет приоритет.
8. **Порядок в push-хуке изменён относительно скетча**: listeners навешиваются
   до `register()`, иначе событие `registration` может быть потеряно.
9. **Добавлен модульный guard идемпотентности** (`initialized`): `App`
   рендерится в `StrictMode`, эффект в dev вызывается дважды, плюс возможен
   logout→login — без guard'а listeners и `register()` дублировались бы.
   Цена: после смены пользователя без перезапуска WebView повторной
   регистрации не будет (в S3 не критично, токен уже привязан к организации;
   при необходимости сброс — в S4).
10. **Контроллер делает два обращения к БД** (SELECT организации + INSERT …
    ON CONFLICT). Альтернатива — брать `orgId` из токена — нарушила бы KI-554
    (устаревший `orgId` привязал бы устройство к чужому арендатору).
11. **`platform` и `created_at` не обновляются при конфликте** — буквально по
    ТЗ (`DO UPDATE SET user_id, organization_id`). Если когда-нибудь токен
    «переедет» между платформами (на практике невозможно: токен принадлежит
    устройству), в БД останется прежняя платформа — ограничение, а не баг.
12. **Число тестов больше ожидаемого в промпте**: бэкенд 1958 вместо ~1953
    (+10 новых тестов вместо ~5), web 559 вместо ~548 (+17 вместо ~6). Все
    зелёные; расхождение — в сторону большего покрытия.
13. **Push не проверен на устройстве** (нет `google-services.json`, нет
    эмулятора с Google Play Services) — **KI-653**. Код клиента, ручка и
    таблица готовы; проверка — S4.
14. **File opener не проверен на устройстве** (нужен реальный Android с
    DOCX-viewer). Юнит-тесты покрывают ветки через моки, но `FileOpener.open`
    на железе не вызывался.
15. **Иконка уведомления не задана** — по условию задачи манифест не трогали;
    на реальном устройстве уведомление будет с белым квадратом — **KI-654**.
16. **KI-651 не закрыт и подрос**: статические импорты плагинов S3 добавили
    vendor +9.52 kB (gzip +2.78) и index +14.89 kB; ленивая загрузка плагинов
    перенесена в S4 (запись KI-651 обновлена фактами).
17. **`cap doctor` предупреждает про Capacitor 8** (latest 8.6.0 при
    установленных 7.6.10) — известный KI-649, апгрейд вне S3. Плагины
    сознательно ставились версий `^7.x`, а не latest-8.
18. **`prettier --check` падает и на нетронутых файлах** (`src/main.ts`,
    `src/runs/runs.service.ts`, `src/organizations/org-members.service.ts`) —
    предсуществующий дрейф конфигурации/стиля. Наши файлы выдержаны в стиле
    репозитория (многострочные импорты и т.п.), автоформат по всему проекту не
    запускался, чтобы не смешать несвязанные правки.
19. **`web/android` в git**: `cap sync` меняет два tracked Gradle-файла. Без
    `cap sync` в CI Android-сборка не увидит плагины (S4 — AAB-пайплайн).
20. **`RELEASE_NOTES.md` ([отчёт S1/S2])** остался untracked-модификацией
    (+634/−8 ещё до S3) — по заданию не удалялся и не правился.
21. **Роль `notifications` в живом приложении**: эндпоинт добавлен в общий
    `ThrottlerGuard` (лимит по умолчанию), отдельный `@Throttle` не ставился —
    регистрация вызывается один раз на устройство, ужесточение не требуется.
22. **Удаление токена (`removeAsync`) не реализовано** — в промпте помечено
    «на future (logout)». Мёртвый код не заводили; токен живёт до
    `ON DELETE CASCADE` пользователя/организации.

## 6. Новые KI

### KI-653 — Push на Android не зарегистрируется без `google-services.json`

- **Приоритет:** 🟠 High | **Статус:** Planned (S4) | **Обнаружено:** 2026-11-09
- **Суть:** `web/android/build.gradle:48-53` применяет Gradle-плагин
  `com.google.gms.google-services` только при наличии
  `web/android/app/google-services.json`. Без файла FirebaseApp не
  инициализируется, `PushNotifications.register()` уходит в
  `registrationError`, событие `registration` не наступает, и
  `POST /notifications/register` с устройства не вызывается — вся цепочка
  «хук → API → `device_tokens`» на железе не проверена.
- **Почему не в S3:** `google-services.json` — артефакт Firebase-проекта
  (идентификаторы проекта, не код), его подготовка — шаг S4; промпт прямо
  запрещал его создавать.
- **Решение:** в S4 создать Firebase-проект, положить файл в
  `web/android/app/`, проверить применение плагина при сборке, снять реальный
  FCM-токен (контроль: строка в `device_tokens` + `adb logcat` без
  `registrationError`).

### KI-654 — Push-уведомление на Android рисуется без иконки (белый квадрат)

- **Приоритет:** 🟢 Low | **Статус:** Documented | **Обнаружено:** 2026-11-09
- **Суть:** README `@capacitor/push-notifications` требует meta-data
  `com.google.firebase.messaging.default_notification_icon` (белая монохромная
  иконка). Без неё Android берёт иконку приложения → белое пятно/квадрат в
  статусбаре. Функционально push работает, страдает вид.
- **Решение:** в S4 добавить `@mipmap/ic_push` и meta-data в `<application>`.

### Обновлённая запись

**KI-651** (Documented) — дополнен замером S3: плагины filesystem/file-opener/
push дали vendor 144.94 → 154.46 kB (gzip +2.78) и index 198.24 → 213.13 kB;
ленивая загрузка плагинов (`await import()` внутри ветки `isNative()`)
перенесена в S4.

Сводка KI пересчитана после добавления: **641** заголовок = 641 строка статуса
= 641 уникальный номер (было 639; +KI-653, +KI-654).

## 7. Обоснование решений

1. **`ON CONFLICT (token) DO UPDATE SET user_id, organization_id`.** Токен
   FCM/APNs уникален **глобально** и принадлежит устройству, а не аккаунту:
   одно и то же устройство может выйти из одного аккаунта и войти другим.
   `UNIQUE (token)` + upsert — единственный вариант, при котором строка
   «переезжает» к новому владельцу, а не задваивается (иначе на устройство
   шли бы push двух пользователей, в том числе бывшего). `platform`/
   `created_at` не обновляются: платформа устройства не меняется, а
   `created_at` — история первой регистрации. Индекс `user_id` нужен будущей
   выборке «все токены пользователя» (отзыв при выходе).
2. **Организация — из БД (KI-554), а не из access-токена.** `orgId` в JWT
   живёт до 24 часов; после переезда пользователя в другую организацию он
   устарел бы, и токен устройства привязался бы к чужому арендатору — ошибка
   безопасности (push ушёл бы не туда). Один лишний `SELECT` дешевле.
3. **Push-инициализация в `App.tsx` по `authStatus`, а не в `main.tsx` или
   `AuthProvider`.** Регистрация токена — авторизованная операция
   (`POST /notifications/register` требует JWT), поэтому её нельзя запускать
   до появления сессии: `AuthProvider` управляет статусом, а `App` — уже
   потребитель этого статуса (`KI-228` — та же логика загрузки графа).
   `main.tsx` не годится: инициализация i18n/роутера не должна зависеть от
   сети. Плюс `App` — единственное место, где эффект перезапускается при
   logout→login.
4. **Guard идемпотентности в хуке (`initialized`).** `StrictMode` в dev
   вызывает эффекты дважды → без guard'а дважды навесились бы listeners и
   дважды ушёл бы `register()` (дубли `POST` при каждом событии). Guard —
   в модуле, а не в компоненте: переживает ре-рендеры и ремаунты, но
   сбрасывается перезапуском WebView, что соответствует «один процесс — одна
   регистрация».
5. **Listeners до `register()`.** Официальный пример плагина и физика события:
   `registration` эмитится как следствие `register()`. Скетч промпта делал
   наоборот — в реализации порядок исправлен, тест это фиксирует
   (`listener:registration` раньше `register` в `order`).
6. **`downloadAndOpenFileAsync` с веб-fallback.** Требование «нативное
   скачивание» не должно ломать веб-версию: в браузере атрибут `download`
   работает, а в WebView — нет (Android игнорирует `download` для `http`/
   `blob`). Один хелпер с двумя ветками даёт: (а) одинаковый API для
   вызывающих, (б) явную нативную цепочку «fetch → base64 → `Documents` →
   `FileOpener`», (в) рабочий браузерный путь без Capacitor-плагинов.
   `FileReader` (а не `blob.arrayBuffer()` + ручной base64) выбран потому, что
   доступен и в WebView, и в jsdom — ветка покрыта настоящим тестом, а не
   моком кодирования.
7. **`<a>` + `onClick`-перехват вместо `<button>`.** Сохраняет семантику
   ссылки (доступность, «Сохранить ссылку как», `target="_blank"` для
   cross-origin URL — иначе `preventDefault` + программный `<a>` без `target`
   увёл бы вкладку с редактора), не ломает 5 существующих тестов и при этом
   в нативе отдаёт файл системе. На веб-платформе `preventDefault` не
   вызывается вовсе — поведение байт-в-байт прежнее.
8. **Локальная строка ошибки вместо тоста.** Ошибка скачивания относится к
   конкретному узлу и его файлу; в компоненте уже есть паттерн строк ошибок
   (`uploadError`/`deleteError`), тост был бы глобальным и дублирующим.
9. **`z.enum(DEVICE_TOKEN_PLATFORMS)` из `schema.ts`.** Один источник домена
   для Zod, CHECK-ограничения БД и TS-типа: разойтись они не могут (RULES
   1.17), а литералы в трёх местах — классический источник рассинхрона.
10. **Запись `notifications` в `api-prefixes.json`.** Реестр — единый источник
    для SPA-fallback backend'а и Vite-proxy (KI-472); без записи Vite отдал бы
    на `/notifications/register` `index.html` (200 text/html), и ошибка
    всплыла бы только на устройстве. Паритет-спека ловит это на `pnpm test`.
11. **201 вместо 200.** Ответ — «токен зарегистрирован», тело ресурса не
    нужно; NestJS-дефолт для POST (201) не противоречит контракту, а
    `@HttpCode(200)` потребовал бы объяснения, почему POST идемпотентен
    (upsert) — но статус-код этого не выражает в любом случае.
12. **`Directory.Documents`, а не `ExternalStorage`/`Cache`.** `Documents` —
    приватный каталог приложения (никаких runtime-permission и запросов
    storage), файл переживает очистку кэша и доступен через FileProvider
    плагина. `Cache` был бы удалён системой, `ExternalStorage` потребовал бы
    разрешений на Android ≤ 12 и `MANAGE_EXTERNAL_STORAGE` для внешних путей.
13. **Отказ от `removeAsync` и от `google-services.json`.** Первое — мёртвый
    код (logout-сценарий не в S3); второе — артефакт Firebase-проекта,
    который по условию задачи создаётся в S4 (KI-653), а не подкладывается
    фиктивным файлом (с фейковым `google-services.json` push «собирался» бы,
    но не работал — хуже, чем честный `registrationError`).
14. **`cap sync` выполняется после `CAPACITOR=1`-сборки.** Android-проект
    должен получить сборку с относительным `base`, иначе WebView не найдёт
    ассеты (KI-647). Финальный порядок прогона: `CAPACITOR=1` build →
    `cap sync` → обычный `pnpm --dir web build` (последний гейт). Поэтому в
    конце сессии `web/dist` — web-сборка (`base: '/'`), а в
    `android/app/src/main/assets/public` — Capacitor-сборка (`base: './'`):
    именно её возьмёт AAB-пайплайн S4. Перед сборкой AAB (и при любом
    изменении `web/src`) `cap sync` нужно повторить после `CAPACITOR=1`-сборки.
