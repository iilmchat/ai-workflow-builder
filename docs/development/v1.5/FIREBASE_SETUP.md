# Firebase Setup — Push Notifications (Android)

**Файл:** `docs/development/v1.5/FIREBASE_SETUP.md`
**Для:** v1.5.0+ (Capacitor + `@capacitor/push-notifications`).
**Связанные:** KI-653 (push без Firebase), DESIGN v1.5 § S4.

---

## Что нужно

`@capacitor/push-notifications` на Android работает только через Firebase Cloud
Messaging (FCM). Без файла `google-services.json` плагин Gradle **не
применяется** (`web/android/build.gradle:48–53`), `FirebaseApp` не
инициализируется, `register()` возвращает `registrationError`. Приложение
собирается, но push не работают.

**Важно:** `google-services.json` содержит идентификаторы Firebase-проекта (не
секрет в юридическом смысле, но привязан к проекту — **не коммить в git**, он в
`web/android/.gitignore`).

---

## Шаг 1. Создать Firebase-проект

1. Открой https://console.firebase.google.com/
2. «Создать проект» → имя (например, `ai-workflow-builder`) → регион.
3. Google Analytics — опционально (можно выключить).

## Шаг 2. Добавить Android-приложение

1. В Firebase-проекте → «Обзор проекта» → «+ Добавить приложение» → Android.
2. **Android package name:** `com.iilmchat.workflowbuilder` — должен **точно**
   совпадать с `appId` из `web/capacitor.config.ts` (иначе Gradle-плагин
   упадёт).
3. **SHA-1** — опционально (нужен для Google Sign-In, для FCM не требуется).
4. «Зарегистрировать приложение».

## Шаг 3. Скачать `google-services.json`

1. «Скачать google-services.json».
2. Положить файл в `web/android/app/google-services.json`.

**Проверка:**

```powershell
Test-Path web/android/app/google-services.json
# → True
```

## Шаг 4. Собрать и запустить

**Локально (нужен Android Studio):**

```powershell
$env:CAPACITOR='1'; pnpm --dir web build; Remove-Item Env:CAPACITOR
pnpm --dir web exec cap sync android
pnpm --dir web exec cap open android
# В Android Studio: Run 'app' на устройстве с Google Play Services
```

**Через CI:** добавь `google-services.json` в GitHub Secrets как
`GOOGLE_SERVICES_JSON`:

```powershell
Get-Content web/android/app/google-services.json -Raw | Set-Clipboard
# GitHub → Settings → Secrets and variables → Actions → New repository secret
# Name: GOOGLE_SERVICES_JSON
# Value: (вставь из буфера)
```

## Шаг 5. Проверить, что токен дошёл

1. Открой приложение на устройстве, залогинься.
2. Посмотри `adb logcat | Select-String "push"` — должно быть `[push] received`.
3. Проверь БД:

```sql
SELECT * FROM device_tokens ORDER BY created_at DESC LIMIT 5;
```

Должна появиться строка с `platform='android'` для твоего пользователя.

4. Отправь тестовый push через Firebase Console → Messaging → «Пробное
   сообщение»:
   - FCM-токен: из лога (`[push] token = ...`).
   - Должно прийти в течение 30 секунд.

## Troubleshooting

| Проблема | Решение |
|---|---|
| `registrationError` в логе | `google-services.json` не там или package name не совпадает |
| Токен не приходит | Google Play Services на устройстве/эмуляторе |
| Push приходит, но пустое уведомление | KI-654: иконка уведомления (S4-B) |
| `google-services.json not found` в Gradle | Файл не в `web/android/app/` |
| `plugin not applied` | package name ≠ `appId` |

## Ссылки

- [Firebase Console](https://console.firebase.google.com/)
- [@capacitor/push-notifications](https://capacitorjs.com/docs/apis/push-notifications)
