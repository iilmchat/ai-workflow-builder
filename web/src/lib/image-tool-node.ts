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
