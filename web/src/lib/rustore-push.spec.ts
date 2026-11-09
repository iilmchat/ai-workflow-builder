import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Моки нативного моста (v1.5.0 S4-B).
 *
 * `registerPlugin` из `@capacitor/core` подменяется плагином-пустышкой: тест
 * проверяет контракт обёрток (`initRuStorePushAsync`/`getRuStoreTokenAsync`),
 * а не Capacitor.
 */
const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    init: mocks.init,
    getToken: mocks.getToken,
  }),
}));

/** Загружает модуль «с нуля»: `RUSTORE_PROJECT_ID` читается при импорте. */
async function loadModuleAsync(): Promise<typeof import('./rustore-push')> {
  vi.resetModules();

  return import('./rustore-push');
}

describe('rustore-push — мост к RuStore Push SDK (v1.5.0 S4-B)', () => {
  beforeEach(() => {
    mocks.init.mockReset();
    mocks.getToken.mockReset();
    mocks.init.mockResolvedValue(undefined);
    mocks.getToken.mockResolvedValue({ token: 'rustore-token-1' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('читает VITE_RUSTORE_PROJECT_ID и обрезает пробелы', async () => {
    vi.stubEnv('VITE_RUSTORE_PROJECT_ID', '  rustore-project-42  ');

    const { RUSTORE_PROJECT_ID } = await loadModuleAsync();

    expect(RUSTORE_PROJECT_ID).toBe('rustore-project-42');
  });

  it('без переменной окружения RUSTORE_PROJECT_ID пустой (push выключены)', async () => {
    vi.stubEnv('VITE_RUSTORE_PROJECT_ID', '');

    const { RUSTORE_PROJECT_ID } = await loadModuleAsync();

    expect(RUSTORE_PROJECT_ID).toBe('');
  });

  it('init: вызывает нативный плагин с обрезанным projectId', async () => {
    const { initRuStorePushAsync } = await loadModuleAsync();

    await initRuStorePushAsync('  rustore-project-1  ');

    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith({
      projectId: 'rustore-project-1',
    });
  });

  it('init: пустой projectId — ошибка, плагин не вызывается', async () => {
    const { initRuStorePushAsync } = await loadModuleAsync();

    await expect(initRuStorePushAsync('   ')).rejects.toThrow(
      'projectId RuStore Push пустой',
    );
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it('init: ошибка нативного плагина пробрасывается вызывающему', async () => {
    mocks.init.mockRejectedValue(new Error('sdk init failed'));

    const { initRuStorePushAsync } = await loadModuleAsync();

    await expect(initRuStorePushAsync('rustore-project-1')).rejects.toThrow(
      'sdk init failed',
    );
  });

  it('getToken: возвращает токен устройства', async () => {
    const { getRuStoreTokenAsync } = await loadModuleAsync();

    await expect(getRuStoreTokenAsync()).resolves.toBe('rustore-token-1');
    expect(mocks.getToken).toHaveBeenCalledTimes(1);
  });

  it('getToken: null и пустая строка нормализуются в null', async () => {
    mocks.getToken.mockResolvedValueOnce({ token: null });
    mocks.getToken.mockResolvedValueOnce({ token: '   ' });

    const { getRuStoreTokenAsync } = await loadModuleAsync();

    await expect(getRuStoreTokenAsync()).resolves.toBeNull();
    await expect(getRuStoreTokenAsync()).resolves.toBeNull();
  });

  it('getToken: ошибка нативного плагина пробрасывается вызывающему', async () => {
    mocks.getToken.mockRejectedValue(new Error('getToken failed'));

    const { getRuStoreTokenAsync } = await loadModuleAsync();

    await expect(getRuStoreTokenAsync()).rejects.toThrow('getToken failed');
  });
});
