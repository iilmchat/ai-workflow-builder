/**
 * Разбор кэш-токенов из ответов провайдеров (R7.7, KI-055/KI-150).
 *
 * Вынесено из провайдеров в отдельный модуль, потому что имена полей у
 * провайдеров разные, а нормализация — одна:
 *
 * - **Anthropic** — `usage.cache_read_input_tokens` и
 *   `usage.cache_creation_input_tokens`; эти токены **не входят** в
 *   `usage.input_tokens` (там только некешированные);
 * - **OpenAI** — `usage.prompt_tokens_details.cached_tokens`; кэш **входит** в
 *   `prompt_tokens`, но по нему отдельная (дешёвая) цена;
 * - **DeepSeek** — `usage.prompt_cache_hit_tokens` (входит в `prompt_tokens`);
 * - **прокси** (RouterAI/GPTunnel) — что передал upstream: пробуем оба
 *   варианта и не падаем, если поля нет.
 *
 * Ответ провайдера — внешние данные (RULES 1.17), поэтому каждое поле
 * проверяется по типу: строка `"12"` не превращается в число молча.
 */

/**
 * Читает неотрицательное целое из поля ответа провайдера.
 *
 * Ноль и отрицательные значения возвращаются как `undefined`: «кэша не было»
 * и «провайдер не отдал метрику» в БД неразличимы, а `0` в UI выглядел бы как
 * факт применения кэша (KI-055). Дробные значения не принимаются.
 *
 * @param value - сырое значение поля (тип `unknown`)
 * @returns целое > 0 либо `undefined`
 */
export function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * Читает вложенный объект по ключу, не полагаясь на его форму.
 *
 * @param value - контейнер (тип `unknown`)
 * @param key - имя поля
 * @returns вложенный объект либо `null`, если поля нет / оно не объект
 */
export function readNestedRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const nested = (value as Record<string, unknown>)[key];

  return typeof nested === 'object' && nested !== null && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : null;
}

/** Кэш-токены, нормализованные к внутреннему виду. */
export interface CacheTokenUsage {
  /** Токенов прочитано из кэша (0 → поля нет). */
  readonly cacheReadTokens?: number;
  /** Токенов записано в кэш (0 → поля нет). */
  readonly cacheCreationTokens?: number;
  /**
   * Входят ли кэш-токены в `inputTokens`.
   *
   * `true` — входят (OpenAI/DeepSeek): цена обычных входных токенов должна
   * применяться только к остатку; `false` — отдельные (Anthropic).
   *
   * Поле проставляется **только когда кэш-токены есть**: иначе `usage` ответа
   * остаётся прежним (без лишнего ключа), а расчётчик стоимости трактует
   * отсутствие как «входят» — поведение до R7.7.
   */
  readonly cacheTokensIncludedInInput?: boolean;
}

/**
 * Разбирает кэш-токены OpenAI-совместимого ответа.
 *
 * @param usage - `usage` из `chat.completions.create` (тип `unknown`)
 * @returns нормализованные кэш-токены; `cacheTokensIncludedInInput: true`
 */
export function readOpenAiCacheTokens(usage: unknown): CacheTokenUsage {
  const source =
    typeof usage === 'object' && usage !== null && !Array.isArray(usage)
      ? (usage as Record<string, unknown>)
      : null;
  const details = readNestedRecord(source, 'prompt_tokens_details');

  const cacheReadTokens =
    readTokenCount(details?.cached_tokens) ??
    // DeepSeek: `prompt_cache_hit_tokens`; некоторые прокси пробрасывают
    // anthropic-имя — принимаем и его.
    readTokenCount(source?.prompt_cache_hit_tokens) ??
    readTokenCount(source?.cache_read_input_tokens);

  const cacheCreationTokens =
    readTokenCount(details?.cache_creation_tokens) ??
    readTokenCount(source?.cache_creation_input_tokens);

  return {
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
    // OpenAI-совместимый `prompt_tokens` включает кэшированные токены. Ключ
    // ставится только при наличии кэша: без него `usage` — как до R7.7.
    ...(cacheReadTokens === undefined && cacheCreationTokens === undefined
      ? {}
      : { cacheTokensIncludedInInput: true }),
  };
}

/**
 * Разбирает кэш-токены ответа Anthropic.
 *
 * @param usage - `usage` из `messages.create` (тип `unknown`)
 * @returns нормализованные кэш-токены; `cacheTokensIncludedInInput: false`
 */
export function readAnthropicCacheTokens(usage: unknown): CacheTokenUsage {
  const source = typeof usage === 'object' && usage !== null
    ? (usage as Record<string, unknown>)
    : null;

  const cacheReadTokens = readTokenCount(source?.cache_read_input_tokens);
  const cacheCreationTokens = readTokenCount(source?.cache_creation_input_tokens);

  return {
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
    // `input_tokens` Anthropic не включает кэш-токены. Ключ ставится только
    // при наличии кэша: без него `usage` — как до R7.7.
    ...(cacheReadTokens === undefined && cacheCreationTokens === undefined
      ? {}
      : { cacheTokensIncludedInInput: false }),
  };
}
