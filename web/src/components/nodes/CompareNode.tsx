import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type CompareFlowNode,
} from '@/types/graph';

/**
 * Вертикальные позиции входных хендлов `a`/`b`, %.
 *
 * Разнесены от центра: два входа в одной точке не различить, а операнды у
 * узла равноправны (порядок задаёт только подпись).
 */
const A_HANDLE_TOP = '30%';
const B_HANDLE_TOP = '70%';

/**
 * Узел сравнения (R6.5.2, DESIGN v0.8 § 8.5).
 *
 * Два входа — `a` и `b` — и один выход `text-output`.
 *
 * Идентификаторы входов **ровно** `a`/`b`, а не `a-input`/`b-input`:
 * `compare` сознательно не имеет записи в `NODE_PORT_CONTRACT`, поэтому движок
 * берёт ключ входа из `edge.targetHandle` (fallback `targetHandle → sourceHandle
 * → edge.id`, KI-279), а `executeCompareNode` читает именно `inputs.a` /
 * `inputs.b`. Любое другое имя хендла потеряло бы оба операнда (KI-035).
 *
 * Режим в v0.8 один (`diff`) и показан неактивным селектом: `llm-judge` из
 * DESIGN § 8.5 требует доступа к LLM и вынесен в v0.8.x.
 */
export function CompareNode({ id, data }: NodeProps<CompareFlowNode>) {
  // Хук вызывается, хотя полей пока нет: селект режима станет редактируемым
  // вместе с `llm-judge`, и тогда история правок уже будет на месте.
  useNodeDataHistory();
  const { t } = useTranslation();
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  return (
    <>
      <Handle
        type="target"
        id="a"
        position={Position.Left}
        style={{ top: A_HANDLE_TOP, background: DATA_TYPE_COLORS.text }}
        className="h-2.5! w-2.5! border-2! border-white!"
      />
      <span
        className="pointer-events-none absolute -left-4 -translate-y-1/2 text-[9px] font-semibold"
        style={{ top: A_HANDLE_TOP, color: DATA_TYPE_COLORS.text }}
      >
        {t('node.compare.input.a')}
      </span>

      <Handle
        type="target"
        id="b"
        position={Position.Left}
        style={{ top: B_HANDLE_TOP, background: DATA_TYPE_COLORS.text }}
        className="h-2.5! w-2.5! border-2! border-white!"
      />
      <span
        className="pointer-events-none absolute -left-4 -translate-y-1/2 text-[9px] font-semibold"
        style={{ top: B_HANDLE_TOP, color: DATA_TYPE_COLORS.text }}
      >
        {t('node.compare.input.b')}
      </span>

      <BaseNode
        icon={NODE_REGISTRY.compare.icon}
        title={t(NODE_REGISTRY.compare.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-compare-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        {/* Режим — единственный доступный; `disabled` честно показывает, что
            выбора пока нет, вместо селекта с одним пунктом без пояснения. */}
        <select
          value={data.mode}
          disabled
          aria-label={t('node.compare.mode')}
          data-compare-mode=""
          className="nodrag w-full rounded-lg border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground outline-none disabled:cursor-not-allowed"
        >
          <option value="diff">{t('node.compare.mode.diff')}</option>
        </select>
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
