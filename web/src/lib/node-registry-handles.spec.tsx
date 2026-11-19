import { Suspense, type ComponentType } from 'react';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NODE_REGISTRY } from './node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import type { AppNode, NodeType } from '@/types/graph';

/**
 * Рендерит узел из реестра в jsdom и возвращает наличие его Handle'ов.
 *
 * KI-262: поле `canBeInsertedOnEdge` — ручное знание о портах, `tsc` не
 * проверяет его согласованность с `<Handle>` внутри компонента. Здесь каждый
 * тип рендерится по-настоящему, а классы `target`/`source` React Flow дают
 * фактический ответ. Компоненты ленивые, поэтому нужен `<Suspense>`.
 *
 * @param type - тип узла из реестра
 * @returns сколько target/source handle'ов отрендерил компонент
 */
async function handlesOfAsync(
  type: NodeType,
): Promise<{ targets: number; sources: number }> {
  useWorkflowStore.setState({ nodes: [], edges: [], past: [], future: [] });
  useWorkflowStore.getState().addNode(type, { x: 0, y: 0 });

  const node = useWorkflowStore.getState().nodes[0] as AppNode;
  const Component = NODE_REGISTRY[type].component as unknown as ComponentType<
    NodeProps<AppNode>
  >;
  const props = {
    id: node.id,
    type,
    data: node.data,
    selected: false,
    isConnectable: true,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    dragging: false,
  } as unknown as NodeProps<AppNode>;

  const { container, unmount } = render(
    <Suspense fallback={null}>
      <ReactFlowProvider>
        <Component {...props} />
      </ReactFlowProvider>
    </Suspense>,
  );

  // У комментария Handle'ов нет вовсе — ждём сам компонент, а не порт.
  await waitFor(() => {
    expect(container.innerHTML).not.toBe('');
  });

  const result = {
    targets: container.querySelectorAll('.react-flow__handle.target').length,
    sources: container.querySelectorAll('.react-flow__handle.source').length,
  };

  unmount();

  return result;
}

describe('canBeInsertedOnEdge ↔ фактические Handle (KI-262)', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  it.each(Object.keys(NODE_REGISTRY) as NodeType[])(
    '%s: флаг реестра совпадает с наличием target-handle',
    async (type) => {
      const { targets } = await handlesOfAsync(type);

      expect(targets > 0, `${type}: target-handle найдено ${targets}`).toBe(
        NODE_REGISTRY[type].canBeInsertedOnEdge,
      );
    },
  );
});
