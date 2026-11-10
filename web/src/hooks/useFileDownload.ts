import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { resolveApiUrl } from '@/lib/api-base';
import { isNative } from '@/lib/platform';

/**
 * MIME-тип DOCX (v1.5.0 S3, DESIGN V150 § 3.3).
 *
 * Полная строка нужна нативной стороне: `FileOpener.open` по `contentType`
 * выбирает activity, которая умеет открыть файл. Короткий
 * `application/msword` относится к legacy `.doc`, и Android может не найти
 * обработчик для `.docx`.
 */
export const MIME_DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** MIME-тип PDF — второй формат узла `document_gen` (v0.12 S1). */
export const MIME_PDF = 'application/pdf';

/**
 * Скачивает файл и открывает его нативным просмотрщиком (v1.5.0 S3,
 * DESIGN V150 § 3.3).
 *
 * **Зачем не `<a download>`.** В браузере ссылка с атрибутом `download`
 * работает, но в Capacitor WebView навигация на `blob:`/`http:`-ссылку не
 * скачивает файл в «Загрузки»: Android либо открывает пустую страницу, либо
 * молча ничего не делает (в S2 та же природа была у абсолютных путей, KI-647).
 * Поэтому на нативной платформе файл сначала кладётся в песочницу приложения
 * (`Directory.Documents`), а затем отдаётся системе через `FileOpener` — она
 * показывает «Открыть с помощью» (Word, Google Docs, просмотрщик PDF).
 *
 * **Веб-ветка** остаётся прежней: программный `<a download>` — единственный
 * способ отдать файл браузеру без изменения текущего экрана.
 *
 * Ошибки не глотаются: fetch/запись/открытие могут упасть (нет сети, нет
 * свободного места, нет приложения-обработчика), и вызывающий компонент
 * обязан показать пользователю сообщение (RULES 4.18).
 *
 * @param url - ссылка на файл (`/media/file/...` или абсолютный `http(s)`)
 * @param fileName - имя файла без пути (`document.docx`)
 * @param mimeType - MIME-тип для нативного просмотрщика (по умолчанию DOCX)
 * @throws Error если сервер ответил не-2xx, а также любая ошибка `Filesystem`
 *   или `FileOpener`
 */
export async function downloadAndOpenFileAsync(
  url: string,
  fileName: string,
  mimeType: string = MIME_DOCX,
): Promise<void> {
  if (!isNative()) {
    downloadInBrowser(url, fileName);

    return;
  }

  // В native-сборке относительный `/media/file/...` указывал бы в сам WebView
  // (`https://localhost`): resolveApiUrl добавляет `VITE_API_BASE` (KI-658),
  // абсолютные presigned-ссылки S3 остаются как есть.
  const response = await fetch(resolveApiUrl(url));

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const blob = await response.blob();
  const base64 = await blobToBase64Async(blob);

  // `Directory.Documents` — приватный каталог приложения (Documents/), запись
  // туда не требует разрешений storage на Android 10+ (scoped storage).
  const result = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });

  // `result.uri` — `file:///…/Documents/<fileName>`, его и открывает система.
  await FileOpener.open({ filePath: result.uri, contentType: mimeType });
}

/**
 * Скачивает файл силами браузера через временную ссылку (веб-ветка).
 *
 * Ссылка добавляется в DOM перед `click()`: в Firefox программный клик по
 * элементу вне документа игнорируется. После клика элемент сразу удаляется,
 * чтобы не копить мусор при повторных скачиваниях.
 *
 * @param url - ссылка на файл
 * @param fileName - имя сохраняемого файла
 */
function downloadInBrowser(url: string, fileName: string): void {
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Читает `Blob` в base64-строку без префикса `data:`.
 *
 * `Filesystem.writeFile` принимает `data` как base64, а `fetch` отдаёт `Blob`;
 * поэтому нужен `FileReader.readAsDataURL` и отбрасывание заголовка
 * `data:<mime>;base64,`. `FileReader` доступен и в WebView, и в jsdom
 * (поэтому в тестах не нужно мокать чтение файла).
 *
 * @param blob - скачанный бинарный объект
 * @returns base64-содержимое файла (без `data:`-префикса)
 * @throws Error если чтение файла завершилось ошибкой
 */
function blobToBase64Async(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = reader.result as string;

      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Не удалось прочитать файл'));
    };
    reader.readAsDataURL(blob);
  });
}
