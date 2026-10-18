import { useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import {
  validateCollection,
  validateEmbeddingModel,
} from '@/lib/vector-memory-node-fields';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  EMBEDDING_MODELS,
  type VectorUpsertFlowNode,
} from '@/types/graph';

/** Классы текстового поля узла. */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Узел записи в векторную коллекцию (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Порты — из backend-контракта `src/engine/node-ports.ts`: вход `text-input`
 * (порт `prompt`), выход `vector-output` (порт `result`).
 *
 * Текст чанка берётся из входа (`prompt` или `contentField`), а если связи нет
 * — из textarea узла. Модель эмбеддингов фиксирована на `text-embedding-3-small`
 * (1536 измерений — размерность колонки `vector(1536)`).
 */
export function VectorUpsertNode({ id, data }: NodeProps<VectorUpsertFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: текст пишется в стор на каждый символ — сохраняем курсор.
  const handlePromptChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { prompt: value }),
      [id, updateNodeData],
    ),
  );
  const handleCollectionChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { collection: value }),
      [id, updateNodeData],
    ),
  );
  const handleContentFieldChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { contentField: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: textarea растёт по тексту вместо внутренней прокрутки.
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(promptRef, data.prompt ?? '');

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
        icon={NODE_REGISTRY.vector_upsert.icon}
        title={t(NODE_REGISTRY.vector_upsert.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-vector-upsert-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <select
          value={validateEmbeddingModel(data.embeddingModel)}
          aria-label={t('node.vector_upsert.embeddingModel')}
          data-vector-upsert-model=""
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={(event) =>
            updateNodeData(id, {
              embeddingModel: validateEmbeddingModel(event.target.value),
            })
          }
        >
          {EMBEDDING_MODELS.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={validateCollection(data.collection)}
          placeholder={t('node.vector_upsert.collection.placeholder')}
          aria-label={t('node.vector_upsert.collection')}
          data-vector-upsert-collection=""
          className={`${FIELD_CLASS} mt-2`}
          onChange={handleCollectionChange}
        />

        <input
          type="text"
          value={data.contentField ?? ''}
          placeholder={t('node.vector_upsert.contentField.placeholder')}
          aria-label={t('node.vector_upsert.contentField')}
          data-vector-upsert-content-field=""
          className={`${FIELD_CLASS} mt-2`}
          onChange={handleContentFieldChange}
        />

        <textarea
          ref={promptRef}
          rows={2}
          value={data.prompt ?? ''}
          placeholder={t('node.vector_upsert.prompt.placeholder')}
          aria-label={t('node.vector_upsert.prompt')}
          data-vector-upsert-prompt=""
          className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden`}
          onChange={handlePromptChange}
        />
      </BaseNode>

      <Handle
        type="source"
        id="vector-output"
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
