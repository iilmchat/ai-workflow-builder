import { z } from 'zod';

/**
 * Zod-схема регистрации.
 *
 * Границы пароля: 8 символов минимум, 72 — потолок bcrypt-совместимых схем;
 * у нас scrypt, но лимит оставлен, чтобы поведение не менялось при смене
 * алгоритма и чтобы тело запроса не было неограниченным.
 */
export const RegisterSchema = z.object({
  email: z.email('Некорректный email'),
  password: z
    .string()
    .min(8, 'Пароль короче 8 символов')
    .max(72, 'Пароль длиннее 72 символов'),
});

/** Валидированное тело запроса регистрации. */
export type RegisterDto = z.infer<typeof RegisterSchema>;
