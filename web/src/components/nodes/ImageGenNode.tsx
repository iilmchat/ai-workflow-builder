import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  IMAGE_MODEL,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  type ImageGenFlowNode,
} from '@/types/graph';

/**
 * Узел генерации изображений.
 *
 * Вход — `text` (синий), выход — `image` (зелёный, метка G).
 */
export function ImageGenNode({ id, data }: NodeProps<ImageGenFlowNode>) {
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);

  return (
    <>
      <Handle
        type="target"
        id="text-input"
        position={Position.Left}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />

      <BaseNode
        icon={NODE_TYPE_ICONS.image}
        title={NODE_TYPE_LABELS.image}
        executionLevel={executionLevel}
        status={status}
      >
        {data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt="Результат генерации"
            className="max-h-32 w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 px-2 text-center text-[10px] text-slate-400">
            Здесь появится результат
          </div>
        )}

        <select
          disabled
          value={IMAGE_MODEL}
          className="nodrag mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-400"
          onChange={() => undefined}
        >
          <option value={IMAGE_MODEL}>{IMAGE_MODEL}</option>
        </select>
      </BaseNode>

      <Handle
        type="source"
        id="image-output"
        position={Position.Right}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.generic }}
      />
      <span
        className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.generic }}
      >
        {DATA_TYPE_LABELS.generic}
      </span>
    </>
  );
}
