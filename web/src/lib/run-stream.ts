import { refreshSessionAsync } from '@/lib/api';
import { parseSseEvents } from '@/lib/sse-parser';
import { getAccessToken } from '@/stores/auth';
import {
  RunStreamMessageSchema,
  type RunStreamMessage,
} from '@/types/run-stream';

/** Сколько подряд ошибок соединения терпим, прежде чем закрыть поток. */
const MAX_CONSECUTIVE_ERRORS = 3;

/** Пауза перед повторным подключением после сетевой ошибки. */
const RETRY_DELAY_MS = 1000;

/**
 * Ошибка «запуск недоступен»: подписка заведомо не восстановится.
 *
 * Бросается, когда повторная попытка не поможет: HTTP-статус, отличный от 200
 * (например, 404 — запуск удалён или принадлежит другому пользователю), либо
 * 401 после неудачного refresh. По этой ошибке повтор не выполняется, а
 * подписчик (стор) очищает `?runId=` и состояние запуска (KI-271).
 *
 * Отдельный класс, а не текст в `Error`: подписчику нужно отличать «запуск не
 * существует» от временного сетевого сбоя, по которому поток переподключается
 * (KI-268).
 */
export class RunStreamUnavailableError extends Error {
  /**
   * @param status - HTTP-статус ответа (401, 404, …)
   */
  constructor(status: number) {
    super(`Поток запуска недоступен: HTTP ${status}`);
    this.name = 'RunStreamUnavailableError';
  }
}

/** Колбэки подписки на поток запуска. */
export interface RunStreamHandlers {
  /** Вызывается на каждое валидное сообщение потока. */
  onMessage: (message: RunStreamMessage) => void;
  /**
   * Вызывается при ошибке соединения (сеть, HTTP-статус, отказ refresh).
   *
   * Вызывается на каждой неудачной попытке, поэтому по нему нельзя закрывать
   * поток: решение о фатальности принимает {@link RunStreamHandlers.onFatalError}.
   */
  onError?: (error: unknown) => void;
  /**
   * Вызывается, когда поток закрылся и переподключений больше не будет:
   * сервер завершил ответ (`run_completed` с `final`) либо исчерпаны попытки.
   */
  onClose?: () => void;
  /**
   * Вызывается, когда поток закрыт из-за повторяющихся ошибок соединения.
   *
   * @param attempts - сколько ошибок подряд накопилось до закрытия
   */
  onFatalError?: (attempts: number) => void;
}

/**
 * Открывает SSE-поток прогресса запуска через `fetch`.
 *
 * **Почему не `EventSource` (KI-268).** `EventSource` не умеет передавать
 * заголовки, поэтому с включённой авторизацией (`AUTH_DISABLED=false`) запрос
 * `GET /runs/:id/stream` уходил без `Authorization` и всегда получал 401:
 * прогресс запуска в UI не работал, а бейдж навсегда залипал в «Создаётся…».
 * `fetch` + `ReadableStream` даёт Bearer-заголовок, `AbortSignal` для cleanup и
 * возможность повторить запрос после refresh-токена тем же
 * `refreshSessionAsync`, что и остальные ручки (`lib/api.ts`).
 *
 * Сообщения валидируются Zod-схемой (поток — внешние данные, RULES 1.17);
 * битое сообщение логируется и игнорируется, чтобы не рвать подписку.
 *
 * @param runId - uuid запуска
 * @param handlers - колбэки на сообщение, ошибку, закрытие и фатальный обрыв
 * @returns функция закрытия потока (abort)
 */
export function subscribeToRunStream(
  runId: string,
  handlers: RunStreamHandlers,
): () => void {
  const controller = new AbortController();

  void consumeAsync(runId, handlers, controller.signal);

  return () => controller.abort();
}

/**
 * Читает поток до конца, переподключаясь после сетевых ошибок.
 *
 * @param runId - uuid запуска
 * @param handlers - колбэки подписки
 * @param signal - сигнал закрытия (abort возвращённой функцией)
 * @returns промис без значения (завершается вместе с потоком)
 */
async function consumeAsync(
  runId: string,
  handlers: RunStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let consecutiveErrors = 0;
  let closed = false;

  /**
   * Закрывает подписку ровно один раз.
   *
   * Abort — намеренное закрытие (новый запуск, сброс состояния), а не конец
   * потока: `onClose` в этом случае не зовём, иначе подписчик сбросил бы уже
   * новый handle.
   */
  const finish = (): void => {
    if (closed || signal.aborted) {
      return;
    }

    closed = true;
    handlers.onClose?.();
  };

  while (!signal.aborted && !closed) {
    try {
      const response = await openAsync(runId, signal);

      if (response.body === null) {
        // Не должно случаться в поддерживаемых браузерах — но без тела читать нечего.
        handlers.onError?.(new Error('Поток запуска пришёл без тела ответа'));
        finish();

        return;
      }

      await readAsync(
        response.body,
        (payload) => {
          consecutiveErrors = 0;
          dispatchEvent(payload, handlers);
        },
        signal,
      );

      // Сервер закрыл ответ (после `run_completed` с `final`) — не переподключаемся.
      if (!signal.aborted) {
        finish();
      }

      return;
    } catch (error: unknown) {
      if (signal.aborted) {
        return;
      }

      handlers.onError?.(error);

      // 404/401: повтор заведомо не поможет — закрываем поток сразу.
      if (error instanceof RunStreamUnavailableError) {
        finish();

        return;
      }

      consecutiveErrors += 1;

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        handlers.onFatalError?.(consecutiveErrors);
        finish();

        return;
      }

      await delayAsync(RETRY_DELAY_MS, signal);
    }
  }
}

/**
 * Открывает поток: подставляет токен, а на 401 обновляет сессию и повторяет.
 *
 * @param runId - uuid запуска
 * @param signal - сигнал закрытия
 * @returns ответ с потоком
 * @throws RunStreamUnavailableError если сессию восстановить не удалось (401)
 * @throws RunStreamUnavailableError при HTTP-статусе, отличном от 200 (404 и др.)
 */
async function openAsync(
  runId: string,
  signal: AbortSignal,
): Promise<Response> {
  let response = await fetchStreamAsync(runId, getAccessToken(), signal);

  if (response.status !== 401) {
    return ensureOkAsync(response);
  }

  // R6.1b.2: access истёк — обновляем его по refresh-cookie и пробуем один раз.
  const refreshed = await refreshSessionAsync();

  if (!refreshed) {
    throw new RunStreamUnavailableError(401);
  }

  response = await fetchStreamAsync(runId, getAccessToken(), signal);

  if (response.status === 401) {
    throw new RunStreamUnavailableError(401);
  }

  return ensureOkAsync(response);
}

/**
 * Проверяет статус ответа потока.
 *
 * @param response - ответ fetch
 * @returns тот же ответ, если он успешный
 * @throws RunStreamUnavailableError с HTTP-статусом иначе
 */
async function ensureOkAsync(response: Response): Promise<Response> {
  if (response.ok) {
    return response;
  }

  throw new RunStreamUnavailableError(response.status);
}

/**
 * Выполняет запрос потока с Bearer-заголовком.
 *
 * URL относительный: в dev его проксирует Vite, в prod — тот же origin
 * (`API_BASE` в `lib/api.ts` — пустая строка).
 *
 * @param runId - uuid запуска
 * @param token - access-токен либо `null`, если сессии нет
 * @param signal - сигнал закрытия
 * @returns ответ fetch
 */
async function fetchStreamAsync(
  runId: string,
  token: string | null,
  signal: AbortSignal,
): Promise<Response> {
  const headers = new Headers({ Accept: 'text/event-stream' });

  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(`/runs/${runId}/stream`, { headers, signal, cache: 'no-store' });
}

/**
 * Читает тело ответа и отдаёт payload'ы кадров по мере поступления.
 *
 * @param body - тело SSE-ответа
 * @param onEvent - обработчик payload'а завершённого кадра
 * @param signal - сигнал закрытия
 */
async function readAsync(
  body: ReadableStream<Uint8Array>,
  onEvent: (payload: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const chunk = await reader.read();

      if (chunk.done) {
        return;
      }

      // `stream: true` — многобайтовый символ может разрезаться между чанками.
      buffer += decoder.decode(chunk.value, { stream: true });

      const { events, rest } = parseSseEvents(buffer);
      buffer = rest;

      for (const payload of events) {
        onEvent(payload);
      }
    }
  } finally {
    // Освобождаем поток и при abort, и при обычном завершении.
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Валидирует payload и передаёт его подписчику.
 *
 * @param payload - JSON-строка из `data:`-строки кадра
 * @param handlers - колбэки подписки
 */
function dispatchEvent(payload: string, handlers: RunStreamHandlers): void {
  try {
    const message = RunStreamMessageSchema.parse(JSON.parse(payload) as unknown);

    handlers.onMessage(message);
  } catch (error: unknown) {
    // Битое сообщение не должно ломать подписку: пишем в консоль и ждём дальше.
    console.warn('Некорректное SSE-сообщение запуска', payload, error);
  }
}

/**
 * Ждёт паузу между попытками, прерываясь по abort.
 *
 * @param ms - длительность паузы
 * @param signal - сигнал закрытия
 */
async function delayAsync(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
