/**
 * Общий HTTP-слой прямых media-провайдеров (R7.3).
 *
 * Replicate, FAL и OpenAI Images — разные API (разные схемы авторизации,
 * разные формы ответа), но одинаковые в одном: запрос с таймаутом (RULES 4.19),
 * разбор JSON на границе (RULES 1.17) и превращение не-2xx в
 * {@link MediaProviderException} с корректным признаком `retryable`.
 *
 * Без общего модуля эта логика была бы скопирована трижды, а расхождение в
 * признаке `retryable` управляет тем, повторит ли worker платный вызов
 * (KI-040): ошибка «повторяем 400» стоила бы лишних генераций, а «не
 * повторяем 503» — потерянных запусков.
 */

import { parseRetryAfterMs } from '../../common/utils/retry-after.js';
import { MediaProviderException } from '../media-provider.interface.js';

/** Таймаут по умолчанию для запросов каталога моделей (мс). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Признак «временной» ошибки по HTTP-статусу.
 *
 * `429` — rate limit, `5xx` — сбой upstream. Остальные (`400`, `401`, `402`,
 * `403`, `404`, `422`) детерминированы: повтор с тем же телом даст тот же
 * результат.
 *
 * @param status - HTTP-статус ответа
 * @returns `true`, если вызов имеет смысл повторить
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Строит ошибку провайдера по не-2xx ответу.
 *
 * Текст от upstream добавляется к сообщению, но не заменяет его: у Replicate и
 * FAL ошибка приходит как `{"detail": "..."}`, у OpenAI — как
 * `{"error": {"message": "..."}}`, и без префикса в логе терялось бы, к какому
 * провайдеру относится сообщение.
 *
 * @param provider - имя провайдера (для префикса исключения)
 * @param action - что делали («не удалось создать задачу»)
 * @param response - ответ с не-2xx статусом
 * @returns ошибка с выставленным `retryable` и подсказкой `retryAfterMs`
 *   (v0.11 S10: заголовок `Retry-After`, если upstream его отдал)
 */
export async function buildHttpErrorAsync(
  provider: string,
  action: string,
  response: Response,
): Promise<MediaProviderException> {
  const details = await readErrorTextAsync(response);
  const suffix = details === null ? '' : `: ${details}`;
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));

  return new MediaProviderException(
    provider,
    `${action} — upstream ответил ${response.status}${suffix}`,
    {
      retryable: isRetryableStatus(response.status),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  );
}

/**
 * Читает текст ошибки из тела ответа upstream.
 *
 * Тело может быть не JSON, пустым или содержать вложенный объект, поэтому
 * любые проблемы разбора приводятся к `null`, а не роняют обработку статуса.
 *
 * @param response - ответ upstream (тело читается один раз)
 * @returns текст причины либо `null`, если upstream её не объяснил
 */
export async function readErrorTextAsync(
  response: Response,
): Promise<string | null> {
  let payload: unknown;

  try {
    const raw = await response.text();

    if (raw.trim().length === 0) {
      return null;
    }

    payload = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  return extractErrorText(payload);
}

/**
 * Достаёт текст ошибки из разобранного тела ответа.
 *
 * Поддерживаются формы, которые реально отдают провайдеры R7.3:
 * `{"detail": "..."}` (Replicate, FAL),
 * `{"error": {"message": "..."}}` и `{"error": "..."}` (OpenAI),
 * `{"message": "..."}` (общая).
 *
 * @param payload - разобранное тело ответа
 * @returns текст причины либо `null`
 */
function extractErrorText(payload: unknown): string | null {
  if (typeof payload === 'string') {
    return payload.trim().length > 0 ? payload : null;
  }

  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const record = payload as Record<string, unknown>;

  for (const key of ['detail', 'message'] as const) {
    const value = record[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const nested = record.error;

  if (typeof nested === 'string' && nested.trim().length > 0) {
    return nested;
  }

  if (typeof nested === 'object' && nested !== null) {
    const message = (nested as Record<string, unknown>).message;

    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }

  return null;
}

/**
 * Проверяет, что разобранный ответ — объект-словарь.
 *
 * Провайдеры отдают JSON-объект на верхнем уровне; массив или скаляр означают
 * несовпадение контракта, и падать на `payload.id` в таком случае нельзя —
 * ошибка типа не объяснила бы причину.
 *
 * @param payload - разобранное тело ответа
 * @returns `true`, если это словарь
 */
export function isJsonObject(
  payload: unknown,
): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

/**
 * Читает строковое поле из ответа upstream.
 *
 * @param value - значение из JSON
 * @returns строку без крайних пробелов либо `null`, если поля нет/оно пустое
 */
export function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Читает числовое поле из ответа upstream.
 *
 * @param value - значение из JSON
 * @returns число либо `null`, если поле не число (строки не приводятся:
 *   «цена» из чужого поля — хуже, чем отсутствие цены)
 */
export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Проверяет, что строка — `http(s)`-ссылка на входной файл.
 *
 * Все три провайдера принимают вход **ссылкой** и скачивают файл сами
 * (`data:`-URL и локальные пути не поддерживаются), поэтому проверка на нашей
 * стороне даёт понятную ошибку до платного запроса (RULES 1.9).
 *
 * @param input - значение, пришедшее как входной файл
 * @param provider - имя провайдера (для текста ошибки)
 * @param tool - операция инструмента (для текста ошибки)
 * @returns проверенную ссылку
 * @throws MediaProviderException если ссылка пуста или не `http(s)`
 */
export function readHttpUrl(
  input: string,
  provider: string,
  tool: string,
): string {
  const value = input.trim();
  const isHttp = value.startsWith('https://') || value.startsWith('http://');

  if (!isHttp) {
    throw new MediaProviderException(
      provider,
      `операции ${tool} нужна публичная http(s)-ссылка на входной файл, получено: ${
        value.length > 0 ? `${value.slice(0, 120)}…` : 'пустое значение'
      }`,
    );
  }

  return value;
}
