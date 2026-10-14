import { Injectable, Logger } from '@nestjs/common';
import type { NodeDto } from '../engine/dto/index.js';
import {
  MediaProviderException,
  type MediaType,
} from './media-provider.interface.js';
import { MediaRegistryService } from './media-registry.service.js';
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
 * Исполнитель узла типа `image_generation` (v0.6.0b.2.2).
 *
 * Отдельный DI-сервис по той же причине, что и `LlmNodeExecutor`: узел ходит
 * во внешний API, ему нужен реестр провайдеров. `node-executors` остаются
 * реестром чистых преобразований.
 *
 * Генерация асинхронная, поэтому узел делает `createTask` (с `wait: true` —
 * upstream держит соединение до 30 секунд) и, если задача не успела
 * завершиться, опрашивает её с экспоненциальным backoff до 5 минут (RULES 1.19).
 */
@Injectable()
export class MediaNodeExecutor {
  private readonly logger = new Logger(MediaNodeExecutor.name);

  /**
   * @param registry - реестр media-провайдеров (источник задач генерации)
   */
  constructor(private readonly registry: MediaRegistryService) {}

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
      candidate === 'IMAGE'
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
