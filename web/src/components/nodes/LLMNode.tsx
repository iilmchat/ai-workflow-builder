import { useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode, type NodeBadge } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import {
  MAX_TOKENS_LIMIT,
  validateMaxTokensOverride,
  validateReasoningEffort,
} from '@/lib/llm-node-fields';
import { groupLlmModelsForSelect } from '@/lib/llm-models';
import { NODE_REGISTRY } from '@/lib/node-registry';
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
  const { t } = useTranslation();
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const llmModels = useWorkflowStore((state) => state.llmModels);
  const loadLlmModels = useWorkflowStore((state) => state.loadLlmModelsAsync);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: промпт пишется в хранилище на каждый символ — сохраняем курсор.
  const handlePromptChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { prompt: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: поле растёт по тексту (до 200px).
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(promptRef, data.prompt ?? '');

  // R6.3.2: system prompt — сворачиваемый блок (по умолчанию свёрнут, но у
  // загруженного workflow значение уже есть — тогда сразу раскрыт).
  const [isSystemOpen, setIsSystemOpen] = useState(
    (data.systemPrompt ?? '').length > 0,
  );

  // KI-157: system prompt пишется в стор на каждый символ — сохраняем курсор.
  const handleSystemChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { systemPrompt: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: поле растёт по тексту.
  const systemRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(systemRef, data.systemPrompt ?? '');

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
  // R6.3.2 (KI-193): переключатель режима показываем только моделям, которые
  // backend помечает как способные к reasoning.
  const supportsReasoning = selected?.supportsReasoning === true;
  // Подсказка лимита: дефолт модели (KI-183), иначе — общий текст i18n.
  const maxTokensPlaceholder =
    selected?.defaultMaxTokens === undefined
      ? t('node.llm.maxTokens.placeholder')
      : String(selected.defaultMaxTokens);

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
        title={t(NODE_REGISTRY.llm.labelKey)}
        executionLevel={executionLevel}
        status={status}
        badges={badgesForModel(selected)}
        onDelete={() => removeNode(id)}
      >
        <select
          value={data.model}
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

        {/* KI-180: промпт можно ввести прямо в узле — без связи от Text.
            Приоритет у связи (`inputs.prompt`), поле работает как fallback. */}
        <textarea
          ref={promptRef}
          rows={2}
          value={data.prompt ?? ''}
          placeholder={t('node.llm.placeholder')}
          className="nodrag mt-2 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handlePromptChange}
        />

        {/* R6.3.2 (KI-192): system prompt — по умолчанию свёрнут, чтобы не
            раздувать карточку. */}
        <button
          type="button"
          onClick={() => setIsSystemOpen((open) => !open)}
          aria-expanded={isSystemOpen}
          aria-label={
            isSystemOpen
              ? t('node.llm.system.hide')
              : t('node.llm.system.show')
          }
          data-system-toggle=""
          className="nodrag mt-2 flex w-full cursor-pointer items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden="true">{isSystemOpen ? '▼' : '▶'}</span>
          {t('node.llm.system.label')}
        </button>

        {isSystemOpen && (
          <textarea
            ref={systemRef}
            rows={2}
            value={data.systemPrompt ?? ''}
            placeholder={t('node.llm.system.placeholder')}
            data-system-prompt=""
            className="nodrag mt-1 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={handleSystemChange}
          />
        )}

        {/* R6.3.2 (KI-193): режим reasoning — только для моделей, которые его
            поддерживают (иначе backend всё равно проигнорирует поле). */}
        {supportsReasoning && (
          <select
            value={data.reasoningEffort ?? 'off'}
            aria-label={t('node.llm.reasoning.label')}
            data-reasoning=""
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, {
                reasoningEffort: validateReasoningEffort(event.target.value),
              })
            }
          >
            <option value="off">{t('node.llm.reasoning.off')}</option>
            <option value="medium">{t('node.llm.reasoning.medium')}</option>
            <option value="high">{t('node.llm.reasoning.high')}</option>
          </select>
        )}

        {/* R6.3.2 (KI-183): override лимита токенов ответа; пусто — дефолт
            модели (backend возьмёт `defaultMaxTokens`). */}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_TOKENS_LIMIT}
          value={data.maxTokensOverride ?? ''}
          placeholder={maxTokensPlaceholder}
          aria-label={t('node.llm.maxTokens.label')}
          data-max-tokens=""
          className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={(event) =>
            updateNodeData(id, {
              maxTokensOverride: validateMaxTokensOverride(
                event.target.value === ''
                  ? undefined
                  : Number(event.target.value),
              ),
            })
          }
        />

        <p
          className="mt-1.5 truncate text-[10px] text-muted-foreground"
          title={selected?.id ?? data.model}
        >
          {selected
            ? selected.provider
            : llmModels.length === 0
              ? t('node.llm.select.none')
              : t('node.llm.model_unavailable')}
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
