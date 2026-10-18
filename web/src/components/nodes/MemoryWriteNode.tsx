import { useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { validateMemoryKey } from '@/lib/vector-memory-node-fields';
import { useWorkflowStore } from '@/stores/workflow';
import { DATA_TYPE_COLORS, DATA_TYPE_LABELS, type MemoryWriteFlowNode } from '@/types/graph';

/** Классы текстового поля узла. */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Узел записи памяти workflow (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt` —
 * значение для записи, если не задан `valueField`) и выход `memory-output`
 * (порт `result`).
 *
 * Запись — UPSERT по `(workflow_id, key)`: повторный запуск обновляет значение,
 * а не плодит ключи. Значение из textarea сохраняется как JSON-строка.
 */
export function MemoryWriteNode({ id, data }: NodeProps<MemoryWriteFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: текст пишется в стор на каждый символ — сохраняем курсор.
  const handleKeyChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { key: value }),
      [id, updateNodeData],
    ),
  );
  const handleValueChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { value }),
      [id, updateNodeData],
    ),
  );
  const handleValueFieldChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { valueField: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: textarea растёт по тексту.
  const valueRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(valueRef, data.value ?? '');

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
        icon={NODE_REGISTRY.memory_write.icon}
        title={t(NODE_REGISTRY.memory_write.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-memory-write-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <input
          type="text"
          value={validateMemoryKey(data.key)}
          placeholder={t('node.memory_write.key.placeholder')}
          aria-label={t('node.memory_write.key')}
          data-memory-write-key=""
          className={FIELD_CLASS}
          onChange={handleKeyChange}
        />

        <input
          type="text"
          value={data.valueField ?? ''}
          placeholder={t('node.memory_write.valueField.placeholder')}
          aria-label={t('node.memory_write.valueField')}
          data-memory-write-value-field=""
          className={`${FIELD_CLASS} mt-2`}
          onChange={handleValueFieldChange}
        />

        <textarea
          ref={valueRef}
          rows={2}
          value={data.value ?? ''}
          placeholder={t('node.memory_write.value.placeholder')}
          aria-label={t('node.memory_write.value')}
          data-memory-write-value=""
          className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden`}
          onChange={handleValueChange}
        />
      </BaseNode>

      <Handle
        type="source"
        id="memory-output"
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
