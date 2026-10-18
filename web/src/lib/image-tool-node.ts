import { isRenderableMediaUrl } from '@/types/media';

/**
 * Чистые функции узла `image_tool` (R7.1, KI-196).
 *
 * Вынесены из компонента (`components/nodes/ImageToolNode.tsx`): компонентные
 * тесты во фронтенде не запускаются — в `vitest.config.ts` стоит
 * `environment: 'node'` без jsdom (KI-155), поэтому вся логика, которую нужно
 * покрыть тестом, живёт в чистом модуле.
 */

/**
 * Достаёт ссылку на входной файл из outputs узла-источника.
 *
 * Источником может быть `image_generation` (порт `url`), другой `image_tool`
 * (порт `resultUrls`) или текстовый узел, отдавший ссылку текстом — поэтому
 * проверяются все известные ключи, а не только `url`. Схема ссылки
 * ограничивается `http(s)`: `javascript:`/`data:` в `<img src>` недопустимы
 * (KI-006).
 *
 * @param outputs - outputs узла-источника из стора (`nodeOutputs[sourceId]`)
 * @returns `http(s)`-ссылку либо `null`, если картинки во входах нет
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
