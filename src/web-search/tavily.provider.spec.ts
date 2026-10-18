/**
 * Unit-тесты `TavilyProvider` (v0.10 S1).
 *
 * Сеть не используется: глобальный `fetch` подменяется моком. Проверяются
 * контракт запроса, маппинг результатов (включая `rawContent`), а также
 * классификация ошибок: 401/403 — детерминированные, 429/5xx/сеть — retryable
 * (DESIGN v0.10 § 3.1.6).
 */
import { ConfigService } from '@nestjs/config';
import { RetryableNodeException } from '../engine/errors.js';
import {
  TAVILY_PROVIDER_NAME,
  TAVILY_SEARCH_URL,
  TavilyProvider,
} from './tavily.provider.js';
import { WebSearchProviderException } from './web-search.interface.js';

/** Тестовый ключ: в upstream не уходит — fetch замокан. */
const API_KEY = 'tvly-test-key';

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Подменяет глобальный `fetch` ответом с заданным телом и статусом.
 *
 * Фабрика создаёт новый `Response` на каждый вызов: тело можно читать только
 * один раз, а тесты иногда вызывают провайдер повторно.
 *
 * @param body - тело ответа (сериализуется в JSON)
 * @param status - HTTP-статус
 * @returns мок fetch
 */
function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  vi.stubGlobal('fetch', mock);

  return mock;
}

/**
 * Достаёт тело запроса из мока `fetch`.
 *
 * @param init - опции запроса из мока
 * @returns разобранное тело запроса
 */
function bodyOf(init: RequestInit): unknown {
  const body = init.body;

  return typeof body === 'string' ? JSON.parse(body) : null;
}

/**
 * Достаёт опции первого вызова мока `fetch`.
 *
 * @param mock - мок fetch
 * @returns URL и опции запроса
 */
function firstCall(mock: ReturnType<typeof vi.fn>): {
  url: string;
  init: RequestInit;
} {
  const call = mock.mock.calls[0] as [string, RequestInit];

  return { url: call[0], init: call[1] };
}

/** Создаёт провайдер с заданным ключом. */
function providerWithKey(): TavilyProvider {
  return new TavilyProvider(configStub({ TAVILY_API_KEY: API_KEY }));
}

describe('TavilyProvider (v0.10 S1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('без ключа isConfigured=false и вызов падает понятной ошибкой', async () => {
    const provider = new TavilyProvider(configStub({}));

    expect(provider.name).toBe(TAVILY_PROVIDER_NAME);
    expect(provider.isConfigured).toBe(false);

    await expect(provider.searchAsync('nestjs')).rejects.toBeInstanceOf(
      WebSearchProviderException,
    );
  });

  it('пустой ключ (пробелы) считается незаданным', () => {
    const provider = new TavilyProvider(configStub({ TAVILY_API_KEY: '   ' }));

    expect(provider.isConfigured).toBe(false);
  });

  it('успешный поиск: POST в Tavily, заголовки, include_raw_content и маппинг', async () => {
    const payload = {
      query: 'nestjs',
      results: [
        {
          title: 'NestJS — Documentation',
          url: 'https://docs.nestjs.com',
          content: 'A progressive Node.js framework.',
          raw_content: '  Полный текст страницы про NestJS.  ',
        },
        {
          title: 'Node.js',
          url: 'https://nodejs.org',
          content: 'JavaScript runtime.',
          raw_content: null,
        },
      ],
      response_time: 0.42,
    };
    const mock = mockFetch(payload);
    const provider = providerWithKey();

    const results = await provider.searchAsync('  nestjs  ', {
      maxResults: 3,
    });

    expect(results).toEqual([
      {
        title: 'NestJS — Documentation',
        url: 'https://docs.nestjs.com',
        snippet: 'A progressive Node.js framework.',
        rawContent: 'Полный текст страницы про NestJS.',
      },
      {
        title: 'Node.js',
        url: 'https://nodejs.org',
        snippet: 'JavaScript runtime.',
      },
    ]);
    // Поле отсутствует, а не `undefined`: вызывающий код проверяет наличие.
    expect(results[1]).not.toHaveProperty('rawContent');

    const { url, init } = firstCall(mock);

    expect(url).toBe(TAVILY_SEARCH_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(bodyOf(init)).toEqual({
      query: 'nestjs',
      max_results: 3,
      include_raw_content: true,
    });
  });

  it('пустой результат Tavily — пустой массив, а не ошибка', async () => {
    mockFetch({ results: [] });
    const provider = providerWithKey();

    await expect(provider.searchAsync('редкий запрос')).resolves.toEqual([]);
  });

  it('нормализует maxResults: дефолт 5 и жёсткий cap 10', async () => {
    const mock = mockFetch({ results: [] });
    const provider = providerWithKey();

    await provider.searchAsync('первый');
    await provider.searchAsync('второй', { maxResults: 50 });
    await provider.searchAsync('третий', { maxResults: 0 });

    expect(bodyOf(firstCall(mock).init)).toMatchObject({ max_results: 5 });
    expect(bodyOf(mock.mock.calls[1][1] as RequestInit)).toMatchObject({
      max_results: 10,
    });
    expect(bodyOf(mock.mock.calls[2][1] as RequestInit)).toMatchObject({
      max_results: 1,
    });
  });

  it('обрезает сниппет до 500 символов', async () => {
    mockFetch({
      results: [
        {
          title: 'Длинная страница',
          url: 'https://example.com/long',
          content: 'а'.repeat(600),
        },
      ],
    });
    const provider = providerWithKey();

    const [result] = await provider.searchAsync('длинный текст');

    expect(result.snippet).toHaveLength(500);
    expect(result.snippet.endsWith('…')).toBe(true);
  });

  it.each([401, 403])(
    '%i — ключ не принят, повтор не нужен',
    async (status) => {
      mockFetch({ detail: 'invalid api key' }, status);
      const provider = providerWithKey();

      await expect(provider.searchAsync('nestjs')).rejects.toBeInstanceOf(
        WebSearchProviderException,
      );
      await expect(provider.searchAsync('nestjs')).rejects.not.toBeInstanceOf(
        RetryableNodeException,
      );
    },
  );

  it('429 — retryable-ошибка узла web_search', async () => {
    mockFetch({ detail: 'rate limit' }, 429);
    const provider = providerWithKey();

    await expect(provider.searchAsync('nestjs')).rejects.toMatchObject({
      name: 'RetryableNodeException',
      nodeType: 'web_search',
      retryable: true,
    });
  });

  it('5xx — retryable-ошибка узла web_search', async () => {
    mockFetch({ detail: 'upstream down' }, 503);
    const provider = providerWithKey();

    const error: unknown = await provider
      .searchAsync('nestjs')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RetryableNodeException);
    expect((error as Error).message).toContain('503');
  });

  it('сетевой сбой — retryable-ошибка с cause', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    );
    const provider = providerWithKey();

    const error: unknown = await provider
      .searchAsync('nestjs')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RetryableNodeException);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it('таймаут — retryable-ошибка с текстом про таймаут', async () => {
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.abort());

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('aborted', 'TimeoutError'))),
    );
    const provider = providerWithKey();

    const error: unknown = await provider
      .searchAsync('nestjs')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RetryableNodeException);
    expect((error as Error).message).toContain('таймаут');
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
  });

  it('таймаут на чтении тела — retryable, а не «битый JSON»', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());

    // Заголовки пришли, но тело уже оборвано таймаутом.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.reject(new DOMException('aborted', 'TimeoutError')),
        } as unknown as Response),
      ),
    );
    const provider = providerWithKey();

    const error: unknown = await provider
      .searchAsync('nestjs')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RetryableNodeException);
    expect((error as Error).message).toContain('таймаут чтения');
  });

  it('невалидный JSON — детерминированная ошибка провайдера', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('not-json', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
          }),
        ),
      ),
    );
    const provider = providerWithKey();

    await expect(provider.searchAsync('nestjs')).rejects.toBeInstanceOf(
      WebSearchProviderException,
    );
  });

  it('ответ не по схеме — детерминированная ошибка провайдера', async () => {
    mockFetch({ results: [{ title: 'Без url' }] });
    const provider = providerWithKey();

    await expect(provider.searchAsync('nestjs')).rejects.toBeInstanceOf(
      WebSearchProviderException,
    );
  });

  it('пустой запрос отклоняется до обращения к сети', async () => {
    const mock = mockFetch({ results: [] });
    const provider = providerWithKey();

    await expect(provider.searchAsync('   ')).rejects.toBeInstanceOf(
      WebSearchProviderException,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
