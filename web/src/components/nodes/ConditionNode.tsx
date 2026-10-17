import { useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import {
  CONDITION_MODES,
  CONDITION_OPERATORS,
  validateConditionMode,
  validateConditionOperator,
} from '@/lib/condition-node-fields';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type ConditionFlowNode,
} from '@/types/graph';

/**
 * Вертикальные позиции двух выходных хендлов, %.
 *
 * Разнесены от центра: два порта в одной точке визуально сливались бы, и
 * пользователь не понял бы, что ветки разные.
 */
const TRUE_HANDLE_TOP = '30%';
const FALSE_HANDLE_TOP = '70%';

/**
 * Узел условия (R6.5.2, DESIGN v0.8 § 8.2; R7.5 — режим sandbox).
 *
 * Вход — `condition-input` из backend-контракта (`src/engine/node-ports.ts`,
 * R6.5.1), нормализуется в порт `input`. Выходов визуально **два**
 * (`true-output` / `false-output`, подписи T/F), но маршрутизации веток в v0.8
 * нет: исполнитель отдаёт один результат `{ result, evaluated }`, и обе ветки
 * продолжают выполняться. Оба хендла не описаны в контракте, поэтому движок
 * выводит порт из типа узла (`inferDefaultOutputPort('condition')` → `result`) —
 * то есть обе ветки читаются зависимыми узлами одинаково (KI-278).
 *
 * Два режима (R7.5, KI-364):
 * - `dsl` (default) — MVP-DSL `left`/`operator`/`right` (DESIGN § 8.2):
 *   `input.X`, число, `true`/`false` или строка в кавычках;
 * - `sandbox` — произвольное JS-выражение, которое сервер исполняет в
 *   QuickJS-WASM. Предупреждение в карточке честно говорит, что режим должен
 *   быть включён администратором (`SANDBOX_ENABLED`).
 */
export function ConditionNode({ id, data }: NodeProps<ConditionFlowNode>) {
  // R6.4b.2b: правки полей узла проходят через историю графа.
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // Неизвестное значение из старого/битого графа → DSL (backward compat).
  const mode = validateConditionMode(data.mode);

  // KI-157: операнды пишутся в стор на каждый символ — сохраняем курсор.
  const handleLeftChange = usePreserveCursor<HTMLInputElement>(
    useCallback((value: string) => updateNodeData(id, { left: value }), [id, updateNodeData]),
  );
  const handleRightChange = usePreserveCursor<HTMLInputElement>(
    useCallback((value: string) => updateNodeData(id, { right: value }), [id, updateNodeData]),
  );
  const handleExpressionChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { expression: value }),
      [id, updateNodeData],
    ),
  );

  return (
    <>
      <Handle
        type="target"
        id="condition-input"
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
        icon={NODE_REGISTRY.condition.icon}
        title={t(NODE_REGISTRY.condition.labelKey)}
        executionLevel={executionLevel}
        status={status}
        dataNodeAttr={{ name: 'data-condition-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <div className="flex flex-col gap-1.5">
          {/* R7.5 (KI-364): выбор режима. В sandbox выражение исполняет сервер. */}
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t('node.condition.mode')}
            </span>
            <select
              value={mode}
              aria-label={t('node.condition.mode')}
              data-condition-mode=""
              className="nodrag min-w-0 flex-1 rounded-lg border border-border bg-background px-1 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              onChange={(event) =>
                updateNodeData(id, { mode: validateConditionMode(event.target.value) })
              }
            >
              {CONDITION_MODES.map((conditionMode) => (
                <option key={conditionMode} value={conditionMode}>
                  {t(`node.condition.mode.${conditionMode}`)}
                </option>
              ))}
            </select>
          </div>

          {mode === 'dsl' ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={data.left}
                placeholder={t('node.condition.left.placeholder')}
                aria-label={t('node.condition.left')}
                data-condition-left=""
                // nodrag: иначе протяжка мышью по полю тащит ноду.
                className="nodrag min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                onChange={handleLeftChange}
              />

              <select
                value={data.operator}
                aria-label={t('node.condition.operator')}
                data-condition-operator=""
                className="nodrag w-20 rounded-lg border border-border bg-background px-1 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                onChange={(event) =>
                  updateNodeData(id, {
                    operator: validateConditionOperator(event.target.value),
                  })
                }
              >
                {CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={data.right}
                placeholder={t('node.condition.right.placeholder')}
                aria-label={t('node.condition.right')}
                data-condition-right=""
                className="nodrag min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                onChange={handleRightChange}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={data.expression ?? ''}
                placeholder={t('node.condition.expression.placeholder')}
                aria-label={t('node.condition.expression')}
                data-condition-expression=""
                className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                onChange={handleExpressionChange}
              />
              <p className="text-[10px] leading-tight text-muted-foreground">
                {t('node.condition.mode.sandbox_warning')}
              </p>
            </div>
          )}
        </div>
      </BaseNode>

      {/* KI-278: два визуальных выхода, один порт `result` в outputs. */}
      <Handle
        type="source"
        id="true-output"
        position={Position.Right}
        style={{ top: TRUE_HANDLE_TOP, background: DATA_TYPE_COLORS.generic }}
        className="h-2.5! w-2.5! border-2! border-white!"
      />
      <span
        className="pointer-events-none absolute -right-4 -translate-y-1/2 text-[9px] font-semibold"
        style={{ top: TRUE_HANDLE_TOP, color: DATA_TYPE_COLORS.generic }}
      >
        {t('node.condition.branch.true')}
      </span>

      <Handle
        type="source"
        id="false-output"
        position={Position.Right}
        style={{ top: FALSE_HANDLE_TOP, background: DATA_TYPE_COLORS.generic }}
        className="h-2.5! w-2.5! border-2! border-white!"
      />
      <span
        className="pointer-events-none absolute -right-4 -translate-y-1/2 text-[9px] font-semibold"
        style={{ top: FALSE_HANDLE_TOP, color: DATA_TYPE_COLORS.generic }}
      >
        {t('node.condition.branch.false')}
      </span>
    </>
  );
}
