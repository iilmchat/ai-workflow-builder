import type {
  MediaInput,
  MediaModelInfo,
  MediaParam,
  MediaRule,
} from '../media-provider.interface.js';
import type { MediaModelDto } from './media-model.dto.js';

/**
 * Мапперы snake_case → camelCase для media-моделей (RULES 4.23).
 *
 * Zod-схемы повторяют контракт upstream (snake_case), а внутренние типы —
 * camelCase. Переименование делается здесь, чтобы схема и внутренний тип не
 * подменяли друг друга.
 *
 * Поля, которые схема объявила через `passthrough()` (например
 * `max_length`, `max_bytes`), Zod возвращает **под исходными именами**;
 * приводим их к camelCase, а исходные ключи не оставляем, чтобы в ответе API
 * не было двух написаний одного поля.
 */

/**
 * Приводит параметр генерации к внутреннему виду.
 *
 * @param dto - параметр из ответа upstream (snake_case)
 * @returns параметр в camelCase
 */
function toMediaParam(dto: MediaModelDto['params'][number]): MediaParam {
  const { max_length: maxLength, ...rest } = dto;

  return { ...rest, maxLength };
}

/**
 * Приводит входной слот к внутреннему виду.
 *
 * @param dto - слот из ответа upstream (snake_case)
 * @returns слот в camelCase
 */
function toMediaInput(dto: MediaModelDto['inputs'][number]): MediaInput {
  const { max_bytes: maxBytes, ...rest } = dto;

  return { ...rest, maxBytes };
}

/**
 * Приводит правило совместимости к внутреннему виду.
 *
 * @param dto - правило из ответа upstream
 * @returns правило (состав полей не меняется)
 */
function toMediaRule(dto: { type: string; [key: string]: unknown }): MediaRule {
  return { ...dto };
}

/**
 * Приводит модель upstream к публичному описанию для UI.
 *
 * @param dto - модель из ответа upstream (snake_case)
 * @returns модель в camelCase, готовая к отдаче из API
 */
export function toMediaModelInfo(dto: MediaModelDto): MediaModelInfo {
  return {
    id: dto.id,
    code: dto.code,
    type: dto.type,
    price: dto.price,
    priceUnit: dto.price_unit ?? null,
    priceInput: dto.price_input ?? null,
    priceInputUnit: dto.price_input_unit ?? null,
    moderation: dto.moderation,
    prompt: dto.prompt,
    params: dto.params.map(toMediaParam),
    inputs: dto.inputs.map(toMediaInput),
    rules: dto.rules?.map(toMediaRule),
    deprecated: dto.deprecated,
    deprecationRedirectTo: dto.deprecation_redirect_to,
  };
}
