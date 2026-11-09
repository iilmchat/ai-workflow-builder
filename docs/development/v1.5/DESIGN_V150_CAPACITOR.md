# DESIGN v1.5 — Android Mobile App (Capacitor)

**Файл:** `docs/development/v1.5/DESIGN_V150_CAPACITOR.md`
**Версия:** 1.1 (2026-11-09)
**Статус:** S1–S3 — реализовано (v1.5.0); S4-A (CI/CD + release-prep) — сделано; S4-B (Firebase/Keystore/Play Console) — ожидает ручных шагов пользователя
**Закрывает:** Новые фичи (Mobile App)
**Связанные:** `docs/development/MOBILE_CAPACITOR_NESTJS.md` (рецепт), `v1.5/FIREBASE_SETUP.md`, `v1.5/KEYSTORE_SETUP.md`, DESIGN v1.4

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
- Секреты в `web/android/.gitignore` (`google-services.json`, `release.keystore`, `*.jks`, `*.keystore`).
- Инструкции: `v1.5/FIREBASE_SETUP.md` (FCM, KI-653), `v1.5/KEYSTORE_SETUP.md` (keystore, 5 Secrets, `bundleRelease`, Play Console); рецепт `MOBILE_CAPACITOR_NESTJS.md` § 18.
- Release-prep: версии `1.5.0`, `CHANGELOG` `[1.5.0]`, `README`/`docs/README`, `PROMPT_CURRENT` v12.0, гайды (RULES 2.16), DESIGN v1.5 — этот документ.

### S4-B — Firebase + Keystore + Play Console (ожидает ручных шагов пользователя)
- Firebase-проект + `google-services.json` в `web/android/app/` (без него `register()` → `registrationError`, KI-653).
- Keystore (PKCS12) + 5 GitHub Secrets; сборка AAB по тегу `v1.5.0`.
- Публикация в Google Play Console → Internal testing (Data safety, Privacy Policy); иконка push-уведомления (KI-654).
- Шаги описаны в `v1.5/FIREBASE_SETUP.md` и `v1.5/KEYSTORE_SETUP.md`; в репозитории они не выполняются (секреты и ручные действия).

## 4. Совместимость
- Веб-версия не меняется (все новые ветки за `isNative()`).
- Бэкенд не меняется (кроме `POST /notifications/register` в S3).

## 5. План работ
- S1: 1.5 сессии (сделано)
- S2: 1 сессия (сделано)
- S3: 1.5 сессии (сделано)
- S4: 1 сессия (S4-A — сделано; S4-B — ручные шаги пользователя: Firebase, keystore, Play Console)

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
| Google Play отклоняет AAB | target SDK 34+, Data safety, Privacy Policy |
