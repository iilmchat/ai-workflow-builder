import type { Response } from 'express';

/** Имя refresh-cookie. */
export const REFRESH_COOKIE_NAME = 'refresh_token';

/** Путь cookie: браузер отправляет её только на `/auth/*` (R6.1b). */
export const REFRESH_COOKIE_PATH = '/auth';

/** Допустимые значения `SameSite` для refresh-cookie (v1.6.0 S6-B, KI-664). */
export const REFRESH_COOKIE_SAME_SITE_VALUES = [
  'Strict',
  'Lax',
  'None',
] as const;

/** Значение `SameSite` refresh-cookie. */
export type RefreshCookieSameSite =
  (typeof REFRESH_COOKIE_SAME_SITE_VALUES)[number];

/**
 * Origin'ы, с которых ходит Capacitor WebView.
 *
 * Android WebView загружает бандл с `https://localhost`, iOS/Capacitor —
 * с `capacitor://localhost`. Оба варианта — **другой origin**, чем домен API,
 * поэтому `SameSite=Strict`-cookie в запросе не окажется (KI-664).
 */
const CAPACITOR_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);

/** Опции refresh-cookie, которые зависят от origin'а запроса. */
export interface RefreshCookieOptions {
  /** Значение `SameSite` для `Set-Cookie`. */
  readonly sameSite: RefreshCookieSameSite;
  /** Флаг `Secure`; для `SameSite=None` обязан быть `true`. */
  readonly secure: boolean;
}

/**
 * Приводит `SameSite` к форме, которую ожидает Express.
 *
 * В env и документации значения записаны как `Strict`/`Lax`/`None` (так их
 * пишут в атрибуте `Set-Cookie`), а `@types/express` требует lowercase.
 * `cookie` сериализует их обратно с заглавной буквы.
 *
 * @param value - значение из {@link RefreshCookieSameSite}
 * @returns lowercase-значение для `CookieOptions.sameSite`
 */
function toExpressSameSite(
  value: RefreshCookieSameSite,
): 'strict' | 'lax' | 'none' {
  switch (value) {
    case 'Lax':
      return 'lax';
    case 'None':
      return 'none';
    default:
      return 'strict';
  }
}

/** Входные данные для {@link resolveRefreshCookieOptions}. */
export interface ResolveRefreshCookieOptionsParams {
  /** `request.headers.origin` (значение не доверенное: проверяется по набору). */
  readonly origin: unknown;
  /** `NODE_ENV` из `ConfigService`. */
  readonly nodeEnv: unknown;
  /** `COOKIE_SAMESITE` из `ConfigService` (уже валидирован `EnvSchema`). */
  readonly configuredSameSite: unknown;
  /** Базовый флаг `Secure` (`COOKIE_SECURE` / прод-дефолт). */
  readonly secure: boolean;
}

/**
 * Проверяет тип значения `SameSite` из окружения.
 *
 * `ConfigService.get` возвращает `unknown`: без сужения произвольная строка
 * попала бы в `Set-Cookie` (RULES 4.15).
 *
 * @param value - значение из env
 * @returns `true`, если это допустимый `SameSite`
 */
export function isRefreshCookieSameSite(
  value: unknown,
): value is RefreshCookieSameSite {
  return (
    typeof value === 'string' &&
    (REFRESH_COOKIE_SAME_SITE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Является ли origin Capacitor WebView.
 *
 * Сравнение регистронезависимое: схема и хост в `Origin` нормализованы
 * браузером в lowercase, но заголовок приходит извне и ему не доверяем.
 *
 * @param origin - `request.headers.origin`
 * @returns `true` для `https://localhost` / `capacitor://localhost`
 */
export function isCapacitorOrigin(origin: unknown): boolean {
  return (
    typeof origin === 'string' &&
    CAPACITOR_ORIGINS.has(origin.trim().toLowerCase())
  );
}

/**
 * Выбирает `SameSite`/`Secure` для refresh-cookie (v1.6.0 S6-B, KI-664).
 *
 * Правила:
 * - `production` + Capacitor-origin → `None` + `Secure`: иначе cross-site
 *   cookie из WebView не отправится и сессия не восстановится;
 * - иначе — `COOKIE_SAMESITE` из env (дефолт `Strict`);
 * - `SameSite=None` всегда требует `Secure` (браузеры отвергают иначе).
 *
 * В `development`/`test` Capacitor-детект не применяется: там WebView ходит на
 * dev-сервер, а `Secure`-cookie по http всё равно не сохранилась бы.
 *
 * @param params - origin запроса, окружение и базовые флаги
 * @returns итоговые `sameSite` и `secure`
 */
export function resolveRefreshCookieOptions(
  params: ResolveRefreshCookieOptionsParams,
): RefreshCookieOptions {
  const sameSite: RefreshCookieSameSite =
    params.nodeEnv === 'production' && isCapacitorOrigin(params.origin)
      ? 'None'
      : isRefreshCookieSameSite(params.configuredSameSite)
        ? params.configuredSameSite
        : 'Strict';

  return {
    sameSite,
    secure: params.secure || sameSite === 'None',
  };
}

/**
 * Ставит httpOnly-cookie с refresh-токеном.
 *
 * `httpOnly` — токен недоступен из JS (XSS не украдёт), `path: '/auth'` —
 * токен не уходит на остальные ручки. `sameSite`/`secure` приходят из
 * {@link resolveRefreshCookieOptions}: в вебе это `Strict`, в Capacitor
 * WebView — `None; Secure` (S6-B, KI-664). Секрет в лог не пишется
 * (RULES 5.9).
 *
 * @param response - ответ Express
 * @param token - opaque refresh-токен
 * @param maxAgeMs - срок жизни в миллисекундах (совпадает с `expires_at`)
 * @param options - `sameSite` и `secure`
 * @returns промис без значения
 */
export function setRefreshCookie(
  response: Response,
  token: string,
  maxAgeMs: number,
  options: RefreshCookieOptions,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: toExpressSameSite(options.sameSite),
    secure: options.secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

/**
 * Очищает refresh-cookie (logout).
 *
 * Атрибуты `sameSite`/`secure` повторяют установку: браузер удаляет cookie по
 * имени и пути, но одинаковый `Set-Cookie` избавляет от расхождений в
 * WebView, где cookie была поставлена с `SameSite=None`.
 *
 * @param response - ответ Express
 * @param options - `sameSite` и `secure` (как при установке)
 * @returns промис без значения
 */
export function clearRefreshCookie(
  response: Response,
  options: RefreshCookieOptions,
): void {
  response.clearCookie(REFRESH_COOKIE_NAME, {
    path: REFRESH_COOKIE_PATH,
    sameSite: toExpressSameSite(options.sameSite),
    secure: options.secure,
  });
}

/**
 * Читает refresh-токен из cookie запроса.
 *
 * `req.cookies` приходит от `cookie-parser` как `any`, поэтому значение
 * сужается до `string` без небезопасных обращений (RULES 4.15).
 *
 * @param cookies - `request.cookies`
 * @returns токен или `undefined`, если cookie нет/не строка
 */
export function readRefreshCookie(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }

  const value = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
