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
import type { DocumentGenFlowNode, DocumentGenNodeData } from '@/types/graph';
import { DocumentGenNode } from './DocumentGenNode';

/** id узла в тестовом графе. */
const NODE_ID = 'document-gen-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * @param data - данные узла
 * @returns пропсы `DocumentGenNode`
 */
function nodePropsOf(data: DocumentGenNodeData): NodeProps<DocumentGenFlowNode> {
  return {
    id: NODE_ID,
    type: 'document_gen',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<DocumentGenFlowNode>;
}

/**
 * Собирает данные узла с валидными значениями по умолчанию.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `document_gen`
 */
function documentData(
  overrides: Partial<DocumentGenNodeData> = {},
): DocumentGenNodeData {
  return {
    kind: 'document_gen',
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
 * Рендерит `DocumentGenNode` внутри провайдера с тем же узлом в store.
 *
 * @param data - данные узла
 */
function renderNode(data: DocumentGenNodeData): void {
  flow = null;

  render(
    <ReactFlowProvider
      defaultNodes={[
        {
          id: NODE_ID,
          type: 'document_gen',
          position: { x: 0, y: 0 },
          data,
        },
      ]}
    >
      <FlowProbe />
      <DocumentGenNode {...nodePropsOf(data)} />
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

describe('DocumentGenNode — поля и результат (v0.10 S6)', () => {
  it('по умолчанию показывает Markdown и textarea контента', () => {
    renderNode(documentData());

    expect(
      screen.getByLabelText(ru['node.document_gen.source']),
    ).toHaveValue('markdown');
    expect(
      screen.getByLabelText(ru['node.document_gen.content']),
    ).toHaveValue('');
    expect(
      screen.getByPlaceholderText(
        ru['node.document_gen.content.placeholder'],
      ),
    ).toBeInTheDocument();
  });

  it('переключение формата на JSON обновляет data.source', async () => {
    renderNode(documentData());

    fireEvent.change(screen.getByLabelText(ru['node.document_gen.source']), {
      target: { value: 'json' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.source).toBe('json');
    });
  });

  it('при source=json подсказывает JSON-формат', () => {
    renderNode(documentData({ source: 'json' }));

    expect(
      screen.getByPlaceholderText(
        ru['node.document_gen.content.placeholderJson'],
      ),
    ).toBeInTheDocument();
  });

  it('fireEvent.change в textarea обновляет data.content', async () => {
    renderNode(documentData());

    fireEvent.change(screen.getByLabelText(ru['node.document_gen.content']), {
      target: { value: '# Новый документ' },
    });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.content).toBe('# Новый документ');
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

    renderNode(documentData());

    expect(
      screen.queryByLabelText(ru['node.document_gen.content']),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(ru['node.document_gen.connected']),
    ).toBeInTheDocument();
  });

  it('показывает кнопку скачивания по storedUrl и fileName', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: {
          storedUrl: '/media/file/run-1/generated-document-gen-1.docx',
          fileName: 'generated-document-gen-1.docx',
        },
      },
    });

    renderNode(documentData());

    const link = screen.getByRole('link', {
      name: ru['node.document_gen.download'],
    });

    expect(link).toHaveAttribute(
      'href',
      '/media/file/run-1/generated-document-gen-1.docx',
    );
    expect(link).toHaveAttribute('download', 'generated-document-gen-1.docx');
  });

  it('принимает fallback-ключ url из outputs', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: {
          url: 'https://cdn.example.com/document.docx',
        },
      },
    });

    renderNode(documentData());

    expect(
      screen.getByRole('link', { name: ru['node.document_gen.download'] }),
    ).toHaveAttribute('href', 'https://cdn.example.com/document.docx');
  });

  it('не делает ссылкой небезопасный URL', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: {
          storedUrl: 'javascript:alert(1)',
          url: 'data:text/html,<script>alert(1)</script>',
        },
      },
    });

    renderNode(documentData());

    expect(
      screen.queryByRole('link', { name: ru['node.document_gen.download'] }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(ru['node.document_gen.hint']),
    ).toBeInTheDocument();
  });
});
