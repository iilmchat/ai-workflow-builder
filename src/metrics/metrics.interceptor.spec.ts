import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor.js';
import { MetricsService } from './metrics.service.js';

/** Валидные uuid для проверки нормализации фактического пути. */
const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';

/** Тип контекста Nest, который эмулирует заглушка (`http` по умолчанию). */
type ContextType = 'http' | 'rpc' | 'ws';

/** Минимальный запрос, который читает интерсептор. */
interface TestRequest {
  method: string;
  path?: string;
  originalUrl?: string;
  route?: { path?: unknown };
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
 * @param type - тип контекста (`http` по умолчанию)
 * @returns контекст, который отдаёт request/response и тип
 */
function createContext(
  request: TestRequest,
  response: TestResponse,
  type: ContextType = 'http',
): ExecutionContext {
  return {
    getType: () => type,
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

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;
  let observeHttpRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    observeHttpRequest = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        MetricsInterceptor,
        { provide: MetricsService, useValue: { observeHttpRequest } },
      ],
    }).compile();

    interceptor = moduleRef.get(MetricsInterceptor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Прогоняет запрос через интерсептор и возвращает тело ответа.
   *
   * @param request - параметры запроса
   * @param options - статус и тело ответа обработчика
   * @returns тело ответа исходного observable
   */
  async function runAsync(
    request: TestRequest,
    options: { statusCode?: number; responseBody?: unknown } = {},
  ): Promise<unknown> {
    const context = createContext(request, {
      statusCode: options.statusCode ?? 200,
    });

    return firstValueFrom(
      interceptor.intercept(context, createHandler(options.responseBody)),
    );
  }

  /**
   * Возвращает аргументы единственного вызова записи HTTP-метрики.
   *
   * @returns кортеж `[method, route, statusCode, durationSeconds]`
   */
  function recordedCall(): [string, string, number, number] {
    return observeHttpRequest.mock.calls[0] as [
      string,
      string,
      number,
      number,
    ];
  }

  describe('успешные запросы', () => {
    it('GET записывается с method/route/status и длительностью', async () => {
      const result = await runAsync(
        { method: 'GET', path: '/workflow', route: { path: '/workflow' } },
        { statusCode: 200, responseBody: [{ id: UUID_1 }] },
      );

      expect(result).toEqual([{ id: UUID_1 }]);
      expect(observeHttpRequest).toHaveBeenCalledTimes(1);
      const [method, route, statusCode, durationSeconds] = recordedCall();

      expect(method).toBe('GET');
      expect(route).toBe('/workflow');
      expect(statusCode).toBe(200);
      expect(typeof durationSeconds).toBe('number');
      expect(durationSeconds).toBeGreaterThanOrEqual(0);
    });

    it('POST записывается со статусом 201 и шаблоном маршрута', async () => {
      await runAsync(
        {
          method: 'POST',
          path: `/workflow/${UUID_1}/share`,
          route: { path: '/workflow/:id/share' },
        },
        { statusCode: 201, responseBody: { token: 'share-token' } },
      );

      const [method, route, statusCode] = recordedCall();

      expect(method).toBe('POST');
      expect(route).toBe('/workflow/:id/share');
      expect(statusCode).toBe(201);
    });

    it('не меняет поток ответа: возвращает исходное тело', async () => {
      const body = { id: UUID_1, name: 'workflow' };
      const result = await runAsync(
        { method: 'GET', path: '/workflow/:id' },
        { statusCode: 200, responseBody: body },
      );

      expect(result).toBe(body);
    });
  });

  describe('что не измеряется', () => {
    it('/metrics не наблюдает себя', async () => {
      const handle = vi.fn(() => of('# HELP'));
      const context = createContext(
        { method: 'GET', path: '/metrics', route: { path: '/metrics' } },
        { statusCode: 200 },
      );

      const result = await firstValueFrom(
        interceptor.intercept(context, { handle } as unknown as CallHandler<unknown>),
      );

      expect(result).toBe('# HELP');
      expect(handle).toHaveBeenCalled();
      expect(observeHttpRequest).not.toHaveBeenCalled();
    });

    it('/metrics/ (хвостовой слэш) тоже не наблюдается', async () => {
      await runAsync({ method: 'GET', path: '/metrics/' });

      expect(observeHttpRequest).not.toHaveBeenCalled();
    });

    it('не-HTTP контекст пропускается без записи', async () => {
      const context = createContext(
        { method: 'GET', path: '/workflow' },
        { statusCode: 200 },
        'rpc',
      );

      const result = await firstValueFrom(
        interceptor.intercept(context, createHandler({ ok: true })),
      );

      expect(result).toEqual({ ok: true });
      expect(observeHttpRequest).not.toHaveBeenCalled();
    });
  });

  describe('ошибки обработчика', () => {
    it('упавший запрос всё равно записывается со статусом из response', async () => {
      const context = createContext(
        { method: 'POST', path: '/runs', route: { path: '/runs' } },
        { statusCode: 500 },
      );
      const next = {
        handle: vi.fn(() => throwError(() => new Error('boom'))),
      } as unknown as CallHandler<unknown>;

      await expect(
        firstValueFrom(interceptor.intercept(context, next)),
      ).rejects.toThrow('boom');

      // `finalize` срабатывает и на ошибке: алерты видят долю 5xx.
      expect(observeHttpRequest).toHaveBeenCalledTimes(1);
      const [method, route, statusCode] = recordedCall();

      expect(method).toBe('POST');
      expect(route).toBe('/runs');
      expect(statusCode).toBe(500);
    });
  });

  describe('подпись route с ограниченной кардинальностью', () => {
    it('берёт шаблон Express (request.route.path), а не фактический URL', async () => {
      await runAsync(
        {
          method: 'GET',
          path: `/workflow/${UUID_1}/collaborators/${UUID_2}`,
          route: { path: '/workflow/:id/collaborators/:userId' },
        },
        { statusCode: 200, responseBody: [] },
      );

      expect(recordedCall()[1]).toBe('/workflow/:id/collaborators/:userId');
    });

    it('fallback: заменяет uuid-сегменты на :id', async () => {
      await runAsync(
        {
          method: 'GET',
          path: `/workflow/${UUID_1}/collaborators/${UUID_2}`,
        },
        { statusCode: 200, responseBody: [] },
      );

      // Без нормализации каждая пара uuid создавала бы новую серию.
      expect(recordedCall()[1]).toBe('/workflow/:id/collaborators/:id');
    });

    it('fallback: статические сегменты не трогает', async () => {
      await runAsync(
        { method: 'GET', path: '/workflow/share/not-a-uuid' },
        { statusCode: 200, responseBody: {} },
      );

      expect(recordedCall()[1]).toBe('/workflow/share/not-a-uuid');
    });

    it('fallback: берёт originalUrl, если request.path недоступен', async () => {
      await runAsync(
        { method: 'GET', originalUrl: `/workflow/${UUID_1}?tab=nodes` },
        { statusCode: 200, responseBody: {} },
      );

      expect(recordedCall()[1]).toBe('/workflow/:id');
    });
  });
});
