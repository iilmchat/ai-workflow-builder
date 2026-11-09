import {
  BarcodeScanner,
  BarcodeFormat,
} from '@capacitor-mlkit/barcode-scanning';
import { isAndroid, isNative } from '@/lib/platform';

/**
 * Открывает QR-сканер и возвращает первое распознанное значение (v1.5.0 S1).
 *
 * Сканер построен на Google ML Kit, поэтому перед показом камеры проверяются
 * две разные вещи (это не одно и то же — см. API плагина 7.5.0):
 * 1. `isSupported()` → `{ supported }`: есть ли на устройстве камера;
 * 2. `isGoogleBarcodeScannerModuleAvailable()` → `{ available }`: установлен
 *    ли на Android модуль Google Barcode Scanner (он приходит с Google Play
 *    Services; метод доступен только на Android — на iOS/web бросает
 *    `Unavailable`, поэтому вызывается под `isAndroid()`).
 *
 * Порядок важен: сначала поддержка, потом разрешение. Запрос разрешения при
 * отсутствии сканера бессмыслен (и на части прошивок приводит к зависанию
 * диалога), поэтому `requestPermissions` вызывается только после успешных
 * проверок.
 *
 * @returns строка QR либо `null`, если отменено, не native, нет камеры,
 *   нет модуля Google Barcode Scanner или разрешение на камеру не выдано
 */
export async function scanQr(): Promise<string | null> {
  if (!isNative()) {
    return null;
  }

  const { supported } = await BarcodeScanner.isSupported();

  if (!supported) {
    console.warn('[qr] сканер недоступен: на устройстве нет камеры');

    return null;
  }

  if (isAndroid()) {
    const { available } =
      await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();

    if (!available) {
      // Модуль можно доустановить (`installGoogleBarcodeScannerModule`), но
      // это отдельный UX-сценарий с прогрессом установки — вне S1.
      console.warn('[qr] сканер недоступен (нет Google Play Services?)');

      return null;
    }
  }

  const perm = await BarcodeScanner.requestPermissions();

  if (perm.camera !== 'granted') {
    console.warn('[qr] разрешение на камеру не выдано');

    return null;
  }

  try {
    // `scan` открывает полноэкранный нативный сканер и завершается, когда
    // пользователь распознал код или закрыл экран (тогда `barcodes` пуст).
    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode],
    });

    return barcodes[0]?.rawValue ?? null;
  } catch (error: unknown) {
    console.warn('[qr] ошибка сканирования', error);

    return null;
  }
}
