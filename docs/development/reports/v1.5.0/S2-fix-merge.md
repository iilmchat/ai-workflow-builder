---
title: "S2: Восстановление S1 поверх v1.4.0 + блокеры"
date: 2026-11-09
version: v1.5.0
steps: [S2]
status: accepted
related_ki: [KI-646, KI-647, KI-648, KI-649, KI-650, KI-651, KI-652]
related_adr: []
---

# Отчёт S2: Восстановление S1 поверх v1.4.0 + блокеры (v1.5.0)

**Ветка:** `main`, HEAD `36b08ae` (`tag: v1.4.0`, `origin/main`). Сессия —
**без коммитов**: `git add`/`git commit` не выполнялись, изменения оставлены
в рабочем дереве. Stash `stash@{0}` («v1.5.0 S1 Capacitor WIP») не применялся
повторно и **не удалялся** — сохранён как страховка.

**Задача:** восстановить S1 (Capacitor: каркас + камера/QR) поверх v1.4.0
(Cancel, Comparison, UX Polish), не затерев v1.4.0; перенумеровать S1-KI
635..640 → 646..651; починить блокеры S3 (AndroidManifest, `logo.svg` под
`base: './'`, `tsconfig.node.json`); обновить рецепт
`MOBILE_CAPACITOR_NESTJS.md`; создать DESIGN v1.5; прогнать полные гейты.

## 1. Файлы (+/−)

### A. Перенумерация KI и docs-записи S1

| Файл | +/− | Что именно |
|---|---:|---|
| `docs/KNOWN_ISSUES.md` | +123/−22 | новый раздел «v1.5.0 — Capacitor: каркас + камера/QR (S1/S2)»: KI-646..651 (перенумерованы из S1 635..640, статусы обновлены по факту S2) + новый KI-652 (11 предсуществующих дублей заголовков); сводка пересчитана grep'ом (RULES 3.20) |
| `docs/CHANGELOG.md` | +12/−0 | `[Unreleased] ### Added`: bullet «Capacitor: каркас + камера/QR (v1.5.0 S1)»; `### Documented`: KI-646..651 + KI-652. Существующие записи v1.4.0 не тронуты |
| `docs/development/reports/README.md` | +2/−1 | две строки v1.5.0 (S1, S2) в начало таблицы (она ведётся newest-first); −1 — добавлен завершающий перевод строки в конце файла |
| `docs/development/reports/v1.5.0/S1-capacitor.md` | untracked, 506 строк | только перенумерация: 30 замен `KI-635..640` → `KI-646..651` (frontmatter `related_ki`, таблица файлов, тело, таблица KI, перекрёстные ссылки) + 2 ручных фикса диапазонов (`KI-635..640` → `KI-646..651`). Исторический текст и статусы (`Documented`/`Deferred`) не менялись |
| `docs/development/v1.5/DESIGN_V150_CAPACITOR.md` | +57 (новый) | DESIGN v1.5 — Android (Capacitor): контекст, решение, срезы S1–S4, совместимость, план, что не входит, риски |

### B. TopBar QR (S1 поверх v1.4.0)

| Файл | +/− | Что именно |
|---|---:|---|
| `web/src/components/TopBar.tsx` | +95/−1 | импорты `isNative`/`scanQr`/`parseQrPayload`/`assetUrl`; state `isScanning`; селектор `setCurrentWorkflowId`; `handleScanQr` (uuid → `setCurrentWorkflowId` + `syncWorkflowUrlParam` + `loadWorkflowAsync` + success-notice; share → `navigate`; `null` — молча; неизвестный формат — error-notice); кнопка `data-topbar-scan-qr` (только `isNative()`, подпись через `ActionLabel`); `src` логотипа → `assetUrl(...)`. `handleCancelRun`, `ActionLabel`, `data-topbar-cancel-run`, адаптив v1.4.0 не тронуты (только 1 строка логотипа изменена) |
| `web/src/components/TopBar.spec.tsx` | +157/−1 | моки `@/lib/platform` (hoisted `qr.native`) и `@/hooks/useQrScanner`; describe «TopBar — QR-сканер (v1.5.0 S1)» из 6 тестов (в браузере кнопки нет; в native видна и подписана; uuid → `setCurrentWorkflowId` + `loadWorkflowAsync`; share-URL → `navigate`; некорректный QR → error-notice и без загрузки; отмена `null` → без notice). Все v1.4.0 describe сохранены: 22 + 6 = 28 тестов |
| `web/src/i18n/en.json`, `web/src/i18n/ru.json` | +3/+3 (staged S1) | ключи `topbar.scan_qr`, `topbar.scan_qr_error`, `topbar.scan_qr_ok` — восстановлены из stash без изменений |
| `web/src/lib/platform.ts` (+spec), `web/src/lib/qr-payload.ts` (+spec), `web/src/hooks/useCamera.ts` (+spec), `web/src/hooks/useQrScanner.ts` (+spec) | untracked S1 | целы с S1, не менялись; тесты зелёные |
| `web/capacitor.config.ts` | untracked S1, 30 строк | цел с S1, не менялся |

### C. Блокеры S3

| Файл | +/− | Что именно |
|---|---:|---|
| `web/android/app/src/main/AndroidManifest.xml` | 46 строк, +5 permission/feature, +4 meta-data, −3 дубль | после `<manifest>`: `INTERNET`, `CAMERA`, `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` (`maxSdkVersion=32`), `<uses-feature android.hardware.camera required="false">`; внутри `<application>` перед `<activity>`: `meta-data com.google.mlkit.vision.DEPENDENCIES=barcode_ui`; удалён дублирующий блок `<!-- Permissions --> + INTERNET` внизу. `allowBackup`, атрибуты `<application>`, `MainActivity`, `FileProvider` не тронуты |
| `web/src/lib/asset-url.ts` | +16 (новый) | `assetUrl(path)` — префикс `import.meta.env.BASE_URL`, нормализация ведущего слэша |
| `web/src/lib/asset-url.spec.ts` | +28 (новый) | 2 теста: `BASE_URL='/'` → `/logo.svg`; `BASE_URL='./'` → `./logo.svg` (`vi.stubEnv` работает в Vitest 4.1.11) |
| `web/src/components/auth/LoginPage.tsx` | +6/−1 | импорт `assetUrl`, `src` логотипа (light/dark) через хелпер |
| `web/tsconfig.node.json` | +1/−1 | `include`: `["vite.config.ts", "capacitor.config.ts"]` |
| `web/.gitignore` | +3/−0 (vs HEAD) | `android/` больше не игнорируется; остаётся `ios/` с комментарием «на Windows не генерируется (S4+)» |
| `web/android/.gitignore` | untracked, +2 | раскомментированы `*.jks`, `*.keystore`; `build/`, `.gradle/`, `local.properties` уже игнорировались |
| `web/android/` | untracked, 105 файлов | нативный проект `cap add android`; `build/`, `.gradle/`, `local.properties` исключены `web/android/.gitignore`. В коммит S2 войдёт (сессия не коммитит) |

### D. Рецепт

| Файл | +/− | Что именно |
|---|---:|---|
| `docs/development/MOBILE_CAPACITOR_NESTJS.md` | untracked S1, 529 строк; § 9/§ 14/§ 17 | § 9: блок `useQrScanner` заменён на фактический API (`Capacitor.isNativePlatform`, `isSupported() → { supported }`, Android-only `isGoogleBarcodeScannerModuleAvailable()` + `installGoogleBarcodeScannerModule()`, `requestPermissions`, `scan`) + примечание про `{ supported }`; § 14: врезка «рецепт под Capacitor 7.x, latest 8.x, фиксируй мажор `@7`»; § 17: новый пункт «НЕ ставь `base: './'` безусловно…» |

### E. Не входит в S2 (не тронуто)

- `RELEASE_NOTES.md` — staged (+634/−8) из stash как артефакт релизного
  скрипта, **не коммитится**, в S2 не менялся.
- Staged S1-остатки (часть восстановленного S1, не authored в S2):
  `web/package.json` (+5: `@capacitor/*`), `web/pnpm-lock.yaml` (+754),
  `web/vite.config.ts` (+14/−4: условный `base`), `web/.gitignore` (staged
  часть), `web/src/i18n/*.json`, `web/.gitignore`.
- Не тронуты: `@tauri-apps/*`, `Dockerfile`, `ServeStaticModule`,
  SPA-fallback, `web/android/build.gradle`, `gradle.properties`,
  `variables.gradle`, `useFileDownload`, `usePushNotifications`.

## 2. Build / test

| Гейт | Команда | Результат |
|---|---|---|
| Install root | `pnpm install --frozen-lockfile` | exit 0, lock без изменений |
| Install web | `pnpm --dir web install --frozen-lockfile` | exit 0 |
| Backend build | `pnpm build` | exit 0, лог пуст (только `$ nest build`) → 0 ошибок/0 предупреждений |
| Backend typecheck | `pnpm typecheck` (`tsc -p tsconfig.spec.json --noEmit`) | exit 0, без вывода |
| Backend tests | `pnpm test` | **1948 passed**, 25 skipped (1973); 124 файла passed, 4 skipped; 27.88 с — ровно baseline v1.4.0 |
| Web build (без env) | `pnpm --dir web build` | exit 0, `✓ built in 324ms`; в `dist/index.html` пути `/assets/...` |
| Web tests | `pnpm --dir web test` | **542 passed** (60 файлов), 14.48 с. Было 511 в v1.4.0; +31: платформа/камера/QR/payload/assetUrl (25) + TopBar QR (6) |
| Web build (CAPACITOR=1) | `$env:CAPACITOR='1'; pnpm --dir web build` | exit 0, `✓ built in 304ms`; в `dist/index.html` пути `./assets/...` |
| `cap sync android` | `pnpm --dir web exec cap sync android` | exit 0, «Found 2 Capacitor plugins» (`barcode-scanning@7.5.0`, `camera@7.0.5`), `Sync finished in 0.112s` (финальный прогон 0.139 с) |
| `cap doctor` | `pnpm --dir web exec cap doctor` | exit 0, `[success] Android looking great! 👌`; installed 7.6.10 vs latest 8.6.0 |
| TopBar targeted | `pnpm --dir web test src/components/TopBar.spec.tsx` | 28/28 passed |

Итог: `pnpm build` → 0/0, `pnpm typecheck` → 0, backend 1948, web 542,
обе сборки успешны, `cap sync`/`cap doctor` зелёные.

## 3. Диагностика

### 3.1. Состояние на старте: конфликты stash были НЕ разрешены

Вопреки постановке («конфликты уже разрешены через `git checkout HEAD --`»),
`git status --short` на старте показал **unmerged** (`UU`) в 5 файлах:
`docs/CHANGELOG.md`, `docs/KNOWN_ISSUES.md`,
`docs/development/reports/README.md`, `web/src/components/TopBar.tsx`,
`web/src/components/TopBar.spec.tsx`. Это классический след `git stash pop`
S1-ветки (база v1.3.0) на v1.4.0; `MERGE_HEAD`/`REBASE_HEAD` отсутствовали,
`stash@{0}` («On main: v1.5.0 S1 Capacitor WIP») на месте. Причина конфликтов:
S1 правил те же 5 файлов, что v1.4.0 S1–S3.

Разрешено предписанным способом — `git checkout HEAD -- <5 файлов>`
(берём v1.4.0). После этого состояние совпало с ожидаемым постановкой:
staged M `web/.gitignore`, `web/package.json`, `web/pnpm-lock.yaml`,
`web/src/i18n/{en,ru}.json`, `web/vite.config.ts`, `web/.gitignore`;
`RELEASE_NOTES.md` staged; untracked S1-файлы целы. Stash не удалялся.

### 3.2. `cap doctor` (факт)

```
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
Расхождение latest 8.6.0 vs installed 7.6.10 — ожидаемое, зафиксировано в
KI-650 (`Deferred`) и предупреждении § 14 рецепта.

### 3.3. AndroidManifest: до → после

До (`cap add android`): `<manifest>` без разрешений; единственный
`<uses-permission INTERNET>` — внизу, после `</application>`; ML Kit
meta-data нет. После: разрешения и `<uses-feature camera required=false>` —
сразу после `<manifest>`; `meta-data com.google.mlkit.vision.DEPENDENCIES =
barcode_ui` — внутри `<application>` перед `<activity>`; дублирующий нижний
INTERNET удалён. XML валиден (`[xml]` → OK), `uses-permission` = 4,
вхождение `INTERNET` = 1. `allowBackup`, `icon`/`roundIcon`/`theme`,
`MainActivity` и `FileProvider` не изменены.

### 3.4. Реестр KI: предсуществующие дубли заголовков

При пересчёте сводки (RULES 3.20) обнаружено, что уже на HEAD v1.4.0 в
`docs/KNOWN_ISSUES.md` **643** заголовка `### KI-` при **632** уникальных
номерах: у KI-635..645 по два заголовка (подробная запись + краткая копия в
конце блоков v1.4.0 S2/S3). Сводка v1.4.0 при этом заявляла 632 записи и
«дублей номеров нет» — фактически проверка RULES 3.20 (1) не сходилась в
базовой точке. Дубли — записи v1.4.0, по заданию S2 не трогались; найденное
заведено как **KI-652**. Дополнительно в кратком дубле KI-638 описание
повреждено заменой (`…показываются как ## Сводка по статусам.0000`) — цель
для S3-чистки вместе с KI-652.

Сводка S2 теперь считает вхождения (RULES 3.20 буквально): 650 заголовков =
650 строк статуса, сумма таблицы 650; отдельно указано, что уникальных
номеров 639, разница 11 — дубли KI-635..645 (KI-652).

### 3.5. Сборка: размеры/предупреждения

`vendor` в web-сборке 144.94 kB (gzip 44.56 kB), в Capacitor — 144.99 kB
(gzip 44.57 kB); предупреждений о чанках >500 kB нет. Рост относительно
v1.4.0 (133.23 kB / gzip 40.35) — это KI-651 (+11.71 kB, gzip +4.21 kB),
подтверждено замером S2, оптимизация оставлена в S3.

### 3.6. Gradle/устройство

Не запускались: сборка AAB и device-smoke — S3 (в S1 отмечено, что JDK на
PATH — 11, Capacitor 7 требует JDK 17+; это вне S2). Проверка Android в S2 —
`cap sync` + `cap doctor` + XML-валидация манифеста.

## 4. Smoke (детально)

### 4.1. `dist/index.html` — web-сборка (без env, `base: '/'`)

Команда: `pnpm --dir web build` (exit 0).

```
<script type="module" crossorigin src="/assets/index-D4DgDRrq.js"></script>
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-hePW80VL.js">
<link rel="modulepreload" crossorigin href="/assets/react-BvB9BS1T.js">
<link rel="modulepreload" crossorigin href="/assets/vendor-jECPiCQK.js">
<link rel="modulepreload" crossorigin href="/assets/reactflow-B8tvhT2S.js">
<link rel="modulepreload" crossorigin href="/assets/i18n-D65QJ3yv.js">
```

### 4.2. `dist/index.html` — Capacitor-сборка (`CAPACITOR=1`, `base: './'`)

Команда: `$env:CAPACITOR='1'; pnpm --dir web build` (PowerShell), exit 0.

```
<script type="module" crossorigin src="./assets/index-CK5NsGzz.js"></script>
<link rel="modulepreload" crossorigin href="./assets/rolldown-runtime-hePW80VL.js">
<link rel="modulepreload" crossorigin href="./assets/react-BvB9BS1T.js">
<link rel="modulepreload" crossorigin href="./assets/vendor-BdqJaaWg.js">
<link rel="modulepreload" crossorigin href="./assets/reactflow-B8tvhT2S.js">
<link rel="modulepreload" crossorigin href="./assets/i18n-D65QJ3yv.js">
```

Финал: `dist/` оставлен в Capacitor-режиме, поверх него повторно выполнен
`cap sync android` — ассеты WebView соответствуют относительным путям.

### 4.3. `cap sync android` (финальный прогон)

```
√ Copying web assets from dist to android\app\src\main\assets\public in 24.18ms
√ Creating capacitor.config.json in android\app\src\main\assets in 893.80μs
√ copy android in 46.20ms
√ Updating Android plugins in 4.95ms
[info] Found 2 Capacitor plugins for android:
       @capacitor-mlkit/barcode-scanning@7.5.0
       @capacitor/camera@7.0.5
√ update android in 57.80ms
[info] Sync finished in 0.139s
```

### 4.4. `git status --short` (финал, без коммитов)

```
M  RELEASE_NOTES.md
 M docs/CHANGELOG.md
 M docs/KNOWN_ISSUES.md
 M docs/development/reports/README.md
MM web/.gitignore
M  web/package.json
M  web/pnpm-lock.yaml
 M web/src/components/TopBar.spec.tsx
 M web/src/components/TopBar.tsx
 M web/src/components/auth/LoginPage.tsx
M  web/src/i18n/en.json
M  web/src/i18n/ru.json
 M web/tsconfig.node.json
M  web/vite.config.ts
?? docs/development/MOBILE_CAPACITOR_NESTJS.md
?? docs/development/reports/v1.5.0/
?? docs/development/v1.5/
?? web/android/
?? web/capacitor.config.ts
?? web/src/hooks/useCamera.spec.ts
?? web/src/hooks/useCamera.ts
?? web/src/hooks/useQrScanner.spec.ts
?? web/src/hooks/useQrScanner.ts
?? web/src/lib/asset-url.spec.ts
?? web/src/lib/asset-url.ts
?? web/src/lib/platform.spec.ts
?? web/src/lib/platform.ts
?? web/src/lib/qr-payload.spec.ts
?? web/src/lib/qr-payload.ts
```

`web/android/` — untracked (105 файлов), это **ожидаемо**: он войдёт в коммит
S2, но сессия не коммитит. `RELEASE_NOTES.md` staged, но не коммитится.
`stash@{0}` сохранён: `git stash list` → `stash@{0}: On main: v1.5.0 S1 Capacitor WIP`.

### 4.5. Прочее

- `TopBar.spec.tsx` targeted: `28 passed` (22 v1.4.0 + 6 QR).
- `asset-url.spec.ts` + `LoginPage.spec.tsx`: 4/4 passed.
- XML манифеста: `XML OK; permissions=4`.
- `web/.gitignore` → `android/` больше не игнорируется, `ios/` остаётся;
  `git check-ignore web/android/app/release.keystore` → `*.keystore` работает.

## 5. Что не так (все факты и расхождения)

1. **Стартовое состояние не совпало с постановкой:** 5 файлов были в `UU`
   (unmerged), а не разрешены/staged. Разрешены `git checkout HEAD --` (как и
   предписывала постановка для уже-разрешённого состояния). Stash не удалён.
2. **`RELEASE_NOTES.md`** был staged (`M `), а не unstaged, как в постановке.
   Файл не трогали и не коммитили; в финальном `git status` он остаётся
   staged — так как коммита нет, это безопасно.
3. **Имена в псевдокоде постановки не совпали с фактическим кодом:**
   `parseQrPayload` возвращает `{ kind: 'workflow', id }`, а не
   `{ workflowId }`; `showNotice` в коде — `setNotice`. Реализация взята из
   сохранённого S1-кода в stash (`handleScanQr` + `setCurrentWorkflowId` +
   `syncWorkflowUrlParam` + `loadWorkflowAsync`), существующие имена не
   менялись.
4. **Реестр KI на HEAD v1.4.0 содержал 11 дублей заголовков KI-635..645**
   (643 заголовка vs 632 уникальных), а сводка утверждала обратное. Дубли не
   удалялись (KI-635..640 — v1.4.0, не трогаем по заданию); найденное
   заведено как KI-652. Сводка S2 пересчитана по вхождениям (650/650) с
   явным указанием 639 уникальных номеров.
5. **Краткий дубль KI-638 повреждён** старой заменой (`…как ## Сводка по
   статусам.0000`) — это предсуществующий дефект v1.4.0, цель S3-чистки
   (вместе с KI-652), в S2 не исправлялся.
6. **Строки отчётов в `reports/README.md`** изначально были добавлены в конец
   таблицы, хотя она ведётся newest-first. Перенесены в начало (после
   заголовка). Строка S1 восстановлена в кратком виде из постановки; в stash
   лежала её подробная версия (не переносилась — постановка задавала краткую).
7. **Манифест:** помимо предписанной вставки удалён нижний дублирующий блок
   `<!-- Permissions --> + INTERNET` — иначе `<uses-permission INTERNET>`
   оказался бы объявлен дважды. На поведение не влияет, манифест валиден.
8. **`web/android/.gitignore`:** раскомментированы `*.jks`/`*.keystore`
   (постановка: «если нет — допиши»); заодно убрана ставшая неактуальной
   строка-инструкция «Uncomment the following lines…».
9. **Статусы KI-646..648 в реестре — `Fixed`**, а в историческом отчёте S1
   они остались `Documented` (постановка: S1-отчёт не трогать, кроме
   перенумерации). Это осознанно: реестр отражает факт S2, отчёт — состояние
   S1. KI-649 — `Fixed (частично)`: `web/android/` теперь в git, но CI-job
   сборки AAB остаётся в S3. KI-650 — `Deferred`, KI-651 — `Documented`.
10. **Web-тестов стало 542, а не ~525 из постановки.** 511 (v1.4.0) + 25
    S1-unit (platform/useCamera/useQrScanner/qr-payload/assetUrl) + 6 TopBar
    QR = 542. Оценка ~525 не учитывала все S1-спеки.
11. **Кнопка QR использует `ActionLabel`** (подпись скрывается до 1760 px,
    иконка остаётся) — постановка в C3 давала icon-only вариант, но
    требовала «встать в тот же flex-контейнер и корректно схлопываться» с
    адаптивом v1.4.0. Поведение и тесты (доступное имя из `aria-label`,
    `data-topbar-scan-qr`) сохранены.
12. **`viewer`-гвард для QR не добавлялся**: кнопка показывается только при
    `isNative()`, как в S1; в вебе её нет, для viewer отдельного правила
    постановка не задавала.
13. **Смешанные переводы строк:** после программного append блока QR-тестов
    в `TopBar.spec.tsx` появились CRLF; файл нормализован в LF (`.gitattributes: * text=auto eol=lf`).
    Также нормализованы затронутые docs-файлы; в `reports/README.md`
    добавлен завершающий перевод строки (отсюда +2/−1 вместо чистых +2).
14. **Ссылки на строки в KI-647** (`TopBar.tsx:575`, `LoginPage.tsx:131`) —
    исторические; после восстановления QR логотип в TopBar теперь около
    строки 709. На смысл не влияет; актуализировать можно при S3-чистке.
15. **S1-отчёт историчен:** в нём остались HEAD `563f6be` и статусы
    `Documented`/`Deferred` — это ожидаемо (правило «только перенумерация»).
16. **`dist/` финально в Capacitor-режиме** (`./assets/...`), поверх него
    выполнен `cap sync`; web-режим (`/assets/...`) зафиксирован отдельным
    прогоном сборки (см. § 4.1/4.2). Иначе нативный WebView получил бы
    абсолютные пути.
17. **Gradle/устройство не запускались** — вне S2 (S3: AAB, `aapt dump
    permissions`, device-smoke QR). Проверка ограничена `cap sync`/`cap doctor`.
18. **Stash не удалён.** Он содержит S1-WIP на базе v1.3.0, уже не нужный
    после восстановления; удалять его — решение владельца (S3/ревью), не
    автоматическая операция сессии.
19. **`web/android/` — 105 untracked-файлов** (включая `app/src/main/assets/public`,
    `capacitor.config.json`); в git они не добавлялись (запрет на `git add`),
    но `web/.gitignore` уже разрешает трекинг — коммит S2 подхватит каталог.
20. **Промпт-сниппет C2** предлагал `parsed.workflowId` и `setCurrentWorkflowId`
    без `syncWorkflowUrlParam`; фактический S1-код дополнительно синхронизирует
    `?workflowId=` в URL — оставлено как в S1 (лучшее поведение: перезагрузка
    страницы открывает тот же workflow).

## 6. Новые KI

Найден и заведён **один** новый KI:

- **KI-652** (🟢 Low, `Documented`) — «В реестре остались 11 кратких дублей
  заголовков KI-635..645»: на HEAD v1.4.0 643 заголовка `### KI-` при 632
  уникальных номерах (по два заголовка у KI-635..645), поэтому проверка
  RULES 3.20 (1) не сходилась в базовой точке. Решение: удалить 11 кратких
  дублей в S3 (в S2 нельзя — KI-635..640 принадлежат v1.4.0); вместе с ними
  почистить повреждённое описание краткого дубля KI-638
  (`…как ## Сводка по статусам.0000`).

Прочих новых KI нет: `assetUrl` сработал в обоих режимах (тесты + сборка),
манифест синтаксически валиден и принял ML Kit meta-data (`cap sync`/
`cap doctor` зелёные); device-проверка QR/камеры и `aapt dump permissions`
остаются в S3 (не дефект S2).

## 7. Обоснование решений

- **Почему `checkout HEAD --` + ручное восстановление, а не merge stash
  целиком:** S1 делался от v1.3.0 и не знал про Cancel/Comparison/UX Polish
  v1.4.0; автоматический merge вернул бы конфликты в 5 файлах и риск
  затереть v1.4.0-код. Взяли v1.4.0 как базу (источник истины), а S1-слой
  восстановили точечно — из сохранённого в stash S1-кода для TopBar/тестов
  и из задания для docs/android. Так v1.4.0-функциональность не потеряна
  (тесты 542, включая все v1.4.0-спеки).
- **Почему перенумерация 635..640 → 646..651, а не слияние/переименование
  v1.4.0-записей:** номера 635..640 уже заняты v1.4.0 (Cancel/Comparison),
  а правило «не трогать существующие KI» запрещает их переписывание.
  Свободные номера начинались с 646; содержимое S1-записей сохранено,
  обновлены только статусы/«Решение» по факту S2.
- **Почему отдельный хелпер `assetUrl`, а не инлайн
  `` `${import.meta.env.BASE_URL}logo.svg` ``:** единая точка правды и
  нормализации слэша для всех статик-ссылок (сейчас TopBar + LoginPage,
  дальше DOCX/push-иконки), тестируемость через `vi.stubEnv('BASE_URL')` и
  защита от забытого ведущего `/`, который и создал KI-647.
- **Почему `web/android/` теперь в git, а `ios/` остаётся в `.gitignore`:**
  `AndroidManifest.xml` правится в S2 и должен трекаться, иначе регрессии
  разрешений/ML Kit не видны ни в diff, ни в CI (KI-649); iOS на Windows не
  генерируется, его срез — S4+/S5, поэтому каталог пока игнорируется.
- **Почему кнопка QR через `ActionLabel`:** в v1.4.0 TopBar адаптивный —
  подписи второстепенных действий скрываются до 1760 px, иконки остаются.
  QR-кнопка встроена в ту же прокручиваемую flex-группу, поэтому подчиняется
  общей механике; доступное имя (`aria-label`) и `data-topbar-scan-qr`
  сохранены для тестов/смоука.
- **Почему статусы KI-646..648 — `Fixed`, а не `Documented`:** S2 явно
  чинит эти блокеры (манифест, assetUrl, рецепт), и реестр должен отражать
  фактическое состояние, иначе S3 будет чинить уже исправленное. S1-отчёт
  оставлен историческим (правило «только перенумерация»).
- **Почему KI-652 заведён, а не удалены дубли:** удаление кратких копий
  затрагивает блоки KI-635..640 (v1.4.0), которые по заданию S2 трогать
  нельзя; корректный путь — зафиксировать дефект и вычистить вместе с
  остальными docs-работами S3.
- **Почему сессия не коммитит и не удаляет stash:** жёсткое правило S2
  (`НЕ КОММИТИТЬ`, `НЕ ИСПОЛЬЗОВАТЬ git add -A`); stash — страховка на
  случай, если восстановление потребует сверки; его судьба — решение
  владельца на ревью.
- **Почему финальная сборка — Capacitor-режим и повторный `cap sync`:**
  нативный WebView требует относительных путей (`./assets`); `cap sync`
  копирует `dist` в `android/app/src/main/assets/public` и должен видеть
  именно Capacitor-сборку. Web-режим проверен отдельным прогоном (§ 4.1).
