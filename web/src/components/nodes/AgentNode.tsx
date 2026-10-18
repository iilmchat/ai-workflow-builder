import { useCallback, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import {
  parseAgentNumberInput,
  toggleAgentTool,
  validateAgentTools,
  validateMaxIterations,
} from '@/lib/agent-node-fields';
import { groupLlmModelsForSelect } from '@/lib/llm-models';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  AGENT_MAX_ITERATIONS_LIMIT,
  AGENT_MIN_ITERATIONS,
  AGENT_TOOLS,
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  DEFAULT_AGENT_MAX_ITERATIONS,
  type AgentFlowNode,
} from '@/types/graph';

/** Классы текстового поля узла (как у LLM/vector-узлов). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Узел агента (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Конфигурация цикла: модель, системная инструкция, инструменты и предел
 * итераций. Сам цикл (LLM → tool → … → final) исполняет backend `AgentService`;
 * узел лишь собирает `data`, поэтому здесь нет ни вызовов сети, ни состояния
 * прогона.
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` → порт `prompt`
 * (текст задачи), выход `result-output` → порт `result` (финальный ответ).
 * Выходной хендл — `result-output`, а не `text-output`: последний переводится
 * в порт `text` (KI-301) и не подошёл бы узлу с `outputs.result`.
 *
 * Инструменты — чекбоксы по списку {@link AGENT_TOOLS}; снять последний
 * нельзя (`toggleAgentTool`), иначе backend отвергнет `data` валидацией.
 */
export function AgentNode({ id, data }: NodeProps<AgentFlowNode>) {
  // R6.4b.2b: правки полей идут через историю графа.
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const llmModels = useWorkflowStore((state) => state.llmModels);
  const loadLlmModels = useWorkflowStore((state) => state.loadLlmModelsAsync);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // Список моделей общий с LLM-узлом: грузится один раз на сессию и
  // кэшируется в сторе (R4.1b).
  useEffect(() => {
    void loadLlmModels();
  }, [loadLlmModels]);

  const selected = llmModels.find((model) => model.id === data.model);
  // Модель не подменяем (KI-069): неизвестный id показывается как недоступный.
  const isUnavailable = data.model !== '' && selected === undefined;
  const groups = groupLlmModelsForSelect(llmModels);
  const tools = validateAgentTools(data.tools);

  // KI-157: текст пишется в стор на каждый символ — сохраняем курсор.
  const handleSystemChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { systemPrompt: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: системная инструкция растёт по тексту.
  const systemRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(systemRef, data.systemPrompt ?? '');

  return (
    <>
      <Handle
        type="target"
        id="text-input"
        position={Position.Left}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />
      <span
        className="pointer-events-none absolute -left-4 top-1/2 -translate-y-1/2 text-[9px] font-semibold"
        style={{ color: DATA_TYPE_COLORS.text }}
      >
        {DATA_TYPE_LABELS.text}
      </span>

      <BaseNode
        icon={NODE_REGISTRY.agent.icon}
        title={t(NODE_REGISTRY.agent.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-agent-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <select
          value={data.model}
          aria-label={t('node.agent.model')}
          data-agent-model=""
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {data.model === '' && (
            <option value="" disabled>
              {llmModels.length === 0
                ? t('node.llm.select.none')
                : t('node.llm.select.choose')}
            </option>
          )}

          {isUnavailable && (
            <option value={data.model} disabled>
              {t('node.llm.unavailable', { model: data.model })}
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

        <textarea
          ref={systemRef}
          rows={2}
          value={data.systemPrompt ?? ''}
          placeholder={t('node.agent.systemPrompt.placeholder')}
          aria-label={t('node.agent.systemPrompt')}
          data-agent-system-prompt=""
          className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden`}
          onChange={handleSystemChange}
        />

        <fieldset className="mt-2" data-agent-tools="">
          <legend className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('node.agent.tools', { count: tools.length })}
          </legend>

          <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
            {AGENT_TOOLS.map((name) => (
              <label
                key={name}
                className="nodrag flex cursor-pointer items-center gap-1 text-[10px] text-foreground"
              >
                <input
                  type="checkbox"
                  checked={tools.includes(name)}
                  data-agent-tool={name}
                  onChange={() =>
                    updateNodeData(id, { tools: toggleAgentTool(tools, name) })
                  }
                />
                <span className="truncate">{t(`tools.${name}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <input
          type="number"
          inputMode="numeric"
          min={AGENT_MIN_ITERATIONS}
          max={AGENT_MAX_ITERATIONS_LIMIT}
          value={data.maxIterations ?? ''}
          placeholder={String(DEFAULT_AGENT_MAX_ITERATIONS)}
          aria-label={t('node.agent.maxIterations')}
          data-agent-iterations=""
          className={`${FIELD_CLASS} mt-2`}
          onChange={(event) =>
            updateNodeData(id, {
              maxIterations: validateMaxIterations(
                parseAgentNumberInput(event.target.value),
              ),
            })
          }
        />

        <p className="mt-1 text-[9px] text-muted-foreground">
          {t('node.agent.hint')}
        </p>
      </BaseNode>

      <Handle
        type="source"
        id="result-output"
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
