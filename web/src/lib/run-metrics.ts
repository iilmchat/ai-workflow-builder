import i18n from '@/i18n';

/**
 * Форматирование метрик узла для панели результата (R4.3b; кэш — R7.7).
 *
 * Вынесено из `RunResultPanel` в отдельный модуль, чтобы:
 * - панель оставалась разметкой, а не логикой форматирования;
 * - форматирование можно было проверить юнит-тестом (в `web/` нет jsdom и
 *   React Testing Library — тесты здесь «чистые», см. `vitest.config.ts`).
 */

/**
 * Форматирует рубли: backend отдаёт `numeric` с 6 знаками («0.600000»),
 * в UI это лишний шум — показываем копейки.
 *
 * @param value - стоимость в рублях строкой (как пришла из snapshot)
 * @returns строка вида «0.60 ₽»; исходная строка, если распарсить не удалось
 */
export function formatRub(value: string): string {
  const amount = Number(value);

  return Number.isFinite(amount) ? `${amount.toFixed(2)} ₽` : `${value} ₽`;
}

/**
 * Форматирует доллары: backend отдаёт `numeric` с 6 знаками
 * («0.000000», «2.500000»), в UI это лишний шум — показываем центы (KI-151).
 *
 * Нечисловое значение не превращается в «$NaN», а отдаётся как есть.
 *
 * @param value - стоимость в USD строкой (как пришла из snapshot)
 * @returns строка вида «$0.00»
 */
export function formatUsd(value: string): string {
  const amount = Number(value);

  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : `$${value}`;
}

/**
 * Форматирует сумму экономии на кэше (R7.7, KI-055).
 *
 * Экономия одного вызова часто меньше цента (12 500 токенов Claude Sonnet —
 * $0.03), но бывает и «почти нулевой». Показывать `$0.00` при реальной
 * экономии нельзя — это выглядит как «экономии нет», поэтому такие значения
 * подписываются как `< $0.01`.
 *
 * @param value - экономия в USD
 * @returns строка вида «$0.03», «< $0.01» или «$0.00» для нуля
 */
export function formatSavingsUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0.00';
  }

  if (value < 0.01) {
    return '< $0.01';
  }

  return `$${value.toFixed(2)}`;
}

/**
 * Форматирует количество токенов с разделителем разрядов.
 *
 * @param value - количество токенов
 * @returns строка вида «12 500» (ru) / «12,500» (en)
 */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat(i18n.language === 'en' ? 'en-US' : 'ru-RU').format(
    value,
  );
}

/** Метрики узла, нужные панели результата. */
export interface RunMetricsInput {
  /** Длительность выполнения, мс. */
  durationMs: number | null;
  /** Токенов на входе. */
  tokensIn: number | null;
  /** Токенов на выходе. */
  tokensOut: number | null;
  /** Стоимость LLM в USD строкой (как отдаёт backend `numeric`). */
  costUsd: string | null;
  /** Стоимость media в рублях строкой. */
  costRub: string | null;
  /** Кэш-токены чтения (R7.7). */
  cacheReadTokens?: number | null;
  /** Экономия на чтении из кэша, USD (R7.7). */
  cacheSavingsUsd?: number | null;
}

/**
 * Форматирует метрики узла в строку «длительность · токены · стоимость».
 *
 * Валюты не смешиваются: LLM-узлы отдают `costUsd`, media-узлы — `costRub`
 * (v0.6.0b.2.3), поэтому в строке появляется та, что заполнена.
 *
 * @param metrics - метрики узла (или `undefined`, если узел не выполнялся)
 * @returns строка метрик либо `null`, если показывать нечего
 */
export function formatMetrics(metrics: RunMetricsInput | undefined): string | null {
  if (!metrics) {
    return null;
  }

  const parts: string[] = [];

  if (metrics.durationMs !== null) {
    parts.push(i18n.t('runResultPanel.unit.ms', { value: metrics.durationMs }));
  }

  if (metrics.tokensIn !== null || metrics.tokensOut !== null) {
    parts.push(
      i18n.t('runResultPanel.metrics.tokens', {
        input: metrics.tokensIn ?? '?',
        output: metrics.tokensOut ?? '?',
      }),
    );
  }

  if (metrics.costUsd !== null) {
    parts.push(formatUsd(metrics.costUsd));
  }

  if (metrics.costRub !== null) {
    parts.push(formatRub(metrics.costRub));
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Форматирует строку «Cache read: N токенов (экономия $X)» (R7.7, KI-055).
 *
 * Строка рисуется только при наличии `cacheReadTokens > 0`: `0`/`null`
 * означают «кэша не было или провайдер метрику не отдал», и подпись
 * «Cache read: 0» была бы шумом.
 *
 * @param metrics - метрики узла (может быть `undefined`)
 * @returns готовая строка либо `null`, если показывать нечего
 */
export function formatCacheRead(
  metrics:
    | Pick<RunMetricsInput, 'cacheReadTokens' | 'cacheSavingsUsd'>
    | undefined,
): string | null {
  const tokens = metrics?.cacheReadTokens ?? null;

  if (tokens === null || tokens <= 0) {
    return null;
  }

  const savings = metrics?.cacheSavingsUsd ?? null;
  const formattedTokens = formatTokens(tokens);

  return savings !== null && savings > 0
    ? i18n.t('runResultPanel.metrics.cache_read_savings', {
        count: formattedTokens,
        savings: formatSavingsUsd(savings),
      })
    : i18n.t('runResultPanel.metrics.cache_read', { count: formattedTokens });
}
