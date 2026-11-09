import { registerDeviceTokenAsync } from '@/lib/api';
import { isNative } from '@/lib/platform';
import {
  RUSTORE_PROJECT_ID,
  getRuStoreTokenAsync,
  initRuStorePushAsync,
} from '@/lib/rustore-push';

/**
 * Флаг инициализации (v1.5.0 S3; S4-B — RuStore Push вместо FCM).
 *
 * `App` рендерится внутри `StrictMode` (`web/src/main.tsx`), поэтому эффект
 * монтирования в dev-режиме вызывается дважды, а после logout→login — ещё
 * раз. Повторная инициализация SDK и повторный `POST /notifications/register`
 * для того же устройства не нужны: guard делает инициализацию идемпотентной.
 *
 * Сбрасывается только перезагрузкой WebView (переустановка приложения,
 * смена пользователя без перезапуска — вне S4-B).
 */
let initialized = false;

/**
 * Инициализирует RuStore Push и регистрирует токен устройства
 * (v1.5.0 S3, DESIGN V150 § 3.3; S4-B — миграция FCM → RuStore Push).
 *
 * Порядок шагов важен:
 * 1. вне нативного приложения ничего не делает — RuStore Push требует
 *    Android-оболочки, в браузере его нет;
 * 2. если `VITE_RUSTORE_PROJECT_ID` не задан, SDK не трогаем: WARN и выход
 *    (ON/OFF без пересборки логики и без падений, RULES 4.18);
 * 3. инициализирует SDK (`initRuStorePushAsync` → `RuStorePushClient.init`) —
 *    внутри нативного плагина на Android 13+ ещё и запрашивается
 *    runtime-разрешение `POST_NOTIFICATIONS`;
 * 4. **после** инициализации запрашивает токен (`getRuStoreTokenAsync` →
 *    `RuStorePushClient.getToken`): у RuStore нет push-события `registration`,
 *    как у FCM, токен выдаётся по запросу;
 * 5. пустой/`null` токен — WARN и выход, `registerDeviceTokenAsync` не
 *    вызывается (пустой токен бэкенд всё равно отклонил бы по Zod-схеме);
 * 6. отправляет токен на `POST /notifications/register` с платформой
 *    `android`: RuStore Push есть только на Android, iOS-ветка появится
 *    вместе с iOS-сборкой.
 *
 * Ошибки сети/инициализации/токена не пробрасываются: это фоновая
 * инициализация, которую вызывает `App` на старте, и падение не должно ломать
 * экран (RULES 4.18 — причина пишется в консоль).
 *
 * @returns промис, который завершается после попытки регистрации токена (или
 *   раньше, если платформа не нативная, проект не настроен либо токена нет)
 */
export async function initPushNotificationsAsync(): Promise<void> {
  if (!isNative() || initialized) {
    return;
  }

  // `RUSTORE_PROJECT_ID` уже обрезан в `@/lib/rustore-push`, повторный trim —
  // защита от пустого/пробельного значения в тестах и при подмене модуля.
  const projectId = RUSTORE_PROJECT_ID.trim();

  if (projectId === '') {
    console.warn(
      '[push] VITE_RUSTORE_PROJECT_ID не задан — RuStore Push отключён',
    );

    return;
  }

  initialized = true;

  try {
    await initRuStorePushAsync(projectId);

    const token = await getRuStoreTokenAsync();

    if (token === null || token.trim() === '') {
      console.warn(
        '[push] RuStore не вернул токен — регистрация устройства пропущена',
      );

      return;
    }

    await registerDeviceTokenAsync(token, 'android');
  } catch (error: unknown) {
    console.error(
      '[push] ошибка инициализации RuStore Push или регистрации токена',
      error,
    );
  }
}
