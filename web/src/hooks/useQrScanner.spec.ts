import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanQr } from './useQrScanner';

/**
 * Управляемое состояние моков (v1.5.0 S1).
 *
 * Каждый шаг сценария — отдельный `vi.fn()`: тесты проверяют не только
 * результат, но и порядок вызовов (без камеры/модуля Play Services не должно
 * быть запроса разрешения, без разрешения — сканера).
 */
const mocks = vi.hoisted(() => ({
  native: true,
  android: true,
  isSupported: vi.fn(),
  isModuleAvailable: vi.fn(),
  requestPermissions: vi.fn(),
  scan: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isNative: () => mocks.native,
  isAndroid: () => mocks.native && mocks.android,
  isIOS: () => mocks.native && !mocks.android,
  isWeb: () => !mocks.native,
}));

vi.mock('@capacitor-mlkit/barcode-scanning', () => ({
  BarcodeScanner: {
    isSupported: mocks.isSupported,
    isGoogleBarcodeScannerModuleAvailable: mocks.isModuleAvailable,
    requestPermissions: mocks.requestPermissions,
    scan: mocks.scan,
  },
  BarcodeFormat: { QrCode: 'QR_CODE', Ean13: 'EAN_13' },
}));

describe('scanQr — QR-сканер через Capacitor ML Kit (v1.5.0 S1)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.native = true;
    mocks.android = true;
    mocks.isSupported.mockReset().mockResolvedValue({ supported: true });
    mocks.isModuleAvailable.mockReset().mockResolvedValue({ available: true });
    mocks.requestPermissions
      .mockReset()
      .mockResolvedValue({ camera: 'granted' });
    mocks.scan
      .mockReset()
      .mockResolvedValue({
        barcodes: [{ rawValue: 'https://app.example/qr' }],
      });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('в браузере возвращает null и не трогает плагин', async () => {
    mocks.native = false;

    await expect(scanQr()).resolves.toBeNull();
    expect(mocks.isSupported).not.toHaveBeenCalled();
    expect(mocks.isModuleAvailable).not.toHaveBeenCalled();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
  });

  it('возвращает rawValue первого штрихкода и сканирует только QR', async () => {
    await expect(scanQr()).resolves.toBe('https://app.example/qr');

    expect(mocks.isSupported).toHaveBeenCalledTimes(1);
    expect(mocks.isModuleAvailable).toHaveBeenCalledTimes(1);
    expect(mocks.requestPermissions).toHaveBeenCalledTimes(1);
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(mocks.scan).toHaveBeenCalledWith({ formats: ['QR_CODE'] });
  });

  it('нет камеры (supported: false): null, разрешение не запрашивается', async () => {
    mocks.isSupported.mockResolvedValue({ supported: false });

    await expect(scanQr()).resolves.toBeNull();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[qr] сканер недоступен: на устройстве нет камеры',
    );
  });

  it('нет модуля Google Barcode Scanner (Play Services): null, сканер не открывается', async () => {
    mocks.isModuleAvailable.mockResolvedValue({ available: false });

    await expect(scanQr()).resolves.toBeNull();
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[qr] сканер недоступен (нет Google Play Services?)',
    );
  });

  it('на iOS модуль Play Services не проверяется (метод Android-only)', async () => {
    mocks.android = false;

    await expect(scanQr()).resolves.toBe('https://app.example/qr');
    expect(mocks.isModuleAvailable).not.toHaveBeenCalled();
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  });

  it('без разрешения на камеру: null, сканер не открывается', async () => {
    mocks.requestPermissions.mockResolvedValue({ camera: 'denied' });

    await expect(scanQr()).resolves.toBeNull();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[qr] разрешение на камеру не выдано');
  });

  it('пользователь закрыл сканер без кода: barcodes пуст → null', async () => {
    mocks.scan.mockResolvedValue({ barcodes: [] });

    await expect(scanQr()).resolves.toBeNull();
  });

  it('не падает при ошибке сканирования: catch → null и предупреждение', async () => {
    mocks.scan.mockRejectedValue(new Error('scan failed'));

    await expect(scanQr()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[qr] ошибка сканирования',
      expect.any(Error),
    );
  });
});
