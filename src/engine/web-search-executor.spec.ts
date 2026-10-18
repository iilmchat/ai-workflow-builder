/**
 * Исполнитель узла `web_search` (v0.10 S2, DESIGN v0.10 § 3.1).
 *
 * Провайдер подменяется моком: тест не ходит в Tavily и проверяет только
 * контракт исполнителя — приоритет запроса, Zod-валидацию, формат `text` и
 * отсутствие `rawContent` в выходах (KI-459).
 */
import {
  DEFAULT_WEB_SEARCH_MAX_RESULTS,
  NodeDataValidationException,
  WEB_SEARCH_MAX_TEXT_BYTES,
  executeWebSearchNodeAsync,
} from './node-executors.js';
import type {
  IWebSearchProvider,
  WebSearchOptions,
  WebSearchResult,
} from '../web-search/web-search.interface.js';

/** Один результат поиска без `rawContent`. */
const RESULT: WebSearchResult = {
  title: 'TypeScript 5.9',
  url: 'https://example.com/ts',
  snippet: 'Новая версия компилятора.',
};

/**
 * Создаёт провайдера-заглушку.
 *
 * @param results - результаты, которые «вернул» поиск
 * @returns провайдер и мок `searchAsync` для проверки аргументов
 */
function createProvider(results: WebSearchResult[]): {
  provider: IWebSearchProvider;
  search: ReturnType<typeof vi.fn>;
} {
  const search = vi.fn(
    (_query: string, _options?: WebSearchOptions): Promise<WebSearchResult[]> =>
      Promise.resolve(results),
  );

  return {
    provider: {
      name: 'fake',
      isConfigured: true,
      searchAsync: search,
    },
    search,
  };
}

describe('executeWebSearchNodeAsync (v0.10 S2)', () => {
  it('берёт запрос из inputs.prompt и передаёт maxResults провайдеру', async () => {
    const { provider, search } = createProvider([RESULT]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'поле узла', maxResults: 3 },
      { prompt: 'запрос из связи' },
      provider,
    );

    expect(search).toHaveBeenCalledWith('запрос из связи', { maxResults: 3 });
    // KI-459: в outputs только results и text.
    expect(Object.keys(outputs).sort()).toEqual(['results', 'text']);
  });

  it('использует data.query, если входной prompt пуст, и дефолт maxResults', async () => {
    const { provider, search } = createProvider([RESULT]);

    const outputs = await executeWebSearchNodeAsync(
      { query: '  запрос из узла  ' },
      { prompt: '   ' },
      provider,
    );

    expect(search).toHaveBeenCalledWith('запрос из узла', {
      maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
    });
    expect(outputs.results).toEqual([RESULT]);
  });

  it('пустой запрос — NodeDataValidationException', async () => {
    const { provider, search } = createProvider([RESULT]);

    await expect(
      executeWebSearchNodeAsync({}, { prompt: '' }, provider),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(search).not.toHaveBeenCalled();
  });

  it.each([0, 11, 2.5])(
    'maxResults=%s отклоняется Zod-схемой',
    async (maxResults) => {
      const { provider, search } = createProvider([RESULT]);

      await expect(
        executeWebSearchNodeAsync(
          { query: 'q', maxResults },
          {},
          provider,
        ),
      ).rejects.toBeInstanceOf(NodeDataValidationException);

      expect(search).not.toHaveBeenCalled();
    },
  );

  it('не пропускает rawContent в results (KI-459)', async () => {
    const { provider } = createProvider([
      { ...RESULT, rawContent: 'полный текст страницы '.repeat(1000) },
    ]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'q' },
      {},
      provider,
    );

    expect(outputs.results).toEqual([RESULT]);
    expect(JSON.stringify(outputs)).not.toContain('rawContent');
  });

  it('формирует нумерованный текст для LLM', async () => {
    const { provider } = createProvider([
      RESULT,
      { title: '', url: 'https://example.com/empty', snippet: '' },
    ]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'typescript' },
      {},
      provider,
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
    const { provider } = createProvider([]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'редкий запрос' },
      {},
      provider,
    );

    expect(outputs.results).toEqual([]);
    expect(outputs.text).toBe('По запросу «редкий запрос» ничего не найдено.');
  });

  it('обрезает text больше 2 МБ и оставляет пометку', async () => {
    // Кириллица: каждый символ — 2 байта UTF-8, проверяем границу по байтам,
    // а не по длине JS-строки.
    const huge = 'я'.repeat(WEB_SEARCH_MAX_TEXT_BYTES / 2 + 1024);
    const { provider } = createProvider([
      { title: 'Огромный сниппет', url: 'https://example.com/huge', snippet: huge },
    ]);

    const outputs = await executeWebSearchNodeAsync(
      { query: 'huge' },
      {},
      provider,
    );
    const text = String(outputs.text);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      WEB_SEARCH_MAX_TEXT_BYTES,
    );
    expect(text).toContain('обрезано');
  });
});
