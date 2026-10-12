import { useCallback, useRef } from 'react';
import { Canvas, type FindCenterHandler } from '@/components/Canvas';
import { Toolbar } from '@/components/Toolbar';
import { useWorkflowStore } from '@/stores/workflow';
import { NODE_TYPE_LABELS, type NodeType } from '@/types/graph';

/**
 * Корневой компонент редактора: канвас на всю высоту и нижний тулбар поверх него.
 *
 * Создание узла живёт здесь: Canvas отдаёт функцию поиска центра вьюпорта
 * (у него есть доступ к трансформации React Flow), а стор — операцию добавления.
 * Функция хранится в ref: setState принял бы функцию за updater, а лишние
 * ре-рендеры при передаче колбэка здесь не нужны.
 */
export function App() {
  const addNode = useWorkflowStore((state) => state.addNode);
  const nodeCount = useWorkflowStore((state) => state.nodes.length);
  const findCenterRef = useRef<FindCenterHandler | null>(null);

  const handleCanvasReady = useCallback((findCenter: FindCenterHandler) => {
    findCenterRef.current = findCenter;
  }, []);

  const handleAddNode = useCallback(
    (type: NodeType) => {
      const findCenter = findCenterRef.current;

      if (!findCenter) {
        return;
      }

      const center = findCenter();
      // Небольшой сдвиг на каждый следующий узел, иначе узлы ложатся
      // ровно друг на друга в центре канваса.
      const step = nodeCount * 40;

      addNode({
        id: `${type}-${crypto.randomUUID()}`,
        type: 'default',
        position: { x: center.x + step, y: center.y + step },
        data: { label: NODE_TYPE_LABELS[type], nodeType: type },
        selected: true,
      });
    },
    [addNode, nodeCount],
  );

  return (
    <div className="relative flex h-screen w-screen flex-col">
      <div className="min-h-0 flex-1">
        <Canvas onReady={handleCanvasReady} />
      </div>

      <Toolbar onAddNode={handleAddNode} />
    </div>
  );
}
