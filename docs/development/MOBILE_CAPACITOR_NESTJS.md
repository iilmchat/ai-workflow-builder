# Capacitor для NestJS + React (Vite) — переиспользуемая инструкция

**Версия:** 1.1 (2026-11-09)
**Статус:** Production-ready рецепт
**Применимо к:** любой проект с NestJS-бэкендом и React (Vite) фронтендом, где нужен Android-клиент.
**Связанные:** `MOBILE_IOS.md` (в разработке), `DESIGN_V150_CAPACITOR.md` (пример применения в ai-workflow-builder).

---

## TL;DR

**Capacitor** — тонкая обёртка над React-приложением. Даёт нативное Android/iOS приложение с доступом к камере, файлам, push через готовые плагины.

**Не меняет:** бэкенд (NestJS + PostgreSQL + Redis остаются на сервере).
**Меняет:** `web/vite.config.ts` (`base: './'`), добавляет папку `web/android/`, ~500 строк кода на фронте.

**Зачем:** публикация в Google Play, доступ к нативным API, «не веб-приложение» для IT-approval.

---

## 1. Почему Capacitor, а не Tauri Mobile или PWA

| Критерий | Capacitor | Tauri 2 Mobile | PWA |
|---|---|---|---|
| Зрелость | Production, enterprise | Моложе, есть CVE | Полная |
| Изменения в коде | Минимальные | Нужен Rust | Нулевые |
| Нативные API | Готовые плагины | Через Rust | Ограничено |
| Google Play | Да (`.aab`) | Да | Нет (только TWA) |
| Размер APK | ~5–10 МБ | ~5–15 МБ | 0 МБ |
| Команда | TypeScript/React | Rust + TS | TS |

**Вывод:** для NestJS + React проекта с удалённым бэкендом — Capacitor.

---

## 2. Требования

- Node.js 22+
- pnpm 9+
- Android Studio (локально) **или** только JDK 21 + Android SDK (для CI)
- Windows 10+, macOS 12+, Ubuntu 20.04+

Опционально для iOS: macOS + Xcode 15+.

---

## 3. Структура проекта (монорепо)

    project/
    ├── src/                 # NestJS backend (не трогаем)
    ├── web/                 # React + Vite frontend
    │   ├── src/
    │   ├── dist/            # web build (используется Capacitor)
    │   ├── android/         # ← создаётся `cap add android`
    │   ├── ios/             # (опционально)
    │   ├── capacitor.config.ts
    │   └── package.json
    ├── package.json         # корневой workspace
    └── .github/workflows/
        └── release-mobile.yml

**Ключевое:** `capacitor.config.ts` живёт в `web/`, а `webDir: 'dist'` — относительно `web/`.

---

## 4. Шаг 1. Настройка Vite

В `web/vite.config.ts`:

    import { defineConfig } from 'vite';

    export default defineConfig({
      base: './',   // ОБЯЗАТЕЛЬНО для Capacitor: файлы грузятся через file://
      build: {
        outDir: 'dist',
      },
      // остальные настройки не меняются
    });

Без `base: './'` приложение упадёт с белым экраном в native (абсолютные пути `/assets/...` не резолвятся через `file://`).

---

## 5. Шаг 2. Установка Capacitor

В `web/`:

    # Core + Android
    pnpm add @capacitor/core @capacitor/android
    pnpm add -D @capacitor/cli

    # Инициализация
    pnpm exec cap init "My App" com.mycompany.myapp --web-dir dist
    pnpm exec cap add android

**appId** — уникальный идентификатор (обратный домен, `com.mycompany.myapp`).
**appName** — отображается под иконкой.
**webDir** — куда Vite собирает (`dist`).

---

## 6. Шаг 3. capacitor.config.ts

    import type { CapacitorConfig } from '@capacitor/cli';

    const config: CapacitorConfig = {
      appId: 'com.mycompany.myapp',
      appName: 'My App',
      webDir: 'dist',
      server: {
        androidScheme: 'https',   // безопасность
        cleartext: false,         // запрет http (кроме dev)
      },
      android: {
        allowMixedContent: false, // не загружать http-контент
      },
    };

    export default config;

**Dev-режим (live reload):** `pnpm exec cap run android --livereload --external` — WebView грузит с Vite dev-сервера.

---

## 7. Шаг 4. Разрешения Android

В `web/android/app/src/main/AndroidManifest.xml` (создаётся `cap add android`) добавь **только** нужные:

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
        android:maxSdkVersion="32" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
        android:maxSdkVersion="28" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />

**Правило:** запрашивай только те права, которые реально используешь. Push-плагин на Android (RuStore Push SDK) сам объявляет `POST_NOTIFICATIONS` в манифесте, но на Android 13+ приложение обязано запросить это разрешение в рантайме — без него уведомления не показываются.

---

## 8. Шаг 5. Platform detection

`web/src/lib/platform.ts`:

    import { Capacitor } from '@capacitor/core';

    export const isNative = (): boolean => Capacitor.isNativePlatform();
    export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';
    export const isIOS = (): boolean => Capacitor.getPlatform() === 'ios';
    export const isWeb = (): boolean => Capacitor.getPlatform() === 'web';

**В компонентах:** условный рендеринг, чтобы не сломать веб-версию:

    import { isNative } from '@/lib/platform';

    {isNative() ? (
      <button onClick={handleNativeScan}>Сканировать QR</button>
    ) : (
      <input type="file" accept="image/*" />
    )}

---

## 9. Шаг 6. Камера + QR

**Установка:**

    pnpm add @capacitor/camera @capacitor-mlkit/barcode-scanning
    pnpm exec cap sync android

`@capacitor-mlkit/barcode-scanning` требует Google Play Services (на эмуляторах без Play — не работает; используйте реальное устройство).

**Хук камеры (`web/src/hooks/useCamera.ts`):**

    import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
    import { isNative } from '@/lib/platform';

    export async function capturePhoto(): Promise<string | null> {
      if (!isNative()) return null;

      try {
        const photo = await Camera.getPhoto({
          quality: 90,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
        });
        return photo.webPath ?? null;
      } catch (e) {
        console.warn('[camera] отменено или ошибка', e);
        return null;
      }
    }

**Хук QR (`web/src/hooks/useQrScanner.ts`):**

    import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
    import { Capacitor } from '@capacitor/core';

    export async function scanQr(): Promise<string | null> {
      if (!Capacitor.isNativePlatform()) return null;

      const { supported } = await BarcodeScanner.isSupported();
      if (!supported) {
        console.warn('[qr] камера недоступна');
        return null;
      }

      // Play Services — Android-only (KI-648)
      if (Capacitor.getPlatform() === 'android') {
        const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
        if (!available) {
          await BarcodeScanner.installGoogleBarcodeScannerModule();
        }
      }

      const perm = await BarcodeScanner.requestPermissions();
      if (perm.camera !== 'granted') return null;

      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      return barcodes[0]?.rawValue ?? null;
    }

*В `@capacitor-mlkit/barcode-scanning@7.x` `isSupported()` возвращает `{ supported }`, а не `{ available }`; Play Services проверяются отдельным Android-only методом `isGoogleBarcodeScannerModuleAvailable()`.*

---

## 10. Шаг 7. Файлы (скачать DOCX/PDF)

**Установка:**

    pnpm add @capacitor/filesystem @capacitor-community/file-opener
    pnpm exec cap sync android

**Хук (`web/src/hooks/useFileDownload.ts`):**

    import { Filesystem, Directory } from '@capacitor/filesystem';
    import { FileOpener } from '@capacitor-community/file-opener';
    import { Capacitor } from '@capacitor/core';

    const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    export async function downloadAndOpen(
      url: string,
      fileName: string,
      mimeType: string = MIME_DOCX,
    ): Promise<void> {
      if (!Capacitor.isNativePlatform()) {
        window.open(url, '_blank');
        return;
      }

      const response = await fetch(url);
      const blob = await response.blob();
      const base64 = await blobToBase64(blob);

      const result = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });

      await FileOpener.open({ filePath: result.uri, contentType: mimeType });
    }

    function blobToBase64(blob: Blob): Promise<string> {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? '');
        };
        reader.readAsDataURL(blob);
      });
    }

**В `DocumentGenNode`:**

    <button onClick={() => downloadAndOpen(outputs.fileUrl, outputs.fileName, MIME_DOCX)}>
      Скачать DOCX
    </button>

---

## 11. Шаг 8. Push notifications (RuStore Push)

Российский магазин RuStore даёт собственный push-канал, не требующий Google Play
Services (FCM на устройствах без них не работает). Доставка идёт через
дистрибьютора — приложение **RuStore**, установленное на устройстве.

**Нативная часть (Android).** Готового Capacitor-плагина нет — мост пишется
вручную. В `web/android/`:

    // build.gradle (allprojects repositories)
    maven { url = uri("https://nexus-external.rustore.ru/repository/maven-rustore-exposed/") }

    // app/build.gradle
    implementation("ru.rustore.sdk:pushclient:6.4.0")

> Официальный Maven-репозиторий RuStore — `nexus-external.rustore.ru` (так в
> актуальной документации SDK). Прежний адрес
> `artifactory-external.vkpartner.ru/artifactory/maven` в 2026-11 отдаёт 404 —
> при старте нового проекта сверь URL с документацией RuStore.

В `AndroidManifest.xml` объявляется сервис, расширяющий `RuStoreMessagingService`
(в ai-workflow-builder — `RuStorePushMessagingService`):

    <service
        android:name=".RuStorePushMessagingService"
        android:exported="true">
      <intent-filter>
        <action android:name="ru.rustore.sdk.pushclient.MESSAGING_EVENT" />
      </intent-filter>
    </service>

Иконку/цвет уведомления (опционально) задают meta-data
`ru.rustore.sdk.pushclient.default_notification_icon` /
`…default_notification_color`.

Нативный Capacitor-плагин `RuStorePush` — тонкий мост на JS:

    // Capacitor-плагин: инициализация проекта и получение push-токена
    RuStorePushClient.init(application = this, projectId = "<projectId>")
    RuStorePushClient.getToken()   // → push-токен для бэкенда

В ai-workflow-builder нативная часть — `RuStorePushPlugin.java` /
`RuStorePushMessagingService.java` в
`web/android/app/src/main/java/com/iilmchat/workflowbuilder/`, JS-обёртка —
`web/src/lib/rustore-push.ts` (`initRuStorePushAsync`, `getRuStoreTokenAsync`).

**Frontend — хук (пример):**

    import { registerPlugin } from '@capacitor/core';
    import { isNative } from '@/lib/platform';

    interface RuStorePushPlugin {
      init(options: { projectId: string }): Promise<void>;
      getToken(): Promise<{ token: string | null }>;
    }

    const RuStorePush = registerPlugin<RuStorePushPlugin>('RuStorePush');

    export async function initPushNotificationsAsync(projectId: string): Promise<void> {
      if (!isNative()) return;

      // 1. инициализация SDK: projectId из RuStore Console (не секрет);
      //    плагин сам запрашивает POST_NOTIFICATIONS на Android 13+
      await RuStorePush.init({ projectId });

      // 2. push-токен → бэкенд (upsert по токену — повторная регистрация безопасна)
      const { token } = await RuStorePush.getToken();
      if (token) await sendTokenToBackend(token);
    }

*Точные имена методов/полей — в `web/src/hooks/usePushNotifications.ts` и
нативной части `web/android/app/src/main/`; выше — форма контракта.*

**Backend (NestJS) — эндпоинт для токена** (не меняется с S3):

    // src/notifications/notifications.controller.ts
    @Controller('notifications')
    export class NotificationsController {
      constructor(private readonly deviceTokens: DeviceTokensService) {}

      @Post('register')
      @UseGuards(JwtAuthGuard)
      async register(
        @Body() dto: { token: string; platform: 'android' | 'ios' },
        @CurrentUser() user: JwtPayload,
      ): Promise<{ ok: true }> {
        await this.deviceTokens.upsertAsync(user.sub, dto.token, dto.platform);
        return { ok: true };
      }
    }

**Backend — отправка через RuStore Push API:**

    // src/notifications/rustore-push.service.ts
    // sendAsync(token, title, body, data?):
    //   POST https://vkpns.rustore.ru/v1/projects/<projectId>/messages:send
    //   Authorization: Bearer <serviceToken>
    //   { message: { token, notification: { title, body }, data? } }

Env бэкенда: `RUSTORE_PROJECT_ID` (Project ID, **не** секрет) и
`RUSTORE_SERVICE_TOKEN` (сервисный токен, **секрет** — только `.env`/secret
manager). Без них приложение поднимается, но отправка выключена (WARN и 0
доставленных). Один запрос — один токен; для всех устройств пользователя
используй `Promise.allSettled` (RULES 4.16). Токен храни в `device_tokens`
(user_id, organization_id, token, platform, created_at).

**Полная настройка:** `docs/development/v1.5/RUSTORE_SETUP.md`.

---

## 12. Шаг 9. CI/CD (GitHub Actions)

`.github/workflows/release-mobile.yml`:

    name: Release Mobile (Android)

    on:
      push:
        tags:
          - 'v*'

    jobs:
      build-android:
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v4

          - uses: actions/setup-node@v4
            with:
              node-version: 22

          - name: Install pnpm
            run: npm install -g pnpm

          - name: Install dependencies
            run: pnpm --dir web install --frozen-lockfile

          - name: Build web
            env:
              VITE_RUSTORE_PROJECT_ID: ${{ vars.RUSTORE_PROJECT_ID }}
            run: pnpm --dir web build

          - name: Sync Capacitor
            run: pnpm --dir web exec cap sync android

          - uses: actions/setup-java@v4
            with:
              distribution: 'temurin'
              java-version: '21'

          - uses: android-actions/setup-android@v3

          - name: Decode keystore
            run: |
              echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > web/android/app/release.keystore

          - name: Build AAB
            working-directory: web/android
            run: |
              ./gradlew bundleRelease \
                -Pandroid.injected.signing.store.file=release.keystore \
                -Pandroid.injected.signing.store.password=${{ secrets.ANDROID_KEYSTORE_PASSWORD }} \
                -Pandroid.injected.signing.key.alias=${{ secrets.ANDROID_KEY_ALIAS }} \
                -Pandroid.injected.signing.key.password=${{ secrets.ANDROID_KEY_PASSWORD }}

          - uses: actions/upload-artifact@v4
            with:
              name: app-release.aab
              path: web/android/app/build/outputs/bundle/release/app-release.aab

**Секреты GitHub:**
- `ANDROID_KEYSTORE_BASE64` — `base64 -w 0 release.keystore`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

**Переменная (не секрет):** `RUSTORE_PROJECT_ID` — Project ID из RuStore Console;
workflow передаёт её в web-сборку как `VITE_RUSTORE_PROJECT_ID` (§ 11).

**Генерация keystore** (один раз, локально):

    keytool -genkey -v -keystore release.keystore -alias myapp \
      -keyalg RSA -keysize 2048 -validity 10000

Храни `release.keystore` и пароли в надёжном месте (1Password, Bitwarden). Потеря keystore = невозможность обновить приложение в Google Play.

---

## 13. Шаг 10. Публикация в Google Play

1. Собери `.aab` через CI (или `./gradlew bundleRelease` локально).
2. Открой Google Play Console → создай приложение.
3. **Internal testing** → загрузи `.aab` → добавь тестировщиков (до 100 email).
4. Пройди review (первый раз — до 7 дней, потом 1–3 дня).
5. **Closed testing** → **Production**.
6. Заполни:
   - Store listing (название, описание, скриншоты 1080×1920)
   - Privacy Policy (обязательно, если собираешь данные)
   - Content rating
   - Target audience

**Требования Google (2025+):**
- **AAB**, не APK (APK только для sideload).
- **Data safety declaration** — заполни, какие данные собираешь.
- **Target SDK 34+** (с августа 2025 — 35+).
- Подпись приложения через Play App Signing.

**RuStore (российский магазин).** Альтернатива Google Play: RuStore Console →
загрузка подписанного AAB/APK → модерация → публикация. Для push через RuStore
отпечаток подписи сборки должен совпадать с указанным в проекте push
(`docs/development/v1.5/RUSTORE_SETUP.md`).

---

## 14. Обновления без Google Play (опционально)

**Версия:** рецепт написан под Capacitor 7.x. На момент ревью latest — 8.x; при старте нового проекта проверь `pnpm view @capacitor/core version` и зафиксируй мажор явно (`pnpm add @capacitor/core@7`), иначе плагины 7.x дадут peer-конфликт.

[Capgo](https://capgo.app) — плагин `@capgo/capacitor-updater` для live-обновлений веб-бандла без ревью в сторе. Требует аккаунта (free-tier — 2 проекта).

**Правила:**
- Можно обновлять только **веб-бандл** (JS/HTML/CSS), **не** нативный код (Java/Kotlin, плагины).
- Для новой нативной фичи — релиз через Google Play.

**Установка:**

    pnpm add @capgo/capacitor-updater
    pnpm exec cap sync

Инициализация в `main.tsx`:

    import { CapacitorUpdater } from '@capgo/capacitor-updater';

    CapacitorUpdater.notifyAppReady();

---

## 15. Troubleshooting

| Проблема | Решение |
|---|---|
| Белый экран в APK | `base: './'` в `vite.config.ts` |
| `ERR_FILE_NOT_FOUND` | Проверь `webDir` в `capacitor.config.ts` |
| Камера не работает | Проверь `AndroidManifest.xml` + разрешения в рантайме |
| QR-сканер не работает на эмуляторе | Нужен Google Play Services (используй реальное устройство) |
| Push-токен не приходит | RuStore установлен на устройстве и разрешён в фоне; проект push создан в RuStore Console; подпись и package name сборки совпадают с консолью; `VITE_RUSTORE_PROJECT_ID` задан при сборке (§ 11) |
| `PERMISSION_DENIED` / `INVALID_ARGUMENT` / `NOT_FOUND` от RuStore API | Неверный сервисный токен / параметры сообщения / чужой push-токен — таблица ошибок в `docs/development/v1.5/RUSTORE_SETUP.md` |
| File Opener не открывает файл | Проверь MIME-type (DOCX ≠ text/plain) |
| `cap sync` падает | `pnpm exec cap doctor` — покажет проблемы |
| AAB не принимается Google | Проверь `targetSdkVersion` (34+), подпись, Data safety |
| Приложение крашится при старте | `adb logcat` или Logcat в Android Studio |

---

## 16. Адаптация под другой проект (чеклист)

При переносе рецепта в новый NestJS + React проект:

- [ ] `web/vite.config.ts` — `base: './'`
- [ ] `pnpm --dir web add @capacitor/core @capacitor/android @capacitor/cli`
- [ ] `pnpm --dir web exec cap init "<App Name>" <com.company.app> --web-dir dist`
- [ ] `pnpm --dir web exec cap add android`
- [ ] `web/capacitor.config.ts` — appId, appName, webDir, androidScheme: 'https'
- [ ] `web/src/lib/platform.ts` — isNative/isAndroid/isIOS
- [ ] Установить только нужные плагины (camera / files / push / …)
- [ ] `AndroidManifest.xml` — только нужные разрешения
- [ ] Условный рендеринг в компонентах (`isNative()`)
- [ ] CI/CD workflow + keystore в GitHub Secrets
- [ ] Push через RuStore: проект в RuStore Console, `RUSTORE_PROJECT_ID` (variable) для web-сборки, `RUSTORE_SERVICE_TOKEN` — в env бэкенда (§ 11)
- [ ] Store listing + Privacy Policy + Data safety
- [ ] (опционально) Capgo для live-updates

---

## 17. Что НЕ делать

- **НЕ** пытайся упаковать NestJS + PostgreSQL + Redis в sidecar. Бэкенд остаётся на сервере.
- **НЕ** используй `@tauri-apps/*` и Capacitor одновременно. Выбери одно.
- **НЕ** коммить `release.keystore` в git. Только в Secrets.
- **НЕ** ставь `base: '/'` в Vite — сломается нативное приложение.
- **НЕ** ставь `base: './'` безусловно в NestJS/SPA-проектах: сломает deep links и SPA-fallback. Используй условный `base` (см. `web/vite.config.ts` в ai-workflow-builder).
- **НЕ** запрашивай все разрешения «на всякий случай». Google Play отклоняет.
- **НЕ** обновляй нативный код через Capgo (только веб-бандл).

---

## 18. CI/CD: NestJS + RuStore Push + Keystore

Для NestJS + Capacitor проекта CI/CD состоит из 3 независимых пайплайнов:

1. **Backend/Web** (GitHub Actions — уже есть): `pnpm test`, `pnpm --dir web test`, деплой Docker.
2. **Mobile (Android)**: сборка AAB, публикация в магазин приложений (RuStore / Google Play).
3. **RuStore Push**: проект push в RuStore Console + repository variable `RUSTORE_PROJECT_ID` для web-сборки; сервисный токен — секрет бэкенда, в мобильную сборку не попадает.

### Мобильный workflow (`.github/workflows/release-mobile.yml`)

Ключевые моменты:
- `CAPACITOR=1 pnpm --dir web build` — обязательно, иначе `base: '/'` сломает WebView; в `env` шага сборки — `VITE_RUSTORE_PROJECT_ID: ${{ vars.RUSTORE_PROJECT_ID }}`.
- `cap sync android` **после** Capacitor-сборки.
- `release.keystore` инжектится из Secrets в `web/android/app/`.
- `Cleanup secrets` в `if: always()` — файлы удаляются даже при падении (удаляется только keystore: `google-services.json` больше не нужен).
- Проверка AAB: `jarsigner -verify` (AAB — jar/zip, `aapt dump permissions` с ним **не работает**) + грепы `CAMERA`/`INTERNET` по **merged** `AndroidManifest.xml`.
- `pnpm/action-setup@v4` без `with: version` — версия берётся из `packageManager` (RULES 6.10).

### Secrets (4 штуки) и переменная

| Secret | Откуда |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w 0 keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | пароль keystore |
| `ANDROID_KEY_ALIAS` | алиас ключа |
| `ANDROID_KEY_PASSWORD` | пароль ключа |

| Переменная (Actions → Variables, **не** secret) | Откуда |
|---|---|
| `RUSTORE_PROJECT_ID` | RuStore Console → Push-уведомления → Проекты → «ID проекта»; в сборку уходит как `VITE_RUSTORE_PROJECT_ID` |

Настройка RuStore Push (проект в консоли, Service Token, тестовый push,
troubleshooting) — `docs/development/v1.5/RUSTORE_SETUP.md`. Keystore и его
секреты — `docs/development/v1.5/KEYSTORE_SETUP.md`.

### Порядок деплоя

1. `CAPACITOR=1 VITE_RUSTORE_PROJECT_ID=<projectId> pnpm --dir web build` → `web/dist/` с `./assets/`.
2. `cap sync android` → копирует `dist` в `android/app/src/main/assets/public`.
3. `gradlew bundleRelease` → AAB, подписанный keystore.
4. Upload в магазин приложений (RuStore Console / Play Console) → Review → Rollout.
5. Загрузить push-проект в RuStore Console и проверить доставку тестовым push.

### Что НЕ делать

- НЕ коммить `keystore` в git (`.gitignore`).
- НЕ коммить `RUSTORE_SERVICE_TOKEN` и не передавать его в мобильную сборку: это секрет бэкенда.
- НЕ хардкодить `RUSTORE_PROJECT_ID` в код — только через `vars.RUSTORE_PROJECT_ID`/env.
- НЕ собирать AAB без `CAPACITOR=1` — белый экран.
- НЕ терять keystore — нельзя обновить приложение, а push перестанет доходить до установленных сборок.

**Полные инструкции:** `docs/development/v1.5/RUSTORE_SETUP.md`,
`docs/development/v1.5/KEYSTORE_SETUP.md`.

---

## Связанные документы

- `docs/development/v1.5/DESIGN_V150_CAPACITOR.md` — применение в ai-workflow-builder.
- `docs/development/v1.5/RUSTORE_SETUP.md` — настройка RuStore Push (Project ID, Service Token, тестовый push).
- `docs/development/v1.5/KEYSTORE_SETUP.md` — keystore и секреты сборки.
- `docs/development/RULES.md` — правила проекта.
- Capacitor Docs: https://capacitorjs.com/docs
- Capacitor ML Kit Barcode: https://github.com/capawesome-team/capacitor-mlkit
- Capgo: https://capgo.app

---

**Версия:** 1.1 · **Дата:** 2026-11-09 · **Автор:** команда ai-workflow-builder
