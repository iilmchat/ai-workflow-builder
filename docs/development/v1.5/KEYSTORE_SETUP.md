# Keystore Setup — подпись Android-приложения

**Файл:** `docs/development/v1.5/KEYSTORE_SETUP.md`
**Для:** v1.5.0+ (сборка подписанного AAB для магазина приложений — RuStore / Google Play).
**Связанные:** `.github/workflows/release-mobile.yml`, `v1.5/RUSTORE_SETUP.md` (push), DESIGN v1.5 § S4.

---

## Зачем

Google Play принимает только **подписанный** AAB. Без keystore сборка
`bundleRelease` упадёт. **Крайне важно:** потеря keystore = невозможность
обновить приложение в Google Play для тех, кто уже установил (нужен новый
package name).

Подпись нужна не только магазину: push через RuStore доставляется только тогда,
когда отпечаток подписи **установленного** приложения совпадает с отпечатком,
указанным в RuStore Console (см. `v1.5/RUSTORE_SETUP.md`). Поэтому keystore —
часть конфигурации push, а не только релизного пайплайна.

**Никогда не коммить keystore в git.** Он в `web/android/.gitignore`.

---

## Шаг 1. Сгенерировать keystore (один раз, локально)

```powershell
# Создать в безопасном каталоге (не в репозитории!)
cd C:\Users\YOUR_USER\.keystores
keytool -genkeypair -v `
  -keystore ai-workflow-builder.keystore `
  -alias ai-workflow-builder `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000 `
  -storetype PKCS12
```

**Параметры:**
- `-keystore ai-workflow-builder.keystore` — имя файла (запомни).
- `-alias ai-workflow-builder` — алиас (запомни, пойдёт в Secrets).
- `-validity 10000` — ~27 лет (Google требует минимум 25 после 2033).
- `-storetype PKCS12` — современный формат (не JKS).

**Ответь на вопросы:**
- First and last name: можно любое (не отображается пользователю).
- Organizational unit / Organization: `IIChatTools` (или любое).
- City / State / Country code: любые валидные.
- Password: **запиши в 1Password / Bitwarden**.

## Шаг 2. Base64 для GitHub Secrets

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\YOUR_USER\.keystores\ai-workflow-builder.keystore")) | Set-Clipboard
```

**Или через Linux/macOS:**

```bash
base64 -w 0 ai-workflow-builder.keystore | pbcopy
```

Скопируй в буфер — это `ANDROID_KEYSTORE_BASE64`.

## Шаг 3. Добавить GitHub Secrets

GitHub → репозиторий → Settings → Secrets and variables → Actions → New
repository secret:

| Secret | Значение |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | из шага 2 |
| `ANDROID_KEYSTORE_PASSWORD` | пароль keystore (шаг 1) |
| `ANDROID_KEY_ALIAS` | `ai-workflow-builder` |
| `ANDROID_KEY_PASSWORD` | пароль ключа (обычно = пароль keystore) |

**Проверка:**
- Secrets → должно быть **4** записи (keystore).
- Repository secrets доступны всем workflow.

**Отдельно — Project ID RuStore (не секрет).** Для push-уведомлений web-сборке
нужен Project ID из RuStore Console, но это **переменная**, а не секрет:
GitHub → Settings → Secrets and variables → Actions → **Variables** → New
repository variable `RUSTORE_PROJECT_ID`. Workflow передаёт её в сборку как
`VITE_RUSTORE_PROJECT_ID` (значение попадает в JS-бандл). Как получить Project
ID и Service Token — `v1.5/RUSTORE_SETUP.md`.

Секрета `GOOGLE_SERVICES_JSON` больше **нет**: после миграции на RuStore Push
файл `google-services.json` в сборке не используется.

## Шаг 4. Собрать AAB локально (проверка перед CI)

```powershell
$env:CAPACITOR='1'; pnpm --dir web build; Remove-Item Env:CAPACITOR
pnpm --dir web exec cap sync android

cd web/android
.\gradlew.bat bundleRelease `
  -Pandroid.injected.signing.store.file=C:\Users\YOUR_USER\.keystores\ai-workflow-builder.keystore `
  -Pandroid.injected.signing.store.password=YOUR_PASSWORD `
  -Pandroid.injected.signing.key.alias=ai-workflow-builder `
  -Pandroid.injected.signing.key.password=YOUR_KEY_PASSWORD
```

**Ожидаемо:** `BUILD SUCCESSFUL`; файл
`app/build/outputs/bundle/release/app-release.aab`.

## Шаг 5. Запустить CI-сборку

```powershell
git tag v1.5.0
git push origin v1.5.0
```

GitHub Actions запустит `.github/workflows/release-mobile.yml`. Artifact
`app-release-aab` появится в Actions → завершённый job.

## Шаг 6. Загрузить в Google Play Console

> **Версия приложения.** В `web/android/app/build.gradle`:
> `versionCode 1`, `versionName "1.5.0"`. Google Play требует, чтобы
> `versionCode` **рос с каждой загрузкой** — перед следующим релизом увеличь
> его вручную (и синхронизируй `versionName` с `package.json`).

1. https://play.google.com/console → создать приложение (если ещё нет).
2. Internal testing → Create new release → Upload `app-release.aab`.
3. Заполнить:
   - Release notes (для каждой локали).
   - Data safety declaration (что собираешь).
   - Privacy Policy URL.
   - Target audience.
4. Review → Rollout.

**После первого Rollout в Internal testing** — приложение можно установить по
ссылке, добавить тестировщиков.

> **RuStore.** Тот же подписанный AAB/APK загружается в RuStore Console
> (консоль разработчика → приложение → загрузка сборки → модерация). Отпечаток
> подписи, указанный в проекте push (Push-уведомления → Проекты), должен
> совпадать с подписью загруженной сборки, иначе push не доставится — см.
> `v1.5/RUSTORE_SETUP.md`.

## Бэкап

**Обязательно** сохрани keystore и пароли в 1Password/Bitwarden. Если
потеряешь:
- AAB с новым ключом → магазин **не примет** (signature mismatch), а push
  перестанет доходить до установленных приложений.
- Пользователи с прошлой установкой не смогут обновиться.

## Troubleshooting

| Проблема | Решение |
|---|---|
| `keytool: command not found` | Установи JDK 21, добавь в PATH |
| `Failed to read key from store` | Неверный пароль или алиас |
| `AAB rejected by Google` | Проверь `targetSdkVersion` (34+), signature, Data safety |
| CI падает `keystore not found` | `ANDROID_KEYSTORE_BASE64` не задан или битый base64 |
| Push не приходит на устройство, хотя токен зарегистрирован | Подпись установленной сборки ≠ отпечаток в RuStore Console: собрать релиз тем же ключом или создать проект push под фактическую подпись (`v1.5/RUSTORE_SETUP.md`) |
