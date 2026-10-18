/**
 * Общие константы LLM-модуля (KI-245).
 *
 * Ранее лимит max_tokens был размазан: 1024 в каждом провайдере
 * (openai-compatible, anthropic) и 4096 в фабрике — при малейшей
 * правке легко рассинхронизировать.
 */

/** Лимит max_tokens по умолчанию для обычных моделей. */
export const DEFAULT_MAX_TOKENS = 1024;

/** Лимит max_tokens по умолчанию для reasoning-моделей. */
export const REASONING_MAX_TOKENS = 4096;

/**
 * Модель эмбеддингов по умолчанию (R7.4a, DESIGN v0.9 § 3.4).
 *
 * `text-embedding-3-small` даёт 1536 измерений — ровно размерность колонки
 * `workflow_vectors.embedding` (`vector(1536)`). Модель
 * `text-embedding-3-large` (3072) в эту колонку не помещается и отклоняется
 * проверкой размерности в исполнителе.
 */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/** Размерность вектора модели {@link DEFAULT_EMBEDDING_MODEL}. */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Порог длины system-промпта для prompt caching Anthropic (R7.7, KI-414).
 *
 * Anthropic кэширует промпт только начиная с определённого размера; запрос с
 * `cache_control` на коротком промпте завершается ошибкой 400. Порог сравнивается
 * с длиной строки (`systemPrompt.length`), а не с числом токенов: точный
 * tokenizer у нас недоступен, а `PROMPT_CACHE_MIN_TOKENS` — консервативная
 * нижняя граница (для английского текста токенов обычно меньше, чем символов).
 */
export const DEFAULT_PROMPT_CACHE_MIN_TOKENS = 1024;
