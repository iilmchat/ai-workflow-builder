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
