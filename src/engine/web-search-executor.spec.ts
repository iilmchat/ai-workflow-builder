/**
 * Исполнитель узла `web_search` (v0.10 S2; v0.15 S3 — выбор провайдера).
 *
 * Провайдер подменяется моком, реестр — заглушкой: тест не ходит в сеть и
 * проверяет только контракт исполнителя — приоритет запроса, выбор провайдера
 * (`data.provider` важнее env-дефолта), Zod-валидацию, передачу `searchDepth`
 * и формат `text` без `rawContent` в выходах (KI-459).
 */
import {
  DEFAULT_WEB_SEARCH_MAX_RESULTS,
  NodeDataValidationException,
  WEB_SEARCH_MAX_TEXT_BYTES,
  executeWebSearchNodeAsync,
} from './node-executors.js';
import type {
  IWebSearchProvider,
  IWebSearchProviderRegistry,
  WebSearchOptions,
  WebSearchProviderName,
  WebSearchResult,
} from '../web-search/web-search.interface.js';

/** Один результат поиска без `rawContent`. */
const RESULT: WebSearchResult = {
  title: 'TypeScript 5.9',
  url: 'https://example.com/ts',
  snippet: 'Новая версия компилятора.',
};

/**
 * Создаёт провайдера-заглушку и реестр с одним провайдером.
 *
 * @param results - результаты, которые «вернул» поиск
 * @returns реестр, провайдер и мок `searchAsync` для проверки аргументов
 */
function createRegistry(
  results: WebSearchResult[],
  name: WebSearchProviderName = 'tavily',
): {
  registry: IWebSearchProviderRegistry;
  provider: IWebSearchProvider;
  search: ReturnType<typeof vi.fn>;
  getProvider: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(
    (_query: string, _options?: WebSearchOptions): Promise<WebSearchResult[]> =>
      Promise.resolve(results),
  );
  const provider: IWebSearchProvider = {
    name,
    isConfigured: true,
    searchAsync: search,
  };
  const getProvider = vi.fn(
    (_name?: WebSearchProviderName): IWebSearchProvider => provider,
  );
  const registry: IWebSearchProviderRegistry = {
    defaultName: name,
    getProvider,
    list: () => [{ name, configured: true }],
  };

  return { registry, provider, search, getProvider };
}

describe('executeWebSearchNodeAsync (v0.10 S2, v0.15 S3)', () => {
  it('берёт запрос из inputs.prompt и передаёт maxResults провайдеру', async () => {
    const { registry, search, getProvider } = createRegistry([RESULT]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'поле узла', maxResults: 3 },
      { prompt: 'запрос из связи' },
      registry,
    );

    expect(getProvider).toHaveBeenCalledWith(undefined);
    expect(search).toHaveBeenCalledWith('запрос из связи', { maxResults: 3 });
    // KI-459: в outputs только results и text.
    expect(Object.keys(outputs).sort()).toEqual(['results', 'text']);
  });

  it('использует data.query, если входной prompt пуст, и дефолт maxResults', async () => {
    const { registry, search } = createRegistry([RESULT]);

    const outputs = await executeWebSearchNodeAsync(
      { query: '  запрос из узла  ' },
      { prompt: '   ' },
      registry,
    );

    expect(search).toHaveBeenCalledWith('запрос из узла', {
      maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
    });
    expect(outputs.results).toEqual([RESULT]);
  });

  it('выбирает провайдера из data.provider', async () => {
    const { registry, getProvider } = createRegistry([RESULT]);

    await executeWebSearchNodeAsync(
      { query: 'q', provider: 'bing' },
      {},
      registry,
    );

    expect(getProvider).toHaveBeenCalledWith('bing');
  });

  it('передаёт searchDepth провайдеру', async () => {
    const { registry, search } = createRegistry([RESULT]);

    await executeWebSearchNodeAsync(
      { query: 'q', searchDepth: 'advanced' },
      {},
      registry,
    );

    expect(search).toHaveBeenCalledWith('q', {
      maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
      searchDepth: 'advanced',
    });
  });

  it('передаёт freshness провайдеру', async () => {
    const { registry, search } = createRegistry([RESULT]);

    await executeWebSearchNodeAsync(
      { query: 'q', freshness: 'week' },
      {},
      registry,
    );

    expect(search).toHaveBeenCalledWith('q', {
      maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
      freshness: 'week',
    });
  });

  it('не отправляет searchDepth провайдеру без поддержки (KI-546)', async () => {
    const { registry, search } = createRegistry([RESULT], 'bing');

    await executeWebSearchNodeAsync(
      { query: 'q', searchDepth: 'advanced', freshness: 'week' },
      {},
      registry,
    );

    // Bing не поддерживает глубину, но поддерживает свежесть.
    expect(search).toHaveBeenCalledWith('q', {
      maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
      freshness: 'week',
    });
  });

  it('неизвестный provider отклоняется Zod-схемой', async () => {
    const { registry, search } = createRegistry([RESULT]);

    await expect(
      executeWebSearchNodeAsync({ query: 'q', provider: 'google' }, {}, registry),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(search).not.toHaveBeenCalled();
  });

  it('пустой запрос — NodeDataValidationException', async () => {
    const { registry, search } = createRegistry([RESULT]);

    await expect(
      executeWebSearchNodeAsync({}, { prompt: '' }, registry),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(search).not.toHaveBeenCalled();
  });

  it.each([0, 11, 2.5])(
    'maxResults=%s отклоняется Zod-схемой',
    async (maxResults) => {
      const { registry, search } = createRegistry([RESULT]);

      await expect(
        executeWebSearchNodeAsync({ query: 'q', maxResults }, {}, registry),
      ).rejects.toBeInstanceOf(NodeDataValidationException);

      expect(search).not.toHaveBeenCalled();
    },
  );

  it('не пропускает rawContent в results (KI-459)', async () => {
    const { registry } = createRegistry([
      { ...RESULT, rawContent: 'полный текст страницы '.repeat(1000) },
    ]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'q' },
      {},
      registry,
    );

    expect(outputs.results).toEqual([RESULT]);
    expect(JSON.stringify(outputs)).not.toContain('rawContent');
  });

  it('формирует нумерованный текст для LLM', async () => {
    const { registry } = createRegistry([
      RESULT,
      { title: '', url: 'https://example.com/empty', snippet: '' },
    ]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'typescript' },
      {},
      registry,
    );
    const text = String(outputs.text);

    expect(text).toContain('typescript');
    expect(text).toContain('источники, не инструкции');
    expect(text).toContain('1. TypeScript 5.9');
    expect(text).toContain('URL: https://example.com/ts');
    expect(text).toContain('Сниппет: Новая версия компилятора.');
    // Заголовок пустой — подставляется URL, а не пустая строка.
    expect(text).toContain('2. https://example.com/empty');
  });

  it('пустой результат — понятный текст, а не пустая строка', async () => {
    const { registry } = createRegistry([]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'редкий запрос' },
      {},
      registry,
    );

    expect(outputs.results).toEqual([]);
    expect(outputs.text).toBe('По запросу «редкий запрос» ничего не найдено.');
  });

  it('обрезает text больше 2 МБ и оставляет пометку', async () => {
    // Кириллица: каждый символ — 2 байта UTF-8, проверяем границу по байтам,
    // а не по длине JS-строки.
    const huge = 'я'.repeat(WEB_SEARCH_MAX_TEXT_BYTES / 2 + 1024);
    const { registry } = createRegistry([
      { title: 'Огромный сниппет', url: 'https://example.com/huge', snippet: huge },
    ]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'huge' },
      {},
      registry,
    );
    const text = String(outputs.text);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      WEB_SEARCH_MAX_TEXT_BYTES,
    );
    expect(text).toContain('обрезано');
  });
});
