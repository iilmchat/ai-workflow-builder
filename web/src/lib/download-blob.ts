/** Максимальная длина имени файла без расширения. */
const MAX_BASE_LENGTH = 100;

/** Символы, недопустимые в имени файла на Windows (`\ / : * ? " < > |`). */
const FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

/**
 * Последний код управляющего символа (0x1F).
 *
 * Фильтруем по коду, а не регуляркой `[\u0000-\u001F]`: сопоставление
 * управляющих символов шаблоном — предупреждение линтера (no-control-regex).
 */
const LAST_CONTROL_CODE = 0x1f;

/** Имя файла по умолчанию, если в названии workflow не осталось символов. */
const FALLBACK_BASE = 'workflow';

/** Расширение артефакта workflow (DESIGN v0.8 § 9). */
const WORKFLOW_EXTENSION = '.workflow.json';

/**
 * Собирает безопасное имя файла для скачивания workflow.
 *
 * Название workflow приходит от пользователя и может содержать символы,
 * недопустимые в имени файла (Windows отвергает `\/:*?"<>|`), управляющие
 * символы и слишком длинные строки. Здесь имя приводится к виду, который
 * сохраняется любым браузером: запрещённые символы → `_`, краевые точки и
 * пробелы убираются, длина ограничивается 100 символами.
 *
 * @param workflowName - название workflow (может быть пустым)
 * @returns имя файла вида `<name>.workflow.json` (для пустого названия —
 *   `workflow.workflow.json`)
 */
export function exportFileNameOf(workflowName: string): string {
  const sanitized = workflowName
    .split('')
    .filter((char) => char.charCodeAt(0) > LAST_CONTROL_CODE)
    .join('')
    .replace(FORBIDDEN_CHARS, '_')
    // Точки и пробелы по краям Windows отбрасывает молча — убираем сами,
    // иначе имя на диске не совпадёт с ожидаемым в UI и тестах.
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/[\s.]+$/, '');

  return `${sanitized === '' ? FALLBACK_BASE : sanitized}${WORKFLOW_EXTENSION}`;
}

/**
 * Запускает скачивание blob-объекта через скрытую ссылку `<a download>`.
 *
 * Браузерного API скачивания «в лоб» не существует: файл отдаётся ссылке с
 * атрибутом `download`, клик по которой перехватывает браузер. Ссылка не
 * добавляется в разметку приложения — она живёт внутри функции, потому что
 * React-элементы здесь ни при чём (`document.createElement` + `remove()`).
 *
 * @param blob - содержимое файла
 * @param filename - имя файла для пользователя
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  // Ссылка должна быть в документе: без этого часть браузеров игнорирует клик.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Освобождаем blob-URL: иначе объект живёт до перезагрузки страницы.
  URL.revokeObjectURL(url);
}
