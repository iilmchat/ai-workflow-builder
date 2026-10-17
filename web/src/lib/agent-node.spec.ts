import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import {
  parseAgentSteps,
  AGENT_STEP_DETAIL_MAX_CHARS,
} from './agent-timeline';
import {
  MAX_TOKENS_PER_STEP_LIMIT,
  parseAgentNumberInput,
  toggleAgentTool,
  validateAgentTools,
  validateMaxIterations,
  validateMaxTokensPerStep,
} from './agent-node-fields';
import { NODE_REGISTRY } from './node-registry';
import {
  AGENT_MAX_ITERATIONS_LIMIT,
  AGENT_MAX_TOOLS,
  AGENT_MIN_ITERATIONS,
  AGENT_TOOLS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  DEFAULT_AGENT_TOOLS,
} from '@/types/graph';

/**
 * Заглушка i18n: настоящий модуль на импорте пишет `document.documentElement.lang`,
 * а тесты фронтенда идут в `environment: 'node'` (KI-155). Тот же приём, что в
 * `vector-memory-nodes.spec.ts` и `node-registry.spec.ts`.
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return { default: { t, language: 'ru' }, setLanguage: () => undefined };
});

/**
 * Юнит-тесты agent-узла (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Vitest фронтенда идёт без DOM (KI-155, KI-405): «рендер» проверяется как
 * контракт компонента и реестра, состояние инструментов — через чистые
 * валидаторы, timeline — через парсер шагов. Это тот же подход, что у
 * `vector-memory-nodes.spec.ts` (R7.4a).
 */
describe('AgentNode (R7.4b)', () => {
  it('компонент зарегистрирован в категории ai и вставка в связь разрешена', () => {
    const entry = NODE_REGISTRY.agent;

    expect(entry.category).toBe('ai');
    expect(entry.icon).toBe('🧠');
    expect(typeof entry.component).toBe('function');
    // Вход `text-input` есть — узел вставляется в связь (KI-259).
    expect(entry.canBeInsertedOnEdge).toBe(true);
    // Инструменты читают/пишут состояние вне графа (KI-128).
    expect(entry.capabilities).toEqual({
      externalState: true,
      userConfig: true,
    });
  });

  it('список инструментов и лимиты совпадают с backend-схемой', () => {
    expect(AGENT_TOOLS).toEqual([
      'http_request',
      'vector_query',
      'vector_upsert',
      'memory_read',
      'memory_write',
      'code_eval',
      'llm_call',
    ]);
    expect(AGENT_MAX_TOOLS).toBe(7);
    expect(AGENT_MIN_ITERATIONS).toBe(1);
    expect(AGENT_MAX_ITERATIONS_LIMIT).toBe(10);
    expect(DEFAULT_AGENT_MAX_ITERATIONS).toBe(5);
    expect(DEFAULT_AGENT_TOOLS).toEqual(['http_request']);
  });

  it('все подписи узла и инструментов есть в обоих i18n-файлах', () => {
    const keys = [
      NODE_REGISTRY.agent.labelKey,
      'node.agent.model',
      'node.agent.systemPrompt',
      'node.agent.systemPrompt.placeholder',
      'node.agent.tools',
      'node.agent.maxIterations',
      'node.agent.hint',
      'agent.timeline',
      'agent.step.llm',
      'agent.step.tool',
      'agent.step.final',
      'agent.tool.error',
      ...AGENT_TOOLS.map((name) => `tools.${name}`),
    ];

    for (const key of keys) {
      expect(en, `en: ${key}`).toHaveProperty([key]);
      expect(ru, `ru: ${key}`).toHaveProperty([key]);
    }
  });
});

describe('Инструменты agent-узла: состояние чекбоксов (R7.4b)', () => {
  it('validateAgentTools отбрасывает мусор, дубли и пустой список', () => {
    expect(validateAgentTools(['http_request', 'llm_call'])).toEqual([
      'http_request',
      'llm_call',
    ]);
    // Неизвестное имя и дубль не проходят в граф.
    expect(
      validateAgentTools(['http_request', 'drop_database', 'http_request']),
    ).toEqual(['http_request']);
    expect(validateAgentTools([])).toEqual(DEFAULT_AGENT_TOOLS);
    expect(validateAgentTools('http_request')).toEqual(DEFAULT_AGENT_TOOLS);
    expect(validateAgentTools(undefined)).toEqual(DEFAULT_AGENT_TOOLS);
  });

  it('toggleAgentTool включает и выключает, но не даёт снять последний', () => {
    const initial = validateAgentTools(['http_request']);

    expect(toggleAgentTool(initial, 'vector_query')).toEqual([
      'http_request',
      'vector_query',
    ]);
    expect(toggleAgentTool(initial, 'http_request')).toEqual(['http_request']);

    const two = validateAgentTools(['http_request', 'vector_query']);

    expect(toggleAgentTool(two, 'http_request')).toEqual(['vector_query']);
  });

  it('toggleAgentTool не выходит за верхнюю границу в 7 инструментов', () => {
    // Набор из шести: седьмой (последний свободный) добавляется.
    const six = AGENT_TOOLS.slice(0, AGENT_MAX_TOOLS - 1);
    const last = AGENT_TOOLS[AGENT_MAX_TOOLS - 1];

    expect(toggleAgentTool([...six], last)).toHaveLength(AGENT_MAX_TOOLS);

    // Полный набор: снятие разрешено (останется шесть).
    expect(toggleAgentTool([...AGENT_TOOLS], last)).toHaveLength(
      AGENT_MAX_TOOLS - 1,
    );
  });
});

describe('Лимиты agent-узла (R7.4b)', () => {
  it('maxIterations: целое 1…10, остальное — undefined (дефолт backend)', () => {
    expect(validateMaxIterations(1)).toBe(1);
    expect(validateMaxIterations(10)).toBe(10);
    expect(validateMaxIterations(0)).toBeUndefined();
    expect(validateMaxIterations(11)).toBeUndefined();
    expect(validateMaxIterations(2.5)).toBeUndefined();
    expect(validateMaxIterations('3')).toBeUndefined();
  });

  it('maxTokensPerStep и разбор input сохраняют только валидные числа', () => {
    expect(validateMaxTokensPerStep(2048)).toBe(2048);
    expect(validateMaxTokensPerStep(MAX_TOKENS_PER_STEP_LIMIT)).toBe(
      MAX_TOKENS_PER_STEP_LIMIT,
    );
    expect(validateMaxTokensPerStep(0)).toBeUndefined();
    expect(validateMaxTokensPerStep(MAX_TOKENS_PER_STEP_LIMIT + 1)).toBeUndefined();

    expect(parseAgentNumberInput('')).toBeUndefined();
    expect(parseAgentNumberInput('  ')).toBeUndefined();
    expect(parseAgentNumberInput('abc')).toBeUndefined();
    expect(parseAgentNumberInput('7')).toBe(7);
  });
});

describe('Timeline шагов агента (R7.4b)', () => {
  it('разбирает llm → tool → final и сохраняет порядок', () => {
    const steps = parseAgentSteps([
      {
        kind: 'llm',
        prompt: '### USER\nпривет',
        usage: { inputTokens: 12, outputTokens: 4, model: 'm' },
      },
      {
        kind: 'tool',
        name: 'http_request',
        input: { url: 'https://api.test' },
        output: { status: 200 },
      },
      { kind: 'final', answer: 'готово' },
    ]);

    expect(steps.map((step) => step.kind)).toEqual(['llm', 'tool', 'final']);
    expect(steps[0]).toMatchObject({ tokensIn: 12, tokensOut: 4 });
    expect(steps[1]).toMatchObject({
      kind: 'tool',
      name: 'http_request',
      error: null,
    });
    expect(steps[1]?.detail).toContain('https://api.test');
    expect(steps[2]).toMatchObject({ kind: 'final', detail: 'готово' });
  });

  it('показывает ошибку инструмента и не падает на мусоре', () => {
    const steps = parseAgentSteps([
      {
        kind: 'tool',
        name: 'vector_query',
        input: {},
        output: null,
        error: 'connect ECONNREFUSED',
      },
      { kind: 'unknown' },
      'not-an-object',
      null,
    ]);

    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'tool',
      error: 'connect ECONNREFUSED',
    });
    // Нет steps вовсе / не массив — пустая timeline, без исключения.
    expect(parseAgentSteps(undefined)).toEqual([]);
    expect(parseAgentSteps({ steps: [] })).toEqual([]);
  });

  it('обрезает слишком длинные детали шага', () => {
    const steps = parseAgentSteps([
      { kind: 'final', answer: 'x'.repeat(AGENT_STEP_DETAIL_MAX_CHARS + 100) },
    ]);

    expect(steps[0]?.detail.length).toBe(
      AGENT_STEP_DETAIL_MAX_CHARS + '… (truncated)'.length,
    );
    expect(steps[0]?.detail.endsWith('… (truncated)')).toBe(true);
  });
});
