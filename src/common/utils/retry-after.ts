/**
 * Разбор HTTP-заголовка `Retry-After` (v0.11 S10, DESIGN § 3.3.2).
 *
 * Провайдеры отдают подсказку о паузе в двух форматах, разрешённых RFC 9110:
 * число секунд (`Retry-After: 120`) либо HTTP-дата
 * (`Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`). Оба формата сводятся к
 * миллисекундам, чтобы движок мог сравнить подсказку с экспоненциальной
 * задержкой и не ждать дольше, чем нужно.
 */

/**
 * Приводит значение `Retry-After` к миллисекундам.
 *
 * @param value - сырое значение заголовка (`null`/пустая строка — заголовка нет)
 * @param nowMs - текущее время в мс (для формата HTTP-даты; параметр нужен,
 *   чтобы тесты не зависели от системных часов)
 * @returns пауза в мс (0, если дата уже в прошлом) либо `undefined`, если
 *   заголовка нет или он не разобран
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  // Формат 1: delta-seconds. Дробное значение тоже принимаем: часть прокси
  // отдаёт `0.5`, хотя RFC требует целое. Отрицательное значение — мусор:
  // не пропускаем его в `Date.parse`, который может трактовать `-5` как год.
  if (trimmed.startsWith('-')) {
    return undefined;
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);

    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
  }

  // Формат 2: HTTP-дата. `Date.parse` понимает IMF-fixdate; остальные
  // исторические форматы (RFC 850, asctime) в провайдерах не встречаются.
  const timestampMs = Date.parse(trimmed);

  if (Number.isNaN(timestampMs)) {
    return undefined;
  }

  return Math.max(0, timestampMs - nowMs);
}
