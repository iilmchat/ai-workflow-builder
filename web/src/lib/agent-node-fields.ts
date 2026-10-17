import {
  AGENT_MAX_ITERATIONS_LIMIT,
  AGENT_MAX_TOOLS,
  AGENT_MIN_ITERATIONS,
  AGENT_MIN_TOOLS,
  AGENT_TOOLS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  DEFAULT_AGENT_TOOLS,
  type AgentToolName,
} from '@/types/graph';

/**
 * Валидаторы полей agent-узла (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Вынесены из компонента в `lib` по тому же принципу, что
 * `vector-memory-node-fields` (R7.4a) и `http-node-fields` (R6.5.2): их
 * проверяют юнит-тесты, а компонент остаётся тонким. Мусор из jsonb не должен
 * попадать в `data` графа, а невалидное число — в `maxIterations`: backend
 * тогда возьмёт дефолт своей Zod-схемы.
 */

/** Верхняя граница `maxTokensPerStep` (совпадает с backend-схемой). */
export const MAX_TOKENS_PER_STEP_LIMIT = 8192;

/**
 * Проверяет, что значение — имя известного инструмента.
 *
 * @param value - значение из jsonb (`unknown`)
 * @returns `true`, если это имя из {@link AGENT_TOOLS}
 */
export function isAgentToolName(value: unknown): value is AgentToolName {
  return (
    typeof value === 'string' &&
    (AGENT_TOOLS as readonly string[]).includes(value)
  );
}

/**
 * Приводит `data.tools` к валидному набору инструментов.
 *
 * Неизвестные имена отбрасываются, дубли схлопываются, число ограничивается
 * {@link AGENT_MAX_TOOLS}. Пустой результат заменяется
 * {@link DEFAULT_AGENT_TOOLS}: backend требует минимум один инструмент, иначе
 * Run упадёт валидацией, а узел выглядел бы «настроенным».
 *
 * @param value - значение из `data.tools`
 * @returns непустой массив известных инструментов
 */
export function validateAgentTools(value: unknown): AgentToolName[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_AGENT_TOOLS];
  }

  const tools: AgentToolName[] = [];

  for (const item of value) {
    if (isAgentToolName(item) && !tools.includes(item)) {
      tools.push(item);
    }

    if (tools.length === AGENT_MAX_TOOLS) {
      break;
    }
  }

  return tools.length >= AGENT_MIN_TOOLS ? tools : [...DEFAULT_AGENT_TOOLS];
}

/**
 * Переключает инструмент в наборе (чекбокс узла).
 *
 * Последний инструмент снять нельзя: агент без инструментов не проходит
 * валидацию backend, и Run падал бы на каждом сохранении.
 *
 * @param current - текущий набор (может быть мусором из jsonb)
 * @param name - инструмент, который переключают
 * @returns новый набор; при попытке снять последний — копия прежнего
 */
export function toggleAgentTool(
  current: readonly AgentToolName[],
  name: AgentToolName,
): AgentToolName[] {
  const tools = validateAgentTools(current);

  if (!tools.includes(name)) {
    return tools.length >= AGENT_MAX_TOOLS ? tools : [...tools, name];
  }

  if (tools.length <= AGENT_MIN_TOOLS) {
    return tools;
  }

  return tools.filter((tool) => tool !== name);
}

/**
 * Проверяет `maxIterations` узла.
 *
 * Допустимо целое {@link AGENT_MIN_ITERATIONS}…{@link AGENT_MAX_ITERATIONS_LIMIT};
 * всё остальное — `undefined` (backend возьмёт
 * {@link DEFAULT_AGENT_MAX_ITERATIONS}).
 *
 * @param value - значение из `data.maxIterations`
 * @returns целое в диапазоне либо `undefined`
 */
export function validateMaxIterations(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }

  return value >= AGENT_MIN_ITERATIONS && value <= AGENT_MAX_ITERATIONS_LIMIT
    ? value
    : undefined;
}

/**
 * Проверяет `maxTokensPerStep` узла (поле без UI, переносится Load/Save).
 *
 * @param value - значение из `data.maxTokensPerStep`
 * @returns целое 1…{@link MAX_TOKENS_PER_STEP_LIMIT} либо `undefined`
 */
export function validateMaxTokensPerStep(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }

  return value >= 1 && value <= MAX_TOKENS_PER_STEP_LIMIT ? value : undefined;
}

/**
 * Разбирает значение `<input type="number">` узла.
 *
 * @param raw - строка из поля (пустая — «не задано»)
 * @returns число для валидатора либо `undefined`
 */
export function parseAgentNumberInput(raw: string): number | undefined {
  if (raw.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : undefined;
}
