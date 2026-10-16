/**
 * Каталог моделей прямых image-провайдеров (R7.3, DESIGN v0.9 § 3.3).
 *
 * Replicate и FAL — это **хостинги чужих моделей**: у них нет «каталога
 * провайдера», который можно было бы отдать в UI как есть (Replicate отдаёт
 * десятки тысяч публичных моделей через `GET /v1/models`, FAL — через свой
 * schema-эндпоинт на каждую модель). Поэтому оба провайдера объявляют **свой**
 * список поддерживаемых моделей: id, назначение, цену и параметры.
 *
 * Общий модуль нужен, чтобы `params`/`inputs` не описывались трижды в разных
 * форматах: иначе UI показывал бы у одной модели `aspect_ratio`, у другой —
 * `aspectRatio`, а исполнитель узла (`MediaNodeExecutor.readParamsAsync`,
 * KI-181) отсекал бы «неизвестные» ключи по каталогу.
 *
 * **Цены.** Каталог Replicate/FAL тарифицируется в долларах, поэтому
 * `priceUsd` переводится в рубли по курсу `MEDIA_USD_RUB_RATE` (R7.1, KI-048):
 * бюджет запуска считается в рублях, и без пересчёта такие модели получили бы
 * нулевую оценку и обошли предохранитель.
 */

import type {
  MediaInput,
  MediaModelInfo,
  MediaParam,
  MediaType,
} from '../media-provider.interface.js';

/** Курс USD→RUB по умолчанию (совпадает с `MEDIA_USD_RUB_RATE`). */
export const DEFAULT_USD_RUB_RATE = 100;

/** Возможные значения `aspect_ratio`, которые принимает большинство моделей. */
const ASPECT_OPTIONS = [
  { value: '1:1', label: 'wfc_opt_square' },
  { value: '16:9', label: 'wfc_opt_16_9' },
  { value: '9:16', label: 'wfc_opt_9_16' },
  { value: '3:2', label: 'wfc_opt_3_2' },
] as const;

/**
 * Базовый параметр `aspect_ratio`.
 *
 * Ключ совпадает с upstream-полем у всех моделей R7.3 (Replicate `flux`,
 * FAL `fal-ai/flux/*`, OpenAI `size` — у последнего свой параметр, см.
 * `openai-images.provider.ts`).
 */
export const ASPECT_RATIO_PARAM: MediaParam = {
  key: 'aspect_ratio',
  type: 'enum',
  label: 'wfc_aspect',
  default: '1:1',
  options: [...ASPECT_OPTIONS],
};

/** Необязательный параметр `seed` (детерминированность генерации). */
export const SEED_PARAM: MediaParam = {
  key: 'seed',
  type: 'number',
  label: 'wfc_seed',
  integer: true,
  min: 0,
};

/** Слот входного изображения (для image-to-image и моделей-инструментов). */
export const IMAGE_INPUT: MediaInput = {
  key: 'image',
  kind: 'image',
  role: 'reference',
  required: true,
  formats: ['png', 'jpg', 'jpeg', 'webp'],
};

/** Компактное описание модели для каталога прямого провайдера. */
export interface DirectModelSpec {
  /** id модели **без** префикса провайдера (`black-forest-labs/flux-schnell`). */
  id: string;
  /** Короткий код для UI; по умолчанию совпадает с `id`. */
  code?: string;
  /** Тип модели; по умолчанию `IMAGE`. */
  type?: MediaType;
  /** Цена за генерацию в **долларах** (`null` — цена неизвестна → `0 ₽`). */
  priceUsd?: number;
  /** Обязательность промпта; по умолчанию `required`. */
  prompt?: MediaModelInfo['prompt'];
  /** Объявленные параметры модели (ключи совпадают с полями upstream). */
  params?: MediaParam[];
  /** Входные слоты; непустой обязательный слот делает модель инструментом. */
  inputs?: MediaInput[];
}

/**
 * Строит публичное описание модели из компактного описания.
 *
 * `id` получает префикс провайдера (`replicate:black-forest-labs/flux-schnell`):
 * это пространство имён — два провайдера могут объявить одну и ту же модель
 * (`gpt-image-1`, `flux-schnell`), а id уходит в реестр как ключ маршрутизации и
 * в `data.model` узла. Без префикса дедупликация реестра молча увела бы запрос
 * в чужой upstream.
 *
 * @param provider - имя провайдера (`replicate`, `fal`, `openai_images`)
 * @param spec - компактное описание модели
 * @param usdRubRate - курс USD→RUB для пересчёта цены в рубли
 * @returns описание модели в camelCase, готовое к отдаче из API
 */
export function toDirectModelInfo(
  provider: string,
  spec: DirectModelSpec,
  usdRubRate: number,
): MediaModelInfo {
  const inputs = spec.inputs ?? [];

  return {
    id: `${provider}:${spec.id}`,
    code: spec.code ?? spec.id,
    type: spec.type ?? 'IMAGE',
    provider,
    price: spec.priceUsd === undefined ? 0 : spec.priceUsd * usdRubRate,
    priceUnit: 'per_generation',
    priceInput: null,
    priceInputUnit: null,
    moderation: 'auto',
    prompt: spec.prompt ?? 'required',
    params: spec.params ?? [],
    inputs,
  };
}

/**
 * Проверяет, что модель объявлена как инструмент (есть обязательный вход).
 *
 * Нужно `applyToolAsync`: у Replicate/FAL одна и та же модель умеет и
 * text-to-image, и image-to-image, поэтому «инструмент» — это не тип модели, а
 * наличие обязательного входного файла (та же логика, что в UI R7.1).
 *
 * @param model - модель из каталога провайдера
 * @returns `true`, если у модели есть обязательный входной слот
 */
export function isToolModel(model: MediaModelInfo): boolean {
  return model.inputs.some((input) => input.required);
}

/**
 * Отбирает модели каталога по типу.
 *
 * @param models - все модели провайдера
 * @param type - тип модели, либо `undefined` — все типы
 * @returns отфильтрованный список (тот же порядок)
 */
export function filterByType(
  models: readonly MediaModelInfo[],
  type?: MediaType,
): readonly MediaModelInfo[] {
  return type === undefined
    ? models
    : models.filter((model) => model.type === type);
}
