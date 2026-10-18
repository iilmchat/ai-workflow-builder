import { useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type ReadFileFlowNode,
} from '@/types/graph';

/** Классы текстового поля узла (как у WebSearch/LLM). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/** Формат чтения; `auto` — по расширению (DESIGN v0.10 § 3.3.4). */
type ReadFormat = 'auto' | 'txt' | 'csv' | 'json';

/**
 * Сколько символов содержимого показывать в карточке.
 *
 * Файл может быть до 5 МБ: рендер такого текста в DOM повесил бы холст.
 * Полный текст доступен downstream-узлам через `nodeOutputs.text`, а превью
 * ограничено читаемым фрагментом.
 */
const PREVIEW_MAX_CHARS = 2_000;

/**
 * Читает `data.format` из jsonb.
 *
 * @param value - значение из `data.format` (`unknown`)
 * @returns известный формат либо `auto`
 */
function readFormat(value: unknown): ReadFormat {
  return value === 'txt' || value === 'csv' || value === 'json' ? value : 'auto';
}

/**
 * Достаёт текст результата чтения из `nodeOutputs`.
 *
 * @param outputs - выходы узла из стора (`undefined` — узел ещё не выполнялся)
 * @returns строку содержимого либо `null`
 */
function readOutputText(
  outputs: Record<string, unknown> | undefined,
): string | null {
  const value = outputs?.text;

  return typeof value === 'string' ? value : null;
}

/**
 * Узел чтения файла из workspace workflow (v0.10 S8, DESIGN v0.10 § 3.3).
 *
 * **Source-only (KI-456):** target-хендла нет. Путь читается только из
 * `data.path`; вход `prompt` дал бы LLM возможность подменить путь и вычитать
 * чужой файл (prompt injection / path traversal, RULES 4.38).
 *
 * Порты: выход `file-output` (порт `text` — содержимое файла для downstream).
 * Тело узла: поле пути, селект формата и превью результата после Run.
 */
export function ReadFileNode({ id, data }: NodeProps<ReadFileFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  const path = typeof data.path === 'string' ? data.path : '';
  const format = readFormat(data.format);
  const outputText = readOutputText(outputs);

  // KI-157: значение пишется в стор на каждый символ — сохраняем курсор.
  const handlePathChange = usePreserveCursor<HTMLInputElement>(
    useCallback(
      (value: string) => updateNodeData(id, { path: value }),
      [id, updateNodeData],
    ),
  );

  // Превью не должно раздувать DOM гигантским файлом (лимит сервиса — 5 МБ).
  const preview =
    outputText !== null && outputText.length > PREVIEW_MAX_CHARS
      ? `${outputText.slice(0, PREVIEW_MAX_CHARS)}…`
      : outputText;

  return (
    <>
      <BaseNode
        icon={NODE_REGISTRY.read_file.icon}
        title={t(NODE_REGISTRY.read_file.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-read-file-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
          {t('node.read_file.path')}
          <input
            type="text"
            value={path}
            placeholder={t('node.read_file.path.placeholder')}
            aria-label={t('node.read_file.path')}
            data-read-file-path=""
            className={FIELD_CLASS}
            onChange={handlePathChange}
          />
        </label>

        <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          {t('node.read_file.format')}
          <select
            value={format}
            aria-label={t('node.read_file.format')}
            data-read-file-format=""
            className="nodrag rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { format: readFormat(event.target.value) })
            }
          >
            <option value="auto">{t('node.read_file.format.auto')}</option>
            <option value="txt">{t('node.read_file.format.txt')}</option>
            <option value="csv">{t('node.read_file.format.csv')}</option>
            <option value="json">{t('node.read_file.format.json')}</option>
          </select>
        </label>

        {preview !== null ? (
          <div className="mt-2">
            <p className="text-[10px] text-muted-foreground">
              {t('node.read_file.result')}
            </p>
            <pre
              data-read-file-output=""
              className="nodrag mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-2 text-[10px] text-foreground"
            >
              {preview}
            </pre>
          </div>
        ) : (
          <p className="mt-2 text-[9px] text-muted-foreground">
            {t('node.read_file.empty')}
          </p>
        )}

        <p className="mt-1 text-[9px] text-muted-foreground">
          {t('node.read_file.hint')}
        </p>
      </BaseNode>

      <Handle
        type="source"
        id="file-output"
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
