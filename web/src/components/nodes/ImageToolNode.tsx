import { useCallback, useEffect } from 'react';
import { Handle, Position, type Edge, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import i18n from '@/i18n';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import {
  ImageToolOutputsSchema,
  isRenderableMediaUrl,
  type MediaModelInfo,
} from '@/types/media';
import { inputUrlFromOutputs, pickInputPreviewUrl } from '@/lib/image-tool-node';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  IMAGE_TOOL_OPERATIONS,
  type ImageToolFlowNode,
  type ImageToolOperation,
} from '@/types/graph';

/**
 * Форматирует цену модели-инструмента для подписи под селектом.
 *
 * @param model - выбранная модель каталога
 * @returns строка «10 ₽ за генерацию» либо `null`, если тариф неизвестен
 */
function formatToolPrice(model: MediaModelInfo): string | null {
  return model.priceUnit !== null
    ? i18n.t('node.image.price_per_generation', { price: model.price })
    : null;
}

/**
 * Узел media-инструмента (R7.1, KI-196, DESIGN v0.9 § 3.1).
 *
 * Вход — файл (ссылка от `image_generation` или другого источника), выход —
 * `resultUrls` (список ссылок). Тело узла:
 * 1. селект операции — 5 значений DESIGN (`upscale`, `bg_removal`,
 *    `chromakey`, `trim`, `lipsync`);
 * 2. селект модели-инструмента: `GET /media/models?type=TOOL`, а если каталог
 *    такого типа не отдаёт (реальность R7.1) — модели с обязательным входным
 *    файлом (`lib/media.pickToolModels`);
 * 3. preview входа — миниатюра ссылки из входов/`data.inputUrl`;
 * 4. результат — `<img>` с URL-ом из `nodeOutputs`, «Выполняется…» и «Ошибка».
 */
export function ImageToolNode({ id, data }: NodeProps<ImageToolFlowNode>) {
  // R6.4b.2b: правки полей узла проходят через историю графа.
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const toolModels = useWorkflowStore((state) => state.toolModels);
  const loadToolModels = useWorkflowStore((state) => state.loadToolModelsAsync);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  const edges = useWorkflowStore((state) => state.edges);
  const nodeOutputs = useWorkflowStore((state) => state.nodeOutputs);

  // Список моделей-инструментов грузится лениво при появлении узла (как у
  // Image Generation) и кэшируется в сторе.
  useEffect(() => {
    void loadToolModels();
  }, [loadToolModels]);

  const operation = data.operation;

  const handleOperationChange = useCallback(
    (value: string) => {
      const next = IMAGE_TOOL_OPERATIONS.find((candidate) => candidate === value);

      if (next !== undefined) {
        updateNodeData(id, { operation: next });
      }
    },
    [id, updateNodeData],
  );

  // Preview входа: берём outputs первого входящего узла, у которого есть ссылка
  // на файл. `data.inputUrl` — фолбэк, когда связи ещё нет.
  const incoming: Edge[] = edges.filter((edge) => edge.target === id);
  const previewUrl = pickInputPreviewUrl(
    incoming.map((edge) => inputUrlFromOutputs(nodeOutputs[edge.source])),
    data.inputUrl,
  );

  // Выходы приходят из SSE как `unknown`-записи — валидируем на границе.
  const parsedOutputs = outputs ? ImageToolOutputsSchema.safeParse(outputs) : null;
  const rawResultUrl =
    parsedOutputs !== null && parsedOutputs.success
      ? (parsedOutputs.data.resultUrls[0] ?? null)
      : null;
  const resultUrl =
    rawResultUrl !== null && isRenderableMediaUrl(rawResultUrl)
      ? rawResultUrl
      : null;
  const isInvalidUrl = rawResultUrl !== null && resultUrl === null;

  const selected = toolModels.find((model) => model.id === data.model);
  // Модель, которой нет в каталоге (старое значение или провайдер отключён):
  // показываем как есть, но помечаем недоступной — молчаливой подмены нет.
  const isUnavailable = (data.model ?? '') !== '' && selected === undefined;
  const price = selected ? formatToolPrice(selected) : null;
  const hasModels = toolModels.length > 0;

  return (
    <>
      <Handle
        type="target"
        id="image-input"
        position={Position.Left}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.image }}
      />

      <BaseNode
        icon={NODE_REGISTRY.image_tool.icon}
        title={t(NODE_REGISTRY.image_tool.labelKey)}
        executionLevel={executionLevel}
        status={status}
        dataNodeAttr={{ name: 'data-image-tool-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <select
          value={operation}
          aria-label={t('node.image_tool.operation')}
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={(event) => handleOperationChange(event.target.value)}
        >
          {IMAGE_TOOL_OPERATIONS.map((candidate: ImageToolOperation) => (
            <option key={candidate} value={candidate}>
              {t(`node.image_tool.operation.${candidate}`)}
            </option>
          ))}
        </select>

        <select
          value={data.model ?? ''}
          aria-label={t('node.image_tool.model')}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-muted-foreground"
          disabled={!hasModels && !isUnavailable}
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {!hasModels && !isUnavailable && (
            <option value="">{t('node.image_tool.select.none')}</option>
          )}

          {(data.model ?? '') === '' && hasModels && (
            <option value="" disabled>
              {t('node.image_tool.select.choose')}
            </option>
          )}

          {isUnavailable && (
            <option value={data.model} disabled>
              {t('node.image.unavailable', { model: data.model })}
            </option>
          )}

          {toolModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.code}
            </option>
          ))}
        </select>

        {price !== null && (
          <p className="mt-1 truncate text-[10px] text-muted-foreground" title={price}>
            {price}
          </p>
        )}

        {previewUrl !== null ? (
          <div className="mt-2">
            <p className="mb-1 text-[10px] text-muted-foreground">
              {t('node.image_tool.input.title')}
            </p>
            <img
              src={previewUrl}
              alt={t('node.image_tool.input.alt')}
              className="max-h-24 w-full rounded-lg border border-border object-contain"
            />
          </div>
        ) : (
          <div className="mt-2 flex min-h-12 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[10px] text-muted-foreground">
            {t('node.image_tool.input.none')}
          </div>
        )}

        <div className="mt-2">
          {status === 'running' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50 px-2 text-center text-[10px] text-blue-600">
              {t('node.image_tool.applying')}
            </div>
          ) : status === 'failed' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-[10px] text-red-600">
              {t('node.image_tool.error')}
            </div>
          ) : resultUrl !== null ? (
            <img
              src={resultUrl}
              alt={t('node.image_tool.alt')}
              className="w-full rounded-lg border border-border"
            />
          ) : isInvalidUrl ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-amber-300 px-2 text-center text-[10px] text-amber-600">
              {t('node.image.invalid_url')}
            </div>
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[10px] text-muted-foreground">
              {t('node.image_tool.placeholder')}
            </div>
          )}
        </div>
      </BaseNode>

      <Handle
        type="source"
        id="image-output"
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
