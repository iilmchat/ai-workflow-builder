# DESIGN v1.5 — Android Mobile App (Capacitor)

**Файл:** `docs/development/v1.5/DESIGN_V150_CAPACITOR.md`
**Версия:** 1.2 (2026-11-09)
**Статус:** S1–S3 — реализовано (v1.5.0); S4-A (CI/CD + release-prep) — сделано; S4-B (миграция FCM → RuStore Push) — сделано
**Закрывает:** Новые фичи (Mobile App)
**Связанные:** `docs/development/MOBILE_CAPACITOR_NESTJS.md` (рецепт), `v1.5/RUSTORE_SETUP.md`, `v1.5/KEYSTORE_SETUP.md`, DESIGN v1.4

## 1. Контекст

Клиент запросил Android-приложение с камерой (QR workflow), файлами (DOCX) и push-уведомлениями. Бэкенд (NestJS + PostgreSQL + Redis) остаётся на сервере, sidecar не нужен.

## 2. Решение

Capacitor 7 — тонкая обёртка над `web/`. Изменения в веб-коде минимальны (условный `base`, `isNative()`, хуки).

## 3. Технические срезы

### S1 — Каркас + камера/QR (сделано, v1.5.0)
- `@capacitor/core`, `@capacitor/android`, `@capacitor/camera`, `@capacitor-mlkit/barcode-scanning`.
- `web/capacitor.config.ts`, `web/android/`, условный `base`.
- `platform.ts`, `qr-payload.ts`, `useCamera.ts`, `useQrScanner.ts`.
- TopBar: кнопка QR (native only).

### S2 — Восстановление S1 поверх v1.4.0 + блокеры (сделано, v1.5.0)
- KI-646..651, AndroidManifest (CAMERA, ML Kit), `assetUrl`, `tsconfig.node.json`, рецепт обновлён.

### S3 — Файлы (DOCX) + Push (сделано, v1.5.0)
- `@capacitor/filesystem`, `@capacitor-community/file-opener`, `@capacitor/push-notifications`.
- `useFileDownload.ts` (нативный file opener для DOCX).
- `usePushNotifications.ts` + `POST /notifications/register` (NestJS) + таблица `device_tokens` (миграция).

### S4-A — CI/CD + release-prep (сделано, v1.5.0)
- `.github/workflows/release-mobile.yml`: сборка подписанного AAB по тегу `v*` и вручную — `CAPACITOR=1` → `cap sync android` → Java 21 + Android SDK 35 → `bundleRelease` с inject-подписью; проверка `jarsigner` + разрешений merged-манифеста; артефакт 30 дней; `Cleanup secrets` в `if: always()`.
- Секреты в `web/android/.gitignore` (`release.keystore`, `*.jks`, `*.keystore`; `google-services.json` удалён в S4-B).
- Инструкции: `v1.5/KEYSTORE_SETUP.md` (keystore, `bundleRelease`, магазин приложений); FCM-инструкция S4-A (`v1.5/FIREBASE_SETUP.md`) в S4-B заменена на `v1.5/RUSTORE_SETUP.md`; рецепт `MOBILE_CAPACITOR_NESTJS.md` § 18.
- Release-prep: версии `1.5.0`, `CHANGELOG` `[1.5.0]`, `README`/`docs/README`, `PROMPT_CURRENT` v12.0, гайды (RULES 2.16), DESIGN v1.5 — этот документ.

### S4-B — миграция FCM → RuStore Push (сделано, v1.5.0)
- **Причина:** RuStore — российский магазин приложений; FCM требует Google Play Services (их нет на части устройств) и тянет зависимость от Firebase, а `google-services.json` — внешний артефакт, без которого push не работал вовсе (KI-653).
- **Android:** RuStore Push SDK 6.4.0 (`ru.rustore.sdk:pushclient`, maven-репозиторий RuStore `https://nexus-external.rustore.ru/repository/maven-rustore-exposed/`; прежний `artifactory-external.vkpartner.ru/artifactory/maven` в 2026-11 отдаёт 404), нативный Capacitor-плагин `RuStorePush` (`init(projectId)` / `getToken()`); `google-services.json` и Gradle-плагин Google Services удалены; Project ID попадает в web-сборку через `VITE_RUSTORE_PROJECT_ID` (GitHub repository variable, не секрет).
- **Backend:** `src/notifications/rustore-push.service.ts` — `RuStorePushService` (`sendAsync(token, title, body, data?)`, `isConfigured()`), `POST https://vkpns.rustore.ru/v1/projects/<projectId>/messages:send`, `Authorization: Bearer <serviceToken>`; `DeviceTokensService.sendToUserAsync` — fan-out по android-токенам. Env: `RUSTORE_PROJECT_ID` (не секрет), `RUSTORE_SERVICE_TOKEN` (секрет); оба опциональны (fallback — WARN и 0 доставленных). Таблица `device_tokens` и `POST /notifications/register` не меняются.
- **CI:** `release-mobile.yml` — 4 секрета keystore (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), секрет `GOOGLE_SERVICES_JSON` удалён; `Cleanup secrets` удаляет только keystore.
- **Эксплуатация:** push работает только на устройстве с RuStore; приложение должно быть добавлено в RuStore Console и пройти модерацию; подпись установленного приложения должна совпадать с отпечатком в консоли; тестовая отправка — RuStore Console → Push notifications → Projects → «Тестовые уведомления». Нативный плагин написан вручную и требует device-smoke — KI-656.
- **Документация:** `v1.5/RUSTORE_SETUP.md` (новый, вместо `FIREBASE_SETUP.md`), `v1.5/KEYSTORE_SETUP.md` (4 секрета + переменная Project ID), рецепт `MOBILE_CAPACITOR_NESTJS.md` § 11/§ 18, `USER_GUIDE.md`/`MANUAL_TESTING_GUIDE.md`. Отчёт — `docs/development/reports/v1.5.0/S4-B-rustore-push.md`.

## 4. Совместимость
- Веб-версия не меняется (все новые ветки за `isNative()`).
- Бэкенд не меняется по контракту (кроме `POST /notifications/register` в S3 и сервиса отправки `RuStorePushService` в S4-B); таблица `device_tokens` — та же.
- Внешняя зависимость доставки — RuStore Push SDK 6.4.0 вместо FCM (FCM требует Google Play Services); `google-services.json` не нужен.

## 5. План работ
- S1: 1.5 сессии (сделано)
- S2: 1 сессия (сделано)
- S3: 1.5 сессии (сделано)
- S4: 1 сессия (S4-A — сделано: CI/CD + release-prep; S4-B — сделано: миграция FCM → RuStore Push, backend-сервис, нативный плагин, CI, документация)

## 6. Что НЕ входит
- iOS (S5+).
- Tauri (отклонён, см. `MOBILE_CAPACITOR_NESTJS.md` § 1).
- Локальный backend в sidecar (отклонён).

## 7. Риски
| Риск | Митигация |
|---|---|
| AndroidManifest забыт при релизе | CI: `cap sync` + проверка разрешений merged-манифеста (CAMERA/INTERNET/READ_MEDIA_IMAGES) в `release-mobile.yml` |
| AAB собран без подписи | CI: `jarsigner -verify` → job падает, если inject-подпись не применилась |
| `base: './'` сломал deep links в вебе | Условный `base`, smoke `dist/index.html` в двух режимах |
| FCM требует Google Play Services (нет на части устройств) | S4-B: доставка переведена на RuStore Push SDK 6.4.0 — RuStore это российский магазин, Google Play Services не нужны |
| Push не доходит: подпись установленного приложения ≠ отпечаток в RuStore Console | Создать проект push под каждый тип сборки (debug/release) с её отпечатком SHA-256; troubleshooting — `v1.5/RUSTORE_SETUP.md` |
| Нативный плагин RuStore Push написан вручную (JS ↔ Java), не проверен unit-тестами | KI-656: device-smoke на устройстве с RuStore + тестовый push из RuStore Console; повторить после обновлений SDK/плагина |
| Магазин приложений отклоняет AAB | target SDK 34+, Data safety, Privacy Policy; загрузка в RuStore Console с той же подписью |
| `RUSTORE_SERVICE_TOKEN` попадёт в логи/репозиторий | Секрет — только в `.env`/secret manager; в логи не пишется (RULES 5.1, 5.3), `RuStorePushService` шлёт его только в заголовке |
