/**
 * Общие утилиты web-search-провайдеров (v0.15 S3).
 *
 * Вынесены, чтобы Tavily/Bing/Brave одинаково нормализовали лимит результатов
 * и классифицировали HTTP-статусы: расхождение в трактовке 401/429/5xx
 * означало бы, что узел `web_search` повторяется по-разному в зависимости от
 * провайдера (DESIGN v0.10 § 3.1.6, KI-036).
 */
import { RetryableNodeException } from '../../engine/errors.js';
import { WebSearchProviderException } from '../web-search.interface.js';

/** Таймаут одного HTTP-запроса к провайдеру (RULES 4.19). */
export const REQUEST_TIMEOUT_MS = 15_000;

/** `maxResults` по умолчанию, если вызывающий код не задал лимит. */
export const DEFAULT_MAX_RESULTS = 5;

/** Жёсткий cap `maxResults` (DESIGN v0.10 § 3.1.4/§ 7.2). */
export const MAX_RESULTS_LIMIT = 10;

/** Длина сниппета, отдаваемого в LLM (DESIGN v0.10 § 3.1.2). */
export const SNIPPET_MAX_LENGTH = 500;

/** Тип узла для `RetryableNodeException` (маркер для движка). */
export const WEB_SEARCH_NODE_TYPE = 'web_search';

/**
 * Нормализует `maxResults` к диапазону 1–{@link MAX_RESULTS_LIMIT}.
 *
 * @param value - значение из опций (может быть `undefined`, дробным, NaN)
 * @returns целое число в допустимом диапазоне
 */
export function normalizeMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_RESULTS_LIMIT);
}

/**
 * Обрезает текст до лимита, добавляя многоточие.
 *
 * @param value - исходный текст
 * @param maxLength - максимальная длина результата
 * @returns исходный текст либо обрезанный с `…`
 */
export function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

/**
 * Превращает HTTP-статус ошибки upstream в исключение нужного типа.
 *
 * - `401`/`403` — ключ не принят, повтор бессмыслен;
 * - `429`/`5xx` — временный сбой, движок повторит узел;
 * - прочие `4xx` — детерминированная ошибка провайдера.
 *
 * @param provider - идентификатор провайдера (`tavily`, `bing`, `brave`)
 * @param label - человекочитаемое имя для текста ошибки (`Bing`)
 * @param status - не-2xx статус ответа провайдера
 * @returns детерминированная ошибка либо retryable-исключение
 */
export function classifyHttpStatus(
  provider: string,
  label: string,
  status: number,
): WebSearchProviderException | RetryableNodeException {
  if (status === 401 || status === 403) {
    return new WebSearchProviderException(
      provider,
      `ключ ${label} не принят (${status})`,
    );
  }

  if (status === 429) {
    return new RetryableNodeException(
      WEB_SEARCH_NODE_TYPE,
      `${label}: превышен лимит запросов (429)`,
    );
  }

  if (status >= 500) {
    return new RetryableNodeException(
      WEB_SEARCH_NODE_TYPE,
      `${label}: временная ошибка upstream (${status})`,
    );
  }

  return new WebSearchProviderException(
    provider,
    `${label} отклонил запрос (${status})`,
  );
}

/**
 * Убирает HTML-теги из сниппета провайдера (Brave отдаёт `description` с
 * разметкой подсветки) и декодирует минимальный набор сущностей.
 *
 * Результаты поиска — недоверенный контент (DESIGN v0.10 § 3.1.2); вставлять
 * их в UI как HTML нельзя, поэтому на границе остаётся plain text.
 *
 * @param value - текст из ответа провайдера
 * @returns текст без тегов
 */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Приводит дату к формату `YYYY-MM-DD` (UTC) для диапазонов `freshness`.
 *
 * @param date - дата
 * @returns строка `YYYY-MM-DD`
 */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
