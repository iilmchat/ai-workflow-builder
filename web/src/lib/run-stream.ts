import {
  RunStreamMessageSchema,
  type RunStreamMessage,
} from '@/types/run-stream';

/** Сколько подряд ошибок соединения терпим, прежде чем закрыть поток. */
const MAX_CONSECUTIVE_ERRORS = 3;

/** Колбэки подписки на поток запуска. */
export interface RunStreamHandlers {
  /** Вызывается на каждое валидное сообщение потока. */
  onMessage: (message: RunStreamMessage) => void;
  /**
   * Вызывается при ошибке соединения.
   *
   * `EventSource` переподключается сам, поэтому обработчик нужен лишь для того,
   * чтобы закрыть поток, когда запуск уже завершён (KI-060).
   */
  onError?: (error: Event) => void;
  /**
   * Вызывается, когда поток закрыт из-за повторяющихся ошибок соединения.
   *
   * @param attempts - сколько ошибок подряд накопилось до закрытия
   */
  onFatalError?: (attempts: number) => void;
}

/**
 * Открывает SSE-поток прогресса запуска.
 *
 * Сообщения валидируются Zod-схемой (поток — внешние данные, RULES 1.17);
 * битое сообщение логируется и игнорируется, чтобы не рвать подписку.
 *
 * `EventSource` не поддерживает `AbortSignal` — поток закрывается только
 * возвращённой функцией либо автоматически после {@link MAX_CONSECUTIVE_ERRORS}
 * подряд ошибок соединения (страховка: `final` в snapshot не приходит, KI-063).
 *
 * @param runId - uuid запуска
 * @param handlers - колбэки на сообщение, ошибку и фатальный обрыв
 * @returns функция закрытия потока
 */
export function subscribeToRunStream(
  runId: string,
  handlers: RunStreamHandlers,
): () => void {
  const source = new EventSource(`/runs/${runId}/stream`);
  let consecutiveErrors = 0;
  let closed = false;

  /** Закрывает поток ровно один раз. */
  const close = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    source.close();
  };

  source.onmessage = (event: MessageEvent<string>): void => {
    consecutiveErrors = 0;

    try {
      const message = RunStreamMessageSchema.parse(JSON.parse(event.data) as unknown);

      handlers.onMessage(message);
    } catch (error: unknown) {
      // Битое сообщение не должно ломать подписку: пишем в консоль и ждём дальше.
      console.warn('Некорректное SSE-сообщение запуска', event.data, error);
    }
  };

  source.onerror = (error: Event): void => {
    consecutiveErrors += 1;
    handlers.onError?.(error);

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      close();
      handlers.onFatalError?.(consecutiveErrors);
    }
  };

  return close;
}
