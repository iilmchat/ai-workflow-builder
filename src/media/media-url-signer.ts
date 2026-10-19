import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-подпись ссылок локального media-хранилища (KI-415).
 *
 * Проблема: `GET /media/file/:runId/:fileName` отдаёт файлы без авторизации,
 * потому что `<img src>`/`<video src>` браузера не умеют прикладывать
 * `Authorization`. Защита «непредсказуемый uuid в пути» слабая: ссылка утекает
 * в логи прокси, историю браузера, `Referer` и т.п., а дальше работает вечно.
 *
 * Решение — подписанный URL: `?expires=<unix>&sign=<HMAC-SHA256>`. Подпись
 * покрывает ключ объекта (`<runId>/<fileName>`) и срок жизни, поэтому изменить
 * путь или продлить ссылку без секрета нельзя. Секрет берётся из
 * `MEDIA_URL_SIGNING_SECRET`, а если он не задан — из `JWT_SECRET` (он
 * обязателен в `EnvSchema`): отдельный секрет предпочтительнее, но подпись
 * должна работать «из коробки», без новой обязательной переменной окружения.
 *
 * **Почему HMAC, а не JWT.** Нужна одна проверка «ключ + срок», без полезной
 * нагрузки в токене. JWT добавил бы base64-заголовок/claim'ы и зависимость от
 * `jsonwebtoken`, но не дал бы ничего: тот же shared secret, та же HS256.
 *
 * Модуль нарочно не знает про Nest и файловую систему: это чистые функции,
 * которые одинаково используют `LocalMediaStorage` (выпуск ссылки) и
 * `MediaStorageController` (проверка). Так подпись покрыта юнит-тестами без
 * HTTP и без диска.
 */

/** Путь HTTP-ручки отдачи локальных media-файлов (KI-362). */
export const MEDIA_FILE_URL_PREFIX = '/media/file';

/** Время жизни подписанной ссылки по умолчанию (сек) — один час. */
export const DEFAULT_MEDIA_URL_TTL_SECONDS = 3600;

/** Минимальная длина секрета HMAC (символов): короче — тривиальный подбор. */
export const MIN_MEDIA_SIGNING_SECRET_LENGTH = 16;

/** Проверенные параметры подписи media-URL. */
export interface MediaSigningOptions {
  /** Секрет HMAC-SHA256 (не попадает в лог и в URL). */
  secret: string;
  /** Время жизни ссылки от момента выпуска (сек). */
  ttlSeconds: number;
}

/**
 * Минимальный контракт чтения env, нужный для сборки параметров подписи.
 *
 * `ConfigService` подходит структурно; отдельный интерфейс позволяет тестам
 * подставлять объект-заглушку, не собирая Nest-модуль.
 */
export interface MediaSigningConfigReader {
  /**
   * Читает значение env по ключу.
   *
   * @param key - имя переменной окружения
   * @returns значение либо `undefined`, если переменная не задана
   */
  get(key: string): unknown;
}

/**
 * Собирает параметры подписи из env (KI-415).
 *
 * Приоритет секретов: явный `MEDIA_URL_SIGNING_SECRET` → `JWT_SECRET`. Отдельный
 * секрет рекомендован в проде (ротация подписей не должна ломать авторизацию),
 * но требовать его в dev/CI было бы лишним: `JWT_SECRET` уже обязателен.
 *
 * @param config - доступ к env; `undefined` — подпись не настроена
 * @returns параметры подписи либо `null`, если секрет отсутствует/слишком
 *   короткий (тогда ссылки остаются без подписи — прежнее поведение)
 */
export function resolveMediaSigningOptions(
  config?: MediaSigningConfigReader | null,
): MediaSigningOptions | null {
  if (config === undefined || config === null) {
    return null;
  }

  const configured = normalizeSecret(config.get('MEDIA_URL_SIGNING_SECRET'));
  const jwtSecret = normalizeSecret(config.get('JWT_SECRET'));
  const secret = configured ?? jwtSecret;

  if (secret === null) {
    return null;
  }

  return { secret, ttlSeconds: resolveTtlSeconds(config.get('MEDIA_URL_TTL_SECONDS')) };
}

/**
 * Приводит значение секрета к непустой строке достаточной длины.
 *
 * @param value - сырое значение из env
 * @returns секрет либо `null`, если значение не подходит
 */
function normalizeSecret(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length >= MIN_MEDIA_SIGNING_SECRET_LENGTH ? trimmed : null;
}

/**
 * Разбирает TTL ссылки из env.
 *
 * @param value - сырое значение (`number` после Zod-валидации либо строка)
 * @returns положительное целое число секунд (дефолт — час)
 */
function resolveTtlSeconds(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  return Number.isInteger(numeric) && numeric > 0
    ? numeric
    : DEFAULT_MEDIA_URL_TTL_SECONDS;
}

/**
 * Считает HMAC-SHA256 подпись для ключа и срока действия.
 *
 * В подпись входит и ключ, и `expires`: иначе можно было бы взять валидную
 * подпись чужого файла или бесконечно продлевать срок, меняя query-параметр.
 * Разделитель `\n` исключает склейку (`a`+`bc` ≠ `ab`+`c`) при разных ключах.
 *
 * @param storageKey - ключ объекта `<runId>/<fileName>`
 * @param expires - срок действия, unix-секунды
 * @param secret - секрет HMAC
 * @returns подпись в base64url (пригодна для query-строки без экранирования)
 */
function signPayload(storageKey: string, expires: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${storageKey}\n${expires}`)
    .digest('base64url');
}

/**
 * Выпускает подписанный путь ссылки локального media-файла.
 *
 * Возвращается относительный путь (без origin): приложение может стоять за
 * reverse proxy с другим публичным адресом, и абсолютный URL сломал бы схему.
 * Query-параметры `expires`/`sign` — единственное, что отличает ссылку от
 * публичного пути (`KI-415`).
 *
 * @param storageKey - ключ объекта `<runId>/<fileName>`
 * @param options - секрет и TTL подписи
 * @param now - точка отсчёта (в тестах подменяется фиксированной датой)
 * @param publicPrefix - префикс ручки отдачи (по умолчанию `/media/file`)
 * @returns относительный путь со свежей подписью и момент её истечения
 */
export function buildSignedMediaPath(
  storageKey: string,
  options: MediaSigningOptions,
  now: Date = new Date(),
  publicPrefix: string = MEDIA_FILE_URL_PREFIX,
): { path: string; expiresAt: Date } {
  const expires = Math.floor(now.getTime() / 1000) + options.ttlSeconds;
  const sign = signPayload(storageKey, expires, options.secret);
  const prefix = publicPrefix.replace(/\/+$/, '');

  return {
    path: `${prefix}/${storageKey}?expires=${expires}&sign=${sign}`,
    expiresAt: new Date(expires * 1000),
  };
}

/**
 * Проверяет подпись ссылки локального media-файла.
 *
 * Порядок проверок: срок (дешёвая) → сравнение HMAC в постоянное время.
 * `timingSafeEqual` требует одинаковой длины буферов, поэтому длины сверяются
 * отдельно; сравнение байт, а не строк, не даёт утечки по времени.
 *
 * @param storageKey - ключ объекта из пути запроса
 * @param sign - query-параметр `sign` (может отсутствовать)
 * @param expires - query-параметр `expires` (unix-секунды, строка)
 * @param options - секрет и TTL подписи
 * @param now - точка отсчёта (в тестах подменяется фиксированной датой)
 * @returns `true`, если подпись валидна и срок не истёк
 */
export function verifyMediaFileSignature(
  storageKey: string,
  sign: string | undefined,
  expires: string | undefined,
  options: MediaSigningOptions,
  now: Date = new Date(),
): boolean {
  if (sign === undefined || sign.length === 0 || expires === undefined) {
    return false;
  }

  const expiresSeconds = Number(expires);

  if (!Number.isInteger(expiresSeconds) || expiresSeconds <= 0) {
    return false;
  }

  // Просроченная ссылка не проверяется по HMAC: секрет не нужен, чтобы понять,
  // что срок вышел, а лишняя криптография в горячем пути ни к чему.
  if (expiresSeconds * 1000 <= now.getTime()) {
    return false;
  }

  const expected = Buffer.from(signPayload(storageKey, expiresSeconds, options.secret));
  const provided = Buffer.from(sign);

  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

/**
 * Достаёт срок действия из подписанной локальной ссылки.
 *
 * Нужен снимку запуска (`RunsStreamService`): подпись живёт час, а файл —
 * `MEDIA_STORAGE_LOCAL_TTL_DAYS`; по query-параметру `expires` снимок понимает,
 * что ссылку пора перевыпустить, не дожидаясь истечения файлового TTL. Для
 * S3-presigned URL и внешних ссылок возвращается `null`: их срок берётся из
 * `node_runs.stored_expires_at` (у S3 — `X-Amz-Expires`, у публичного бакета
 * ссылка не истекает).
 *
 * @param storedUrl - ссылка из `node_runs.stored_url` (может быть относительной)
 * @returns момент истечения подписи либо `null`, если ссылка не подписана нами
 */
export function parseSignedMediaUrlExpiry(storedUrl: string): Date | null {
  let url: URL;

  try {
    // База нужна только для разбора относительного пути: origin не сохраняется.
    url = new URL(storedUrl, 'http://localhost');
  } catch {
    return null;
  }

  if (!url.pathname.startsWith(`${MEDIA_FILE_URL_PREFIX}/`)) {
    return null;
  }

  const raw = url.searchParams.get('expires');

  if (raw === null) {
    return null;
  }

  const expiresSeconds = Number(raw);

  if (!Number.isInteger(expiresSeconds) || expiresSeconds <= 0) {
    return null;
  }

  return new Date(expiresSeconds * 1000);
}

/**
 * Разбирает ключ объекта из локальной ссылки `/media/file/<runId>/<fileName>`.
 *
 * Fallback для строк, сохранённых до `storage_key` (KI-451): по ключу их
 * переподписать нельзя, а по URL — можно, пока хранилище local. Путь
 * декодируется (`decodeURIComponent`), потому что имя файла в URL могло быть
 * экранировано.
 *
 * @param storedUrl - ссылка из `node_runs.stored_url`
 * @param publicPrefix - префикс ручки (по умолчанию `/media/file`)
 * @returns ключ `<runId>/<fileName>` либо `null`, если URL не наш
 */
export function parseLocalMediaStorageKey(
  storedUrl: string,
  publicPrefix: string = MEDIA_FILE_URL_PREFIX,
): string | null {
  const prefix = `${publicPrefix.replace(/\/+$/, '')}/`;

  let url: URL;

  try {
    url = new URL(storedUrl, 'http://localhost');
  } catch {
    return null;
  }

  if (!url.pathname.startsWith(prefix)) {
    return null;
  }

  const rawKey = url.pathname.slice(prefix.length);

  if (rawKey.length === 0) {
    return null;
  }

  try {
    return decodeURIComponent(rawKey);
  } catch {
    // Битый percent-encoding: ключ не восстановить.
    return null;
  }
}

