import { useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import { DATA_TYPE_COLORS, DATA_TYPE_LABELS, type OutputFlowNode } from '@/types/graph';

/**
 * Терминальный узел вывода (R6.5.2, DESIGN v0.8 § 8.3).
 *
 * Один вход (`text-input` из backend-контракта, порт `prompt`) и **ноль
 * выходов**: значение первого непустого входа подписывается именем из
 * `data.name` и попадает в `node_runs.outputs` (`executeOutputNode`).
 *
 * Source-хендл не рисуется сознательно: порт `result` объявлен в
 * `NODE_PORT_CONTRACT` фиктивно (KI-278), связь из терминального узла ничего не
 * даёт — зависимый узел всё равно прочитал бы `outputs.result`, которого нет.
 */
export function OutputNode({ id, data }: NodeProps<OutputFlowNode>) {
  // R6.4b.2b: правки поля проходят через историю графа (склейка по времени).
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: имя пишется в стор на каждый символ — сохраняем курсор.
  const handleNameChange = usePreserveCursor<HTMLInputElement>(
    useCallback((value: string) => updateNodeData(id, { name: value }), [id, updateNodeData]),
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
        icon={NODE_REGISTRY.output.icon}
        title={t(NODE_REGISTRY.output.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-output-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <input
          type="text"
          value={data.name}
          placeholder={t('node.output.name.placeholder')}
          aria-label={t('node.output.name')}
          data-output-name=""
          // nodrag: иначе протяжка мышью по полю тащит ноду.
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handleNameChange}
        />
      </BaseNode>
    </>
  );
}
