import { Capacitor } from '@capacitor/core';

/**
 * Определение платформы запуска (v1.5.0 S1, DESIGN V150 § 3.2).
 *
 * Один источник правды для условного рендеринга: нативные возможности
 * (камера, QR-сканер, файлы, push) в браузере недоступны, поэтому компоненты
 * спрашивают `isNative()` и не показывают кнопки, которые гарантированно не
 * сработают. Функции, а не константы: платформа не меняется в рантайме, но
 * вызов внутри render не создаёт циклического импорта с `@capacitor/core`
 * (он тянется в каждом тесте компонента).
 *
 * @returns `true` в нативном приложении (Android/iOS), `false` в браузере
 */
export const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * Проверяет, что приложение запущено на Android.
 *
 * @returns `true` на Android (нативная обёртка), иначе `false`
 */
export const isAndroid = (): boolean => Capacitor.getPlatform() === 'android';

/**
 * Проверяет, что приложение запущено на iOS.
 *
 * @returns `true` на iOS (нативная обёртка), иначе `false`
 */
export const isIOS = (): boolean => Capacitor.getPlatform() === 'ios';

/**
 * Проверяет, что приложение открыто в веб-браузере.
 *
 * @returns `true` в браузере (включая jsdom-тесты), иначе `false`
 */
export const isWeb = (): boolean => Capacitor.getPlatform() === 'web';
