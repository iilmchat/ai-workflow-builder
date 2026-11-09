import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capturePhoto } from './useCamera';

/**
 * Управляемое состояние моков (v1.5.0 S1).
 *
 * `native` переключает `isNative()` из `@/lib/platform`, `getPhoto` — сам
 * плагин. `vi.hoisted` нужен потому, что фабрики `vi.mock` поднимаются выше
 * объявлений и не видят обычные переменные модуля.
 */
const mocks = vi.hoisted(() => ({
  native: true,
  getPhoto: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isNative: () => mocks.native,
  isAndroid: () => mocks.native,
  isIOS: () => false,
  isWeb: () => !mocks.native,
}));

vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: mocks.getPhoto },
  CameraResultType: { Uri: 'uri', Base64: 'base64', DataUrl: 'dataUrl' },
  CameraSource: { Camera: 'CAMERA', Photos: 'PHOTOS', Prompt: 'PROMPT' },
}));

describe('capturePhoto — камера через Capacitor (v1.5.0 S1)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.native = true;
    mocks.getPhoto.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('в браузере возвращает null и не вызывает плагин', async () => {
    mocks.native = false;

    await expect(capturePhoto()).resolves.toBeNull();
    expect(mocks.getPhoto).not.toHaveBeenCalled();
  });

  it('в нативе открывает камеру с качеством 90 и возвращает webPath', async () => {
    mocks.getPhoto.mockResolvedValue({
      webPath: 'blob:capacitor://photo-1',
      path: 'photo-1.jpg',
    });

    await expect(capturePhoto()).resolves.toBe('blob:capacitor://photo-1');

    expect(mocks.getPhoto).toHaveBeenCalledTimes(1);
    expect(mocks.getPhoto).toHaveBeenCalledWith({
      quality: 90,
      allowEditing: false,
      resultType: 'uri',
      source: 'CAMERA',
    });
  });

  it('возвращает null, если плагин отдал фото без webPath', async () => {
    mocks.getPhoto.mockResolvedValue({ path: 'photo-1.jpg' });

    await expect(capturePhoto()).resolves.toBeNull();
  });

  it('не падает при отмене: catch → null и предупреждение в консоль', async () => {
    mocks.getPhoto.mockRejectedValue(new Error('User cancelled photos app'));

    await expect(capturePhoto()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[camera] отменено или ошибка',
      expect.any(Error),
    );
  });
});
