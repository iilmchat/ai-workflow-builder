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
import {
  GENERATION_MEDIA_TYPE_BY_NODE,
  paramOptions,
  paramSelectValue,
  parseNumberField,
  pickDeclaredParam,
} from '@/lib/generation-node';
import { groupModelsByProvider } from '@/lib/media';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type VideoGenFlowNode,
} from '@/types/graph';

/** Ключ параметра длительности в каталоге media. */
const DURATION_KEY = 'duration';
/** Ключ параметра «соотношение сторон» в каталоге media. */
const ASPECT_RATIO_KEY = 'aspect_ratio';

/**
 * Форматирует цену модели для подписи под селектом.
 *
 * @param model - выбранная media-модель
 * @returns строка цены либо `null`, если тариф неизвестен
 */
function formatPrice(model: MediaModelInfo): string | null {
  const parts: string[] = [];

  if (model.priceUnit !== null) {
    parts.push(i18n.t('node.image.price_per_generation', { price: model.price }));
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
 * Узел генерации видео (R7.2, KI-361, DESIGN v0.9 § 3.2).
 *
 * Вход — текст (промпт), выход — `mediaUrl` (`<video controls>` с ограничением
 * высоты, DESIGN § 3.2). Тело узла:
 * 1. `textarea` промпта (приоритетнее входа — как у Image Generation);
 * 2. селект VIDEO-модели из `GET /media/models?type=VIDEO`;
 * 3. поля модели, **объявленные каталогом**: длительность (`duration`,
 *    значения — из схемы модели) и соотношение сторон (`aspect_ratio`);
 * 4. поле `imageUrl` — image-to-video (слот выберет backend по каталогу);
 * 5. результат: `<video>` из `nodeOutputs`, «Генерация…» и «Ошибка».
 */
export function VideoGenNode({ id, data }: NodeProps<VideoGenFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const generationModels = useWorkflowStore((state) => state.generationModels.VIDEO);
  const loadGenerationModels = useWorkflowStore(
    (state) => state.loadGenerationModelsAsync,
  );
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  // R7.7/R7.8: метрики узла несут свою ссылку на сохранённый результат.
  const nodeMetrics = useWorkflowStore((state) => state.nodeMetrics[id]);

  // Список моделей грузится лениво при появлении узла и кэшируется в сторе.
  useEffect(() => {
    void loadGenerationModels(GENERATION_MEDIA_TYPE_BY_NODE.video_generation);
  }, [loadGenerationModels]);

  const prompt = data.prompt ?? '';
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // KI-157: промпт пишется в хранилище на каждый символ — сохраняем курсор.
  const handlePromptChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { prompt: value }), [id, updateNodeData]),
  );

  // KI-169: поле растёт по тексту промпта.
  useAutoResize(promptRef, prompt);

  const selected = generationModels.find((model) => model.id === data.model);
  // Модель, которой нет в каталоге (старое значение или провайдер отключён):
  // показываем как есть, но помечаем недоступной — молчаливой подмены нет.
  const isUnavailable = (data.model ?? '') !== '' && selected === undefined;
  const price = selected ? formatPrice(selected) : null;
  const hasModels = generationModels.length > 0;
  const modelGroups = groupModelsByProvider(generationModels);

  // Поля показываем только там, где параметр объявлен моделью (KI-181):
  // `duration`/`aspect_ratio` есть не у всех VIDEO-моделей.
  const durationParam = pickDeclaredParam(selected, [DURATION_KEY]);
  const aspectRatioParam = pickDeclaredParam(selected, [ASPECT_RATIO_KEY]);
  const durationValue =
    durationParam === undefined ? '' : paramSelectValue(durationParam, data.durationSec);
  const aspectRatioValue =
    aspectRatioParam === undefined
      ? ''
      : paramSelectValue(aspectRatioParam, data.aspectRatio);

  // R7.8 (KI-362): своя ссылка (`storedUrl`) важнее ссылки провайдера; при
  // истёкшем TTL — плейсхолдер «ссылка истекла», а не битое видео.
  const mediaSource = resolveMediaSource({
    outputs,
    storedUrl: nodeMetrics?.storedUrl ?? null,
    storedExpiresAt: nodeMetrics?.storedExpiresAt ?? null,
  });

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
        icon={NODE_REGISTRY.video_generation.icon}
        title={t(NODE_REGISTRY.video_generation.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-video-gen-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <textarea
          ref={promptRef}
          rows={1}
          value={prompt}
          aria-label={t('node.video.prompt_placeholder')}
          placeholder={t('node.video.prompt_placeholder')}
          className="nodrag mb-2 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handlePromptChange}
        />

        <select
          value={data.model ?? ''}
          aria-label={t('node.video.model')}
          // nodrag: иначе клик по списку тащит ноду вместо открытия меню.
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-muted-foreground"
          disabled={!hasModels && !isUnavailable}
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {!hasModels && !isUnavailable && (
            <option value="">{t('node.video.select.none')}</option>
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
              label={t(`media.provider.${group.provider}`, {
                defaultValue: group.provider,
              })}
            >
              {group.models.map((model) => (
                <option key={model.id} value={model.id}>
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

        {durationParam !== undefined && (
          <select
            value={durationValue}
            aria-label={t('node.video.duration')}
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, {
                durationSec: parseNumberField(event.target.value),
              })
            }
          >
            {paramOptions(durationParam).map((option) => (
              <option key={option} value={option}>
                {t('node.video.duration_option', { value: option })}
              </option>
            ))}
          </select>
        )}

        {aspectRatioParam !== undefined && (
          <select
            value={aspectRatioValue}
            aria-label={t('node.video.aspect_ratio')}
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, { aspectRatio: event.target.value })
            }
          >
            {paramOptions(aspectRatioParam).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}

        <input
          type="url"
          value={data.imageUrl ?? ''}
          aria-label={t('node.video.image_url')}
          placeholder={t('node.video.image_url_placeholder')}
          className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={(event) => updateNodeData(id, { imageUrl: event.target.value })}
        />

        <div className="mt-2">
          {status === 'running' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-node-border-running bg-node-bg-running px-2 text-center text-[10px] text-foreground">
              {t('node.video.generating')}
            </div>
          ) : status === 'failed' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-node-border-failed bg-node-bg-failed px-2 text-center text-[10px] text-foreground">
              {t('node.video.error')}
            </div>
          ) : mediaSource.expired ? (
            <ExpiredMediaPlaceholder />
          ) : mediaSource.src !== null ? (
            // DESIGN § 3.2: видео показываем с ограничением высоты — иначе узел
            // раздувается на весь холст.
            <video
              src={mediaSource.src}
              controls
              className="max-h-40 w-full rounded-lg border border-border"
            />
          ) : mediaSource.invalid ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-status-warning-border px-2 text-center text-[10px] text-status-warning-foreground">
              {t('node.image.invalid_url')}
            </div>
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[10px] text-muted-foreground">
              {t('node.video.placeholder')}
            </div>
          )}
        </div>
      </BaseNode>

      <Handle
        type="source"
        id="video-output"
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
