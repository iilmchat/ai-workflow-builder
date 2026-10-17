import { z } from 'zod';
import { MEDIA_TYPES, type MediaType } from '../media-provider.interface.js';

/**
 * Zod-схемы границы с GPTunnel CreativeLab (v0.6.0b.2.1).
 *
 * Upstream отдаёт **snake_case** (`price_unit`, `max_bytes`, ...), поэтому
 * схемы читают JSON «как есть» — переименование в camelCase делает маппер
 * (`toMediaModelInfo`), а не Zod: так схема остаётся зеркалом внешнего
 * контракта и не путается с внутренними типами (RULES 1.17, 4.23).
 */

/** Схема варианта значения enum-параметра. */
export const MediaParamOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string(),
});

/**
 * Схема одного параметра генерации.
 *
 * `passthrough()` сознательно: набор полей зависит от типа параметра и может
 * расшириться на стороне upstream без нашего релиза — терять их нельзя.
 */
export const MediaParamSchema = z
  .object({
    key: z.string(),
    type: z.enum(['enum', 'number', 'string', 'boolean']),
    label: z.string(),
    description: z.string().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    options: z.array(MediaParamOptionSchema).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    integer: z.boolean().optional(),
    unit: z.string().optional(),
    max_length: z.number().optional(),
  })
  .passthrough();

/** Схема входного слота модели. */
export const MediaInputSchema = z
  .object({
    key: z.string(),
    kind: z.enum(['image', 'video', 'audio']),
    role: z.string().optional(),
    required: z.boolean().default(false),
    count: z.object({ min: z.number(), max: z.number() }).optional(),
    formats: z.array(z.string()).optional(),
    max_bytes: z.number().optional(),
    duration: z
      .object({ minSec: z.number().optional(), maxSec: z.number().optional() })
      .optional(),
    dimensions: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();

/** Схема правила совместимости входов. */
export const MediaRuleSchema = z
  .object({ type: z.string() })
  .passthrough();

/**
 * Схема одного тарифа матрицы (`pricing.matrix` / `pricing.tiers`, KI-384).
 *
 * `condition` — набор параметров вызова, при которых действует `cost`
 * (например, `{ resolution: '720p', variant: 'base' }`). Поля без `condition`
 * считаются тарифом по умолчанию.
 */
export const MediaPricingTierSchema = z
  .object({
    cost: z.number().nonnegative(),
    condition: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * Схема доплаты матрицы (`pricing.plus`, KI-384).
 *
 * Простая форма — `{ rate, param, free? }` (доп. reference сверх `free`). Но
 * upstream использует `plus` и как «составную» доплату с `base`/`unitsSum`/
 * `tierRates` без `rate`/`param` (`krea-3`, `minimax-h3-max`, `seedance-2-5`),
 * поэтому все поля необязательны: незнакомая доплата не должна ронять разбор
 * всего каталога (RULES 1.17).
 */
export const MediaPricingPlusSchema = z
  .object({
    rate: z.number().nonnegative().optional(),
    param: z.string().optional(),
    free: z.number().nonnegative().optional(),
  })
  .passthrough();

/**
 * Схема блока `pricing` каталога CreativeLab (KI-384).
 *
 * Upstream отдаёт **дискриминированный по `type`** блок, а не скалярные поля:
 * - `{ type: 'fixed', cost: 960 }` — фиксированная цена (`glabs-veo-3`);
 * - `{ type: 'per_second', baseRates: { '720p': 33.6 }, baseBy: 'resolution',
 *   unitParam: 'duration' }` — цена за секунду, ставка по параметру
 *   (`kling-v3`, `wan-2.5`);
 * - `{ type: 'per_character', ratePer1K: 60 }` — цена за 1000 символов (`tts2`);
 * - `{ type: 'matrix', tiers: [{ cost, condition }] }` — таблица тарифов
 *   (`recraftv4`, `wan-3.0`);
 * - `{ type: 'per_resolution', rates: { '2K': 8 }, rateBy: 'resolution' }` —
 *   ставка по параметру (`qwen-image-2.1`);
 * - `{ type: 'expr', units: ['duration'], tierRates: { ... }, tierBy }` —
 *   ставка × длительность (`vidu-q4`).
 *
 * Упрощённые поля `fixed`/`per_second` тоже принимаются: заказчик KI-384
 * описывал блок именно так, и провайдеры R7.3 вправе отдавать его короче.
 * `passthrough()` сохраняет незнакомые поля — каталог меняется без нашего
 * релиза (RULES 1.17).
 */
export const MediaPricingSchema = z
  .object({
    /** Вид тарификации из upstream (`fixed`, `per_second`, `matrix`, ...). */
    type: z.string().optional(),
    /** Фиксированная цена вызова, ₽ (упрощённая форма). */
    fixed: z.number().nonnegative().optional(),
    /** Фиксированная цена вызова, ₽ (форма upstream `type: 'fixed'`). */
    cost: z.number().nonnegative().optional(),
    /** Цена за секунду, ₽ (упрощённая форма). */
    per_second: z.number().nonnegative().optional(),
    /** Цена за 1000 символов текста (`tts2`, вложенная форма). */
    per_character: z
      .object({ ratePer1K: z.number().nonnegative() })
      .passthrough()
      .optional(),
    /**
     * Цена за 1000 символов текста в **реальном** ответе upstream: у `tts2`
     * блок выглядит как `{ type: 'per_character', ratePer1K: 60 }`, без
     * вложенного объекта. Обе формы поддерживаются (KI-384).
     */
    ratePer1K: z.number().nonnegative().optional(),
    /** Таблица тарифов (форма upstream). */
    matrix: z.array(MediaPricingTierSchema).optional(),
    /** Таблица тарифов (синоним `matrix` в части ответов upstream). */
    tiers: z.array(MediaPricingTierSchema).optional(),
    /** Доплаты к тарифу (например, за дополнительные референсы). */
    plus: z.array(MediaPricingPlusSchema).optional(),
    /** Базовые ставки per_second по значению `baseBy` (`{ '': 32 }`). */
    baseRates: z.record(z.string(), z.number()).optional(),
    /** Параметр, по которому выбирается ставка `baseRates` (`resolution`). */
    baseBy: z.string().optional(),
    /** Параметр-множитель количества (`duration`). */
    unitParam: z.string().optional(),
    /** Ставки `per_resolution` по значению `rateBy`. */
    rates: z.record(z.string(), z.number()).optional(),
    /** Параметр, по которому выбирается ставка `rates` (`resolution`). */
    rateBy: z.string().optional(),
    /** Ставки `expr` по значению `tierBy`. */
    tierRates: z.record(z.string(), z.number()).optional(),
    /** Параметр, по которому выбирается ставка `tierRates`. */
    tierBy: z.string().optional(),
    /**
     * Единицы `expr`: что умножается на ставку. Обычно `['duration']`, но
     * upstream отдаёт и объекты (`flux-2-pro`: `[{ key: 'width', scale }]`),
     * поэтому тип свободный — интерпретирует его калькулятор.
     */
    units: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** Схема одной модели. */
export const MediaModelSchema = z.object({
  id: z.string(),
  code: z.string(),
  type: z.enum(MEDIA_TYPES),
  price: z.number().nonnegative(),
  // KI-112: у моделей с тарифом «по входу» price_unit отсутствует,
  // а ставка лежит в price_input + price_input_unit (см. докy GPTunnel).
  price_unit: z.string().optional(),
  price_input: z.number().nonnegative().optional(),
  price_input_unit: z.string().optional(),
  /**
   * Честный тариф upstream (KI-384). У части моделей (`sound-effect`) блока
   * нет вовсе, поэтому поле необязательно; `null` тоже допустим.
   */
  pricing: MediaPricingSchema.nullish(),
  moderation: z.enum(['auto', 'strict']).default('auto'),
  prompt: z.enum(['required', 'optional', 'none']).default('required'),
  params: z.array(MediaParamSchema).default([]),
  inputs: z.array(MediaInputSchema).default([]),
  rules: z.array(MediaRuleSchema).optional(),
  deprecated: z.boolean().optional(),
  deprecation_redirect_to: z.string().optional(),
});

/**
 * Схема ответа `GET /models`.
 *
 * `code` — код ответа upstream (`0` — успех); проверяется как число, потому
 * что при ошибке поле может принимать любые значения, а разбор
 * содержательной ошибки идёт по HTTP-статусу.
 */
export const MediaModelsResponseSchema = z.object({
  code: z.number().int(),
  models: z.array(MediaModelSchema),
});

/**
 * Схема query-параметров `GET /media/models`.
 *
 * Без `type` возвращаются модели всех типов: это полезно для отладки, но UI
 * так делать не должен — список большой.
 */
export const MediaModelsQuerySchema = z.object({
  type: z.enum(MEDIA_TYPES).optional(),
});

/** Сырой ответ upstream: результат разбора {@link MediaModelsResponseSchema}. */
export type MediaModelsResponseDto = z.infer<typeof MediaModelsResponseSchema>;
/** Сырая модель upstream (snake_case). */
export type MediaModelDto = z.infer<typeof MediaModelSchema>;
/** Сырой query-параметр запроса моделей. */
export type MediaModelsQueryDto = z.infer<typeof MediaModelsQuerySchema>;

/** Тип media-модели, продублированный для удобства импорта из DTO. */
export type { MediaType };
