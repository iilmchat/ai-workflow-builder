/**
 * Web-search-провайдер Tavily (v0.10 S1).
 *
 * Ходит в REST API `POST https://api.tavily.com/search` встроенным `fetch`
 * (как CreativeLab/replicate: без SDK-зависимости). Ключ уходит только в
 * заголовке `Authorization: Bearer …` и не попадает ни в тело, ни в логи.
 *
 * ### Почему отдельный провайдер, а не вызов в узле
 *
 * Узел `web_search` (S2) работает с {@link IWebSearchProvider}. Tavily — первая
 * реализация; `WEB_SEARCH_PROVIDER` уже enum, поэтому Bing/Google/Brave
 * добавляются без изменения узла и executor'а (DESIGN v0.10 § 2.2).
 *
 * ### Ошибки и retry
 *
 * - `401`/`403` — ключ не принят: {@link WebSearchProviderException},
 *   повтор бессмыслен;
 * - `429` — rate limit, `5xx` — сбой upstream: `RetryableNodeException`,
 *   движок повторит узел (KI-036);
 * - таймаут/сетевой сбой — тоже `RetryableNodeException`;
 * - прочие `4xx` — детерминированная ошибка провайдера.
 *
 * ### Raw content
 *
 * В запросе всегда `include_raw_content: true`: исполнитель S2 сможет отдать
 * LLM полный текст страницы, а не только сниппет. Если Tavily `raw_content` не
 * вернул, поля `rawContent` в результате нет.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { RetryableNodeException } from '../engine/errors.js';
import {
  WebSearchProviderException,
  type IWebSearchProvider,
  type WebSearchOptions,
  type WebSearchResult,
} from './web-search.interface.js';

/** Идентификатор провайдера в логах, ошибках и env `WEB_SEARCH_PROVIDER`. */
export const TAVILY_PROVIDER_NAME = 'tavily';

/** Endpoint Tavily Search API (DESIGN v0.10 § 3.1.2). */
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/** Тип узла для `RetryableNodeException` (маркер для движка). */
const NODE_TYPE = 'web_search';

/** Таймаут запроса к Tavily (RULES 4.19). */
const REQUEST_TIMEOUT_MS = 15_000;

/** Дефолт `max_results`, если вызывающий код не задал лимит. */
const DEFAULT_MAX_RESULTS = 5;

/** Жёсткий cap `max_results` (DESIGN v0.10 § 3.1.4/§ 7.2). */
const MAX_RESULTS_LIMIT = 10;

/** Длина сниппета, отдаваемого в LLM (DESIGN v0.10 § 3.1.2). */
const SNIPPET_MAX_LENGTH = 500;

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
 * Остальные поля (`answer`, `response_time`, `request_id`, …) не нужны S1 и
 * отбрасываются Zod'ом: контракт узла — только список результатов.
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
   * @param options - лимит результатов (1–10, дефолт 5)
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

    const maxResults = normalizeMaxResults(options?.maxResults);
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
          max_results: maxResults,
          // Полный текст страницы — если Tavily его отдаст (DESIGN § 3.1.2).
          include_raw_content: true,
        }),
        signal,
      });
    } catch (error: unknown) {
      throw new RetryableNodeException(
        NODE_TYPE,
        signal.aborted
          ? `Tavily: истёк таймаут запроса (${REQUEST_TIMEOUT_MS} мс)`
          : 'Tavily: не удалось обратиться к API поиска',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw this.toProviderError(response.status);
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
          NODE_TYPE,
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

  /**
   * Превращает HTTP-статус ошибки upstream в исключение нужного типа.
   *
   * @param status - не-2xx статус ответа Tavily
   * @returns детерминированная ошибка либо retryable-исключение
   */
  private toProviderError(
    status: number,
  ): WebSearchProviderException | RetryableNodeException {
    if (status === 401 || status === 403) {
      return new WebSearchProviderException(
        this.name,
        `ключ Tavily не принят (${status})`,
      );
    }

    if (status === 429) {
      return new RetryableNodeException(
        NODE_TYPE,
        'Tavily: превышен лимит запросов (429)',
      );
    }

    if (status >= 500) {
      return new RetryableNodeException(
        NODE_TYPE,
        `Tavily: временная ошибка upstream (${status})`,
      );
    }

    return new WebSearchProviderException(
      this.name,
      `Tavily отклонил запрос (${status})`,
    );
  }
}

/**
 * Нормализует `maxResults` к диапазону 1–{@link MAX_RESULTS_LIMIT}.
 *
 * @param value - значение из опций (может быть `undefined`, дробным, NaN)
 * @returns целое число в допустимом диапазоне
 */
function normalizeMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_RESULTS_LIMIT);
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

/**
 * Обрезает текст до лимита, добавляя многоточие.
 *
 * @param value - исходный текст
 * @param maxLength - максимальная длина результата
 * @returns исходный текст либо обрезанный с `…`
 */
function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
