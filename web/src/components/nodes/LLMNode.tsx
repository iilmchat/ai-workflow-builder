import { useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  type LlmFlowNode,
} from '@/types/graph';

/**
 * Узел вызова языковой модели.
 *
 * Вход и выход — типизированные порты `text` (синие). Список моделей берётся с
 * backend (`GET /llm/models`, R4.1b) и кэшируется в сторе: в `data.model`
 * хранится **id** модели (`claude-sonnet-4-20250514`), а в селекте показывается
 * её человекочитаемый label (KI-069).
 */
export function LLMNode({ id, data }: NodeProps<LlmFlowNode>) {
  const { updateNodeData } = useReactFlow();
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const llmModels = useWorkflowStore((state) => state.llmModels);
  const loadLlmModels = useWorkflowStore((state) => state.loadLlmModelsAsync);

  // Список грузится лениво при появлении LLM-узла и кэшируется в сторе,
  // поэтому запрос уходит один раз на сессию, а не на каждый узел.
  useEffect(() => {
    void loadLlmModels();
  }, [loadLlmModels]);

  const selected = llmModels.find((model) => model.id === data.model);
  // Модель, которой нет среди доступных (старое значение label или ключ
  // провайдера пропал): показываем как есть, но помечаем недоступной —
  // молчаливой подмены модели больше нет (KI-069).
  const isUnavailable = data.model !== '' && selected === undefined;

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
        icon={NODE_TYPE_ICONS.llm}
        title={NODE_TYPE_LABELS.llm}
        executionLevel={executionLevel}
        status={status}
      >
        <select
          value={data.model}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-300"
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {data.model === '' && (
            <option value="" disabled>
              {llmModels.length === 0 ? 'Нет доступных моделей' : 'Выберите модель'}
            </option>
          )}

          {isUnavailable && (
            <option value={data.model} disabled>
              {data.model} (недоступно)
            </option>
          )}

          {llmModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>

        <p
          className="mt-1.5 truncate text-[10px] text-slate-400"
          title={selected?.id ?? data.model}
        >
          {selected
            ? selected.provider
            : llmModels.length === 0
              ? 'Нет доступных моделей'
              : 'Модель недоступна'}
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
