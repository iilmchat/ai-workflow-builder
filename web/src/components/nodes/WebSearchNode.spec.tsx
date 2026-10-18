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
import type { WebSearchFlowNode, WebSearchNodeData } from '@/types/graph';
import { WebSearchNode } from './WebSearchNode';

/** id узла в тестовом графе. */
const NODE_ID = 'web-search-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * @param data - данные узла
 * @returns пропсы `WebSearchNode`
 */
function nodePropsOf(data: WebSearchNodeData): NodeProps<WebSearchFlowNode> {
  return {
    id: NODE_ID,
    type: 'web_search',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<WebSearchFlowNode>;
}

/**
 * Собирает данные узла с валидными значениями по умолчанию.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `web_search`
 */
function searchData(overrides: Partial<WebSearchNodeData> = {}): WebSearchNodeData {
  return {
    kind: 'web_search',
    ...overrides,
  };
}

/** Доступ к инстансу React Flow из теста. */
let flow: ReactFlowInstance | null = null;

/** Запоминает инстанс React Flow, смонтированный провайдером. */
function FlowProbe() {
  flow = useReactFlow();

  return null;
}

/**
 * Рендерит `WebSearchNode` внутри провайдера с тем же узлом в store.
 *
 * @param data - данные узла
 */
function renderNode(data: WebSearchNodeData): void {
  flow = null;

  render(
    <ReactFlowProvider
      defaultNodes={[
        {
          id: NODE_ID,
          type: 'web_search',
          position: { x: 0, y: 0 },
          data,
        },
      ]}
    >
      <FlowProbe />
      <WebSearchNode {...nodePropsOf(data)} />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    nodeStatuses: {},
    nodeOutputs: {},
    nodeMetrics: {},
    llmModels: [],
    llmModelsLoaded: true,
    pushHistoryCoalesced: () => undefined,
  });
});

describe('WebSearchNode — поля и результаты (v0.10 S2)', () => {
  it('рендерит запрос и maxResults', () => {
    renderNode(searchData({ query: 'typescript 5.9', maxResults: 7 }));

    expect(screen.getByLabelText(ru['node.web_search.query'])).toHaveValue(
      'typescript 5.9',
    );
    expect(
      screen.getByLabelText(ru['node.web_search.maxResults']),
    ).toHaveValue(7);
  });

  it('fireEvent.change в query обновляет data узла', async () => {
    renderNode(searchData());

    fireEvent.change(screen.getByLabelText(ru['node.web_search.query']), {
      target: { value: 'новый запрос' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.query).toBe('новый запрос');
    });
  });

  it('fireEvent.change в maxResults обновляет data узла', async () => {
    renderNode(searchData());

    fireEvent.change(screen.getByLabelText(ru['node.web_search.maxResults']), {
      target: { value: '3' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.maxResults).toBe(3);
    });
  });

  it('невалидный maxResults не попадает в data (сбрасывается в undefined)', async () => {
    renderNode(searchData());

    fireEvent.change(screen.getByLabelText(ru['node.web_search.maxResults']), {
      target: { value: '11' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.maxResults).toBeUndefined();
    });
  });

  it('показывает результаты из nodeOutputs: иконку, заголовок и сниппет', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: {
          results: [
            {
              title: 'TypeScript 5.9',
              url: 'https://example.com/ts',
              snippet: 'Новая версия компилятора.',
            },
          ],
        },
      },
    });

    renderNode(searchData());

    expect(
      screen.getByText(ru['node.web_search.results'].replace('{{count}}', '1')),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'TypeScript 5.9' }),
    ).toHaveAttribute('href', 'https://example.com/ts');
    expect(screen.getByText('Новая версия компилятора.')).toBeInTheDocument();
  });

  it('завершённый узел без результатов показывает пустое состояние', () => {
    useWorkflowStore.setState({
      nodeStatuses: { [NODE_ID]: 'completed' },
      nodeOutputs: { [NODE_ID]: { results: [] } },
    });

    renderNode(searchData());

    expect(screen.getByText(ru['node.web_search.empty'])).toBeInTheDocument();
  });
});
