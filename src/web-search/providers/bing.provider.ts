/**
 * Web-search-провайдер Bing Web Search API v7 (v0.15 S3, DESIGN v0.14 § 3.3).
 *
 * Ходит в REST API `GET https://api.bing.microsoft.com/v7.0/search` встроенным
 * `fetch`. Ключ уходит только в заголовке `Ocp-Apim-Subscription-Key` и не
 * попадает ни в URL (он попадает в логи прокси), ни в тело запроса.
 *
 * ### Параметры
 *
 * - `q` — запрос, `count` — лимит результатов (1–10, дефолт 5);
 * - `freshness` — свежесть: алиасы `day`/`week`/`month`/`year` переводятся в
 *   `Day`/`Week`/`Month`/диапазон дат; нативный формат Bing (`Day`/`Week`/
 *   `Month`/`YYYY-MM-DD..YYYY-MM-DD`) передаётся как есть;
 * - `searchDepth` — **Bing Web Search API v7 такого параметра не имеет**
 *   (глубина есть у Tavily; у Bing — только `count`/`freshness`). Поле
 *   принимается ради общего контракта {@link WebSearchOptions}, но в запрос не
 *   попадает и пишется debug-логом, чтобы «настройка в UI» не выглядела
 *   работающей (KI-546).
 *
 * ### Ошибки и retry
 *
 * Классификация общая с Tavily ({@link classifyHttpStatus}): `401`/`403` —
 * детерминированная ошибка ключа, `429`/`5xx`/таймаут/сеть — retryable.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { RetryableNodeException } from '../../engine/errors.js';
import {
  WebSearchProviderException,
  type IWebSearchProvider,
  type WebSearchOptions,
  type WebSearchProviderName,
  type WebSearchResult,
} from '../web-search.interface.js';
import {
  REQUEST_TIMEOUT_MS,
  SNIPPET_MAX_LENGTH,
  WEB_SEARCH_NODE_TYPE,
  classifyHttpStatus,
  normalizeMaxResults,
  toIsoDate,
  truncate,
} from './provider-utils.js';

/** Идентификатор провайдера в логах, ошибках и env `WEB_SEARCH_PROVIDER`. */
export const BING_PROVIDER_NAME = 'bing' satisfies WebSearchProviderName;

/** Endpoint Bing Web Search API v7. */
export const BING_SEARCH_URL = 'https://api.bing.microsoft.com/v7.0/search';

/** Человекочитаемое имя провайдера для текстов ошибок. */
const BING_LABEL = 'Bing';

/**
 * Схема одного результата Bing.
 *
 * `webPages.value[]`: `name` — заголовок, `snippet` — сниппет. `url` обязателен:
 * без него результат бесполезен как источник. Bing может отдать пустой
 * `webPages` (нет результатов) — это не ошибка.
 */
const BingWebPageSchema = z.object({
  name: z.string().default(''),
  url: z.string().min(1),
  snippet: z.string().default(''),
});

/** Схема ответа Bing Web Search API. */
const BingSearchResponseSchema = z.object({
  webPages: z
    .object({
      value: z.array(BingWebPageSchema).default([]),
    })
    .nullish(),
});

/** Результат Bing после разбора схемы. */
type BingWebPage = z.infer<typeof BingWebPageSchema>;

/**
 * Провайдер веб-поиска Bing.
 *
 * Без `BING_API_KEY` не падает на старте (`isConfigured === false`), а бросает
 * {@link WebSearchProviderException} при вызове — как остальные провайдеры.
 */
@Injectable()
export class BingProvider implements IWebSearchProvider {
  /** Идентификатор провайдера. */
  readonly name = BING_PROVIDER_NAME;

  private readonly logger = new Logger(BingProvider.name);
  /** Ключ API либо `null`, если он не задан. */
  private readonly apiKey: string | null;

  /**
   * @param config - доступ к переменным окружения (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const apiKey = (config.get<string>('BING_API_KEY') ?? '').trim();
    this.apiKey = apiKey.length > 0 ? apiKey : null;

    if (!this.apiKey) {
      this.logger.warn('BING_API_KEY не задан — web-search (bing) недоступен');
    }
  }

  /** Готов ли провайдер к вызовам (задан ли `BING_API_KEY`). */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Выполняет поиск через Bing Web Search API v7.
   *
   * @param query - поисковый запрос (PII не логируется — только длина)
   * @param options - лимит результатов, свежесть; `searchDepth` не поддерживается
   * @returns результаты в порядке релевантности
   * @throws WebSearchProviderException если ключ не задан, запрос пуст,
   *   ключ не принят (401/403), upstream ответил прочим 4xx или тело не по схеме
   * @throws RetryableNodeException при 429/5xx, таймауте и сетевом сбое
   */
  async searchAsync(
    query: string,
    options?: WebSearchOptions,
  ): Promise<WebSearchResult[]> {
    if (!this.apiKey) {
      throw new WebSearchProviderException(
        this.name,
        'BING_API_KEY не задан',
      );
    }

    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0) {
      throw new WebSearchProviderException(
        this.name,
        'пустой поисковый запрос',
      );
    }

    if (options?.searchDepth !== undefined) {
      this.logger.debug(
        `Bing: searchDepth=${options.searchDepth} игнорируется — Bing Web Search API v7 не поддерживает глубину поиска`,
      );
    }

    const params = new URLSearchParams({
      q: normalizedQuery,
      count: String(normalizeMaxResults(options?.maxResults)),
      // Только веб-страницы: остальные секции ответа (images/news/videos)
      // исполнителю не нужны и только раздувают тело.
      responseFilter: 'Webpages',
      // Без HTML-разметки и с raw-текстом: сниппет идёт в LLM как plain text.
      textDecorations: 'false',
      textFormat: 'Raw',
    });
    const freshness = mapBingFreshness(options?.freshness);

    if (freshness !== undefined) {
      params.set('freshness', freshness);
    }

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${BING_SEARCH_URL}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          Accept: 'application/json',
        },
        signal,
      });
    } catch (error: unknown) {
      throw new RetryableNodeException(
        WEB_SEARCH_NODE_TYPE,
        signal.aborted
          ? `Bing: истёк таймаут запроса (${REQUEST_TIMEOUT_MS} мс)`
          : 'Bing: не удалось обратиться к API поиска',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw classifyHttpStatus(this.name, BING_LABEL, response.status);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      // Таймаут может сработать уже после заголовков — на чтении тела.
      if (signal.aborted) {
        throw new RetryableNodeException(
          WEB_SEARCH_NODE_TYPE,
          `Bing: истёк таймаут чтения ответа (${REQUEST_TIMEOUT_MS} мс)`,
          { cause: error },
        );
      }

      throw new WebSearchProviderException(
        this.name,
        'Bing вернул ответ не в формате JSON',
        { cause: error },
      );
    }

    const parsed = BingSearchResponseSchema.safeParse(payload);

    if (!parsed.success) {
      // Точный path и обрезанный raw — иначе по «1 ошибка схемы» не найти
      // разошедшееся поле (как в Tavily/CreativeLab, KI-111).
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');

      this.logger.error(
        `Bing response schema mismatch: ${details}; raw=${JSON.stringify(payload).slice(0, 800)}`,
      );

      throw new WebSearchProviderException(
        this.name,
        `неожиданный формат ответа Bing: ${details}`,
        { cause: parsed.error },
      );
    }

    // RULES § 5.9: текст запроса (может содержать PII) не логируем.
    const results = parsed.data.webPages?.value ?? [];

    this.logger.debug(
      `Bing: queryLen=${normalizedQuery.length}, results=${results.length}`,
    );

    return results.map(toWebSearchResult);
  }
}

/**
 * Переводит `freshness` в формат Bing Web Search API v7.
 *
 * Алиасы `day`/`week`/`month` → `Day`/`Week`/`Month`; `year` → диапазон
 * последних 365 дней (у Bing нет значения `Year`); нативный формат
 * (`Day`/`Week`/`Month` или `YYYY-MM-DD..YYYY-MM-DD`) передаётся как есть.
 * Нераспознанное значение игнорируется: неподдерживаемый параметр не должен
 * ронять поиск (поле опциональное).
 *
 * @param value - `freshness` из опций узла
 * @returns значение для query-параметра `freshness` либо `undefined`
 */
export function mapBingFreshness(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  switch (normalized.toLowerCase()) {
    case 'day':
      return 'Day';
    case 'week':
      return 'Week';
    case 'month':
      return 'Month';
    case 'year': {
      const now = new Date();
      const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      return `${toIsoDate(yearAgo)}..${toIsoDate(now)}`;
    }
    default:
      // Нативный формат Bing: Day/Week/Month или диапазон дат.
      return /^(Day|Week|Month)$/i.test(normalized) ||
        /^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(normalized)
        ? normalized
        : undefined;
  }
}

/**
 * Приводит результат Bing к контракту {@link WebSearchResult}.
 *
 * @param page - разобранный результат upstream
 * @returns результат с обрезанным сниппетом (Bing не отдаёт полный текст)
 */
function toWebSearchResult(page: BingWebPage): WebSearchResult {
  return {
    title: page.name,
    url: page.url,
    snippet: truncate(page.snippet, SNIPPET_MAX_LENGTH),
  };
}
