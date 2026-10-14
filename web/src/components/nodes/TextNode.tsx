import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import { NODE_REGISTRY, tLabel } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type TextFlowNode,
} from '@/types/graph';

/**
 * Узел ввода текста.
 *
 * Входов нет, на выходе — типизированный порт `text` (синий).
 */
export function TextNode({ id, data }: NodeProps<TextFlowNode>) {
  const { updateNodeData } = useReactFlow();
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);

  return (
    <>
      <BaseNode
        icon={NODE_REGISTRY.text.icon}
        title={tLabel(NODE_REGISTRY.text.labelKey)}
        executionLevel={executionLevel}
        status={status}
      >
        <textarea
          rows={3}
          value={data.value}
          placeholder="Введите текст..."
          // nodrag: иначе протяжка мышью по textarea тащит саму ноду.
          className="nodrag w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
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
