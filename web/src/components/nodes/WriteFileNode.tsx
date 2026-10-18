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
  type WriteFileFlowNode,
} from '@/types/graph';

/** Классы текстового поля узла (как у DocumentGen/LLM). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/** Формат записи (DESIGN v0.10 § 3.3.4). */
type WriteFormat = 'txt' | 'csv' | 'json';

/**
 * Читает `data.format` из jsonb.
 *
 * @param value - значение из `data.format` (`unknown`)
 * @returns известный формат либо `txt` (дефолт узла)
 */
function readFormat(value: unknown): WriteFormat {
  return value === 'csv' || value === 'json' ? value : 'txt';
}

/**
 * Читает `data.content` из jsonb.
 *
 * @param value - значение из `data.content` (`unknown`)
 * @returns текст контента (пустая строка, если значение не строка)
 */
function readContent(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Достаёт путь сохранения из выходов узла.
 *
 * @param outputs - выходы узла из стора
 * @param fallback - путь из `data.path`
 * @returns путь из `outputs.path` либо поле узла
 */
function readSavedPath(
  outputs: Record<string, unknown> | undefined,
  fallback: string,
): string {
  const value = outputs?.path;

  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Узел записи файла в workspace workflow (v0.10 S8, DESIGN v0.10 § 3.3).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt` — текст
 * для записи от Text/LLM) и выход `file-output` (порт `result` — `{ success,
 * path }`).
 *
 * Тело узла: поле пути (единственный источник пути — `data.path`, RULES 4.38),
 * селект формата, textarea контента (скрыта при входящей связи: исполнитель
 * берёт `inputs.text`/`inputs.prompt`) и статус сохранения после Run.
 */
export function WriteFileNode({ id, data }: NodeProps<WriteFileFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  // Входящая связь делает textarea ненужной: исполнитель берёт вход.
  const hasIncomingEdge = useWorkflowStore((state) =>
    state.edges.some((edge) => edge.target === id),
  );

  const path = typeof data.path === 'string' ? data.path : '';
  const format = readFormat(data.format);
  const content = readContent(data.content);
  const saved = outputs?.success === true;
  const savedPath = readSavedPath(outputs, path);

  const handlePathChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { path: value }),
      [id, updateNodeData],
    ),
  );
  const handleContentChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { content: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: textarea растёт по тексту.
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(contentRef, content);

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
        icon={NODE_REGISTRY.write_file.icon}
        title={t(NODE_REGISTRY.write_file.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-write-file-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
          {t('node.write_file.path')}
          <input
            type="text"
            value={path}
            placeholder={t('node.write_file.path.placeholder')}
            aria-label={t('node.write_file.path')}
            data-write-file-path=""
            className={FIELD_CLASS}
            onChange={handlePathChange}
          />
        </label>

        <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          {t('node.write_file.format')}
          <select
            value={format}
            aria-label={t('node.write_file.format')}
            data-write-file-format=""
            className="nodrag rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { format: readFormat(event.target.value) })
            }
          >
            <option value="txt">{t('node.write_file.format.txt')}</option>
            <option value="csv">{t('node.write_file.format.csv')}</option>
            <option value="json">{t('node.write_file.format.json')}</option>
          </select>
        </label>

        {hasIncomingEdge ? (
          <p
            className="mt-2 text-[9px] text-muted-foreground"
            data-write-file-connected=""
          >
            {t('node.write_file.connected')}
          </p>
        ) : (
          <textarea
            ref={contentRef}
            rows={3}
            value={content}
            placeholder={t('node.write_file.content.placeholder')}
            aria-label={t('node.write_file.content')}
            data-write-file-content=""
            className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden font-mono`}
            onChange={handleContentChange}
          />
        )}

        {saved ? (
          <p
            className="mt-2 text-[9px] text-green-700"
            data-write-file-saved=""
          >
            {t('node.write_file.saved', { path: savedPath })}
          </p>
        ) : status === 'running' ? (
          <p className="mt-2 text-[9px] text-muted-foreground" data-write-file-saving="">
            {t('node.write_file.saving')}
          </p>
        ) : status === 'failed' ? (
          <p className="mt-2 text-[9px] text-red-600" data-write-file-failed="">
            {t('node.write_file.failed')}
          </p>
        ) : (
          <p className="mt-1 text-[9px] text-muted-foreground">
            {t('node.write_file.hint')}
          </p>
        )}
      </BaseNode>

      <Handle
        type="source"
        id="file-output"
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
