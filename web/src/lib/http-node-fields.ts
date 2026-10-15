import type { HttpMethod } from '@/types/graph';

/**
 * Методы HTTP-узла в порядке показа в селекте (DESIGN v0.8 § 8.1).
 *
 * Список — единственный источник и для `<select>`, и для рантайм-валидации
 * `data.method` (значение из БД не типизировано).
 */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;

/** Метод по умолчанию: как в `createNode` и в Zod-схеме backend. */
export const DEFAULT_HTTP_METHOD: HttpMethod = 'GET';

/**
 * Методы, у которых есть тело запроса.
 *
 * Для `GET` тело в UI не показывается: `fetch` его игнорирует, и поле только
 * путало бы.
 */
export const HTTP_METHODS_WITH_BODY: readonly HttpMethod[] = ['POST', 'PUT', 'DELETE'];

/**
 * Верхняя граница таймаута HTTP-узла, мс.
 *
 * Дублирует backend-константу `HTTP_MAX_TIMEOUT_MS` (`src/engine/node-executors.ts`,
 * R6.5.1): значение выше этой границы отвергнет Zod-схема уже на запуске, а
 * `max` у поля ввода не даёт ввести заведомо непригодное число.
 */
export const HTTP_TIMEOUT_LIMIT = 120_000;

/**
 * Проверяет метод HTTP-узла из недоверенного источника.
 *
 * @param value - значение из `data.method` (тип не гарантирован)
 * @returns валидный метод либо {@link DEFAULT_HTTP_METHOD}
 */
export function validateHttpMethod(value: unknown): HttpMethod {
  return HTTP_METHODS.find((method) => method === value) ?? DEFAULT_HTTP_METHOD;
}

/**
 * Проверяет таймаут HTTP-узла из недоверенного источника.
 *
 * Допустимо только положительное целое в пределах {@link HTTP_TIMEOUT_LIMIT}:
 * так значение не потеряется при Load/Save, а мусор (`0`, `-1`, `1.5`, строка)
 * будет отброшен. `undefined` — «поле не задано» (backend возьмёт дефолт).
 *
 * @param value - значение из поля ввода или из БД
 * @returns положительное целое либо `undefined`
 */
export function validateTimeoutMs(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= HTTP_TIMEOUT_LIMIT
    ? value
    : undefined;
}

/**
 * Проверяет карту заголовков HTTP-узла из недоверенного источника.
 *
 * Значения заголовков в БД не типизированы (`jsonb`), поэтому проверяем и
 * контейнер, и каждую пару: иначе в `fetch` уехал бы заголовок-объект и запрос
 * упал бы невнятной ошибкой провайдера.
 *
 * @param value - значение из `data.headers`
 * @returns копия карты строковых заголовков либо `undefined`, если заголовков нет
 */
export function validateHttpHeaders(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Проверяет, что строка — абсолютный URL с протоколом `http`/`https`.
 *
 * Нужна только для подсказки в UI (`aria-invalid` у поля URL): backend
 * валидирует адрес сам, а `fetch` умеет и относительные пути — поэтому
 * невалидный URL не блокирует сохранение графа, а лишь предупреждает автора.
 *
 * @param value - значение поля URL
 * @returns `true`, если значение разбирается как абсолютный `http`/`https`-URL
 */
export function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed === '') {
    return false;
  }

  try {
    const url = new URL(trimmed);

    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    // `new URL` бросает на относительных путях и мусоре — оба случая невалидны.
    return false;
  }
}
