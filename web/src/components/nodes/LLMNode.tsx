import { useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { BaseNode, type NodeBadge } from '@/components/nodes/BaseNode';
import { groupLlmModelsForSelect } from '@/lib/llm-models';
import { NODE_REGISTRY, tLabel } from '@/lib/node-registry';
import type { LlmModelInfo } from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type LlmFlowNode,
} from '@/types/graph';

/**
 * Бейджи возможностей модели (v0.6.0a).
 *
 * Классы — литералы: Tailwind v4 ищет их сканированием исходников, поэтому
 * динамическая склейка имён не сработала бы.
 */
const BADGE_VISION: NodeBadge = {
  text: 'V',
  className: 'bg-purple-100 text-purple-700',
};
const BADGE_IMAGE_OUT: NodeBadge = {
  text: 'IMG',
  className: 'bg-emerald-100 text-emerald-700',
};

/**
 * Собирает бейджи для выбранной модели.
 *
 * @param model - выбранная модель либо `undefined`, если её нет в списке
 * @returns бейджи для карточки; пустой массив, если модель текстовая
 */
function badgesForModel(model: LlmModelInfo | undefined): NodeBadge[] {
  if (!model) {
    return [];
  }

  const badges: NodeBadge[] = [];

  if (model.inputModalities.includes('vision')) {
    badges.push(BADGE_VISION);
  }

  if (model.outputModalities.includes('image-generation')) {
    badges.push(BADGE_IMAGE_OUT);
  }

  return badges;
}

/**
 * Узел вызова языковой модели.
 *
 * Вход и выход — типизированные порты `text` (синие). Список моделей берётся с
 * backend (`GET /llm/models`, R4.1b) и кэшируется в сторе: в `data.model`
 * хранится **id** модели (`claude-sonnet-4-20250514`), а в селекте показывается
 * её человекочитаемый label (KI-069).
 *
 * Селект группируется по возможностям (v0.6.0a): «Текст» и «Текст + Vision»,
 * чтобы vision-модель не выбирали для чисто текстовой задачи.
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
  const groups = groupLlmModelsForSelect(llmModels);

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
        icon={NODE_REGISTRY.llm.icon}
        title={tLabel(NODE_REGISTRY.llm.labelKey)}
        executionLevel={executionLevel}
        status={status}
        badges={badgesForModel(selected)}
      >
        <select
          value={data.model}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-border"
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

          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} ({model.provider})
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <p
          className="mt-1.5 truncate text-[10px] text-muted-foreground"
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
