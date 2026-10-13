import { ConfigService } from '@nestjs/config';
import { MediaProviderException } from '../media-provider.interface.js';
import { CreativeLabProvider } from './creativelab.provider.js';

/** Минимальный валидный ответ upstream (snake_case, как у GPTunnel). */
const upstreamPayload = {
  code: 0,
  models: [
    {
      id: 'flux-schnell',
      code: 'flux-schnell',
      type: 'IMAGE',
      price: 0.6,
      price_unit: 'per_generation',
      moderation: 'auto',
      prompt: 'required',
      params: [
        {
          key: 'aspect_ratio',
          type: 'enum',
          label: 'wfc_aspect',
          default: '1:1',
          options: [{ value: '1:1', label: 'wfc_opt_square' }],
          max_length: 16,
        },
      ],
      inputs: [
        {
          key: 'reference',
          kind: 'image',
          role: 'reference',
          required: false,
          max_bytes: 5_000_000,
        },
      ],
      rules: [{ type: 'requires', param: 'aspect_ratio' }],
      deprecated: false,
    },
  ],
};

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | number | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Подменяет глобальный `fetch` ответом с заданным телом и статусом.
 *
 * @param body - тело ответа (сериализуется в JSON)
 * @param status - HTTP-статус
 * @returns мок fetch
 */
function mockFetch(
  body: unknown,
  status = 200,
): ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } } {
  const mock = vi.fn(() =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

  vi.stubGlobal('fetch', mock);

  return mock as ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } };
}

describe('CreativeLabProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('без ключа не сконфигурирован и бросает при вызове', async () => {
    const provider = new CreativeLabProvider(configStub({}));

    expect(provider.isConfigured).toBe(false);
    expect(provider.name).toBe('creativelab');

    await expect(provider.listModelsAsync('IMAGE')).rejects.toThrow(
      MediaProviderException,
    );
    await expect(provider.listModelsAsync('IMAGE')).rejects.toThrow(
      'GPTUNNEL_MEDIA_API_KEY не задан',
    );
  });

  it('ходит в upstream с ключом в Authorization и базовым URL из env', async () => {
    const fetchMock = mockFetch(upstreamPayload);

    const provider = new CreativeLabProvider(
      configStub({
        GPTUNNEL_MEDIA_API_KEY: 'media-key',
        GPTUNNEL_MEDIA_BASE_URL: 'https://example.test/api/v2/media',
      }),
    );

    const models = await provider.listModelsAsync('IMAGE');

    expect(models).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(String(url)).toBe('https://example.test/api/v2/media/models?type=IMAGE');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual(
      expect.objectContaining({ Authorization: 'media-key' }),
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('маппит snake_case upstream в camelCase внутреннего типа', async () => {
    mockFetch(upstreamPayload);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const [model] = await provider.listModelsAsync('IMAGE');

    expect(model).toEqual({
      id: 'flux-schnell',
      code: 'flux-schnell',
      type: 'IMAGE',
      price: 0.6,
      priceUnit: 'per_generation',
      moderation: 'auto',
      prompt: 'required',
      params: [
        {
          key: 'aspect_ratio',
          type: 'enum',
          label: 'wfc_aspect',
          default: '1:1',
          options: [{ value: '1:1', label: 'wfc_opt_square' }],
          maxLength: 16,
        },
      ],
      inputs: [
        {
          key: 'reference',
          kind: 'image',
          role: 'reference',
          required: false,
          maxBytes: 5_000_000,
        },
      ],
      rules: [{ type: 'requires', param: 'aspect_ratio' }],
      deprecated: false,
      deprecationRedirectTo: undefined,
    });
  });

  it('кэширует модели: второй вызов не идёт в сеть', async () => {
    const fetchMock = mockFetch(upstreamPayload);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const first = await provider.listModelsAsync('IMAGE');
    const second = await provider.listModelsAsync('IMAGE');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('кэширует каждый тип отдельно', async () => {
    const fetchMock = mockFetch(upstreamPayload);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    await provider.listModelsAsync('IMAGE');
    await provider.listModelsAsync('VIDEO');
    await provider.listModelsAsync();

    // Разные ключи кэша → три запроса; повторные обращения берут кэш.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(urls).toEqual([
      'https://gptunnel.ru/api/v2/media/models?type=IMAGE',
      'https://gptunnel.ru/api/v2/media/models?type=VIDEO',
      'https://gptunnel.ru/api/v2/media/models',
    ]);
  });

  it('после истечения TTL снова идёт в сеть', async () => {
    const fetchMock = mockFetch(upstreamPayload);

    const provider = new CreativeLabProvider(
      configStub({
        GPTUNNEL_MEDIA_API_KEY: 'media-key',
        GPTUNNEL_MEDIA_CACHE_TTL_MS: 10_000,
      }),
    );

    await provider.listModelsAsync('IMAGE');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Сдвигаем время за пределы TTL: кэш должен быть признан устаревшим.
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + 10_001);

    await provider.listModelsAsync('IMAGE');

    expect(fetchMock).toHaveBeenCalledTimes(2);

    now.mockRestore();
  });

  it('clearCache сбрасывает кэш', async () => {
    const fetchMock = mockFetch(upstreamPayload);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    await provider.listModelsAsync('IMAGE');
    provider.clearCache();
    await provider.listModelsAsync('IMAGE');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('оборачивает 500 от upstream в MediaProviderException с retryable', async () => {
    mockFetch({ code: 500, models: [] }, 500);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider.listModelsAsync('IMAGE').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(true);
    expect((error as MediaProviderException).message).toContain('ответил 500');
  });

  it('помечает 401 как неповторяемую ошибку', async () => {
    mockFetch({ code: 401, models: [] }, 401);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider.listModelsAsync('IMAGE').catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
  });

  it('бросает при ответе не по схеме', async () => {
    // Формат, который нарушает контракт: models не массив.
    mockFetch({ code: 0, models: 'нет' });

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    await expect(provider.listModelsAsync('IMAGE')).rejects.toThrow(
      'неожиданный формат ответа media API',
    );
  });

  it('бросает при сетевой ошибке с признаком retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider.listModelsAsync('IMAGE').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(true);
    expect((error as MediaProviderException).message).toContain(
      'не удалось обратиться к media API',
    );
  });
});
