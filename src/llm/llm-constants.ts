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