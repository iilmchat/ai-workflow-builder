import { describe, expect, it, vi } from 'vitest';
import type { AgentRunResult } from '../agent/agent.types.js';
import type { NodeDto } from './dto/index.js';
import {
  NodeDataValidationException,
  executeAgentNodeAsync,
  type AgentRunner,
} from './node-executors.js';

/**
 * Собирает узел графа типа `agent`.
 *
 * @param data - данные узла (`Record<string, unknown>` — как из jsonb)
 * @returns узел в форме `NodeDto`
 */
function agentNode(data: Record<string, unknown>): NodeDto {
  return { id: 'agent-1', type: 'agent', data };
}

/** Валидные данные агента (как их пишет UI). */
const VALID_DATA: Record<string, unknown> = {
  kind: 'agent',
  model: 'claude-test',
  tools: ['http_request'],
  maxIterations: 3,
};

/**
 * Исполнитель узла `agent` (R7.4b): валидация `data` и раскладка результата.
 *
 * Цикл агента здесь не исполняется — `AgentRunner` замокан; тест проверяет
 * контракт между движком и сервисом: какие данные уходят, что попадает в
 * `outputs` и что шаги возвращаются отдельным полем для `node_runs.logs`.
 */
describe('executeAgentNodeAsync (R7.4b)', () => {
  it('делегирует цикл и отдаёт `{ result, steps }`', async () => {
    const result: AgentRunResult = {
      answer: 'готовый ответ',
      steps: [
        {
          kind: 'llm',
          prompt: 'prompt',
          usage: { inputTokens: 1, outputTokens: 2, model: 'claude-test' },
        },
        { kind: 'final', answer: 'готовый ответ' },
      ],
      iterations: 1,
      usage: { inputTokens: 1, outputTokens: 2 },
      // KI-407/KI-433: плоские метрики для `node_runs`; с v0.10.2 движок
      // получает их отдельным полем `usage` и записывает в колонки.
      tokensIn: 1,
      tokensOut: 2,
      costUsd: null,
    };
    const runAgentAsync = vi.fn(() => Promise.resolve(result));
    const runner: AgentRunner = { runAgentAsync };

    const execution = await executeAgentNodeAsync(
      agentNode(VALID_DATA),
      { prompt: 'вопрос' },
      'run-1',
      runner,
    );

    expect(runAgentAsync).toHaveBeenCalledWith(
      {
        kind: 'agent',
        model: 'claude-test',
        tools: ['http_request'],
        maxIterations: 3,
      },
      { prompt: 'вопрос' },
      'run-1',
      // nodeId передаётся: сервис использует его в логах и контексте tools.
      'agent-1',
    );
    expect(execution.outputs).toEqual({
      result: 'готовый ответ',
      steps: result.steps,
    });
    // Шаги продублированы отдельным полем: движок пишет их в node_runs.logs.
    expect(execution.steps).toBe(result.steps);
    // KI-433: суммарные метрики цикла доходят до движка для `node_runs`.
    expect(execution.usage).toEqual({
      tokensIn: 1,
      tokensOut: 2,
      costUsd: null,
    });
  });

  it('tools обязателен и непуст: пустой список — ошибка валидации', async () => {
    const runner: AgentRunner = {
      runAgentAsync: vi.fn(() => Promise.reject(new Error('не должен вызваться'))),
    };

    await expect(
      executeAgentNodeAsync(
        agentNode({ ...VALID_DATA, tools: [] }),
        {},
        'run-1',
        runner,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });

  it('неизвестный инструмент и maxIterations вне 1–10 отвергаются схемой', async () => {
    const runner: AgentRunner = {
      runAgentAsync: vi.fn(() => Promise.reject(new Error('не должен вызваться'))),
    };

    await expect(
      executeAgentNodeAsync(
        agentNode({ ...VALID_DATA, tools: ['drop_database'] }),
        {},
        'run-1',
        runner,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    await expect(
      executeAgentNodeAsync(
        agentNode({ ...VALID_DATA, maxIterations: 11 }),
        {},
        'run-1',
        runner,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });

  it('model обязателен и не может быть пустым', async () => {
    const runner: AgentRunner = {
      runAgentAsync: vi.fn(() => Promise.reject(new Error('не должен вызваться'))),
    };

    await expect(
      executeAgentNodeAsync(
        agentNode({ ...VALID_DATA, model: '   ' }),
        {},
        'run-1',
        runner,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });
});
