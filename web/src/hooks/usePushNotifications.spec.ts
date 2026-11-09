import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Управляемое состояние моков (v1.5.0 S3; S4-B — RuStore Push).
 *
 * `native` переключает `@/lib/platform`; `projectId` — значение «переменной
 * окружения» `VITE_RUSTORE_PROJECT_ID` (модуль `@/lib/rustore-push`
 * подменяется целиком); `init`/`getToken` — шаги RuStore Push; `registerToken` —
 * вызов бэкенда из `@/lib/api`.
 *
 * Модуль хука хранит guard инициализации, поэтому каждый тест импортирует его
 * заново через `vi.resetModules()` + динамический `import`.
 */
const mocks = vi.hoisted(() => ({
  native: true,
  projectId: 'rustore-project-1',
  init: vi.fn(),
  getToken: vi.fn(),
  registerToken: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isNative: () => mocks.native,
}));

vi.mock('@/lib/api', () => ({
  registerDeviceTokenAsync: mocks.registerToken,
}));

// `RUSTORE_PROJECT_ID` — константа модуля, но тесты меняют её между кейсами:
// геттер читает актуальное значение `mocks.projectId` в момент обращения хука.
vi.mock('@/lib/rustore-push', () => ({
  get RUSTORE_PROJECT_ID(): string {
    return mocks.projectId;
  },
  initRuStorePushAsync: mocks.init,
  getRuStoreTokenAsync: mocks.getToken,
}));

/** Загружает хук «с нуля»: сбрасывает guard инициализации между тестами. */
async function loadHookAsync(): Promise<
  typeof import('./usePushNotifications')
> {
  vi.resetModules();

  return import('./usePushNotifications');
}

describe('initPushNotificationsAsync — RuStore Push (v1.5.0 S3/S4-B)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.native = true;
    mocks.projectId = 'rustore-project-1';
    mocks.init.mockReset();
    mocks.getToken.mockReset();
    mocks.registerToken.mockReset();

    mocks.init.mockResolvedValue(undefined);
    mocks.getToken.mockResolvedValue('rustore-token-1');
    mocks.registerToken.mockResolvedValue(undefined);

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('в браузере ничего не делает: SDK и бэкенд не вызываются', async () => {
    mocks.native = false;

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.registerToken).not.toHaveBeenCalled();
  });

  it('в нативе инициализирует SDK, получает токен и регистрирует устройство', async () => {
    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith('rustore-project-1');
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(mocks.registerToken).toHaveBeenCalledTimes(1);
    expect(mocks.registerToken).toHaveBeenCalledWith(
      'rustore-token-1',
      'android',
    );

    // Порядок шагов: init → getToken → register. Токен, запрошенный до
    // инициализации SDK, нативный плагин отклонил бы.
    const initOrder = mocks.init.mock.invocationCallOrder[0];
    const tokenOrder = mocks.getToken.mock.invocationCallOrder[0];
    const registerOrder = mocks.registerToken.mock.invocationCallOrder[0];

    expect(initOrder).toBeLessThan(tokenOrder);
    expect(tokenOrder).toBeLessThan(registerOrder);
  });

  it('пустой projectId: SDK не трогает, пишет WARN', async () => {
    mocks.projectId = '';

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.registerToken).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[push] VITE_RUSTORE_PROJECT_ID не задан — RuStore Push отключён',
    );
  });

  it('projectId из одних пробелов считается пустым', async () => {
    mocks.projectId = '   ';

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.registerToken).not.toHaveBeenCalled();
  });

  it('null-токен: пишет WARN и не регистрирует устройство', async () => {
    mocks.getToken.mockResolvedValue(null);

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.registerToken).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[push] RuStore не вернул токен — регистрация устройства пропущена',
    );
  });

  it('пустой токен: пишет WARN и не регистрирует устройство', async () => {
    mocks.getToken.mockResolvedValue('   ');

    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();

    expect(mocks.registerToken).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[push] RuStore не вернул токен — регистрация устройства пропущена',
    );
  });

  it('ошибка инициализации SDK не пробрасывается: пишется console.error', async () => {
    mocks.init.mockRejectedValue(new Error('sdk init failed'));

    const { initPushNotificationsAsync } = await loadHookAsync();

    await expect(initPushNotificationsAsync()).resolves.toBeUndefined();

    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.registerToken).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[push] ошибка инициализации RuStore Push или регистрации токена',
      expect.any(Error),
    );
  });

  it('ошибка получения токена не пробрасывается: пишется console.error', async () => {
    mocks.getToken.mockRejectedValue(new Error('getToken failed'));

    const { initPushNotificationsAsync } = await loadHookAsync();

    await expect(initPushNotificationsAsync()).resolves.toBeUndefined();

    expect(mocks.registerToken).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      '[push] ошибка инициализации RuStore Push или регистрации токена',
      expect.any(Error),
    );
  });

  it('ошибка отправки токена на бэкенд не пробрасывается', async () => {
    mocks.registerToken.mockRejectedValue(new Error('network down'));

    const { initPushNotificationsAsync } = await loadHookAsync();

    await expect(initPushNotificationsAsync()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      '[push] ошибка инициализации RuStore Push или регистрации токена',
      expect.any(Error),
    );
  });

  it('идемпотентна: повторный вызов не дублирует init, getToken и register', async () => {
    const { initPushNotificationsAsync } = await loadHookAsync();

    await initPushNotificationsAsync();
    await initPushNotificationsAsync();

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
    expect(mocks.registerToken).toHaveBeenCalledTimes(1);
  });
});
