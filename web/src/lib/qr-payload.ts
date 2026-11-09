/**
 * Разбор полезной нагрузки QR-кода (v1.5.0 S1, DESIGN V150 § 3.2).
 *
 * Сканер возвращает произвольную строку: пользователь может отсканировать
 * ссылку на workflow, share-ссылку или что-то постороннее. Разбор вынесен из
 * компонента в чистую функцию: `TopBar` не должен знать про форматы payload'ов,
 * а тесты — рендерить шапку ради проверки строк.
 */

/** Шаблон uuid в нижнем или верхнем регистре (id workflow и share-токен). */
const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** QR-код содержит только uuid — это id сохранённого workflow. */
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');

/** Путь публичной share-ссылки (R6.2.2): `/workflow/share/<token>`. */
const SHARE_PATH_RE = new RegExp(`^/workflow/share/(${UUID_PATTERN})/?$`, 'i');

/**
 * Распознанная полезная нагрузка QR-кода.
 *
 * - `workflow` — id сохранённого workflow, который нужно открыть;
 * - `share` — путь публичной share-страницы, на которую нужно перейти.
 */
export type QrPayload =
  | { readonly kind: 'workflow'; readonly id: string }
  | { readonly kind: 'share'; readonly path: string };

/**
 * Извлекает путь share-страницы из абсолютного URL или относительного пути.
 *
 * Абсолютный URL разбирается через `URL` (он сам отбрасывает origin и
 * query-строку); относительный путь — вручную, потому что `URL` без базы
 * бросает исключение на относительном пути. Хвостовой слэш допускается:
 * share-ссылка в буфере обмена часто копируется с ним.
 *
 * @param text - непустая строка из QR-кода
 * @returns `/workflow/share/<token>` либо `null`, если это не share-ссылка
 */
function sharePathOf(text: string): string | null {
  let pathname: string;

  if (/^https?:\/\//i.test(text)) {
    try {
      pathname = new URL(text).pathname;
    } catch {
      return null;
    }
  } else {
    // Относительная ссылка: отбрасываем query/fragment вручную.
    pathname = text.split(/[?#]/, 1)[0] ?? '';
  }

  const match = SHARE_PATH_RE.exec(pathname);

  return match?.[1] === undefined ? null : `/workflow/share/${match[1]}`;
}

/**
 * Разбирает значение, распознанное QR-сканером.
 *
 * Поддерживаются три формы (все — из «своих» экранов приложения):
 * - `f47ac10b-58cc-4372-a567-0e02b2c3d479` — id workflow;
 * - `https://app.example/workflow/share/<token>` — абсолютная share-ссылка;
 * - `/workflow/share/<token>` — относительная share-ссылка.
 *
 * Всё остальное (чужой URL, текст, пустая строка) считается некорректным QR:
 * открывать произвольную ссылку из QR-кода нельзя — это классический вектор
 * фишинга.
 *
 * @param value - строка из `scanQr()` (может содержать пробелы по краям)
 * @returns разобранная нагрузка либо `null`, если формат не распознан
 */
export function parseQrPayload(value: string): QrPayload | null {
  const text = value.trim();

  if (text.length === 0) {
    return null;
  }

  if (UUID_RE.test(text)) {
    return { kind: 'workflow', id: text };
  }

  const sharePath = sharePathOf(text);

  return sharePath === null ? null : { kind: 'share', path: sharePath };
}
