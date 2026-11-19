/**
 * Приводит неизвестное значение к тексту для логов и колонок `error`.
 *
 * Единственная реализация (KI-028): раньше одинаковые функции дублировались
 * в сервисах запусков и движке. Стек ошибки намеренно не логируется —
 * пользовательские промпты и данные провайдеров не должны попадать в БД
 * (RULES 5.9).
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
