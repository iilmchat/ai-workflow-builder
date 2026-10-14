import { useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import i18n from '@/i18n';
import {
  MediaNodeOutputsSchema,
  isRenderableMediaUrl,
  type MediaModelInfo,
} from '@/types/media';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type ImageGenFlowNode,
} from '@/types/graph';

/** Ключ параметра «соотношение сторон» в каталоге media (v0.6.0b.2.3). */
const ASPECT_RATIO_KEY = 'aspect_ratio';

/**
 * Форматирует цену модели для подписи под селектом.
 *
 * `priceInput` (например, за 1000 символов) показываем отдельно: у IMAGE-моделей
 * он обычно `null`, но у AUDIO/TTS-моделей тарификация идёт по входу.
 *
 * Подписи берём из глобального i18n: функция вызывается вне React, а `t` из
 * `useTranslation` здесь недоступен (вариант с передачей `t` параметром
 * усложнил бы сигнатуру ради двух строк).
 *
 * @param model - выбранная media-модель
 * @returns строка цены либо `null`, если тариф неизвестен
 */
function formatPrice(model: MediaModelInfo): string | null {
  const parts: string[] = [];

  if (model.priceUnit !== null) {
    parts.push(
      i18n.t('node.image.price_per_generation', { price: model.price }),
    );
  }

  if (model.priceInput !== null && model.priceInputUnit !== null) {
    parts.push(
      i18n.t('node.image.price_input', {
        price: model.priceInput,
        unit: model.priceInputUnit,
      }),
    );
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Узел генерации изображений (v0.6.0b.2.3).
 *
 * Вход — `text` (промпт), выход — `image` (зелёная метка G). Тело узла:
 * 1. селект media-модели из `GET /media/models?type=IMAGE`;
 * 2. селект `aspect_ratio` — единственный параметр формы в MVP;
 * 3. результат генерации: `mediaUrl` из `nodeOutputs` либо плейсхолдер,
 *    «Генерация…» во время выполнения и «Ошибка генерации» при падении.
 */
export function ImageGenNode({ id, data }: NodeProps<ImageGenFlowNode>) {
  const { updateNodeData } = useReactFlow();
  const { t } = useTranslation();
  // Уровень выполнения появляется после Run (/engine/plan).
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const mediaModels = useWorkflowStore((state) => state.mediaModels);
  const loadMediaModels = useWorkflowStore((state) => state.loadMediaModelsAsync);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);

  // Список моделей грузится лениво при появлении узла и кэшируется в сторе.
  useEffect(() => {
    void loadMediaModels();
  }, [loadMediaModels]);

  const selected = mediaModels.find((model) => model.id === data.model);
  // Модель, которой нет в каталоге (старое значение или провайдер отключён):
  // показываем как есть, но помечаем недоступной — молчаливой подмены нет.
  const isUnavailable = (data.model ?? '') !== '' && selected === undefined;

  // Outputs приходят из SSE как `unknown`-записи — валидируем на границе.
  const parsedOutputs = outputs ? MediaNodeOutputsSchema.safeParse(outputs) : null;
  const mediaUrl =
    parsedOutputs !== null && parsedOutputs.success
      ? parsedOutputs.data.mediaUrl
      : null;
  // KI-006: ссылку от внешнего провайдера подставляем только с http(s).
  const safeMediaUrl =
    mediaUrl !== null && isRenderableMediaUrl(mediaUrl) ? mediaUrl : null;
  const isInvalidUrl = mediaUrl !== null && safeMediaUrl === null;

  const aspectRatioParam = selected?.params.find(
    (param) => param.key === ASPECT_RATIO_KEY,
  );
  const aspectRatioValue =
    data.aspectRatio ??
    (typeof aspectRatioParam?.default === 'string'
      ? aspectRatioParam.default
      : (aspectRatioParam?.options?.[0]?.value?.toString() ?? ''));
  const price = selected ? formatPrice(selected) : null;
  const hasModels = mediaModels.length > 0;

  return (
    <>
      <Handle
        type="target"
        id="text-input"
        position={Position.Left}
        className="h-2.5! w-2.5! border-2! border-white!"
        style={{ background: DATA_TYPE_COLORS.text }}
      />

      <BaseNode
        icon={NODE_REGISTRY.image_generation.icon}
        title={t(NODE_REGISTRY.image_generation.labelKey)}
        executionLevel={executionLevel}
        status={status}
      >
        <select
          value={data.model ?? ''}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-muted-foreground"
          disabled={!hasModels && !isUnavailable}
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {!hasModels && !isUnavailable && (
            <option value="">{t('node.image.select.none')}</option>
          )}

          {(data.model ?? '') === '' && hasModels && (
            <option value="" disabled>
              {t('node.image.select.choose')}
            </option>
          )}

          {isUnavailable && (
            <option value={data.model} disabled>
              {t('node.image.unavailable', { model: data.model })}
            </option>
          )}

          {mediaModels.map((model) => (
            <option key={model.id} value={model.id}>
              {/* У media-модели нет label: короткий `code` читабельнее id. */}
              {model.code}
            </option>
          ))}
        </select>

        {price !== null && (
          <p className="mt-1 truncate text-[10px] text-muted-foreground" title={price}>
            {price}
          </p>
        )}

        {aspectRatioParam?.options !== undefined && (
          <select
            value={aspectRatioValue}
            aria-label={t('node.image.aspect_ratio')}
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { aspectRatio: event.target.value })
            }
          >
            {aspectRatioParam.options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {String(option.value)}
              </option>
            ))}
          </select>
        )}

        <div className="mt-2">
          {status === 'running' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50 px-2 text-center text-[10px] text-blue-600">
              {t('node.image.generating')}
            </div>
          ) : status === 'failed' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-[10px] text-red-600">
              {t('node.image.error')}
            </div>
          ) : safeMediaUrl !== null ? (
            <img
              src={safeMediaUrl}
              alt={t('node.image.alt')}
              className="w-full rounded-lg border border-border"
            />
          ) : isInvalidUrl ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-amber-300 px-2 text-center text-[10px] text-amber-600">
              {t('node.image.invalid_url')}
            </div>
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[10px] text-muted-foreground">
              {t('node.image.placeholder')}
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
