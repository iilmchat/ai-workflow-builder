/**
 * Web-search-провайдер Tavily (v0.10 S1, v0.15 S3).
 *
 * Ходит в REST API `POST https://api.tavily.com/search` встроенным `fetch`
 * (как CreativeLab/replicate: без SDK-зависимости). Ключ уходит только в
 * заголовке `Authorization: Bearer …` и не попадает ни в тело, ни в логи.
 *
 * ### Параметры (v0.15 S3)
 *
 * - `max_results` — лимит результатов (1–10, дефолт 5);
 * - `search_depth` — `basic`/`advanced` из {@link WebSearchOptions.searchDepth};
 * - `time_range` — `day`/`week`/`month`/`year` из
 *   {@link WebSearchOptions.freshness} (Tavily поддерживает его для `general`
 *   и `news`);
 * - `include_raw_content: true` — полный текст страницы для LLM.
 *
 * ### Ошибки и retry
 *
 * Классификация общая с Bing/Brave ({@link classifyHttpStatus}): `401`/`403` —
 * ключ не принят, `429`/`5xx`/таймаут/сеть — retryable.
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
  truncate,
} from './provider-utils.js';

/** Идентификатор провайдера в логах, ошибках и env `WEB_SEARCH_PROVIDER`. */
export const TAVILY_PROVIDER_NAME = 'tavily' satisfies WebSearchProviderName;

/** Endpoint Tavily Search API (DESIGN v0.10 § 3.1.2). */
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/** Человекочитаемое имя провайдера для текстов ошибок. */
const TAVILY_LABEL = 'Tavily';

/**
 * Схема одного результата Tavily.
 *
 * `content` — сниппет, `raw_content` — полный текст страницы (может быть
 * `null`). `title` бывает пустым у отдельных источников, поэтому дефолт `''`;
 * `url` обязателен — без него результат бесполезен как источник.
 */
const TavilyResultSchema = z.object({
  title: z.string().default(''),
  url: z.string().min(1),
  content: z.string().default(''),
  raw_content: z.string().nullish(),
});

/**
 * Схема ответа Tavily Search API.
 *
 * Остальные поля (`answer`, `response_time`, `request_id`, …) не нужны узлу
 * и отбрасываются Zod'ом: контракт узла — только список результатов.
 */
const TavilySearchResponseSchema = z.object({
  results: z.array(TavilyResultSchema).default([]),
});

/** Результат Tavily после разбора схемы. */
type TavilyResult = z.infer<typeof TavilyResultSchema>;

/**
 * Провайдер веб-поиска Tavily.
 *
 * Без `TAVILY_API_KEY` не падает на старте (`isConfigured === false`), а
 * бросает {@link WebSearchProviderException} при вызове — так же, как
 * LLM/media-провайдеры: приложение поднимается без ключа.
 */
@Injectable()
export class TavilyProvider implements IWebSearchProvider {
  /** Идентификатор провайдера. */
  readonly name = TAVILY_PROVIDER_NAME;

  private readonly logger = new Logger(TavilyProvider.name);
  /** Ключ API либо `null`, если он не задан. */
  private readonly apiKey: string | null;

  /**
   * @param config - доступ к переменным окружения (RULES 4.6)
   */
  constructor(config: ConfigService) {
    const apiKey = (config.get<string>('TAVILY_API_KEY') ?? '').trim();
    this.apiKey = apiKey.length > 0 ? apiKey : null;

    if (!this.apiKey) {
      this.logger.warn(
        'TAVILY_API_KEY не задан — web-search (tavily) недоступен',
      );
    }
  }

  /** Готов ли провайдер к вызовам (задан ли `TAVILY_API_KEY`). */
  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Выполняет поиск через Tavily.
   *
   * @param query - поисковый запрос (PII не логируется — только длина)
   * @param options - лимит результатов (1–10, дефолт 5), глубина и свежесть
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
        'TAVILY_API_KEY не задан',
      );
    }

    const normalizedQuery = query.trim();

    if (normalizedQuery.length === 0) {
      throw new WebSearchProviderException(
        this.name,
        'пустой поисковый запрос',
      );
    }

    const timeRange = mapTavilyTimeRange(options?.freshness);
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query: normalizedQuery,
          max_results: normalizeMaxResults(options?.maxResults),
          // Полный текст страницы — если Tavily его отдаст (DESIGN § 3.1.2).
          include_raw_content: true,
          ...(options?.searchDepth !== undefined
            ? { search_depth: options.searchDepth }
            : {}),
          ...(timeRange !== undefined ? { time_range: timeRange } : {}),
        }),
        signal,
      });
    } catch (error: unknown) {
      throw new RetryableNodeException(
        WEB_SEARCH_NODE_TYPE,
        signal.aborted
          ? `Tavily: истёк таймаут запроса (${REQUEST_TIMEOUT_MS} мс)`
          : 'Tavily: не удалось обратиться к API поиска',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw classifyHttpStatus(this.name, TAVILY_LABEL, response.status);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      // Таймаут может сработать уже после заголовков — на чтении тела. Это
      // такая же временная ошибка, как отказ fetch, а не «битый JSON»:
      // иначе большой `raw_content` на медленном канале не повторялся бы.
      if (signal.aborted) {
        throw new RetryableNodeException(
          WEB_SEARCH_NODE_TYPE,
          `Tavily: истёк таймаут чтения ответа (${REQUEST_TIMEOUT_MS} мс)`,
          { cause: error },
        );
      }

      throw new WebSearchProviderException(
        this.name,
        'Tavily вернул ответ не в формате JSON',
        { cause: error },
      );
    }

    const parsed = TavilySearchResponseSchema.safeParse(payload);

    if (!parsed.success) {
      // Как в CreativeLab (KI-111): точный path и обрезанный raw — иначе по
      // «1 ошибка схемы» не найти разошедшееся поле.
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');

      this.logger.error(
        `Tavily response schema mismatch: ${details}; raw=${JSON.stringify(payload).slice(0, 800)}`,
      );

      throw new WebSearchProviderException(
        this.name,
        `неожиданный формат ответа Tavily: ${details}`,
        { cause: parsed.error },
      );
    }

    // RULES § 5.9: текст запроса (может содержать PII) не логируем.
    this.logger.debug(
      `Tavily: queryLen=${normalizedQuery.length}, results=${parsed.data.results.length}`,
    );

    return parsed.data.results.map(toWebSearchResult);
  }
}

/**
 * Переводит `freshness` в параметр Tavily `time_range`.
 *
 * Tavily принимает `day`/`week`/`month`/`year`; те же алиасы приходят из узла.
 * Нераспознанное значение игнорируется: неподдерживаемый параметр не должен
 * ронять поиск (поле опциональное).
 *
 * @param value - `freshness` из опций узла
 * @returns значение для `time_range` либо `undefined`
 */
export function mapTavilyTimeRange(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim().toLowerCase();

  return normalized !== undefined &&
    /^(day|week|month|year)$/.test(normalized)
    ? normalized
    : undefined;
}

/**
 * Приводит результат Tavily к контракту {@link WebSearchResult}.
 *
 * @param result - разобранный результат upstream
 * @returns результат с обрезанным сниппетом и `rawContent` (если он есть)
 */
function toWebSearchResult(result: TavilyResult): WebSearchResult {
  const rawContent = result.raw_content?.trim();

  return {
    title: result.title,
    url: result.url,
    snippet: truncate(result.content, SNIPPET_MAX_LENGTH),
    ...(rawContent ? { rawContent } : {}),
  };
}
