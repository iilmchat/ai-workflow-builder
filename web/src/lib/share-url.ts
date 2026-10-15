/**
 * Собирает абсолютный URL share-ссылки.
 *
 * Backend отдаёт относительный путь (`/workflow/share/<token>`), потому что не
 * знает публичный домен; origin известен клиенту.
 *
 * @param origin - origin приложения (например, `https://app.example`)
 * @param shareUrl - относительный или абсолютный путь share-ссылки
 * @returns абсолютный URL
 */
export function buildAbsoluteShareUrl(origin: string, shareUrl: string): string {
  return new URL(shareUrl, origin).toString();
}

/**
 * Простая проверка формы share-токена (uuid).
 *
 * Нужна только чтобы не ходить на backend с заведомо неверным значением
 * (например, `undefined` из URL); настоящая валидация — на сервере.
 * Работает как type guard: после проверки `token` сужается до `string`.
 *
 * @param value - значение из URL
 * @returns `true`, если похоже на uuid
 */
export function isValidShareToken(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
