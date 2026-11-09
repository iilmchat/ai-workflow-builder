import { PushNotifications } from '@capacitor/push-notifications';
import {
  registerDeviceTokenAsync,
  type DeviceTokenPlatform,
} from '@/lib/api';
import { isAndroid, isIOS, isNative } from '@/lib/platform';

/**
 * Флаг инициализации (v1.5.0 S3).
 *
 * `App` рендерится внутри `StrictMode` (`web/src/main.tsx`), поэтому эффект
 * монтирования в dev-режиме вызывается дважды, а после logout→login — ещё
 * раз. Повторная инициализация навесила бы вторые listeners и второй
 * `register()`, то есть дублировала бы `POST /notifications/register` на
 * каждый push-токен. Guard делает инициализацию идемпотентной.
 *
 * Сбрасывается только перезагрузкой WebView (переустановка приложения,
 * смена пользователя без перезапуска — вне S3).
 */
let initialized = false;

/**
 * Возвращает платформу для бэкенда (v1.5.0 S3).
 *
 * `Capacitor.getPlatform()` отдаёт `'web' | 'ios' | 'android'`; здесь тот же
 * домен, но через хелперы `@/lib/platform` — единственный источник правды по
 * платформе в приложении (DESIGN V150 § 3.2), чтобы не тянуть `@capacitor/core`
 * в каждый компонент.
 *
 * @returns `android`, `ios` или `web`
 */
function currentPlatform(): DeviceTokenPlatform {
  if (isAndroid()) {
    return 'android';
  }

  if (isIOS()) {
    return 'ios';
  }

  return 'web';
}

/**
 * Инициализирует push-уведомления и регистрирует токен устройства
 * (v1.5.0 S3, DESIGN V150 § 3.3).
 *
 * Порядок шагов важен:
 * 1. вне браузера ничего не делает — в веб-версии push не поддерживается;
 * 2. запрашивает разрешение; отказ — тихий выход с WARN (пользователь уже
 *    видел системный диалог, повторно спрашивать нельзя);
 * 3. **сначала** навешивает listeners, **потом** вызывает `register()`:
 *    событие `registration` приходит сразу после `register()`, и слушатель,
 *    добавленный позже, рискует не успеть его поймать (в официальном примере
 *    плагина порядок именно такой);
 * 4. на `registration` отправляет токен на `POST /notifications/register`
 *    (upsert по токену на бэкенде — повторная регистрация безопасна).
 *
 * Ошибки сети/регистрации не пробрасываются: это фоновая инициализация,
 * которую вызывает `App` на старте, и падение не должно ломать экран
 * (RULES 4.18 — причина пишется в консоль).
 *
 * @returns промис, который завершается после `register()` (или раньше, если
 *   платформа не нативная либо разрешение не выдано)
 */
export async function initPushNotificationsAsync(): Promise<void> {
  if (!isNative() || initialized) {
    return;
  }

  const permission = await PushNotifications.requestPermissions();

  if (permission.receive !== 'granted') {
    console.warn('[push] разрешение на уведомления не выдано');

    return;
  }

  initialized = true;

  await PushNotifications.addListener('registration', (token) => {
    void registerDeviceTokenAsync(token.value, currentPlatform()).catch(
      (error: unknown) => {
        console.error('[push] не удалось отправить токен на бэкенд', error);
      },
    );
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.error('[push] ошибка регистрации', error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Уведомление в foreground система не показывает — логируем, чтобы было
    // видно на устройстве через `adb logcat` (в UI-баннер — вне S3).
    console.log('[push] получено', notification.title, notification.body);
  });

  await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => {
      // S4: переход к нужному запуску/графу (payload пока не стандартизован).
      console.log('[push] переход по уведомлению', action.notification.title);
    },
  );

  await PushNotifications.register();
}
