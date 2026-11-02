import {
  Logger,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService, type AuditEntry } from './audit.service.js';

/** Стабильные идентификаторы тестовых данных. */
const USER_ID = '44444444-4444-4444-8444-444444444444';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const RESOURCE_ID = '77777777-7777-4777-8777-777777777777';
const PARAM_RESOURCE_ID = '88888888-8888-4888-8888-888888888888';
const EMAIL = 'user@example.com';

/** Payload access-токена: автор действия и его организация. */
const USER: JwtPayload = { sub: USER_ID, email: EMAIL, orgId: ORG_ID };

/** Минимальный запрос, который читает интерсептор. */
interface TestRequest {
  method: string;
  path: string;
  params?: Record<string, string | undefined>;
  body?: unknown;
  user?: JwtPayload;
}

/** Минимальный ответ: интерсептору нужен только статус. */
interface TestResponse {
  statusCode: number;
}

/**
 * Создаёт контекст выполнения Nest с подставными request/response.
 *
 * @param request - запрос интерсептора
 * @param response - ответ интерсептора (нужен `statusCode`)
 * @returns контекст, который умеет отдавать request/response
 */
function createContext(
  request: TestRequest,
  response: TestResponse,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

/**
 * Создаёт обработчик, который успешно эмитит заданное тело ответа.
 *
 * @param body - тело ответа контроллера
 * @returns заглушка `CallHandler`
 */
function createHandler(body: unknown): CallHandler<unknown> {
  return { handle: vi.fn(() => of(body)) } as unknown as CallHandler<unknown>;
}

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let recordAsync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    recordAsync = vi.fn(() => Promise.resolve());

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditInterceptor,
        { provide: AuditService, useValue: { recordAsync } },
      ],
    }).compile();

    interceptor = moduleRef.get(AuditInterceptor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Прогоняет запрос через интерсептор и возвращает тело ответа.
   *
   * @param request - параметры запроса (метод, путь, user, body, params)
   * @param options - статус ответа и тело ответа обработчика
   * @returns тело ответа исходного observable
   */
  async function runAsync(
    request: TestRequest,
    options: { statusCode?: number; responseBody?: unknown } = {},
  ): Promise<unknown> {
    const response: TestResponse = { statusCode: options.statusCode ?? 200 };
    const next = createHandler(options.responseBody);

    return firstValueFrom(interceptor.intercept(createContext(request, response), next));
  }

  /**
   * Возвращает запись, которую интерсептор передал в `recordAsync`.
   *
   * @returns entry первого вызова записи
   */
  function recordedEntry(): AuditEntry {
    return recordAsync.mock.calls[0]?.[0] as AuditEntry;
  }

  describe('что не аудируется', () => {
    it('GET не пишется в журнал: возвращает ответ без обращения к сервису', async () => {
      const handle = vi.fn(() => of([{ id: RESOURCE_ID }]));
      const next = { handle } as unknown as CallHandler<unknown>;
      const result = await firstValueFrom(
        interceptor.intercept(
          createContext({ method: 'GET', path: '/workflow', user: USER }, { statusCode: 200 }),
          next,
        ),
      );

      expect(handle).toHaveBeenCalled();
      expect(recordAsync).not.toHaveBeenCalled();
      expect(result).toEqual([{ id: RESOURCE_ID }]);
    });

    it('/auth/* не пишется даже при наличии user (в теле пароль/refresh-токен)', async () => {
      await runAsync(
        {
          method: 'POST',
          path: '/auth/login',
          user: USER,
          body: { email: EMAIL, password: 'секрет' },
        },
        { statusCode: 200, responseBody: { accessToken: 'token' } },
      );

      expect(recordAsync).not.toHaveBeenCalled();
    });

    it('запрос без request.user не пишется (публичные/неаутентифицированные ручки)', async () => {
      await runAsync(
        { method: 'POST', path: '/workflow', body: { name: 'x' } },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      expect(recordAsync).not.toHaveBeenCalled();
    });

    it('не читает поток заранее: запись появляется только при подписке', async () => {
      const context = createContext(
        { method: 'POST', path: '/workflow', user: USER, body: {} },
        { statusCode: 201 },
      );
      const result$ = interceptor.intercept(context, createHandler({ id: RESOURCE_ID }));

      // Ленивость: до подписки побочных эффектов нет.
      expect(recordAsync).not.toHaveBeenCalled();

      await firstValueFrom(result$);

      expect(recordAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('код действия по методу и пути', () => {
    it.each([
      ['POST', '/workflow', 'workflow.create'],
      ['POST', '/workflow/import', 'workflow.import'],
      ['PATCH', `/workflow/${RESOURCE_ID}`, 'workflow.update'],
      ['DELETE', `/workflow/${RESOURCE_ID}`, 'workflow.delete'],
      ['POST', `/workflow/${RESOURCE_ID}/share`, 'workflow.share'],
      ['DELETE', `/workflow/${RESOURCE_ID}/share`, 'workflow.unshare'],
      ['POST', '/templates/email-summary/instantiate', 'workflow.instantiate'],
      [
        'POST',
        `/workflow/${RESOURCE_ID}/collaborators`,
        'collaborator.invite',
      ],
      [
        'PATCH',
        `/workflow/${RESOURCE_ID}/collaborators/${USER_ID}`,
        'collaborator.update',
      ],
      [
        'DELETE',
        `/workflow/${RESOURCE_ID}/collaborators/${USER_ID}`,
        'collaborator.remove',
      ],
      [
        'POST',
        `/workflow/${RESOURCE_ID}/document-templates`,
        'document_template.create',
      ],
      [
        'DELETE',
        `/workflow/${RESOURCE_ID}/document-templates/${RESOURCE_ID}`,
        'document_template.delete',
      ],
      ['POST', '/runs', 'run.start'],
      // Неизвестный маршрут не теряется: fallback http.<метод>.
      ['POST', '/engine/validate', 'http.post'],
      ['PATCH', '/unknown/thing', 'http.patch'],
    ])('%s %s → %s', async (method, path, action) => {
      await runAsync(
        { method, path, user: USER, params: { id: RESOURCE_ID } },
        { statusCode: 200, responseBody: { id: RESOURCE_ID } },
      );

      expect(recordedEntry().action).toBe(action);
    });

    it('нормализует хвостовой слэш и query-строку', async () => {
      await runAsync(
        { method: 'POST', path: '/workflow/?source=ui', user: USER, body: {} },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      expect(recordedEntry().action).toBe('workflow.create');
      // В metadata путь без query: в строке запроса могли оказаться секреты.
      expect(recordedEntry().metadata['path']).toBe('/workflow/');
    });
  });

  describe('содержимое записи', () => {
    it('пишет автора, организацию, ресурс из тела и metadata запроса', async () => {
      await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          params: {},
          body: { name: 'Мой workflow' },
        },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      expect(recordedEntry()).toEqual({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'workflow.create',
        resourceId: RESOURCE_ID,
        metadata: {
          method: 'POST',
          path: '/workflow',
          params: {},
          body: { name: 'Мой workflow' },
          statusCode: 201,
        },
      });
    });

    it('берёт resourceId из path-параметра, если тело ответа пустое (DELETE 204)', async () => {
      await runAsync(
        {
          method: 'DELETE',
          path: `/workflow/${RESOURCE_ID}`,
          user: USER,
          params: { id: RESOURCE_ID },
        },
        { statusCode: 204, responseBody: undefined },
      );

      expect(recordedEntry()).toMatchObject({
        action: 'workflow.delete',
        resourceId: RESOURCE_ID,
        metadata: expect.objectContaining({ statusCode: 204 }),
      });
    });

    it('приоритет resourceId: id из тела ответа важнее path-параметра', async () => {
      await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          params: { id: PARAM_RESOURCE_ID },
          body: {},
        },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      expect(recordedEntry().resourceId).toBe(RESOURCE_ID);
    });

    it('игнорирует невалидный id и откатывается на path-параметр', async () => {
      await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          params: { id: PARAM_RESOURCE_ID },
          body: {},
        },
        { statusCode: 201, responseBody: { id: 'не-uuid' } },
      );

      expect(recordedEntry().resourceId).toBe(PARAM_RESOURCE_ID);
    });

    it('resourceId = null, если валидного id нет ни в теле, ни в params', async () => {
      await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          params: {},
          body: {},
        },
        { statusCode: 201, responseBody: { token: 'share-token' } },
      );

      expect(recordedEntry().resourceId).toBeNull();
    });
  });

  describe('санитизация metadata', () => {
    it('вырезает пароли/токены/API-ключи на любом уровне вложенности', async () => {
      const body = {
        name: 'Мой workflow',
        password: 'hunter2',
        token: 'refresh-token',
        secret: 's3cr3t',
        apiKey: 'sk-live',
        api_key: 'sk-live-2',
        authorization: 'Bearer abc',
        cookie: 'session=1',
        nested: {
          keep: 'ok',
          password: 'nested-password',
          accessToken: 'nested-token',
        },
        // Секретные ключи внутри массива объектов тоже вырезаются.
        items: [{ token: 'in-array', id: RESOURCE_ID }],
      };

      await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          params: {},
          body,
        },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      expect(recordedEntry().metadata['body']).toEqual({
        name: 'Мой workflow',
        nested: { keep: 'ok' },
        items: [{ id: RESOURCE_ID }],
      });
      // Оригинальное тело запроса не мутируется.
      expect(body).toEqual(
        expect.objectContaining({
          password: 'hunter2',
          nested: expect.objectContaining({ password: 'nested-password' }),
        }),
      );
    });

    it('ограничивает тело 16 KiB: маркер { truncated, bytes }', async () => {
      await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          params: {},
          body: { data: 'x'.repeat(20 * 1024) },
        },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      const sanitizedBody = recordedEntry().metadata['body'] as {
        truncated: boolean;
        bytes: number;
      };

      expect(sanitizedBody).toEqual({
        truncated: true,
        bytes: expect.any(Number),
      });
      expect(sanitizedBody.bytes).toBeGreaterThan(16 * 1024);
    });

    it('ограничивает глубину тела маркером [max-depth]', async () => {
      let nested: Record<string, unknown> = { leaf: true };

      for (let index = 0; index < 20; index += 1) {
        nested = { child: nested };
      }

      await runAsync(
        { method: 'POST', path: '/workflow', user: USER, params: {}, body: nested },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      expect(JSON.stringify(recordedEntry().metadata['body'])).toContain(
        '[max-depth]',
      );
    });
  });

  describe('ошибки', () => {
    it('ошибка обработчика: запись не создаётся, ошибка пробрасывается', async () => {
      const context = createContext(
        { method: 'POST', path: '/workflow', user: USER, body: {} },
        { statusCode: 201 },
      );
      const next = {
        handle: vi.fn(() => throwError(() => new Error('boom'))),
      } as unknown as CallHandler<unknown>;

      await expect(firstValueFrom(interceptor.intercept(context, next))).rejects.toThrow(
        'boom',
      );
      expect(recordAsync).not.toHaveBeenCalled();
    });

    it('сбой аудита не ломает ответ: только Logger.warn (RULES 4.18)', async () => {
      recordAsync.mockRejectedValue(new Error('БД недоступна'));
      const warnSpy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const result = await runAsync(
        {
          method: 'POST',
          path: '/workflow',
          user: USER,
          body: { name: 'x' },
        },
        { statusCode: 201, responseBody: { id: RESOURCE_ID } },
      );

      // Исходный ответ не изменён и не прерван.
      expect(result).toEqual({ id: RESOURCE_ID });
      expect(recordAsync).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledTimes(1);
      });
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('журнал аудита');
    });
  });
});
