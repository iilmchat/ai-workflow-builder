---
title: "S1: Capacitor — каркас + камера/QR"
date: 2026-11-09
version: v1.5.0
steps: [S1]
status: accepted
related_ki: [KI-646, KI-647, KI-648, KI-649, KI-650, KI-651]
related_adr: []
---

# Отчёт S1: Capacitor — каркас + камера/QR (v1.5.0)

**Источник:** `docs/development/MOBILE_CAPACITOR_NESTJS.md` v1.0 (untracked на
HEAD) + постановка v1.5.0 S1. DESIGN-документ
`docs/development/v1.5/DESIGN_V150_CAPACITOR.md`, на который ссылается
постановка, в репозитории отсутствует (см. § 5.1).

**Ветка:** `main`, HEAD `563f6be` («docs: close KI-634»). Сессия — **без
коммитов**: все изменения оставлены в рабочем дереве, `git add`/`git commit`
не выполнялись.

## 1. Файлы (+/−)

### Изменённые (tracked)

| Файл | +/− | Что именно |
|---|---:|---|
| `web/vite.config.ts` | +14/−4 | условный `base: process.env.CAPACITOR === '1' ? './' : '/'` + комментарий про Docker/SPA и Capacitor |
| `web/src/components/TopBar.tsx` | +90/−0 | импорты `isNative`/`scanQr`/`parseQrPayload`, состояние `isScanning`, обработчик `handleScanQr`, кнопка `data-topbar-scan-qr` (только native) |
| `web/src/components/TopBar.spec.tsx` | +157/−1 | моки `@/lib/platform` и `@/hooks/useQrScanner`, describe «QR-сканер» из 6 тестов |
| `web/src/i18n/ru.json` | +3/−0 | `topbar.scan_qr`, `topbar.scan_qr_error`, `topbar.scan_qr_ok` |
| `web/src/i18n/en.json` | +3/−0 | те же три ключа |
| `web/.gitignore` | +4/−0 | `# TODO(v1.5.0 S3)…`, `android/`, `ios/` |
| `web/package.json` | +5/−0 | в `dependencies`: `@capacitor/core`, `@capacitor/android`, `@capacitor/camera`, `@capacitor-mlkit/barcode-scanning`; в `devDependencies`: `@capacitor/cli` |
| `web/pnpm-lock.yaml` | +754/−0 | только через `pnpm add` (ручных правок нет) |
| `docs/CHANGELOG.md` | +19/−0 | запись в `[Unreleased]` (RULES 2.1/2.18) |
| `docs/KNOWN_ISSUES.md` | +98/−15 | раздел «v1.5.0 — Capacitor: каркас + камера/QR (S1)» (KI-646..651), пересчитанная сводка (RULES 3.20) |
| `docs/development/reports/README.md` | +1/−0 | строка отчёта v1.5.0 S1 |

### Новые (untracked)

| Файл | Строк | Назначение |
|---|---:|---|
| `web/capacitor.config.ts` | 30 | appId/appName/webDir, `androidScheme: https`, `cleartext: false`, `allowMixedContent: false` |
| `web/src/lib/platform.ts` | 36 | `isNative`/`isAndroid`/`isIOS`/`isWeb` поверх `@capacitor/core` |
| `web/src/lib/platform.spec.ts` | 66 | 4 теста (мок платформы + проверка «настоящий Capacitor в jsdom = web») |
| `web/src/lib/qr-payload.ts` | 89 | `parseQrPayload`: uuid → workflow, абсолютная/относительная share-ссылка → путь, остальное → `null` |
| `web/src/lib/qr-payload.spec.ts` | 56 | 7 тестов разбора (uuid, регистр, пробелы, query, хвостовой слэш, чужой URL, пустая строка) |
| `web/src/hooks/useCamera.ts` | 37 | `capturePhoto()`: `isNative` → `Camera.getPhoto` (quality 90, `CameraResultType.Uri`, `CameraSource.Camera`) |
| `web/src/hooks/useCamera.spec.ts` | 81 | 4 теста (браузер, успех, пустой `webPath`, отмена) |
| `web/src/hooks/useQrScanner.ts` | 73 | `scanQr()`: native → `isSupported().supported` → Android-модуль Google Barcode Scanner → `requestPermissions` → `scan({ formats: [QrCode] })` |
| `web/src/hooks/useQrScanner.spec.ts` | 133 | 8 тестов (браузер, успех, нет камеры, нет модуля Play Services, iOS без Android-проверки, нет разрешения, пустой результат, ошибка `scan`) |
| `docs/development/reports/v1.5.0/S1-capacitor.md` | — | этот отчёт |

Итого новый код: **601 строка** в 9 файлах (+ отчёт). Изменённые tracked-файлы:
**+394/−20** без `pnpm-lock.yaml`; с lock-файлом — **+1148/−20**.

### `web/android/` — создан, но в git не входит

`pnpm exec cap add android` создал `web/android/` — **105 файлов, 1 356 411
байт (≈1.34 MB)**: `app/`, `capacitor-cordova-android-plugins/`, `gradle/`,
`.gitignore`, `build.gradle`, `capacitor.settings.gradle`, `gradle.properties`,
`gradlew`, `gradlew.bat`, `settings.gradle`, `variables.gradle`.

`web/.gitignore:23` (`android/`) исключает каталог целиком:

```
$ git check-ignore -v web/android web/android/app
web/.gitignore:23:android/   web/android
web/.gitignore:23:android/   web/android/app
```

`git status --short` после `cap add`/`cap sync` **не** показывает
`web/android/` (проверено ниже, § 4.4). Внутри лежит копия web-сборки
(`android/app/src/main/assets/public`, актуальный `dist` с `base: './'`) и
`android/app/src/main/assets/capacitor.config.json`.

### Что НЕ трогал (было грязным до сессии)

| Файл | Состояние |
|---|---|
| `RELEASE_NOTES.md` | `M` (+634/−8) — правки не мои, не изменял |
| `docs/development/MOBILE_CAPACITOR_NESTJS.md` | untracked, 519 строк — не изменял (неточность рецепта заведена как KI-648) |

## 2. Build / test

| Гейт | Результат |
|---|---|
| `pnpm build` (backend) | **0 errors, 0 warnings** (`nest build`, без вывода) |
| `pnpm typecheck` | **0 ошибок** |
| `pnpm test` (backend) | **124 passed + 4 skipped** файлов; **1913 passed + 24 skipped** тестов (1937) |
| `pnpm --dir web build` (без env) | `tsc -b` — 0 ошибок; `vite build` — **успешно, 298–318 ms**, в `dist/index.html` пути `/assets/...` |
| `CAPACITOR=1 pnpm --dir web build` | `tsc -b` — 0 ошибок; `vite build` — **успешно, 311 ms**, пути `./assets/...` |
| `pnpm --dir web test` | **58 файлов, 529 тестов — все зелёные** |

Baseline до изменений (для сравнения): backend `1913 passed | 24 skipped`
(1937), web **500** тестов, оба build'а зелёные. Прирост web-тестов: **+29**
(platform 4, camera 4, QR-хук 8, qr-payload 7, TopBar 6). Backend не
изменился (ни одного файла `src/**` не правилось) — цифры совпадают.

Веб-сборка: предупреждений `chunk > 500 kB` нет. Наибольшие чанки: `react`
218.76 kB, `index` 198.24 kB, `reactflow` 178.16 kB, `vendor` 144.94 kB
(было 133.23 kB — рост из-за `@capacitor/core`, KI-651).

## 3. Диагностика

Стек: Node **24.21.0**, pnpm **12.11.2**, TS **6.0.3**, Vite **8.3.4**
(rolldown), Tailwind **4.3.3**, `@tailwindcss/vite` 4.3.3. Capacitor:
`core`/`cli`/`android` **7.6.10**, `@capacitor/camera` **7.0.5**,
`@capacitor-mlkit/barcode-scanning` **7.5.0**.

1. **Capacitor 7 + Vite 8 (rolldown) + Tailwind 4 — конфликтов нет.**
   `base` влияет только на HTML/JS-ссылки: CSS-ассеты в обоих режимах
   получили одинаковые имена (`index-DJG_t--9.css`,
   `reactflow-DLioOiRN.css`), хэши JS-чанков различаются, потому что Vite
   инлайнит `base` в рантайм-хелперы динамических импортов. Tailwind-плагин
   от `base` не зависит, CSS-чанки не сломались.
2. **`base: './'` + `tsc -b`.** `process.env` в `vite.config.ts` типизирован
   (`web/tsconfig.node.json` → `"types": ["node"]`), поэтому условный `base`
   не потребовал ни `@types/node` (уже есть), ни `loadEnv`. `CAPACITOR=1`
   читается из окружения процесса, а не из `.env` — для CI и PowerShell
   (`$env:CAPACITOR='1'`) одинаково.
3. **`cap init`** отработал неинтерактивно: создал
   `web/capacitor.config.ts` (209 байт) ровно из трёх полей
   (`appId`, `appName`, `webDir`) и не добавил ни одной зависимости. Секции
   `server`/`android` пришлось дописать вручную (§ 3 постановки). Файл
   `capacitor.config.json` не создавался (TS-вариант), `android/app/src/main/
   assets/capacitor.config.json` появился только на `cap sync`.
4. **`cap add android`** — 92 ms на копирование шаблона + 37 ms `copy` +
   92 ms `update`; нашёл ровно два Android-плагина (`barcode-scanning`,
   `camera`), **gradle не запускал** и Android SDK/JDK не требовал
   (`JAVA_HOME=D:\Dev\jdk-21…` не использовался; на PATH при этом Java 11 —
   для S3 это важно, см. KI-649). `cap sync android` после сборки с
   `CAPACITOR=1` скопировал относительную сборку в
   `android/app/src/main/assets/public`.
5. **`base` — проблем не было**, оба режима проверены по факту (§ 4.2–4.3).
   Но обнаружились две ловушки, которых спецификация не покрывала:
   - runtime-строки `'/logo.svg'` в JSX Vite **не** переписывает → в
     Capacitor логотип 404 (KI-647);
   - `@capacitor-mlkit/barcode-scanning@7.5.0` **не имеет** `{ available }` у
     `isSupported()`, как в рецепте/постановке: возвращается
     `{ supported: boolean }`, а «Play Services» — отдельный Android-only
     `isGoogleBarcodeScannerModuleAvailable()` → `{ available }`. Код из
     постановки не компилируется (`TS2339`), S1 реализован по фактическому
     API (KI-648).
6. **Версии:** `pnpm add @capacitor/core` без мажора поставил бы **8.6.0**
   (это и показывает `cap doctor` как latest, плагины — 8.2.6/8.2.2). Все
   пакеты установлены с явным `@7`, чтобы соответствовать «Capacitor 7»
   (KI-650).
7. **`pnpm peers check`** — единственная жалоба `react-i18next@15.7.4`
   хочет `typescript ^5`, установлен 6.0.3. Это **предсуществующее**
   состояние, к Capacitor не относится, ничего не менял.
8. **Вес бандла.** `@capacitor/core` попал в стартовый граф `TopBar` через
   `platform.ts`: vendor-чанк 133.23 kB → 144.94 kB (gzip 40.35 → 44.56).
   В браузере Capacitor не нужен — KI-651.
9. **Проверки манифеста нет ни у кого.** `cap doctor` проверяет только
   версии зависимостей и наличие платформы («Android looking great!»), но не
   `AndroidManifest.xml`; permission'ы плагинов при этом не подмешиваются
   автоматически (у `@capacitor/camera` в манифесте только `<queries>`, у
   ML Kit — пустой `<manifest>`). Отсюда KI-646.

## 4. Smoke

### 4.1. `cap doctor`

```
   Capacitor Doctor

Latest Dependencies:

  @capacitor/cli: 8.6.0
  @capacitor/core: 8.6.0
  @capacitor/android: 8.6.0
  @capacitor/ios: 8.6.0

Installed Dependencies:

  @capacitor/ios: not installed
  @capacitor/android: 7.6.10
  @capacitor/cli: 7.6.10
  @capacitor/core: 7.6.10

[success] Android looking great! 👌
```

`@capacitor/ios: not installed` — ожидаемо: iOS-платформа на Windows не
добавляется (`cap add ios` требует macOS/Xcode), `web/ios/` в этой сессии не
создавался, но `ios/` уже в `web/.gitignore` под S3.

### 4.2. `cap sync android`

```
√ Copying web assets from dist to android\app\src\main\assets\public in 21.77ms
√ Creating capacitor.config.json in android\app\src\main\assets in 922.80μs
√ copy android in 43.53ms
√ Updating Android plugins in 4.47ms
[info] Found 2 Capacitor plugins for android:
       @capacitor-mlkit/barcode-scanning@7.5.0
       @capacitor/camera@7.0.5
√ update android in 64.60ms
[info] Sync finished in 0.142s
```

### 4.3. `dist/index.html` — первые 20 строк в двух режимах

Оба файла сохранены в `.smoke/v150-s1/` (каталог `.smoke/` в `.gitignore`).
Первые 20 строк **идентичны, кроме favicon**, потому что теги скриптов Vite
вставляет ниже (сразу за инлайновым скриптом темы).

**`pnpm --dir web build` (без env):**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- Favicon — фирменный логотип (v0.10 S2). Файлы лежат в `web/public/`:
         `logo.svg` для светлой темы, `logo-dark.svg` — для тёмной (используется
         в UI, favicon берёт светлый вариант). -->
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <title>Workflow Builder</title>
    <!--
      Тема до первого рендера (R5.2, DESIGN § 3.3): класс .dark на <html>
      ставится инлайн-скриптом, иначе страница мигает светлой темой.
      Логика совпадает с useTheme(): 'system' = как в операционной системе.
    -->
    <script>
      (() => {
        try {
          const stored = localStorage.getItem('theme');
          const isDark =
```

Ассеты (web-режим, абсолютные пути):

```html
<link rel="icon" type="image/svg+xml" href="/logo.svg" />
<script type="module" crossorigin src="/assets/index-p7rE3510.js"></script>
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-hePW80VL.js">
<link rel="modulepreload" crossorigin href="/assets/react-BvB9BS1T.js">
<link rel="modulepreload" crossorigin href="/assets/vendor-jECPiCQK.js">
<link rel="modulepreload" crossorigin href="/assets/reactflow-B8tvhT2S.js">
<link rel="modulepreload" crossorigin href="/assets/i18n-D65QJ3yv.js">
<link rel="stylesheet" crossorigin href="/assets/reactflow-DLioOiRN.css">
<link rel="stylesheet" crossorigin href="/assets/index-DJG_t--9.css">
```

**`$env:CAPACITOR='1'; pnpm --dir web build`:**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- Favicon — фирменный логотип (v0.10 S2). Файлы лежат в `web/public/`:
         `logo.svg` для светлой темы, `logo-dark.svg` — для тёмной (используется
         в UI, favicon берёт светлый вариант). -->
    <link rel="icon" type="image/svg+xml" href="./logo.svg" />
    <title>Workflow Builder</title>
    <!--
      Тема до первого рендера (R5.2, DESIGN § 3.3): класс .dark на <html>
      ставится инлайн-скриптом, иначе страница мигает светлой темой.
      Логика совпадает с useTheme(): 'system' = как в операционной системе.
    -->
    <script>
      (() => {
        try {
          const stored = localStorage.getItem('theme');
          const isDark =
```

Ассеты (Capacitor-режим, относительные пути):

```html
<link rel="icon" type="image/svg+xml" href="./logo.svg" />
<script type="module" crossorigin src="./assets/index-CIxBQrJh.js"></script>
<link rel="modulepreload" crossorigin href="./assets/rolldown-runtime-hePW80VL.js">
<link rel="modulepreload" crossorigin href="./assets/react-BvB9BS1T.js">
<link rel="modulepreload" crossorigin href="./assets/vendor-BdqJaaWg.js">
<link rel="modulepreload" crossorigin href="./assets/reactflow-B8tvhT2S.js">
<link rel="modulepreload" crossorigin href="./assets/i18n-D65QJ3yv.js">
<link rel="stylesheet" crossorigin href="./assets/reactflow-DLioOiRN.css">
<link rel="stylesheet" crossorigin href="./assets/index-DJG_t--9.css">
```

Итог: `base` работает ровно как задумано — `/` без env (веб/Docker/deep
links), `./` с `CAPACITOR=1`.

### 4.4. `git status --short` (android не протекает)

```
 M RELEASE_NOTES.md
 M docs/CHANGELOG.md
 M docs/KNOWN_ISSUES.md
 M docs/development/reports/README.md
 M web/.gitignore
 M web/package.json
 M web/pnpm-lock.yaml
 M web/src/components/TopBar.spec.tsx
 M web/src/components/TopBar.tsx
 M web/src/i18n/en.json
 M web/src/i18n/ru.json
 M web/vite.config.ts
?? docs/development/MOBILE_CAPACITOR_NESTJS.md
?? docs/development/reports/v1.5.0/
?? web/capacitor.config.ts
?? web/src/hooks/useCamera.spec.ts
?? web/src/hooks/useCamera.ts
?? web/src/hooks/useQrScanner.spec.ts
?? web/src/hooks/useQrScanner.ts
?? web/src/lib/platform.spec.ts
?? web/src/lib/platform.ts
?? web/src/lib/qr-payload.spec.ts
?? web/src/lib/qr-payload.ts
```

`web/android/` в выводе отсутствует — исключён `web/.gitignore`. Строки
`M RELEASE_NOTES.md` и `?? docs/development/MOBILE_CAPACITOR_NESTJS.md` —
предсуществующие (не мои), не трогал. `git add`/`git add -A` не
использовались, индекс пуст.

### 4.5. Что смоук-тестом **не** проверено (важно)

Нативной сборки и запуска не было: нет `./gradlew`/`cap build`, нет
эмулятора/устройства. Поэтому «QR открывает workflow» проверено только
unit-тестами с моками плагинов, а не на телефоне. Это ограничение S1
(KI-646/KI-649): после `cap add` манифест не содержит `CAMERA`, без чего
реальный QR-сканер вернёт `denied` — на устройстве кнопка пока нерабочая.

## 5. Что не так

1. **Постановка ссылается не на тот репозиторий и не на тот HEAD.** Указано
   `D:\Projects\AI\workflow-builder`, HEAD «после v1.4.0». Фактически работа
   велась в `C:\Projects\AI\ai-workflow-builder`; `HEAD = 563f6be` —
   **v1.3.0 release prep**, тега `v1.4.0` нет, `docs/development/v1.4`/`v1.5`
   отсутствуют. `docs/development/v1.5/DESIGN_V150_CAPACITOR.md`, на который
   ссылается § «Источник», в репозитории нет. Единственный доступный источник
   — untracked-рецепт `docs/development/MOBILE_CAPACITOR_NESTJS.md` v1.0
   (+ текст постановки). Работы выполнены по постановке; расхождение
   зафиксировано здесь, а не «додумано».
2. **Рабочее дерево было грязным до сессии:** `RELEASE_NOTES.md` (`M`,
   +634/−8 — файл переписан на v1.3.0-контент) и untracked
   `docs/development/MOBILE_CAPACITOR_NESTJS.md`. Ничего из этого не менял,
   в отчёт попал только факт.
3. **Код из постановки для QR-сканера не компилируется.** `isSupported()`
   возвращает `{ supported }`, а не `{ available }` (TS2339). Кроме того,
   «нет Play Services» через `isSupported()` проверить нельзя — это проверка
   камеры; для Play Services в 7.5.0 есть
   `isGoogleBarcodeScannerModuleAvailable()` (Android-only). Реализовано по
   факту: `supported` + Android-модуль. Отступление от буквы постановки
   осознанное, иначе build не собирается (KI-648).
4. **AndroidManifest не содержит `CAMERA` и ML Kit meta-data.** README ML Kit
   требует `<uses-permission android:name="android.permission.CAMERA" />` и
   `<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES"
   android:value="barcode_ui" />`. По правилу S1 манифест руками не правим →
   заведён KI-646 (High). `@capacitor/camera`, наоборот, разрешений не
   требует — фото пойдёт через внешнюю camera-activity и уже
   сгенерированный `FileProvider`.
5. **Абсолютные `src="/logo.svg"` в JSX не работают с `base: './'`.**
   Найдено в `TopBar.tsx` и `LoginPage.tsx`; favicon в `index.html` Vite
   переписал сам. Не чинил (вне задач S1), заведён KI-647 (High для
   нативного релиза).
6. **`cap add` копирует в `android/…/assets/public` текущий `dist`.** Порядок
   обязателен: сначала `CAPACITOR=1 pnpm --dir web build`, потом
   `cap sync android`. Если сделать наоборот, в APK уедет веб-сборка с
   `base: '/'` и белый экран. В постановке этого шага нет — записал в
   отчёт; в S3 стоит закрепить в CI-скрипте (`build` с env → `cap sync`).
7. **`capacitor.config.ts` не проверяется ни `tsc -b`, ни `pnpm build`.**
   Файл лежит в корне `web/` и не входит в `include` ни `tsconfig.app.json`
   (`["src"]`), ни `tsconfig.node.json` (`["vite.config.ts"]`). Опечатка в
   конфиге вылезет только на `cap sync`/`cap build`. Отдельного KI не заводил
   (низкий риск, конфиг прогнан `cap sync`/`cap doctor`), но в S3 стоит
   добавить его в `tsconfig.node.json`.
8. **Нет device-smoke.** `cap doctor` зелёный, но он не проверяет манифест и
   не запускает приложение: камера/QR на реальном Android не проверены
   (KI-649). `cap run`/gradle в этой сессии не запускались — JDK на PATH 11,
   рабочий `JAVA_HOME` 21, но Android SDK-сборка не входила в S1.
9. **`capturePhoto` пока никем не используется.** По S1 камера — задел под S2
   (DOCX/файлы), поэтому в UI нет кнопки фото; хук покрыт тестами, но в
   бандл он попадает (импортируется только тестами? нет — сейчас не
   импортируется нигде, tree-shaking его вырезает; проверено: строк
   `capturePhoto` в `dist/assets/*.js` нет). Это ожидаемо, но при ревью стоит
   знать, что «камера» в S1 — только инфраструктура + тесты.
10. **Сводка KI в реестре была рассинхронизирована на 1 запись.** При
    пересчёте (RULES 3.20) оказалось 270 Fixed / 49 Documented до добавления
    S1, а таблица от 2026-11-06 говорила 269/50. Сводка пересчитана по grep,
    прежние цифры заменены фактическими (627 записей после KI-646..651).
11. **`pnpm peers check` exit code 1** из-за предсуществующего конфликта
    `react-i18next` ↔ TypeScript 6. Не связано с S1, не исправлял; если CI
    когда-нибудь начнёт гонять `peers check`, job упадёт.
12. **CI не прогонялся** (нет коммита по условию): job `web` использует
    `pnpm install --frozen-lockfile`, поэтому коммит обязан включать
    `web/pnpm-lock.yaml` (+754 строки) — иначе CI упадёт. Lock-файл обновлён
    только через `pnpm add`.
13. **`npm`-рецепт рекомендует `base: './'` безусловно** (и в
    `MOBILE_CAPACITOR_NESTJS.md` § 4, и в troubleshooting). Для этого
    проекта так нельзя: SPA-fallback/deep links `/workflow/share/:token` и
    `/login` живут на абсолютных путях; условный `base` — обязательная
    адаптация, а не украшательство.

## 6. Новые KI

| KI | Приоритет | Статус | Суть | Файлы |
|---|---|---|---|---|
| **KI-646** | 🟠 High | Documented | В сгенерированном манифесте нет `CAMERA` и ML Kit meta-data → QR на устройстве вернёт `denied`; править манифест в S1 запрещено, переносится в S3 | `web/android/app/src/main/AndroidManifest.xml`, `web/src/hooks/useQrScanner.ts`, `docs/development/MOBILE_CAPACITOR_NESTJS.md` § 7 |
| **KI-647** | 🟠 High | Documented | `src="/logo.svg"` в JSX не переписывается Vite → при `base: './'` логотип 404 в нативе | `web/src/components/TopBar.tsx:575`, `web/src/components/auth/LoginPage.tsx:131` |
| **KI-648** | 🟡 Medium | Documented | Рецепт § 9 использует устаревший API (`{available}` вместо `{supported}`; Play Services — отдельный Android-only метод) | `docs/development/MOBILE_CAPACITOR_NESTJS.md` § 9, `web/src/hooks/useQrScanner.ts` |
| **KI-649** | 🟡 Medium | Documented | `web/android/` вне git и CI до S3 → регрессии манифеста/граdle не ловятся; S1-проверка ограничена `cap doctor` | `web/.gitignore`, `.github/workflows/ci.yml` |
| **KI-650** | 🟢 Low | Deferred | latest Capacitor — 8.6.0 (плагины 8.2.x), проект на 7.6.10 по DESIGN; апгрейд — после S3 | `web/package.json`, `web/pnpm-lock.yaml` |
| **KI-651** | 🟢 Low | Documented | `@capacitor/core` в стартовом графе: vendor-чанк +11.71 kB (gzip +4.21 kB) в web-сборке | `web/src/lib/platform.ts`, `web/src/components/TopBar.tsx` |

Все шесть записей внесены в `docs/KNOWN_ISSUES.md` (раздел «v1.5.0 —
Capacitor: каркас + камера/QR (S1)»), сводка пересчитана: **627** записей
(270 Fixed, 11 Fixed (частично), 281 Open, 54 Documented, 1 Documented
(не воспроизводится), 3 Planned, **3 Deferred**, 4 Won't Fix).

## 7. Обоснование решений

1. **Почему `base` условный, а не всегда `'./'`.** `'./'` ломает
   SPA-fallback: при переходе на `/workflow/share/<token>` или `/login`
   браузер запрашивает `/assets/…` от корня, а относительные пути начинают
   резолвиться от текущего URL и превращаются в
   `/workflow/share/assets/…`. Docker-образ и `ServeStaticModule` рассчитаны
   на абсолютные пути — это зафиксировано в комментарии к `base` ещё до S1.
   `'./'` нужен только WebView (Capacitor грузит `index.html` c
   `https://localhost`/`file://`), поэтому он включается флагом
   `CAPACITOR=1`, который в веб-деплое не выставляется.
2. **Почему `process.env.CAPACITOR`, а не `loadEnv`/`mode`.** Конфиг Vite
   исполняется в Node, поэтому `process.env` доступен без плагинов и без
   префикса `VITE_`; флаг одинаково задаётся в CI (`CAPACITOR=1 pnpm build`)
   и в PowerShell (`$env:CAPACITOR='1'`). Не стал использовать
   `--mode capacitor`, чтобы не плодить `.env.capacitor` и не менять
   существующие npm-скрипты/CI.
3. **Почему мажор 7 зафиксирован явно.** В npm latest — Capacitor 8.6.0;
   постановка и DESIGN говорят «Capacitor 7», плагины `camera`/`barcode`
   имеют разные мажоры под Capacitor 7/8. `pnpm add @capacitor/core` без
   версии поставил бы 8.x и дал бы peer-конфликт с плагинами 7.x. Явный `@7`
   — минимальная и воспроизводимая фиксация (KI-650).
4. **Почему `platform.ts` — отдельный модуль, а не проверки в компонентах.**
   `Capacitor.isNativePlatform()` напрямую в `TopBar` невозможно мокать в
   jsdom без `vi.mock('@capacitor/core')` в каждом компонентном тесте; тонкий
   слой `isNative/isAndroid/isIOS/isWeb` — одна точка подмены для тестов и
   единственное место, где проект знает про Capacitor (легко заменить, если
   появится Tauri-вариант — мы осознанно **не** берём `@tauri-apps/*`).
5. **Почему разбор QR вынесен в `lib/qr-payload.ts`.** Во-первых,
   безопасность: QR-код — недоверенный ввод, и открывать произвольный URL из
   него нельзя (фишинг). Поддерживаются только «свои» форматы: uuid и
   share-ссылка этого приложения; всё прочее → тост «Некорректный QR».
   Во-вторых, чистая функция тестируется без рендера шапки (7 тестов) и
   держит `TopBar` тонким. Это расширение списка тестов из постановки
   (минимум был 4 файла) — осознанное.
6. **Почему uuid идёт через `setCurrentWorkflowId` + `loadWorkflowAsync` +
   `syncWorkflowUrlParam`, а share — через `navigate`.** uuid открывает
   приватный граф через API (как `LoadModal`): id сначала в стор, потом
   загрузка; `?workflowId=` синхронизируется, чтобы F5 вернул тот же граф
   (та же механика, что в `handleSave`/`handleImportFile`). Share-ссылка —
   публичная страница `/workflow/share/:token` (роут в `App.tsx`), ей нужен
   только переход, без записи в стор (чужой граф в редактор не грузим).
   Успешный тост ставится только если `currentWorkflowId` действительно стал
   нужным — иначе ошибка загрузки из стора не маскируется ложным «QR
   распознан».
7. **Почему отмена сканирования молчит, а «плохой» QR — ругается.** Отмена
   камеры — нормальный пользовательский сценарий (как `Escape` в диалоге),
   тост на него был бы шумом. А вот «распознал, но не понял» — сигнал, что
   пользователь сканировал не тот код; здесь тост уместен.
8. **Почему кнопка QR только при `isNative()`.** В браузере `@capacitor-mlkit`
   на вебе либо бросит `Unavailable`, либо попросит камеру — но UX и
   разрешения другие. Кнопка, которая гарантированно не работает, хуже её
   отсутствия; Conditional rendering — правило из рецепта § 8 и DESIGN.
9. **Почему `cap add android` сделан в S1, а коммит нативного проекта — в
   S3.** `cap add` нужен уже в S1: только с ним проверяются реальные
   `cap init`→`add`→`sync`, регистрация плагинов, `capacitor.config.json` и
   `cap doctor` — иначе каркас остаётся «на бумаге». Но сам `web/android/` —
   105 сгенерированных файлов gradle-шаблона, они перегенерируются одной
   командой, а их коммит требует ещё и keystore/подписи/CI-сборки AAB
   (S3). Поэтому каталог создан, проверен `cap sync`/`cap doctor`, но
   исключён `web/.gitignore` с TODO — diff S1 остаётся читаемым, а S3
   добавляет нативный проект вместе с release-workflow.
10. **Почему `web/.gitignore`, а не корневой.** Правило «android/ios не
    коммитим» относится к веб-пакету (там живёт `webDir`/`capacitor.config.ts`);
    корневой `.gitignore` обслуживает backend и общие артефакты — не стал
    смешивать. Заодно `ios/` добавлен заранее, хотя на Windows папка не
    создаётся (S3, macOS-раннер).
11. **Почему проверка Android-модуля Play Services добавлена сверх
    постановки.** Без неё «нет Play Services» из спецификации не
    реализуется: `isSupported()` отвечает только за наличие камеры. Так как
    метод Android-only, он вызывается строго под `isAndroid()`; на iOS
    остаётся `isSupported` + разрешение (тест это фиксирует). Это
    единственное содержательное расширение кода хука относительно
    постановки — и оно закрывает заявленное поведение.
12. **Почему в S1 не правились `AndroidManifest.xml`, `Dockerfile`,
    `ServeStaticModule`, SPA-fallback и `@tauri-apps/*`.** Прямые запреты
    постановки. Манифест — единственный реальный блокер нативного QR
    (KI-646), он умышленно перенесён в S3 вместе с коммитом нативного
    проекта; backend/деплой не затрагивались — их гейты остались
    байт-в-байт теми же (1913/1937).
13. **Почему CHANGELOG/реестр KI/README отчётов всё-таки обновлены, хотя
    коммита нет.** RULES 2.1/2.4/2.18 требуют документировать изменения в
    том же пакете работ; отчёт без записи в CHANGELOG и без номеров KI
    нарушил бы процесс. Пользовательские гайды (`USER_GUIDE`,
    `MANUAL_TESTING_GUIDE`) не трогались: S1 — внутренний шаг без
    пользовательских изменений, их актуализация — release prep S3
    (RULES 2.16). `RELEASE_NOTES.md` тоже не трогал: он уже правился в
    рабочем дереве не мной и относится к release prep.
