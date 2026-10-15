import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowStore } from '@/stores/workflow';

/** Идентификатор кастомного типа связи в реестре React Flow (KI-185). */
export const INSERTABLE_EDGE_TYPE = 'insertable';

/**
 * Ширина невидимой полосы наведения вокруг линии, px (KI-185).
 *
 * Блок кнопок «+»/«×» занимает 52×24 px и стоит по центру связи. Полоса шириной
 * 60 px (по 30 px в каждую сторону) накрывает блок целиком, поэтому курсор,
 * идущий от линии к кнопкам, не выходит из зоны наведения.
 */
const INTERACTION_WIDTH = 60;

/**
 * Кастомное ребро с кнопками «+» (вставить узел в связь) и «×» (удалить связь).
 *
 * Реализовано по штатному паттерну React Flow — `BaseEdge` + `interactionWidth`
 * + `EdgeLabelRenderer`, см.
 * https://reactflow.dev/examples/edges/edge-with-button
 *
 * KI-185 (fix4): hover-состояние живёт внутри самого ребра — без таймеров и
 * ref-флагов (fix3). Ключевое отличие от fix3: блок кнопок **не размонтируется**
 * при уходе курсора с линии, а только становится прозрачным. Иначе `mouseleave`
 * на линии успевал убрать блок из DOM раньше, чем мышь доходила до кнопок, и
 * «дотянуться» до них можно было только искусственной задержкой сброса.
 *
 * @param props - пропсы ребра от React Flow: id, координаты концов и позиции портов
 * @returns линия связи и блок кнопок над её серединой
 */
export function InsertableEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const requestInsertOnEdge = useWorkflowStore(
    (state) => state.requestInsertOnEdge,
  );
  const removeEdge = useWorkflowStore((state) => state.removeEdge);
  const { t } = useTranslation();

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      {/* Широкая невидимая hit-area + видимая линия — штатный API BaseEdge. */}
      <BaseEdge
        id={id}
        path={edgePath}
        interactionWidth={INTERACTION_WIDTH}
        style={{ strokeWidth: 2 }}
      />

      {/* Полоса наведения с обработчиками: встроенный путь `interactionWidth`
          наружу событий не отдаёт, а hover нужен внутри самого ребра. */}
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={INTERACTION_WIDTH}
        style={{ pointerEvents: 'stroke' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* Блок кнопок смонтирован всегда (гаснет через opacity), поэтому
          «линия → кнопки» — переход без потери цели под курсором. */}
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-full border border-border bg-background px-1 py-0.5 shadow-node"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            opacity: hovered ? 1 : 0,
            zIndex: 20,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            data-edge-insert=""
            aria-label={t('canvas.edge.insert')}
            title={t('canvas.edge.insert')}
            className="flex size-5 cursor-pointer items-center justify-center rounded-full text-xs font-semibold text-foreground hover:bg-muted"
            onClick={() => requestInsertOnEdge(id)}
          >
            +
          </button>
          <button
            type="button"
            data-edge-delete=""
            aria-label={t('canvas.edge.delete')}
            title={t('canvas.edge.delete')}
            className="flex size-5 cursor-pointer items-center justify-center rounded-full text-xs font-semibold text-red-600 hover:bg-red-50"
            onClick={() => removeEdge(id)}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
