import { useCallback, useEffect } from 'react';
import { Canvas } from '@/components/Canvas';
import { Toast } from '@/components/Toast';
import { Toolbar } from '@/components/Toolbar';
import { TopBar } from '@/components/TopBar';
import {
  useWorkflowStore,
  type FindCenterHandler,
} from '@/stores/workflow';
import type { NodeType } from '@/types/graph';

/** Отступ верхней панели, под который уходит канвас. */
const TOP_BAR_HEIGHT = 56;

/**
 * Корневой компонент редактора: верхняя панель, канвас и нижний тулбар.
 *
 * Создание узла живёт здесь: Canvas отдаёт функцию поиска центра вьюпорта
 * (у него есть доступ к трансформации React Flow), а стор — операцию добавления.
 */
export function App() {
  const addNode = useWorkflowStore((state) => state.addNode);
  const nodeCount = useWorkflowStore((state) => state.nodes.length);
  const findCenter = useWorkflowStore((state) => state.findCenter);
  const setFindCenter = useWorkflowStore((state) => state.setFindCenter);
  const loadWorkflowAsync = useWorkflowStore((state) => state.loadWorkflowAsync);

  // При открытии страницы с ?workflowId=... подтягиваем сохранённый граф.
  useEffect(() => {
    const workflowId = new URL(window.location.href).searchParams.get('workflowId');

    if (workflowId) {
      void loadWorkflowAsync(workflowId);
    }
  }, [loadWorkflowAsync]);

  const handleCanvasReady = useCallback(
    (handler: FindCenterHandler) => {
      setFindCenter(handler);
    },
    [setFindCenter],
  );

  const handleAddNode = useCallback(
    (type: NodeType) => {
      if (!findCenter) {
        return;
      }

      const center = findCenter();
      // Раскладываем узлы сеткой от центра: карточка ~240x150, поэтому шаг
      // 280x190 — узлы не накладываются друг на друга.
      const column = nodeCount % 3;
      const row = Math.floor(nodeCount / 3);

      addNode(type, {
        x: center.x - 280 + column * 280,
        y: center.y - 80 + row * 190,
      });
    },
    [addNode, findCenter, nodeCount],
  );

  return (
    <div className="relative h-screen w-screen">
      <TopBar />

      <div
        className="absolute inset-x-0 bottom-0"
        style={{ top: TOP_BAR_HEIGHT }}
      >
        <Canvas onReady={handleCanvasReady} />
      </div>

      <Toolbar onAddNode={handleAddNode} />
      <Toast />
    </div>
  );
}
