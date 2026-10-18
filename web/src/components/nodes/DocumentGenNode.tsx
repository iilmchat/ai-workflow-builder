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
  type DocumentGenFlowNode,
} from '@/types/graph';

/** Классы textarea узла (как у WebSearch/LLM). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Режим интерпретации контента (DESIGN v0.10 § 3.2.1).
 *
 * `format` узла (`docx`/`pdf`) в UI S6 не выбирается: backend реализует только
 * DOCX, а селект «Markdown/JSON» — это `source`, а не формат файла.
 */
type DocumentSource = 'markdown' | 'json';

/**
 * Читает `data.source` из jsonb.
 *
 * @param value - значение из `data.source` (`unknown`)
 * @returns `json` только при точном совпадении, иначе `markdown`
 */
function readSource(value: unknown): DocumentSource {
  return value === 'json' ? 'json' : 'markdown';
}

/**
 * Читает `data.content` из jsonb.
 *
 * @param value - значение из `data.content` (`unknown`)
 * @returns строка контента (пустая, если значение не строка)
 */
function readContent(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Достаёт ссылку на сохранённый документ из `nodeOutputs`.
 *
 * Порядок ключей: `storedUrl` (как у media-узлов) → `fileUrl` (порт
 * DESIGN § 3.2.5) → `url` (совместимость). Принимаются только `http(s)` и
 * относительные пути: `javascript:` из чужого/испорченного снимка не должен
 * стать кликабельной ссылкой (RULES 1.17).
 *
 * @param outputs - выходы узла из стора (`undefined` — узел ещё не выполнялся)
 * @returns безопасная ссылка либо `null`
 */
function readDocumentUrl(
  outputs: Record<string, unknown> | undefined,
): string | null {
  for (const key of ['storedUrl', 'fileUrl', 'url'] as const) {
    const value = outputs?.[key];

    if (
      typeof value === 'string' &&
      (value.startsWith('/') || /^https?:\/\//i.test(value))
    ) {
      return value;
    }
  }

  return null;
}

/**
 * Достаёт имя файла из выходов узла.
 *
 * @param outputs - выходы узла из стора
 * @returns имя без пути либо `undefined`
 */
function readFileName(
  outputs: Record<string, unknown> | undefined,
): string | undefined {
  const value = outputs?.fileName;

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  // `download` не должен получить путь: имя файла — последний сегмент.
  return value.split(/[\\/]/).at(-1);
}

/**
 * Узел генерации документа (v0.10 S6, DESIGN v0.10 § 3.2).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt` —
 * Markdown/JSON от Text/LLM) и выход `document-output` (порт `fileUrl` —
 * ссылка на сохранённый DOCX).
 *
 * Тело узла:
 * 1. селект источника (`Markdown`/`JSON`);
 * 2. textarea контента — только если входящей связи нет (иначе контент
 *    приходит по `inputs.prompt` и поле было бы мёртвым);
 * 3. ссылка «Скачать DOCX» после Run, если в `nodeOutputs` есть
 *    `storedUrl`/`fileUrl`.
 */
export function DocumentGenNode({ id, data }: NodeProps<DocumentGenFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  // Входящая связь делает textarea ненужной: исполнитель берёт `inputs.prompt`.
  const hasIncomingEdge = useWorkflowStore((state) =>
    state.edges.some((edge) => edge.target === id),
  );

  const source = readSource(data.source);
  const content = readContent(data.content);
  const downloadUrl = readDocumentUrl(outputs);
  const fileName = readFileName(outputs);

  // KI-157: контент пишется в стор на каждый символ — сохраняем курсор.
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
        icon={NODE_REGISTRY.document_gen.icon}
        title={t(NODE_REGISTRY.document_gen.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-document-gen-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          {t('node.document_gen.source')}
          <select
            value={source}
            aria-label={t('node.document_gen.source')}
            data-document-gen-source=""
            className="nodrag rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { source: readSource(event.target.value) })
            }
          >
            <option value="markdown">
              {t('node.document_gen.source.markdown')}
            </option>
            <option value="json">{t('node.document_gen.source.json')}</option>
          </select>
        </label>

        {hasIncomingEdge ? (
          <p
            className="mt-2 text-[9px] text-muted-foreground"
            data-document-gen-connected=""
          >
            {t('node.document_gen.connected')}
          </p>
        ) : (
          <textarea
            ref={contentRef}
            rows={3}
            value={content}
            placeholder={t(
              source === 'json'
                ? 'node.document_gen.content.placeholderJson'
                : 'node.document_gen.content.placeholder',
            )}
            aria-label={t('node.document_gen.content')}
            data-document-gen-content=""
            className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden font-mono`}
            onChange={handleContentChange}
          />
        )}

        {downloadUrl !== null ? (
          <a
            href={downloadUrl}
            download={fileName ?? 'document.docx'}
            target="_blank"
            rel="noreferrer"
            data-document-gen-download=""
            className="nodrag mt-2 inline-flex items-center gap-1 rounded-lg border border-green-300 bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 transition-colors hover:bg-green-100"
          >
            <span aria-hidden="true">⬇</span>
            {t('node.document_gen.download')}
          </a>
        ) : (
          <p className="mt-1 text-[9px] text-muted-foreground">
            {t('node.document_gen.hint')}
          </p>
        )}
      </BaseNode>

      <Handle
        type="source"
        id="document-output"
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
