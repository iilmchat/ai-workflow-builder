---
title: "S5-B: Release Finalization (v1.5.0)"
date: 2026-11-09
version: v1.5.0
steps: [S5-B]
status: accepted
related_ki: [KI-658, KI-659, KI-660, KI-661, KI-662, KI-663, KI-664, KI-665]
related_adr: []
---

# S5-B: Release Finalization (v1.5.0)

Закрытие блокеров публикации v1.5.0 в RuStore: origin backend для release-AAB,
триггер push, брендовые иконки лаунчера, лишние разрешения и документация
ограничения QR/GMS. Всё — в рабочем дереве, **без коммита** (коммитит
пользователь).

## 1. Файлы (+/−)

Числа — из `git diff --numstat` на момент отчёта; для бинарных PNG указан
размер, а не строки.

### Код и конфигурация

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `web/src/lib/api-base.ts` | новый | 105 / 0 | `getApiBase()`, `apiUrl()`, `resolveApiUrl()`, `normalizeApiBase()`; `VITE_API_BASE` только в native, `console.error` при пустом значении (KI-658) |
| `web/src/lib/api-base.spec.ts` | новый | 104 / 0 | 5 тестов: web/native, пустой env, нормализация слэшей, `apiUrl`/`resolveApiUrl` |
| `web/src/lib/api.ts` | изменён | 4 / 6 | убран `API_BASE = ''`; `fetch(apiUrl(url))` в `sendAsync`; JSDoc (KI-658) |
| `web/src/lib/run-stream.ts` | изменён | 9 / 3 | SSE через `apiUrl(...)`: в native уходит на backend, а не в `https://localhost` |
| `web/src/hooks/useFileDownload.ts` | изменён | 5 / 1 | `fetch(resolveApiUrl(url))` — нативное скачивание DOCX/PDF |
| `web/src/lib/media-source.ts` | изменён | 5 / 1 | `src` относительного `/media/file/...` получает базу в native |
| `web/src/lib/api.spec.ts` | изменён | 36 / 0 | мок `@/lib/platform` + 2 интеграционных теста `requestAsync` с `VITE_API_BASE` |
| `web/src/vite-env.d.ts` | изменён | 12 / 0 | тип `VITE_API_BASE` |
| `src/main.ts` | изменён | 11 / 0 | `app.enableCors({ origin: true })` + комментарий про Capacitor (KI-658) |
| `src/config/env.schema.ts` | изменён | 30 / 0 | `PUSH_ON_RUN_COMPLETE` (default `true`), `PUSH_ON_RUN_COMPLETE_SUCCESS` (default `false`), строгий boolean (RULES 4.35) |
| `src/config/env.schema.spec.ts` | изменён | 39 / 2 | 2 теста push-флагов; два ожидания `WorkerEnvSchema` переведены на `toMatchObject` (RULES «тесты») |
| `src/runs/runs.processor.ts` | изменён | 114 / 1 | DI `DeviceTokensService`/`ConfigService`, `notifyRunFinishedAsync`, вызов после финального `run_completed` (KI-659) |
| `src/runs/runs.processor.spec.ts` | изменён | 21 / 2 | моки новых зависимостей, пустая цепочка для второго SELECT, `innerJoin` в chain |
| `src/runs/runs.processor.push.spec.ts` | новый | 325 / 0 | 6 тестов: failed/completed/оба флага, reject push, сбой SELECT владельца |
| `src/runs/runs.module.ts` | изменён | 5 / 0 | `NotificationsModule` в `imports` (KI-659) |
| `.env.example` | изменён | 6 / 0 | описание `PUSH_ON_RUN_COMPLETE*` |
| `.github/workflows/release-mobile.yml` | изменён | 15 / 2 | `VITE_API_BASE: ${{ vars.VITE_API_BASE }}`; проверка отсутствия storage-разрешений (KI-663) |
| `web/android/app/src/main/AndroidManifest.xml` | изменён | 6 / 2 | удалены `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` + комментарий-обоснование (KI-663) |

### Иконки, splash, исходник

| Файл | Статус | Объём | Что именно |
|---|---|---:|---|
| `web/resources/icon.png` | новый | 58 942 B | копия `assets/rustore/icon-1024x1024.png` — исходник `@capacitor/assets` |
| `web/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher*.png` | 15 изменено | binary | `ic_launcher`, `ic_launcher_round`, `ic_launcher_foreground` из брендового логотипа (KI-662) |
| `web/android/app/src/main/res/mipmap-ldpi/ic_launcher*.png` | 3 новых | binary | ldpi-плотность, которой раньше не было |
| `web/android/app/src/main/res/drawable*/splash.png` | 11 изменено + 15 новых | binary | брендовый splash (включая night/ldpi-варианты), фон `#FEF3E7` |
| `web/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml` | 2 изменено | 8 / 12 | adaptive: `@color/ic_launcher_background` + `@mipmap/ic_launcher_foreground` |
| `web/android/app/src/main/res/values/ic_launcher_background.xml` | изменён | 4 / 1 | цвет фона `#FFFFFF` → `#FEF3E7` |

### Документация

| Файл | Статус | Строк (+/−) | Что именно |
|---|---|---:|---|
| `docs/development/v1.5/RUSTORE_SETUP.md` | изменён | 175 / 14 | разделы «Backend origin», «Push: триггер отправки», «Разрешения»; шаг 3 — две переменные |
| `docs/development/v1.5/RUSTORE_PUBLISH.md` | изменён | 85 / 45 | B-1/B-2/B-4/B-5 закрыты, B-7 → «Известные ограничения»; QR/GMS в § 2.2; описание 3358/4000; чек-листы |
| `docs/KNOWN_ISSUES.md` | изменён | 176 / 15 | зарегистрированы KI-658…663, новые KI-664/665, сводка пересчитана (652) |
| `docs/CHANGELOG.md` | изменён | 57 / 0 | `[Unreleased]`: Added/Changed/Removed/Fixed/Documented по S5-B |
| `docs/development/reports/README.md` | изменён | 1 / 0 | строка индекса S5-B |
| `docs/development/reports/v1.5.0/S5-B-release-finalization.md` | новый | этот файл | отчёт |

**Итого по `git diff --stat`:** 49 файлов изменено, +819/−98 строк;
`git status --short --untracked-files=all` — 72 позиции, из них 23 untracked
(отчёт, `api-base.ts`/`api-base.spec.ts`, `runs.processor.push.spec.ts`,
`web/resources/icon.png` и 19 новых PNG-ассетов: splash/ldpi). Полный
`git status` — в сообщении пользователю.

### Не изменялось

- **KI-661** (удаление аккаунта + согласие на ПД) — осознанно вне S5-B, план —
  S6. В коде `src/auth/**`, `web/src/pages/**`, `LoginPage.tsx` правок нет.
- **`docs/development/MOBILE_CAPACITOR_NESTJS.md`** — по условию задачи
  pre-existing изменение. На факте HEAD файл **чист** (`git status` его не
  показывает), правок в него не вносилось.
- `web/capacitor.config.ts`, `web/android/build.gradle`, версия SDK RuStore,
  `minSdkVersion` (B-6) — не трогались.

### Временные скрипты

Скриптов в репозитории не создавалось. В `%TEMP%\dsh-s5b\` лежали только
логи/артефакты проверок (`gradle-manifest.log`, `backend-test.log`,
`web-test.log`, `backend-3001*.log`, `old-ic-launcher.png`); каталог удалён
после прогона (RULES 3.13).

## 2. Build / test

| Команда | Результат |
|---|---|
| `pnpm build` | exit 0, 0 ошибок (`nest build`) |
| `pnpm test` | **1984 passed**, 26 skipped, 128 файлов passed + 4 skipped, exit 0 (до S5-B — 1976, +8) |
| `pnpm typecheck` (`tsc -p tsconfig.spec.json --noEmit`) | exit 0 |
| `pnpm --dir web build` (без `CAPACITOR`) | ✓ built ~505 мс; origin `https://api.example.com` в бандле **отсутствует** (regex `https://api\.example\.com(?![/\w.-])` → 0; в бандле только i18n-placeholder `/items`) |
| `CAPACITOR=1`, `VITE_API_BASE=https://api.example.com`, `pnpm --dir web build` | ✓ built ~505 мс; origin **есть** — строка `https://api.example.com` в `index-*.js` (рядом с `getApiBase`) |
| `pnpm --dir web test` | **577 passed**, 64 файла, exit 0 (до S5-B — 570, +7) |
| `pnpm --dir web exec cap sync android` | Sync finished 0.229 с; 4 плагина (`file-opener`, `barcode-scanning`, `camera`, `filesystem`) |
| `npx @capacitor/assets@4.0.0 generate --android …` | 74 ассета, 1.37 MB; в `package.json` не добавлен |
| `gradlew :app:processDebugMainManifest` | см. § 3/§ 5: merged-манифест локально не собран (Gradle distribution) |

## 3. Диагностика

**Версии.**

- Node **v24.21.0**, pnpm **12.14.0** (`packageManager` в `package.json` —
  `pnpm@12.11.2`);
- JDK **21.0.13+8-LTS** (Microsoft OpenJDK), `JAVA_HOME` — JDK 21;
- Android SDK: `D:\Dev\Android\Sdk` (`ANDROID_HOME`/`ANDROID_SDK_ROOT`),
  compileSdk/targetSdk 35, build-tools 35.0.0 (`web/android/variables.gradle`);
- `@capacitor/assets` **4.0.0** (через `npx --yes`, в зависимости не добавлен);
  `@capacitor/core` **7.6.10**, `@capacitor/camera` 7.0.5,
  `@capacitor/filesystem` 7.1.9.

**`VITE_API_BASE` в бандле.** Сборка Capacitor-режима, затем поиск по
`web/dist/assets/*.js` с negative lookahead, чтобы не спутать с i18n-примером
`https://api.example.com/items` из подсказки HTTP-узла:

```powershell
$files = Get-ChildItem web/dist/assets/*.js
$files | Select-String -Pattern 'https://api\.example\.com(?![/\w.-])'
# Capacitor-сборка: 1 совпадение — et(`https://api.example.com`)
# Обычная сборка: 0 совпадений
```

**CORS (реальный запуск).** Собранный backend поднят на **3001** с изолированной
очередью (`BULLMQ_PREFIX=dsh-s5b-check`, `REDIS_QUEUE_DB=15`,
`INSTANCE_ID=dsh-s5b-check`), чтобы не трогать очередь dev-инстанса на 3000.
Проверки `curl.exe`:

```text
GET /llm/models  Origin: https://localhost
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://localhost
Vary: Origin

OPTIONS /workflow  (preflight, ACRM=POST, ACRH=authorization,content-type)
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://localhost
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: authorization,content-type
```

То есть `origin: true` отражает `https://localhost` (Capacitor Android), а
`Authorization: Bearer` проходит preflight. Процесс остановлен, порт 3001
освобождён; dev-инстанс на 3000 не трогался.

**Merged-манифест.** После `cap sync android` локальной сборки
`web/android/app/build/intermediates/merged_manifests/debug/AndroidManifest.xml`
не было (каталог `app/build` отсутствовал). Попытка
`gradlew :app:processDebugMainManifest --no-daemon` не завершилась: Gradle
wrapper не смог скачать/разблокировать `gradle-8.11.1-all.zip`
(`Timeout of 120000 reached waiting for exclusive access to file …`,
`.part` — 0 байт). Статически проверен исходный
`web/android/app/src/main/AndroidManifest.xml`: storage-разрешений нет;
`INTERNET`, `CAMERA`, `POST_NOTIFICATIONS`, `uses-feature camera
required=false` на месте. Плагины (`camera`, `filesystem`, `barcode-scanning`,
`@capacitor/android`) своих storage-разрешений не объявляют — проверено их
`AndroidManifest.xml` в `web/node_modules/.pnpm`. Финальную проверку
merged-манифеста делает CI-шаг `Verify AAB (signed + permissions)`.

**Иконки.** SHA-256 `mipmap-xxxhdpi/ic_launcher.png`: HEAD
`87CB2F2F…42B0761` (9 441 B) → новый `6F73C23C…97D636B2` (17 399 B); файлы
различаются, визуально — тот же логотип, что `assets/rustore/icon-512x512.png`
(проверено `read_image`). `ic_launcher.xml`/`ic_launcher_round.xml` ссылаются
на `@color/ic_launcher_background` (`#FEF3E7`) и
`@mipmap/ic_launcher_foreground`.

## 4. Smoke

| Проверка | Результат |
|---|---|
| Unit `getApiBase` (web / native+пусто / native+URL) | 5/5 passed (`web/src/lib/api-base.spec.ts`) |
| `requestAsync` + `getApiBase` (web/native) | 2/2 passed (`api.spec.ts`) |
| Unit push-триггера (failed/completed/флаги/reject/сбой SELECT) | 6/6 passed (`runs.processor.push.spec.ts`) |
| Env-флаги (`'true'`/`'false'`/`'garbage'`, дефолты) | 2/2 passed (`env.schema.spec.ts`) |
| `pnpm --dir web build` без `CAPACITOR` | успешно, origin отсутствует |
| `CAPACITOR=1 VITE_API_BASE=… pnpm --dir web build` | успешно, origin в бандле |
| `pnpm --dir web exec cap sync android` | успешно, 4 плагина |
| CORS: GET и preflight с `Origin: https://localhost` | 200/204, `Access-Control-Allow-Origin: https://localhost`, `Authorization` разрешён |
| Android-манифест: нет `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE` | подтверждено `Select-String` (0 совпадений) |
| Иконки: `xxxhdpi/ic_launcher.png` отличается от HEAD | SHA-256 и размер различаются; логотип брендовый |
| Adaptive icon XML | `@mipmap/ic_launcher_foreground` + `@color/ic_launcher_background` |
| `npx @capacitor/assets@4.0.0 --version` | 4.0.0 |
| `npx cap sync android` (merged-манифест) | sync успешен; Gradle-сборка манифеста локально не прошла (см. § 5) |

## 5. Что не так

- **KI-661 не входит в S5-B.** Удаление аккаунта внутри приложения и согласие на
  обработку ПД не реализованы — это блокер публикации RuStore п. 5.4 и ФЗ-152.
  Осознанно вынесен в S6 (auth + UI + юридический документ); в реестре
  зарегистрирован как `Open` с планом S6, в `RUSTORE_PUBLISH.md` остаётся B-3.
- **B-6 (`minSdkVersion = 23`) не менялся.** RuStore рекомендует Android 8.0
  (API 26); поднятие minSdk — отдельное решение, в S5-B не входило.
- **KI-664 (новый): refresh-cookie не работает из WebView.** `SameSite=Strict`
  + разные сайты (`https://localhost` → `https://api.example.com`) → cookie не
  отправляется; `POST /auth/refresh` из приложения не восстановит сессию.
  Вход и запросы живут до истечения access-токена (в примере 24 ч), затем нужен
  повторный вход. Альфа-тестирование (вход + push) это не блокирует, но для
  релиза нужно решение (S6+).
- **KI-665 (новый): QR без GMS — молчаливый no-op.** `scanQr()` возвращает
  `null`, `TopBar` считает это отменой; пользователь не видит объяснения.
  Документировано как ограничение, UI-сообщения нет.
- **QR-плагин не заменён** на bundled ML Kit — S6+ (по условию задачи).
- **Merged-манифест локально не получен.** Gradle wrapper завис на скачивании
  `gradle-8.11.1-all.zip` (timeout 120 с на lock, `.part` 0 байт; сеть до
  `services.gradle.org` отвечает 200 — вероятно, блокировка большого файла/
  антивирус). Проверка «нет storage-разрешений» сделана по исходному манифесту
  и манифестам плагинов; CI дополнительно валидирует merged-манифест и упадёт,
  если запрещённое разрешение появится.
- **Сигнатура `sendToUserAsync` — позиционная, а не объект.** В ТЗ вызов
  описан как `sendToUserAsync(userId, { title, body, data })`, но фактический
  метод (S4-B) принимает `(userId, title, body, data?)`. Использована
  существующая сигнатура, чтобы не менять публичный контракт сервиса и его
  тесты; в отчёте это зафиксировано явно.
- **`VITE_API_BASE` должен быть origin'ом без `/api`.** Если задать URL с
  путём, запросы уйдут на `…/api/workflow`; это описано в `RUSTORE_SETUP.md`,
  но код не отрезает `/api` автоматически (осознанно: не угадываем структуру
  деплоя).
- **CORS проверен на локально собранном backend, не на прод-стенде.** Если перед
  backend стоит nginx, он должен пропускать заголовок `Origin`; это
  эксплуатационное требование, зафиксировано в `RUSTORE_SETUP.md`.

## 6. Новые KI

Реестр на HEAD не содержал KI-658…663 (они были только в таблице отчёта S5-A),
поэтому в S5-B они **зарегистрированы** и закрыты/задокументированы:

- **KI-658** — `API_BASE = ''` → `Fixed`;
- **KI-659** — push-триггер → `Fixed`;
- **KI-660** — QR/GMS → `Documented`;
- **KI-661** — удаление аккаунта/ПД → `Open` (S6, вне S5-B);
- **KI-662** — иконки лаунчера → `Fixed`;
- **KI-663** — лишние разрешения → `Fixed`.

Новые по ходу S5-B:

- **KI-664** (Medium, `Open`, S6+) — refresh-cookie `SameSite=Strict` не
  отправляется из Capacitor WebView;
- **KI-665** (Low, `Open`, S6+) — QR без GMS: кнопка молча ничего не делает.

Сводка `KNOWN_ISSUES.md` пересчитана grep'ом (RULES 3.20): **652** вхождения
`### KI-`, **652** строки статуса, **652** уникальных номера; сумма по
статусам — 652 (Fixed 285 + Fixed(частично) 12 + Open 284 + Documented 58 +
Documented(не воспроизводится) 1 + Planned 5 + Deferred 3 + Won't Fix 4).

## 7. Обоснование решений

- **`VITE_API_BASE`, а не `server.url`.** `server.url` заставляет WebView
  загружать SPA с dev-сервера: это удобно локально, но для альфа-тестирования
  означает зависимость от машины разработчика и ломает офлайн-загрузку
  ассетов. `VITE_API_BASE` — build-time origin, который попадает в AAB и
  работает с любым HTTPS-деплоем; изменять `capacitor.config.ts` не пришлось.
- **`origin: true`, а не allowlist.** Auth идёт через `Authorization: Bearer`,
  cookie-CORS-обмена нет (refresh-cookie всё равно не проходит из-за
  `SameSite=Strict`, KI-664), а origin'ов ровно два: `https://localhost` и
  `capacitor://localhost`. Отражать запрошенный `Origin` проще и не ломается при
  смене схемы; allowlist добавил бы конфиг без выигрыша для MVP. Проверено
  preflight'ом с `Authorization`.
- **Push fire-and-forget, а не `await`.** HTTP-запрос к RuStore (таймаут 10 с)
  не должен задерживать освобождение job'а и тем более менять его исход; при
  `await` ошибка доставки могла бы превратить успешный запуск в retry. Ошибка
  логируется, `run_completed` уже опубликован.
- **Push только на финальной попытке.** `RunsProcessor` — единственное место,
  знающее `final`; иначе промежуточный `failed` перед retry дал бы ложное
  «запуск упал».
- **JOIN `workflow_runs → workflows` для владельца.** В `workflow_runs` нет
  `user_id` (владелец — `workflows.user_id`), а имя workflow нужно для тела
  уведомления; один JOIN дешевле двух запросов и не тянет `snapshot`.
- **`@capacitor/assets`, а не ручной `sharp`.** Инструмент сам считает
  плотности/adaptive-icon/round/splash и не требует добавлять зависимость в
  `package.json` (`npx --yes`). Ручной скрипт пришлось бы поддерживать и
  проверять на всех плотностях; fallback не понадобился.
- **`res`-фон `#FEF3E7` + `@color`, а не вторая PNG-подложка.** Брендовый
  логотип уже на кремовом фоне; adaptive-фон того же цвета делает foreground
  бесшовным без генерации `ic_launcher_background.png` на каждую плотность
  (сгенерированные тулзой PNG-подложки удалены как неиспользуемые).
- **KI-661 вынесен в S6.** Удаление аккаунта — это серверная ручка
  удаления/обезличивания + UI + политика; смешивать с release-finalization
  нельзя (риск сломать auth перед тегом). Блокер зафиксирован, а не «закрыт»
  документом.
- **KI-660 только текстом.** Замена QR-плагина на bundled ML Kit меняет
  нативную зависимость и требует device-smoke; для альфа-тестирования
  достаточно честно ограничить фичу в описании (требование RuStore п. 6.4 —
  не описывать недоступное).
- **`toMatchObject` в тестах.** В `WorkerEnvSchema` добавлены поля; сравнение
  через `toEqual` ломалось бы при каждом новом флаге. Ожидания переведены на
  `toMatchObject`, как требует RULES.
