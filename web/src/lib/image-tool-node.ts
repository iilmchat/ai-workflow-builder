import { isRenderableMediaUrl } from '@/types/media';

/**
 * Чистые функции узла `image_tool` (R7.1, KI-196).
 *
 * Вынесены из компонента (`components/nodes/ImageToolNode.tsx`): логика превью
 * и валидации проверяется юнит-тестами, а компонентные тесты в jsdom (KI-155)
 * покрывают только отображение.
 */

/**
 * Схема `http(s)` в начале значения (регистр не важен, RFC 3986).
 *
 * Проверка нужна до `new URL()`: `URL` принимает и `http:foo`, которое
 * требованию «начинается с `http://` или `https://`» не соответствует.
 */
const HTTP_URL_PREFIX = /^https?:\/\//i;

/**
 * Достаёт ссылку на входной файл из outputs узла-источника.
 *
 * Источником может быть `image_generation` (порт `url`), другой `image_tool`
 * (порт `resultUrls`) или текстовый узел, отдавший ссылку текстом — поэтому
 * проверяются все известные ключи, а не только `url`. Схема ссылки
 * ограничивается `http(s)` и растровыми `data:image` (KI-378):
 * `javascript:` и SVG-`data:` в `<img src>` недопустимы (KI-006).
 *
 * @param outputs - outputs узла-источника из стора (`nodeOutputs[sourceId]`)
 * @returns безопасную для `<img>` ссылку (`http(s)` или `data:image`) либо
 *   `null`, если картинки во входах нет
 */
export function inputUrlFromOutputs(
  outputs: Record<string, unknown> | undefined,
): string | null {
  if (outputs === undefined) {
    return null;
  }

  const candidates: unknown[] = [
    outputs.url,
    outputs.mediaUrl,
    outputs.text,
    Array.isArray(outputs.resultUrls) ? outputs.resultUrls[0] : undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && isRenderableMediaUrl(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Проверяет, что значение — обычный объект (не массив и не `null`).
 *
 * @param value - значение из `data.params` (jsonb, RULES 1.17)
 * @returns `true`, если у значения можно читать/писать ключи
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Читает `data.params.audioUrl` для операции `lipsync` (KI-369).
 *
 * @param params - `data.params` узла (не типизирован: jsonb)
 * @returns URL аудио либо `''`, если поле не задано/не строка
 */
export function readToolAudioUrl(params: unknown): string {
  if (!isPlainRecord(params)) {
    return '';
  }

  return typeof params.audioUrl === 'string' ? params.audioUrl : '';
}

/**
 * Возвращает новые `data.params` с обновлённым `audioUrl` (KI-369).
 *
 * Остальные параметры операции (`prompt`, поля модели) сохраняются. Пустое
 * значение удаляет ключ: пустых строк в JSON быть не должно (KI-129).
 *
 * @param params - текущие `data.params` узла
 * @param audioUrl - значение поля ввода
 * @returns копия параметров с `audioUrl` либо без него
 */
export function withToolAudioUrl(
  params: unknown,
  audioUrl: string,
): Record<string, unknown> {
  const next = isPlainRecord(params) ? { ...params } : {};
  const trimmed = audioUrl.trim();

  if (trimmed.length === 0) {
    delete next.audioUrl;
  } else {
    next.audioUrl = trimmed;
  }

  return next;
}

/**
 * Проверяет, что введённый `audioUrl` — корректная `http(s)`-ссылка (KI-424).
 *
 * Пустое значение считается **нейтральным**: поле ещё не заполнено, и красная
 * рамка на новом узле `lipsync` была бы ложной ошибкой. Требование «аудио
 * обязательно» проверяет backend (KI-369), а UI валидирует только формат
 * введённой ссылки.
 *
 * `type="url"` в браузере недостаточно: он принимает и `ftp://`/`mailto:`, и
 * не мешает нажать Run (кнопка живёт вне `<form>`), поэтому схема проверяется
 * явно — до `URL`, чтобы отсечь `http:foo` без обязательных `//`.
 *
 * @param value - значение поля `data.params.audioUrl`
 * @returns `true`, если непустая ссылка не начинается с `http://`/`https://`
 *   или не разбирается как URL
 */
export function isAudioUrlInvalid(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (!HTTP_URL_PREFIX.test(trimmed)) {
    return true;
  }

  try {
    // `https://` без хоста браузерный `type="url"` тоже считает ошибкой:
    // проверяем, что после схемы есть непустой hostname.
    return new URL(trimmed).hostname.length === 0;
  } catch {
    return true;
  }
}

/**
 * Выбирает ссылку для превью входа узла.
 *
 * Приоритет: вход по связи (первый узел, у которого есть ссылка) →
 * `data.inputUrl` (фолбэк, когда связи ещё нет).
 *
 * @param upstreamUrls - ссылки, собранные из outputs входящих узлов
 * @param declaredInput - значение `data.inputUrl`
 * @returns `http(s)`-ссылку либо `null`, если превью показывать нечего
 */
export function pickInputPreviewUrl(
  upstreamUrls: readonly (string | null)[],
  declaredInput: unknown,
): string | null {
  const fromUpstream = upstreamUrls.find((url): url is string => url !== null);

  if (fromUpstream !== undefined) {
    return fromUpstream;
  }

  return typeof declaredInput === 'string' && isRenderableMediaUrl(declaredInput)
    ? declaredInput
    : null;
}
