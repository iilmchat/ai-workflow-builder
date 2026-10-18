import { useCallback, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import { ExpiredMediaPlaceholder } from '@/components/ExpiredMediaPlaceholder';
import i18n from '@/i18n';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import { resolveMediaSource } from '@/lib/media-source';
import type { MediaModelInfo } from '@/types/media';
import { NODE_REGISTRY } from '@/lib/node-registry';
import { groupModelsByProvider } from '@/lib/media';
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
 * 1. `textarea` промпта — если он заполнен, он приоритетнее входа (KI-160);
 * 2. селект media-модели из `GET /media/models?type=IMAGE`;
 * 3. селект `aspect_ratio` — единственный параметр формы в MVP;
 * 4. результат генерации: `mediaUrl` из `nodeOutputs` либо плейсхолдер,
 *    «Генерация…» во время выполнения и «Ошибка генерации» при падении.
 */
export function ImageGenNode({ id, data }: NodeProps<ImageGenFlowNode>) {
  // R6.4b.2b: правки полей узла проходят через историю графа (склейка текста
  // по времени, селекты — отдельными шагами).
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  // Статус выполнения приходит из SSE-потока (R4.2).
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const mediaModels = useWorkflowStore((state) => state.mediaModels);
  const loadMediaModels = useWorkflowStore((state) => state.loadMediaModelsAsync);
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  // R7.7/R7.8: метрики узла несут свою ссылку на сохранённый результат.
  const nodeMetrics = useWorkflowStore((state) => state.nodeMetrics[id]);

  // Список моделей грузится лениво при появлении узла и кэшируется в сторе.
  useEffect(() => {
    void loadMediaModels();
  }, [loadMediaModels]);

  const prompt = data.prompt ?? '';

  // KI-157: промпт пишется в хранилище на каждый символ — сохраняем курсор.
  // KI-166: дублирование в `data.value` больше не нужно — backend читает
  // `data.prompt` (с fallback на `value` только для старых workflow).
  const handlePromptChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { prompt: value }), [id, updateNodeData]),
  );

  // KI-169: поле растёт по тексту промпта (до 200px).
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(promptRef, prompt);

  const selected = mediaModels.find((model) => model.id === data.model);
  // Модель, которой нет в каталоге (старое значение или провайдер отключён):
  // показываем как есть, но помечаем недоступной — молчаливой подмены нет.
  const isUnavailable = (data.model ?? '') !== '' && selected === undefined;

  // R7.8 (KI-362): своя ссылка (`storedUrl`) важнее ссылки провайдера; при
  // истёкшем TTL — плейсхолдер «ссылка истекла», а не битая картинка.
  const mediaSource = resolveMediaSource({
    outputs,
    storedUrl: nodeMetrics?.storedUrl ?? null,
    storedExpiresAt: nodeMetrics?.storedExpiresAt ?? null,
  });

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
  // R7.3: модели группируются по провайдеру — в селекте они видны как
  // `<optgroup label="Replicate">`. Порядок групп повторяет порядок каталога,
  // а он — приоритет провайдеров на backend (MEDIA_PROVIDER_PRIORITY).
  const modelGroups = groupModelsByProvider(mediaModels);

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
        status={status}
        onDelete={() => removeNode(id)}
      >
        {/* KI-160: промпт можно задать прямо в узле. Если поле пустое —
            используется вход от Text/LLM-узла (обратная совместимость). */}
        <textarea
          ref={promptRef}
          rows={1}
          value={prompt}
          placeholder={t('node.image.prompt_placeholder')}
          className="nodrag mb-2 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handlePromptChange}
        />

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

          {modelGroups.map((group) => (
            <optgroup
              key={group.provider}
              // Подпись — из i18n: у незнакомого провайдера показываем его
              // техническое имя как есть (молчаливой подмены нет, KI-069).
              label={t(`media.provider.${group.provider}`, {
                defaultValue: group.provider,
              })}
            >
              {group.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {/* У media-модели нет label: короткий `code` читабельнее id. */}
                  {model.code}
                </option>
              ))}
            </optgroup>
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
          ) : mediaSource.expired ? (
            <ExpiredMediaPlaceholder />
          ) : mediaSource.src !== null ? (
            <img
              src={mediaSource.src}
              alt={t('node.image.alt')}
              className="w-full rounded-lg border border-border"
            />
          ) : mediaSource.invalid ? (
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
