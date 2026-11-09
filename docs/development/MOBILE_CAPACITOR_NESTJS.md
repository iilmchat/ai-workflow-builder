# Capacitor для NestJS + React (Vite) — переиспользуемая инструкция

**Версия:** 1.1 (2026-11-09)
**Статус:** Production-ready (с учетом RuStore Push)
**Применимо к:** любой проект с NestJS-бэкендом и React (Vite) фронтендом, где нужен Android-клиент.
**Связанные:** `docs/development/v1.5/RUSTORE_SETUP.md` (пример применения в ai-workflow-builder).

---

## TL;DR

**Capacitor** — тонкая обёртка над React-приложением. Даёт нативное Android/iOS приложение с доступом к камере, файлам, push через готовые плагины.

**Не меняет:** бэкенд (NestJS + PostgreSQL + Redis остаются на сервере).
**Меняет:** `web/vite.config.ts` (`base: './'`), добавляет папку `web/android/`, ~500 строк кода на фронте.

**Зачем:** публикация в RuStore / Google Play, доступ к нативным API.

---

## 1. Почему Capacitor, а не Tauri Mobile или PWA

| Критерий | Capacitor | Tauri 2 Mobile | PWA |
|---|---|---|---|
| Зрелость | Production, enterprise | Моложе, есть CVE | Полная |
| Изменения в коде | Минимальные | Нужен Rust | Нулевые |
| Нативные API | Готовые плагины | Через Rust | Ограничено |
| Магазины (RuStore / GP) | Да (`.aab`) | Да | Нет |

**Вывод:** для NestJS + React проекта с удалённым бэкендом — Capacitor.

---

## 2. Требования

- Node.js 22+, pnpm 9+
- **JDK 21** (Temurin) — обязательно, Gradle не соберет проект на JDK 8/11.
- Android Studio (локально) **или** только JDK 21 + Android SDK (для CI).
- Windows 10+, macOS 12+, Ubuntu 20.04+

---

## 3. Структура проекта (монорепо)

    project/
    ├── src/                 # NestJS backend (не трогаем)
    ├── web/                 # React + Vite frontend
    │   ├── src/
    │   ├── dist/            # web build (используется Capacitor)
    │   ├── android/         # ← создаётся `cap add android`
    │   ├── capacitor.config.ts
    │   └── package.json
    ├── package.json         # корневой workspace
    └── .github/workflows/
        └── release-mobile.yml

**Ключевое:** `capacitor.config.ts` живёт в `web/`, а `webDir: 'dist'` — относительно `web/`.

---

## 4. Шаг 1. Настройка Vite

В `web/vite.config.ts`:

    export default defineConfig({
      // './' только для Capacitor-сборки, '/' для веб/SPA
      base: process.env.CAPACITOR === '1' ? './' : '/',
      build: { outDir: 'dist' },
    });

Сборка для Android: `CAPACITOR=1 pnpm --dir web build` (в PowerShell: `$env:CAPACITOR='1'; ...`).

---

## 5. Шаг 2. Установка Capacitor

В `web/`:

    pnpm add @capacitor/core @capacitor/android
    pnpm add -D @capacitor/cli
    pnpm exec cap init "My App" com.mycompany.myapp --web-dir dist
    pnpm exec cap add android

---

## 6. Шаг 3. capacitor.config.ts

    import type { CapacitorConfig } from '@capacitor/cli';

    const config: CapacitorConfig = {
      appId: 'com.mycompany.myapp',
      appName: 'My App',
      webDir: 'dist',
      server: {
        androidScheme: 'https',
        cleartext: false,
      },
      android: {
        allowMixedContent: false,
      },
    };
    export default config;

---

## 7. Шаг 4. Разрешения Android

В `web/android/app/src/main/AndroidManifest.xml` добавь **только** нужные:

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

---

## 8. Шаг 5. Камера + QR (ML Kit)

    pnpm add @capacitor/camera @capacitor-mlkit/barcode-scanning

**Хук камеры:**

    import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
    
    export async function capturePhoto(): Promise<string | null> {
      if (!Capacitor.isNativePlatform()) return null;
      try {
        const photo = await Camera.getPhoto({
          quality: 90, resultType: CameraResultType.Uri, source: CameraSource.Camera,
        });
        return photo.webPath ?? null;
      } catch { return null; }
    }

**QR-сканер:** (В версии 7.5.0 используется `supported` и отдельный метод для Play Services).

    import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
    
    export async function scanQr(): Promise<string | null> {
      if (!Capacitor.isNativePlatform()) return null;
      const { supported } = await BarcodeScanner.isSupported();
      if (!supported) return null;
      
      if (Capacitor.getPlatform() === 'android') {
        const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
        if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule();
      }
      
      const perm = await BarcodeScanner.requestPermissions();
      if (perm.camera !== 'granted') return null;
      
      const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      return barcodes[0]?.rawValue ?? null;
    }

---

## 9. Шаг 6. Файлы (скачать DOCX/PDF)

    pnpm add @capacitor/filesystem @capacitor-community/file-opener

    import { Filesystem, Directory } from '@capacitor/filesystem';
    import { FileOpener } from '@capacitor-community/file-opener';

    export async function downloadAndOpenFileAsync(url: string, fileName: string, mimeType: string) {
      if (!Capacitor.isNativePlatform()) { /* веб-fallback <a download> */ return; }
      
      const response = await fetch(url);
      const blob = await response.blob();
      const base64 = await blobToBase64(blob); // Обычный FileReader
      
      const result = await Filesystem.writeFile({
        path: fileName, data: base64, directory: Directory.Documents, recursive: true,
      });
      await FileOpener.open({ filePath: result.uri, contentType: mimeType });
    }

---

## 10. Шаг 7. Push-уведомления (RuStore для РФ)

**Для РФ используем RuStore Push SDK (FCM заблокирован).**
Готового плагина нет, пишем нативный мост.

1. **Получи ключи:** Зарегистрируй приложение в RuStore Console -> Инструменты -> Push-уведомления. Получи `Project ID` и `Service Token`.
2. **Maven:** В `web/android/build.gradle` добавь репозитории `maven-rustore-exposed` и `maven-tracer-public-exposed`.
3. **Нативный плагин (Java/Kotlin):**
   - Добавь зависимость `ru.rustore.sdk:pushclient:6.4.0`.
   - Напиши класс `RuStorePushPlugin` (обертка над `RuStorePushClient.init` и `getToken`).
   - Напиши `RuStorePushMessagingService` (обработка прихода пуша).
4. **Фронтенд:** Напиши обертку в TS (`web/src/lib/rustore-push.ts`), которая вызывает твой Java-плагин через `registerPlugin('RuStorePush')`.
5. **Бэкенд:** В NestJS добавь эндпоинт `POST /notifications/register` и сервис отправки (`POST https://vkpns.rustore.ru/v1/projects/{id}/messages:send` с Bearer токеном).

---

## 11. Шаг 8. CI/CD (GitHub Actions)

Файл `.github/workflows/release-mobile.yml`:
- Обязательно используй Java 21.
- Выполняй сборку с `CAPACITOR=1`.
- Делай `cap sync android` ПОСЛЕ сборки.
- **Секреты** (должны быть заданы в GitHub):
  - `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
  - `RUSTORE_PROJECT_ID`, `RUSTORE_SERVICE_TOKEN` (если используешь RuStore).

---

## 12. Шаг 9. Публикация в RuStore

1. Загрузи AAB в RuStore Console.
2. Заполни карточку (иконки, скриншоты, описание, политика конфиденциальности).
3. Отправь на модерацию или запусти Альфа-тестирование (чтобы протестировать push без долгого ревью).

---

## 13. Troubleshooting

| Проблема | Решение |
|---|---|
| Белый экран в APK | `base: './'` в `vite.config.ts` |
| `keytool not found` | Установи JDK 21 и добавь в PATH |
| Gradle не видит Java | Установи `JAVA_HOME` на JDK 21 |
| Maven RuStore отдает 404 | Используй `maven-rustore-exposed`, а не `artifactory-external` из старых доков |
| Push не приходит | Проверь, что совпадает `package name` в Console и в `capacitor.config.ts` |

---

## 14. Что НЕ делать

- **НЕ** упаковывай NestJS + PostgreSQL + Redis в sidecar. Бэкенд остаётся на сервере.
- **НЕ** коммить `release.keystore` и `google-services.json` в git.
- **НЕ** используй `base: '/'` в Vite — сломается нативное приложение.
- **НЕ** используй FCM для российского рынка — потратишь время на VPN и Google MFA.
