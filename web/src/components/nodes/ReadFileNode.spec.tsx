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
import type { ReadFileFlowNode, ReadFileNodeData } from '@/types/graph';
import { ReadFileNode } from './ReadFileNode';

/** id узла в тестовом графе. */
const NODE_ID = 'read-file-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * @param data - данные узла
 * @returns пропсы `ReadFileNode`
 */
function nodePropsOf(data: ReadFileNodeData): NodeProps<ReadFileFlowNode> {
  return {
    id: NODE_ID,
    type: 'read_file',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<ReadFileFlowNode>;
}

/**
 * Собирает данные узла с валидными значениями по умолчанию.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `read_file`
 */
function readFileData(overrides: Partial<ReadFileNodeData> = {}): ReadFileNodeData {
  return {
    kind: 'read_file',
    path: '',
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
 * Рендерит `ReadFileNode` внутри провайдера с тем же узлом в store.
 *
 * @param data - данные узла
 */
function renderNode(data: ReadFileNodeData): void {
  flow = null;

  render(
    <ReactFlowProvider
      defaultNodes={[
        {
          id: NODE_ID,
          type: 'read_file',
          position: { x: 0, y: 0 },
          data,
        },
      ]}
    >
      <FlowProbe />
      <ReadFileNode {...nodePropsOf(data)} />
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

describe('ReadFileNode — поля и результат (v0.10 S8)', () => {
  it('рендерит путь и формат auto по умолчанию', () => {
    renderNode(readFileData({ path: 'input.csv' }));

    expect(screen.getByLabelText(ru['node.read_file.path'])).toHaveValue(
      'input.csv',
    );
    expect(screen.getByLabelText(ru['node.read_file.format'])).toHaveValue(
      'auto',
    );
  });

  it('fireEvent.change в path обновляет data.path', async () => {
    renderNode(readFileData());

    fireEvent.change(screen.getByLabelText(ru['node.read_file.path']), {
      target: { value: 'notes/2026-10-18.txt' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.path).toBe('notes/2026-10-18.txt');
    });
  });

  it('переключение формата обновляет data.format', async () => {
    renderNode(readFileData());

    fireEvent.change(screen.getByLabelText(ru['node.read_file.format']), {
      target: { value: 'json' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.format).toBe('json');
    });
  });

  it('показывает содержимое файла из nodeOutputs.text', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: { text: '{"ok":true}' },
      },
    });

    renderNode(readFileData({ path: 'report.json' }));

    expect(screen.getByText(ru['node.read_file.result'])).toBeInTheDocument();
    expect(screen.getByText('{"ok":true}')).toBeInTheDocument();
  });

  it('без результата показывает пустое состояние', () => {
    renderNode(readFileData());

    expect(screen.getByText(ru['node.read_file.empty'])).toBeInTheDocument();
  });

  it('source-only: target-хендл не рендерится (KI-456)', () => {
    const { container } = render(
      <ReactFlowProvider
        defaultNodes={[
          {
            id: NODE_ID,
            type: 'read_file',
            position: { x: 0, y: 0 },
            data: readFileData(),
          },
        ]}
      >
        <ReadFileNode {...nodePropsOf(readFileData())} />
      </ReactFlowProvider>,
    );

    expect(container.querySelector('.react-flow__handle-left')).toBeNull();
    expect(container.querySelector('.react-flow__handle-right')).not.toBeNull();
  });
});
