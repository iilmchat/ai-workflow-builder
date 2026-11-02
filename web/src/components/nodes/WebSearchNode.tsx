import { useCallback, useEffect, useRef } from 'react';
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
  WEB_SEARCH_DEPTH_PROVIDERS,
  WEB_SEARCH_FRESHNESS_PROVIDERS,
  WEB_SEARCH_FRESHNESS_VALUES,
  WEB_SEARCH_MAX_RESULTS_LIMIT,
  WEB_SEARCH_PROVIDER_NAMES,
  type WebSearchFlowNode,
  type WebSearchFreshness,
  type WebSearchProviderName,
} from '@/types/graph';

/** Классы текстового поля узла (как у LLM/vector-узлов). */
const FIELD_CLASS =
  'nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary';

/** Классы селекта узла (как у DocumentGen). */
const SELECT_CLASS =
  'nodrag rounded-lg border border-border bg-background px-1.5 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary';

/**
 * Приводит строку из `<select>` к известному провайдеру.
 *
 * @param value - значение опции (`''` — «по умолчанию»)
 * @returns идентификатор провайдера либо `undefined`
 */
function readProvider(value: string): WebSearchProviderName | undefined {
  return WEB_SEARCH_PROVIDER_NAMES.find((name) => name === value);
}

/**
 * Приводит строку из `<select>` к глубине поиска.
 *
 * @param value - значение опции
 * @returns `basic`/`advanced`
 */
function readSearchDepth(value: string): 'basic' | 'advanced' {
  return value === 'advanced' ? 'advanced' : 'basic';
}

/**
 * Приводит строку из `<select>` к известному значению свежести.
 *
 * @param value - значение опции (`''` — «за всё время»)
 * @returns значение свежести либо `undefined`
 */
function readFreshness(value: string): WebSearchFreshness | undefined {
  return WEB_SEARCH_FRESHNESS_VALUES.find((item) => item === value);
}

/**
 * Узел веб-поиска (v0.10 S2, DESIGN v0.10 § 3.1; v0.15 S3 — провайдер/глубина).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` (порт `prompt` —
 * запрос от Text/LLM-узла) и выход `search-output` (порт `text` — готовый
 * нумерованный список источников для следующего LLM-узла).
 *
 * Тело узла:
 * 1. `query` — fallback-запрос, если входящей связи нет;
 * 2. `maxResults` — 1…{@link WEB_SEARCH_MAX_RESULTS_LIMIT} (дефолт backend 5);
 * 3. `provider` — только если сконфигурировано больше одного провайдера
 *    (список и дефолт — `GET /web-search/providers`, v0.15 S3);
 * 4. `searchDepth` — только для провайдеров из
 *    {@link WEB_SEARCH_DEPTH_PROVIDERS} (Tavily);
 * 5. результаты последнего запуска: иконка, заголовок-ссылка и сниппет.
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
  // v0.15 S3: конфигурация провайдеров общая для всех узлов — грузится один
  // раз на сессию и кэшируется в сторе (как `llmModels`/`mcpServers`).
  const webSearchProviders = useWorkflowStore(
    (state) => state.webSearchProviders,
  );
  const loadWebSearchProviders = useWorkflowStore(
    (state) => state.loadWebSearchProvidersAsync,
  );

  const results = readWebSearchResults(outputs);

  useEffect(() => {
    void loadWebSearchProviders();
  }, [loadWebSearchProviders]);

  const defaultProvider = webSearchProviders?.defaultProvider ?? 'tavily';
  // Провайдер конкретного узла важнее env-дефолта — ровно как на backend.
  const effectiveProvider: WebSearchProviderName =
    data.provider ?? defaultProvider;
  const configuredProviders =
    webSearchProviders?.providers.filter((provider) => provider.configured) ??
    [];
  // env-дефолт может быть не сконфигурирован (например, в .env остался
  // WEB_SEARCH_PROVIDER=tavily, а ключ задан только у Brave). В этом случае
  // селект нужен даже при одном доступном провайдере — иначе выбрать
  // работающего нельзя и каждый Run падает на дефолтном.
  const defaultConfigured =
    webSearchProviders === null ||
    configuredProviders.some((provider) => provider.name === defaultProvider);
  // Сохранённый в графе провайдер мог потерять ключ (KI-547): показываем его
  // disabled-опцией, чтобы селект не врал «По умолчанию».
  const savedUnavailable =
    webSearchProviders !== null &&
    data.provider !== undefined &&
    !configuredProviders.some((provider) => provider.name === data.provider);
  // Один доступный провайдер — настройка ни на что не влияет, поэтому селект
  // скрыт; исключения — неконфигурированный env-дефолт и stale-выбор (выше).
  const showProviderSelect =
    configuredProviders.length > 1 || savedUnavailable || !defaultConfigured;
  const showSearchDepth = WEB_SEARCH_DEPTH_PROVIDERS.includes(
    effectiveProvider,
  );
  const showFreshness = WEB_SEARCH_FRESHNESS_PROVIDERS.includes(
    effectiveProvider,
  );

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
        {showProviderSelect && (
          <label className="mb-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            {t('node.web_search.provider')}
            <select
              value={data.provider ?? ''}
              aria-label={t('node.web_search.provider')}
              data-web-search-provider=""
              className={SELECT_CLASS}
              onChange={(event) =>
                updateNodeData(id, {
                  provider: readProvider(event.target.value),
                })
              }
            >
              <option value="" disabled={!defaultConfigured}>
                {defaultConfigured
                  ? t('node.web_search.provider.default', {
                      provider: t(
                        `node.web_search.provider.${defaultProvider}`,
                      ),
                    })
                  : t('node.web_search.provider.defaultUnavailable', {
                      provider: t(
                        `node.web_search.provider.${defaultProvider}`,
                      ),
                    })}
              </option>
              {savedUnavailable && data.provider !== undefined && (
                <option value={data.provider} disabled>
                  {t('node.web_search.provider.unavailable', {
                    provider: t(`node.web_search.provider.${data.provider}`),
                  })}
                </option>
              )}
              {configuredProviders.map((provider) => (
                <option key={provider.name} value={provider.name}>
                  {t(`node.web_search.provider.${provider.name}`)}
                </option>
              ))}
            </select>
          </label>
        )}

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

        {showSearchDepth && (
          <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            {t('node.web_search.searchDepth')}
            <select
              value={data.searchDepth ?? 'basic'}
              aria-label={t('node.web_search.searchDepth')}
              data-web-search-depth=""
              className={SELECT_CLASS}
              onChange={(event) =>
                updateNodeData(id, {
                  searchDepth: readSearchDepth(event.target.value),
                })
              }
            >
              <option value="basic">
                {t('node.web_search.searchDepth.basic')}
              </option>
              <option value="advanced">
                {t('node.web_search.searchDepth.advanced')}
              </option>
            </select>
          </label>
        )}

        {showFreshness && (
          <label className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            {t('node.web_search.freshness')}
            <select
              value={data.freshness ?? ''}
              aria-label={t('node.web_search.freshness')}
              data-web-search-freshness=""
              className={SELECT_CLASS}
              onChange={(event) =>
                updateNodeData(id, {
                  freshness: readFreshness(event.target.value),
                })
              }
            >
              <option value="">{t('node.web_search.freshness.any')}</option>
              {WEB_SEARCH_FRESHNESS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {t(`node.web_search.freshness.${value}`)}
                </option>
              ))}
            </select>
          </label>
        )}

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
                      className="nodrag block truncate text-[10px] font-medium text-status-info-foreground hover:underline"
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
