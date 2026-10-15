import { z } from 'zod';
import type { AuthUser } from '@/stores/auth';
import { requestAsync } from './api';

/** Схема публичных данных пользователя (ответ backend). */
export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.string(),
});

/** Схема ответа `/auth/login`, `/auth/register`, `/auth/refresh`. */
export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  user: AuthUserSchema,
});

/** Ответ с access-токеном и пользователем. */
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/**
 * Вход по email/паролю.
 *
 * Refresh-токен приходит httpOnly-cookie: браузер сохранит её сам, поэтому
 * запрос идёт с `credentials: 'include'`.
 *
 * @param email - email пользователя
 * @param password - пароль
 * @returns access-токен и публичные данные пользователя
 */
export async function loginAsync(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const body = await requestAsync<unknown>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });

  return AuthResponseSchema.parse(body);
}

/**
 * Регистрация с автоматическим входом.
 *
 * @param email - email нового пользователя
 * @param password - пароль (8..72 символа)
 * @returns access-токен и публичные данные пользователя
 */
export async function registerAsync(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const body = await requestAsync<unknown>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    credentials: 'include',
  });

  return AuthResponseSchema.parse(body);
}

/**
 * Обновление access-токена по refresh-cookie (ротация на backend).
 *
 * @returns новый access-токен и пользователь
 */
export async function refreshAsync(): Promise<AuthResponse> {
  const body = await requestAsync<unknown>('/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });

  return AuthResponseSchema.parse(body);
}

/**
 * Выход: backend отзывает refresh-токен и очищает cookie.
 *
 * @returns промис без значения
 */
export async function logoutAsync(): Promise<void> {
  await requestAsync<unknown>('/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });
}

/**
 * Текущий пользователь по access-токену.
 *
 * @param accessToken - действующий access-токен
 * @returns публичные данные пользователя
 */
export async function meAsync(accessToken: string): Promise<AuthUser> {
  const body = await requestAsync<unknown>('/auth/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return AuthUserSchema.parse(body);
}
