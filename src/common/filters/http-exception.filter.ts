import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Единый формат тела ошибки API (RULES § 1.6 / § 4.7).
 *
 * Фронтенд (`web/src/lib/api.ts`) читает `message` и не зависит от дефолтного
 * Nest-формата `{ statusCode, message, error }`. `errorCode` — машинный код для
 * тех ошибок, где UI нужно различать причину без разбора текста (например,
 * `WORKFLOW_NOT_FOUND`); для остальных поле отсутствует.
 */
export interface HttpExceptionFilterBody {
  /** Всегда `false`: успешные ответы этот фильтр не трогает. */
  success: false;
  /** Человекочитаемое сообщение (склеенные сообщения валидации — через `; `). */
  message: string;
  /** Машинный код ошибки, если исключение его задало. */
  errorCode?: string;
}

/** Формат ответа, который Nest отдаёт в `HttpException.getResponse()`. */
interface HttpExceptionResponseBody {
  message?: unknown;
  error?: unknown;
  errorCode?: unknown;
  code?: unknown;
}

/** Сообщение для непредвиденных ошибок: детали не уходят клиенту (RULES 5.3). */
export const INTERNAL_ERROR_MESSAGE = 'Внутренняя ошибка сервера';

/**
 * Приводит `message` из ответа исключения к строке.
 *
 * Nest/`ValidationPipe` отдают массив сообщений, а доменные исключения —
 * строку. Массив склеивается через `; `: формат ответа остаётся строкой, а
 * фронтенд уже умеет показывать такой текст.
 *
 * @param value - значение `message` из `HttpException.getResponse()`
 * @returns строка сообщения либо `undefined`, если значения нет
 */
function normalizeMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (Array.isArray(value)) {
    const messages = value.filter(
      (item): item is string => typeof item === 'string' && item.length > 0,
    );

    return messages.length > 0 ? messages.join('; ') : undefined;
  }

  return undefined;
}

/**
 * Достаёт машинный код ошибки из тела исключения.
 *
 * Поддерживаются оба распространённых имени: `errorCode` (наш контракт) и
 * `code` (например, `DocumentTemplateInvalidException`). Код не выдумывается
 * из HTTP-статуса: `errorCode` в ответе означает «этот случай можно
 * обработать программно», а не «любая 404».
 *
 * @param body - тело ответа исключения
 * @returns код либо `undefined`
 */
function extractErrorCode(body: HttpExceptionResponseBody): string | undefined {
  for (const candidate of [body.errorCode, body.code]) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Глобальный фильтр исключений: единый формат ошибок для всего API (KI-012).
 *
 * До него Nest отдавал дефолтное тело `{ statusCode, message, error }`, а
 * `ZodValidationPipe` — ещё и `validation` с деталями. Фронтенд ждёт
 * `{ success: false, message }`, поэтому формат нормализуется здесь, а не в
 * каждом контроллере.
 *
 * **Что не утекает.** Для не-`HttpException` клиент получает общий текст
 * {@link INTERNAL_ERROR_MESSAGE}, а стек и исходное сообщение пишутся в лог.
 * Тело запроса и заголовки не логируются (RULES 5.3): в них бывают токены.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Формирует ответ на исключение.
   *
   * @param exception - значение из `catch` (тип `unknown`: бросают что угодно)
   * @param host - контекст Nest с HTTP request/response
   * @returns ничего; ответ отправляется через `response`
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // Ответ уже начат (например, ошибка после `pipe`/`res.write`) — повторный
    // `json()` бросил бы ERR_HTTP_HEADERS_SENT и скрыл исходную ошибку.
    if (response.headersSent) {
      return;
    }

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string;
    let errorCode: string | undefined;

    if (isHttpException) {
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        const body = exceptionResponse as HttpExceptionResponseBody;
        message =
          normalizeMessage(body.message) ??
          normalizeMessage(body.error) ??
          exception.message;
        errorCode = extractErrorCode(body);
      }
    } else {
      message = INTERNAL_ERROR_MESSAGE;
      this.logInternalError(exception, request);
    }

    const body: HttpExceptionFilterBody = {
      success: false,
      message,
      ...(errorCode === undefined ? {} : { errorCode }),
    };

    response.status(status).json(body);
  }

  /**
   * Логирует непредвиденную ошибку с контекстом запроса.
   *
   * Пишутся только метод и путь без query: query может содержать токен
   * (например, `?token=` у share-ссылок). Стек — отдельным аргументом, чтобы
   * `Logger` не склеивал его с сообщением.
   *
   * @param exception - исходное значение из `catch`
   * @param request - HTTP-запрос
   * @returns ничего
   */
  private logInternalError(exception: unknown, request: Request): void {
    const method = request.method;
    const path = request.originalUrl.split('?')[0];
    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(`${method} ${path} → 500: ${message}`, stack);
  }
}
