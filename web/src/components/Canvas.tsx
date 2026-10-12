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
import { useWorkflowStore } from '@/stores/workflow';

/** Функция, возвращающая центр вьюпорта в координатах холста. */
export type FindCenterHandler = () => { x: number; y: number };

interface CanvasProps {
  /**
   * Canvas отдаёт наружу функцию поиска центра вьюпорта: только у него есть
   * доступ к трансформации React Flow, а решение о добавлении узла принимает
   * приложение.
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
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      proOptions={{ hideAttribution: true }}
      fitView
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
