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
import { useTranslation } from 'react-i18next';

interface CanvasProps {
  /**
   * Canvas отдаёт наружу функцию поиска центра вьюпорта: только у него есть
   * доступ к трансформации React Flow.
   */
  onReady: (findCenter: FindCenterHandler) => void;
}

/**
 * Клавиши удаления выбранных узлов и связей (A1).
 *
 * React Flow v12 по умолчанию слушает только `Backspace`, поэтому `Delete` —
 * привычная клавиша для удаления — не делал ничего.
 */
const DELETE_KEY_CODES = ['Delete', 'Backspace'];

/**
 * Локализация подсказок встроенных элементов React Flow (KI-167).
 *
 * `<Controls />` и `<MiniMap />` берут `title` и `aria-label` своих кнопок из
 * конфига `ariaLabelConfig` (проверено в `@xyflow/system`: ключи
 * `controls.*.ariaLabel`), поэтому переводятся одним пропом — свои кнопки
 * писать не нужно.
 *
 * @param t - функция перевода react-i18next
 * @returns частичный конфиг подписей, который React Flow смёржит с дефолтным
 */
function ariaLabels(t: (key: string) => string) {
  return {
    'controls.ariaLabel': t('canvas.controls.title'),
    'controls.zoomIn.ariaLabel': t('canvas.controls.zoom_in'),
    'controls.zoomOut.ariaLabel': t('canvas.controls.zoom_out'),
    'controls.fitView.ariaLabel': t('canvas.controls.fit_view'),
    'controls.interactive.ariaLabel': t('canvas.controls.toggle_interactive'),
    'minimap.ariaLabel': t('canvas.minimap.title'),
  };
}

/** Внутренняя часть канваса: живёт внутри ReactFlowProvider. */
function CanvasInner({ onReady }: CanvasProps) {
  const { t } = useTranslation();
  const nodes = useWorkflowStore((state) => state.nodes);
  const edges = useWorkflowStore((state) => state.edges);
  const onNodesChange = useWorkflowStore((state) => state.onNodesChange);
  const onEdgesChange = useWorkflowStore((state) => state.onEdgesChange);
  const onConnect = useWorkflowStore((state) => state.onConnect);
  const removeNode = useWorkflowStore((state) => state.removeNode);
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
      // A1: по умолчанию React Flow v12 удаляет только по `Backspace`, из-за
      // чего привычная клавиша `Delete` не работала. Возвращаем обе.
      deleteKeyCode={DELETE_KEY_CODES}
      // A1: удаление узла сносит и его связи, чтобы в графе не оставалось
      // висячих рёбер (React Flow убирает их сам — фиксируем это тестом).
      onNodesDelete={(deleted) => {
        for (const node of deleted) {
          removeNode(node.id);
        }
      }}
      // Клик по узлу показывает его результат в нижней панели (R4.3b),
      // клик по пустому месту возвращает панель к run-уровню. Клик по связи или
      // порту эти обработчики не дёргает, поэтому выбор не «слетает».
      onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
      onPaneClick={() => setSelectedNodeId(null)}
      proOptions={{ hideAttribution: true }}
      // KI-167: подсказки кнопок Zoom/Fit/Interactive и миникарты на языке UI.
      ariaLabelConfig={ariaLabels(t)}
      // Цвет и толщина связей — из переменных React Flow (theme.css), чтобы
      // рёбра менялись вместе с темой (R5.2); width: 2 задан в --xy-edge-stroke-width.
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
