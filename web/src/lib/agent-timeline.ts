/**
 * Разбор шагов агента для timeline в панели результата (R7.4b).
 *
 * `node_runs.outputs` приходит из jsonb как `unknown`: backend пишет туда
 * `{ result, steps }`, но полагаться на форму нельзя (RULES 1.17). Модуль
 * нормализует шаги в плоское представление, удобное для рендера, и
 * отбрасывает всё, что не похоже на шаг. Вынесен из компонента, потому что
 * тесты фронтенда идут без DOM (KI-155/KI-405) и проверяют именно парсер.
 */

/** Максимум символов деталей одного шага в панели (защита от мегабайт JSON). */
export const AGENT_STEP_DETAIL_MAX_CHARS = 2_000;

/** Шаг timeline: LLM-вызов. */
export interface AgentLlmTimelineStep {
  /** Дискриминатор для рендера. */
  kind: 'llm';
  /** Входные токены шага либо `null`, если провайдер их не отдал. */
  tokensIn: number | null;
  /** Выходные токены шага либо `null`. */
  tokensOut: number | null;
  /** Транскрипт, отправленный модели (обрезанный для панели). */
  detail: string;
}

/** Шаг timeline: вызов инструмента. */
export interface AgentToolTimelineStep {
  /** Дискриминатор для рендера. */
  kind: 'tool';
  /** Имя инструмента. */
  name: string;
  /** Вход и выход инструмента (обрезанные для панели). */
  detail: string;
  /** Текст ошибки инструмента либо `null`. */
  error: string | null;
}

/** Шаг timeline: финальный ответ. */
export interface AgentFinalTimelineStep {
  /** Дискриминатор для рендера. */
  kind: 'final';
  /** Текст ответа. */
  detail: string;
}

/** Шаг timeline агента. */
export type AgentTimelineStep =
  | AgentLlmTimelineStep
  | AgentToolTimelineStep
  | AgentFinalTimelineStep;

/**
 * Проверяет, что значение — обычный объект (не массив/`null`).
 *
 * @param value - значение типа `unknown`
 * @returns `true`, если значение читается как `Record<string, unknown>`
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Приводит значение к строке для показа в панели.
 *
 * Строки показываются как есть (без лишних кавычек), объекты — компактным
 * JSON, `undefined`/`null` — пустой строкой.
 *
 * @param value - значение шага
 * @returns текст для `<pre>` (не длиннее {@link AGENT_STEP_DETAIL_MAX_CHARS})
 */
function toDetail(value: unknown): string {
  let text: string;

  if (typeof value === 'string') {
    text = value;
  } else if (value === undefined || value === null) {
    text = '';
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? '';
    } catch {
      text = String(value);
    }
  }

  return text.length <= AGENT_STEP_DETAIL_MAX_CHARS
    ? text
    : `${text.slice(0, AGENT_STEP_DETAIL_MAX_CHARS)}… (truncated)`;
}

/**
 * Достаёт токены из `usage` шага.
 *
 * @param value - `usage` из шага (`unknown` — пришёл из jsonb)
 * @returns пара `{ tokensIn, tokensOut }` (поля `null`, если их нет)
 */
function readTokens(value: unknown): {
  tokensIn: number | null;
  tokensOut: number | null;
} {
  if (!isRecord(value)) {
    return { tokensIn: null, tokensOut: null };
  }

  return {
    tokensIn: typeof value.inputTokens === 'number' ? value.inputTokens : null,
    tokensOut: typeof value.outputTokens === 'number' ? value.outputTokens : null,
  };
}

/**
 * Нормализует шаги агента из `outputs.steps`.
 *
 * @param value - значение `outputs.steps` (`unknown` по контракту snapshot'а)
 * @returns шаги timeline; пустой массив, если данных нет или форма не та
 */
export function parseAgentSteps(value: unknown): AgentTimelineStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: AgentTimelineStep[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (item.kind === 'llm') {
      const tokens = readTokens(item.usage);

      steps.push({
        kind: 'llm',
        tokensIn: tokens.tokensIn,
        tokensOut: tokens.tokensOut,
        detail: toDetail(item.prompt),
      });

      continue;
    }

    if (item.kind === 'tool') {
      const name = typeof item.name === 'string' ? item.name : 'tool';
      const input = toDetail(item.input);
      const output = toDetail(item.output);

      steps.push({
        kind: 'tool',
        name,
        // Вход и выход разделены подписью: иначе два JSON слиплись бы в один
        // нечитаемый блок.
        detail: [`input: ${input}`, `output: ${output}`].join('\n'),
        error: typeof item.error === 'string' ? item.error : null,
      });

      continue;
    }

    if (item.kind === 'final') {
      steps.push({
        kind: 'final',
        detail: toDetail(item.answer),
      });
    }
  }

  return steps;
}
