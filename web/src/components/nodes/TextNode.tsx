import { useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
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
  // R6.4b.2b: правка поля проходит через историю графа (склейка по времени).
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: хранилище обновляется на каждый символ, поэтому без сохранения
  // выделения курсор после ре-рендера уезжал бы в конец текста.
  const handleValueChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { value }), [id, updateNodeData]),
  );

  // KI-169: поле растёт по тексту (до 200px), вместо прокрутки вслепую.
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(textareaRef, data.value);

  return (
    <>
      <BaseNode
        icon={NODE_REGISTRY.text.icon}
        title={t(NODE_REGISTRY.text.labelKey)}
        status={status}
        onDelete={() => removeNode(id)}
      >
        <textarea
          ref={textareaRef}
          rows={3}
          value={data.value}
          placeholder={t('node.text.placeholder')}
          // nodrag: иначе протяжка мышью по textarea тащит саму ноду.
          // overflow-hidden: высоту задаёт хук (KI-169), а не браузерная прокрутка.
          className="nodrag w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handleValueChange}
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
