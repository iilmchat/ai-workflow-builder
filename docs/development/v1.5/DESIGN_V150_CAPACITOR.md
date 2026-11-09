# DESIGN v1.5 — Android Mobile App (Capacitor)

**Файл:** `docs/development/v1.5/DESIGN_V150_CAPACITOR.md`
**Версия:** 1.0 (2026-11-09)
**Статус:** Draft
**Закрывает:** Новые фичи (Mobile App)
**Связанные:** `docs/development/MOBILE_CAPACITOR_NESTJS.md` (рецепт), DESIGN v1.4

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

### S4 — CI/CD + Release (план)
- GitHub Actions: build AAB, upload to Play Console (Internal testing).
- Релиз v1.5.0.

## 4. Совместимость
- Веб-версия не меняется (все новые ветки за `isNative()`).
- Бэкенд не меняется (кроме `POST /notifications/register` в S3).

## 5. План работ
- S1: 1.5 сессии (сделано)
- S2: 1 сессия (сделано)
- S3: 1.5 сессии (сделано)
- S4: 1 сессия

## 6. Что НЕ входит
- iOS (S5+).
- Tauri (отклонён, см. `MOBILE_CAPACITOR_NESTJS.md` § 1).
- Локальный backend в sidecar (отклонён).

## 7. Риски
| Риск | Митигация |
|---|---|
| AndroidManifest забыт при релизе | CI: `cap sync` + проверка `aapt dump permissions` |
| `base: './'` сломал deep links в вебе | Условный `base`, smoke `dist/index.html` в двух режимах |
| Google Play отклоняет AAB | target SDK 34+, Data safety, Privacy Policy |
