import { isRenderableMediaUrl } from '@/types/media';

/**
 * Выбор источника media для узла (R7.8, KI-362).
 *
 * Приоритет: своя ссылка (`storedUrl`, живёт у нас) → ссылка провайдера
 * (`mediaUrl`/`resultUrls[0]`) → плейсхолдер. Если своя ссылка истекла
 * (`storedExpiresAt` в прошлом), показывается маркер «ссылка истекла», а не
 * битая картинка: ссылка провайдера к тому моменту почти наверняка мертва
 * (48 часов), и молчаливая подстановка дала бы «сломанный» `<img>`.
 *
 * Чистая функция без React: покрывается юнит-тестами без jsdom (см. отчёт
 * R7.8 — во `web/` нет React Testing Library).
 */

/** Выходы media-узла из `node_runs.outputs` (форма не гарантирована). */
export type MediaOutputsLike = Record<string, unknown> | null | undefined;

/** Что показывать в узле. */
export interface MediaSource {
  /** URL для `<img>`/`<video>`/`<audio>`; `null` — показывать нечего. */
  src: string | null;
  /** Своя ссылка истекла — нужен плейсхолдер «ссылка истекла». */
  expired: boolean;
  /** Ссылка есть, но схема не http(s) — нужен маркер «некорректный URL». */
  invalid: boolean;
}

/** Входные данные {@link resolveMediaSource}. */
export interface MediaSourceInput {
  /** Выходы узла (`mediaUrl` либо `resultUrls`). */
  outputs?: MediaOutputsLike;
  /** Своя ссылка из `node_runs.stored_url` (приходит в метриках узла). */
  storedUrl?: string | null;
  /** Когда своя ссылка истечёт (ISO), `null` — без TTL. */
  storedExpiresAt?: string | null;
  /**
   * Текущее время (мс) — для тестируемости.
   *
   * По умолчанию `Date.now()`; передаётся явно, чтобы тест на истёкшую ссылку
   * не зависел от системных часов.
   */
  now?: number;
}

/**
 * Достаёт ссылку провайдера из выходов media-узла.
 *
 * Поддерживает обе формы: `mediaUrl` (image/video/audio/music) и
 * `resultUrls[0]` (`image_tool`).
 *
 * @param outputs - выходы узла (тип `unknown` на границе)
 * @returns первая строковая ссылка либо `null`
 */
export function providerMediaUrlOf(outputs: MediaOutputsLike): string | null {
  if (!outputs) {
    return null;
  }

  const mediaUrl = outputs.mediaUrl;

  if (typeof mediaUrl === 'string' && mediaUrl.length > 0) {
    return mediaUrl;
  }

  const resultUrls = outputs.resultUrls;

  if (Array.isArray(resultUrls)) {
    const first = resultUrls.find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    return first ?? null;
  }

  return null;
}

/**
 * Проверяет, что своя ссылка безопасна для `<img src>` (R7.8).
 *
 * `storedUrl` строит backend (`LocalMediaStorage`) как относительный путь
 * `/media/file/...` — это same-origin URL, и `isRenderableMediaUrl` (только
 * `http(s)`) его бы отверг. При этом `javascript:`/`data:` недопустимы, как и
 * для ссылки провайдера (KI-006), поэтому относительный путь принимается
 * только с известным префиксом; абсолютный — по общей проверке схемы.
 *
 * @param url - своя ссылка из `node_runs.stored_url`
 * @returns `true`, если URL можно подставлять в разметку
 */
export function isSafeStoredUrl(url: string): boolean {
  return url.startsWith('/media/file/') || isRenderableMediaUrl(url);
}

/**
 * Выбирает источник media с учётом своей ссылки и её TTL (R7.8).
 *
 * @param input - выходы узла, своя ссылка и время
 * @returns источник: `src`, признаки `expired`/`invalid`
 */
export function resolveMediaSource(input: MediaSourceInput): MediaSource {
  const now = input.now ?? Date.now();
  const storedUrl =
    typeof input.storedUrl === 'string' && input.storedUrl.length > 0
      ? input.storedUrl
      : null;
  const storedExpiresAt = input.storedExpiresAt ?? null;
  const storedExpired =
    storedUrl !== null &&
    storedExpiresAt !== null &&
    Number.isFinite(Date.parse(storedExpiresAt)) &&
    Date.parse(storedExpiresAt) <= now;

  if (storedUrl !== null && !storedExpired) {
    return isSafeStoredUrl(storedUrl)
      ? { src: storedUrl, expired: false, invalid: false }
      : { src: null, expired: false, invalid: true };
  }

  if (storedExpired) {
    return { src: null, expired: true, invalid: false };
  }

  const providerUrl = providerMediaUrlOf(input.outputs);

  if (providerUrl === null) {
    return { src: null, expired: false, invalid: false };
  }

  return isRenderableMediaUrl(providerUrl)
    ? { src: providerUrl, expired: false, invalid: false }
    : { src: null, expired: false, invalid: true };
}
