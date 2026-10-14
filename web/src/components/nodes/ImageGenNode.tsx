import { useEffect } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { BaseNode } from '@/components/nodes/BaseNode';
import {
  MediaNodeOutputsSchema,
  isRenderableMediaUrl,
  type MediaModelInfo,
} from '@/types/media';
import { NODE_TYPE_ICONS, NODE_TYPE_LABELS } from '@/lib/node-registry';
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
 * @param model - выбранная media-модель
 * @returns строка цены либо `null`, если тариф неизвестен
 */
function formatPrice(model: MediaModelInfo): string | null {
  const parts: string[] = [];

  if (model.priceUnit !== null) {
    parts.push(`от ${model.price} ₽ / генерация`);
  }

  if (model.priceInput !== null && model.priceInputUnit !== null) {
    parts.push(`вход: ${model.priceInput} ₽ / ${model.priceInputUnit}`);
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
        icon={NODE_TYPE_ICONS.image_generation}
        title={NODE_TYPE_LABELS.image_generation}
        executionLevel={executionLevel}
        status={status}
      >
        <select
          value={data.model ?? ''}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-300 disabled:bg-slate-50 disabled:text-slate-400"
          disabled={!hasModels && !isUnavailable}
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {!hasModels && !isUnavailable && (
            <option value="">Нет доступных image-моделей</option>
          )}

          {(data.model ?? '') === '' && hasModels && (
            <option value="" disabled>
              Выберите модель
            </option>
          )}

          {isUnavailable && (
            <option value={data.model} disabled>
              {data.model} (недоступно)
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
          <p className="mt-1 truncate text-[10px] text-slate-400" title={price}>
            {price}
          </p>
        )}

        {aspectRatioParam?.options !== undefined && (
          <select
            value={aspectRatioValue}
            aria-label="Соотношение сторон"
            className="nodrag mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-slate-300"
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
              Генерация…
            </div>
          ) : status === 'failed' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-[10px] text-red-600">
              Ошибка генерации
            </div>
          ) : safeMediaUrl !== null ? (
            <img
              src={safeMediaUrl}
              alt="Сгенерированное изображение"
              className="w-full rounded-lg border border-slate-200"
            />
          ) : isInvalidUrl ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-amber-300 px-2 text-center text-[10px] text-amber-600">
              Некорректный URL результата
            </div>
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 px-2 text-center text-[10px] text-slate-400">
              Здесь появится результат
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
