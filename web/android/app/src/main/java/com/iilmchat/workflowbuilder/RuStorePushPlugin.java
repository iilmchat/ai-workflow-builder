package com.iilmchat.workflowbuilder;

import android.Manifest;
import android.app.Activity;
import android.app.Application;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import ru.rustore.sdk.pushclient.RuStorePushClient;
import ru.rustore.sdk.pushclient.common.logger.DefaultLogger;

/**
 * Capacitor-плагин RuStore Push (v1.5.0 S4-B).
 *
 * Тонкий мост из веб-слоя (`web/src/lib/rustore-push.ts`) к нативному
 * RuStore Push SDK 6.4.0 (`ru.rustore.sdk:pushclient`). Вся политика
 * (ON/OFF по пустому projectId, обработка ошибок, идемпотентность) живёт в
 * TypeScript; плагин только инициализирует SDK, запрашивает runtime-разрешение
 * на уведомления (Android 13+) и отдаёт push-токен.
 *
 * Методы вызываются из JS по имени: `init({ projectId })` и `getToken()`.
 */
@CapacitorPlugin(name = "RuStorePush")
public class RuStorePushPlugin extends Plugin {

    /** Тег логов нативного плагина (виден в `adb logcat`). */
    private static final String LOG_TAG = "RuStorePush";

    /** Код запроса runtime-разрешения `POST_NOTIFICATIONS` (произвольный). */
    private static final int POST_NOTIFICATIONS_REQUEST_CODE = 0x5253;

    /**
     * Инициализирует RuStore Push SDK и запрашивает разрешение на уведомления.
     *
     * Вызывается один раз после авторизации (см. `usePushNotifications`).
     * Порядок: проверка `projectId` → `RuStorePushClient.init` → на Android 13+
     * runtime-запрос `POST_NOTIFICATIONS` (без него SDK не покажет
     * уведомления; отказ пользователя инициализацию не отменяет).
     *
     * @param call - вызов Capacitor с аргументом `projectId`; разрешается без
     *   значения либо отклоняется с текстом ошибки SDK
     */
    @PluginMethod
    public void init(@NonNull PluginCall call) {
        String projectId = call.getString("projectId");

        if (projectId == null || projectId.trim().isEmpty()) {
            // Policy-проверка есть и в веб-слое; здесь — защита от прямого
            // вызова плагина: SDK с пустым projectId работать не будет.
            call.reject("projectId RuStore Push пустой — инициализация невозможна");

            return;
        }

        Activity activity = getActivity();

        if (activity == null) {
            call.reject("Activity недоступна — RuStore Push не инициализирован");

            return;
        }

        Application application = activity.getApplication();

        try {
            // Kotlin object: в Java доступен через INSTANCE. Logger — штатный
            // DefaultLogger SDK (пишет в logcat), реализовывать интерфейс
            // Logger вручную не нужно.
            RuStorePushClient.INSTANCE.init(
                application,
                projectId.trim(),
                new DefaultLogger(LOG_TAG)
            );
        } catch (Throwable error) {
            Log.e(LOG_TAG, "Не удалось инициализировать RuStore Push", error);
            call.reject("Не удалось инициализировать RuStore Push: " + safeMessage(error));

            return;
        }

        requestNotificationsPermissionIfNeeded(activity);
        call.resolve();
    }

    /**
     * Возвращает push-токен устройства.
     *
     * `RuStorePushClient.getToken()` отдаёт `Task<String>`; результат
     * приходит в `addOnSuccessListener`, ошибки — в `addOnFailureListener`.
     * Пустой токен нормализуется в JSON `null`, чтобы веб-слой обрабатывал
     * «токена нет» одним условием (`{ token: string | null }`).
     *
     * @param call - вызов Capacitor; разрешается объектом `{ token }` либо
     *   отклоняется с текстом ошибки SDK
     */
    @PluginMethod
    public void getToken(@NonNull PluginCall call) {
        try {
            RuStorePushClient.INSTANCE.getToken()
                .addOnSuccessListener(token -> {
                    JSObject result = new JSObject();

                    if (token == null || token.trim().isEmpty()) {
                        result.put("token", JSONObject.NULL);
                    } else {
                        result.put("token", token.trim());
                    }

                    call.resolve(result);
                })
                .addOnFailureListener(error -> {
                    Log.e(LOG_TAG, "Не удалось получить push-токен RuStore", error);
                    call.reject("Не удалось получить push-токен RuStore: " + safeMessage(error));
                });
        } catch (Throwable error) {
            // Синхронный бросок возможен, если SDK ещё не инициализирован
            // (не завершился init внутри 5 секунд) — не роняем приложение.
            Log.e(LOG_TAG, "getToken завершился исключением", error);
            call.reject("getToken завершился исключением: " + safeMessage(error));
        }
    }

    /**
     * Запрашивает `POST_NOTIFICATIONS` на Android 13+ (API 33).
     *
     * На более старых версиях разрешение выдаётся при установке и запрос не
     * нужен. Повторный запрос не делается, если разрешение уже выдано.
     *
     * @param activity - текущая Activity для системного диалога
     */
    private void requestNotificationsPermissionIfNeeded(@NonNull Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }

        int status = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.POST_NOTIFICATIONS
        );

        if (status == PackageManager.PERMISSION_GRANTED) {
            return;
        }

        ActivityCompat.requestPermissions(
            activity,
            new String[] { Manifest.permission.POST_NOTIFICATIONS },
            POST_NOTIFICATIONS_REQUEST_CODE
        );
    }

    /**
     * Достаёт читаемый текст ошибки (`Throwable.getMessage()` бывает `null`).
     *
     * @param error - ошибка SDK
     * @return сообщение или имя класса ошибки
     */
    @NonNull
    private static String safeMessage(@NonNull Throwable error) {
        String message = error.getMessage();

        return message == null || message.trim().isEmpty()
            ? error.getClass().getSimpleName()
            : message;
    }
}
