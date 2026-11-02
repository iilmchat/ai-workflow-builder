/**
 * Unit-тесты `BingProvider` (v0.15 S3, DESIGN v0.14 § 3.3).
 *
 * Сеть не используется: глобальный `fetch` подменяется моком. Проверяются
 * контракт запроса (заголовок ключа, query-параметры, `count`, `freshness`),
 * маппинг результатов и классификация ошибок: 401/403 — детерминированные,
 * 429/5xx/сеть/таймаут — retryable.
 */
import { ConfigService } from '@nestjs/config';
import { RetryableNodeException } from '../../engine/errors.js';
import {
  BING_PROVIDER_NAME,
  BING_SEARCH_URL,
  BingProvider,
  mapBingFreshness,
} from './bing.provider.js';
import { WebSearchProviderException } from '../web-search.interface.js';

/** Тестовый ключ: в upstream не уходит — fetch замокан. */
const API_KEY = 'bing-test-key';

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
 * Достаёт URL первого вызова мока `fetch` и его query-параметры.
 *
 * @param mock - мок fetch
 * @returns URL, query-параметры и опции запроса
 */
function firstCall(mock: ReturnType<typeof vi.fn>): {
  url: URL;
  init: RequestInit;
} {
  const call = mock.mock.calls[0] as [string, RequestInit];

  return { url: new URL(call[0]), init: call[1] };
}

/** Создаёт провайдер с заданным ключом. */
function providerWithKey(): BingProvider {
  return new BingProvider(configStub({ BING_API_KEY: API_KEY }));
}

/** Ответ Bing с одним результатом. */
const SUCCESS_PAYLOAD = {
  webPages: {
    value: [
      {
        name: 'NestJS — Documentation',
        url: 'https://docs.nestjs.com',
        snippet: 'A progressive Node.js framework.',
      },
    ],
  },
};

describe('BingProvider (v0.15 S3)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('без ключа isConfigured=false и вызов падает понятной ошибкой', async () => {
    const provider = new BingProvider(configStub({}));

    expect(provider.name).toBe(BING_PROVIDER_NAME);
    expect(provider.isConfigured).toBe(false);

    const error: unknown = await provider
      .searchAsync('nestjs')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WebSearchProviderException);
    expect((error as Error).message).toContain('BING_API_KEY не задан');
  });

  it('пустой ключ (пробелы) считается незаданным', () => {
    const provider = new BingProvider(configStub({ BING_API_KEY: '   ' }));

    expect(provider.isConfigured).toBe(false);
  });

  it('успешный поиск: GET, заголовок ключа, query-параметры и маппинг', async () => {
    const mock = mockFetch(SUCCESS_PAYLOAD);
    const provider = providerWithKey();

    const results = await provider.searchAsync('  nestjs  ', {
      maxResults: 3,
    });

    expect(results).toEqual([
      {
        title: 'NestJS — Documentation',
        url: 'https://docs.nestjs.com',
        snippet: 'A progressive Node.js framework.',
      },
    ]);

    const { url, init } = firstCall(mock);

    expect(`${url.origin}${url.pathname}`).toBe(BING_SEARCH_URL);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      'Ocp-Apim-Subscription-Key': API_KEY,
      Accept: 'application/json',
    });
    expect(url.searchParams.get('q')).toBe('nestjs');
    expect(url.searchParams.get('count')).toBe('3');
    expect(url.searchParams.get('responseFilter')).toBe('Webpages');
    expect(url.searchParams.get('textFormat')).toBe('Raw');
    expect(url.searchParams.get('textDecorations')).toBe('false');
    // Bing v7 не поддерживает глубину — параметра быть не должно.
    expect(url.searchParams.has('search_depth')).toBe(false);
    expect(url.searchParams.has('searchDepth')).toBe(false);
  });

  it('передаёт freshness-алиас day как Day', async () => {
    const mock = mockFetch({ webPages: { value: [] } });
    const provider = providerWithKey();

    await provider.searchAsync('nestjs', { freshness: 'day' });

    expect(firstCall(mock).url.searchParams.get('freshness')).toBe('Day');
  });

  it('передаёт нативный диапазон дат Bing без изменений', async () => {
    const mock = mockFetch({ webPages: { value: [] } });
    const provider = providerWithKey();

    await provider.searchAsync('nestjs', {
      freshness: '2026-01-01..2026-02-01',
    });

    expect(firstCall(mock).url.searchParams.get('freshness')).toBe(
      '2026-01-01..2026-02-01',
    );
  });

  it('freshness=year разворачивается в диапазон последних 365 дней', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));

    expect(mapBingFreshness('year')).toBe('2025-11-02..2026-11-02');
  });

  it('нераспознанный freshness игнорируется, а не роняет поиск', async () => {
    const mock = mockFetch({ webPages: { value: [] } });
    const provider = providerWithKey();

    await provider.searchAsync('nestjs', { freshness: 'свежее некуда' });

    expect(firstCall(mock).url.searchParams.has('freshness')).toBe(false);
  });

  it('searchDepth принимается, но не уходит в Bing и не роняет запрос', async () => {
    const mock = mockFetch({ webPages: { value: [] } });
    const provider = providerWithKey();

    await provider.searchAsync('nestjs', { searchDepth: 'advanced' });

    expect(firstCall(mock).url.searchParams.has('searchDepth')).toBe(false);
  });

  it('пустой webPages — пустой массив, а не ошибка', async () => {
    mockFetch({});
    const provider = providerWithKey();

    await expect(provider.searchAsync('редкий запрос')).resolves.toEqual([]);
  });

  it('нормализует maxResults: дефолт 5 и жёсткий cap 10', async () => {
    const mock = mockFetch({ webPages: { value: [] } });
    const provider = providerWithKey();

    await provider.searchAsync('первый');
    await provider.searchAsync('второй', { maxResults: 50 });
    await provider.searchAsync('третий', { maxResults: 0 });

    expect(firstCall(mock).url.searchParams.get('count')).toBe('5');
    expect(
      new URL((mock.mock.calls[1][0] as string)).searchParams.get('count'),
    ).toBe('10');
    expect(
      new URL((mock.mock.calls[2][0] as string)).searchParams.get('count'),
    ).toBe('1');
  });

  it('обрезает сниппет до 500 символов', async () => {
    mockFetch({
      webPages: {
        value: [
          {
            name: 'Длинная страница',
            url: 'https://example.com/long',
            snippet: 'а'.repeat(600),
          },
        ],
      },
    });
    const provider = providerWithKey();

    const [result] = await provider.searchAsync('длинный текст');

    expect(result.snippet).toHaveLength(500);
    expect(result.snippet.endsWith('…')).toBe(true);
  });

  it.each([401, 403])(
    '%i — ключ не принят, повтор не нужен',
    async (status) => {
      mockFetch({ error: { code: 'InvalidAuthorization' } }, status);
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
    mockFetch({ error: { code: 'TooManyRequests' } }, 429);
    const provider = providerWithKey();

    await expect(provider.searchAsync('nestjs')).rejects.toMatchObject({
      name: 'RetryableNodeException',
      nodeType: 'web_search',
      retryable: true,
    });
  });

  it('5xx — retryable-ошибка узла web_search', async () => {
    mockFetch({ error: { code: 'ServerError' } }, 503);
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
    mockFetch({ webPages: { value: [{ name: 'Без url' }] } });
    const provider = providerWithKey();

    await expect(provider.searchAsync('nestjs')).rejects.toBeInstanceOf(
      WebSearchProviderException,
    );
  });

  it('пустой запрос отклоняется до обращения к сети', async () => {
    const mock = mockFetch({ webPages: { value: [] } });
    const provider = providerWithKey();

    await expect(provider.searchAsync('   ')).rejects.toBeInstanceOf(
      WebSearchProviderException,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
