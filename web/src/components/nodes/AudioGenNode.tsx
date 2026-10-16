import { useCallback, useEffect, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { BaseNode } from '@/components/nodes/BaseNode';
import i18n from '@/i18n';
import { useAutoResize } from '@/hooks/use-auto-resize';
import { useNodeDataHistory } from '@/hooks/use-node-data-history';
import { usePreserveCursor } from '@/hooks/use-preserve-cursor';
import {
  MediaNodeOutputsSchema,
  isRenderableMediaUrl,
  type MediaModelInfo,
} from '@/types/media';
import { NODE_REGISTRY } from '@/lib/node-registry';
import {
  GENERATION_MEDIA_TYPE_BY_NODE,
  parseNumberField,
  pickDeclaredParam,
  VOICE_PARAM_KEYS,
} from '@/lib/generation-node';
import { groupModelsByProvider } from '@/lib/media';
import { useWorkflowStore } from '@/stores/workflow';
import {
  DATA_TYPE_COLORS,
  DATA_TYPE_LABELS,
  type AudioGenFlowNode,
} from '@/types/graph';

/** Ключ параметра скорости речи в каталоге media. */
const SPEED_KEY = 'speed';

/**
 * Форматирует цену модели для подписи под селектом.
 *
 * У TTS-моделей тариф часто «по входу» (`priceInput` + `priceInputUnit` —
 * например, за 1000 символов), поэтому показываем обе части.
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
 * Узел синтеза речи (R7.2, KI-361, DESIGN v0.9 § 3.2).
 *
 * Вход — текст (связь от Text/LLM приоритетнее поля узла), выход — `mediaUrl`
 * (`<audio controls>`). Тело узла:
 * 1. `textarea` текста синтеза (`data.text`);
 * 2. селект модели озвучки: `GET /media/models?type=AUDIO`, а при пустом
 *    ответе — TTS-модели из `MUSIC` (реальность CreativeLab, см.
 *    `lib/generation-node`); бейдж TTS-модели показывает провайдера
 *    (`media.provider.*`) и цену;
 * 3. поле голоса (`voiceId`) — показывается всегда, потому что ключ выбирает
 *    backend по каталогу, а у `tts2` он объявлен строкой без `options`;
 * 4. поле скорости (`speed`) — только если модель его объявляет;
 * 5. результат: `<audio>` из `nodeOutputs`.
 */
export function AudioGenNode({ id, data }: NodeProps<AudioGenFlowNode>) {
  const updateNodeData = useNodeDataHistory();
  const { t } = useTranslation();
  const executionLevel = useWorkflowStore((state) => state.executionLevels[id]);
  const status = useWorkflowStore((state) => state.nodeStatuses[id]);
  const generationModels = useWorkflowStore((state) => state.generationModels.AUDIO);
  const loadGenerationModels = useWorkflowStore(
    (state) => state.loadGenerationModelsAsync,
  );
  const removeNode = useWorkflowStore((state) => state.removeNode);
  const outputs = useWorkflowStore((state) => state.nodeOutputs[id]);

  useEffect(() => {
    void loadGenerationModels(GENERATION_MEDIA_TYPE_BY_NODE.audio_generation);
  }, [loadGenerationModels]);

  const text = data.text ?? '';
  const textRef = useRef<HTMLTextAreaElement>(null);

  const handleTextChange = usePreserveCursor<HTMLTextAreaElement>(
    useCallback((value: string) => updateNodeData(id, { text: value }), [id, updateNodeData]),
  );

  useAutoResize(textRef, text);

  const selected = generationModels.find((model) => model.id === data.model);
  const isUnavailable = (data.model ?? '') !== '' && selected === undefined;
  const price = selected ? formatPrice(selected) : null;
  const hasModels = generationModels.length > 0;
  const modelGroups = groupModelsByProvider(generationModels);

  // Голос показываем, если модель объявляет любой из ключей (`voice`/`voice_id`).
  const voiceParam = pickDeclaredParam(selected, VOICE_PARAM_KEYS);
  const speedParam = pickDeclaredParam(selected, [SPEED_KEY]);

  const parsedOutputs = outputs ? MediaNodeOutputsSchema.safeParse(outputs) : null;
  const mediaUrl =
    parsedOutputs !== null && parsedOutputs.success
      ? parsedOutputs.data.mediaUrl
      : null;
  const safeMediaUrl =
    mediaUrl !== null && isRenderableMediaUrl(mediaUrl) ? mediaUrl : null;
  const isInvalidUrl = mediaUrl !== null && safeMediaUrl === null;

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
        icon={NODE_REGISTRY.audio_generation.icon}
        title={t(NODE_REGISTRY.audio_generation.labelKey)}
        executionLevel={executionLevel}
        status={status}
        dataNodeAttr={{ name: 'data-audio-gen-node', value: id }}
        onDelete={() => removeNode(id)}
      >
        <textarea
          ref={textRef}
          rows={1}
          value={text}
          aria-label={t('node.audio.text_placeholder')}
          placeholder={t('node.audio.text_placeholder')}
          className="nodrag mb-2 w-full resize-none overflow-hidden rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          onChange={handleTextChange}
        />

        <select
          value={data.model ?? ''}
          aria-label={t('node.audio.model')}
          className="nodrag w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:bg-muted disabled:text-muted-foreground"
          disabled={!hasModels && !isUnavailable}
          onChange={(event) => updateNodeData(id, { model: event.target.value })}
        >
          {!hasModels && !isUnavailable && (
            <option value="">{t('node.audio.select.none')}</option>
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

        {voiceParam !== undefined && (
          <input
            type="text"
            value={data.voiceId ?? ''}
            aria-label={t('node.audio.voice')}
            placeholder={t('node.audio.voice_placeholder')}
            className="nodrag mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            onChange={(event) => updateNodeData(id, { voiceId: event.target.value })}
          />
        )}

        {speedParam !== undefined && (
          <label className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            {t('node.audio.speed')}
            <input
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              value={data.speed ?? ''}
              className="nodrag w-20 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              onChange={(event) =>
                updateNodeData(id, { speed: parseNumberField(event.target.value) })
              }
            />
          </label>
        )}

        <div className="mt-2">
          {status === 'running' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-blue-300 bg-blue-50 px-2 text-center text-[10px] text-blue-600">
              {t('node.audio.generating')}
            </div>
          ) : status === 'failed' ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-center text-[10px] text-red-600">
              {t('node.audio.error')}
            </div>
          ) : safeMediaUrl !== null ? (
            <audio
              src={safeMediaUrl}
              controls
              aria-label={t('node.audio.alt')}
              className="w-full"
            />
          ) : isInvalidUrl ? (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-amber-300 px-2 text-center text-[10px] text-amber-600">
              {t('node.image.invalid_url')}
            </div>
          ) : (
            <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border px-2 text-center text-[10px] text-muted-foreground">
              {t('node.audio.placeholder')}
            </div>
          )}
        </div>
      </BaseNode>

      <Handle
        type="source"
        id="audio-output"
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
