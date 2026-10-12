import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  type TextFlowNode,
} from '@/types/graph';

/**
 * Узел ввода текста.
 *
 * Входов нет, на выходе — типизированный порт `text` (синий).
 */
export function TextNode({ id, data }: NodeProps<TextFlowNode>) {
  const { updateNodeData } = useReactFlow();

  return (
    <>
      <BaseNode icon={NODE_TYPE_ICONS.text} title={NODE_TYPE_LABELS.text}>
        <textarea
          rows={3}
          value={data.value}
          placeholder="Введите текст..."
          // nodrag: иначе протяжка мышью по textarea тащит саму ноду.
          className="nodrag w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-slate-300"
          onChange={(event) => updateNodeData(id, { value: event.target.value })}
        />
      </BaseNode>

      <span
        className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.text }}
      >
        {DATA_TYPE_LABELS.text}
      </span>
      <Handle
        type="source"
        id="text-output"
        position={Position.Right}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />
    </>
  );
}
