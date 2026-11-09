# Capacitor для NestJS + React (Vite) — переиспользуемая инструкция

**Версия:** 1.0 (2026-11-09)
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

**Правило:** запрашивай только те права, которые реально используешь. Push на Android не требует permission в манифесте (FCM сам).

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

## 11. Шаг 8. Push notifications

**Установка:**

    pnpm add @capacitor/push-notifications
    pnpm exec cap sync android

**Backend (NestJS) — эндпоинт для токена:**

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

**Frontend — хук:**

    import { PushNotifications } from '@capacitor/push-notifications';
    import { isNative } from '@/lib/platform';

    export async function initPushNotifications(
      sendTokenToBackend: (token: string) => Promise<void>,
    ): Promise<void> {
      if (!isNative()) return;

      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.warn('[push] разрешение отклонено');
        return;
      }

      await PushNotifications.register();

      PushNotifications.addListener('registration', async (t) => {
        await sendTokenToBackend(t.value);
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('[push] ошибка регистрации', err);
      });

      PushNotifications.addListener('pushNotificationReceived', (n) => {
        console.log('[push] получено', n.title, n.body);
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        // клик по уведомлению — здесь можно перейти на экран
      });
    }

**Backend — отправка через FCM:**

    pnpm add firebase-admin

Используй `firebase-admin/messaging` для отправки. Токен храни в `device_tokens` (user_id, token, platform, created_at).

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
| Push-токен не приходит | Проверь `google-services.json` в `web/android/app/` |
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

## Связанные документы

- `docs/development/v1.5/DESIGN_V150_CAPACITOR.md` — применение в ai-workflow-builder.
- `docs/development/RULES.md` — правила проекта.
- Capacitor Docs: https://capacitorjs.com/docs
- Capacitor ML Kit Barcode: https://github.com/capawesome-team/capacitor-mlkit
- Capgo: https://capgo.app

---

**Версия:** 1.0 · **Дата:** 2026-11-09 · **Автор:** команда ai-workflow-builder
