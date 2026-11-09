package com.iilmchat.workflowbuilder;

import android.util.Log;

import androidx.annotation.NonNull;

import java.util.List;

import ru.rustore.sdk.pushclient.messaging.exception.RuStorePushClientException;
import ru.rustore.sdk.pushclient.messaging.model.RemoteMessage;
import ru.rustore.sdk.pushclient.messaging.service.RuStoreMessagingService;

/**
 * Сервис приёма push-сообщений RuStore (v1.5.0 S4-B).
 *
 * Регистрируется в `AndroidManifest.xml` с action
 * `ru.rustore.sdk.pushclient.MESSAGING_EVENT`: RuStore Push SDK сам отдаёт
 * сюда события, а стандартное уведомление показывает своими средствами (см.
 * rustore-sdk-push-example). Здесь — только логирование, без падений:
 * сервис не имеет доступа к WebView, поэтому токен на бэкенд отправляет
 * веб-слой (`GET token` при старте приложения → `POST /notifications/register`).
 */
public class RuStorePushMessagingService extends RuStoreMessagingService {

    /** Тег логов сервиса (виден в `adb logcat`). */
    private static final String LOG_TAG = "RuStorePushService";

    /**
     * Новый push-токен устройства.
     *
     * SDK вызывает метод при ротации токена. На бэкенд токен отправляет
     * веб-слой при следующем старте приложения (у сервиса нет доступа к
     * WebView/сети приложения), поэтому здесь только лог.
     *
     * @param token - новый push-токен RuStore
     */
    @Override
    public void onNewToken(@NonNull String token) {
        Log.d(LOG_TAG, "Получен новый push-токен RuStore");
    }

    /**
     * Получено push-сообщение.
     *
     * Уведомление в фоне показывает сам SDK; в foreground система его не
     * отрисовывает, поэтому сообщение логируется (видно через
     * `adb logcat`). Переход по клику на уведомление — вне объёма S4-B.
     *
     * @param message - входящее сообщение RuStore
     */
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Log.d(LOG_TAG, "Получено push-сообщение: " + message.getMessageId());
    }

    /**
     * Ошибки доставки push-сообщений.
     *
     * @param errors - список ошибок RuStore Push SDK
     */
    @Override
    public void onError(@NonNull List<? extends RuStorePushClientException> errors) {
        for (RuStorePushClientException error : errors) {
            Log.e(LOG_TAG, "Ошибка RuStore Push: " + error, error);
        }
    }

    /**
     * Часть push-сообщений не доставлена (истёк TTL или превышен лимит).
     *
     * Рекомендация SDK — синхронизироваться с сервером; в S4-B синхронизация
     * не реализуется, достаточно лога.
     */
    @Override
    public void onDeletedMessages() {
        Log.d(LOG_TAG, "Часть push-сообщений не доставлена (onDeletedMessages)");
    }
}
