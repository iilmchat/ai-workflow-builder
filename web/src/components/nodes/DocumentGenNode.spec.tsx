import {
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteDocumentTemplateAsync,
  listDocumentTemplatesAsync,
  uploadDocumentTemplateAsync,
  type ApiDocumentTemplate,
} from '@/lib/api';
import ru from '@/i18n/ru.json';
import { useWorkflowStore } from '@/stores/workflow';
import type { DocumentGenFlowNode, DocumentGenNodeData } from '@/types/graph';
import { DocumentGenNode } from './DocumentGenNode';

/**
 * Мок API шаблонов: реальная сеть в jsdom не нужна, а остальные экспорты
 * `@/lib/api` (их тянет стор) остаются настоящими — иначе упал бы импорт стора.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return {
    ...actual,
    listDocumentTemplatesAsync: vi.fn(),
    uploadDocumentTemplateAsync: vi.fn(),
    deleteDocumentTemplateAsync: vi.fn(),
  };
});

/** id узла в тестовом графе. */
const NODE_ID = 'document-gen-1';

/** uuid сохранённого workflow (v0.11 S5: шаблоны привязаны к workflow). */
const WORKFLOW_ID = '77777777-7777-4777-8777-777777777777';

/** uuid шаблона в ответах API. */
const TEMPLATE_ID = '55555555-5555-4555-8555-555555555555';

/** Шаблон из `GET /workflow/:id/document-templates`. */
const TEMPLATE: ApiDocumentTemplate = {
  id: TEMPLATE_ID,
  name: 'Договор поставки',
  bytes: 1011,
  placeholders: ['client', 'amount'],
  createdAt: '2026-10-19T09:36:59.000Z',
};

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

/**
 * Подставляет одну входящую связь в узел: тогда `variables` и контент из полей
 * не нужны — значения приходят из `inputs.prompt`.
 */
function connectIncomingEdge(): void {
  useWorkflowStore.setState({
    edges: [
      {
        id: 'edge-1',
        source: 'text-1',
        target: NODE_ID,
      } as Edge,
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDocumentTemplatesAsync).mockResolvedValue([]);
  vi.mocked(uploadDocumentTemplateAsync).mockRejectedValue(
    new Error('upload не вызывается в этом тесте'),
  );
  vi.mocked(deleteDocumentTemplateAsync).mockResolvedValue(undefined);

  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    nodeStatuses: {},
    nodeOutputs: {},
    nodeMetrics: {},
    llmModels: [],
    llmModelsLoaded: true,
    currentWorkflowId: null,
    accessRole: null,
    pushHistoryCoalesced: () => undefined,
  });
});

describe('DocumentGenNode — inline-режим (v0.10 S6)', () => {
  it('по умолчанию показывает Markdown и textarea контента', () => {
    renderNode(documentData());

    expect(
      screen.getByLabelText(ru['node.document_gen.mode']),
    ).toHaveValue('inline');
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
    connectIncomingEdge();

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

describe('DocumentGenNode — template-режим (v0.11 S5)', () => {
  it('селект режима записывает data.mode=template', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });

    renderNode(documentData());

    const select = screen.getByLabelText(ru['node.document_gen.mode']);

    // data-атрибут для smoke (DESIGN § 3.1.8).
    expect(select).toHaveAttribute('data-document-gen-mode');
    expect(select).toHaveValue('inline');

    fireEvent.change(select, { target: { value: 'template' } });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.mode).toBe('template');
    });
  });

  it('в режиме template показывает шаблонные поля и не показывает inline-поля', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });

    renderNode(documentData({ mode: 'template' }));

    expect(
      await screen.findByLabelText(ru['template.select']),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(ru['node.document_gen.source']),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(ru['node.document_gen.content']),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: ru['template.upload'] }),
    ).toBeInTheDocument();
  });

  it('показывает шаблоны и чипы плейсхолдеров выбранного шаблона', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });
    vi.mocked(listDocumentTemplatesAsync).mockResolvedValue([TEMPLATE]);

    renderNode(documentData({ mode: 'template', templateId: TEMPLATE_ID }));

    const select = await screen.findByLabelText(ru['template.select']);

    await waitFor(() => {
      expect(select).toHaveValue(TEMPLATE_ID);
    });
    // Плейсхолдеры показываются в фигурных скобках (как в шаблоне).
    expect(await screen.findByText('{client}')).toBeInTheDocument();
    expect(screen.getByText('{amount}')).toBeInTheDocument();
    // Селект помечен data-атрибутом для smoke.
    expect(select).toHaveAttribute('data-document-template-select');
  });

  it('без сохранённого workflow просит сохранить и не ходит в API', async () => {
    renderNode(documentData({ mode: 'template' }));

    expect(
      screen.getByText(ru['template.needSave']),
    ).toBeInTheDocument();
    expect(vi.mocked(listDocumentTemplatesAsync)).not.toHaveBeenCalled();
  });

  it('загружает .docx через FormData-хелпер и выбирает новый шаблон', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });

    const created: ApiDocumentTemplate = {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Новый шаблон.docx',
      bytes: 2048,
      placeholders: ['date'],
      createdAt: '2026-10-19T10:00:00.000Z',
    };
    vi.mocked(uploadDocumentTemplateAsync).mockResolvedValue(created);

    const { container } = render(
      <ReactFlowProvider
        defaultNodes={[
          {
            id: NODE_ID,
            type: 'document_gen',
            position: { x: 0, y: 0 },
            data: documentData({ mode: 'template' }),
          },
        ]}
      >
        <FlowProbe />
        <DocumentGenNode
          {...nodePropsOf(documentData({ mode: 'template' }))}
        />
      </ReactFlowProvider>,
    );

    await screen.findByLabelText(ru['template.select']);

    const fileInput = container.querySelector<HTMLInputElement>(
      '[data-document-template-file]',
    );
    const file = new File(['PK\u0003\u0004'], 'contract.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(vi.mocked(uploadDocumentTemplateAsync)).toHaveBeenCalledWith(
        WORKFLOW_ID,
        file,
      );
    });
    // Узел сразу переключился на загруженный шаблон.
    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.templateId).toBe(created.id);
      expect(flow?.getNode(NODE_ID)?.data.mode).toBe('template');
    });
  });

  it('ошибка загрузки показывается текстом, узел не меняется', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });
    vi.mocked(uploadDocumentTemplateAsync).mockRejectedValue(
      new Error('400'),
    );

    const { container } = render(
      <ReactFlowProvider
        defaultNodes={[
          {
            id: NODE_ID,
            type: 'document_gen',
            position: { x: 0, y: 0 },
            data: documentData({ mode: 'template' }),
          },
        ]}
      >
        <FlowProbe />
        <DocumentGenNode
          {...nodePropsOf(documentData({ mode: 'template' }))}
        />
      </ReactFlowProvider>,
    );

    await screen.findByLabelText(ru['template.select']);

    const fileInput = container.querySelector<HTMLInputElement>(
      '[data-document-template-file]',
    );

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [new File(['x'], 'bad.docx')] },
    });

    expect(
      await screen.findByText(ru['template.uploadError']),
    ).toBeInTheDocument();
    expect(flow?.getNode(NODE_ID)?.data.templateId).toBeUndefined();
  });

  it('переменные вводятся JSON-объектом и попадают в data.variables', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });

    renderNode(documentData({ mode: 'template', templateId: TEMPLATE_ID }));

    const textarea = await screen.findByLabelText(ru['template.variables']);
    const json = '{"client":"ACME","amount":42}';

    fireEvent.change(textarea, { target: { value: json } });

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.variables).toEqual({
        client: 'ACME',
        amount: 42,
      });
    });
  });

  it('невалидный JSON подсвечивается и не пишется в data.variables', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });

    renderNode(documentData({ mode: 'template', templateId: TEMPLATE_ID }));

    const textarea = await screen.findByLabelText(ru['template.variables']);

    fireEvent.change(textarea, { target: { value: '{не json}' } });

    expect(
      await screen.findByText(ru['template.variablesInvalid']),
    ).toBeInTheDocument();
    expect(flow?.getNode(NODE_ID)?.data.variables).toBeUndefined();
  });

  it('при входящей связи переменные приходят из входа', async () => {
    useWorkflowStore.setState({ currentWorkflowId: WORKFLOW_ID });
    connectIncomingEdge();

    renderNode(documentData({ mode: 'template', templateId: TEMPLATE_ID }));

    expect(
      await screen.findByText(ru['template.variablesFromInput']),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(ru['template.variables']),
    ).not.toBeInTheDocument();
  });

  it('удаление шаблона disabled для viewer, доступно editor-у', async () => {
    useWorkflowStore.setState({
      currentWorkflowId: WORKFLOW_ID,
      accessRole: 'viewer',
    });
    vi.mocked(listDocumentTemplatesAsync).mockResolvedValue([TEMPLATE]);

    const { unmount } = render(
      <ReactFlowProvider
        defaultNodes={[
          {
            id: NODE_ID,
            type: 'document_gen',
            position: { x: 0, y: 0 },
            data: documentData({ mode: 'template', templateId: TEMPLATE_ID }),
          },
        ]}
      >
        <FlowProbe />
        <DocumentGenNode
          {...nodePropsOf(
            documentData({ mode: 'template', templateId: TEMPLATE_ID }),
          )}
        />
      </ReactFlowProvider>,
    );

    expect(
      await screen.findByRole('button', { name: ru['template.delete'] }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: ru['template.upload'] }),
    ).toBeDisabled();

    unmount();
    flow = null;

    useWorkflowStore.setState({ accessRole: 'editor' });

    render(
      <ReactFlowProvider
        defaultNodes={[
          {
            id: NODE_ID,
            type: 'document_gen',
            position: { x: 0, y: 0 },
            data: documentData({ mode: 'template', templateId: TEMPLATE_ID }),
          },
        ]}
      >
        <FlowProbe />
        <DocumentGenNode
          {...nodePropsOf(
            documentData({ mode: 'template', templateId: TEMPLATE_ID }),
          )}
        />
      </ReactFlowProvider>,
    );

    expect(
      await screen.findByRole('button', { name: ru['template.delete'] }),
    ).toBeEnabled();
  });

  it('показывает жёлтую подсказку о незаполненных переменных после Run', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: {
          mode: 'template',
          missingVariables: ['amount', 'date'],
          storedUrl: '/media/file/run-1/generated-document-gen-1.docx',
        },
      },
    });

    renderNode(documentData({ mode: 'template', templateId: TEMPLATE_ID }));

    expect(
      screen.getByText(
        ru['template.missing'].replace('{{names}}', 'amount, date'),
      ),
    ).toBeInTheDocument();
  });

  it('inline-документ не показывает подсказку о missingVariables', () => {
    useWorkflowStore.setState({
      nodeOutputs: {
        [NODE_ID]: {
          missingVariables: ['amount'],
          storedUrl: '/media/file/run-1/generated-document-gen-1.docx',
        },
      },
    });

    renderNode(documentData());

    expect(
      screen.queryByText(
        ru['template.missing'].replace('{{names}}', 'amount'),
      ),
    ).not.toBeInTheDocument();
  });
});
