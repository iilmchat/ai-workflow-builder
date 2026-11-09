---
title: "S4-B: миграция FCM → RuStore Push (backend, нативный Capacitor-плагин, CI, docs)"
date: 2026-11-09
version: v1.5.0
steps: [S4-B]
status: accepted
related_ki: [KI-653, KI-654, KI-655, KI-656, KI-657]
related_adr: []
---

# Отчёт S4-B: миграция FCM → RuStore Push (v1.5.0)

**Ветка:** `main`, HEAD `b5ee56d` (`chore(release): S4-A — CI/CD (AAB),
Firebase/Keystore docs, release prep v1.5.0`). Сессия — **без коммитов**:
`git add`/`git commit` не выполнялись, индекс пуст, HEAD не менялся. Все
изменения — в рабочем дереве (33 изменённых + 1 удалённый + 11 новых файлов).

**Задача (промпт S4-B):** полная замена Firebase Cloud Messaging (FCM) на
RuStore Push SDK:
1. **Бэкенд:** env `RUSTORE_*`, сервис отправки через RuStore API, тесты.
2. **Фронтенд:** удаление `@capacitor/push-notifications`, нативный
   Capacitor-плагин для RuStore Push, TS-обёртка, хук.
3. **Конфигурация:** Gradle/AndroidManifest/CI — без Google/Firebase.
4. **Документация:** `RUSTORE_SETUP.md` вместо `FIREBASE_SETUP.md`,
   рецепт, KI-реестр, CHANGELOG, DESIGN, гайды.

**Правила:** `docs/development/RULES.md` v1.10.0 — в первую очередь 1.4, 1.13,
1.16, 1.17, 2.1, 2.2, 2.4, 2.12, 2.15, 2.18, 3.2 (не коммитить смешанное),
3.20, 3.21, 4.13–4.19, 4.35, 5.1–5.9, 6.11.

**Схема работы (Agent Teams, 3 субагента + Lead).** Write-scopes не
пересекались:
- `backend-dev` — часть A: `src/notifications/**`, `src/config/env.schema.*`,
  `.env.example`;
- `web-native-dev` — части B и C1: `web/**`,
  `.github/workflows/release-mobile.yml`;
- `docs-writer` — часть C: `docs/**` (кроме `docs/development/reports/**` и
  `PROMPT_CURRENT.md`), `docs/README.md`;
- Lead — интеграция, README, `PROMPT_CURRENT.md`, KI-655/656/657, Maven-раздел
  в `RUSTORE_SETUP.md`, финальные гейты, этот отчёт, `reports/README.md`.

**Ключевое уточнение по факту HEAD.** В S3 отправки push на бэкенде **не было**:
существовала только регистрация токенов (`POST /notifications/register`,
`device_tokens`) и клиентская инициализация на `@capacitor/push-notifications`.
Поэтому «заменить вызов FCM» (A3) означало **добавить путь отправки**:
`RuStorePushService.sendAsync` + `DeviceTokensService.sendToUserAsync`. Логика
UPSERT токенов не изменилась.

---

## 1. Файлы (+/−)

**Итого:** 45 файлов = 33 изменённых + 1 удалённый + 11 новых;
**+3505/−614** строк, из них архивная копия промпта — +406 (механическая) и
сам этот отчёт — +483; содержательные изменения — **+2616/−614**.

### A. Бэкенд (часть A)

| Файл | +/− | Что именно |
|---|---:|---|
| `src/notifications/rustore-push.service.ts` | **+365** (new) | `RuStorePushException` + `@Injectable RuStorePushService`: `isConfigured()`, `sendAsync(token, title, body, data?)`; `POST https://vkpns.rustore.ru/v1/projects/{projectId}/messages:send`, `Authorization: Bearer <serviceToken>`, `Content-Type: application/json`, тело `{ message: { token, notification: { title, body }, data? } }`; `data` только при непустых ключах; `fetch` (+`AbortSignal.timeout(10_000)`), разбор ошибки `{ error: { code, message, status } }` как `unknown` без `any`; сетевой сбой и не-2xx → `RuStorePushException`; секреты/токены в сообщения не попадают |
| `src/notifications/rustore-push.service.spec.ts` | **+380** (new) | 11 тестов: URL/метод/заголовки/тело; `data` (передача, отбрасывание пустых ключей, отсутствие пустого объекта); `signal instanceof AbortSignal`; non-2xx JSON (401/UNAUTHENTICATED) и non-JSON (502); сетевой reject с `cause`; «не настроено» и «настроено частично»; отсутствие секретов в текстах ошибок; `isConfigured` для 3 комбинаций env |
| `src/notifications/device-tokens.service.ts` | +108/−7 | DI `RuStorePushService` вторым параметром; `Logger`; новый `sendToUserAsync(userId, title, body, data?)` — SELECT android-токенов пользователя (`and(eq(userId), eq(platform,'android'))`), `isConfigured()` до SELECT (WARN + 0), `Promise.allSettled` (RULES 4.16), возврат числа доставленных, WARN без токенов в логе; UPSERT/`resolveOrganizationIdAsync` не изменены; JSDoc про RuStore |
| `src/notifications/device-tokens.service.spec.ts` | +116/−2 | Провайдер-заглушка `RuStorePushService` в `Test.createTestingModule`; 4 старых теста не менялись; +4 теста `sendToUserAsync` (fan-out по токенам, 0 токенов, не настроено → WARN/0 без SELECT, `allSettled` при одном отказе, отсутствие токенов в логе) |
| `src/notifications/notifications.module.ts` | +10/−5 | `RuStorePushService` в `providers` и `exports`; JSDoc обновлён |
| `src/notifications/notifications.controller.ts` | +3/−3 | Только JSDoc: FCM/APNs → RuStore Push (S4-B) |
| `src/notifications/dto/register-device-token.dto.ts` | +3/−3 | Только JSDoc: источник токена Android — RuStore Push SDK |
| `src/config/env.schema.ts` | **+39** | `RuStorePushEnvSchema` (`RUSTORE_PROJECT_ID`, `RUSTORE_SERVICE_TOKEN`; обе `z.preprocess(emptyToUndefined, z.string().trim().min(1).optional())`), `type RuStorePushEnv`, `...RuStorePushEnvSchema.shape` в `EnvSchema`; русский JSDoc про «опционально = отправка выключена» |
| `src/config/env.schema.spec.ts` | +43 | +3 теста: опциональность и `undefined` по умолчанию; пустые строки → `undefined`, trim; значения попадают в общий `EnvSchema.parse` |
| `src/db/schema.ts` | +3/−3 | Только комментарии `device_tokens`: FCM → провайдер/RuStore Push |
| `.env.example` | **+13** | Блок `=== RuStore Push (S4-B) ===`: `RUSTORE_PROJECT_ID=` (не секрет), `RUSTORE_SERVICE_TOKEN=` (секрет; не логируется), «пусто = push не отправляется» |

### B. Web / Android / CI (части B, C1)

| Файл | +/− | Что именно |
|---|---:|---|
| `.github/workflows/release-mobile.yml` | +19/−19 | Удалён шаг `Restore google-services.json`; `Cleanup secrets` удаляет только keystore; шапка — 4 секрета keystore + repository variable `RUSTORE_PROJECT_ID`; в `Build web (Capacitor mode)` — `VITE_RUSTORE_PROJECT_ID: ${{ vars.RUSTORE_PROJECT_ID }}`; в verify-loop merged-манифеста добавлен `POST_NOTIFICATIONS`; заголовок workflow — «для публикации (RuStore / Google Play)» |
| `web/package.json` | 0/−1 | Удалён `@capacitor/push-notifications` |
| `web/pnpm-lock.yaml` | 0/−12 | `pnpm --dir web remove @capacitor/push-notifications`; `install --frozen-lockfile` проходит |
| `web/android/build.gradle` | +28/−1 | Удалён classpath `com.google.gms:google-services`; добавлены Maven-репозитории RuStore (`maven-rustore-exposed`), Tracer (`maven-tracer-public-exposed`) и URL из ТЗ (`artifactory-external.vkpartner.ru/artifactory/maven`, 404 — оставлен для совместимости) |
| `web/android/app/build.gradle` | +6/−9 | Удалён `try { google-services.json … } catch`; добавлена `implementation("ru.rustore.sdk:pushclient:6.4.0")` |
| `web/android/app/src/main/AndroidManifest.xml` | +19/−1 | `xmlns:tools`; `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`; сервис `.RuStorePushMessagingService` (`exported=true`, `tools:ignore="ExportedService"`, action `ru.rustore.sdk.pushclient.MESSAGING_EVENT`) |
| `web/android/app/src/main/java/…/MainActivity.java` | +25/−1 | `registerPlugin(RuStorePushPlugin.class)` в `onCreate` **до** `super.onCreate()`; JSDoc |
| `web/android/app/src/main/java/…/RuStorePushPlugin.java` | **+179** (new) | `@CapacitorPlugin(name = "RuStorePush")`: `init({ projectId })` (guard пустого id, `RuStorePushClient.INSTANCE.init(application, projectId, new DefaultLogger("RuStorePush"))`, runtime-запрос `POST_NOTIFICATIONS` на API 33+), `getToken()` (`Task<String>` → `addOnSuccessListener`/`addOnFailureListener`, `{ token }`/`JSONObject.NULL`, reject с текстом SDK); `safeMessage()` |
| `web/android/app/src/main/java/…/RuStorePushMessagingService.java` | **+78** (new) | `extends ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService`; override `onNewToken`/`onMessageReceived`/`onError`/`onDeletedMessages` — только `Log` (без падений) |
| `web/android/app/capacitor.build.gradle` | 0/−1 | generated `cap sync`: убрана `implementation project(':capacitor-push-notifications')` |
| `web/android/capacitor.settings.gradle` | 0/−3 | generated `cap sync`: убраны include/projectDir push-notifications |
| `web/android/.gitignore` | 0/−6 | Удалён блок Google Services (`google-services.json`, ссылка на FIREBASE_SETUP) |
| `web/src/lib/rustore-push.ts` | **+108** (new) | интерфейс `RuStorePushPlugin` (`init({projectId})`, `getToken(): {token: string|null}`), `registerPlugin<RuStorePushPlugin>('RuStorePush')`, `RUSTORE_PROJECT_ID` из `import.meta.env.VITE_RUSTORE_PROJECT_ID` (trim), `initRuStorePushAsync(projectId)`, `getRuStoreTokenAsync()` (нормализация пустого → `null`) |
| `web/src/lib/rustore-push.spec.ts` | **+111** (new) | 8 тестов моста: чтение/trim env, пустая env, init с trim, пустой projectId → ошибка без вызова плагина, ошибка init пробрасывается, getToken, normalизация null/пробелов, ошибка getToken |
| `web/src/hooks/usePushNotifications.ts` | +55/−74 | Убран `@capacitor/push-notifications`; `isNative()` → пустой `RUSTORE_PROJECT_ID` → WARN; `initRuStorePushAsync` → `getRuStoreTokenAsync` → `registerDeviceTokenAsync(token, 'android')`; guard идемпотентности; пустой токен → WARN; ошибки не пробрасываются (RULES 4.18) |
| `web/src/hooks/usePushNotifications.spec.ts` | +111/−105 | Мок `@/lib/rustore-push`: browser no-op; native init→getToken→register; пустой токен; пустой projectId; ошибка init/getToken не ломает; идемпотентность |
| `web/src/vite-env.d.ts` | **+20** (new) | `/// <reference types="vite/client" />` + `ImportMetaEnv.VITE_RUSTORE_PROJECT_ID?: string` (без `any`, RULES 1.16) |
| `web/.env.example` | **+13** (new) | `VITE_RUSTORE_PROJECT_ID=` с комментарием: Project ID не секрет, попадает в бандл, пусто = push выключены |
| `web/src/lib/api.ts` | +9/−7 | Только JSDoc: FCM/APNs → RuStore Push/APNs |

### C. Документация (часть C + Lead)

| Файл | +/− | Что именно |
|---|---:|---|
| `docs/development/v1.5/RUSTORE_SETUP.md` | **+212** (new) | зачем миграция и таблица «было → стало»; Project ID/Service Token (консоль, SHA-256, debug/release-проекты); backend `.env` и схема отправки; GitHub variable → `VITE_RUSTORE_PROJECT_ID`; **Maven-репозитории Android-сборки** (rustore-exposed, tracer-public-exposed, artifactory-404); проверка токена (`adb logcat`, `device_tokens`, тестовый push); troubleshooting (10 строк: нет RuStore, подпись/appId, `INVALID_ARGUMENT`/`NOT_FOUND`/`PERMISSION_DENIED`/401/429, `POST_NOTIFICATIONS`, фон, WARN); ссылки на официальные доки |
| `docs/development/v1.5/FIREBASE_SETUP.md` | **−101** (deleted) | Удалён как артефакт FCM |
| `docs/KNOWN_ISSUES.md` | +95/−31 | KI-653: Planned→**Fixed**, KI-654: Documented→**Fixed** (неактуальны после S4-B); **KI-656** (Medium/Planned, device-smoke) и **KI-657** (Medium/Documented, Maven-репозитории SDK); KI-655 актуализирован (исправлено устаревшее «в сессии нет JDK/Android SDK» — локально компиляция выполнена); новый раздел «v1.5.0 — RuStore Push вместо FCM (S4-B)»; сводка пересчитана grep'ом: **644** записи |
| `docs/CHANGELOG.md` | +76 | Только `[Unreleased]`: Added (backend-сервис/env, SDK 6.4.0 + нативный плагин, Maven-репозитории, Gradle-компиляция, `VITE_RUSTORE_PROJECT_ID`, ссылки на отчёт/RUSTORE_SETUP), Changed (регистрация токена, CI, docs), Removed (`@capacitor/push-notifications`, `google-services.json`, `GOOGLE_SERVICES_JSON`, `FIREBASE_SETUP.md`), Fixed (KI-653/654), Documented (KI-656/657 + ограничения RuStore). Секция `[1.5.0]` не тронута |
| `docs/development/v1.5/DESIGN_V150_CAPACITOR.md` | +20/−13 | Версия 1.2; S4-B «сделано»: причина (RuStore — российский магазин, FCM требует Google Play Services), Android/backend/CI/доки/риски; S4-A помечен «заменено в S4-B»; план/риски обновлены |
| `docs/development/v1.5/KEYSTORE_SETUP.md` | +27/−5 | Таблица секретов: 4 keystore-секрета, `GOOGLE_SERVICES_JSON` удалён; `RUSTORE_PROJECT_ID` как repository variable; врезка про совпадение подписи для push; troubleshooting |
| `docs/development/MOBILE_CAPACITOR_NESTJS.md` | +125/−59 | Версия 1.1; § 11 push полностью переписан (RuStore SDK 6.4.0, Maven, `RuStorePushMessagingService`, плагин `RuStorePush`, backend `RuStorePushService`/env/`device_tokens`); § 12 (env-переменная, 4 секрета), § 13, § 15 troubleshooting, § 16 чек-лист, § 18 CI/CD переписан |
| `docs/qa/MANUAL_TESTING_GUIDE.md` | +72/−44 | Версия 1.7; block V1.4–V1.5: сборка/распространение RuStore, `MOBILE-09` (release с отпечатком в проекте push, RuStore-токен, тестовый push, `POST_NOTIFICATIONS`), `MOBILE-10` (`vars.RUSTORE_PROJECT_ID`, 4 секрета); § 15 п. 22–24; чек-лист. Число кейсов 158 не менялось |
| `docs/user_guide/USER_GUIDE.md` | +37/−24 | Версия 1.7; § 6.1/6.4/6.5 — как доставляются push через RuStore и что нужно от оператора; § 7.2 п. 27–28; § 9.5; словарь; § 10 ссылки → RUSTORE_SETUP |
| `docs/README.md` | +5/−5 | Ссылки FIREBASE_SETUP → RUSTORE_SETUP (таблица DESIGN v1.5, дерево `v1.5/`); метрики обновлены Lead'ом (1976/570/644/KI-657) |
| `README.md` | +27/−20 | Раздел Android: push через RuStore (плагин/хук/сервис, env), CI (4 секрета + variable), ссылки → RUSTORE_SETUP; ограничения (устройство с RuStore, KI-656); стек Mobile (RuStore Push SDK 6.4.0); бейджи/метрики 1976/570/644/KI-657 |
| `docs/development/PROMPT_CURRENT.md` | +55/−49 | Версия **12.1** (v12.0 → `archive/prompts/PROMPT_V12.0.md`): метрики 1976/570, KI-657/644, Open High 0; § 1.3/1.4 — S4-B/RuStore; § 5.2 — KI-655/656/657, High 0; § 5.3 — RUSTORE_SETUP; § 6 — ручные шаги релиза (RuStore Console, 4 secrets, AAB, device-smoke); итог |
| `docs/development/archive/prompts/PROMPT_V12.0.md` | **+406** (new) | Архивная копия предыдущей версии промпта (RULES 2.17) |
| `docs/development/reports/v1.5.0/S4-B-rustore-push.md` | **+483** (new) | этот отчёт (RULES 2.15, 2.18) |
| `docs/development/reports/README.md` | +1 | строка S4-B в индексе отчётов (RULES 2.18) |

**Не тронуто (проверено):** `docs/development/reports/**` (кроме этого файла и
`reports/README.md`), `docs/development/archive/prompts/*` (кроме новой копии),
миграции/Drizzle-схема (`src/db/schema.ts` — только комментарии, без SQL),
`web/android/app/google-services.json` — файла нет (`Test-Path` → `False`).

---

## 2. Build / test

| Гейт | Команда | Результат |
|---|---|---|
| Build | `pnpm build` | **exit 0** — 0 errors, 0 warnings |
| Typecheck | `pnpm typecheck` | **exit 0** — 0 ошибок |
| Backend tests | `pnpm test` | **1976 passed**, 26 skipped; **127** файлов passed + 4 skipped (131). Baseline S4-A: 1958 → **+18** (env +3, RuStore-сервис +11, device-tokens +4) |
| Web tests | `pnpm --dir web test` | **570 passed**, **63** файла (baseline 559/62 → **+11**: `rustore-push.spec` 8, hook-спека обновлена) |
| Web build | `pnpm --dir web build` | exit 0 (`tsc -b` + vite), `base: '/'` |
| Web build (Capacitor) | `$env:CAPACITOR='1'; pnpm --dir web build` | exit 0, `base: './'` |
| Android sync | `pnpm --dir web exec cap sync android` | exit 0 — «Found **4** Capacitor plugins» (file-opener, mlkit-barcode, camera, filesystem); `push-notifications` из generated-файлов исчез |
| **Java-компиляция Android** | `web/android/gradlew.bat :app:compileDebugJavaWithJavac --no-daemon` | **BUILD SUCCESSFUL in 2m 03s** (exit 0, 87 actionable tasks; второй прогон после добавления Tracer-репозитория) |
| YAML workflow | `python -c "yaml.safe_load(...release-mobile.yml)"` | `YAML OK` |
| AAB / release | `bundleRelease` | **не запускался** (нет keystore и 4 GitHub Secrets — KI-655) |

Итого: **1976 + 570** тестов зелёные, build/typecheck 0/0, оба web-билда и
`cap sync` — 0, Java-плагин компилируется.

---

## 3. Диагностика

### 3.1. Что было на HEAD и как поняли объём

- `@capacitor/push-notifications` был только в `web/`; на бэкенде — ни
  `firebase-admin`, ни отправки: только `POST /notifications/register` и
  `device_tokens`. Поэтому часть A — **новый** путь отправки, а не замена
  вызова: `RuStorePushService` (один токен = один запрос) и
  `DeviceTokensService.sendToUserAsync` (fan-out по android-токенам,
  `Promise.allSettled`).
- `google-services.json` в дереве отсутствовал и раньше (S3/S4-A его не
  создавали) — удалять было нечего, но вся цепочка (gitignore, Gradle-плагин,
  шаг CI, Secret, доки) удалена.

### 3.2. Java API RuStore Push SDK 6.4.0 — проверка по артефакту, а не по памяти

Скачан `pushclient-6.4.0.aar` из рабочего Maven-репозитория и проверен
`javap`:
- `ru.rustore.sdk.pushclient.RuStorePushClient.INSTANCE.init(Application,
  String, Logger)` — есть (перегрузка ровно на 3 аргумента);
- `getToken()` → `ru.rustore.sdk.core.tasks.Task<String>`;
- `ru.rustore.sdk.pushclient.common.logger.DefaultLogger(String)` — есть,
  поэтому ручная реализация `Logger` не понадобилась;
- сервис — `ru.rustore.sdk.pushclient.messaging.service.
  RuStoreMessagingService` (в ТЗ он назван без пакета — имя в манифесте
  `RuStoreMessagingService` относится к **классу-наследнику**, а не к SDK);
  методы `onNewToken(String)`, `onMessageReceived(RemoteMessage)`,
  `onError(List<? extends RuStorePushClientException>)`,
  `onDeletedMessages()`; базовый `onMessageReceived` — no-op, поэтому наш
  override с логом ничего не подавляет (уведомление рисует сам SDK);
- `com.getcapacitor.JSObject.put(String, Object)` не бросает checked-исключений
  — `JSONObject.NULL` для `{ token: null }` корректен.

### 3.3. Gradle: первый прогон упал на Maven-репозиториях (KI-657)

- URL из ТЗ и документации SDK 6.4.0
  `https://artifactory-external.vkpartner.ru/artifactory/maven` отдаёт
  **HTTP 404** (проверено и субагентом, и Lead'ом независимо: 404 и на корне, и
  на `pushclient-6.4.0.pom`).
- Актуальный `nexus-external.rustore.ru/repository/maven-rustore-exposed`
  содержит `ru.rustore.sdk:pushclient:6.4.0`, но **не содержит** транзитивную
  `ru.ok.tracer:tracer-lite-crash-report:0.4.6` (`compile`-scope в
  `push-core-6.4.0.pom`). Первая сборка упала:
  `:app:checkDebugAarMetadata` → `Could not find
  ru.ok.tracer:tracer-lite-crash-report:0.4.6`.
- Через публичный Nexus REST API RuStore найден
  `.../maven-tracer-public-exposed` (POM/AAR 0.4.6 отдают 200) — добавлен
  вторым репозиторием. После этого `compileDebugJavaWithJavac` — BUILD
  SUCCESSFUL.
- Первый прогон дополнительно скачал Gradle 8.11.1 (~17 мин), AGP сам
  доставил build-tools 34.0.0/platforms (лицензии приняты); повторный прогон —
  2 мин. В `web/android/build.gradle` оставлены **все три** репозитория: рабочий
  Rustore, Tracer и URL из ТЗ (404 не ломает сборку — Gradle переходит к
  следующему).

### 3.4. Merged-манифест (debug)

`app/build/intermediates/merged_manifest/debug/processDebugMainManifest/
AndroidManifest.xml` содержит:
`<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`,
`com.iilmchat.workflowbuilder.RuStorePushMessagingService` с
`<action android:name="ru.rustore.sdk.pushclient.MESSAGING_EVENT" />` и
SDK-провайдер `ru.rustore.sdk.pushclient.provider.RuStorePushClientInitProvider`
(подтверждение merge манифеста SDK). Release-манифест не проверялся.

### 3.5. TypeScript/Web-специфика

- `types: ["vite/client"]` даёт `import.meta.env` с индексной сигнатурой `any`
  (RULES 1.16): добавлен `web/src/vite-env.d.ts` с узким `ImportMetaEnv`.
- Имена I/O-функций: в ТЗ `initRuStorePush`/`getRuStoreToken`, но RULES 1.4
  требует суффикс `Async` — реализованы `initRuStorePushAsync`/
  `getRuStoreTokenAsync`; соответствие ТЗ зафиксировано в JSDoc.
- `pnpm --dir web remove @capacitor/push-notifications` изменил lockfile;
  `install --frozen-lockfile` — «Lockfile is up to date» (298 entries).
- Старые 4 listener'а (`registration`/`registrationError`/
  `pushNotificationReceived`/`pushNotificationActionPerformed`) у FCM-плагина
  заменены на явный `init` → `getToken`; guard идемпотентности сохранён.

### 3.6. Бэкенд-диагностика

- `ConfigService` читает env в конструкторе; пустая строка из `.env`
  дополнительно тримится в `null`, потому что `validateEnv` сохраняет исходный
  ключ (`{ ...config, ...parsed }`).
- Формат запроса сверен с официальной страницей «Sending push notifications
  (API)»: `POST https://vkpns.rustore.ru/v1/projects/{projectId}/messages:send`,
  `Authorization: Bearer {service-token}`, тело `{ message: {...} }`, успех —
  HTTP 200 с пустым `payload`, ошибка — `{ error: { code, message, status } }`
  (HTTP-статус = `code`), лимит сообщения 4096 байт.
- Тесты не ходят в сеть (`vi.stubGlobal('fetch', …)`,
  `vi.unstubAllGlobals()`); реальный `vkpns.rustore.ru` не вызывался.

---

## 4. Smoke

### 4.1. `git status` и файлы

```
HEAD b5ee56d; изменено 32 + удалён 1 + новых 10; коммитов нет.
D  docs/development/v1.5/FIREBASE_SETUP.md
?? docs/development/v1.5/RUSTORE_SETUP.md
?? docs/development/archive/prompts/PROMPT_V12.0.md
?? src/notifications/rustore-push.service.ts / .spec.ts
?? web/src/lib/rustore-push.ts / .spec.ts
?? web/src/vite-env.d.ts, web/.env.example
?? web/android/app/src/main/java/…/RuStorePushPlugin.java
?? web/android/app/src/main/java/…/RuStorePushMessagingService.java
```

- `Test-Path web/android/app/google-services.json` → **False**; файла нет ни в
  рабочем дереве, ни в индексе.
- `grep -i 'push-notifications' web/package.json web/pnpm-lock.yaml` → **0**
  совпадений.
- `grep -i 'google-services\|google.gms\|firebase' web/**` и
  `.github/workflows/release-mobile.yml` → **0** совпадений (кроме
  исторических отчётов `docs/development/reports/**`, которые не правились).
- `web/android/.gitignore` больше не содержит `google-services.json`; в
  `Cleanup secrets` воркфлоу — только `release.keystore`.

### 4.2. `cap sync` и generated-файлы

```
pnpm --dir web exec cap sync android → exit 0
Found 4 Capacitor plugins (file-opener, mlkit-barcode-scanning, camera, filesystem)
Sync finished in 0.182s
```
Diff generated-файлов: `app/capacitor.build.gradle` −1 строка
(`implementation project(':capacitor-push-notifications')`),
`capacitor.settings.gradle` −3 строки (include/projectDir). После финального
прогона гейтов повторных изменений нет.

### 4.3. Android: компиляция и merged-манифест

```
.\gradlew.bat :app:compileDebugJavaWithJavac --no-daemon
BUILD SUCCESSFUL in 2m 3s
87 actionable tasks: 87 executed
```
Скомпилированы `RuStorePushPlugin.class`, `RuStorePushMessagingService.class`
(в `app/build/intermediates/javac/debug/compileDebugJavaWithJavac/classes/…`).
Проверенные строки merged-манифеста — см. § 3.4.

### 4.4. YAML и package-манифесты

`python -c "yaml.safe_load(...)"` → `YAML OK`; workflow: 4 секрета keystore,
`VITE_RUSTORE_PROJECT_ID: ${{ vars.RUSTORE_PROJECT_ID }}`,
`POST_NOTIFICATIONS` в verify-loop.

### 4.5. Метрики и реестр

- `pnpm test` → 1976 passed / 26 skipped; `pnpm --dir web test` → 570 / 63.
- KI: `(Select-String '^### KI-').Count` = **644**, строк `**Статус:**` =
  **644**; сумма по статусам = 644 (Fixed 281, Fixed частично 12, Open 281,
  Documented 57, Documented не воспроизводится 1, Planned 5, Deferred 3,
  Won't Fix 4) — сходится по RULES 3.20.
- `Test-Path docs/development/v1.5/RUSTORE_SETUP.md` → **True**,
  `FIREBASE_SETUP.md` → **False**.
- Web-бандл: vendor 154.43 kB (gzip 47.33), index 212.31 kB (gzip 52.26),
  react 218.76 kB — push-плагин в бандле больше не участвует.

---

## 5. Что не так

### 5.1. Не проверено на реальном окружении (главное ограничение)

1. **Нет устройства с RuStore** и нет проекта push в RuStore Console (Project
   ID/Service Token не создавались — это данные пользователя). Поэтому не
   проверены: `RuStorePushClient.init` в рантайме, реальный `getToken()`, строка
   в `device_tokens`, отображение уведомления, клик по нему, `onNewToken`.
   Это **KI-656**.
2. **Реальный HTTP-вызов `vkpns.rustore.ru` не выполнялся**: нет service token;
   сеть в unit-тестах замокана. Формат запроса проверен по контракту RuStore API
   и по телу/заголовкам в тестах, но не «в бою».
3. **AAB не собран, подпись не проверена**: `bundleRelease`,
   `-Pandroid.injected.signing.*`, `jarsigner -verify`, скачивание artifact и
   сам GitHub Actions не запускались (нет keystore и 4 Secrets). Это **KI-655**.
   Локально проверена только debug-компиляция Java и merge debug-манифеста.
4. **Версия SDK — 6.4.0 по ТЗ**, хотя актуальная у RuStore — 7.5.0. Апгрейд не
   делался; в 7.x другой набор Maven-репозиториев/пакетов, его нужно проверять
   отдельно (см. KI-657).

### 5.2. Функциональные ограничения реализации

5. **У `sendToUserAsync` нет вызывающего кода**: HTTP-ручки/очереди для
   отправки push в S4-B не добавлялось (в S3 их не было, вне объёма S4-B).
   Метод экспортируется вместе с `RuStorePushService` и покрыт тестами — его
   подключит следующий срез (события организации/воркер).
6. **Клик по уведомлению не обрабатывается**: RuStore Push SDK показывает
   уведомление и открывает приложение по умолчанию; deeplink/intent-action
   (`message.android.notification.click_action*`) не настраивались — это
   сознательно вне S4-B (в S3 был только `console.log` на
   `pushNotificationActionPerformed`, который удалён вместе с плагином).
7. **Разрешение `POST_NOTIFICATIONS` запрашивается в `init` при входе**, а не по
   кнопке: на Android 13+ системный диалог может появиться сразу после логина.
   Поведение соответствует прежнему FCM-хуку (он тоже спрашивал разрешение при
   старте), но UX-проверка на устройстве остаётся.
8. **Только Android**: RuStore Push не поддерживает iOS; APNs-ветка остаётся на
   будущий iOS-срез, `web-push` — вне v1.5.
9. **Retry/backoff для 429/5xx нет**: `sendAsync` бросает
   `RuStorePushException`, а `sendToUserAsync` учитывает отказ в WARN и
   возвращает число доставленных; политику повторов должен определить
   вызывающий слой (не входило в ТЗ).

### 5.3. Инфраструктурные ограничения

10. **Maven-репозитории SDK нестабильны** (KI-657): URL из документации 404,
    транзитивный `ru.ok.tracer` — в отдельном репозитории. Сборка воспроизводима
    только с тремя объявленными репозиториями; при обновлении SDK это нужно
    перепроверять.
11. **Первый Gradle-прогон долгий** (~20 мин: дистрибутив 8.11.1 + auto-install
    build-tools/platforms) — в CI это будет кэшироваться/повторяться; KI-655.
12. **`[Unreleased]` вместо `[1.5.0]`**: CHANGELOG-запись S4-B добавлена в
    рабочую секцию, потому что `[1.5.0]` уже датирована и закоммичена в S4-A;
    при выпуске тега `v1.5.0` пользователь должен решить, переносить ли запись
    в `[1.5.0]` (RULES 2.2).
13. **`PROMPT_CURRENT` поднят до 12.1** и v12.0 положен в
    `archive/prompts/` (RULES 2.17); это может быть неожиданно, если
    планировалось менять промпт только к следующему релизу.
14. **Отчётность**: в реестре KI теперь 644 записи (было 642): +KI-656,
    +KI-657, KI-653/654 закрыты. `docs/README.md`/`README.md`/`PROMPT_CURRENT`
    метрики обновлены; `reports/README.md` дополнен строкой S4-B.

---

## 6. Новые KI

### 6.1. Заведены

- **KI-656** — «Нативный плагин RuStore Push написан вручную и не проверен на
  устройстве» (🟡 Medium, **Planned**). Плагин `RuStorePush` (Java) и
  `RuStorePushMessagingService` — код на стыке JS ↔ Java, unit-тестами и CI не
  покрывается; нужен device-smoke: `init(projectId)` → `getToken()` → строка в
  `device_tokens` → тестовый push из RuStore Console. В S4-B Java-компиляция
  прошла, но рантайм не проверялся.
- **KI-657** — «RuStore Push SDK 6.4.0 не резолвится из «документационного»
  Maven-репозитория» (🟡 Medium, **Documented**). URL
  `artifactory-external.vkpartner.ru/artifactory/maven` → 404; в
  `maven-rustore-exposed` нет `ru.ok.tracer:tracer-lite-crash-report:0.4.6`
  (compile-scope `push-core-6.4.0`); сборка работает только с добавленным
  `maven-tracer-public-exposed`. Проверено `:app:compileDebugJavaWithJavac`.

### 6.2. Закрыты

- **KI-653** (High, был Planned) → **Fixed**: push на Android больше не зависит
  от `google-services.json` — FCM и файл удалены, токен выдаёт RuStore Push SDK.
- **KI-654** (Low, был Documented) → **Fixed**: FCM-meta-data иконки больше не
  используется; при необходимости иконку переопределяют meta-data
  `ru.rustore.sdk.pushclient.default_notification_icon` (не добавляли —
  опционально, нет своего канала/иконки).

### 6.3. Актуализирован

- **KI-655** — текст обновлён по факту: JDK 21 и Android SDK на машине есть,
  локальная Java-компиляция выполнена; не проверены `bundleRelease`, подпись,
  artifact и GitHub Actions. Статус остался **Planned**.

---

## 7. Обоснование решений

### 7.1. Почему RuStore Push и почему нативный плагин

Пользователь выбрал RuStore SDK вместо FCM: FCM требует Google Play Services,
которых на части устройств нет, а RuStore — целевой российский магазин. Готового
Capacitor-плагина для RuStore Push нет, поэтому мост написан вручную: Capacitor
7 поддерживает кастомные плагины через `@CapacitorPlugin` + `registerPlugin()`.
Схема: `usePushNotifications` → `registerPlugin('RuStorePush')` → Capacitor
bridge (WebView ↔ Java) → `RuStorePushPlugin.init/getToken` →
`RuStorePushClient` → токен возвращается в JS как `{ token }` → `POST
/notifications/register`. Push-сервис (`RuStorePushMessagingService`) SDK
вызывает сам по action `ru.rustore.sdk.pushclient.MESSAGING_EVENT`; он только
логирует, потому что у Service нет доступа к WebView, а уведомление рисует SDK.
Такой мост — минимум кода на Java и вся политика (ON/OFF, ошибки,
идемпотентность) в TypeScript, где она тестируется.

### 7.2. Почему `sendToUserAsync`, а не «замена вызова FCM»

На HEAD отправки push не существовало, поэтому «заменить FCM» = реализовать
путь отправки. Разделение: `RuStorePushService` — транспорт одного сообщения
(тонкий, легко тестировать контракт HTTP), `DeviceTokensService` — выборка
токенов пользователя и fan-out (`Promise.allSettled`): один отказ устройства не
должен отменять доставку остальным (RULES 4.16) и не должен ронять вызывающий
код. Fallback при ненастроенном RuStore — WARN + 0 (тот же контракт, что у
SMTP): регистрация токенов и остальное приложение работают без операторской
настройки.

### 7.3. Почему `fetch`, а не `HttpService`

В проекте нет `@nestjs/axios`/`HttpModule`; глобальный `fetch` (undici,
Node 24) — штатный путь без новой зависимости. Таймаут — `AbortSignal.timeout`
(RULES 4.19), ошибки не гасятся (RULES 4.18), ответ разбирается как `unknown`
(RULES 4.15). `ConfigService` вместо `process.env` (RULES 4.6); значения
опциональны (RULES 1.17, контракт «без ключа — сервис выключен», как у
media/web-search/SMTP).

### 7.4. Почему Maven-репозитории объявлены именно так

Требование ТЗ — `artifactory-external.vkpartner.ru/artifactory/maven`; проверка
показала 404 на 2026-11-09. Оставить только его = неработающая сборка; удалить =
отклонение от ТЗ. Компромисс: рабочий `maven-rustore-exposed` первым,
`maven-tracer-public-exposed` (найден через публичный Nexus REST API) вторым,
URL из ТЗ — третьим (404 не ломает сборку: Gradle переходит к следующему).
Все три задокументированы в `web/android/build.gradle` и `RUSTORE_SETUP.md`,
ограничение вынесено в KI-657.

### 7.5. Почему Project ID — variable, а Service Token — secret

Project ID попадает в URL и в JS-бандл (`VITE_*` инлайнится на сборке), поэтому
секретом не является: в CI это repository **variable**
`RUSTORE_PROJECT_ID`, в локальной сборке — `web/.env`. Service Token видит только
бэкенд (заголовок `Authorization`), он остаётся секретом (`.env`/secret manager),
в мобильную сборку не попадает и не логируется (RULES 5.1/5.3).
`web/.env.example` — placeholder, `.env` в git не попадает.

### 7.6. Почему имена `*Async` и версия SDK

RULES 1.4 («все I/O-методы с суффиксом `Async`») сильнее дословных имён ТЗ
(`initRuStorePush`/`getRuStoreToken`): в проекте уже `registerDeviceTokenAsync`,
`initPushNotificationsAsync`; имена из ТЗ зафиксированы в JSDoc. SDK взят
6.4.0 — как указано в ТЗ; 7.5.0 актуальна, но её Maven-координаты/пакеты не
проверялись, а миграция версии — отдельный шаг с регрессией push (KI-656/657).

### 7.7. Почему правки документации сделаны «по факту кода»

Промпт требует «обновить § 18: Firebase → RuStore», но документы должны
описывать реальный код, а не пожелания: в `RUSTORE_SETUP.md`,
`MOBILE_CAPACITOR_NESTJS.md`, DESIGN и CHANGELOG описаны **фактические**
имена файлов/методов (`RuStorePushPlugin.java`, `web/src/lib/rustore-push.ts`,
`RuStorePushService.sendAsync`, env `RUSTORE_*`), фактический набор Maven-
репозиториев и фактический результат локальной Gradle-компиляции. Исторические
факты (FCM, `google-services.json`) сохранены как «было → стало»/история в
KI-653/654 и `[1.5.0]`, а не переписаны задним числом.

### 7.8. Почему не коммитили

Сессия dsh завершается в рабочем дереве, коммит и push — за пользователем
(RULES 3.2/3.3, практика S4-A). Один коммит на S4-B невозможен без смешивания
несвязанных изменений; при коммите рекомендуется разделить: backend + env,
web/native + CI, docs/KI/CHANGELOG, отчёт (RULES 3.2).
