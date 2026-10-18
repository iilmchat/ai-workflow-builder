import { isRenderableMediaUrl } from '@/types/media';

/**
 * Выбор источника media для узла (KI-444, R7.8/KI-362).
 *
 * Своя ссылка (`storedUrl` — копия результата в нашем хранилище) — единственный
 * источник, срок жизни которого нам известен. Ссылка провайдера живёт 48 часов
 * и после этого мертва (KI-443), поэтому в разметку она **не подставляется**:
 * если своей копии нет (`storedUrl` отсутствует) или её TTL прошёл
 * (`storedExpiresAt` в прошлом), узел показывает плейсхолдер «ссылка истекла»
 * (`ExpiredMediaPlaceholder`), а не возможно битую картинку.
 *
 * Чистая функция без React: покрывается юнит-тестами. Компонентные тесты
 * медиа-узлов идут в jsdom через `@testing-library/react` (KI-155).
 */

/** Выходы media-узла из `node_runs.outputs` (форма не гарантирована). */
export type MediaOutputsLike = Record<string, unknown> | null | undefined;

/** Что показывать в узле. */
export interface MediaSource {
  /** URL для `<img>`/`<video>`/`<audio>`; `null` — показывать нечего. */
  src: string | null;
  /** Ссылка недоступна: нужен плейсхолдер «ссылка истекла». */
  expired: boolean;
  /** Ссылка есть, но она небезопасна для разметки — нужен маркер «некорректный URL». */
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
 * Нужна не для показа (см. {@link resolveMediaSource}), а как признак того, что
 * результат у узла **есть**: по нему отличаем «результат не сохранён у нас» от
 * «узел ещё не выполнялся».
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
 * `/media/file/...` — это same-origin URL, и `isRenderableMediaUrl` (`http(s)`
 * и разрешённые `data:image`, KI-378) его бы отверг. При этом `javascript:` и
 * нерастровые `data:` недопустимы, как и для ссылки провайдера (KI-006),
 * поэтому относительный путь принимается только с известным префиксом;
 * абсолютный — по общей проверке схемы.
 *
 * @param url - своя ссылка из `node_runs.stored_url`
 * @returns `true`, если URL можно подставлять в разметку
 */
export function isSafeStoredUrl(url: string): boolean {
  return url.startsWith('/media/file/') || isRenderableMediaUrl(url);
}

/**
 * Выбирает источник media с учётом своей ссылки и её TTL (R7.8, KI-444).
 *
 * Правило одно: показывать можно только свою ссылку. Она либо жива (`src`),
 * либо недоступна — истёк TTL **или** копии нет вовсе, хотя результат у узла
 * есть (`expired`). Некорректная ссылка (схема `javascript:`, не-растровый
 * `data:`) отличается от «истекла»: это ошибка данных, а не времени.
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

  if (storedUrl !== null) {
    if (storedExpired) {
      return { src: null, expired: true, invalid: false };
    }

    return isSafeStoredUrl(storedUrl)
      ? { src: storedUrl, expired: false, invalid: false }
      : { src: null, expired: false, invalid: true };
  }

  // Своей копии нет. Результат при этом мог быть: старый прогон (до появления
  // хранилища) либо сбой загрузки в S3 — узел тогда отдаёт `storedUrl: null`.
  // Ссылку провайдера не подставляем: её TTL (48 часов) нам неизвестен, и
  // молчаливая подстановка дала бы битый `<img>` через сутки.
  const providerUrl = providerMediaUrlOf(input.outputs);

  if (providerUrl === null) {
    // Результата нет вообще — это не «истекла», а «ещё не выполнялся».
    return { src: null, expired: false, invalid: false };
  }

  return isRenderableMediaUrl(providerUrl)
    ? { src: null, expired: true, invalid: false }
    : { src: null, expired: false, invalid: true };
}
