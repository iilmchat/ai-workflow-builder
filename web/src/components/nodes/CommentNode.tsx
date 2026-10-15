import { useCallback, useRef } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import type { CommentFlowNode } from '@/types/graph';

/**
 * Узел-комментарий: стикер на холсте (KI-187).
 *
 * Отличия от узлов данных:
 * - **нет `<Handle />`** — узел не участвует в потоке, связи к нему не ведут
 *   (`canBeInsertedOnEdge: false` в реестре, `addNodeOnEdge` его отклонит);
 * - **не уходит на backend** (`@/lib/graph-payload`): движок не знает типа
 *   `comment` и уронил бы запуск;
 * - фон — отдельная переменная темы (`--color-comment-bg`), чтобы стикер
 *   отличался от карточек данных и в светлой, и в тёмной теме.
 *
 * `BaseNode` намеренно не используется: у стикера нет статуса выполнения и
 * номера уровня, а его рамка/фон должны оставаться «бумажными» независимо от
 * прогона. Кнопка удаления — своя, с теми же `data`-атрибутами и `nodrag`.
 *
 * @param props - props узла React Flow (id и данные-комментарий)
 * @returns стикер с `<textarea>` либо `null`, если комментарии скрыты (`Shift+C`)
 */
export function CommentNode({ id, data }: NodeProps<CommentFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const { t } = useTranslation();
  const removeNode = useWorkflowStore((state) => state.removeNode);

  // KI-157: хранилище обновляется на каждый символ — без сохранения выделения
  // курсор после ре-рендера уезжал бы в конец текста.
  const handleTextChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { text: value }), [id, updateNodeData]),
  );

  // KI-169: поле растёт по тексту (до 200px) вместо прокрутки вслепую.
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(textareaRef, data.text);

  // KI-187: `Shift+C` скрывает все комментарии; `undefined` = «видим» —
  // граф, сохранённый до появления поля, не должен потерять стикеры.
  if (data.visible === false) {
    return null;
  }

  return (
    <div
      data-comment-node={id}
      // `data-[selected=true]` — рамка выбранного стикера; селектор ставит сам
      // React Flow на обёртку узла, подписка на `selectedNodeId` не нужна.
      className="group/comment relative w-56 rounded-lg border-2 border-[var(--color-comment-border)] px-2.5 py-2 shadow-node data-[selected=true]:border-primary"
      style={{ background: 'var(--color-comment-bg)' }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs" aria-hidden="true">
          {NODE_REGISTRY.comment.icon}
        </span>
        <span
          className="text-[10px] font-medium uppercase tracking-wide"
          style={{ color: 'var(--color-comment-foreground)' }}
        >
          {t(NODE_REGISTRY.comment.labelKey)}
        </span>

        <button
          type="button"
          onClick={() => removeNode(id)}
          aria-label={t('node.delete')}
          title={t('node.delete')}
          // nodrag: без этого клик по кнопке тащил бы узел.
          className="nodrag ml-auto cursor-pointer rounded px-1 text-xs leading-none text-muted-foreground opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover/comment:opacity-100"
        >
          ×
        </button>
      </div>

      <textarea
        ref={textareaRef}
        rows={3}
        value={data.text}
        placeholder={t('node.comment.placeholder')}
        aria-label={t('node.comment.label')}
        // nodrag: иначе протяжка мышью по textarea тащит стикер.
        // bg-transparent: цвет задаёт стикер, а не поле.
        // overflow-hidden: высоту задаёт хук (KI-169), не браузерная прокрутка.
        className="nodrag mt-1 w-full resize-none overflow-hidden rounded border border-transparent bg-transparent text-xs leading-snug outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        style={{ color: 'var(--color-comment-foreground)' }}
        onChange={handleTextChange}
      />
    </div>
  );
}
