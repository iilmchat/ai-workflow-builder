import { useCallback, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { NODE_REGISTRY } from '@/lib/node-registry';
import {
  parseMaxResultsInput,
  readWebSearchResults,
  validateMaxResults,
  validateQuery,
} from '@/lib/web-search-node-fields';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  DEFAULT_WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_MAX_RESULTS_LIMIT,
  type WebSearchFlowNode,
} from '@/types/graph';

/** Классы текстового поля узла (как у LLM/vector-узлов). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Узел веб-поиска (v0.10 S2, DESIGN v0.10 § 3.1).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt` —
 * запрос от Text/LLM-узла) и выход `search-output` (порт `text` — готовый
 * нумерованный список источников для следующего LLM-узла).
 *
 * Тело узла:
 * 1. `query` — fallback-запрос, если входящей связи нет;
 * 2. `maxResults` — 1…{@link WEB_SEARCH_MAX_RESULTS_LIMIT} (дефолт backend 5);
 * 3. результаты последнего запуска: иконка, заголовок-ссылка и сниппет.
 *
 * `rawContent` в выходах нет (KI-459), поэтому превью строится только по
 * `title`/`url`/`snippet`.
 */
export function WebSearchNode({ id, data }: NodeProps<WebSearchFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  const removeNode = useWorkflowStore((state) => state.removeNode);

  const results = readWebSearchResults(outputs);

  // KI-157: запрос пишется в стор на каждый символ — сохраняем курсор.
  const handleQueryChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback(
      (value: string) => updateNodeData(id, { query: value }),
      [id, updateNodeData],
    ),
  );

  // KI-169: textarea растёт по тексту.
  const queryRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(queryRef, validateQuery(data.query));

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
        icon={NODE_REGISTRY.web_search.icon}
        title={t(NODE_REGISTRY.web_search.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-web-search-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <label className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          {t('node.web_search.maxResults')}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={WEB_SEARCH_MAX_RESULTS_LIMIT}
            value={data.maxResults ?? ''}
            placeholder={String(DEFAULT_WEB_SEARCH_MAX_RESULTS)}
            aria-label={t('node.web_search.maxResults')}
            data-web-search-max-results=""
            className="nodrag w-16 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, {
                maxResults: validateMaxResults(
                  parseMaxResultsInput(event.target.value),
                ),
              })
            }
          />
        </label>

        <p className="mt-1 text-[9px] text-muted-foreground">
          {t('node.web_search.maxResultsHint')}
        </p>

        <textarea
          ref={queryRef}
          rows={2}
          value={validateQuery(data.query)}
          placeholder={t('node.web_search.query.placeholder')}
          aria-label={t('node.web_search.query')}
          data-web-search-query=""
          className={`${FIELD_CLASS} mt-2 resize-none overflow-hidden`}
          onChange={handleQueryChange}
        />

        {results.length > 0 ? (
          <div className="mt-2" data-web-search-results-list="">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('node.web_search.results', { count: results.length })}
            </p>

            <ul className="nowheel max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
              {results.map((result, index) => (
                <li
                  key={`${result.url}-${index}`}
                  className="flex gap-1.5"
                  data-web-search-result={result.url}
                >
                  <span className="shrink-0 text-[10px]" aria-hidden="true">
                    🔗
                  </span>

                  <div className="min-w-0">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      title={result.url}
                      className="nodrag block truncate text-[10px] font-medium text-blue-600 hover:underline"
                    >
                      {result.title.trim() || result.url}
                    </a>
                    <p className="line-clamp-2 text-[9px] leading-snug text-muted-foreground">
                      {result.snippet.trim()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : status === 'completed' ? (
          <p
            className="mt-2 text-[9px] text-muted-foreground"
            data-web-search-empty=""
          >
            {t('node.web_search.empty')}
          </p>
        ) : null}

        {results.length === 0 && status !== 'completed' && (
          <p className="mt-1 text-[9px] text-muted-foreground">
            {t('node.web_search.hint')}
          </p>
        )}
      </BaseNode>

      <Handle
        type="source"
        id="search-output"
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
