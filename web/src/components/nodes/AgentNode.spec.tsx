import {
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import {
  AGENT_TOOLS,
  DEFAULT_AGENT_TOOLS,
  type AgentFlowNode,
  type AgentNodeData,
} from '@/types/graph';
import { AgentNode } from './AgentNode';

/** id узла в тестовом графе. */
const NODE_ID = 'agent-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * Компонент читает только `id` и `data`; остальные обязательные поля
 * `NodeProps` нужны React Flow и в тесте не используются. Каст через
 * `unknown` — единственный способ не собирать служебный объект React Flow
 * целиком (RULES 1.16: `any` не используется).
 *
 * @param data - данные узла
 * @returns пропсы `AgentNode`
 */
function nodePropsOf(data: AgentNodeData): NodeProps<AgentFlowNode> {
  return {
    id: NODE_ID,
    type: 'agent',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<AgentFlowNode>;
}

/**
 * Собирает данные агента с валидным набором инструментов.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `agent`
 */
function agentData(overrides: Partial<AgentNodeData> = {}): AgentNodeData {
  return {
    kind: 'agent',
    model: '',
    tools: [...DEFAULT_AGENT_TOOLS],
    ...overrides,
  };
}

/**
 * Доступ к инстансу React Flow из теста.
 *
 * Правки полей идут через `useReactFlow().updateNodeData`, а не через
 * zustand-стор: проверяем именно то хранилище, куда пишет компонент.
 */
let flow: ReactFlowInstance | null = null;

/** Запоминает инстанс React Flow, смонтированный провайдером. */
function FlowProbe() {
  flow = useReactFlow();

  return null;
}

/**
 * Рендерит `AgentNode` внутри провайдера с тем же узлом в store.
 *
 * `defaultNodes` (не `initialNodes`) важен: только в uncontrolled-режиме
 * `updateNodeData` пишет прямо в store, а не отдаёт изменение в
 * `onNodesChange`, которого в изолированном тесте нет.
 *
 * @param data - данные узла
 */
function renderNode(data: AgentNodeData): void {
  flow = null;

  render(
    <ReactFlowProvider
      defaultNodes={[
        { id: NODE_ID, type: 'agent', position: { x: 0, y: 0 }, data },
      ]}
    >
      <FlowProbe />
      <AgentNode {...nodePropsOf(data)} />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  // Стор — модульный синглтон: сбрасываем запуск, каталог моделей и историю.
  // `loadLlmModelsAsync` не должен ходить в сеть из `useEffect` узла.
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    nodeStatuses: {},
    nodeOutputs: {},
    nodeMetrics: {},
    llmModels: [],
    llmModelsLoaded: true,
    loadLlmModelsAsync: async () => undefined,
    pushHistoryCoalesced: () => undefined,
  });
});

describe('AgentNode — рендер и правки полей (KI-405)', () => {
  it('рендерит модель, системную инструкцию и инструменты', () => {
    renderNode(agentData({ systemPrompt: 'Ты — аналитик' }));

    const systemPrompt = screen.getByLabelText(ru['node.agent.systemPrompt']);

    expect(systemPrompt).toHaveValue('Ты — аналитик');
    expect(screen.getByLabelText(ru['node.agent.model'])).toBeInTheDocument();
    expect(
      screen.getByLabelText(ru['node.agent.maxIterations']),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: ru['node.agent.tools'] }),
    ).toBeInTheDocument();
    // Узел показывает все инструменты, включён только дефолтный набор.
    expect(screen.getAllByRole('checkbox')).toHaveLength(AGENT_TOOLS.length);
    expect(
      screen.getByRole('checkbox', { name: ru['tools.http_request'] }),
    ).toBeChecked();
  });

  it('fireEvent.change в systemPrompt обновляет data узла в React Flow store', async () => {
    renderNode(agentData());

    fireEvent.change(screen.getByLabelText(ru['node.agent.systemPrompt']), {
      target: { value: 'Сначала проверь факты' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.systemPrompt).toBe(
        'Сначала проверь факты',
      );
    });
  });
});
