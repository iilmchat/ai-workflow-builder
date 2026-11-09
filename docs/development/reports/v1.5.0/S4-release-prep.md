---
title: "S4-A: CI/CD (AAB) + Firebase/Keystore docs + Release Prep v1.5.0"
date: 2026-11-09
version: v1.5.0
steps: [S4-A]
status: accepted
related_ki: [KI-651, KI-652, KI-653, KI-654, KI-655]
related_adr: []
---

# Отчёт S4-A: CI/CD (AAB) + Firebase/Keystore + Release Prep (v1.5.0)

**Ветка:** `main`, HEAD `58d7eed` (`feat(v1.5.0): S3 — Files (DOCX) + Push +
KI-652 cleanup`). Сессия — **без коммитов**: `git add`/`git commit`/`git add -A`
не выполнялись, индекс пуст (`git diff --cached --name-only` → 0), HEAD
по-прежнему `58d7eed`. Все изменения — в рабочем дереве.

**Задача (S4-A, DESIGN V150 § 3 S4):** финальный технический шаг v1.5.0 —
1. GitHub Actions workflow для сборки AAB;
2. инструкции пользователю по Firebase и Keystore;
3. release-prep: версии, `CHANGELOG`, `PROMPT_CURRENT`, `README`, `docs/README`,
   DESIGN;
4. раздел § 18 в рецепте `MOBILE_CAPACITOR_NESTJS.md`.

**Не делалось (по заданию):** сам `google-services.json`, keystore, создание
GitHub Secrets, публикация в Play Console (S4-B — ручные шаги пользователя).

**Правила:** `docs/development/RULES.md` v1.10.0 — в первую очередь 2.1, 2.2,
2.9, 2.15, 2.16, 2.17, 2.18, 3.13, 3.20, 6.10, 6.11, 5.1/5.6;
`docs/development/RELEASES.md` § 3 (release gate документации).

**Схема работы.** Часть «release-prep docs» (README, `docs/README`,
`USER_GUIDE`, `MANUAL_TESTING_GUIDE` — RULES 2.16 + F4) выполнялась отдельным
субагентом `docs-release` в своём write-scope; workflow, инструкции Firebase/
Keystore, § 18 рецепта, версии, `CHANGELOG`, `PROMPT_CURRENT`, DESIGN, KI-реестр
и финальные гейты — ведущим. Пересечений файлов не было.

## 1. Файлы (+/−)

### A. CI/CD и защита секретов

| Файл | +/− | Что именно |
|---|---:|---|
| `.github/workflows/release-mobile.yml` | 164 (new) | workflow «Release Mobile (Android)»: триггеры `push: tags: v*` + `workflow_dispatch`; 14 шагов — checkout → pnpm (без `version`, RULES 6.10) → Node 22 + `cache: pnpm` → `pnpm --dir web install --frozen-lockfile` → `CAPACITOR=1 pnpm --dir web build` → `cap sync android` → Java 21 (temurin) → Android SDK (`platform-tools platforms;android-35 build-tools;35.0.0`) → декод keystore из `ANDROID_KEYSTORE_BASE64` → `google-services.json` из `GOOGLE_SERVICES_JSON` → `bundleRelease` с inject-подписью (абсолютный путь к keystore) → проверка AAB (`jarsigner -verify` + разрешения merged-манифеста) → `upload-artifact` (30 дней) → `Cleanup secrets` в `if: always()`; `permissions: contents: write` |
| `web/android/.gitignore` | +7/−1 | раскомментирован и документирован `google-services.json`; явно добавлен `release.keystore` (рядом с `*.jks`/`*.keystore`); комментарии со ссылками на workflow и `FIREBASE_SETUP`/`KEYSTORE_SETUP` |
| `web/android/app/build.gradle` | +1/−1 | `versionName` `"1.0"` → `"1.5.0"` (релизная версия приложения; `versionCode 1` — первый релиз, растёт вручную перед следующей загрузкой) |

### B. Документация для пользователя (Firebase, Keystore, рецепт)

| Файл | +/− | Что именно |
|---|---:|---|
| `docs/development/v1.5/FIREBASE_SETUP.md` | 101 (new) | пошагово: Firebase-проект → Android-приложение с package `com.iilmchat.workflowbuilder` → `google-services.json` в `web/android/app/` → локальная/CI-сборка → проверка токена (`adb logcat`, `SELECT * FROM device_tokens`, тестовый push из Firebase Console) → troubleshooting (в т.ч. KI-653/KI-654) |
| `docs/development/v1.5/KEYSTORE_SETUP.md` | 137 (new) | `keytool -genkeypair` (PKCS12, `validity 10000`), base64 для Secrets (PowerShell и Linux/macOS), таблица 5 Secrets, локальная сборка `bundleRelease`, запуск CI по тегу, загрузка в Play Console (Internal testing), бэкап и troubleshooting; добавлено предупреждение про `versionCode` перед следующей загрузкой |
| `docs/development/MOBILE_CAPACITOR_NESTJS.md` | +46/−0 | новый **§ 18. CI/CD: NestJS + Firebase + Keystore** (перед «Связанные документы»): 3 пайплайна, ключевые моменты workflow (`CAPACITOR=1`, `cap sync` после сборки, инъекция секретов, `Cleanup secrets`, `jarsigner` вместо `aapt`, RULES 6.10), таблица 5 Secrets, порядок деплоя, «что НЕ делать», ссылки на полные инструкции |

### C. Release-prep: версии, CHANGELOG, PROMPT_CURRENT, DESIGN

| Файл | +/− | Что именно |
|---|---:|---|
| `package.json` | +1/−1 | `"version": "1.5.0"` (RULES 2.7) |
| `web/package.json` | +1/−1 | `"version": "1.5.0"` (источник `APP_VERSION` в UI, RULES 1.11) |
| `docs/CHANGELOG.md` | +26/−6 | `[Unreleased]` снова пустая рабочая секция (RULES 2.2); весь прежний контент переехал в **`[1.5.0] — 2026-11-09`** с подзаголовком «Minor-релиз: Android Mobile App (Capacitor)»; добавлен пункт **S4-A** (workflow, `.gitignore`, инструкции, § 18, версии) первым в `### Added`; KI-652 перенесён в `### Fixed`; KI-653/KI-654 помечены `(High/Low, S4-B)`; добавлен KI-655 |
| `docs/development/PROMPT_CURRENT.md` | +70/−100 | шапка: `(v12.0)`, версия 12.0, дата 2026-11-09, статус «актуален для HEAD после релиза **v1.5.0** (Android Mobile App)», «Заменяет: v11.4»; §1.1 — метрики 1958/26, 559, KI-655/642, Open High 0 (незакрытый High — KI-653), стек +Capacitor 7; §1.3 — заголовок и новые пункты v1.2–v1.5; §1.4 — строки `v1.4.0`/`v1.5.0`, удалена повреждённая строка истории (управляющий символ `U+0011`), нормализованы `0.10.1`/`0.10.2`/`0.11.0`; §5.1 — новые метрики; §5.2 — сжатый и актуализированный список (High 1: KI-653; техдолг KI-651/KI-654/KI-655; закрытое в v1.5.0); §5.3 — добавлены DESIGN v1.5, рецепт, FIREBASE/KEYSTORE; §6 — план S4-B вместо устаревших v0.10.2/v0.11.0; §7.3 и «Итог» — цифры 1958/559 |
| `docs/development/v1.5/DESIGN_V150_CAPACITOR.md` | +17/−8 | статус: «S1–S3 — реализовано; S4-A — сделано; S4-B — ожидает ручных шагов пользователя», версия 1.1; раздел S4 разбит на **S4-A** (сделано: workflow, `.gitignore`, инструкции, release-prep) и **S4-B** (ручные шаги: Firebase, keystore, Play Console, KI-653/KI-654); план работ и риски обновлены (`jarsigner` + merged-манифест вместо `aapt`) |

### D. RULES 2.16 + F4: гайды и README (субагент `docs-release`)

| Файл | +/− | Что именно |
|---|---:|---|
| `README.md` | +66/−10 | бейджи `version-1.5.0`, `backend_tests-1958`, `frontend_tests-559`; версия/стек в шапке (+Android Capacitor 7); новый раздел **📱 Android Mobile App (v1.5.0)** (QR, файлы DOCX/PDF, push, CI/CD, 5 секретов, команды сборки, ссылки на DESIGN/рецепт/FIREBASE/KEYSTORE, ограничения); «158 ручных кейсов»; DESIGN v1.5 в таблице документации; метрики в «Статусе проекта» (1958/130, 559/62, KI-655/642, Open 281, Open High 0) |
| `docs/README.md` | +18/−11 | шапка `v1.5.0 · 2026-11-09`; «158 ручных кейсов»; блоки кейсов синхронизированы (добавлены V0.11 — 10, V1.3 — 9, V1.4–V1.5 — 10; «Итого 158» вместо устаревших 129); DESIGN-таблица + v1.5 (Released) и v1.4 (DESIGN не заводился, ссылка на отчёты); метрики 1958/559/KI-655/642/Open 281; дерево + `v1.5/`; футер v1.5.0 |
| `docs/user_guide/USER_GUIDE.md` | +197/−35 | документ 1.6 / продукт 1.5.0; **новый § 6 «Android-приложение (v1.5.0)»** (6.1 браузер vs приложение, 6.2 камера/QR: uuid и share-ссылка, 6.3 DOCX/PDF и нативный просмотрщик, 6.4 push и разрешения, 6.5 ограничения: iOS нет, нужен просмотрщик, Firebase/KI-653, иконка/KI-654); §2.1 — кнопка QR; §2.8 — отмена запуска (v1.4.0); §3.21 — шаг нативного открытия файла; FAQ/ограничения актуализированы (убраны противоречия v1.3: «отмены нет», «сравнения нет», KI-628); §9 «Что нового» 9.4 (v1.4) и 9.5 (v1.5); разделы 6–10 перенумерованы в 7–11; история 1.6 |
| `docs/qa/MANUAL_TESTING_GUIDE.md` | +268/−27 | документ 1.6 / продукт 1.5.0; **новый § 14 «V1.4–V1.5 — CAPACITOR: КАМЕРА/QR, ФАЙЛЫ, PUSH, CI»** с 10 кейсами `MOBILE-01..10` (P1: белый экран, QR только в приложении, QR uuid, QR share, отмена скана; P2: DOCX в браузере, нативный просмотрщик, ошибка скачивания, push + `POST /notifications/register` + KI-653; P3: workflow/триггеры/`git check-ignore`); перенумерация 14–17 → 15–18, ссылки «§ 16»→«§ 17» и анкоры обновлены; «Итого 158»; §1.4/§1.5 — новые ручки и селекторы (`data-topbar-scan-qr`, `data-document-gen-download-error`, `data-topbar-cancel-run`); приёмка (+MOBILE-01..05, метрики 1958/559, `cap sync`, `git check-ignore`, триггеры workflow); ограничения (+iOS, Play rollout, KI-653, KI-654); история 1.6 |

### E. Реестр KI и индекс отчётов

| Файл | +/− | Что именно |
|---|---:|---|
| `docs/development/reports/README.md` | +1/−0 | строка S4-A в таблицу отчётов (RULES 2.18) со ссылкой на этот файл |
| `docs/development/reports/v1.5.0/S4-release-prep.md` | 515 (new) | этот отчёт |
| `docs/KNOWN_ISSUES.md` | +28/−10 | заведён **KI-655** (Medium, Planned S4-B: workflow не проверен прогоном); сводка пересчитана grep'ом — **642** вхождения = 642 строки статуса = 642 уникальных номера (до S4-A было 641); исправлена арифметика таблицы сводки (заголовок «Итого» и последняя строка отставали на 2 с прошлой сессии) |

### F. Не тронуто (проверено)

`src/**` (production-код) — без изменений; `web/android/app/src/main/AndroidManifest.xml`
— без изменений; `google-services.json` и `release.keystore` **не создавались**
(`Test-Path` → `False`); GitHub Secrets не создавались; Play Console не
использовался; `RELEASE_NOTES.md` не тронут (его нет в рабочем дереве — файл
закоммичен в S3).

## 2. Build / test

| Гейт | Команда | Результат |
|---|---|---|
| Build | `pnpm build` | exit 0 — **0 errors, 0 warnings** |
| Typecheck | `pnpm typecheck` | exit 0 — **0 ошибок** |
| Backend tests | `pnpm test` | **1958 passed**, 26 skipped, 126 файлов passed / 4 skipped (baseline 1958 — без изменений: S4-A не трогает `src/**`) |
| Web tests | `pnpm --dir web test` | **559 passed**, 62 файла (baseline 559 — без изменений) |
| Web build | `pnpm --dir web build` | exit 0 (`tsc -b` + vite), `base: '/'`; `1.5.0` присутствует в бандле (`APP_VERSION` из `web/package.json`) |
| Web build (Capacitor) | `$env:CAPACITOR='1'; pnpm --dir web build` | exit 0, `base: './'` |
| Android sync | `pnpm --dir web exec cap sync android` | exit 0 — «Found **5** Capacitor plugins»; новых tracked-изменений в `web/android/` нет |
| Capacitor doctor | `pnpm --dir web exec cap doctor` | `[success] Android looking great! 👌` |
| YAML workflow | PyYAML-разбор `.github/workflows/release-mobile.yml` | структура валидна: `name`, триггеры `push.tags=['v*']`/`workflow_dispatch`, 14 шагов, `runs-on: ubuntu-latest`, `permissions: {contents: write}` |

Итого: **1958 + 559** тестов зелёные; build/typecheck — 0/0. Baseline не вырос:
S4-A — инфраструктура и документация, production-код не менялся.

## 3. Диагностика

### 3.1. `google-services.json` → Gradle-плагин → FCM

- `web/android/build.gradle` (строки 48–53) применяет
  `com.google.gms.google-services` **только при наличии**
  `google-services.json` в каталоге модуля `app/`; иначе пишет
  `google-services.json not found, google-services plugin not applied.
  Push Notifications won't work` (INFO) и сборка продолжается — **молча
  нерабочий push**. Поэтому в workflow инъекция файла идёт отдельным шагом с
  жёсткой проверкой пустого секрета (`exit 1`), а не «если есть — применим».
- Package name в Firebase должен совпадать с `appId` из
  `web/capacitor.config.ts` = `com.iilmchat.workflowbuilder`
  (и `applicationId`/`namespace` в `app/build.gradle`) — иначе Gradle-плагин
  падает на этапе `processReleaseGoogleServices`.
- Отсюда же KI-653: до появления файла на устройстве `register()` уходит в
  `registrationError`, токен не приходит.

### 3.2. Keystore и inject-подпись

- `bundleRelease` без подписи собирает **unsigned** AAB: в `app/build.gradle`
  у `buildTypes.release` нет `signingConfig` (шаблон Capacitor), поэтому
  подпись передаётся AGP inject-свойствами
  `-Pandroid.injected.signing.store.file/store.password/key.alias/key.password`.
- Путь к keystore передан **абсолютным** (`${{ github.workspace }}/web/android/app/release.keystore`):
  относительный путь для injected signing резолвится от каталога модуля
  (`app/`), а не от `working-directory` (`web/android`), — это классическая
  ловушка «keystore not found» в CI.
- Проверить, что подпись реально применилась, можно без Android SDK:
  AAB — это jar/zip, `jarsigner -verify` (из JDK) печатает `jar verified`.
  Шаг добавлен в workflow: unsigned AAB = красный job, а не «зелёный» артефакт.
- `versionName` в `app/build.gradle` был `"1.0"` (шаблон `cap add android`):
  для релиза v1.5.0 исправлен на `"1.5.0"`, `versionCode` оставлен `1` (первая
  загрузка в Play; далее пользователь увеличивает вручную — отмечено в
  `KEYSTORE_SETUP.md` § 6).

### 3.3. Android SDK packages

- SDK-версии взяты из `web/android/variables.gradle`: `compileSdkVersion 35`,
  `targetSdkVersion 35`, `minSdkVersion 23` → в workflow
  `platform-tools platforms;android-35 build-tools;35.0.0`.
- Java 21 (temurin) совместим с Gradle 8.11.1 (wrapper) и AGP 8.7.2; JDK 17+
  обязателен для AGP 8.7. Локально в сессии JDK/Android SDK нет, поэтому
  Android-часть проверена статически (см. § 5).

### 3.4. AAB vs APK: проверка «разрешения в сборке»

- `aapt dump permissions <aab>` (как было в скетче) **не работает**: `aapt`
  читает APK, а AAB — это zip с `base/manifest/AndroidManifest.xml` в
  бинарном AXML. Скрипт с `2>/dev/null || true` всегда «успешен» → ложный
  зелёный.
- Замена: (1) `jarsigner -verify` (подпись); (2) грепы по **merged**
  `AndroidManifest.xml` из `build/intermediates` (CAMERA, INTERNET,
  READ_MEDIA_IMAGES — регрессия KI-646); при отсутствии merged-манифеста —
  `::warning::` и пропуск только этой проверки.

### 3.5. GitHub Actions: pnpm и кэш

- `pnpm/action-setup@v4` **без** `with: version` — версия берётся из
  `packageManager` (`pnpm@12.11.2`), иначе CI падает с
  `ERR_PNPM_BAD_PM_VERSION` (RULES 6.10). Именно этот стиль уже в `ci.yml`,
  поэтому workflow не вводит второй источник версии.
- `actions/setup-node@v4` с `cache: pnpm` требует установленный pnpm →
  порядок шагов «pnpm → node» (как в `ci.yml`); `cache-dependency-path:
  web/pnpm-lock.yaml`, потому что устанавливается только web-пакет (RULES 6.11).

### 3.6. Секреты и `.gitignore`

- До правки: `*.jks`/`*.keystore` уже игнорировались, а
  `# google-services.json` был **закомментирован** (шаблон Android
  gitignore) — файл мог попасть в коммит. После правки:
  `git check-ignore -v web/android/app/google-services.json` →
  `web/android/.gitignore:70:google-services.json`; для `release.keystore` →
  `.gitignore:60:release.keystore` (плюс покрыт `*.keystore`).
- В workflow секреты создаются **внутри job** и удаляются в
  `Cleanup secrets` (`if: always()`) — даже при падении сборки.

### 3.7. Состояние документации на входе (найдено при release-prep)

- `PROMPT_CURRENT.md` был сильно устаревшим: заголовок «v8.1», статус «после
  S9 (v0.11.0)», метрики 1359/395, §5.2 «High (3)» (все три уже `Fixed`),
  §6 — план v0.10.2/v0.11.0, «Итог: v0.11.0». В таблице истории версий —
  повреждённая строка с управляющим символом `U+0011` вместо `0.11.0`
  (последствие старой автозамены). Всё это исправлено (§ 1.C), кроме полного
  переписывания §1.3 (описательные пункты v0.11 оставлены, добавлены v1.2–v1.5).
- `docs/README.md` и `MANUAL_TESTING_GUIDE.md` расходились: сводка блоков
  148 кейсов против «Итого 129» в `docs/README` (отсутствовали блоки V0.11 и
  V1.3) — сведено к фактическим 158.
- `USER_GUIDE.md` содержал утверждения, противоречащие v1.4.0 («кнопки отмены
  нет», «сравнения запусков нет», KI-628 «шапка переполняется») — исправлено.
- `README.md` держал бейдж version-1.3.0 и метрики 1935/500 — обновлено.

## 4. Smoke (детально)

### 4.1. `cap sync android` (после `CAPACITOR=1`-сборки)

```
√ Copying web assets from dist to android\app\src\main\assets\public in 26.40ms
√ Creating capacitor.config.json in android\app\src\main\assets in 801.60μs
√ copy android in 46.50ms
√ Updating Android plugins in 4.52ms
[info] Found 5 Capacitor plugins for android:
       @capacitor-community/file-opener@7.0.1
       @capacitor-mlkit/barcode-scanning@7.5.0
       @capacitor/camera@7.0.5
       @capacitor/filesystem@7.1.9
       @capacitor/push-notifications@7.0.7
√ update android in 62.27ms
[info] Sync finished in 0.142s
```

Новых tracked-изменений в `web/android/` нет (в отличие от S3): плагины не
добавлялись, `capacitor.build.gradle`/`capacitor.settings.gradle` не менялись.

### 4.2. `cap doctor`

```
Latest Dependencies:    @capacitor/cli 8.6.0, core 8.6.0, android 8.6.0, ios 8.6.0
Installed Dependencies: @capacitor/cli 7.6.10, core 7.6.10, android 7.6.10,
                        @capacitor/ios not installed
[success] Android looking great! 👌
```

Предупреждение о Capacitor 8 — известный KI-649 (апгрейд вне S4).

### 4.3. Защита секретов (`git check-ignore -v`)

```
web/android/.gitignore:70:google-services.json	web/android/app/google-services.json
web/android/.gitignore:60:release.keystore	web/android/app/release.keystore
```

Файлы **не создавались**: `Test-Path web/android/app/google-services.json` →
`False`; `Test-Path web/android/app/release.keystore` → `False`.

### 4.4. Версии

```
package.json      → 1.5.0
web/package.json  → 1.5.0
web/android/app/build.gradle:
  versionCode 1
  versionName "1.5.0"
```

### 4.5. Сборки web: `dist/index.html` и версия в бандле

Web (`pnpm --dir web build`):
```html
<script type="module" crossorigin src="/assets/index-CAt1k2sQ.js"></script>
```

Capacitor (`$env:CAPACITOR='1'; pnpm --dir web build`):
```html
<script type="module" crossorigin src="./assets/index-DIkcknEn.js"></script>
```

`Select-String -Path web/dist/assets/index-*.js -Pattern '1\.5\.0'` → найдено
(`APP_VERSION` = `web/package.json`). В `android/app/src/main/assets/public`
лежит Capacitor-сборка (относительный `base`).

### 4.6. Валидация workflow (PyYAML)

```
keys: ['name', True, 'jobs']            # True — это `on:` (YAML 1.1)
name: Release Mobile (Android)
triggers: {'push': {'tags': ['v*']}, 'workflow_dispatch': None}
runs-on: ubuntu-latest | permissions: {'contents': 'write'}
steps: 14
 1 Checkout / actions/checkout@v4
 2 Setup pnpm / pnpm/action-setup@v4
 3 Setup Node.js / actions/setup-node@v4
 4 Install dependencies (web) / run
 5 Build web (Capacitor mode) / run
 6 Sync Capacitor Android / run
 7 Setup Java 21 / actions/setup-java@v4
 8 Setup Android SDK / android-actions/setup-android@v3
 9 Decode release keystore / run
10 Restore google-services.json / run
11 Build AAB (signed release) / run
12 Verify AAB (signed + permissions) / run
13 Upload AAB artifact / actions/upload-artifact@v4
14 Cleanup secrets / run
```

Полный реальный прогон невозможен (нет JDK/Android SDK и Secrets) → **KI-655**.

### 4.7. Ссылки в документации

Проверка всех относительных markdown-ссылок в 10 затронутых документах:
**0 битых** (единственным «битым» был линк на этот отчёт до его создания — файл
появился вместе с отчётом). Якорные ссылки гайдов проверены субагентом по
GitHub-slug: 0 неразрешённых.

### 4.8. `git status --short` (финал, коммитов нет, индекс пуст)

```
 M README.md
 M docs/CHANGELOG.md
 M docs/KNOWN_ISSUES.md
 M docs/README.md
 M docs/development/MOBILE_CAPACITOR_NESTJS.md
 M docs/development/PROMPT_CURRENT.md
 M docs/development/reports/README.md
 M docs/development/v1.5/DESIGN_V150_CAPACITOR.md
 M docs/qa/MANUAL_TESTING_GUIDE.md
 M docs/user_guide/USER_GUIDE.md
 M package.json
 M web/android/.gitignore
 M web/android/app/build.gradle
 M web/package.json
?? .github/workflows/release-mobile.yml
?? docs/development/reports/v1.5.0/S4-release-prep.md
?? docs/development/v1.5/FIREBASE_SETUP.md
?? docs/development/v1.5/KEYSTORE_SETUP.md
```

`git rev-parse --short HEAD` → `58d7eed`; `git diff --cached --name-only` →
пусто; `src/**` и `web/src/**` — без изменений.

### 4.9. Реестр KI — контрольный пересчёт (RULES 3.20)

```
^### KI-                       = 642
строк "**Статус:**"            = 642
уникальных номеров             = 642
разбивка: Open 281, Fixed 279, Documented 57, Fixed (частично) 12,
          Planned 5, Won't Fix 4, Deferred 3, Documented (не воспроизводится) 1
сумма                          = 642  (= 291/281/58/5/3/4/0 по базовым статусам)
"Сводка по статусам.0000"      = 0 вхождений
```

Было до S4-A: 641/641/641.

## 5. Что не так (все факты и расхождения)

1. **Обязательный пункт задания, выполненный иначе:** вместо
   `npm install -g pnpm` — `pnpm/action-setup@v4` без `with: version`.
   Причина: RULES 6.10 (единый источник версии — `packageManager`) и
   постоянство стиля с `ci.yml`; `npm install -g pnpm` поставил бы
   «последний» pnpm, не тот, что в `packageManager`.
2. **Проверка AAB переписана:** в скетче `aapt dump permissions <aab>` —
   невалидная операция (aapt читает APK), и `2>/dev/null || true` гарантировал
   ложный зелёный. Заменено на `jarsigner -verify` (подпись) + грепы разрешений
   по merged-манифесту; отсутствие merged-манифеста — `::warning::`, а не
   падение.
3. **Секреты пишутся через `printf '%s'`**, а не `echo`: `echo` может
   интерпретировать escape-последовательности (поведение зависит от shell
   и опций) — для JSON/base64 надёжнее `printf`. Добавлены `test -s` после
   записи.
4. **Путь к keystore — абсолютный.** В скетче
   `-Pandroid.injected.signing.store.file=release.keystore` при
   `working-directory: web/android` указывает в несуществующий путь
   (`web/android/release.keystore`), а файл лежит в `web/android/app/`.
   Injected signing резолвит relative-путь от каталога модуля — поэтому
   передаётся `${{ github.workspace }}/web/android/app/release.keystore`.
5. **`permissions: contents: write`** оставлено (как в задании) с комментарием,
   что для текущих шагов хватило бы `contents: read` — write понадобится
   только в S4-B (прикрепление AAB к GitHub Release). Это осознанное
   расширение прав по указанию автора задания.
6. **`bundleRelease` с inject-подписью не проверен прогоном** — нет JDK и
   Android SDK локально, Secrets не создаются по заданию. Заведён **KI-655**
   (Planned, S4-B) с планом проверки.
7. **`versionName` в `web/android/app/build.gradle` был `1.0`** (шаблон
   `cap add android`), хотя версия продукта — 1.5.0. Исправлено на `"1.5.0"`;
   `versionCode 1` оставлен (первая загрузка), правило «увеличивать
   `versionCode` перед каждой загрузкой» добавлено в `KEYSTORE_SETUP.md`.
   Это единственная правка в `web/android/`, не связанная с секретами.
8. **Обновлены гайды (`USER_GUIDE.md`, `MANUAL_TESTING_GUIDE.md`), хотя в
   задании их не было** — этого требует RULES 2.16 и `RELEASES.md` § 3
   («релиз без обновлённых гайдов не выпускается»). Заодно исправлены
   фактические противоречия: MANUAL/`docs/README` расходились в числе кейсов
   (148 vs 129), USER_GUIDE утверждал отсутствие отмены/сравнения запусков
   (есть с v1.4.0) и переполнение KI-628 (закрыт).
9. **`PROMPT_CURRENT.md` был устаревшим на несколько релизов** (v0.11-era:
   метрики 1359/395, High (3), план v0.10.2/v0.11.0). Обновлены метрики,
   статус, история, §5–§6; повреждённая строка истории с управляющим символом
   `U+0011` удалена. §1.3 (описательный список реализованного) не
   переписывался целиком — добавлены пункты v1.2–v1.5, старые оставлены.
10. **RULES 2.17: архив промптов.** По заданию `PROMPT_CURRENT` «заменяет
    v11.4», но файла `PROMPT_V11.md`/`PROMPT_V11.4.md` в репозитории нет
    (текущий файл уже содержал «Версия промпта: 12.0» при заголовке v8.1, то
    есть был частично обновлён без архивации). Архив не создавался — нечего
    переносить; расхождение зафиксировано здесь.
11. **`CHANGELOG.md`: секции `[1.2.0]`, `[1.1.0]`, `[1.4.0]`, `[1.3.0]` идут не
    по убыванию** (предсуществующий дефект v1.3/v1.4). Новая `[1.5.0]`
    поставлена корректно (после `[Unreleased]`), но переупорядочивание старых
    секций не делалось — вне scope и риск конфликтов.
12. **`docs/README.md` содержит «Open High 0»**, хотя KI-653 — High. Формально
    верно: его статус `Planned`, а «Open» — конкретный статус; в
    `PROMPT_CURRENT` добавлено уточнение («Open High 0; незакрытый High — 1:
    KI-653 Planned»). Если команда считает «Open High» синонимом
    «незакрытых High» — надо поменять формулировку в обоих файлах.
13. **Сводка KI в `KNOWN_ISSUES.md` имела арифметическую ошибку с прошлой
    сессии:** таблица и последняя строка говорили «639», хотя проза и
    фактические 641 сходились. Исправлено при добавлении KI-655 (теперь
    642 везде).
14. **Никаких реальных сборок AAB/APK не выполнялось** — Android-часть
    проверена статически (YAML, шаги, Gradle-версии, подпись-инъекция,
    SDK-пакеты). Первый реальный прогон — S4-B.
15. **`web/dist` оставлен в Capacitor-режиме** (`./assets/...`) — так его
    скопировал `cap sync`; перед `pnpm start` (SPA из backend) нужна обычная
    сборка `pnpm --dir web build` (или это делает Docker-пайплайн). Для AAB
    правильное состояние — именно текущее.
16. **Плагины `@capacitor/*` по-прежнему весят в web-бандле** (KI-651:
    vendor 154.46 kB) — в S4-A не оптимизировалось, перенесено в S4-B/1.6.
17. **`RELEASE_NOTES.md`** отсутствует в рабочем дереве (закоммичен в S3) —
    задание требовало «не коммитить» его; коммитов не было, файл не менялся.
18. **Условности GitHub Actions не проверены live:** в частности
    `android-actions/setup-android@v3` с `packages` (скачивает SDK),
    `pnpm/action-setup@v4` c `packageManager@12.11.2`, кэш `cache: pnpm`.
    Синтаксис валиден, но поведение подтвердится только первым прогоном
    (KI-655).

## 6. Новые KI

### KI-655 — `release-mobile.yml` не проверен реальным прогоном: AAB ещё не собирался

- **Приоритет:** 🟡 Medium | **Статус:** Planned | **Запланировано:** v1.5.0 (S4-B) | **Обнаружено:** 2026-11-09
- **Файлы:** `.github/workflows/release-mobile.yml`, `web/android/app/build.gradle`
- **Суть:** workflow добавлен и провалидирован только статически (структура
  YAML, шаги, shell-скрипты); локально в сессии нет JDK/Android SDK, а Secrets
  (keystore, `google-services.json`) по условию задачи не создаются. Первый
  прогон (`cap sync`, скачивание SDK, Gradle 8.11.1 + AGP 8.7.2,
  `bundleRelease` с inject-подписью) случится только в S4-B. Риски:
  совместимость Java/AGP, поведение `-Pandroid.injected.signing.*`, время
  сборки. Митигация в самом workflow: `jarsigner -verify` и проверки
  merged-манифеста падают явно.
- **Решение:** в S4-B после 5 Secrets прогнать `workflow_dispatch`, проверить
  `BUILD SUCCESSFUL`, `jar verified`, скачиваемость artifact
  `app-release-aab`; зафиксировать размер AAB и время сборки в отчёте S4-B.

**Других новых KI нет.** KI-653 (FCM без `google-services.json`) и KI-654
(иконка уведомления) заведены в S3 и остаются `Planned`/`Documented` — их
закрытие требует ручных шагов S4-B. Сводка реестра: 642/642/642.

## 7. Обоснование решений

1. **Почему именно 5 Secrets, а не `keystore.properties`.** Файл свойств
   пришлось бы коммитить (или генерировать в CI тем же способом), но тогда
   пароли попадают в репозиторий/логи; Secrets — единственный способ хранить
   их вне репозитория. Разделение на 4 keystore-секрета (base64, пароль
   хранилища, алиас, пароль ключа) — минимум, который требует injected
   signing: зашивать их одним JSON-блобом неудобно для ротации и для
   `keytool`-диагностики.
2. **`GOOGLE_SERVICES_JSON` как секрет, а не файл.** Файл содержит
   идентификаторы проекта (project number, app id, api key для FCM) — он
   привязан к Firebase-проекту и не должен попадать в git; при этом он не
   «секрет» в юридическом смысле, но раз он не нужен в репозитории, ему место
   в Secrets. В `FIREBASE_SETUP.md` прямо написано, что файл не коммитится.
3. **Почему `CAPACITOR=1` обязателен в CI.** `web/vite.config.ts` строит
   `base` условно: `'/'` для веб-сервера и `'./'` для WebView. В Capacitor
   WebView приложение открывается с `https://localhost`, и абсолютные
   `/assets/...` уходят в корень — белый экран (регрессия KI-647). Сборка без
   `CAPACITOR=1` прошла бы «успешно», сломав приложение только на устройстве,
   поэтому флаг стоит в самом workflow, а не в `.env`.
4. **Почему `Cleanup secrets` с `if: always()`.** Секреты распаковываются в
   файлы рабочего дерева job'а. При падении шагов (например, `bundleRelease`
   упал) последующие шаги по умолчанию не выполняются — без `always()`
   keystore и `google-services.json` остались бы на раннере до его уничтожения.
   `always()` гарантирует удаление при любом исходе; при этом шаг не маскирует
   падение — статус job определяется упавшим шагом.
5. **Почему `jarsigner`, а не `aapt`, и зачем проверять подпись.** AAB не APK:
   `aapt` с ним не работает, а «успешная» команда с `|| true` даёт ложный
   зелёный. `jarsigner -verify` отвечает на главный вопрос релиза — «подпись
   применилась?» — и ловит случай, когда inject-свойства не сработали
   (AGP собрал unsigned bundle, Play его отклонит). Проверка merged-манифеста
   защищает от регрессии KI-646 (CAMERA/ML Kit), которая иначе всплывёт только
   на устройстве.
6. **Почему `printf`, `test -s`, проверка пустых секретов.** В релизном
   пайплайне ошибка входа должна быть явной: пустой секрет → `::error::` и
   `exit 1` (а не сборка «пустого» файла и падение Gradle с невнятным
   сообщением); `printf '%s'` пишет base64/JSON побайтно; `test -s`
   подтверждает, что файл непустой.
7. **Почему `pnpm/action-setup@v4` + `cache: pnpm` + отдельный
   `cache-dependency-path`.** RULES 6.10 (единый источник версии pnpm), и web —
   самостоятельный пакет со своим lockfile (RULES 6.11): кэш привязан к
   `web/pnpm-lock.yaml`, а не к корневому.
8. **Почему `versionName` правлен в `app/build.gradle`, хотя задание этого не
   просило.** AAB наследует `versionName` из модуля; с шаблонным `1.0`
   Play Console показал бы приложение версии 1.0 при релизе 1.5.0 — это
   ошибка релизной подготовки, а не косметика. `versionCode 1` осознанно не
   менялся: первый мобильный релиз, монотонный рост — ответственность
   пользователя перед каждой загрузкой (описано в `KEYSTORE_SETUP.md`).
9. **Почему обновлены гайды и `README`/`docs/README` (RULES 2.16), хотя в
   чек-листе задания их не было.** `RELEASES.md` § 3 — release gate: релиз без
   актуализированных USER_GUIDE/MANUAL_TESTING_GUIDE не выпускается. Заодно
   устранены расхождения, которые сами по себе дефект документации (148 vs 129
   кейсов; противоречия v1.3 о функциональности v1.4).
10. **Почему `PROMPT_CURRENT` обновлён точечно, а не переписан.** Полный
    рерайт 400 строк — отдельная задача с риском потерять исторические
    детали; для релиза важны статус, метрики, открытые High, план и история
    версий. Они обновлены фактами (RULES 3.21 — цифры от grep, а не по
    памяти), а описательные разделы §1.3 пополнены.
11. **Почему KI-655 заведён, а не «оставлено на словах».** RULES 2.4: любая
    найденная проблема — запись в реестре. Непроверенный пайплайн — реальный
    риск релиза; KI-655 фиксирует, что именно проверить первым в S4-B, и
    спасает следующую сессию от иллюзии «CI готов».
12. **Почему `contents: write` не заменён на `read`.** Задание фиксировало
    write «на будущее» (S4-B: прикрепление AAB/Release Notes к GitHub
    Release). Расширенные права не нужны текущим шагам, но менять
    согласованное поведение без запроса не стал; в отчёте это отмечено явно.
13. **Почему секреты не создавались и `google-services.json`/keystore не
    появились в дереве.** Это данные пользователя (Firebase-проект, ключ
    подписи) и команда инструкций S4-B; создание фиктивных файлов дало бы
    «зелёную» сборку с нерабочим push и чужим/потерянным ключом подписи —
    хуже, чем честный `registrationError` (KI-653) и явная ошибка отсутствия
    секрета в CI.
