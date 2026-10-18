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
  GENRE_PARAM_KEYS,
  paramOptions,
  paramSelectValue,
  pickDeclaredParam,
} from '@/lib/generation-node';
import { groupModelsByProvider } from '@/lib/media';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type MusicGenFlowNode,
} from '@/types/graph';

/** Ключ параметра длительности в каталоге media. */
const DURATION_KEY = 'duration';

/**
 * Форматирует цену модели для подписи под селектом.
 *
 * У части music-моделей тариф посекундный (`per_second`), поэтому подпись
 * «от N ₽ / генерация» — оценка снизу, а не точная цена.
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
 * Узел генерации музыки (R7.2, KI-361, DESIGN v0.9 § 3.2).
 *
 * Вход — текст (промпт), выход — `mediaUrl` (`<audio controls>`, DESIGN § 3.2 —
 * «Music — то же»). Тело узла:
 * 1. `textarea` промпта;
 * 2. селект MUSIC-модели из `GET /media/models?type=MUSIC`;
 * 3. длительность (`duration`) и жанр (`genre`/`tags`) — только если модель их
 *    объявила (KI-181);
 * 4. результат: `<audio>` из `nodeOutputs`.
 */
export function MusicGenNode({ id, data }: NodeProps<MusicGenFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const generationModels = useWorkflowStore((state) => state.generationModels.MUSIC);
  const loadGenerationModels = useWorkflowStore(
    (state) => state.loadGenerationModelsAsync,
  );
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);
  // R7.7/R7.8: метрики узла несут свою ссылку на сохранённый результат.
  const nodeMetrics = useWorkflowStore((state) => state.nodeMetrics[id]);

  useEffect(() => {
    void loadGenerationModels(GENERATION_MEDIA_TYPE_BY_NODE.music_generation);
  }, [loadGenerationModels]);

  const prompt = data.prompt ?? '';
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const handlePromptChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { prompt: value }), [id, updateNodeData]),
  );

  useAutoResize(promptRef, prompt);

  const selected = generationModels.find((model) => model.id === data.model);
  const isUnavailable = (data.model ?? '') !== '' && selected === undefined;
  const price = selected ? formatPrice(selected) : null;
  const hasModels = generationModels.length > 0;
  const modelGroups = groupModelsByProvider(generationModels);

  const durationParam = pickDeclaredParam(selected, [DURATION_KEY]);
  const genreParam = pickDeclaredParam(selected, GENRE_PARAM_KEYS);
  const durationValue =
    durationParam === undefined ? '' : paramSelectValue(durationParam, data.durationSec);

  // R7.8 (KI-362): своя ссылка (`storedUrl`) важнее ссылки провайдера; при
  // истёкшем TTL — плейсхолдер «ссылка истекла», а не битое аудио.
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
        icon={NODE_REGISTRY.music_generation.icon}
        title={t(NODE_REGISTRY.music_generation.labelKey)}
        status={status}
        dataNodeAttr={{ name: 'data-music-gen-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <textarea
          ref={promptRef}
          rows={1}
          value={prompt}
          aria-label={t('node.music.prompt_placeholder')}
          placeholder={t('node.music.prompt_placeholder')}
          className="nodrag mb-2 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handlePromptChange}
        />

        <select
          value={data.model ?? ''}
          aria-label={t('node.music.model')}
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-muted-foreground"
          disabled={!hasModels && !isUnavailable}
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {!hasModels && !isUnavailable && (
            <option value="">{t('node.music.select.none')}</option>
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
            aria-label={t('node.music.duration')}
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) =>
              updateNodeData(id, {
                durationSec: Number(event.target.value),
              })
            }
          >
            {paramOptions(durationParam).map((option) => (
              <option key={option} value={option}>
                {t('node.music.duration_option', { value: option })}
              </option>
            ))}
          </select>
        )}

        {genreParam !== undefined && (
          <input
            type="text"
            value={data.genre ?? ''}
            aria-label={t('node.music.genre')}
            placeholder={t('node.music.genre_placeholder')}
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) => updateNodeData(id, { genre: event.target.value })}
          />
        )}

        <div className="mt-2">
          {status === 'running' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50 px-2 text-center text-[10px] text-blue-600">
              {t('node.music.generating')}
            </div>
          ) : status === 'failed' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-[10px] text-red-600">
              {t('node.music.error')}
            </div>
          ) : mediaSource.expired ? (
            <ExpiredMediaPlaceholder />
          ) : mediaSource.src !== null ? (
            <audio
              src={mediaSource.src}
              controls
              aria-label={t('node.music.alt')}
              className="w-full"
            />
          ) : mediaSource.invalid ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-amber-300 px-2 text-center text-[10px] text-amber-600">
              {t('node.image.invalid_url')}
            </div>
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[10px] text-muted-foreground">
              {t('node.music.placeholder')}
            </div>
          )}
        </div>
      </BaseNode>

      <Handle
        type="source"
        id="music-output"
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
