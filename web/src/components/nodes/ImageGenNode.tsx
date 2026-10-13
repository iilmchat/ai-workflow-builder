import { useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import { filterModelsByOutput } from '@/lib/llm-models';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  NODE_TYPE_ICONS,
  NODE_TYPE_LABELS,
  type ImageGenFlowNode,
} from '@/types/graph';

/**
 * Узел генерации изображений.
 *
 * Вход — `text` (синий), выход — `image` (зелёный, метка G).
 *
 * В селекте показываются только модели, отдающие `image-generation`
 * (v0.6.0a). Пока таких провайдеров нет, селект пуст и заблокирован с
 * подсказкой — это ожидаемое состояние до v0.6.0b (image-провайдер).
 */
export function ImageGenNode({ id, data }: NodeProps<ImageGenFlowNode>) {
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const llmModels = useWorkflowStore((state) => state.llmModels);
  const loadLlmModels = useWorkflowStore((state) => state.loadLlmModelsAsync);

  // Список моделей нужен и здесь: фильтруем его по выходной модальности.
  useEffect(() => {
    void loadLlmModels();
  }, [loadLlmModels]);

  const imageModels = filterModelsByOutput(llmModels, 'image-generation');
  const hasImageModels = imageModels.length > 0;

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
          value={hasImageModels ? (data.model || '') : ''}
          className="nodrag mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-400"
          onChange={() => undefined}
        >
          {hasImageModels ? (
            imageModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} ({model.provider})
              </option>
            ))
          ) : (
            <option value="">Нет доступных image-моделей</option>
          )}
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
