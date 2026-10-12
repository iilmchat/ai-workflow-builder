import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  LLM_MODEL_HINTS,
  LLM_MODELS,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  type LlmFlowNode,
  type LlmModel,
} from '@/types/graph';

/**
 * Узел вызова языковой модели.
 *
 * Вход и выход — типизированные порты `text` (синие).
 */
export function LLMNode({ id, data }: NodeProps<LlmFlowNode>) {
  const { updateNodeData } = useReactFlow();

  return (
    <>
      <Handle
        type="target"
        id="text-input"
        position={Position.Left}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />

      <BaseNode icon={NODE_TYPE_ICONS.llm} title={NODE_TYPE_LABELS.llm}>
        <select
          value={data.model}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-300"
          onChange={(event) =>
            updateNodeData(id, { model: event.target.value as LlmModel })
          }
        >
          {LLM_MODELS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>

        <p className="mt-1.5 text-[10px] text-slate-400">
          {LLM_MODEL_HINTS[data.model]}
        </p>
      </BaseNode>

      <Handle
        type="source"
        id="text-output"
        position={Position.Right}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />
      <span
        className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.text }}
      >
        {DATA_TYPE_LABELS.text}
      </span>
    </>
  );
}
