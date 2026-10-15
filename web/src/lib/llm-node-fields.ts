/**
 * Режимы reasoning, которые понимает backend (R6.3.1, KI-193).
 *
 * Список — единственный источник и для типа, и для рантайм-валидации данных,
 * пришедших из БД (`data.reasoningEffort` не типизирован).
 */
export const REASONING_EFFORTS = ['off', 'medium', 'high'] as const;

/** Режим reasoning LLM-узла. */
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Верхняя граница override лимита токенов в UI (R6.3.2, KI-183).
 *
 * Совпадает с `max` у поля ввода: значения выше отсекает браузер, а backend
 * получил бы заведомо непригодный лимит.
 */
export const MAX_TOKENS_LIMIT = 32768;

/**
 * Проверяет режим reasoning из недоверенного источника.
 *
 * @param value - значение из `data` (тип не гарантирован)
 * @returns валидный режим либо `undefined` — «поле не задано»
 */
export function validateReasoningEffort(
  value: unknown,
): ReasoningEffort | undefined {
  return REASONING_EFFORTS.find((effort) => effort === value);
}

/**
 * Проверяет override лимита токенов из недоверенного источника.
 *
 * Допустимо только положительное целое: так значение не потеряется при
 * Load/Save, а мусор (`0`, `-1`, `1.5`, строка) будет отброшен.
 *
 * @param value - значение из поля ввода или из БД
 * @returns положительное целое либо `undefined`
 */
export function validateMaxTokensOverride(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
