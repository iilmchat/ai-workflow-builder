import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { isNative } from '@/lib/platform';

/**
 * Открывает камеру и возвращает webPath к фото (v1.5.0 S1, DESIGN V150 § 3.2).
 *
 * Плагин `@capacitor/camera` умеет отдавать фото тремя способами (`base64`,
 * `dataUrl`, `uri`); берём `uri` — это `blob:`/`file:` URL, который можно
 * показать в `<img>` без раздувания памяти base64-строкой.
 *
 * В браузере функция ничего не делает: веб-версия использует обычный
 * `<input type="file">`, а нативный диалог камеры в WebView недоступен.
 *
 * @returns URL фото (blob/file) либо `null`, если отменено, не native или ошибка
 */
export async function capturePhoto(): Promise<string | null> {
  if (!isNative()) {
    return null;
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
    });

    return photo.webPath ?? null;
  } catch (error: unknown) {
    // Пользователь отменил съёмку или камера недоступна — это не повод
    // ронять экран: возвращаем `null`, причина видна в консоли (RULES 4.18).
    console.warn('[camera] отменено или ошибка', error);

    return null;
  }
}
