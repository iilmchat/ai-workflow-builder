import { useCallback, useEffect, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { nodeTypes } from '@/components/nodes';
import { useWorkflowStore, type FindCenterHandler } from '@/stores/workflow';

interface CanvasProps {
  /**
   * Canvas отдаёт наружу функцию поиска центра вьюпорта: только у него есть
   * доступ к трансформации React Flow.
   */
  onReady: (findCenter: FindCenterHandler) => void;
}

/** Внутренняя часть канваса: живёт внутри ReactFlowProvider. */
function CanvasInner({ onReady }: CanvasProps) {
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowStore((state) => state.onEdgesChange);
  const onConnect = useWorkflowStore((state) => state.onConnect);
  const setSelectedNodeId = useWorkflowStore((state) => state.setSelectedNodeId);
  const isEmpty = nodes.length === 0;

  const { getViewport } = useReactFlow();

  /**
   * Переводит центр контейнера из экранных координат в координаты холста
   * с учётом зума и сдвига вьюпорта.
   */
  const findCenter = useCallback<FindCenterHandler>(() => {
    const viewport = getViewport();
    const container = document.querySelector<HTMLElement>('.react-flow');
    const width = container?.clientWidth ?? window.innerWidth;
    const height = container?.clientHeight ?? window.innerHeight;

    return {
      x: (width / 2 - viewport.x) / viewport.zoom,
      y: (height / 2 - viewport.y) / viewport.zoom,
    };
  }, [getViewport]);

  // Отдаём функцию поиска центра наружу ровно один раз: повторные вызовы
  // дёргали бы состояние приложения на каждом ре-рендере канваса.
  const emitted = useRef(false);

  useEffect(() => {
    if (emitted.current) {
      return;
    }

    emitted.current = true;
    onReady(findCenter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      // Клик по узлу показывает его результат в нижней панели (R4.3b),
      // клик по пустому месту возвращает панель к run-уровню. Клик по связи или
      // порту эти обработчики не дёргает, поэтому выбор не «слетает».
      onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
      onPaneClick={() => setSelectedNodeId(null)}
      proOptions={{ hideAttribution: true }}
      // Связи по умолчанию тонкие и почти незаметные — делаем их чуть плотнее.
      defaultEdgeOptions={{ style: { strokeWidth: 2, stroke: '#94a3b8' } }}
      // maxZoom: иначе один-два узла растягиваются на весь экран.
      // При загрузке графа из backend подгоняем вид по всем узлам.
      fitView={isEmpty}
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls />
      <MiniMap />
    </ReactFlow>
  );
}

/**
 * Канвас редактора: фон с сеткой, zoom-контролы и миникарта.
 *
 * Узлы и связи хранятся в zustand-сторе, поэтому Canvas остаётся тонким
 * слоем между React Flow и состоянием приложения.
 */
export function Canvas({ onReady }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner onReady={onReady} />
    </ReactFlowProvider>
  );
}
