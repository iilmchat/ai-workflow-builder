import { WEB_SEARCH_MAX_RESULTS_LIMIT } from '@/types/graph';

/**
 * Результат поиска, который узел рисует в своём теле (v0.10 S2).
 *
 * Повторяет `WebSearchResult` backend без `rawContent`: исполнитель не пишет
 * полный текст страницы в `node_runs.outputs` (KI-459), поэтому UI его и не
 * ждёт.
 */
export interface WebSearchResultView {
  /** Заголовок источника. */
  title: string;
  /** Канонический URL. */
  url: string;
  /** Краткий фрагмент для превью. */
  snippet: string;
}

/**
 * Проверяет `maxResults` узла `web_search`.
 *
 * Допустимо целое 1…{@link WEB_SEARCH_MAX_RESULTS_LIMIT}. Всё остальное —
 * `undefined`: backend применит свой дефолт, а мусор из `<input type="number">`
 * не попадёт в граф.
 *
 * @param value - значение из `data.maxResults` (jsonb, `unknown`)
 * @returns целое в допустимом диапазоне либо `undefined`
 */
export function validateMaxResults(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }

  return value >= 1 && value <= WEB_SEARCH_MAX_RESULTS_LIMIT ? value : undefined;
}

/**
 * Значение поля `maxResults` для `<input type="number">`.
 *
 * @param raw - строка из input (пустая — поле не задано)
 * @returns число для валидатора либо `undefined`
 */
export function parseMaxResultsInput(raw: string): number | undefined {
  if (raw.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Проверяет запрос узла `web_search`.
 *
 * Пустая строка — валидное состояние «ещё не заполнено»: если нет и входа
 * `prompt`, Run упадёт понятной ошибкой backend. UI не подставляет запрос
 * молча (принцип KI-069).
 *
 * @param value - значение из `data.query`
 * @returns строка запроса (пустая, если значение не строка)
 */
export function validateQuery(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Достаёт список результатов из `nodeOutputs` узла.
 *
 * Данные приходят из SSE/снимка запуска как `unknown`, поэтому каждое поле
 * проверяется: чужой узел с ключом `results` не должен ронять рендер холста.
 * Массив ограничен {@link WEB_SEARCH_MAX_RESULTS_LIMIT} — это же число
 * ограничивает backend.
 *
 * @param outputs - выходы узла из стора (`undefined` — узел ещё не выполнялся)
 * @returns валидные результаты в порядке провайдера
 */
export function readWebSearchResults(
  outputs: Record<string, unknown> | undefined,
): WebSearchResultView[] {
  const raw = outputs?.results;

  if (!Array.isArray(raw)) {
    return [];
  }

  const results: WebSearchResultView[] = [];

  for (const item of raw) {
    if (results.length >= WEB_SEARCH_MAX_RESULTS_LIMIT) {
      break;
    }

    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const { title, url, snippet } = record;

    if (
      typeof title !== 'string' ||
      typeof url !== 'string' ||
      typeof snippet !== 'string'
    ) {
      continue;
    }

    results.push({ title, url, snippet });
  }

  return results;
}
