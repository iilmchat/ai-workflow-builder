package com.iilmchat.workflowbuilder;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Главная Activity нативной оболочки (v1.5.0 S1, DESIGN V150 § 3.2).
 *
 * Кастомные Capacitor-плагины регистрируются **до** `super.onCreate()`:
 * `Bridge` создаётся внутри `super.onCreate()` и читает уже добавленные
 * плагины, поэтому регистрация после вызова `super` привела бы к тому, что
 * `RuStorePush` не существовал бы для JS-слоя (v1.5.0 S4-B).
 */
public class MainActivity extends BridgeActivity {

    /**
     * Создаёт Activity и регистрирует нативные плагины приложения.
     *
     * @param savedInstanceState - сохранённое состояние Activity (может быть
     *   `null` при первом создании)
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RuStorePushPlugin.class);

        super.onCreate(savedInstanceState);
    }
}
