/**
 * Тесты исполнителей узлов R6.5.1 (KI-105): `http`, `condition`, `output`,
 * `compare`.
 *
 * `http` с v0.11 S14 ходит через `SafeHttpClient`: реальная сеть в юнит-тестах
 * запрещена, поэтому клиент собирается с фейковым транспортом и моком DNS.
 * Таймаут проверяется на настоящем `AbortSignal.timeout` внутри клиента —
 * фейковый транспорт обязан слушать `signal`, иначе тест повесится.
 */
import {
  NodeDataValidationException,
  SUB_WORKFLOW_MAX_DEPTH,
  SubWorkflowDepthException,
  SubWorkflowRecursionException,
  executeCompareNode,
  executeConditionNode,
  executeHttpNode,
  executeOutputNode,
  executeSubWorkflowNode,
  executeTextNode,
  prefixSubWorkflowGraph,
  type SubWorkflowContext,
  type SubWorkflowRecord,
} from './node-executors.js';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { GraphDto } from './dto/index.js';
import type { Agent } from 'undici';
import {
  SafeHttpClient,
  SafeHttpResponseTooLargeException,
  type SafeHttpTransportAsync,
  type SafeHttpTransportInit,
  type SafeHttpTransportResponse,
} from '../common/http/safe-http.client.js';
import { SsrfBlockedException } from '../common/utils/network-safety.js';
import { QuickJsRunnerService } from '../sandbox/quickjs-runner.service.js';

/** Предельный размер тела ответа, байт (совпадает с константой исполнителя). */
const MAX_BODY_BYTES = 1_000_000;

/** Ответ фейкового транспорта из строки. */
function transportResponse(
  status: number,
  body = '',
  headers: Record<string, string> = {},
): SafeHttpTransportResponse {
  const bytes = Buffer.from(body, 'utf8');

  return {
    status,
    headers: new Headers(headers),
    body: (async function* stream(): AsyncGenerator<Uint8Array> {
      if (bytes.length > 0) {
        yield bytes;
      }
    })(),
    discardAsync: (): Promise<void> => Promise.resolve(),
  };
}

/** Вызов фейкового транспорта. */
interface HttpTransportCall {
  readonly url: URL;
  readonly init: SafeHttpTransportInit;
  readonly dispatcher: Agent;
}

/**
 * Собирает `SafeHttpClient` с фейковым транспортом (без сети).
 *
 * @param handler - что вернуть на запрос
 * @param lookup - резолвер DNS
 * @returns клиент и вызовы транспорта
 */
function createHttpClient(
  handler: (call: HttpTransportCall) => SafeHttpTransportResponse = () =>
    transportResponse(200, 'ok'),
  lookup: (hostname: string) => Promise<readonly string[]> = () =>
    Promise.resolve(['93.184.216.34']),
): { client: SafeHttpClient; calls: HttpTransportCall[] } {
  const calls: HttpTransportCall[] = [];
  const transportAsync = vi.fn(
    async (
      url: URL,
      init: SafeHttpTransportInit,
      dispatcher: Agent,
    ): Promise<SafeHttpTransportResponse> => {
      const call: HttpTransportCall = { url, init, dispatcher };

      calls.push(call);

      return handler(call);
    },
  );

  return {
    client: new SafeHttpClient({
      lookupAsync: lookup,
      transportAsync: transportAsync as unknown as SafeHttpTransportAsync,
    }),
    calls,
  };
}

describe('node-executors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeTextNode', () => {
    it('отдаёт значение из data.value как есть', () => {
      expect(executeTextNode({ id: 'A', type: 'text', data: { value: 'привет' } })).toEqual({
        text: 'привет',
      });
    });

    it('отдаёт пустую строку, если значение не строка', () => {
      expect(executeTextNode({ id: 'A', type: 'text', data: { value: 42 } })).toEqual({
        text: '',
      });
    });
  });

  describe('executeHttpNode', () => {
    it('GET: успешный запрос отдаёт status и body', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(200, '{"ok":true}'),
      );

      const result = await executeHttpNode(
        { method: 'GET', url: 'https://example.com/api', timeoutMs: 5000 },
        {},
        client,
      );

      expect(result).toEqual({ status: 200, body: '{"ok":true}' });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url.href).toBe('https://example.com/api');
      expect(calls[0]?.init.method).toBe('GET');
      // Тело не подставляется для GET: undici бросает на это TypeError.
      expect(calls[0]?.init.body).toBeUndefined();
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    });

    it('POST: передаёт заголовки и тело запроса', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(201, 'created'),
      );

      const result = await executeHttpNode(
        {
          method: 'POST',
          url: 'https://example.com/items',
          headers: { 'content-type': 'application/json', 'x-token': 'секрет' },
          body: '{"name":"item"}',
        },
        {},
        client,
      );

      expect(result).toEqual({ status: 201, body: 'created' });
      expect(calls[0]?.init.method).toBe('POST');
      expect(calls[0]?.init.headers).toEqual({
        'content-type': 'application/json',
        'x-token': 'секрет',
      });
      expect(calls[0]?.init.body).toBe('{"name":"item"}');
    });

    it('таймаут: бросает ошибку с текстом про таймаут (RULES 4.19)', async () => {
      const neverResponds = vi.fn(
        (
          _url: URL,
          init: SafeHttpTransportInit,
        ): Promise<SafeHttpTransportResponse> =>
          new Promise((_resolve, reject) => {
            // Транспорт обязан уважать signal: иначе await не завершится.
            init.signal.addEventListener('abort', () => {
              reject(
                new DOMException(
                  'The operation was aborted due to timeout',
                  'TimeoutError',
                ),
              );
            });
          }),
      );
      const client = new SafeHttpClient({
        lookupAsync: () => Promise.resolve(['93.184.216.34']),
        transportAsync: neverResponds as unknown as SafeHttpTransportAsync,
      });

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'https://example.com/slow', timeoutMs: 20 },
          {},
          client,
        ),
      ).rejects.toThrow('запрос прерван по таймауту 20 мс');
    });

    it('4xx не считается ошибкой узла: возвращает status без throw', async () => {
      const { client } = createHttpClient(() =>
        transportResponse(404, 'not found'),
      );

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'https://example.com/missing' },
          {},
          client,
        ),
      ).resolves.toEqual({ status: 404, body: 'not found' });
    });

    it('KI-289: failOnHttpError=true превращает 404 в ошибку узла', async () => {
      const { client } = createHttpClient(() =>
        transportResponse(404, 'not found'),
      );

      await expect(
        executeHttpNode(
          {
            method: 'GET',
            url: 'https://example.com/missing',
            failOnHttpError: true,
          },
          {},
          client,
        ),
      ).rejects.toThrow('HTTP 404');
    });

    it('KI-289: failOnHttpError=true превращает 5xx в ошибку узла', async () => {
      const { client } = createHttpClient(() =>
        transportResponse(503, 'boom'),
      );

      await expect(
        executeHttpNode(
          {
            method: 'GET',
            url: 'https://example.com/flaky',
            failOnHttpError: true,
          },
          {},
          client,
        ),
      ).rejects.toThrow('HTTP 503');
    });

    it('KI-289: текст ошибки без тела и заголовков ответа (RULES 5.9)', async () => {
      // В теле чужого ответа могут быть секреты/PII: в `node_runs.error`
      // уходит только код, тело в текст ошибки не подставляется.
      const { client } = createHttpClient(() =>
        transportResponse(500, 'secret-token-42'),
      );

      const error: unknown = await executeHttpNode(
        {
          method: 'GET',
          url: 'https://example.com/leak',
          failOnHttpError: true,
        },
        {},
        client,
      ).then(
        () => null,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('HTTP 500');
      expect(String(error)).not.toContain('secret-token-42');
    });

    it('KI-289: failOnHttpError=false и отсутствие поля сохраняют прежнее поведение', async () => {
      const denied = createHttpClient(() => transportResponse(403, 'denied'));

      await expect(
        executeHttpNode(
          {
            method: 'GET',
            url: 'https://example.com/forbidden',
            failOnHttpError: false,
          },
          {},
          denied.client,
        ),
      ).resolves.toEqual({ status: 403, body: 'denied' });

      // Успешный ответ не падает и при failOnHttpError=true.
      const ok = createHttpClient(() => transportResponse(200, 'ok'));

      await expect(
        executeHttpNode(
          {
            method: 'GET',
            url: 'https://example.com/ok',
            failOnHttpError: true,
          },
          {},
          ok.client,
        ),
      ).resolves.toEqual({ status: 200, body: 'ok' });
    });

    it('KI-289: failOnHttpError не boolean — ошибка валидации данных узла', async () => {
      await expect(
        executeHttpNode({
          method: 'GET',
          url: 'https://example.com',
          failOnHttpError: 'yes',
        }),
      ).rejects.toThrow(NodeDataValidationException);
    });

    it('тело больше 1 МБ — ошибка ResponseTooLarge, а не «обрезанный» ответ', async () => {
      // v0.11 S14: лимит тела теперь enforced клиентом (KI-025): мегабайтный
      // ответ не попадает в jsonb, узел честно падает.
      const { client } = createHttpClient(() =>
        transportResponse(200, 'a'.repeat(MAX_BODY_BYTES + 500)),
      );

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'https://example.com/big' },
          {},
          client,
        ),
      ).rejects.toBeInstanceOf(SafeHttpResponseTooLargeException);
    });

    it('тело ровно по лимиту проходит и не режется', async () => {
      const exactlyLimit = 'ё'.repeat(MAX_BODY_BYTES / 2);
      const { client } = createHttpClient(() =>
        transportResponse(200, exactlyLimit),
      );

      const result = await executeHttpNode(
        { method: 'GET', url: 'https://example.com/exact' },
        {},
        client,
      );

      expect(Buffer.byteLength(result.body, 'utf8')).toBe(MAX_BODY_BYTES);
      expect(result.body.endsWith('ё')).toBe(true);
    });

    it('берёт URL из входа prompt, если data.url пуст', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(200, 'ok'),
      );

      const result = await executeHttpNode(
        { method: 'GET' },
        { prompt: 'https://example.com/from-input' },
        client,
      );

      expect(result).toEqual({ status: 200, body: 'ok' });
      expect(calls[0]?.url.href).toBe('https://example.com/from-input');
    });

    it('падает с понятным текстом, если url не задан нигде', async () => {
      await expect(executeHttpNode({ method: 'GET' })).rejects.toThrow(
        'Узел http: не задан url',
      );
    });

    it('падает на неизвестном методе (валидация Zod)', async () => {
      await expect(
        executeHttpNode({ method: 'PATCH', url: 'https://example.com' }),
      ).rejects.toThrow(NodeDataValidationException);
    });

    it('падает, если таймаут превышает верхнюю границу', async () => {
      await expect(
        executeHttpNode({
          method: 'GET',
          url: 'https://example.com',
          timeoutMs: 120_001,
        }),
      ).rejects.toThrow('Некорректные данные узла http');
    });

    it('KI-478: блокирует loopback-адрес и не делает сетевой вызов', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(200, 'should not happen'),
      );

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'http://127.0.0.1:3000/admin' },
          {},
          client,
        ),
      ).rejects.toBeInstanceOf(SsrfBlockedException);

      expect(calls).toHaveLength(0);
    });

    it('KI-478: блокирует metadata-адрес 169.254.169.254', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(200, 'should not happen'),
      );

      await expect(
        executeHttpNode(
          {
            method: 'GET',
            url: 'http://169.254.169.254/latest/meta-data/',
          },
          {},
          client,
        ),
      ).rejects.toMatchObject({
        name: 'SsrfBlockedException',
        hostname: '169.254.169.254',
      });

      expect(calls).toHaveLength(0);
    });

    it('KI-434: блокирует редирект на приватный адрес', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(302, '', { location: 'http://10.0.0.5/internal' }),
      );

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'https://example.com/go' },
          {},
          client,
        ),
      ).rejects.toBeInstanceOf(SsrfBlockedException);

      // Приватный Location не запрашивался.
      expect(calls).toHaveLength(1);
    });

    it('KI-434: идёт по безопасному редиректу и возвращает финальный ответ', async () => {
      const { client, calls } = createHttpClient((call) =>
        call.url.pathname === '/start'
          ? transportResponse(301, '', {
              location: 'https://example.com/final',
            })
          : transportResponse(200, '{"ok":true}'),
      );

      const result = await executeHttpNode(
        { method: 'GET', url: 'https://example.com/start' },
        {},
        client,
      );

      expect(result).toEqual({ status: 200, body: '{"ok":true}' });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.url.href).toBe('https://example.com/final');
    });

    it('HTTP_NODE_ALLOW_PRIVATE_NETWORKS: флаг пропускает приватный адрес', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(200, 'ok'),
      );

      const result = await executeHttpNode(
        { method: 'GET', url: 'http://127.0.0.1:1234/v1/models' },
        {},
        client,
        { allowPrivateNetworks: true },
      );

      expect(result).toEqual({ status: 200, body: 'ok' });
      expect(calls).toHaveLength(1);
    });

    it('даже при allowPrivateNetworks metadata-адрес остаётся заблокированным', async () => {
      const { client, calls } = createHttpClient(() =>
        transportResponse(200, 'should not happen'),
      );

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'http://169.254.169.254/latest/meta-data/' },
          {},
          client,
          { allowPrivateNetworks: true },
        ),
      ).rejects.toBeInstanceOf(SsrfBlockedException);

      expect(calls).toHaveLength(0);
    });

    it('добавляет к ошибке источник редиректа (диагностика node_runs)', async () => {
      const { client } = createHttpClient(() =>
        transportResponse(307, '', { location: 'http://192.168.1.10/secret' }),
      );

      await expect(
        executeHttpNode(
          { method: 'GET', url: 'https://example.com/go' },
          {},
          client,
        ),
      ).rejects.toMatchObject({
        name: 'SsrfBlockedException',
        hostname: '192.168.1.10',
        redirectFrom: 'https://example.com/go',
      });
    });
  });
  describe('executeConditionNode', () => {
    /** Песочница с включённым режимом (R7.5): реальный QuickJS-WASM. */
    let sandboxRunner: QuickJsRunnerService;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          QuickJsRunnerService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string): unknown => {
                const config: Record<string, unknown> = {
                  SANDBOX_ENABLED: true,
                  SANDBOX_TIMEOUT_MS: 100,
                  SANDBOX_MEMORY_MB: 16,
                };

                return config[key];
              },
            },
          },
        ],
      }).compile();

      sandboxRunner = moduleRef.get(QuickJsRunnerService);
    });

    it('> сравнивает числа', async () => {
      const result = await executeConditionNode(
        { left: 'input.value', operator: '>', right: '3' },
        { value: 5 },
      );

      expect(result).toEqual({ result: true, evaluated: { left: 5, right: 3 } });
    });

    it('> возвращает false, когда условие не выполнено', async () => {
      expect(
        (
          await executeConditionNode(
            { left: 'input.value', operator: '>', right: '10' },
            { value: 5 },
          )
        ).result,
      ).toBe(false);
    });

    it('=== сравнивает строки', async () => {
      expect(
        await executeConditionNode(
          { left: 'input.text', operator: '===', right: "'готово'" },
          { text: 'готово' },
        ),
      ).toEqual({ result: true, evaluated: { left: 'готово', right: 'готово' } });
    });

    it('includes работает для массива', async () => {
      expect(
        (
          await executeConditionNode(
            { left: 'input.value', operator: 'includes', right: "'b'" },
            { value: ['a', 'b', 'c'] },
          )
        ).result,
      ).toBe(true);
    });

    it('includes работает для строки', async () => {
      expect(
        (
          await executeConditionNode(
            { left: 'input.text', operator: 'includes', right: 'тек' },
            { text: 'текст ответа' },
          )
        ).result,
      ).toBe(true);
    });

    it('берёт первый непустой вход, если input.X не найден', async () => {
      expect(
        await executeConditionNode(
          { left: 'input.value', operator: '===', right: "'привет'" },
          { text: 'привет' },
        ),
      ).toEqual({ result: true, evaluated: { left: 'привет', right: 'привет' } });
    });

    it('падает на невалидном операторе (валидация Zod)', async () => {
      await expect(
        executeConditionNode(
          { left: 'input.value', operator: '!=', right: '1' },
          { value: 1 },
        ),
      ).rejects.toThrow(NodeDataValidationException);
    });

    it('падает на includes для числа', async () => {
      await expect(
        executeConditionNode(
          { left: 'input.value', operator: 'includes', right: '1' },
          { value: 42 },
        ),
      ).rejects.toThrow("includes не поддерживает тип 'number'");
    });

    it('падает на === для объекта', async () => {
      await expect(
        executeConditionNode(
          { left: 'input.value', operator: '===', right: '1' },
          { value: { a: 1 } },
        ),
      ).rejects.toThrow('только для примитивов');
    });

    it('падает, если операнд не число для >', async () => {
      await expect(
        executeConditionNode(
          { left: 'input.text', operator: '>', right: '3' },
          { text: 'не число' },
        ),
      ).rejects.toThrow('не является числом');
    });

    it('падает, если операнд не найден во входах', async () => {
      await expect(
        executeConditionNode({ left: 'input.value', operator: '>', right: '3' }, {}),
      ).rejects.toThrow(
        "вход 'value' не найден, а запасных входов (input/prompt/text/value) нет",
      );
    });

    it('читает вход из порта узла (input), а не только из prompt/text', async () => {
      // Движок кладёт выход text-предшественника под ключом входного порта
      // `condition` — это `input` (KI-034). Без него узел не увидел бы данные.
      expect(
        await executeConditionNode(
          { left: 'input.value', operator: '===', right: "'готово'" },
          { input: 'готово' },
        ),
      ).toEqual({ result: true, evaluated: { left: 'готово', right: 'готово' } });
    });

    it('R7.5: mode=dsl — явный режим работает как прежний DSL', async () => {
      expect(
        await executeConditionNode(
          { mode: 'dsl', left: 'input.value', operator: '>', right: '3' },
          { value: 5 },
        ),
      ).toEqual({ result: true, evaluated: { left: 5, right: 3 } });
    });

    it('R7.5: mode=sandbox — вычисляет JS-выражение в QuickJS', async () => {
      // Вход узла приходит из text-предшественника строкой под портом `input`
      // (KI-034), поэтому в песочнице это ровно переменная `input`.
      expect(
        await executeConditionNode(
          { mode: 'sandbox', expression: "input.length > 3 && input.includes('foo')" },
          { input: 'foobar' },
          sandboxRunner,
        ),
      ).toEqual({ result: true });
    });

    it('R7.5: mode=sandbox — объект входа доступен по полям', async () => {
      expect(
        await executeConditionNode(
          { mode: 'sandbox', expression: 'input.value > 100' },
          { input: { value: 150 } },
          sandboxRunner,
        ),
      ).toEqual({ result: true });
    });

    it('R7.5: mode=sandbox + timeout → узел падает с текстом ошибки', async () => {
      await expect(
        executeConditionNode(
          { mode: 'sandbox', expression: 'while (true) {}' },
          { input: 'x' },
          sandboxRunner,
        ),
      ).rejects.toThrow('Timeout exceeded');
    });

    it('R7.5: mode=sandbox при SANDBOX_ENABLED=false → понятная ошибка', async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          QuickJsRunnerService,
          {
            provide: ConfigService,
            useValue: { get: (): unknown => false },
          },
        ],
      }).compile();
      const disabledRunner = moduleRef.get(QuickJsRunnerService);

      await expect(
        executeConditionNode(
          { mode: 'sandbox', expression: 'true' },
          {},
          disabledRunner,
        ),
      ).rejects.toThrow('Sandbox disabled in env');
    });

    it('R7.5: mode=sandbox без expression → ошибка валидации', async () => {
      await expect(
        executeConditionNode({ mode: 'sandbox' }, {}, sandboxRunner),
      ).rejects.toThrow('expression обязателен');
    });

    it('R7.5: неизвестный mode → ошибка, а не молчаливый DSL', async () => {
      await expect(
        executeConditionNode(
          { mode: 'wasm', left: 'input.value', operator: '>', right: '3' },
          { value: 5 },
        ),
      ).rejects.toThrow("mode: неизвестный режим 'wasm'");
    });
  });

  describe('executeOutputNode', () => {
    it('пропускает первое непустое значение под именем из data.name', () => {
      expect(
        executeOutputNode({ name: 'my_output' }, { text: 'текст из text-узла' }),
      ).toEqual({ my_output: 'текст из text-узла' });
    });

    it('предпочитает prompt, если подан и prompt, и text', () => {
      expect(
        executeOutputNode({ name: 'out' }, { text: 'из text', prompt: 'из prompt' }),
      ).toEqual({ out: 'из prompt' });
    });

    it('отдаёт null, если все входы пустые', () => {
      expect(executeOutputNode({ name: 'out' }, { text: '', prompt: null })).toEqual({
        out: null,
      });
    });

    it('отдаёт null при полном отсутствии входов', () => {
      expect(executeOutputNode({ name: 'out' })).toEqual({ out: null });
    });

    it('падает, если name пуст (валидация Zod)', () => {
      expect(() => executeOutputNode({ name: '   ' }, { text: 'a' })).toThrow(
        NodeDataValidationException,
      );
    });
  });

  describe('executeCompareNode', () => {
    it('равные строки: equal=true и пустой diff', () => {
      expect(
        executeCompareNode({ mode: 'diff' }, { a: 'одинаково', b: 'одинаково' }),
      ).toEqual({ diff: '', equal: true });
    });

    it('разные строки: equal=false и непустой diff', () => {
      const result = executeCompareNode(
        { mode: 'diff' },
        { a: 'первый вариант', b: 'второй вариант' },
      );

      expect(result.equal).toBe(false);
      expect(result.diff.length).toBeGreaterThan(0);
      expect(result.diff).toContain('первое различие на позиции 0');
    });

    it('построчный diff указывает номер различающейся строки', () => {
      const result = executeCompareNode(
        { mode: 'diff' },
        { a: 'строка 1\nстрока 2', b: 'строка 1\nстрока 3' },
      );

      expect(result.equal).toBe(false);
      expect(result.diff).toContain('различие в строке 2');
    });

    it('mode=llm-judge не поддержан', () => {
      expect(() => executeCompareNode({ mode: 'llm-judge' }, { a: 'x', b: 'y' })).toThrow(
        NodeDataValidationException,
      );
    });

    it('падает, если не подан вход b', () => {
      expect(() => executeCompareNode({ mode: 'diff' }, { a: 'x' })).toThrow(
        'Узел compare: не подан вход b',
      );
    });

    it('падает при полном отсутствии входов', () => {
      expect(() => executeCompareNode({ mode: 'diff' })).toThrow(
        'не подан вход a',
      );
    });

    it('понимает запасные ключи left/right и true/false', () => {
      expect(executeCompareNode({ mode: 'diff' }, { true: 'x', false: 'x' })).toEqual({
        diff: '',
        equal: true,
      });
      expect(executeCompareNode({ mode: 'diff' }, { left: 'x', right: 'y' }).equal).toBe(
        false,
      );
    });
  });

  /* ─────────────────────────── sub_workflow (R6.7) ─────────────────────────── */

  describe('executeSubWorkflowNode', () => {
    /** uuid подграфа в тестах R6.7. */
    const SUB_WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
    /** uuid владельца корневого запуска. */
    const ROOT_USER_ID = '33333333-3333-4333-8333-333333333333';

    /** Запись подграфа: два узла, связанные связью. */
    const SUB_WORKFLOW: SubWorkflowRecord = {
      id: SUB_WORKFLOW_ID,
      name: 'Подграф A',
      version: 3,
      nodes: [
        { id: 'text-1', type: 'text', data: { value: 'вход' } },
        { id: 'llm-1', type: 'llm', data: {} },
      ],
      edges: [{ id: 'e1', source: 'text-1', target: 'llm-1' }],
    };

    /**
     * Собирает контекст под-воркфлоу с замоканным источником workflow.
     *
     * @param found - что вернёт `findOneAsync` (`null` — чужой/несуществующий)
     * @param overrides - поля контекста, которые нужно переопределить
     * @returns контекст и мок `findOneAsync` для проверки аргументов
     */
    function createSubContext(
      found: SubWorkflowRecord | null = SUB_WORKFLOW,
      overrides: Partial<SubWorkflowContext> = {},
    ): { context: SubWorkflowContext; findOne: ReturnType<typeof vi.fn> } {
      const findOne = vi.fn((_id: string, _userId?: string) => Promise.resolve(found));

      return {
        findOne,
        context: {
          lookup: { findOneAsync: findOne },
          rootUserId: ROOT_USER_ID,
          visitedWorkflows: new Set<string>(),
          depth: 0,
          ...overrides,
        },
      };
    }

    it('загружает подграф владельца и возвращает его узлы и связи', async () => {
      const { context, findOne } = createSubContext();

      const target = await executeSubWorkflowNode(
        { kind: 'sub_workflow', workflowId: SUB_WORKFLOW_ID },
        context,
      );

      expect(target.workflowId).toBe(SUB_WORKFLOW_ID);
      expect(target.name).toBe('Подграф A');
      expect(target.version).toBe(3);
      expect(target.subGraph.nodes.map((node) => node.id)).toEqual(['text-1', 'llm-1']);
      expect(target.subGraph.edges.map((edge) => edge.id)).toEqual(['e1']);
      // Владелец корневого запуска уходит в фильтр выборки: без него вернулся
      // бы и чужой workflow.
      expect(findOne).toHaveBeenCalledWith(SUB_WORKFLOW_ID, ROOT_USER_ID);
    });

    it('чужой workflow неотличим от несуществующего: 404', async () => {
      const { context } = createSubContext(null);

      const error: unknown = await executeSubWorkflowNode(
        { kind: 'sub_workflow', workflowId: SUB_WORKFLOW_ID },
        context,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getStatus()).toBe(404);
    });

    it('пустой workflowId не проходит Zod-схему', async () => {
      const { context, findOne } = createSubContext();

      await expect(
        executeSubWorkflowNode({ kind: 'sub_workflow', workflowId: '' }, context),
      ).rejects.toThrow(NodeDataValidationException);
      // До БД дело не дошло: схема отсекла мусор раньше (RULES 1.17).
      expect(findOne).not.toHaveBeenCalled();
    });

    it('без известного владельца подграф не загружается', async () => {
      const { context, findOne } = createSubContext(SUB_WORKFLOW, { rootUserId: null });

      const error: unknown = await executeSubWorkflowNode(
        { kind: 'sub_workflow', workflowId: SUB_WORKFLOW_ID },
        context,
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('повторная ссылка на workflow в ветке — циклическая (KI-200)', async () => {
      const { context } = createSubContext(SUB_WORKFLOW, {
        visitedWorkflows: new Set([SUB_WORKFLOW_ID]),
      });

      await expect(
        executeSubWorkflowNode({ kind: 'sub_workflow', workflowId: SUB_WORKFLOW_ID }, context),
      ).rejects.toThrow(SubWorkflowRecursionException);
    });

    it(`глубина ${SUB_WORKFLOW_MAX_DEPTH} — предельная`, async () => {
      const { context } = createSubContext(SUB_WORKFLOW, {
        depth: SUB_WORKFLOW_MAX_DEPTH,
      });

      await expect(
        executeSubWorkflowNode({ kind: 'sub_workflow', workflowId: SUB_WORKFLOW_ID }, context),
      ).rejects.toThrow(SubWorkflowDepthException);
    });

    it('глубина на единицу меньше предельной — загрузка разрешена', async () => {
      const { context } = createSubContext(SUB_WORKFLOW, {
        depth: SUB_WORKFLOW_MAX_DEPTH - 1,
      });

      await expect(
        executeSubWorkflowNode({ kind: 'sub_workflow', workflowId: SUB_WORKFLOW_ID }, context),
      ).resolves.toMatchObject({ workflowId: SUB_WORKFLOW_ID });
    });
  });

  describe('prefixSubWorkflowGraph', () => {
    it('префиксует id узлов и связей (изоляция node_runs)', () => {
      const graph: GraphDto = {
        nodes: [
          { id: 'text-1', type: 'text', data: {} },
          { id: 'llm-1', type: 'llm', data: {} },
        ],
        edges: [{ id: 'e1', source: 'text-1', target: 'llm-1' }],
      };

      const prefixed = prefixSubWorkflowGraph(graph, 'sub-7');

      expect(prefixed.nodes.map((node) => node.id)).toEqual([
        'sub_sub-7__text-1',
        'sub_sub-7__llm-1',
      ]);
      expect(prefixed.edges[0]).toMatchObject({
        id: 'sub_sub-7__e1',
        source: 'sub_sub-7__text-1',
        target: 'sub_sub-7__llm-1',
      });
      // Исходный граф не мутируется: он же лежит в snapshot запуска.
      expect(graph.nodes.map((node) => node.id)).toEqual(['text-1', 'llm-1']);
    });
  });
});
