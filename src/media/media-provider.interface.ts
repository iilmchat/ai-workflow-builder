/**
 * Типы и интерфейс media-провайдеров (v0.6.0b.2.1, задачи — v0.6.0b.2.2).
 *
 * Отличие от LLM-провайдеров (`ILlmProvider`): результат генерации — не текст,
 * а URL-ы файлов, а сама генерация асинхронная (создание задачи → опрос
 * статуса). Поэтому интерфейс работает с задачами, а не с `generateAsync`.
 */

import type { MediaTaskResult } from './dto/media-task.mapper.js';
import type { ImageToolOperation, ImageToolParams } from './image-tool.js';

/**
 * Тип media-модели (совпадает с полем `type` у GPTunnel CreativeLab).
 *
 * `TOOL` (R7.1, DESIGN v0.9 § 2.4) — media-**инструмент**: модель, которая не
 * создаёт файл «с нуля», а преобразует входной (upscale, удаление фона,
 * липсинк). На момент R7.1 каталог CreativeLab такого типа не отдаёт (все
 * инструменты приходят как `IMAGE`/`VIDEO` с обязательным входным слотом), но
 * значение заведено: провайдеры R7.3 (Replicate/FAL/OpenAI) и будущие версии
 * upstream могут помечать инструменты явно.
 */
export type MediaType = 'IMAGE' | 'VIDEO' | 'AUDIO' | 'MUSIC' | '3D' | 'TOOL';

/**
 * Полный список типов для рантайм-валидации.
 *
 * Дублирует {@link MediaType}: тип живёт только на этапе компиляции, а
 * валидация внешних данных (query, ответ upstream) нуждается в списке
 * значений во время работы.
 */
export const MEDIA_TYPES: readonly MediaType[] = [
  'IMAGE',
  'VIDEO',
  'AUDIO',
  'MUSIC',
  '3D',
  'TOOL',
];

/** Вариант значения для параметра типа `enum`. */
export interface MediaParamEnumOption {
  /** Значение, которое уходит в API. */
  value: string | number;
  /** i18n-ключ подписи от upstream (например, `wfc_opt_dur_n`). */
  label: string;
}

/**
 * Один параметр генерации: dynamic schema от upstream.
 *
 * Набор полей зависит от `type`, поэтому интерфейс допускает дополнительные
 * ключи (`[key: string]: unknown`) — терять их нельзя, они описывают схему
 * формы для UI.
 */
export interface MediaParam {
  /** Ключ параметра, уходит в API как есть. */
  key: string;
  /** Тип значения. */
  type: 'enum' | 'number' | 'string' | 'boolean';
  /** i18n-ключ подписи от upstream. */
  label: string;
  /** i18n-ключ описания. */
  description?: string;
  /** Значение по умолчанию. */
  default?: string | number | boolean;
  /** Варианты для `type: 'enum'`. */
  options?: MediaParamEnumOption[];
  /** Минимум для `type: 'number'`. */
  min?: number;
  /** Максимум для `type: 'number'`. */
  max?: number;
  /** Шаг для `type: 'number'`. */
  step?: number;
  /** Только целые значения (`type: 'number'`). */
  integer?: boolean;
  /** Единица измерения (`sec`, `px`, ...). */
  unit?: string;
  /** Максимальная длина для `type: 'string'`. */
  maxLength?: number;
  /** Прочие поля схемы от upstream. */
  [key: string]: unknown;
}
/** Входной слот модели (изображение/видео/аудио). */
export interface MediaInput {
  /** Ключ слота, уходит в API как есть. */
  key: string;
  /** Что принимает слот. */
  kind: 'image' | 'video' | 'audio';
  /** Роль слота: `reference`, `first_frame`, `last_frame`, ... */
  role?: string;
  /** Обязателен ли слот. */
  required: boolean;
  /** Сколько файлов принимает слот. */
  count?: { min: number; max: number };
  /** Разрешённые форматы (`png`, `jpg`, ...). */
  formats?: string[];
  /** Максимальный размер файла в байтах. */
  maxBytes?: number;
  /** Допустимая длительность для видео/аудио. */
  duration?: { minSec?: number; maxSec?: number };
  /** Допустимые размеры (например, `{ width: 1024, height: 1024 }`). */
  dimensions?: Record<string, number>;
  /** Прочие поля слота от upstream. */
  [key: string]: unknown;
}

/**
 * Правило совместимости входов.
 *
 * Upstream отдаёт разные виды правил (`requires`, `mutuallyExclusive`,
 * `oneOf`, ...), поэтому кроме `type` поля не типизированы: интерпретировать
 * их будет UI/валидатор соединений (v0.6.0b.2.x).
 */
export interface MediaRule {
  /** Вид правила. */
  type: string;
  /** Параметры правила. */
  [key: string]: unknown;
}

/**
 * Условие тарифа матрицы: значения параметров вызова, при которых он действует.
 *
 * Например, `{ resolution: '720p', variant: 'base' }`. Значения приходят из
 * jsonb/каталога, поэтому не типизированы уже — сравнение идёт по строковому
 * представлению (`'720p'` и `720` различаются, как и в upstream).
 */
export interface MediaPricingCondition {
  /** Параметр вызова → ожидаемое значение. */
  [key: string]: unknown;
}

/** Один тариф матрицы `pricing.matrix`/`pricing.tiers` (KI-384). */
export interface MediaPricingTier {
  /** Стоимость по тарифу, ₽ (за вызов либо за единицу — см. `unitParam`). */
  cost: number;
  /** Условия применения; без условия тариф считается default-ом. */
  condition?: MediaPricingCondition;
  /** Прочие поля тарифа от upstream. */
  [key: string]: unknown;
}

/**
 * Доплата матрицы `pricing.plus` (например, за дополнительные референсы).
 *
 * `rate`/`param` необязательны: upstream кладёт в `plus` и составные доплаты
 * (`base`/`unitsSum`/`tierRates`), которые бюджет пока не интерпретирует —
 * калькулятор пропускает их, а не падает.
 */
export interface MediaPricingPlus {
  /** Цена за единицу сверх `free`, ₽. */
  rate?: number;
  /** Параметр вызова, задающий количество. */
  param?: string;
  /** Сколько единиц входит в базовый тариф бесплатно. */
  free?: number;
  /** Прочие поля доплаты от upstream. */
  [key: string]: unknown;
}

/**
 * Блок тарификации модели из каталога (KI-384).
 *
 * До R7.2b `pricing` не читался вовсе, а бюджет (KI-048) оценивался по полю
 * `price`, которое расходится с фактическим списанием (`glabs-veo-3`: 480 vs
 * 960; `tts2`: 0 vs 2.04 ₽). Поля повторяют ответ upstream: часть из них
 * приходит в camelCase (`baseRates`, `ratePer1K`, `unitParam`), поэтому
 * маппер их не переименовывает. Все поля необязательны — набор зависит от
 * `type`.
 */
export interface MediaPricing {
  /** Вид тарификации (`fixed`, `per_second`, `per_character`, `matrix`, ...). */
  type?: string;
  /** Фиксированная цена вызова, ₽ (упрощённая форма). */
  fixed?: number;
  /** Фиксированная цена вызова, ₽ (форма upstream `type: 'fixed'`). */
  cost?: number;
  /** Цена за секунду, ₽ (упрощённая форма). */
  per_second?: number;
  /** Цена за 1000 символов текста (`tts2`, вложенная форма). */
  per_character?: { ratePer1K: number; [key: string]: unknown };
  /**
   * Цена за 1000 символов текста в реальном ответе upstream (`tts2`:
   * `{ type: 'per_character', ratePer1K: 60 }`). Поддерживаются обе формы.
   */
  ratePer1K?: number;
  /** Таблица тарифов. */
  matrix?: MediaPricingTier[];
  /** Таблица тарифов (синоним `matrix`). */
  tiers?: MediaPricingTier[];
  /** Доплаты к тарифу. */
  plus?: MediaPricingPlus[];
  /** Базовые ставки per_second по значению `baseBy` (`{ '': 32 }`). */
  baseRates?: Record<string, number>;
  /** Параметр, по которому выбирается ставка `baseRates`. */
  baseBy?: string;
  /** Параметр-множитель количества (`duration`). */
  unitParam?: string;
  /** Ставки `per_resolution` по значению `rateBy`. */
  rates?: Record<string, number>;
  /** Параметр, по которому выбирается ставка `rates`. */
  rateBy?: string;
  /** Ставки `expr` по значению `tierBy`. */
  tierRates?: Record<string, number>;
  /** Параметр, по которому выбирается ставка `tierRates`. */
  tierBy?: string;
  /** Единицы `expr`: строка `'duration'` либо объект `{ key, scale }`. */
  units?: unknown[];
  /** Прочие поля тарифа от upstream. */
  [key: string]: unknown;
}

/**
 * Публичное описание media-модели для UI.
 *
 * Имена полей — camelCase (RULES 4.23): snake_case остаётся только в DTO
 * границы, где Zod читает ответ upstream как есть.
 */
export interface MediaModelInfo {
  /** id, который уходит в `POST /media/tasks`. */
  id: string;
  /** Короткий код модели (может отличаться от id). */
  code: string;
  /** Тип модели. */
  type: MediaType;
  /**
   * Имя провайдера, объявившего модель (R7.3, DESIGN v0.9 § 3.3).
   *
   * Нужно UI: в селекте модели узла `image_generation` модели группируются по
   * провайдеру (`[Replicate] flux-pro-1.1-ultra`). Опционально, потому что
   * каталог CreativeLab это поле не отдаёт — его проставляет провайдер при
   * построении `MediaModelInfo`.
   */
  provider?: string;
  /** Цена за генерацию (рубли). Может быть `0` — см. `priceUnit`. */
  price: number;

  /** «per_generation» / «per_second» / …; null — тариф по входу (KI-112). */
  /** Единица тарификации: `per_generation`, `per_second`, `per_character`. */
  priceUnit: string | null;
  /** Ставка за вход (например, per_character); null — тариф за генерацию. */
  priceInput: number | null;
  /** За что берётся priceInput («per_character», «per_1k_tokens»); null — не применимо. */
  priceInputUnit: string | null;
  /**
   * Честный тариф upstream (KI-384); `undefined`, если блока нет.
   *
   * Нужен бюджету запуска: `price` — устаревшая оценка, а фактическое списание
   * считается по `pricing` и параметрам вызова
   * (`calculateMediaCostEstimate`).
   */
  pricing?: MediaPricing;
  /** Режим модерации промпта. */
  moderation: 'auto' | 'strict';
  /** Обязательность промпта. */
  prompt: 'required' | 'optional' | 'none';
  /** Параметры генерации. */
  params: MediaParam[];
  /** Входные слоты. */
  inputs: MediaInput[];
  /** Правила совместимости входов. */
  rules?: MediaRule[];
  /** Модель снята с обслуживания (запрос редиректится). */
  deprecated?: boolean;
  /** id модели, на которую перенаправляются запросы. */
  deprecationRedirectTo?: string;
}

/** Входные данные для создания задачи генерации. */
export interface CreateMediaTaskInput {
  /** id модели из {@link IMediaProvider.listModelsAsync}. */
  model: string;
  /** Текстовый промпт (обязателен для моделей с `prompt: 'required'`). */
  prompt?: string;
  /** Динамические параметры модели (см. {@link MediaParam}). */
  params: Record<string, string | number | boolean>;
  /**
   * Стабильный ключ идемпотентности (обычно `runId:nodeId`): повторная
   * попытка с тем же ключом не создаёт вторую платную генерацию.
   */
  idempotencyKey: string;
  /**
   * Если `true` — upstream держит соединение до 30 секунд, ожидая
   * `done`/`failed`. Для длинных генераций (video) лучше `false` и опрос.
   */
  wait?: boolean;
  /**
   * Входные файлы по ролям: `{ role: [url, ...] }` (R7.1, KI-196).
   *
   * Нужны инструментам (image-to-image): без них upstream получает запрос без
   * исходного изображения и отвечает `400`/`Invalid input`. Ссылки обязаны быть
   * публично доступными (или `data:`-URL до 20 МБ) — upstream скачивает файл
   * сам.
   */
  inputs?: Record<string, string[]>;
}

/**
 * Media-провайдер.
 *
 * Реализации обязаны сами кэшировать список моделей: он большой (~200 КБ) и
 * меняется редко, а `GET /media/models` дергается из UI часто (RULES 1.18).
 */
export interface IMediaProvider {
  /** Идентификатор провайдера (`creativelab`). */
  readonly name: string;
  /** Готов ли провайдер к вызовам (задан ли ключ). */
  readonly isConfigured: boolean;
  /**
   * Возвращает модели указанного типа.
   *
   * @param type - тип модели, либо `undefined` — модели всех типов
   * @returns описание моделей в camelCase; пустой массив, если upstream их не отдал
   * @throws MediaProviderException если ключ не задан или upstream ответил ошибкой
   */
  listModelsAsync(type?: MediaType): Promise<readonly MediaModelInfo[]>;

  /**
   * Создаёт задачу генерации.
   *
   * При `wait: true` upstream держит соединение до 30 секунд, ожидая финала, и
   * задача может вернуться уже `done`; иначе — `queued`/`running`, и статус
   * нужно опрашивать через {@link IMediaProvider.getTaskAsync}.
   *
   * @param input - модель, промпт, параметры и ключ идемпотентности
   * @returns задача с `taskId`; при `done` — с `resultUrls` и `costRub`
   * @throws MediaProviderException если ключ не задан, вход отклонён (400/402/410),
   *   upstream недоступен или ответил ошибкой
   */
  createTaskAsync(input: CreateMediaTaskInput): Promise<MediaTaskResult>;

  /**
   * Возвращает актуальное состояние задачи.
   *
   * @param taskId - id, полученный из {@link IMediaProvider.createTaskAsync}
   * @returns текущее состояние задачи с URL-ами и стоимостью, если она завершена
   * @throws MediaProviderException если ключ не задан, задача не найдена или
   *   upstream ответил ошибкой
   */
  getTaskAsync(taskId: string): Promise<MediaTaskResult>;

  /**
   * Применяет media-инструмент к готовому файлу (R7.1, KI-196).
   *
   * Отличие от {@link IMediaProvider.createTaskAsync}: на вход идёт **ссылка на
   * файл** (`input`), а не промпт, и результат обычно приходит быстро — метод
   * не опрашивает задачу (никакого poll внутри). Если upstream не успел за
   * окно `wait`, вернётся задача в статусе `queued`/`running`; опрос —
   * ответственность вызывающего кода (исполнитель узла `image_tool`).
   *
   * @param input - публично доступный URL входного файла (`http`/`https`)
   * @param tool - операция инструмента (`upscale`, `bg_removal`, ...)
   * @param params - служебные ключи и параметры модели (см. `ImageToolParams`):
   *   `model`, `prompt`, `idempotencyKey`, `inputs`, `audioUrl` плюс скалярные
   *   параметры конкретной модели
   * @returns задача инструмента; при быстром ответе — сразу `done` с URL-ами
   * @throws MediaProviderException если ключ не задан, вход пуст/не URL,
   *   модель не поддерживается, upstream недоступен или ответил ошибкой
   */
  applyToolAsync(
    input: string,
    tool: ImageToolOperation,
    params?: ImageToolParams,
  ): Promise<MediaTaskResult>;
}

/**
 * Ошибка media-провайдера.
 *
 * Наследуется от `Error`, а не от Nest `HttpException`: исключение живёт в
 * контексте провайдера и должно быть явно превращено в HTTP-ответ на границе
 * контроллера.
 */
export class MediaProviderException extends Error {
  /** Идентификатор провайдера, у которого произошла ошибка. */
  readonly provider: string;

  /**
   * Признак «временной» ошибки: имеет ли смысл повторять вызов.
   *
   * `true` — 429/5xx, таймаут, сетевой сбой; `false` — детерминированные
   * ошибки (400/401/402/403/404/410, отсутствие ключа).
   */
  readonly retryable: boolean;

  /**
   * @param provider - идентификатор провайдера (`creativelab`, `media`)
   * @param message - текст ошибки
   * @param options.cause - исходная ошибка (если есть)
   * @param options.retryable - можно ли повторять вызов (по умолчанию `false`)
   */
  constructor(
    provider: string,
    message: string,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'MediaProviderException';
    this.provider = provider;
    this.retryable = options.retryable ?? false;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
