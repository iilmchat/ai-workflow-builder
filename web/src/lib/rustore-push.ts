import { registerPlugin } from '@capacitor/core';

/**
 * Интерфейс нативного плагина RuStore Push (v1.5.0 S4-B).
 *
 * Плагин реализован на Java и зарегистрирован в `MainActivity` под именем
 * `RuStorePush` (`web/android/app/src/main/java/com/iilmchat/workflowbuilder/RuStorePushPlugin.java`).
 * Это тонкий мост: вся политика (когда инициализировать, что делать с пустым
 * токеном) живёт в `usePushNotifications`, а здесь — только типы и вызовы
 * нативного SDK `ru.rustore.sdk:pushclient`.
 *
 * Имена методов (`init`, `getToken`) — из ТЗ S4-B; в TypeScript-обёртках ниже
 * они получают суффикс `Async` по RULES 1.4 (все I/O-функции — `*Async`).
 */
export interface RuStorePushPlugin {
  /**
   * Инициализирует RuStore Push SDK в нативном приложении.
   *
   * На стороне Android вызывает
   * `RuStorePushClient.INSTANCE.init(application, projectId, logger)` и, на
   * Android 13+, запрашивает runtime-разрешение `POST_NOTIFICATIONS`.
   *
   * @param options - `projectId` из RuStore Console (поле `Project ID` раздела
   *   «Push-уведомления → Проекты»)
   * @returns промис, который завершается после инициализации SDK; отсутствие
   *   разрешения на уведомления инициализацию не отменяет
   * @throws Error если `projectId` пустой или SDK отверг инициализацию
   */
  init(options: { projectId: string }): Promise<void>;

  /**
   * Возвращает push-токен устройства из RuStore Push SDK.
   *
   * Android-реализация оборачивает `RuStorePushClient.INSTANCE.getToken()`
   * (`addOnSuccessListener`/`addOnFailureListener`). Токен может быть `null`,
   * если SDK ещё не готов или сервис RuStore недоступен.
   *
   * @returns `{ token }`, где `token` — токен устройства или `null`
   * @throws Error при ошибке получения токена (сеть, SDK не инициализирован)
   */
  getToken(): Promise<{ token: string | null }>;
}

/**
 * Мост Capacitor к нативному плагину `RuStorePush`.
 *
 * В браузере вызовы бросают «not implemented» — вызывающий код обязан
 * проверять `isNative()` (см. `@/lib/platform`).
 */
const RuStorePush = registerPlugin<RuStorePushPlugin>('RuStorePush');

/**
 * Project ID приложения из RuStore Console (v1.5.0 S4-B).
 *
 * Приходит из `VITE_RUSTORE_PROJECT_ID` на этапе сборки (`vite build`
 * инлайнит `VITE_*` в бандл). Это **не секрет**: значение видно в JS-коде
 * приложения, поэтому в CI оно лежит в repository variable, а не в secret
 * (RULES 5.1 — секреты только в `.env`/secret manager).
 *
 * Пустая строка означает «push выключены»: `usePushNotifications` в этом
 * случае пишет WARN и не трогает нативный SDK (ON/OFF без пересборки
 * JS-логики).
 */
export const RUSTORE_PROJECT_ID: string = (
  import.meta.env.VITE_RUSTORE_PROJECT_ID ?? ''
).trim();

/**
 * Инициализирует RuStore Push SDK (v1.5.0 S4-B).
 *
 * Соответствует `initRuStorePush` из ТЗ; суффикс `Async` добавлен по
 * RULES 1.4, потому что функция возвращает промис нативного вызова.
 *
 * Ошибки не глотаются: `usePushNotifications` — фоновая инициализация и
 * обязана сама решить, что делать (RULES 4.18). Пустой `projectId` — ошибка
 * программиста (policy-проверка должна стоять до вызова), поэтому здесь
 * бросается `Error`, а не тихий WARN.
 *
 * @param projectId - Project ID из RuStore Console
 * @returns промис, который завершается после инициализации SDK
 * @throws Error если `projectId` пустой или нативный плагин вернул ошибку
 */
export async function initRuStorePushAsync(projectId: string): Promise<void> {
  const normalized = projectId.trim();

  if (normalized === '') {
    throw new Error('projectId RuStore Push пустой — инициализация невозможна');
  }

  await RuStorePush.init({ projectId: normalized });
}

/**
 * Возвращает push-токен устройства RuStore (v1.5.0 S4-B).
 *
 * Соответствует `getRuStoreToken` из ТЗ (суффикс `Async` — RULES 1.4).
 * Пустой/пробельный ответ SDK нормализуется в `null`: вызывающий код
 * обрабатывает «токена нет» одним условием, а не двумя.
 *
 * @returns токен устройства или `null`, если SDK не вернул значение
 * @throws Error если нативный плагин вернул ошибку получения токена
 */
export async function getRuStoreTokenAsync(): Promise<string | null> {
  const { token } = await RuStorePush.getToken();
  const normalized = (token ?? '').trim();

  return normalized === '' ? null : normalized;
}
