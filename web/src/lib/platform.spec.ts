import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAndroid, isIOS, isNative, isWeb } from './platform';

/**
 * Мок `@capacitor/core` (v1.5.0 S1).
 *
 * Платформу нельзя «переключить» в jsdom, поэтому `Capacitor` подменяется
 * управляемым объектом: тест выставляет `platform.value`, а функции
 * `platform.ts` читают его так же, как читали бы нативное окружение.
 */
const platform = vi.hoisted(() => ({
  value: 'web' as 'web' | 'android' | 'ios',
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.value !== 'web',
    getPlatform: () => platform.value,
  },
}));

afterEach(() => {
  platform.value = 'web';
});

describe('platform.ts — определение платформы (v1.5.0 S1)', () => {
  it('в браузере isNative() === false, isWeb() === true', () => {
    platform.value = 'web';

    expect(isNative()).toBe(false);
    expect(isWeb()).toBe(true);
    expect(isAndroid()).toBe(false);
    expect(isIOS()).toBe(false);
  });

  it('на Android isNative() === true и isAndroid() === true', () => {
    platform.value = 'android';

    expect(isNative()).toBe(true);
    expect(isAndroid()).toBe(true);
    expect(isIOS()).toBe(false);
    expect(isWeb()).toBe(false);
  });

  it('на iOS isNative() === true и isIOS() === true', () => {
    platform.value = 'ios';

    expect(isNative()).toBe(true);
    expect(isAndroid()).toBe(false);
    expect(isIOS()).toBe(true);
    expect(isWeb()).toBe(false);
  });

  it('в jsdom настоящий Capacitor 7 не считает окружение нативным', async () => {
    // Проверка без мока: в jsdom нет ни `androidBridge`, ни
    // `webkit.messageHandlers.bridge`, поэтому Capacitor обязан вернуть 'web'
    // (иначе кнопки нативных действий показывались бы в браузере).
    const actual =
      await vi.importActual<typeof import('@capacitor/core')>(
        '@capacitor/core',
      );

    expect(actual.Capacitor.isNativePlatform()).toBe(false);
    expect(actual.Capacitor.getPlatform()).toBe('web');
  });
});
