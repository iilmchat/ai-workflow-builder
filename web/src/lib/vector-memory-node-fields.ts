import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_VECTOR_SCORE_THRESHOLD,
  DEFAULT_VECTOR_TOPK,
  EMBEDDING_MODELS,
  VECTOR_TOPK_LIMIT,
  type EmbeddingModelId,
} from '@/types/graph';

/**
 * Валидаторы полей vector/memory-узлов (R7.4a).
 *
 * Вынесены из компонентов в `lib`: их проверяют юнит-тесты, а компоненты
 * остаются тонкими. Правило то же, что у `http-node-fields` (R6.5.2): мусор не
 * попадает в `data` графа, а невалидное число превращается в `undefined` —
 * backend возьмёт дефолт своей Zod-схемы (DESIGN v0.9 § 3.4).
 */

/**
 * Приводит значение селекта модели к известной модели эмбеддингов.
 *
 * Неизвестное значение (например, `text-embedding-3-large`, сохранённый
 * вручную) заменяется дефолтом: показать его в `<select>` нельзя, а backend
 * всё равно отклонит несовместимую размерность.
 *
 * @param value - значение из `data.embeddingModel` (jsonb, `unknown`)
 * @returns id модели из {@link EMBEDDING_MODELS}
 */
export function validateEmbeddingModel(value: unknown): EmbeddingModelId {
  return typeof value === 'string' &&
    (EMBEDDING_MODELS as readonly string[]).includes(value)
    ? (value as EmbeddingModelId)
    : DEFAULT_EMBEDDING_MODEL;
}

/**
 * Проверяет имя коллекции.
 *
 * Пустая строка — валидное состояние «ещё не заполнено»: UI не подменяет
 * ввод пользователя, а Run честно упадёт валидацией backend (`min(1)`).
 *
 * @param value - значение из `data.collection`
 * @returns строка коллекции (пустая, если значение не строка)
 */
export function validateCollection(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Проверяет имя ключа памяти/поля входа.
 *
 * @param value - значение из `data.key` / `data.contentField` / `data.valueField`
 * @returns непустая строка либо `undefined` (поле не задано)
 */
export function validateOptionalFieldName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Проверяет ключ памяти.
 *
 * @param value - значение из `data.key`
 * @returns строка ключа (пустая, если значение не строка)
 */
export function validateMemoryKey(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Проверяет `topK` узла `vector_query`.
 *
 * Допустимо целое 1…{@link VECTOR_TOPK_LIMIT}. Всё остальное — `undefined`
 * (backend применит {@link DEFAULT_VECTOR_TOPK}).
 *
 * @param value - значение из `data.topK`
 * @returns целое в допустимом диапазоне либо `undefined`
 */
export function validateTopK(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }

  return value >= 1 && value <= VECTOR_TOPK_LIMIT ? value : undefined;
}

/**
 * Проверяет порог косинусной близости.
 *
 * Косинусная близость лежит в [-1, 1]; всё вне диапазона — `undefined`
 * (backend применит {@link DEFAULT_VECTOR_SCORE_THRESHOLD}).
 *
 * @param value - значение из `data.scoreThreshold`
 * @returns число в диапазоне [-1, 1] либо `undefined`
 */
export function validateScoreThreshold(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return value >= -1 && value <= 1 ? value : undefined;
}

/**
 * Значение поля `topK` для `<input type="number">`.
 *
 * @param raw - строка из input (пустая — поле не задано)
 * @returns число для валидатора либо `undefined`
 */
export function parseNumericInput(raw: string): number | undefined {
  if (raw.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : undefined;
}
