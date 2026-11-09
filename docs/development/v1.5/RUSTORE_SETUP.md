# RuStore Setup — Push-уведомления (Android)

**Файл:** `docs/development/v1.5/RUSTORE_SETUP.md`
**Для:** v1.5.0+ (миграция FCM → RuStore Push, S4-B).
**Заменяет:** `docs/development/v1.5/FIREBASE_SETUP.md` (удалён).
**Связанные:** KI-656, DESIGN v1.5 § S4-B, `KEYSTORE_SETUP.md`,
отчёт `docs/development/reports/v1.5.0/S4-B-rustore-push.md`.

---

## Зачем и что изменилось

В S3 push-уведомления были сделаны на `@capacitor/push-notifications` +
Firebase Cloud Messaging (FCM). FCM требует **Google Play Services**, которых на
устройствах без Google Play нет, а для российского магазина RuStore это лишняя
внешняя зависимость. В S4-B доставка push переведена на **RuStore Push**:

| Было (S3) | Стало (S4-B) |
|---|---|
| `@capacitor/push-notifications` + FCM | нативный Capacitor-плагин `RuStorePush` + RuStore Push SDK 6.4.0 |
| `google-services.json` (артефакт Firebase-проекта) | проект push в RuStore Console (Project ID + Service Token) |
| `firebase-admin` (в рецепте, отправка FCM) | `RuStorePushService` (`POST https://vkpns.rustore.ru/v1/projects/<projectId>/messages:send`) |
| GitHub Secret `GOOGLE_SERVICES_JSON` | GitHub repository **variable** `RUSTORE_PROJECT_ID` (не секрет) |
| 5 секретов сборки | 4 секрета: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |

**Ключевое ограничение.** Push доставляется только на устройство, где есть
**RuStore**, приложение **добавлено в RuStore Console** (успешно прошло
модерацию), а **подпись установленного приложения совпадает с подписью,
указанной в консоли**. Push, отправленный в сборку, подписанную другим ключом
(например, debug), не дойдёт.

---

## Что нужно получить

| Значение | Где взять | Секрет? | Куда прописывается |
|---|---|---|---|
| **Project ID** | RuStore Console → Push-уведомления → Проекты → поле «ID проекта» | нет | backend `.env` → `RUSTORE_PROJECT_ID`; GitHub repository **variable** `RUSTORE_PROJECT_ID` (для web-сборки как `VITE_RUSTORE_PROJECT_ID`) |
| **Service Token** (S2S-токен) | RuStore Console → Push-уведомления → Проекты → «Сервисный токен» | **да** | backend `.env` → `RUSTORE_SERVICE_TOKEN`; prod — secret manager |

Project ID виден в URL запроса (`/v1/projects/<projectId>/messages:send`),
поэтому секретом не считается. Service Token уходит только в заголовке
`Authorization: Bearer <serviceToken>` и **не должен** попадать в git, логи,
сообщения об ошибках и скриншоты (RULES 5.1, 5.2, 5.3).

---

## Шаг 1. Создать проект push в RuStore Console

1. Открой [RuStore Console](https://console.rustore.ru/) под своей учётной
   записью разработчика.
2. Перейди в **Инструменты → Push-уведомления → Проекты** (в интерфейсе
   приложения — страница приложения → **Push-уведомления → Проекты**).
   Названия пунктов меню могут отличаться в зависимости от версии консоли.
3. **Создать проект** и заполнить:
   - **Название** — любое (например, `ai-workflow-builder`).
   - **Package name** — должен **точно** совпадать с `appId` из
     `web/capacitor.config.ts` (в проекте — `com.iilmchat.workflowbuilder`).
   - **Отпечаток подписи (SHA-256)** — отпечаток ключа, которым подписана
     сборка. Взять из keystore:
     ```powershell
     keytool -list -v -keystore C:\Users\YOUR_USER\.keystores\ai-workflow-builder.keystore `
       -alias ai-workflow-builder | Select-String "SHA256:"
     ```
4. Сохранить. Консоль сгенерирует **ID проекта** и **Сервисный токен** — скопируй
   оба значения.

**Под разные типы сборок — разные проекты.** Debug- и release-сборка обычно
подписаны разными ключами: отпечаток в консоли должен совпадать с подписью
конкретной установленной сборки. Если тестируешь на debug-сборке — создай
отдельный проект с отпечатком debug-ключа (или подпиши тестовую сборку тем же
release-ключом, см. `KEYSTORE_SETUP.md`). В одном проекте можно создать до
5 сервисных токенов; токен, помеченный `*`, используется для тестовых отправок
по умолчанию.

### Maven-репозитории Android-сборки (S4-B)

В `web/android/build.gradle` объявлены три репозитория — без них Gradle не
соберёт приложение:

1. `https://nexus-external.rustore.ru/repository/maven-rustore-exposed/` —
   сам SDK `ru.rustore.sdk:pushclient:6.4.0`;
2. `https://nexus-external.rustore.ru/repository/maven-tracer-public-exposed` —
   транзитивная зависимость `ru.ok.tracer:tracer-lite-crash-report:0.4.6`
   (`compile`-scope в `push-core-6.4.0.pom`), которой нет в первом
   репозитории; без неё Gradle падает на `:app:checkDebugAarMetadata`;
3. `https://artifactory-external.vkpartner.ru/artifactory/maven` — URL из
   документации RuStore 6.4.0; на 2026-11-09 отдаёт HTTP 404 и оставлен для
   совместимости (Gradle при 404 переходит к следующему репозиторию).

Это ограничение upstream-артефактов, а не ошибка проекта — см. KI-657. При
обновлении версии SDK набор репозиториев нужно перепроверить
(`:app:compileDebugJavaWithJavac`).

---

## Шаг 2. Прописать значения на бэкенде

В `.env` (dev — локальный, prod — secret manager):

```text
RUSTORE_PROJECT_ID=<ID проекта из консоли>
RUSTORE_SERVICE_TOKEN=<сервисный токен из консоли>
```

Обе переменные **опциональны**: без них приложение поднимается и продолжает
принимать токены устройств (`POST /notifications/register`, таблица
`device_tokens`), но отправка push выключена — `RuStorePushService.isConfigured()`
вернёт `false`, а высокоуровневая отправка напишет WARN и вернёт 0 доставленных
(тот же fallback-контракт, что у SMTP). Секреты в `.env` в git не попадают
(`.gitignore`); в `.env.example` — только placeholder-значения (RULES 5.2).

Как устроена отправка (S4-B):

```text
DeviceTokensService.sendToUserAsync(...)        — все токены пользователя (fan-out)
  → RuStorePushService.sendAsync(token, title, body, data?)   — один push-токен
    → POST https://vkpns.rustore.ru/v1/projects/<RUSTORE_PROJECT_ID>/messages:send
      Authorization: Bearer <RUSTORE_SERVICE_TOKEN>
      { "message": { "token": "...", "notification": { "title": "...", "body": "..." },
                     "data": { "...": "..." } } }
```

Файл сервиса — `src/notifications/rustore-push.service.ts`.

---

## Шаг 3. GitHub Actions: переменная для web-сборки

Project ID нужен не только бэкенду, но и приложению: нативный плагин
`RuStorePush` инициализируется в web-слое значением из окружения сборки.

1. GitHub → репозиторий → **Settings → Secrets and variables → Actions →
   Variables** → **New repository variable**:
   - Name: `RUSTORE_PROJECT_ID`
   - Value: ID проекта из консоли.
2. Workflow `.github/workflows/release-mobile.yml` передаёт эту переменную в
   web-сборку как **`VITE_RUSTORE_PROJECT_ID`**:
   ```text
   VITE_RUSTORE_PROJECT_ID: ${{ vars.RUSTORE_PROJECT_ID }}
   ```
3. Это **не секрет**: Project ID попадает в собранный JS-бандл, а в консоли
   RuStore от него ничего не защищает. Секретом остаётся только Service Token,
   и он в мобильную сборку **не попадает** — он нужен исключительно бэкенду.

Для локальной сборки переменная задаётся в `web/.env` (шаблон —
`web/.env.example`, поле `VITE_RUSTORE_PROJECT_ID`) или через окружение
(`$env:VITE_RUSTORE_PROJECT_ID='<ID проекта>'` перед `pnpm --dir web build`).

Список секретов Android-сборки (keystore) и их настройка —
в `docs/development/v1.5/KEYSTORE_SETUP.md`. Секрета `GOOGLE_SERVICES_JSON`
больше нет: файл `google-services.json` в сборке не нужен, в
`web/android/.gitignore` и `Cleanup secrets` остаются только keystore-секреты.

---

## Шаг 4. Проверить, что токен дошёл

1. Собери и установи приложение на **реальное устройство с установленным
   RuStore** (эмулятор без RuStore не подойдёт):
   ```powershell
   $env:CAPACITOR='1'; $env:VITE_RUSTORE_PROJECT_ID='<ID проекта>'
   pnpm --dir web build
   Remove-Item Env:CAPACITOR; Remove-Item Env:VITE_RUSTORE_PROJECT_ID
   pnpm --dir web exec cap sync android
   pnpm --dir web exec cap open android
   # Android Studio: Run 'app'
   ```
2. Войти в приложение и разрешить уведомления.
3. Смотреть лог:
   ```powershell
   adb logcat | Select-String "push"
   ```
   Должен появиться push-токен RuStore (`[push] token = ...`), без ошибок
   инициализации плагина.
4. Проверить БД:
   ```sql
   SELECT * FROM device_tokens ORDER BY created_at DESC LIMIT 5;
   ```
   Должна появиться строка с `platform = 'android'` для твоего пользователя.
5. **Тестовая отправка из консоли** (не через бэкенд): RuStore Console →
   Push-уведомления → Проекты → твой проект → вкладка **Тестовые уведомления**
   → вставить push-токен из лога, заголовок и текст → **Отправить**.
   Уведомление должно прийти в течение нескольких секунд.

---

## Troubleshooting

| Проблема | Решение |
|---|---|
| Push не приходит на эмулятор / устройство без RuStore | Нужно реальное устройство, где установлен RuStore (дистрибьютор push-сообщений). На «чистом» эмуляторе без RuStore токен не выдаётся — это ожидаемо |
| `[push]` в logcat пуст, токена нет | Приложение установлено из сборки с другим `applicationId` или подписью, чем в консоли; инициализация плагина прошла без `projectId` (`VITE_RUSTORE_PROJECT_ID` не задан при сборке) |
| `PERMISSION_DENIED` (HTTP 403) при отправке | Неверный/чужой сервисный токен: взять токен именно из этого проекта, проверить, что он активен (помечен `*`), не отозван и не истёк |
| `NOT_FOUND` (HTTP 404) | Неверный push-токен (устарел после переустановки приложения) или чужой Project ID: переснять токен на устройстве и повторить |
| `INVALID_ARGUMENT` (HTTP 400) | Пустой/битый `token`; в сообщении нет ни `notification.title`, ни `notification.body`, ни `data`; превышен лимит размера сообщения (4096 байт) |
| `401` от RuStore | В запросе нет заголовка `Authorization: Bearer <serviceToken>` или он испорчен |
| `TOO_MANY_REQUESTS` (HTTP 429) / `INTERNAL` (HTTP 5xx) | Слишком частая отправка / временная ошибка RuStore: повторить позже с backoff, не считать доставленным |
| Push приходит, но уведомление не показывается (Android 13+) | Не выдано разрешение `POST_NOTIFICATIONS`: «Настройки → Приложения → … → Уведомления». SDK объявляет разрешение в манифесте, а плагин `RuStorePush` запрашивает его в рантайме при инициализации; если пользователь отказал — включить вручную |
| Уведомления приходят с большой задержкой | RuStore должен иметь доступ к работе в фоне («Настройки → Приложения → RuStore → Батарея» — без ограничений) |
| Backend пишет WARN «RuStore Push не настроен» | Не заданы `RUSTORE_PROJECT_ID` / `RUSTORE_SERVICE_TOKEN` в окружении процесса |
| Push не приходит, хотя токен и env в порядке | Проверить, что приложение прошло модерацию в RuStore и добавлено в консоль; отпечаток подписи установленного APK совпадает с консолью; RuStore обновлён |

---

## Ссылки

- [RuStore Console](https://console.rustore.ru/)
- [RuStore Push SDK — Kotlin/Java (6.4.0)](https://www.rustore.ru/help/sdk/push-notifications/kotlin-java/6-4-0)
- [Отправка push-уведомлений (API)](https://www.rustore.ru/help/sdk/push-notifications/send-push-notifications)
- [Тестовые push-уведомления](https://www.rustore.ru/help/sdk/push-notifications/test-push-notifications)
- [Публикация приложений в RuStore](https://www.rustore.ru/help/developers/publishing-and-verifying-apps/app-publication)
