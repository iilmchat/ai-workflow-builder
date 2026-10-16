import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { NodeDto } from '../engine/dto/index.js';
import { NodeDataValidationException } from '../engine/node-executors.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import {
  DEFAULT_IMAGE_TOOL_MODELS,
  IMAGE_TOOL_OPERATIONS,
  IMAGE_TOOL_RESERVED_PARAM_KEYS,
  type ImageToolOperation,
  type ImageToolParams,
} from './image-tool.js';
import {
  MEDIA_PROVIDERS,
  MediaRegistryService,
} from './media-registry.service.js';
import {
  MediaProviderException,
  type IMediaProvider,
  type MediaModelInfo,
  type MediaType,
} from './media-provider.interface.js';
import type { MediaTaskResult } from './dto/media-task.mapper.js';

/** Модель по умолчанию, если узел её не задал. */
export const DEFAULT_MEDIA_MODEL = 'flux-schnell';

/** Стартовая пауза опроса задачи (мс). */
const POLL_INITIAL_DELAY_MS = 2_000;
/** Множитель экспоненциального backoff (RULES 1.19). */
const POLL_BACKOFF_FACTOR = 1.5;
/** Верхняя граница паузы между опросами (мс) — cap для backoff. */
const POLL_MAX_DELAY_MS = 15_000;
/** Общий лимит ожидания задачи (мс). */
const POLL_TIMEOUT_MS = 300_000;

/** Метрики выполнения media-узла (для записи в `node_runs`, валюта — RUB). */
export interface MediaNodeMetrics {
  /** Стоимость генерации в рублях (`null`, если upstream её не отдал). */
  costRub: number | null;
  /** Тип модели (IMAGE/VIDEO/...) — для UI-бейджей в v0.6.0b.2.3. */
  mediaType: MediaType;
  /** id задачи в upstream (для диагностики). */
  taskId: string;
}

/** Результат выполнения media-узла: выходы + метрики. */
export interface MediaNodeExecutionResult {
  /** Выходы узла (`{ mediaUrl, mediaType, taskId }`). */
  outputs: Record<string, unknown>;
  /** Метрики генерации. */
  metrics: MediaNodeMetrics;
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
 * Исполнитель узла типа `image_generation` (v0.6.0b.2.2) и `image_tool` (R7.1).
 *
 * Отдельный DI-сервис по той же причине, что и `LlmNodeExecutor`: узел ходит
 * во внешний API, ему нужен реестр провайдеров. `node-executors` остаются
 * реестром чистых преобразований.
 *
 * Генерация асинхронная, поэтому узел делает `createTask` (с `wait: true` —
 * upstream держит соединение до 30 секунд) и, если задача не успела
 * завершиться, опрашивает её с экспоненциальным backoff до 5 минут (RULES 1.19).
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
 */
@Injectable()
export class MediaNodeExecutor {
  private readonly logger = new Logger(MediaNodeExecutor.name);

  /**
   * @param registry - реестр media-провайдеров (задачи генерации и опрос)
   * @param providers - сами media-провайдеры: нужны для инструментов (R7.1),
   *   которых в реестре R7.3 ещё нет
   * @param costBudget - предохранитель по стоимости запуска (KI-048)
   */
  constructor(
    private readonly registry: MediaRegistryService,
    @Inject(MEDIA_PROVIDERS) private readonly providers: readonly IMediaProvider[],
    private readonly costBudget: CostBudgetService,
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

    // R7.1 (KI-048): бюджет запуска проверяется ДО платного вызова. Оценка —
    // цена модели из каталога (CreativeLab тарифицирует в рублях); если модель
    // неизвестна каталогу, оценка нулевая — превышение всё равно ловится по
    // уже потраченному.
    await this.assertBudgetAsync(runId, await this.findModelPriceRubAsync(node, model));

    // Ключ стабилен при повторе: тот же runId и nodeId на job-level retry
    // (KI-040) не создадут вторую платную генерацию.
    const idempotencyKey = `${runId}:${node.id}`;

    // RULES 5.9: промпт целиком в лог не пишем — только длину.
    this.logger.log(
      `Media-узел ${node.id}: model=${model}, promptLen=${prompt.length}, type=${mediaType}`,
    );

    const task = await this.registry.createTaskAsync({
      model,
      prompt,
      params,
      idempotencyKey,
      wait: true,
    });

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

    const metrics: MediaNodeMetrics = {
      costRub: finished.costRub,
      mediaType,
      taskId: finished.taskId,
    };

    this.logger.log(
      `Media-узел ${node.id}: cost=${metrics.costRub ?? '?'}₽, url=${finished.resultUrls[0] ?? '?'}`,
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

    // Бюджет проверяется до платного вызова (KI-048). Оценка — цена модели из
    // каталога в рублях; CostBudgetService сам нормализует её в USD.
    await this.assertBudgetAsync(runId, target.model.price);

    const task = await target.provider.applyToolAsync(inputUrl, data.operation, {
      ...this.readToolParams(node, data),
      model: target.model.id,
      // Ключ стабилен при повторе: тот же runId и nodeId на job-level retry
      // (KI-040) не создадут вторую платную задачу.
      idempotencyKey: `${runId}:${node.id}`,
    });

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

    const metrics: MediaNodeMetrics = {
      costRub: finished.costRub,
      mediaType: 'TOOL',
      taskId: finished.taskId,
    };

    this.logger.log(
      `Media-инструмент ${node.id}: cost=${metrics.costRub ?? '?'}₽, url=${finished.resultUrls[0] ?? '?'}`,
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
   * Возвращает цену модели из каталога (оценка стоимости вызова для бюджета).
   *
   * @param node - узел графа (для лога)
   * @param modelId - id модели
   * @returns цену в рублях; `0`, если модель не объявлена ни одним провайдером
   *   (оценка тогда нулевая — превышение ловится по уже потраченному)
   */
  private async findModelPriceRubAsync(
    node: NodeDto,
    modelId: string,
  ): Promise<number> {
    const configured = this.providers.filter((provider) => provider.isConfigured);

    for (const provider of configured) {
      const models = await provider.listModelsAsync();
      const model = models.find((candidate) => candidate.id === modelId);

      if (model) {
        return model.price;
      }
    }

    this.logger.debug(
      `Media-узел ${node.id}: модель ${modelId} не найдена в каталоге — оценка стоимости 0`,
    );

    return 0;
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
   * Опрашивает задачу до финального статуса с экспоненциальным backoff.
   *
   * Схема: старт 2 с, множитель 1.5, cap 15 с. Общий лимит ожидания — 5 минут,
   * после чего узел падает с `MediaProviderException` (повтор на уровне job'а
   * подхватит задачу по тому же ключу идемпотентности).
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
    const deadline = Date.now() + POLL_TIMEOUT_MS;
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
      `задача генерации ${initial.taskId} не завершилась за ${POLL_TIMEOUT_MS / 1000} с`,
    );
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
   */
  private async readParamsAsync(
    node: NodeDto,
    modelId: string,
  ): Promise<Record<string, string | number | boolean>> {
    const declared = await this.registry.findParamsAsync(modelId);
    const requested = readRequestedParams(node);

    // Модели неизвестны её параметры (нет в каталоге) — отправляем как есть:
    // лучше попробовать, чем молча потерять ввод пользователя.
    if (declared === null) {
      return requested;
    }

    const params: Record<string, string | number | boolean> = {};

    for (const param of declared) {
      const value = requested[param.key] ?? param.default;

      if (isParamValue(value)) {
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
  if (typeof node.data.aspectRatio === 'string' && !('aspect_ratio' in params)) {
    params.aspect_ratio = node.data.aspectRatio;
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
