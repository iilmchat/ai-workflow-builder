import { z } from 'zod';
import { DEVICE_TOKEN_PLATFORMS } from '../../db/schema.js';

/**
 * Тело `POST /notifications/register` — регистрация push-токена устройства
 * (v1.5.0 S3, DESIGN V150 § 3 S3).
 *
 * Токен приходит от Capacitor Push Notifications (`PushNotifications.register()`
 * → событие `registration`): у Android это FCM-токен, у iOS — APNs-токен, у web —
 * web-push подписка. Проверяется только непустота: формат токена принадлежит
 * провайдеру (FCM/APNs), и его валидация в приложении дала бы ложные отказы
 * при смене формата. Платформа — из закрытого домена
 * {@link DEVICE_TOKEN_PLATFORMS}: тот же список ограничивает
 * CHECK-ограничение `device_tokens.platform` в БД (RULES 1.17), поэтому Zod и
 * БД не могут разойтись.
 */
export const RegisterDeviceTokenSchema = z.object({
  /** Токен устройства: непустая строка, формат проверяет провайдер. */
  token: z.string().min(1, 'токен устройства не может быть пустым'),
  /** Платформа устройства (`android`/`ios`/`web`). */
  platform: z.enum(DEVICE_TOKEN_PLATFORMS),
});

/** Валидированное тело регистрации push-токена. */
export type RegisterDeviceTokenDto = z.infer<typeof RegisterDeviceTokenSchema>;
