/**
 * Web-search-провайдер Brave Search API (v0.15 S3, DESIGN v0.14 § 3.3).
 *
 * Ходит в REST API `GET https://api.search.brave.com/res/v1/web/search`
 * встроенным `fetch`. Ключ уходит только в заголовке `X-Subscription-Token` и
 * не попадает ни в URL, ни в тело запроса.
 *
 * ### Параметры
 *
 * - `q` — запрос, `count` — лимит результатов (1–10, дефолт 5);
 * - `freshness` — алиасы `day`/`week`/`month`/`year` переводятся в
 *   `pd`/`pw`/`pm`/`py`, нативный формат (`pd`/`pw`/`pm`/`py` или
 *   `YYYY-MM-DDtoYYYY-MM-DD`) передаётся как есть;
 * - `text_decorations=false` — без подсветки в `description`, чтобы сниппет
 *   был plain text (провайдер всё равно может вернуть HTML-сущности — они
 *   вычищаются {@link stripHtml});
 * - `searchDepth` — **Brave Search API такого параметра не имеет** (глубина
 *   есть у Tavily; у Brave — `count`/`freshness`). Поле принимается ради
 *   общего контракта {@link WebSearchOptions}, но в запрос не попадает и
 *   пишется debug-логом (KI-546).
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
  stripHtml,
  truncate,
} from './provider-utils.js';

/** Идентификатор провайдера в логах, ошибках и env `WEB_SEARCH_PROVIDER`. */
export const BRAVE_PROVIDER_NAME = 'brave' satisfies WebSearchProviderName;

/** Endpoint Brave Search API (web). */
export const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

/** Человекочитаемое имя провайдера для текстов ошибок. */
const BRAVE_LABEL = 'Brave';

/**
 * Схема одного результата Brave.
 *
 * `web.results[]`: `title`, `url`, `description`. `url` обязателен: без него
 * результат бесполезен как источник. Пустой/отсутствующий `web` — «ничего не
 * найдено», а не ошибка.
 */
const BraveResultSchema = z.object({
  title: z.string().default(''),
  url: z.string().min(1),
  description: z.string().default(''),
});

/** Схема ответа Brave Search API. */
const BraveSearchResponseSchema = z.object({
  web: z
    .object({
      results: z.array(BraveResultSchema).default([]),
    })
    .nullish(),
});

/** Результат Brave после разбора схемы. */
type BraveResult = z.infer<typeof BraveResultSchema>;

/**
 * Провайдер веб-поиска Brave.
 *
 * Без `BRAVE_API_KEY` не падает на старте (`isConfigured === false`), а
 * бросает {@link WebSearchProviderException} при вызове — как остальные
 * провайдеры.
 */
@Injectable()
export class BraveProvider implements IWebSearchProvider {
  /** Идентификатор провайдера. */
  readonly name = BRAVE_PROVIDER_NAME;

  private readonly logger = new Logger(BraveProvider.name);
  /** Ключ API либо `null`, если он не задан. */
  private readonly apiKey: string | null;

  /**
   * @param config - доступ к переменным окружения (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const apiKey = (config.get<string>('BRAVE_API_KEY') ?? '').trim();
    this.apiKey = apiKey.length > 0 ? apiKey : null;

    if (!this.apiKey) {
      this.logger.warn('BRAVE_API_KEY не задан — web-search (brave) недоступен');
    }
  }

  /** Готов ли провайдер к вызовам (задан ли `BRAVE_API_KEY`). */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Выполняет поиск через Brave Search API.
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
        'BRAVE_API_KEY не задан',
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
        `Brave: searchDepth=${options.searchDepth} игнорируется — Brave Search API не поддерживает глубину поиска`,
      );
    }

    const params = new URLSearchParams({
      q: normalizedQuery,
      count: String(normalizeMaxResults(options?.maxResults)),
      // Без декораций: description идёт в LLM как plain text.
      text_decorations: 'false',
    });
    const freshness = mapBraveFreshness(options?.freshness);

    if (freshness !== undefined) {
      params.set('freshness', freshness);
    }

    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${BRAVE_SEARCH_URL}?${params.toString()}`, {
        method: 'GET',
        headers: {
          'X-Subscription-Token': this.apiKey,
          Accept: 'application/json',
        },
        signal,
      });
    } catch (error: unknown) {
      throw new RetryableNodeException(
        WEB_SEARCH_NODE_TYPE,
        signal.aborted
          ? `Brave: истёк таймаут запроса (${REQUEST_TIMEOUT_MS} мс)`
          : 'Brave: не удалось обратиться к API поиска',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw classifyHttpStatus(this.name, BRAVE_LABEL, response.status);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      // Таймаут может сработать уже после заголовков — на чтении тела.
      if (signal.aborted) {
        throw new RetryableNodeException(
          WEB_SEARCH_NODE_TYPE,
          `Brave: истёк таймаут чтения ответа (${REQUEST_TIMEOUT_MS} мс)`,
          { cause: error },
        );
      }

      throw new WebSearchProviderException(
        this.name,
        'Brave вернул ответ не в формате JSON',
        { cause: error },
      );
    }

    const parsed = BraveSearchResponseSchema.safeParse(payload);

    if (!parsed.success) {
      // Точный path и обрезанный raw — иначе по «1 ошибка схемы» не найти
      // разошедшееся поле (как в Tavily/CreativeLab, KI-111).
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');

      this.logger.error(
        `Brave response schema mismatch: ${details}; raw=${JSON.stringify(payload).slice(0, 800)}`,
      );

      throw new WebSearchProviderException(
        this.name,
        `неожиданный формат ответа Brave: ${details}`,
        { cause: parsed.error },
      );
    }

    // RULES § 5.9: текст запроса (может содержать PII) не логируем.
    const results = parsed.data.web?.results ?? [];

    this.logger.debug(
      `Brave: queryLen=${normalizedQuery.length}, results=${results.length}`,
    );

    return results.map(toWebSearchResult);
  }
}

/**
 * Переводит `freshness` в формат Brave Search API.
 *
 * Алиасы `day`/`week`/`month`/`year` → `pd`/`pw`/`pm`/`py`; нативный формат
 * (`pd`/`pw`/`pm`/`py` или `YYYY-MM-DDtoYYYY-MM-DD`) передаётся как есть.
 * Нераспознанное значение игнорируется: неподдерживаемый параметр не должен
 * ронять поиск (поле опциональное).
 *
 * @param value - `freshness` из опций узла
 * @returns значение для query-параметра `freshness` либо `undefined`
 */
export function mapBraveFreshness(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  switch (normalized.toLowerCase()) {
    case 'day':
      return 'pd';
    case 'week':
      return 'pw';
    case 'month':
      return 'pm';
    case 'year':
      return 'py';
    default:
      // Нативный формат Brave: pd/pw/pm/py или диапазон дат через `to`.
      return /^(pd|pw|pm|py)$/i.test(normalized) ||
        /^\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2}$/.test(normalized)
        ? normalized
        : undefined;
  }
}

/**
 * Приводит результат Brave к контракту {@link WebSearchResult}.
 *
 * @param result - разобранный результат upstream
 * @returns результат с очищенным от HTML и обрезанным сниппетом
 */
function toWebSearchResult(result: BraveResult): WebSearchResult {
  return {
    title: stripHtml(result.title),
    url: result.url,
    snippet: truncate(stripHtml(result.description), SNIPPET_MAX_LENGTH),
  };
}
