import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Мок `isNative` (v1.5.0 S5-B, KI-658).
 *
 * `getApiBase` спрашивает платформу у `@/lib/platform`; тесту нужно
 * переключать ответ без реального `@capacitor/core`, поэтому мок отдаёт
 * значение изменяемого флага.
 */
const platform = vi.hoisted(() => ({ native: false }));

vi.mock('@/lib/platform', () => ({
  isNative: () => platform.native,
}));

/**
 * Загружает модуль заново (сбрасывает флаг «об ошибке уже сообщили»).
 *
 * `missingNativeBaseReported` живёт на уровне модуля: без сброса второй тест
 * на отсутствующий `VITE_API_BASE` не увидел бы `console.error`. Поэтому
 * каждый тест получает чистый модуль.
 *
 * @returns свежий экземпляр `./api-base`
 */
async function loadApiBase(): Promise<typeof import('./api-base')> {
  vi.resetModules();

  return import('./api-base');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  platform.native = false;
});

describe('getApiBase (v1.5.0 S5-B, KI-658)', () => {
  it('в браузере возвращает пустую строку, даже если VITE_API_BASE задан', async () => {
    platform.native = false;
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com');

    const { getApiBase } = await loadApiBase();

    expect(getApiBase()).toBe('');
  });

  it('в native с пустым VITE_API_BASE — пустая база и console.error', async () => {
    platform.native = true;
    vi.stubEnv('VITE_API_BASE', '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { getApiBase } = await loadApiBase();

    expect(getApiBase()).toBe('');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('VITE_API_BASE не задан в native-сборке'),
    );
  });

  it('в native возвращает нормализованный origin без завершающего слэша', async () => {
    platform.native = true;
    vi.stubEnv('VITE_API_BASE', '  https://api.example.com///  ');

    const { getApiBase } = await loadApiBase();

    expect(getApiBase()).toBe('https://api.example.com');
  });
});

describe('apiUrl / resolveApiUrl (v1.5.0 S5-B, KI-658)', () => {
  it('apiUrl склеивает базу с путём, в браузере путь не меняется', async () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com');

    const web = await loadApiBase();

    expect(web.apiUrl('/runs/1/stream')).toBe('/runs/1/stream');

    platform.native = true;
    const native = await loadApiBase();

    expect(native.apiUrl('/runs/1/stream')).toBe(
      'https://api.example.com/runs/1/stream',
    );
  });

  it('resolveApiUrl не трогает абсолютные ссылки и дополняет относительные', async () => {
    platform.native = true;
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com');

    const { normalizeApiBase, resolveApiUrl } = await loadApiBase();

    expect(normalizeApiBase(undefined)).toBe('');
    expect(resolveApiUrl('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png',
    );
    expect(resolveApiUrl('blob:https://localhost/123')).toBe(
      'blob:https://localhost/123',
    );
    expect(resolveApiUrl('/media/file/run-1/a.png')).toBe(
      'https://api.example.com/media/file/run-1/a.png',
    );
  });
});
