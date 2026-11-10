import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HttpExceptionFilter,
  INTERNAL_ERROR_MESSAGE,
  type HttpExceptionFilterBody,
} from './http-exception.filter.js';

/** Мок Express-ответа с цепочкой `status().json()`. */
interface ResponseMock {
  readonly response: Response;
  readonly status: ReturnType<typeof vi.fn>;
  readonly json: ReturnType<typeof vi.fn>;
}

/**
 * Собирает мок `Response`, запоминающий код и тело.
 *
 * @param headersSent - значение `response.headersSent`
 * @returns мок ответа и его шпионы
 */
function createResponseMock(headersSent = false): ResponseMock {
  const json = vi.fn();
  const status = vi.fn();
  const response = {
    headersSent,
    status: (code: number) => {
      status(code);

      return response;
    },
    json,
  } as unknown as Response;

  return { response, status, json };
}

/**
 * Собирает `ArgumentsHost` с подставными request/response.
 *
 * @param response - мок ответа
 * @param request - мок запроса (по умолчанию GET /workflow)
 * @returns мок `ArgumentsHost`
 */
function createHost(
  response: Response,
  request: Partial<Request> = { method: 'GET', originalUrl: '/workflow' },
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request as Request,
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter (KI-012)', () => {
  let filter: HttpExceptionFilter;
  let loggerError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // 500-е пишут ERROR — в тестах это ожидаемый шум.
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('отдаёт строковое сообщение HttpException в едином формате', () => {
    const { response, status, json } = createResponseMock();

    filter.catch(
      new BadRequestException('Некорректный id'),
      createHost(response),
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Некорректный id',
    } satisfies HttpExceptionFilterBody);
  });

  it('склеивает массив сообщений валидации и сохраняет errorCode', () => {
    const { response, status, json } = createResponseMock();

    filter.catch(
      new HttpException(
        {
          message: ['name обязателен', 'nodes должен быть массивом'],
          errorCode: 'WORKFLOW_INVALID',
        },
        422,
      ),
      createHost(response),
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'name обязателен; nodes должен быть массивом',
      errorCode: 'WORKFLOW_INVALID',
    } satisfies HttpExceptionFilterBody);
  });

  it('поддерживает code как альтернативное имя машинного кода', () => {
    const { response, json } = createResponseMock();

    filter.catch(
      new ConflictException({
        message: 'Уже существует',
        code: 'ALREADY_EXISTS',
      }),
      createHost(response),
    );

    expect(json).toHaveBeenCalledWith({
      success: false,
      message: 'Уже существует',
      errorCode: 'ALREADY_EXISTS',
    } satisfies HttpExceptionFilterBody);
  });

  it('не добавляет errorCode, если исключение его не задало', () => {
    const { response, json } = createResponseMock();

    filter.catch(
      new NotFoundException('Workflow не найден'),
      createHost(response),
    );

    const body = json.mock.calls[0]?.[0] as HttpExceptionFilterBody;

    expect(body).not.toHaveProperty('errorCode');
  });

  it('прячет детали неизвестной ошибки и логирует их', () => {
    const { response, status, json } = createResponseMock();
    const error = new Error('connection string postgres://secret');

    filter.catch(error, createHost(response));

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      success: false,
      message: INTERNAL_ERROR_MESSAGE,
    } satisfies HttpExceptionFilterBody);
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('GET /workflow → 500'),
      error.stack,
    );
  });

  it('не логирует query-строку (в ней бывают токены)', () => {
    const { response } = createResponseMock();

    filter.catch(
      new Error('boom'),
      createHost(response, {
        method: 'GET',
        originalUrl: '/workflow/share/secret-token?token=leak',
      }),
    );

    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('GET /workflow/share/secret-token → 500'),
      expect.anything(),
    );
    expect(loggerError).not.toHaveBeenCalledWith(
      expect.stringContaining('token=leak'),
      expect.anything(),
    );
  });

  it('не пишет ответ, если заголовки уже отправлены', () => {
    const { response, status, json } = createResponseMock(true);

    filter.catch(new Error('late failure'), createHost(response));

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
