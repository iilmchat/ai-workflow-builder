import {
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import type { WriteFileFlowNode, WriteFileNodeData } from '@/types/graph';
import { WriteFileNode } from './WriteFileNode';

/** id узла в тестовом графе. */
const NODE_ID = 'write-file-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * @param data - данные узла
 * @returns пропсы `WriteFileNode`
 */
function nodePropsOf(data: WriteFileNodeData): NodeProps<WriteFileFlowNode> {
  return {
    id: NODE_ID,
    type: 'write_file',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<WriteFileFlowNode>;
}

/**
 * Собирает данные узла с валидными значениями по умолчанию.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `write_file`
 */
function writeFileData(
  overrides: Partial<WriteFileNodeData> = {},
): WriteFileNodeData {
  return {
    kind: 'write_file',
    path: '',
    format: 'txt',
    overwrite: false,
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
 * Рендерит `WriteFileNode` внутри провайдера с тем же узлом в store.
 *
 * @param data - данные узла
 */
function renderNode(data: WriteFileNodeData): void {
  flow = null;

  render(
    <ReactFlowProvider
      defaultNodes={[
        {
          id: NODE_ID,
          type: 'write_file',
          position: { x: 0, y: 0 },
          data,
        },
      ]}
    >
      <FlowProbe />
      <WriteFileNode {...nodePropsOf(data)} />
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

describe('WriteFileNode — поля и статус записи (v0.10 S8)', () => {
  it('рендерит путь, формат и textarea контента', () => {
    renderNode(writeFileData({ path: 'report.json', content: '{"ok":true}' }));

    expect(screen.getByLabelText(ru['node.write_file.path'])).toHaveValue(
      'report.json',
    );
    expect(screen.getByLabelText(ru['node.write_file.format'])).toHaveValue(
      'txt',
    );
    expect(screen.getByLabelText(ru['node.write_file.content'])).toHaveValue(
      '{"ok":true}',
    );
  });

  it('fireEvent.change в path обновляет data.path', async () => {
    renderNode(writeFileData());

    fireEvent.change(screen.getByLabelText(ru['node.write_file.path']), {
      target: { value: 'result.json' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.path).toBe('result.json');
    });
  });

  it('fireEvent.change в textarea обновляет data.content', async () => {
    renderNode(writeFileData());

    fireEvent.change(screen.getByLabelText(ru['node.write_file.content']), {
      target: { value: 'новый текст' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.content).toBe('новый текст');
    });
  });

  it('при входящей связи textarea скрыта и показана подсказка', () => {
    useWorkflowStore.setState({
      edges: [
        {
          id: 'edge-1',
          source: 'text-1',
          target: NODE_ID,
        } as Edge,
      ],
    });

    renderNode(writeFileData());

    expect(
      screen.queryByLabelText(ru['node.write_file.content']),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(ru['node.write_file.connected']),
    ).toBeInTheDocument();
  });

  it('показывает статус сохранения по outputs.success/path', () => {
    useWorkflowStore.setState({
      nodeStatuses: { [NODE_ID]: 'completed' },
      nodeOutputs: {
        [NODE_ID]: { success: true, path: 'reports/result.json' },
      },
    });

    renderNode(writeFileData({ path: 'result.json' }));

    expect(
      screen.getByText(
        ru['node.write_file.saved'].replace(
          '{{path}}',
          'reports/result.json',
        ),
      ),
    ).toBeInTheDocument();
  });

  it('во время выполнения показывает «Сохранение…»', () => {
    useWorkflowStore.setState({
      nodeStatuses: { [NODE_ID]: 'running' },
    });

    renderNode(writeFileData());

    expect(
      screen.getByText(ru['node.write_file.saving']),
    ).toBeInTheDocument();
  });

  it('при ошибке показывает «Не удалось сохранить»', () => {
    useWorkflowStore.setState({
      nodeStatuses: { [NODE_ID]: 'failed' },
    });

    renderNode(writeFileData());

    expect(
      screen.getByText(ru['node.write_file.failed']),
    ).toBeInTheDocument();
  });
});
