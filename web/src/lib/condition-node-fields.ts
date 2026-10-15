import {
  DEFAULT_CONDITION_OPERATOR,
  type ConditionOperator,
} from '@/types/graph';

/**
 * Операции условия в порядке показа в селекте (DESIGN v0.8 § 8.2, MVP-DSL).
 *
 * Список — единственный источник и для `<select>`, и для рантайм-валидации
 * `data.operator` (значение из БД не типизировано). Совпадает с
 * `ConditionNodeDataSchema` backend'а (`src/engine/node-executors.ts`, R6.5.1).
 */
export const CONDITION_OPERATORS = [
  '>',
  '<',
  '>=',
  '<=',
  '===',
  'includes',
] as const satisfies readonly ConditionOperator[];

/**
 * Проверяет операцию условия из недоверенного источника.
 *
 * Неизвестная операция заменяется на {@link DEFAULT_CONDITION_OPERATOR}: её
 * всё равно нечем показать в `<select>`, а сохранённое значение не могло прийти
 * из валидного Save — Zod-схема backend принимает только операции из
 * {@link CONDITION_OPERATORS}.
 *
 * @param value - значение из `data.operator` (тип не гарантирован)
 * @returns валидная операция либо операция по умолчанию
 */
export function validateConditionOperator(value: unknown): ConditionOperator {
  return (
    CONDITION_OPERATORS.find((operator) => operator === value) ??
    DEFAULT_CONDITION_OPERATOR
  );
}
