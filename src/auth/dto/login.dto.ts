import { z } from 'zod';

/**
 * Zod-схема входа.
 *
 * Пароль не проверяется на длину: цель — не подсказывать требования к
 * существующему паролю (RULES 5.3 про утечки через сообщения).
 */
export const LoginSchema = z.object({
  email: z.email('Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен'),
});

/** Валидированное тело запроса входа. */
export type LoginDto = z.infer<typeof LoginSchema>;
