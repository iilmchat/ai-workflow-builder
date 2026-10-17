import { useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { validateMemoryKey } from '@/lib/vector-memory-node-fields';
import { useWorkflowStore } from '@/stores/workflow';
import { DATA_TYPE_COLORS, DATA_TYPE_LABELS, type MemoryReadFlowNode } from '@/types/graph';

/**
 * Узел чтения памяти workflow (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt`; сам
 * исполнитель его не читает — ключ задан в узле, но значение используется как
 * источник для `memory_write`) и выход `memory-output` (порт `result`).
 *
 * Ключ не подменяется молча (KI-069): пустое поле честно роняет Run
 * валидацией backend (`key`: `min(1)`), а не читает «какой-нибудь» ключ.
 */
export function MemoryReadNode({ id, data }: NodeProps<MemoryReadFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: ключ пишется в стор на каждый символ — сохраняем курсор.
  const handleKeyChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { key: value }),
      [id, updateNodeData],
    ),
  );

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
        icon={NODE_REGISTRY.memory_read.icon}
        title={t(NODE_REGISTRY.memory_read.labelKey)}
        executionLevel={executionLevel}
        status={status}
        dataNodeAttr={{ name: 'data-memory-read-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <input
          type="text"
          value={validateMemoryKey(data.key)}
          placeholder={t('node.memory_read.key.placeholder')}
          aria-label={t('node.memory_read.key')}
          data-memory-read-key=""
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handleKeyChange}
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
