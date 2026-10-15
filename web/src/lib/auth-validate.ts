/** Максимальная длина пароля (совпадает с backend: `max(72)`). */
const PASSWORD_MAX_LENGTH = 72;
/** Минимальная длина пароля (совпадает с backend: `min(8)`). */
const PASSWORD_MIN_LENGTH = 8;

/**
 * Простая проверка email на клиенте.
 *
 * Нужна только для мгновенной подсказки в форме: настоящая валидация —
 * на backend (Zod). Специально не повторяет RFC: `a@b.c` проходит, строка
 * без `@`/домена — нет.
 *
 * @param value - введённый email
 * @returns `true`, если значение похоже на email
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Проверка длины пароля.
 *
 * @param value - введённый пароль
 * @returns `true`, если длина в допустимых границах (8..72)
 */
export function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

/** Минимальная длина пароля — для подсказки в UI. */
export const PASSWORD_MIN = PASSWORD_MIN_LENGTH;
/** Максимальная длина пароля — для атрибута `maxLength`. */
export const PASSWORD_MAX = PASSWORD_MAX_LENGTH;
