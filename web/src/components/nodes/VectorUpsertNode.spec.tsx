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
  DEFAULT_EMBEDDING_MODEL,
  type VectorUpsertFlowNode,
  type VectorUpsertNodeData,
} from '@/types/graph';
import { VectorUpsertNode } from './VectorUpsertNode';

/** id узла в тестовом графе. */
const NODE_ID = 'vector-upsert-1';

/**
 * Пропсы узла для изолированного рендера.
 *
 * Компонент читает только `id` и `data`; остальные обязательные поля
 * `NodeProps` нужны React Flow и в тесте не используются. Каст через
 * `unknown` — единственный способ не собирать служебный объект React Flow
 * целиком (RULES 1.16: `any` не используется).
 *
 * @param data - данные узла
 * @returns пропсы `VectorUpsertNode`
 */
function nodePropsOf(
  data: VectorUpsertNodeData,
): NodeProps<VectorUpsertFlowNode> {
  return {
    id: NODE_ID,
    type: 'vector_upsert',
    data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<VectorUpsertFlowNode>;
}

/**
 * Собирает данные узла с валидными значениями по умолчанию.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns `data` узла `vector_upsert`
 */
function upsertData(
  overrides: Partial<VectorUpsertNodeData> = {},
): VectorUpsertNodeData {
  return {
    kind: 'vector_upsert',
    collection: '',
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
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
 * Рендерит `VectorUpsertNode` внутри провайдера с тем же узлом в store.
 *
 * `defaultNodes` (не `initialNodes`) важен: только в uncontrolled-режиме
 * `updateNodeData` пишет прямо в store, а не отдаёт изменение в
 * `onNodesChange`, которого в изолированном тесте нет.
 *
 * @param data - данные узла
 */
function renderNode(data: VectorUpsertNodeData): void {
  flow = null;

  render(
    <ReactFlowProvider
      defaultNodes={[
        {
          id: NODE_ID,
          type: 'vector_upsert',
          position: { x: 0, y: 0 },
          data,
        },
      ]}
    >
      <FlowProbe />
      <VectorUpsertNode {...nodePropsOf(data)} />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  // Стор — модульный синглтон: сбрасываем запуск и историю между тестами.
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    nodeStatuses: {},
    nodeOutputs: {},
    nodeMetrics: {},
    executionLevels: {},
    llmModels: [],
    llmModelsLoaded: true,
    pushHistoryCoalesced: () => undefined,
  });
});

describe('VectorUpsertNode — рендер и правки полей (KI-405)', () => {
  it('рендерит коллекцию, поле содержимого, промпт и модель эмбеддингов', () => {
    renderNode(
      upsertData({
        collection: 'docs',
        contentField: 'prompt',
        prompt: 'Текст чанка',
      }),
    );

    expect(
      screen.getByLabelText(ru['node.vector_upsert.collection']),
    ).toHaveValue('docs');
    expect(
      screen.getByLabelText(ru['node.vector_upsert.contentField']),
    ).toHaveValue('prompt');
    expect(screen.getByLabelText(ru['node.vector_upsert.prompt'])).toHaveValue(
      'Текст чанка',
    );
    expect(
      screen.getByLabelText(ru['node.vector_upsert.embeddingModel']),
    ).toHaveValue(DEFAULT_EMBEDDING_MODEL);
  });

  it('fireEvent.change в collection обновляет data узла в React Flow store', async () => {
    renderNode(upsertData());

    fireEvent.change(
      screen.getByLabelText(ru['node.vector_upsert.collection']),
      {
        target: { value: 'knowledge-base' },
      },
    );

    await waitFor(() => {
      expect(flow?.getNode(NODE_ID)?.data.collection).toBe('knowledge-base');
    });
  });
});
