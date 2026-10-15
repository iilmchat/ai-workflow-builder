import type { Response } from 'express';

/** Имя refresh-cookie. */
export const REFRESH_COOKIE_NAME = 'refresh_token';

/** Путь cookie: браузер отправляет её только на `/auth/*` (R6.1b). */
export const REFRESH_COOKIE_PATH = '/auth';

/**
 * Ставит httpOnly-cookie с refresh-токеном.
 *
 * `httpOnly` — токен недоступен из JS (XSS не украдёт), `sameSite: 'strict'` —
 * CSRF-запросы с чужих сайтов cookie не приложат, `path: '/auth'` — токен не
 * уходит на остальные ручки. Секрет в лог не пишется (RULES 5.9).
 *
 * @param response - ответ Express
 * @param token - opaque refresh-токен
 * @param maxAgeMs - срок жизни в миллисекундах (совпадает с `expires_at`)
 * @param secure - флаг `Secure` (в проде `true`)
 * @returns промис без значения
 */
export function setRefreshCookie(
  response: Response,
  token: string,
  maxAgeMs: number,
  secure: boolean,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

/**
 * Очищает refresh-cookie (logout).
 *
 * @param response - ответ Express
 * @returns промис без значения
 */
export function clearRefreshCookie(response: Response): void {
  response.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
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
