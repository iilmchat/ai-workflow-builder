import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  type DefaultEdgeOptions,
  type Node,
} from '@xyflow/react';
import {
  INSERTABLE_EDGE_TYPE,
  InsertableEdge,
} from '@/components/edges/InsertableEdge';
import { nodeTypes } from '@/components/nodes';
import { NodeCatalogPopover } from '@/components/NodeCatalogPopover';
import { useDebouncedEffect } from '@/hooks/use-debounced-effect';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { computeGraphHash } from '@/lib/graph-hash';
import { findGuides, type HelperLines } from '@/lib/graph-guides';
import { canInsertOnEdge } from '@/lib/node-registry';
import { useWorkflowStore, type FindCenterHandler } from '@/stores/workflow';
import { useTranslation } from 'react-i18next';

/** Шаг сетки привязки узлов (KI-189). */
const SNAP_GRID: [number, number] = [8, 8];

/** Допуск совпадения центров для направляющих (KI-189), px. */
const GUIDE_TOLERANCE = 4;

/** Задержка автосохранения после правки графа (KI-195), мс. */
const AUTO_SAVE_DELAY_MS = 3000;

/**
 * Реестр типов связей React Flow (KI-185).
 *
 * Константа уровня модуля: React Flow сверяет ссылку и предупреждает в консоли,
 * если объект типов создаётся заново на каждом рендере.
 */
const edgeTypes = { [INSERTABLE_EDGE_TYPE]: InsertableEdge };

/**
 * Опции связей по умолчанию (KI-185).
 *
 * `type` отсюда React Flow подставляет связям, у которых своего `type` нет, —
 * в том числе загруженным из backend. Благодаря этому «вставляемое» ребро
 * получают все связи графа, а не только созданные в текущей сессии.
 */
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = { type: INSERTABLE_EDGE_TYPE };

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
  const addNodeOnEdge = useWorkflowStore((state) => state.addNodeOnEdge);
  const duplicateNodes = useWorkflowStore((state) => state.duplicateNodes);
  const setSelectedNodeId = useWorkflowStore((state) => state.setSelectedNodeId);
  const selectedNodeId = useWorkflowStore((state) => state.selectedNodeId);
  const currentWorkflowId = useWorkflowStore((state) => state.currentWorkflowId);
  const lastSavedHash = useWorkflowStore((state) => state.lastSavedHash);
  const markSaved = useWorkflowStore((state) => state.markSaved);
  const saveWorkflowAsync = useWorkflowStore((state) => state.saveWorkflowAsync);
  const isEmpty = nodes.length === 0;
  // KI-189: направляющие выравнивания (ручная реализация — `useAligning`
  // доступен только в @xyflow/pro).
  const [helperLines, setHelperLines] = useState<HelperLines>({});
  // KI-185 (fix4): связь, для которой открыт каталог вставки узла. Клик по «+»
  // обрабатывает кастомное ребро (`InsertableEdge`), а поповер каталога живёт
  // здесь — обмен между ними идёт через стор.
  const pendingEdgeId = useWorkflowStore((state) => state.pendingEdgeId);
  const clearPendingEdge = useWorkflowStore((state) => state.clearPendingEdge);

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

  /**
   * Считает направляющие по совпадению центров dragged-узла с соседями.
   *
   * KI-189-fix: React Flow отдаёт в `onNodeDrag` третьим аргументом только
   * перетаскиваемые узлы (сам dragged-узел), поэтому список соседей берём из
   * стора. С прежним `allNodes` в `findGuides` попадал один dragged-узел,
   * который функция пропускает по id, — направляющих не было никогда.
   *
   * @param node - перетаскиваемый узел (позиция + измеренный размер)
   */
  const handleNodeDrag = useCallback((node: Node) => {
    const others = useWorkflowStore
      .getState()
      .nodes.filter((item) => item.id !== node.id)
      .map((item) => ({
        id: item.id,
        position: item.position,
        width: item.measured?.width,
        height: item.measured?.height,
      }));

    setHelperLines(
      findGuides(
        {
          id: node.id,
          position: node.position,
          width: node.measured?.width,
          height: node.measured?.height,
        },
        others,
        GUIDE_TOLERANCE,
      ),
    );
  }, []);

  // KI-191: Ctrl+D дублирует выделенный узел (R6.4b расширит список клавиш).
  useHotkeys(
    {
      'ctrl+d': (event) => {
        if (selectedNodeId === null) {
          return;
        }

        event.preventDefault();
        duplicateNodes([selectedNodeId]);
      },
    },
    [selectedNodeId, duplicateNodes],
  );

  // KI-195: автосохранение через 3 секунды после последней правки. Сохраняем
  // только сохранённый workflow и только если граф реально отличается от
  // последнего сохранённого состояния.
  useDebouncedEffect(
    () => {
      if (currentWorkflowId === null) {
        return;
      }

      const hash = computeGraphHash(nodes, edges);

      if (hash === lastSavedHash) {
        return;
      }

      void saveWorkflowAsync().then(() => markSaved(hash));
    },
    [nodes, edges, currentWorkflowId, lastSavedHash],
    AUTO_SAVE_DELAY_MS,
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      // KI-185: кастомное ребро с кнопками «+»/«×». `edgeTypes` — константа
      // модуля, `DEFAULT_EDGE_OPTIONS` подставляет тип связям без своего `type`
      // (в том числе загруженным из backend).
      edgeTypes={edgeTypes}
      defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
      // KI-189: привязка к сетке 8×8, направляющие — поверх (см. ниже).
      snapToGrid
      snapGrid={SNAP_GRID}
      // KI-189-fix: `onNodeDrag` третьим аргументом отдаёт только dragged-узлы,
      // поэтому соседей для направляющих обработчик берёт из стора.
      onNodeDrag={(_event, node) => handleNodeDrag(node)}
      onNodeDragStop={() => setHelperLines({})}
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

      {/* KI-185 (fix4): кнопки «+»/«×» живут в самом ребре
          (`InsertableEdge`) — Canvas их больше не рисует и не хранит hover. */}

      {pendingEdgeId !== null && (
        // Ширина задана явно: у обёртки нет содержимого собственного размера,
        // и `inset-x-0` внутри поповера схлопывался в 0 (KI-258).
        <div className="absolute left-1/2 top-4 z-30 w-72 -translate-x-1/2">
          <NodeCatalogPopover
            open
            placement="down"
            // KI-259: в связь можно вставить только типы с входным портом
            // (единый источник правды — `NODE_REGISTRY.canBeInsertedOnEdge`).
            filter={canInsertOnEdge}
            onClose={clearPendingEdge}
            onAddNode={(type) => {
              addNodeOnEdge(pendingEdgeId, type);
              clearPendingEdge();
            }}
          />
        </div>
      )}

      {/* KI-189: направляющие выравнивания. Слой рендерится через
          `<ViewportPortal>` — он живёт внутри `.react-flow__viewport` и
          трансформируется вместе с холстом, поэтому координаты линий — в
          координатах потока (без пересчёта в экранные).
          `overflow-visible` обязателен: без него svg обрезает линию по своему
          боксу (размер вьюпорта), и при pan/zoom линия пропадает.
          `pointer-events-none` — слой не должен перехватывать кнопки «+»/«×». */}
      {(helperLines.vertical !== undefined ||
        helperLines.horizontal !== undefined) && (
        <ViewportPortal>
          <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
            {helperLines.vertical !== undefined && (
              <line
                data-helper-line="vertical"
                x1={helperLines.vertical}
                x2={helperLines.vertical}
                y1={-100000}
                y2={100000}
                stroke="var(--color-primary)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
            {helperLines.horizontal !== undefined && (
              <line
                data-helper-line="horizontal"
                x1={-100000}
                x2={100000}
                y1={helperLines.horizontal}
                y2={helperLines.horizontal}
                stroke="var(--color-primary)"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}
          </svg>
        </ViewportPortal>
      )}
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
