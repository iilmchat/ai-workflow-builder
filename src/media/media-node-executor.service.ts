import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { NodeDto } from '../engine/dto/index.js';
import { NodeDataValidationException } from '../engine/node-executors.js';
import { withSpanAsync } from '../observability/tracing.js';
import {
  calculateMediaCostEstimate,
  CostBudgetService,
} from '../runs/cost-budget.service.js';
import {
  DEFAULT_IMAGE_TOOL_MODELS,
  IMAGE_TOOL_OPERATIONS,
  IMAGE_TOOL_RESERVED_PARAM_KEYS,
  type ImageToolOperation,
  type ImageToolParams,
} from './image-tool.js';
import {
  ASPECT_RATIO_PARAM_KEY,
  DURATION_PARAM_KEY,
  GENRE_PARAM_KEYS,
  GENERATION_MEDIA_TYPE_BY_KIND,
  isTtsModel,
  pickAudioModels,
  pickDefaultGenerationModel,
  pickImageInputKey,
  SPEED_PARAM_KEY,
  VOICE_PARAM_KEYS,
  type GenerationNodeKind,
} from './media-generation.js';
import {
  MEDIA_PROVIDERS,
  MediaRegistryService,
} from './media-registry.service.js';
import {
  MediaProviderException,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaParam,
  type MediaType,
} from './media-provider.interface.js';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
  type MediaStoredFile,
} from './media-storage.service.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';

/** Модель по умолчанию, если узел её не задал. */
export const DEFAULT_MEDIA_MODEL = 'flux-schnell';

/** Стартовая пауза опроса задачи (мс). */
const POLL_INITIAL_DELAY_MS = 2_000;
/** Множитель экспоненциального backoff (RULES 1.19). */
const POLL_BACKOFF_FACTOR = 1.5;
/** Верхняя граница паузы между опросами (мс) — cap для backoff. */
const POLL_MAX_DELAY_MS = 15_000;
/**
 * Дефолтный лимит ожидания media-задачи (мс) — 10 минут.
 *
 * Совпадает с дефолтом env `CREATIVELAB_MEDIA_TIMEOUT_MS` (R7.2, DESIGN v0.9
 * § 3.2): видео генерируется минутами, и прежние 5 минут обрывали задачу,
 * которая на стороне upstream продолжала выполняться и списывать деньги.
 */
const DEFAULT_MEDIA_TIMEOUT_MS = 600_000;

/** Метрики выполнения media-узла (для записи в `node_runs`, валюта — RUB). */
export interface MediaNodeMetrics {
  /** Стоимость генерации в рублях (`null`, если upstream её не отдал). */
  costRub: number | null;
  /** Тип модели (IMAGE/VIDEO/...) — для UI-бейджей в v0.6.0b.2.3. */
  mediaType: MediaType;
  /** id задачи в upstream (для диагностики). */
  taskId: string;
  /**
   * Своя ссылка на сохранённый результат (R7.8, KI-362).
   *
   * `null` — сохранение выключено (`MEDIA_STORAGE_BACKEND=none`), не задано
   * (`local` ещё не успел) или упало: узел при этом не падает, UI берёт
   * `outputs.mediaUrl`/`resultUrls` провайдера.
   */
  storedUrl: string | null;
  /** Когда `storedUrl` перестанет быть доступной (`null` — без TTL/не сохранено). */
  storedExpiresAt: Date | null;
}

/** Результат выполнения media-узла: выходы + метрики. */
export interface MediaNodeExecutionResult {
  /** Выходы узла (`{ mediaUrl, mediaType, taskId }`). */
  outputs: Record<string, unknown>;
  /** Метрики генерации. */
  metrics: MediaNodeMetrics;
}

/**
 * Разобранный запрос узла media-генерации (R7.2).
 *
 * Публичные методы узлов (`executeVideoAsync`, `executeAudioAsync`,
 * `executeMusicAsync`) разбирают своё `data` и передают сюда уже готовые
 * значения — общий конвейер не знает различий между video/audio/music.
 */
interface GenerationRequest {
  /** Тип узла (`video_generation`/`audio_generation`/`music_generation`). */
  kind: GenerationNodeKind;
  /** Тип модели узла (`VIDEO`/`AUDIO`/`MUSIC`). */
  mediaType: MediaType;
  /** Имя текстового поля узла (`prompt` либо `text`) — для сообщения об ошибке. */
  promptField: 'prompt' | 'text';
  /** Промпт либо текст синтеза (пустая строка — «не задан»). */
  prompt: string;
  /** id модели из `data.model`, если выбран. */
  requestedModel: string | undefined;
  /** Запрошенные параметры: только ключи, объявленные моделью, уйдут в запрос. */
  requestedParams: Record<string, string | number | boolean>;
  /** Ссылка на изображение для image-to-video, если задана. */
  imageUrl?: string;
}

/** Модель узла media-генерации, разрешённая по каталогу. */
interface ResolvedGenerationModel {
  /** id, который уходит в upstream. */
  id: string;
  /** Описание модели из каталога; `null` — модель каталогу неизвестна. */
  info: MediaModelInfo | null;
}

/**
 * Схема `data` узла `image_tool` (R7.1, DESIGN v0.9 § 3.1).
 *
 * `inputUrl` — фолбэк для случая, когда вход не пришёл по связи (узел можно
 * запустить с одной лишь ссылкой). Схема допускает `model` без значения: у
 * операций с дефолтной моделью (`bg_removal`, `lipsync`) пользователь может её
 * не выбирать, а у остальных отсутствие модели даёт понятную ошибку на
 * выполнении.
 */
const ImageToolNodeDataSchema = z.object({
  /** Операция инструмента (5 значений DESIGN § 3.1). */
  operation: z.enum(IMAGE_TOOL_OPERATIONS),
  /** id модели-инструмента из каталога media. */
  model: z.string().min(1).optional(),
  /** Ссылка на входной файл — фолбэк, если нет связи. */
  inputUrl: z
    .url({ protocol: /^https?$/ })
    .optional(),
  /** Параметры конкретной операции (промпт, audioUrl, поля модели). */
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Разобранные `data` узла `image_tool`. */
type ImageToolNodeData = z.infer<typeof ImageToolNodeDataSchema>;

/**
 * Схема `data` узла `video_generation` (R7.2, DESIGN v0.9 § 3.2).
 *
 * Диапазон `durationSec` шире DESIGN (`3–10`): реальный каталог допускает до
 * 30 секунд (`kling-v4`), а точный набор значений у модели — enum `duration`
 * из каталога. Схема валидирует «разумное» окно, а не подменяет каталог:
 * значение, которого у модели нет, отсекает фильтр параметров
 * ({@link MediaNodeExecutor.filterParamsAsync}).
 */
const VideoGenNodeDataSchema = z.object({
  /** id VIDEO-модели из каталога media. */
  model: z.string().min(1).optional(),
  /** Промпт (обязателен у большинства VIDEO-моделей каталога). */
  prompt: z.string().optional(),
  /** Ссылка на изображение для image-to-video (слот выбирается по каталогу). */
  imageUrl: z
    .url({ protocol: /^https?$/ })
    .optional(),
  /** Длительность в секундах → параметр `duration` модели. */
  durationSec: z.number().int().min(1).max(60).optional(),
  /** Соотношение сторон → параметр `aspect_ratio` модели. */
  aspectRatio: z.string().min(1).optional(),
  /** Прочие параметры модели (уходят только объявленные каталогом). */
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Разобранные `data` узла `video_generation`. */
type VideoGenNodeData = z.infer<typeof VideoGenNodeDataSchema>;

/**
 * Схема `data` узла `audio_generation` (R7.2, DESIGN v0.9 § 3.2).
 *
 * `text` — синтезируемый текст (TTS): у моделей с промптом он уходит в
 * `prompt` запроса. `speed` — 0.5–2.0 по DESIGN; модель, которая такого
 * параметра не объявляет (`tts2`), его не получит (KI-181).
 */
const AudioGenNodeDataSchema = z.object({
  /** id AUDIO-модели из каталога (реально — TTS-модель из MUSIC). */
  model: z.string().min(1).optional(),
  /** Текст для синтеза речи. */
  text: z.string().optional(),
  /** id голоса → параметр `voice`/`voice_id` модели. */
  voiceId: z.string().min(1).optional(),
  /** Скорость речи → параметр `speed` модели. */
  speed: z.number().min(0.5).max(2).optional(),
  /** Прочие параметры модели (уходят только объявленные каталогом). */
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Разобранные `data` узла `audio_generation`. */
type AudioGenNodeData = z.infer<typeof AudioGenNodeDataSchema>;

/**
 * Схема `data` узла `music_generation` (R7.2, DESIGN v0.9 § 3.2).
 *
 * Диапазон `durationSec` шире DESIGN (`15–120`): у `sound-effect` тариф
 * `per_second`, а длительность задаётся параметром `duration` конкретной
 * модели — «разумное окно» проверяет схема, точный набор — каталог.
 */
const MusicGenNodeDataSchema = z.object({
  /** id MUSIC-модели из каталога media. */
  model: z.string().min(1).optional(),
  /** Промпт (обязателен у большинства MUSIC-моделей каталога). */
  prompt: z.string().optional(),
  /** Длительность в секундах → параметр `duration` модели. */
  durationSec: z.number().int().min(1).max(300).optional(),
  /** Жанр → параметр `genre`/`tags` модели. */
  genre: z.string().min(1).optional(),
  /** Прочие параметры модели (уходят только объявленные каталогом). */
  params: z.record(z.string(), z.unknown()).optional(),
});

/** Разобранные `data` узла `music_generation`. */
type MusicGenNodeData = z.infer<typeof MusicGenNodeDataSchema>;

/** Объединённые `data` узлов media-генерации R7.2. */
type GenerationNodeData = VideoGenNodeData | AudioGenNodeData | MusicGenNodeData;

/**
 * Исполнитель узлов типа `image_generation` (v0.6.0b.2.2), `image_tool` (R7.1)
 * и media-генерации R7.2 — `video_generation`, `audio_generation`,
 * `music_generation` (DESIGN v0.9 § 3.2).
 *
 * Отдельный DI-сервис по той же причине, что и `LlmNodeExecutor`: узел ходит
 * во внешний API, ему нужен реестр провайдеров. `node-executors` остаются
 * реестром чистых преобразований.
 *
 * Генерация асинхронная, поэтому узел делает `createTask` (с `wait: true` —
 * upstream держит соединение до 30 секунд) и, если задача не успела
 * завершиться, опрашивает её с экспоненциальным backoff до лимита
 * `CREATIVELAB_MEDIA_TIMEOUT_MS` (R7.2: 10 минут — видео длится минутами;
 * RULES 1.19).
 *
 * **R7.1 (KI-048):** перед платным вызовом каждый узел проверяет бюджет запуска
 * ({@link CostBudgetService}); при превышении узел падает с
 * `Budget exceeded (estimated: $X, remaining: $Y)`, а провайдер не вызывается.
 *
 * **Провайдеры инструментов берутся напрямую** (токен {@link MEDIA_PROVIDERS}), а
 * не через `MediaRegistryService`: файл реестра зарезервирован параллельной
 * задачей R7.3 (прямые провайдеры Replicate/FAL/OpenAI), поэтому метод
 * `applyToolAsync` там не добавлялся. Маршрутизация по каталогу провайдера —
 * та же, что в реестре (`resolveByModelAsync`).
 *
 * **Узлы R7.2 маршрутизируются реестром:** модель и её параметры ищутся через
 * `MediaRegistryService` (`findModelAsync`/`listModelsAsync`) — дублирования
 * перебора провайдеров в исполнителе нет (KI-370). Инструменты R7.1 остаются
 * на прямом переборе: их тесты (`media-node-executor.tool.spec.ts`) фиксируют
 * обратное, а сам переезд — отдельная задача (KI-379).
 */
@Injectable()
export class MediaNodeExecutor {
  private readonly logger = new Logger(MediaNodeExecutor.name);

  /**
   * @param registry - реестр media-провайдеров (задачи генерации и опрос)
   * @param providers - сами media-провайдеры: нужны для инструментов (R7.1),
   *   которых в реестре R7.3 ещё нет
   * @param costBudget - предохранитель по стоимости запуска (KI-048)
   * @param config - доступ к env (RULES 4.6): лимит ожидания media-задачи
   *   `CREATIVELAB_MEDIA_TIMEOUT_MS`. `@Optional()` — потому что исполнителя
   *   собирают и без `ConfigModule` (юнит-тесты инструментов R7.1, которые
   *   этой опцией не пользуются); без конфига берётся дефолт 10 минут
   * @param storage - хранилище результатов (R7.8, KI-362). `@Optional()`:
   *   без него (старые тесты, `MEDIA_STORAGE_BACKEND=none`) результат не
   *   сохраняется, и узел живёт на ссылке провайдера
   */
  constructor(
    private readonly registry: MediaRegistryService,
    @Inject(MEDIA_PROVIDERS) private readonly providers: readonly IMediaProvider[],
    private readonly costBudget: CostBudgetService,
    @Optional() private readonly config?: ConfigService,
    @Optional() @Inject(MEDIA_STORAGE) private readonly storage?: IMediaStorage,
  ) {}

  /**
   * Выполняет узел `image_generation`: prompt + params → задача → опрос → URL-ы.
   *
   * @param node - узел графа (`data.model`, `data.params`, `data.aspectRatio`)
   * @param inputs - нормализованные входы (после KI-034 ключ — `prompt`)
   * @param runId - id запуска; вместе с `node.id` даёт ключ идемпотентности
   * @returns выходы `{ mediaUrl, mediaType, taskId }` и метрики (стоимость в RUB)
   * @throws MediaProviderException если prompt или модель пусты, провайдер
   *   ответил ошибкой, задача упала или истёк общий таймаут ожидания
   */
  async executeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<MediaNodeExecutionResult> {
    const prompt = this.readPrompt(node, inputs);

    if (!prompt) {
      throw new MediaProviderException(
        'media',
        `Пустой prompt на входе media-узла ${node.id}`,
      );
    }

    const model = this.readModel(node);
    const params = await this.readParamsAsync(node, model);
    const mediaType = this.readMediaType(node);

    // R7.1 (KI-048) + R7.2b (KI-384): бюджет проверяется ДО платного вызова.
    // Оценка считается по блоку `pricing` и параметрам вызова, а не только по
    // устаревшему `price`; если модель неизвестна каталогу, оценка нулевая —
    // превышение всё равно ловится по уже потраченному.
    const modelInfo = await this.findModelAsync(node, model);
    const estimateRub =
      modelInfo === null
        ? 0
        : calculateMediaCostEstimate(modelInfo, {
            ...node.data,
            ...params,
            prompt,
          });

    await this.assertBudgetAsync(runId, estimateRub);

    // Ключ стабилен при повторе: тот же runId и nodeId на job-level retry
    // (KI-040) не создадут вторую платную генерацию.
    const idempotencyKey = `${runId}:${node.id}`;

    // RULES 5.9: промпт целиком в лог не пишем — только длину.
    this.logger.log(
      `Media-узел ${node.id}: model=${model}, promptLen=${prompt.length}, type=${mediaType}`,
    );

    const task = await withSpanAsync(
      'media.createTask',
      { 'media.node_id': node.id, 'media.model': model, 'media.type': mediaType },
      async (span) => {
        const created = await this.registry.createTaskAsync({
          model,
          prompt,
          params,
          idempotencyKey,
          wait: true,
        });

        span.setAttribute('media.task_id', created.taskId);
        span.setAttribute('media.task_status', created.status);

        return created;
      },
    );

    this.logger.log(`Media-узел ${node.id}: taskId=${task.taskId}`);

    // Финальные статусы — `done` и `failed`: задача могла упасть ещё до того,
    // как мы начали опрос (например, отклонена модерацией), и тогда опрашивать
    // нечего — сразу сообщаем причину.
    const finished =
      task.status === 'done' || task.status === 'failed'
        ? task
        : await this.pollAsync(node, task);

    if (finished.status === 'failed') {
      throw new MediaProviderException(
        'media',
        `задача генерации ${finished.taskId} упала: ${finished.error ?? 'причина неизвестна'}`,
      );
    }

    // R7.8 (KI-362): результат провайдера живёт 48 ч — сразу сохраняем копию.
    const stored = await this.storeResultAsync(node, runId, finished.resultUrls[0]);
    const metrics: MediaNodeMetrics = {
      costRub: finished.costRub,
      mediaType,
      taskId: finished.taskId,
      storedUrl: stored?.storedUrl ?? null,
      storedExpiresAt: stored?.storedExpiresAt ?? null,
    };

    this.logger.log(
      `Media-узел ${node.id}: cost=${metrics.costRub ?? '?'}₽, url=${finished.resultUrls[0] ?? '?'}, stored=${metrics.storedUrl ?? '—'}`,
    );

    return {
      outputs: {
        mediaUrl: finished.resultUrls[0] ?? null,
        mediaType,
        taskId: finished.taskId,
      },
      metrics,
    };
  }

  /**
   * Выполняет узел `image_tool`: входной файл + операция → задача инструмента → URL-ы.
   *
   * Отличия от {@link executeAsync} (генерации):
   * - промпт не нужен: на вход идёт **файл** (`inputs.url` по связи либо
   *   `data.inputUrl`), а промпт для моделей с `prompt: 'required'` собирает
   *   провайдер ({@link IMediaProvider.applyToolAsync});
   * - модель-инструмент может быть не выбрана: у операций с известной моделью
   *   (`bg_removal`, `lipsync`) берётся дефолт;
   * - выходы — `{ resultUrls, costRub, mediaType: 'TOOL', taskId }` (DESIGN
   *   v0.9 § 3.1): у инструмента результат — список URL-ов, а стоимость
   *   возвращается отдельным полем.
   *
   * @param node - узел графа (`data.operation`, `data.model`, `data.params`)
   * @param inputs - нормализованные входы узла (`url` — ссылка на файл)
   * @param runId - id запуска; вместе с `node.id` даёт ключ идемпотентности и
   *   нужен для проверки бюджета
   * @returns выходы `{ resultUrls, costRub, mediaType, taskId }` и метрики
   * @throws NodeDataValidationException если `data` узла не по схеме
   * @throws MediaProviderException если не задан вход/модель, провайдер ответил
   *   ошибкой, задача упала или истёк общий таймаут ожидания
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  async executeToolAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<MediaNodeExecutionResult> {
    const data = this.parseToolData(node);
    const inputUrl = this.readToolInputUrl(node, data, inputs);
    const target = await this.resolveToolTargetAsync(data.operation, data.model);

    this.logger.log(
      `Media-инструмент ${node.id}: operation=${data.operation}, model=${target.model.id}, inputLen=${inputUrl.length}`,
    );

    const toolParams = this.readToolParams(node, data);

    // Бюджет проверяется до платного вызова (KI-048). Оценка — тариф модели
    // (`pricing`) по параметрам вызова (KI-384); CostBudgetService сам
    // нормализует рубли в USD.
    await this.assertBudgetAsync(
      runId,
      calculateMediaCostEstimate(target.model, {
        ...node.data,
        ...toolParams,
      }),
    );

    const task = await withSpanAsync(
      'media.createTask',
      {
        'media.node_id': node.id,
        'media.model': target.model.id,
        'media.type': 'TOOL',
        'media.operation': data.operation,
      },
      async (span) => {
        const created = await target.provider.applyToolAsync(
          inputUrl,
          data.operation,
          {
            ...toolParams,
            model: target.model.id,
            // Ключ стабилен при повторе: тот же runId и nodeId на job-level retry
            // (KI-040) не создадут вторую платную задачу.
            idempotencyKey: `${runId}:${node.id}`,
          },
        );

        span.setAttribute('media.task_id', created.taskId);
        span.setAttribute('media.task_status', created.status);

        return created;
      },
    );

    // Инструменты обычно отвечают быстро (`wait: true`), но апскейл/липсинк
    // бывают дольше окна ожидания upstream — тогда задача добирается опросом.
    const finished =
      task.status === 'done' || task.status === 'failed'
        ? task
        : await this.pollAsync(node, task);

    if (finished.status === 'failed') {
      throw new MediaProviderException(
        'media',
        `задача инструмента ${finished.taskId} упала: ${finished.error ?? 'причина неизвестна'}`,
      );
    }

    // R7.8 (KI-362): инструмент отдаёт список URL — сохраняем первый.
    const stored = await this.storeResultAsync(node, runId, finished.resultUrls[0]);
    const metrics: MediaNodeMetrics = {
      costRub: finished.costRub,
      mediaType: 'TOOL',
      taskId: finished.taskId,
      storedUrl: stored?.storedUrl ?? null,
      storedExpiresAt: stored?.storedExpiresAt ?? null,
    };

    this.logger.log(
      `Media-инструмент ${node.id}: cost=${metrics.costRub ?? '?'}₽, url=${finished.resultUrls[0] ?? '?'}, stored=${metrics.storedUrl ?? '—'}`,
    );

    return {
      outputs: {
        resultUrls: finished.resultUrls,
        costRub: finished.costRub,
        mediaType: 'TOOL',
        taskId: finished.taskId,
      },
      metrics,
    };
  }

  /**
   * Выполняет узел `video_generation` (R7.2, DESIGN v0.9 § 3.2).
   *
   * Отличие от `image_generation` — только тип модели (`VIDEO`): промпт, тот же
   * `POST /media/tasks`, тот же опрос. Дополнительно поддерживается
   * image-to-video: `imageUrl` (поле узла или вход `url`) уходит во входной слот
   * картинки, **ключ слота берётся из каталога** модели (`first_frame`, `image`,
   * `reference_image`, ...).
   *
   * @param node - узел графа (`data.model`, `data.prompt`, `data.imageUrl`,
   *   `data.durationSec`, `data.aspectRatio`)
   * @param inputs - нормализованные входы узла (ключ `prompt` — KI-034)
   * @param runId - id запуска: ключ идемпотентности + проверка бюджета
   * @returns выходы `{ mediaUrl, mediaType: 'VIDEO', taskId }` и метрики
   * @throws NodeDataValidationException если `data` узла не по схеме
   * @throws MediaProviderException если промпт/модель не заданы, модель не того
   *   типа, каталог пуст, задача упала или истёк лимит ожидания
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  async executeVideoAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<MediaNodeExecutionResult> {
    const data = this.parseGenerationData(node, 'video_generation');

    return this.executeGenerationAsync(node, runId, {
      kind: 'video_generation',
      mediaType: GENERATION_MEDIA_TYPE_BY_KIND.video_generation,
      promptField: 'prompt',
      prompt: this.readPrompt(node, inputs),
      requestedModel: data.model,
      requestedParams: buildVideoParams(node, data),
      imageUrl: readVideoImageUrl(inputs, data),
    });
  }

  /**
   * Выполняет узел `audio_generation` (R7.2, DESIGN v0.9 § 3.2).
   *
   * Текст синтеза берётся из входа `prompt` (связь от Text/LLM) либо из
   * `data.text`. Каталог CreativeLab не отдаёт `type=AUDIO`, поэтому модель по
   * умолчанию ищется среди TTS-моделей `type=MUSIC` (см.
   * {@link pickAudioModels}); `voiceId`/`speed` уходят только теми ключами,
   * которые модель объявила (`voice`/`voice_id`, `speed`).
   *
   * @param node - узел графа (`data.model`, `data.text`, `data.voiceId`,
   *   `data.speed`)
   * @param inputs - нормализованные входы узла (ключ `prompt`)
   * @param runId - id запуска: ключ идемпотентности + проверка бюджета
   * @returns выходы `{ mediaUrl, mediaType: 'AUDIO', taskId }` и метрики
   * @throws NodeDataValidationException если `data` узла не по схеме
   * @throws MediaProviderException если текст/модель не заданы, каталог пуст,
   *   задача упала или истёк лимит ожидания
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  async executeAudioAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<MediaNodeExecutionResult> {
    const data = this.parseGenerationData(node, 'audio_generation');

    return this.executeGenerationAsync(node, runId, {
      kind: 'audio_generation',
      mediaType: GENERATION_MEDIA_TYPE_BY_KIND.audio_generation,
      promptField: 'text',
      prompt: readAudioText(node, inputs, data),
      requestedModel: data.model,
      requestedParams: buildAudioParams(node, data),
    });
  }

  /**
   * Выполняет узел `music_generation` (R7.2, DESIGN v0.9 § 3.2).
   *
   * Промпт — из входа `prompt` либо `data.prompt`; `durationSec` и `genre`
   * уходят параметрами `duration` и `genre`/`tags` только у моделей, которые их
   * объявили (KI-181).
   *
   * @param node - узел графа (`data.model`, `data.prompt`, `data.durationSec`,
   *   `data.genre`)
   * @param inputs - нормализованные входы узла (ключ `prompt`)
   * @param runId - id запуска: ключ идемпотентности + проверка бюджета
   * @returns выходы `{ mediaUrl, mediaType: 'MUSIC', taskId }` и метрики
   * @throws NodeDataValidationException если `data` узла не по схеме
   * @throws MediaProviderException если промпт/модель не заданы, каталог пуст,
   *   задача упала или истёк лимит ожидания
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  async executeMusicAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<MediaNodeExecutionResult> {
    const data = this.parseGenerationData(node, 'music_generation');

    return this.executeGenerationAsync(node, runId, {
      kind: 'music_generation',
      mediaType: GENERATION_MEDIA_TYPE_BY_KIND.music_generation,
      promptField: 'prompt',
      prompt: this.readPrompt(node, inputs),
      requestedModel: data.model,
      requestedParams: buildMusicParams(node, data),
    });
  }

  /**
   * Общий конвейер узлов media-генерации R7.2: модель → бюджет → задача → опрос.
   *
   * Порядок шагов важен: сначала разрешается модель (из `data.model` или
   * каталога — «дефолт не пустой»), затем промпт проверяется по режиму модели
   * (`prompt: 'required' | 'optional' | 'none'`), затем собираются входные слои
   * и только потом вызывается провайдер. Ошибка данных или пустой промпт не
   * должны доходить до платного `POST /tasks`.
   *
   * @param node - узел графа (для id в ключе идемпотентности и сообщений)
   * @param runId - id запуска: ключ идемпотентности + проверка бюджета
   * @param request - разобранные данные узла (промпт, модель, параметры, картинка)
   * @returns выходы `{ mediaUrl, mediaType, taskId }` и метрики (`mediaType` узла)
   * @throws MediaProviderException если промпт/модель не заданы, модель не того
   *   типа, каталог пуст, задача упала или истёк лимит ожидания
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  private async executeGenerationAsync(
    node: NodeDto,
    runId: string,
    request: GenerationRequest,
  ): Promise<MediaNodeExecutionResult> {
    const resolved = await this.resolveGenerationModelAsync(
      node,
      request.mediaType,
      request.requestedModel,
    );

    // Режим промпта берём у модели: `none` (например, lipsync-подобные видео по
    // картинке+аудио) не должен требовать текст, а `required` — не должен
    // уходить в upstream без него (там это 400 после платного запроса).
    const promptRequired = resolved.info?.prompt !== 'none';

    if (request.prompt.length === 0 && promptRequired) {
      throw new MediaProviderException(
        'media',
        `Пустой ${request.promptField} на входе media-узла ${node.id}`,
      );
    }

    const params = await this.filterParamsAsync(
      resolved.id,
      request.requestedParams,
    );
    const taskInputs = this.buildGenerationInputs(node, request, resolved.info);

    // RULES 5.9: текст промпта целиком в лог не пишем — только длину.
    this.logger.log(
      `Media-узел ${node.id}: kind=${request.kind}, model=${resolved.id}, ` +
        `promptLen=${request.prompt.length}, params=${Object.keys(params).join(',') || 'нет'}`,
    );

    // KI-048 + KI-384: бюджет проверяется ДО платного вызова. Оценка считается
    // по тарифу `pricing` и фактическим параметрам вызова (длительность,
    // разрешение, длина текста), а не по устаревшему `price`. Если модель
    // каталогу неизвестна, оценка нулевая — превышение всё равно ловится по
    // потраченному.
    const estimateRub =
      resolved.info === null
        ? 0
        : calculateMediaCostEstimate(resolved.info, {
            ...node.data,
            ...params,
            prompt: request.prompt,
            text: request.prompt,
          });

    await this.assertBudgetAsync(runId, estimateRub);

    const task = await withSpanAsync(
      'media.createTask',
      {
        'media.node_id': node.id,
        'media.model': resolved.id,
        'media.type': request.mediaType,
        'media.kind': request.kind,
      },
      async (span) => {
        const created = await this.registry.createTaskAsync({
          model: resolved.id,
          prompt: request.prompt.length > 0 ? request.prompt : undefined,
          params,
          ...(taskInputs === undefined ? {} : { inputs: taskInputs }),
          // Ключ стабилен при повторе: тот же runId и nodeId на job-level retry
          // (KI-040) не создадут вторую платную генерацию.
          idempotencyKey: `${runId}:${node.id}`,
          wait: true,
        });

        span.setAttribute('media.task_id', created.taskId);
        span.setAttribute('media.task_status', created.status);

        return created;
      },
    );

    this.logger.log(`Media-узел ${node.id}: taskId=${task.taskId}`);

    const finished = await this.awaitTaskAsync(node, task, request.mediaType);

    // R7.8 (KI-362): ссылка провайдера живёт 48 ч — сохраняем копию к себе.
    const stored = await this.storeResultAsync(node, runId, finished.resultUrls[0]);
    const metrics: MediaNodeMetrics = {
      costRub: finished.costRub,
      mediaType: request.mediaType,
      taskId: finished.taskId,
      storedUrl: stored?.storedUrl ?? null,
      storedExpiresAt: stored?.storedExpiresAt ?? null,
    };

    this.logger.log(
      `Media-узел ${node.id}: cost=${metrics.costRub ?? '?'}₽, url=${finished.resultUrls[0] ?? '?'}, stored=${metrics.storedUrl ?? '—'}`,
    );

    return {
      outputs: {
        mediaUrl: finished.resultUrls[0] ?? null,
        mediaType: request.mediaType,
        taskId: finished.taskId,
      },
      metrics,
    };
  }

  /**
   * Разбирает `data` узла media-генерации Zod-схемой (RULES 1.17).
   *
   * @param node - узел графа
   * @param kind - тип узла (`video_generation`/`audio_generation`/`music_generation`)
   * @returns разобранные данные соответствующего типа
   * @throws NodeDataValidationException если данные не соответствуют схеме
   */
  private parseGenerationData(
    node: NodeDto,
    kind: GenerationNodeKind,
  ): GenerationNodeData {
    const parsed =
      kind === 'video_generation'
        ? VideoGenNodeDataSchema.safeParse(node.data)
        : kind === 'audio_generation'
          ? AudioGenNodeDataSchema.safeParse(node.data)
          : MusicGenNodeDataSchema.safeParse(node.data);

    if (!parsed.success) {
      const reason = parsed.error.issues
        .map((issue) => {
          const path = issue.path.join('.');

          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');

      throw new NodeDataValidationException(node.type, reason);
    }

    return parsed.data;
  }

  /**
   * Находит модель узла media-генерации и её описание в каталоге.
   *
   * Два источника (в порядке приоритета):
   * 1. `data.model` — явный выбор пользователя; модель ищется в каталоге
   *    (тип проверяется, иначе узел отправит IMAGE-модель в VIDEO-задачу);
   * 2. каталог `mediaType` — модель по умолчанию
   *    ({@link pickDefaultGenerationModel}). Для `AUDIO` при пустом ответе
   *    берутся TTS-модели из `MUSIC` (реальность CreativeLab: `type=AUDIO`
   *    не отдаётся вовсе).
   *
   * @param node - узел графа (для id в сообщениях)
   * @param mediaType - тип модели узла (`VIDEO`/`AUDIO`/`MUSIC`)
   * @param requestedModel - id из `data.model`, если задан
   * @returns id для upstream и описание модели (`info: null`, если модель
   *   каталогу неизвестна — тогда параметры уходят как есть)
   * @throws MediaProviderException если каталог пуст и модель не выбрана либо
   *   выбранная модель не того типа
   */
  private async resolveGenerationModelAsync(
    node: NodeDto,
    mediaType: MediaType,
    requestedModel: string | undefined,
  ): Promise<ResolvedGenerationModel> {
    if (requestedModel !== undefined && requestedModel.length > 0) {
      const info = await this.registry.findModelAsync(requestedModel);

      if (info === null) {
        // Модель не объявлена каталогом (провайдер отключён или список не
        // отдал её): не теряем ввод пользователя — маршрутизацию по id сделает
        // реестр, а параметры уйдут как есть (та же логика, что в KI-181).
        this.logger.warn(
          `Media-узел ${node.id}: модель ${requestedModel} не найдена в каталоге — параметры уйдут без фильтра`,
        );

        return { id: requestedModel, info: null };
      }

      if (info.type !== mediaType && !isAudioFallback(mediaType, info)) {
        throw new MediaProviderException(
          'media',
          `Модель ${info.id} имеет тип ${info.type}, а узел ${node.type} требует ${mediaType}`,
        );
      }

      return { id: info.id, info };
    }

    const models = await this.listGenerationModelsAsync(mediaType);
    const defaultId = pickDefaultGenerationModel(models, mediaType);
    const info = models.find((model) => model.id === defaultId) ?? null;

    if (info === null) {
      throw new MediaProviderException(
        'media',
        `Не задана модель media-узла ${node.id}: каталог ${mediaType} пуст`,
      );
    }

    this.logger.log(
      `Media-узел ${node.id}: модель не выбрана — взята модель по умолчанию ${info.id} (${mediaType})`,
    );

    return { id: info.id, info };
  }

  /**
   * Возвращает модели каталога для типа узла media-генерации.
   *
   * Для `AUDIO` действует документированный фолбэк: CreativeLab не отдаёт
   * `type=AUDIO` (проверено запросом каталога — `{ code: 0, models: [] }`), а
   * TTS-модель `tts2` объявлена как `MUSIC`. Если AUDIO-моделей нет, берутся
   * MUSIC-модели с голосовым параметром.
   *
   * @param mediaType - тип модели узла
   * @returns модели каталога (пустой массив, если провайдеры не сконфигурированы)
   * @throws MediaProviderException если сконфигурированный провайдер ответил ошибкой
   */
  private async listGenerationModelsAsync(
    mediaType: MediaType,
  ): Promise<readonly MediaModelInfo[]> {
    if (mediaType !== 'AUDIO') {
      return this.registry.listModelsAsync(mediaType);
    }

    const audio = await this.registry.listModelsAsync('AUDIO');

    if (audio.length > 0) {
      return audio;
    }

    const music = await this.registry.listModelsAsync('MUSIC');
    const tts = pickAudioModels(audio, music);

    this.logger.warn(
      `Каталог AUDIO пуст — TTS-модели взяты из MUSIC: ${tts.map((model) => model.id).join(',') || 'нет'}`,
    );

    return tts;
  }

  /**
   * Собирает входные файлы запроса media-генерации (image-to-video).
   *
   * Ключ слота берётся из каталога модели ({@link pickImageInputKey}): у
   * CreativeLab это `first_frame`, `image`, `reference_image` или `keyframes`.
   * Если модель объявлена, но картинок не принимает — понятная ошибка до
   * платного запроса (upstream ответил бы `400 Invalid input`, KI-181).
   *
   * @param node - узел графа (для id в сообщении)
   * @param request - разобранные данные узла (может нести `imageUrl`)
   * @param model - описание модели из каталога (`null` — неизвестна)
   * @returns `{ слот: [url] }` либо `undefined`, если картинка не задана
   * @throws MediaProviderException если модель не принимает изображений
   */
  private buildGenerationInputs(
    node: NodeDto,
    request: GenerationRequest,
    model: MediaModelInfo | null,
  ): Record<string, string[]> | undefined {
    const imageUrl = request.imageUrl;

    if (imageUrl === undefined) {
      return undefined;
    }

    if (model === null) {
      // Каталог модель не знает — слот угадываем по самому частому имени в
      // каталоге CreativeLab (`first_frame`). Это осознанный best-effort:
      // терять ввод пользователя молча нельзя (ср. KI-181).
      this.logger.warn(
        `Media-узел ${node.id}: модель неизвестна каталогу — картинка уйдёт в слот first_frame`,
      );

      return { first_frame: [imageUrl] };
    }

    const key = pickImageInputKey(model);

    if (key === null) {
      throw new MediaProviderException(
        'media',
        `Модель ${model.id} не принимает изображение: уберите imageUrl у узла ${node.id}`,
      );
    }

    return { [key]: [imageUrl] };
  }

  /**
   * Дожидается финального статуса задачи.
   *
   * Общий шаг для генерации и инструментов: задача могла завершиться ещё до
   * опроса (модерация отклонила — сразу `failed`) либо требует опроса с
   * экспоненциальным backoff.
   *
   * @param node - узел графа (для сообщений в логе)
   * @param task - задача, полученная при создании
   * @param mediaType - тип media-узла (для текста ошибки)
   * @returns задача в финальном статусе (`done` или `failed`)
   * @throws MediaProviderException если задача упала или истёк лимит ожидания
   */
  private async awaitTaskAsync(
    node: NodeDto,
    task: MediaTaskResult,
    mediaType: MediaType,
  ): Promise<MediaTaskResult> {
    const finished =
      task.status === 'done' || task.status === 'failed'
        ? task
        : await this.pollAsync(node, task);

    if (finished.status === 'failed') {
      throw new MediaProviderException(
        'media',
        `задача генерации ${finished.taskId} упала: ${finished.error ?? 'причина неизвестна'}`,
      );
    }

    this.logger.debug(
      `Media-узел ${node.id}: задача ${finished.taskId} (${mediaType}) завершена`,
    );

    return finished;
  }

  /**
   * Разбирает `data` узла `image_tool` Zod-схемой (RULES 1.17).
   *
   * @param node - узел графа
   * @returns разобранные данные узла
   * @throws NodeDataValidationException если данные не соответствуют схеме
   */
  private parseToolData(node: NodeDto): ImageToolNodeData {
    const parsed = ImageToolNodeDataSchema.safeParse(node.data);

    if (!parsed.success) {
      const reason = parsed.error.issues
        .map((issue) => {
          const path = issue.path.join('.');

          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join('; ');

      throw new NodeDataValidationException(node.type, reason);
    }

    return parsed.data;
  }

  /**
   * Достаёт ссылку на входной файл инструмента.
   *
   * Приоритет: вход по связи (`inputs.url`) → `data.inputUrl`. Значение из
   * связи не типизировано (outputs предшественника — jsonb), поэтому строка
   * проверяется на `http(s)`.
   *
   * @param node - узел графа
   * @param data - разобранные данные узла
   * @param inputs - нормализованные входы узла
   * @returns публичную ссылку на входной файл
   * @throws MediaProviderException если ссылки нет ни во входе, ни в узле
   */
  private readToolInputUrl(
    node: NodeDto,
    data: ImageToolNodeData,
    inputs: Record<string, unknown>,
  ): string {
    const fromInput = inputs.url;

    if (typeof fromInput === 'string' && isHttpUrl(fromInput)) {
      return fromInput;
    }

    if (data.inputUrl !== undefined) {
      return data.inputUrl;
    }

    throw new MediaProviderException(
      'media',
      `Не задан входной файл узла ${node.id}: соедините узел с источником изображения или заполните inputUrl`,
    );
  }

  /**
   * Собирает параметры вызова инструмента из `data.params`.
   *
   * Служебные ключи (`prompt`, `audioUrl`, `inputs`) прокидываются как есть:
   * их читает провайдер. Остальные скаляры уходят в `params` запроса, где
   * отбираются по схеме модели (KI-181).
   *
   * @param node - узел графа
   * @param data - разобранные данные узла
   * @returns параметры вызова (без `model` и `idempotencyKey` — их ставит executor)
   */
  private readToolParams(
    node: NodeDto,
    data: ImageToolNodeData,
  ): ImageToolParams {
    const params: ImageToolParams = {};
    const raw = isPlainRecord(data.params) ? data.params : ({} as Record<string, unknown>);

    for (const [key, value] of Object.entries(raw)) {
      if (key === 'inputs' && isStringArrayRecord(value)) {
        params.inputs = value;
        continue;
      }

      if (
        key === 'prompt' ||
        key === 'audioUrl' ||
        (isParamValue(value) && !IMAGE_TOOL_RESERVED_PARAM_KEYS.has(key))
      ) {
        params[key] = value;
      }
    }

    // `data.params` пуст, а модель объявляет `prompt: 'required'` — дефолт
    // операции подставит провайдер (см. `DEFAULT_IMAGE_TOOL_PROMPTS`).
    this.logger.debug(
      `Media-инструмент ${node.id}: params=${Object.keys(params).join(',') || 'нет'}`,
    );

    return params;
  }

  /**
   * Находит провайдера и модель-инструмент для операции (R7.1).
   *
   * Маршрутизация — по каталогу: провайдер, объявивший модель, и обслуживает
   * вызов. Если модель не задана, берётся дефолт операции
   * ({@link DEFAULT_IMAGE_TOOL_MODELS}).
   *
   * @param operation - операция инструмента
   * @param requestedModel - id модели из `data.model`, если выбран
   * @returns провайдера и его описание модели (цена нужна для бюджета)
   * @throws MediaProviderException если ни один провайдер не сконфигурирован,
   *   у операции нет дефолтной модели или модель не объявлена каталогом
   */
  private async resolveToolTargetAsync(
    operation: ImageToolOperation,
    requestedModel: string | undefined,
  ): Promise<{ provider: IMediaProvider; model: MediaModelInfo }> {
    const modelId = requestedModel ?? DEFAULT_IMAGE_TOOL_MODELS[operation];

    if (!modelId) {
      throw new MediaProviderException(
        'media',
        `Для операции ${operation} не выбрана модель: укажите id модели-инструмента из каталога`,
      );
    }

    const configured = this.providers.filter((provider) => provider.isConfigured);

    if (configured.length === 0) {
      throw new MediaProviderException(
        'media',
        'Нет сконфигурированных media-провайдеров',
      );
    }

    for (const provider of configured) {
      const models = await provider.listModelsAsync();
      const model = models.find((candidate) => candidate.id === modelId);

      if (model) {
        return { provider, model };
      }
    }

    throw new MediaProviderException(
      'media',
      `Модель-инструмент не найдена в каталоге media: ${modelId}`,
    );
  }

  /**
   * Находит модель в каталогах провайдеров — для оценки стоимости вызова.
   *
   * Возвращает именно описание модели, а не цену: бюджету нужен весь блок
   * `pricing` (KI-384), а не устаревшее поле `price`.
   *
   * @param node - узел графа (для лога)
   * @param modelId - id модели
   * @returns описание модели либо `null`, если её не объявил ни один провайдер
   *   (оценка тогда нулевая — превышение ловится по уже потраченному)
   */
  private async findModelAsync(
    node: NodeDto,
    modelId: string,
  ): Promise<MediaModelInfo | null> {
    const configured = this.providers.filter((provider) => provider.isConfigured);

    for (const provider of configured) {
      const models = await provider.listModelsAsync();
      const model = models.find((candidate) => candidate.id === modelId);

      if (model) {
        return model;
      }
    }

    this.logger.debug(
      `Media-узел ${node.id}: модель ${modelId} не найдена в каталоге — оценка стоимости 0`,
    );

    return null;
  }

  /**
   * Проверяет бюджет запуска перед платным вызовом (KI-048).
   *
   * @param runId - uuid запуска
   * @param priceRub - оценка стоимости вызова в рублях
   * @throws BudgetExceededException если бюджет исчерпан, а режим — `hard`
   */
  private async assertBudgetAsync(runId: string, priceRub: number): Promise<void> {
    await this.costBudget.assertWithinBudgetAsync(runId, { rub: priceRub });
  }

  /**
   * Сохраняет результат генерации в media-хранилище (R7.8, KI-362).
   *
   * Скачивание идёт сразу после успешной задачи: ссылка провайдера живёт
   * 48 часов, а `node_runs.stored_url` должен остаться рабочим после них.
   *
   * **Ошибка сохранения не роняет узел.** Генерация уже оплачена, и её
   * результат доступен по ссылке провайдера: упасть здесь — значит потерять
   * уже полученный результат из-за сбоя диска/сети. Поэтому ошибка только
   * логируется, а узел отдаёт `storedUrl: null` (UI берёт ссылку провайдера).
   *
   * @param node - узел графа (id — второй сегмент ключа)
   * @param runId - uuid запуска (первый сегмент ключа)
   * @param mediaUrl - ссылка провайдера на результат (`undefined` — ссылки нет)
   * @returns сохранённый файл либо `null` (сохранение выключено/упало)
   */
  private async storeResultAsync(
    node: NodeDto,
    runId: string,
    mediaUrl: string | undefined,
  ): Promise<MediaStoredFile | null> {
    if (
      this.storage === undefined ||
      this.storage.backend === 'none' ||
      mediaUrl === undefined
    ) {
      return null;
    }

    try {
      return await this.storage.uploadAsync({
        runId,
        nodeId: node.id,
        sourceUrl: mediaUrl,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Media-узел ${node.id}: не удалось сохранить результат (${message}) — ` +
          'остаётся ссылка провайдера',
      );

      return null;
    }
  }

  /**
   * Опрашивает задачу до финального статуса с экспоненциальным backoff.
   *
   * Схема: старт 2 с, множитель 1.5, cap 15 с. Общий лимит ожидания —
   * `CREATIVELAB_MEDIA_TIMEOUT_MS` (R7.2: дефолт 10 минут; видео генерируется
   * минутами), после чего узел падает с `MediaProviderException` (повтор на
   * уровне job'а подхватит задачу по тому же ключу идемпотентности).
   *
   * @param node - узел графа (для сообщений в логе)
   * @param initial - задача, полученная при создании
   * @returns задача в финальном статусе (`done` или `failed`)
   * @throws MediaProviderException если истёк общий таймаут ожидания
   */
  private async pollAsync(
    node: NodeDto,
    initial: MediaTaskResult,
  ): Promise<MediaTaskResult> {
    const timeoutMs = this.readMediaTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    let delay = POLL_INITIAL_DELAY_MS;
    let last = initial;

    while (Date.now() < deadline) {
      await sleep(delay);

      last = await this.registry.getTaskAsync(initial.taskId);

      if (last.status === 'done' || last.status === 'failed') {
        return last;
      }

      this.logger.debug(
        `Media-узел ${node.id}: задача ${last.taskId} в статусе ${last.status}, следующая проверка через ${delay} мс`,
      );

      delay = Math.min(Math.round(delay * POLL_BACKOFF_FACTOR), POLL_MAX_DELAY_MS);
    }

    throw new MediaProviderException(
      'media',
      `задача генерации ${initial.taskId} не завершилась за ${timeoutMs / 1000} с`,
    );
  }

  /**
   * Читает лимит ожидания media-задачи из окружения (RULES 4.6).
   *
   * Исполнителя собирают и без `ConfigService` (юнит-тесты инструментов
   * R7.1), поэтому отсутствие конфига — не ошибка: берётся дефолт
   * {@link DEFAULT_MEDIA_TIMEOUT_MS}.
   *
   * @returns лимит ожидания в миллисекундах
   */
  private readMediaTimeoutMs(): number {
    const configured = this.config?.get<number>('CREATIVELAB_MEDIA_TIMEOUT_MS');

    return typeof configured === 'number' &&
      Number.isFinite(configured) &&
      configured > 0
      ? configured
      : DEFAULT_MEDIA_TIMEOUT_MS;
  }

  /**
   * Достаёт промпт узла (KI-166).
   *
   * Приоритет источников:
   * 1. вход `prompt` — связь от Text/LLM-узла;
   * 2. `data.prompt` — промпт, введённый прямо в узле Image Generation;
   * 3. `data.value` — то же поле у workflow, сохранённых до появления
   *    `data.prompt` (обратная совместимость).
   *
   * @param node - узел графа
   * @param inputs - нормализованные входы
   * @returns промпт либо пустую строку
   */
  private readPrompt(node: NodeDto, inputs: Record<string, unknown>): string {
    if (typeof inputs.prompt === 'string' && inputs.prompt.length > 0) {
      return inputs.prompt;
    }

    if (typeof node.data.prompt === 'string' && node.data.prompt.length > 0) {
      return node.data.prompt;
    }

    return typeof node.data.value === 'string' ? node.data.value : '';
  }

  /**
   * Достаёт id модели узла.
   *
   * @param node - узел графа
   * @returns id модели
   * @throws MediaProviderException если модель не задана
   */
  private readModel(node: NodeDto): string {
    const model = node.data.model;

    if (typeof model === 'string' && model.length > 0) {
      return model;
    }

    throw new MediaProviderException(
      'media',
      `Не задана модель media-узла ${node.id}`,
    );
  }

  /**
   * Собирает параметры генерации из данных узла (KI-181).
   *
   * Набор параметров у моделей разный, поэтому он берётся из каталога
   * (`MediaModelInfo.params`), а не хардкодится: в запрос уходят только ключи,
   * объявленные самой моделью. Это отсекает опечатки и «чужие» параметры
   * (например `aspect_ratio` для модели, которая его не принимает) — upstream
   * на такое отвечает `Invalid input, check schema issues`, не объясняя причину.
   *
   * Источники значений по приоритету:
   * 1. `data.params` — явный объект от UI;
   * 2. отдельные поля узла (`data.aspectRatio` → `aspect_ratio`);
   * 3. `default` из каталога — чтобы модель со обязательным параметром
   *    получила значение, даже если пользователь его не выбирал.
   *
   * @param node - узел графа
   * @param modelId - id модели, для которой собираются параметры
   * @returns параметры генерации, поддерживаемые моделью
   * @deprecated используйте {@link filterParamsAsync} напрямую: узел сам решает,
   *   какие поля превращаются в параметры (R7.2)
   */
  private async readParamsAsync(
    node: NodeDto,
    modelId: string,
  ): Promise<Record<string, string | number | boolean>> {
    return this.filterParamsAsync(modelId, readRequestedParams(node));
  }

  /**
   * Оставляет только параметры, объявленные моделью (KI-181), и приводит
   * значения к схеме каталога.
   *
   * Правила приведения:
   * - значение вне объявленного `enum` (`options`) заменяется на `default`
   *   модели с предупреждением в логе: upstream на чужое значение отвечает
   *   `Invalid input, check schema issues`, не объясняя причину, а молча
   *   отправлять заведомо отвергаемое значение — платный отказ;
   * - число вне `min`/`max` каталога зажимается в диапазон (та же причина);
   * - параметры без `options` (реальный каталог CreativeLab часто не отдаёт их
   *   для `aspect_ratio`) уходят как есть — подменять ввод пользователя нечем.
   *
   * @param modelId - id модели, для которой собираются параметры
   * @param requested - значения, запрошенные данными узла
   * @returns параметры, поддерживаемые моделью
   */
  private async filterParamsAsync(
    modelId: string,
    requested: Record<string, string | number | boolean>,
  ): Promise<Record<string, string | number | boolean>> {
    const declared = await this.registry.findParamsAsync(modelId);

    // Модели неизвестны её параметры (нет в каталоге) — отправляем как есть:
    // лучше попробовать, чем молча потерять ввод пользователя.
    if (declared === null) {
      return requested;
    }

    const params: Record<string, string | number | boolean> = {};

    for (const param of declared) {
      const value = coerceParamValue(
        requested[param.key] ?? param.default,
        param,
      );

      if (value !== undefined) {
        params[param.key] = value;
      }
    }

    return params;
  }

  /**
   * Определяет тип media-модели по данным узла.
   *
   * Пока media-провайдер один и узел всегда генерирует изображение, поэтому
   * дефолт — `IMAGE`; поле `data.mediaType` позволяет переопределить тип, когда
   * появятся video/audio-узлы (v0.6.0b.2.x).
   *
   * @param node - узел графа
   * @returns тип модели
   */
  private readMediaType(node: NodeDto): MediaType {
    const candidate = node.data.mediaType;

    return candidate === 'VIDEO' ||
      candidate === 'AUDIO' ||
      candidate === 'MUSIC' ||
      candidate === '3D' ||
      candidate === 'IMAGE' ||
      candidate === 'TOOL'
      ? candidate
      : 'IMAGE';
  }
}

/**
 * Приводит значение параметра к схеме, объявленной каталогом (KI-181).
 *
 * @param value - значение из `data.params`/полей узла либо `default` каталога
 * @param param - описание параметра из каталога
 * @returns значение, допустимое моделью, либо `undefined` — параметр не отправляем
 */
function coerceParamValue(
  value: unknown,
  param: MediaParam,
): string | number | boolean | undefined {
  if (!isParamValue(value)) {
    return undefined;
  }

  if (param.options !== undefined && param.options.length > 0) {
    const match = param.options.find(
      (option) => String(option.value) === String(value),
    );

    // Значения нет среди объявленных: отправлять его нельзя (upstream ответит
    // `Invalid input`), поэтому берём default модели, а если его нет — не
    // отправляем параметр вовсе.
    return match !== undefined
      ? match.value
      : isParamValue(param.default)
        ? param.default
        : undefined;
  }

  if (param.type === 'number' && typeof value === 'number') {
    const min = typeof param.min === 'number' ? param.min : undefined;
    const max = typeof param.max === 'number' ? param.max : undefined;

    if (min !== undefined && value < min) {
      return min;
    }

    if (max !== undefined && value > max) {
      return max;
    }
  }

  return value;
}

/**
 * Собирает запрошенные параметры узла `video_generation`.
 *
 * `durationSec` → `duration`, `aspectRatio` → `aspect_ratio`; ключи, которых у
 * модели нет, отсеет фильтр по каталогу ({@link MediaNodeExecutor.filterParamsAsync}).
 *
 * @param node - узел графа (`data.params`, `data.aspectRatio`)
 * @param data - разобранные данные узла
 * @returns запрошенные параметры
 */
function buildVideoParams(
  node: NodeDto,
  data: VideoGenNodeData,
): Record<string, string | number | boolean> {
  const params = readRequestedParams(node);

  if (!(DURATION_PARAM_KEY in params) && data.durationSec !== undefined) {
    params[DURATION_PARAM_KEY] = data.durationSec;
  }

  return params;
}

/**
 * Собирает запрошенные параметры узла `audio_generation`.
 *
 * `voiceId` раскладывается по возможным ключам каталога (`voice`, `voice_id`),
 * `speed` → `speed`; лишние ключи отсеет фильтр по каталогу.
 *
 * @param node - узел графа (`data.params`)
 * @param data - разобранные данные узла
 * @returns запрошенные параметры
 */
function buildAudioParams(
  node: NodeDto,
  data: AudioGenNodeData,
): Record<string, string | number | boolean> {
  const params = readRequestedParams(node);

  addAliasedParam(params, VOICE_PARAM_KEYS, data.voiceId);

  if (!(SPEED_PARAM_KEY in params) && data.speed !== undefined) {
    params[SPEED_PARAM_KEY] = data.speed;
  }

  return params;
}

/**
 * Собирает запрошенные параметры узла `music_generation`.
 *
 * `durationSec` → `duration`, `genre` → `genre`/`tags`; лишние ключи отсеет
 * фильтр по каталогу.
 *
 * @param node - узел графа (`data.params`)
 * @param data - разобранные данные узла
 * @returns запрошенные параметры
 */
function buildMusicParams(
  node: NodeDto,
  data: MusicGenNodeData,
): Record<string, string | number | boolean> {
  const params = readRequestedParams(node);

  if (!(DURATION_PARAM_KEY in params) && data.durationSec !== undefined) {
    params[DURATION_PARAM_KEY] = data.durationSec;
  }

  addAliasedParam(params, GENRE_PARAM_KEYS, data.genre);

  return params;
}

/**
 * Добавляет значение под всеми возможными ключами каталога.
 *
 * У моделей одного назначения ключи называются по-разному (`voice` у `tts2`,
 * `voice_id` у других провайдеров; `genre` и `tags` у music-моделей). Ключ,
 * которого у модели нет, отсеет фильтр по каталогу — а если есть хоть один,
 * значение доедет до upstream.
 *
 * @param params - набор запрошенных параметров (мутируется)
 * @param keys - возможные ключи
 * @param value - значение из данных узла
 */
function addAliasedParam(
  params: Record<string, string | number | boolean>,
  keys: readonly string[],
  value: unknown,
): void {
  if (!isParamValue(value)) {
    return;
  }

  for (const key of keys) {
    if (!(key in params)) {
      params[key] = value;
    }
  }
}

/**
 * Достаёт текст синтеза узла `audio_generation`.
 *
 * Приоритет: вход `prompt` (связь от Text/LLM) → `data.text`.
 *
 * @param node - узел графа
 * @param inputs - нормализованные входы узла
 * @param data - разобранные данные узла
 * @returns текст для TTS либо пустую строку
 */
function readAudioText(
  node: NodeDto,
  inputs: Record<string, unknown>,
  data: AudioGenNodeData,
): string {
  if (typeof inputs.prompt === 'string' && inputs.prompt.length > 0) {
    return inputs.prompt;
  }

  return data.text ?? '';
}

/**
 * Достаёт ссылку на изображение для image-to-video.
 *
 * Приоритет: вход `url` (связь от media-узла) → `data.imageUrl`. Значение из
 * связи не типизировано (jsonb), поэтому проверяется на `http(s)` (KI-006).
 *
 * @param inputs - нормализованные входы узла
 * @param data - разобранные данные узла
 * @returns ссылку на изображение либо `undefined`
 */
function readVideoImageUrl(
  inputs: Record<string, unknown>,
  data: VideoGenNodeData,
): string | undefined {
  const fromInput = inputs.url;

  if (typeof fromInput === 'string' && isHttpUrl(fromInput)) {
    return fromInput;
  }

  return data.imageUrl;
}

/**
 * Проверяет, допустим ли тип модели для аудио-узла.
 *
 * Каталог CreativeLab не отдаёт `type=AUDIO`: TTS-модель `tts2` объявлена как
 * `MUSIC`. Для узла `audio_generation` такая модель — валидный выбор, а
 * генератор музыки (`suno`) — нет: узлу нужен синтез речи.
 *
 * @param mediaType - тип модели, требуемый узлом
 * @param model - модель из каталога
 * @returns `true`, если модель подходит узлу
 */
function isAudioFallback(mediaType: MediaType, model: MediaModelInfo): boolean {
  return mediaType === 'AUDIO' && isTtsModel(model);
}

/**
 * Проверяет, что значение параметра — скаляр, допустимый в запросе.
 *
 * @param value - значение из `data.params` или `default` каталога
 * @returns `true` для строки, числа или булева
 */
function isParamValue(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Собирает параметры, запрошенные данными узла (KI-181).
 *
 * @param node - узел графа
 * @returns скалярные значения из `data.params` плюс `data.aspectRatio`
 */
function readRequestedParams(
  node: NodeDto,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {};

  const raw = node.data.params;

  if (isPlainRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (isParamValue(value)) {
        params[key] = value;
      }
    }
  }

  // Отдельные поля узла — только если их не переопределил data.params.
  if (
    typeof node.data.aspectRatio === 'string' &&
    !(ASPECT_RATIO_PARAM_KEY in params)
  ) {
    params[ASPECT_RATIO_PARAM_KEY] = node.data.aspectRatio;
  }

  return params;
}

/**
 * Проверяет, что значение — обычный объект (не массив и не `null`).
 *
 * @param value - значение из `data` узла (внешние данные, RULES 1.17)
 * @returns `true`, если это объект-словарь
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверяет, что строка — `http(s)`-ссылка.
 *
 * Ссылка от предшественника приходит из jsonb без типов, а `<img>`/upstream
 * принимают только `http(s)` (KI-006).
 *
 * @param value - значение из outputs предшественника
 * @returns `true`, если это `http`/`https`-URL
 */
function isHttpUrl(value: string): boolean {
  return value.startsWith('https://') || value.startsWith('http://');
}

/**
 * Проверяет, что значение — словарь «ключ → массив строк».
 *
 * Нужен для явно заданных входных слотов инструмента (`params.inputs`,
 * KI-196): форма приходит из jsonb, поэтому проверяется на границе (RULES 1.17).
 *
 * @param value - значение из `data.params.inputs`
 * @returns `true`, если это `Record<string, string[]>`
 */
function isStringArrayRecord(
  value: unknown,
): value is Record<string, string[]> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every(
      (item) => Array.isArray(item) && item.every((url) => typeof url === 'string'),
    )
  );
}

/**
 * Пауза между опросами задачи.
 *
 * @param ms - длительность паузы в миллисекундах
 * @returns промис, который завершится через `ms` мс
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
