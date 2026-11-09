import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Управляемое состояние моков (v1.5.0 S3).
 *
 * `native`/`android` переключают `@/lib/platform`; `requestPermissions`,
 * `register`, `addListener` — плагин push; `registerToken` — вызов бэкенда из
 * `@/lib/api`. `order` фиксирует последовательность вызовов: listeners обязаны
 * быть навешаны ДО `register()`, иначе событие `registration` теряется.
 *
 * Модуль хука хранит guard инициализации, поэтому каждый тест импортирует его
 * заново через `vi.resetModules()` + динамический `import`.
 */
const mocks = vi.hoisted(() => ({
  native: true,
  android: true,
  requestPermissions: vi.fn(),
  register: vi.fn(),
  addListener: vi.fn(),
  registerToken: vi.fn(),
  order: [] as string[],
}));

vi.mock('@/lib/platform', () => ({
  isNative: () => mocks.native,
  isAndroid: () => mocks.native && mocks.android,
  isIOS: () => mocks.native && !mocks.android,
  isWeb: () => !mocks.native,
}));

vi.mock('@/lib/api', () => ({
  registerDeviceTokenAsync: mocks.registerToken,
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: mocks.requestPermissions,
    register: mocks.register,
    addListener: mocks.addListener,
  },
}));

/** Загружает хук «с нуля»: сбрасывает guard инициализации между тестами. */
async function loadHookAsync(): Promise<
  typeof import('./usePushNotifications')
> {
  vi.resetModules();

  return import('./usePushNotifications');
}

describe('initPushNotificationsAsync — push-уведомления (v1.5.0 S3)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.native = true;
    mocks.android = true;
    mocks.order.length = 0;
    mocks.requestPermissions.mockReset();
    mocks.register.mockReset();
    mocks.addListener.mockReset();
    mocks.registerToken.mockReset();

    mocks.requestPermissions.mockResolvedValue({ receive: 'granted' });
    mocks.register.mockImplementation(() => {
      mocks.order.push('register');

      return Promise.resolve();
    });
    mocks.addListener.mockImplementation((event: string) => {
      mocks.order.push(`listener:${event}`);

      return Promise.resolve({ remove: vi.fn() });
    });
    mocks.registerToken.mockResolvedValue(undefined);

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('в браузере ничего не делает: разрешение не запрашивается', async () => {
    mocks.native = false;

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.addListener).not.toHaveBeenCalled();
  });

  it('в нативе навешивает listeners ДО register и регистрирует устройство', async () => {
    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(
      mocks.addListener.mock.calls.map((call) => (call as [string])[0]),
    ).toEqual([
      'registration',
      'registrationError',
      'pushNotificationReceived',
      'pushNotificationActionPerformed',
    ]);

    const registrationIndex = mocks.order.indexOf('listener:registration');
    const registerIndex = mocks.order.indexOf('register');

    expect(registrationIndex).toBeGreaterThanOrEqual(0);
    expect(registrationIndex).toBeLessThan(registerIndex);
  });

  it('на событие registration отправляет токен и платформу на бэкенд', async () => {
    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    const registrationCall = mocks.addListener.mock.calls.find(
      (call) => (call as [string])[0] === 'registration',
    ) as [string, (token: { value: string }) => void] | undefined;

    expect(registrationCall).toBeDefined();
    registrationCall?.[1]({ value: 'fcm-token-123' });

    await vi.waitFor(() => {
      expect(mocks.registerToken).toHaveBeenCalledWith(
        'fcm-token-123',
        'android',
      );
    });
  });

  it('на iOS отправляет платформу ios', async () => {
    mocks.android = false;

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    const registrationCall = mocks.addListener.mock.calls.find(
      (call) => (call as [string])[0] === 'registration',
    ) as [string, (token: { value: string }) => void] | undefined;

    registrationCall?.[1]({ value: 'apns-token-1' });

    await vi.waitFor(() => {
      expect(mocks.registerToken).toHaveBeenCalledWith('apns-token-1', 'ios');
    });
  });

  it('при отказе в разрешении не регистрирует устройство и пишет WARN', async () => {
    mocks.requestPermissions.mockResolvedValue({ receive: 'denied' });

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.addListener).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[push] разрешение на уведомления не выдано',
    );
  });

  it('идемпотентна: повторный вызов не дублирует listeners и register', async () => {
    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();
    await initPushNotificationsAsync();

    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.addListener).toHaveBeenCalledTimes(4);
  });

  it('ошибка отправки токена не пробрасывается: пишется в console.error', async () => {
    mocks.registerToken.mockRejectedValue(new Error('network down'));

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    const registrationCall = mocks.addListener.mock.calls.find(
      (call) => (call as [string])[0] === 'registration',
    ) as [string, (token: { value: string }) => void] | undefined;

    registrationCall?.[1]({ value: 'fcm-token-err' });

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        '[push] не удалось отправить токен на бэкенд',
        expect.any(Error),
      );
    });
  });
});
