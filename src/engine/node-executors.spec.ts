/**
 * Тесты исполнителей узлов R6.5.1 (KI-105): `http`, `condition`, `output`,
 * `compare`.
 *
 * `http` проверяется на моке `fetch` (`vi.fn()`): реальная сеть в юнит-тестах
 * запрещена — тест не должен зависеть от доступности внешнего хоста. Таймаут
 * проверяется через `AbortSignal.timeout`, поэтому мок обязан сам слушать
 * `signal` и отклоняться по `abort` — иначе `await fetch` не завершится и тест
 * повесится.
 */
import {
  NodeDataValidationException,
  executeCompareNode,
  executeConditionNode,
  executeHttpNode,
  executeOutputNode,
  executeTextNode,
} from './node-executors.js';

/** Предельный размер тела ответа, байт (совпадает с константой исполнителя). */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Подменяет глобальный `fetch` моком.
 *
 * @param implementation - реализация запроса
 * @returns мок `fetch` (для проверки аргументов вызова)
 */
function mockFetch(
  implementation: (url: string, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      implementation(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        init,
      ),
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

/**
 * Создаёт успешный `Response` с заданным телом.
 *
 * @param body - текст тела ответа
 * @param status - HTTP-код ответа
 * @param headers - дополнительные заголовки
 * @returns объект ответа в форме, достаточной для исполнителя
 */
function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return {
    status,
    headers: new Headers(headers),
    text: (): Promise<string> => Promise.resolve(body),
  } as unknown as Response;
}

describe('node-executors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
      const fetchMock = mockFetch(() =>
        Promise.resolve(response('{"ok":true}', 200)),
      );

      const result = await executeHttpNode({
        method: 'GET',
        url: 'https://example.com/api',
        timeoutMs: 5000,
      });

      expect(result).toEqual({ status: 200, body: '{"ok":true}' });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://example.com/api');
      expect(init.method).toBe('GET');
      // Тело не подставляется для GET: undici бросает на это TypeError.
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('POST: передаёт заголовки и тело запроса', async () => {
      const fetchMock = mockFetch(() => Promise.resolve(response('created', 201)));

      const result = await executeHttpNode({
        method: 'POST',
        url: 'https://example.com/items',
        headers: { 'content-type': 'application/json', 'x-token': 'секрет' },
        body: '{"name":"item"}',
      });

      expect(result).toEqual({ status: 201, body: 'created' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'content-type': 'application/json',
        'x-token': 'секрет',
      });
      expect(init.body).toBe('{"name":"item"}');
    });

    it('таймаут: бросает ошибку с текстом про таймаут (RULES 4.19)', async () => {
      mockFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            // Мок обязан уважать signal: иначе await fetch не завершится.
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
            });
          }),
      );

      await expect(
        executeHttpNode({ method: 'GET', url: 'https://example.com/slow', timeoutMs: 20 }),
      ).rejects.toThrow('запрос прерван по таймауту 20 мс');
    });

    it('4xx не считается ошибкой узла: возвращает status без throw', async () => {
      mockFetch(() => Promise.resolve(response('not found', 404)));

      await expect(
        executeHttpNode({ method: 'GET', url: 'https://example.com/missing' }),
      ).resolves.toEqual({ status: 404, body: 'not found' });
    });

    it('обрезает тело ответа до 1 МБ', async () => {
      mockFetch(() => Promise.resolve(response('a'.repeat(MAX_BODY_BYTES + 500))));

      const result = await executeHttpNode({
        method: 'GET',
        url: 'https://example.com/big',
      });

      expect(Buffer.byteLength(result.body, 'utf8')).toBe(MAX_BODY_BYTES);
      expect(result.body).toHaveLength(MAX_BODY_BYTES);
      expect(result.status).toBe(200);
    });

    it('обрезает по границе символа и не рвёт многобайтовый UTF-8', async () => {
      // 'ё' — 2 байта: лимит 1 000 000 нечётен, поэтому последний символ
      // обязан быть отброшен целиком, а не разрезан пополам.
      mockFetch(() => Promise.resolve(response('ё'.repeat(600_000))));

      const result = await executeHttpNode({
        method: 'GET',
        url: 'https://example.com/cyrillic',
      });

      expect(result.body).toHaveLength(500_000);
      expect(Buffer.byteLength(result.body, 'utf8')).toBe(MAX_BODY_BYTES);
      expect(result.body.endsWith('ё')).toBe(true);
    });

    it('берёт URL из входа prompt, если data.url пуст', async () => {
      const fetchMock = mockFetch(() => Promise.resolve(response('ok')));

      const result = await executeHttpNode(
        { method: 'GET' },
        { prompt: 'https://example.com/from-input' },
      );

      expect(result).toEqual({ status: 200, body: 'ok' });
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.com/from-input');
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
  });

  describe('executeConditionNode', () => {
    it('> сравнивает числа', () => {
      const result = executeConditionNode(
        { left: 'input.value', operator: '>', right: '3' },
        { value: 5 },
      );

      expect(result).toEqual({ result: true, evaluated: { left: 5, right: 3 } });
    });

    it('> возвращает false, когда условие не выполнено', () => {
      expect(
        executeConditionNode(
          { left: 'input.value', operator: '>', right: '10' },
          { value: 5 },
        ).result,
      ).toBe(false);
    });

    it('=== сравнивает строки', () => {
      expect(
        executeConditionNode(
          { left: 'input.text', operator: '===', right: "'готово'" },
          { text: 'готово' },
        ),
      ).toEqual({ result: true, evaluated: { left: 'готово', right: 'готово' } });
    });

    it('includes работает для массива', () => {
      expect(
        executeConditionNode(
          { left: 'input.value', operator: 'includes', right: "'b'" },
          { value: ['a', 'b', 'c'] },
        ).result,
      ).toBe(true);
    });

    it('includes работает для строки', () => {
      expect(
        executeConditionNode(
          { left: 'input.text', operator: 'includes', right: 'тек' },
          { text: 'текст ответа' },
        ).result,
      ).toBe(true);
    });

    it('берёт первый непустой вход, если input.X не найден', () => {
      expect(
        executeConditionNode(
          { left: 'input.value', operator: '===', right: "'привет'" },
          { text: 'привет' },
        ),
      ).toEqual({ result: true, evaluated: { left: 'привет', right: 'привет' } });
    });

    it('падает на невалидном операторе (валидация Zod)', () => {
      expect(() =>
        executeConditionNode(
          { left: 'input.value', operator: '!=', right: '1' },
          { value: 1 },
        ),
      ).toThrow(NodeDataValidationException);
    });

    it('падает на includes для числа', () => {
      expect(() =>
        executeConditionNode(
          { left: 'input.value', operator: 'includes', right: '1' },
          { value: 42 },
        ),
      ).toThrow("includes не поддерживает тип 'number'");
    });

    it('падает на === для объекта', () => {
      expect(() =>
        executeConditionNode(
          { left: 'input.value', operator: '===', right: '1' },
          { value: { a: 1 } },
        ),
      ).toThrow('только для примитивов');
    });

    it('падает, если операнд не число для >', () => {
      expect(() =>
        executeConditionNode(
          { left: 'input.text', operator: '>', right: '3' },
          { text: 'не число' },
        ),
      ).toThrow('не является числом');
    });

    it('падает, если операнд не найден во входах', () => {
      expect(() =>
        executeConditionNode({ left: 'input.value', operator: '>', right: '3' }, {}),
      ).toThrow("вход 'value' не найден, а запасных входов (input/prompt/text/value) нет");
    });

    it('читает вход из порта узла (input), а не только из prompt/text', () => {
      // Движок кладёт выход text-предшественника под ключом входного порта
      // `condition` — это `input` (KI-034). Без него узел не увидел бы данные.
      expect(
        executeConditionNode(
          { left: 'input.value', operator: '===', right: "'готово'" },
          { input: 'готово' },
        ),
      ).toEqual({ result: true, evaluated: { left: 'готово', right: 'готово' } });
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
});
