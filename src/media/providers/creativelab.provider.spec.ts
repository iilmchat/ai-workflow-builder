import { Logger } from '@nestjs/common';
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

/** Минимальный валидный ответ upstream по задаче (snake_case). */
const taskPayload = {
  code: 0,
  id: 'task-1',
  model: 'flux-schnell',
  status: 'queued',
  created_at: 1_791_923_563_229,
};

/** Валидный вход создания задачи. */
const taskInput = {
  model: 'flux-schnell',
  prompt: 'кот в шляпе, акварель',
  params: { aspect_ratio: '1:1' },
  idempotencyKey: 'run-1:node-1',
};

/**
 * Подменяет глобальный `fetch` ответом с заданным телом, статусом и заголовками.
 *
 * @param body - тело ответа (сериализуется в JSON)
 * @param status - HTTP-статус
 * @param headers - дополнительные заголовки ответа
 * @returns мок fetch
 */
function mockFetchWith(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } } {
  const mock = vi.fn(() =>
    Promise.resolve(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
      }),
    ),
  );

  vi.stubGlobal('fetch', mock);

  return mock as ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } };
}

/**
 * Достаёт тело запроса из мока `fetch`.
 *
 * `RequestInit.body` имеет широкий тип (`BodyInit | null`), поэтому значение
 * сужается явно: в этих тестах тело всегда JSON-строка.
 *
 * @param init - опции запроса из мока
 * @returns разобранное тело запроса
 */
function bodyOf(init: RequestInit): unknown {
  const body = init.body;

  return typeof body === 'string' ? JSON.parse(body) : null;
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
  it('createTaskAsync: POST на /tasks с ключом, телом и idempotency_key', async () => {
    const fetchMock = mockFetchWith(taskPayload);

    const provider = new CreativeLabProvider(
      configStub({
        GPTUNNEL_MEDIA_API_KEY: 'media-key',
        GPTUNNEL_MEDIA_BASE_URL: 'https://example.test/api/v2/media',
      }),
    );

    const task = await provider.createTaskAsync(taskInput);

    expect(task).toEqual({
      taskId: 'task-1',
      model: 'flux-schnell',
      status: 'queued',
      resultUrls: [],
      costRub: null,
      error: null,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://example.test/api/v2/media/tasks');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'media-key',
        'Content-Type': 'application/json',
      }),
    );
    expect(bodyOf(init)).toEqual({
      model: 'flux-schnell',
      prompt: 'кот в шляпе, акварель',
      params: { aspect_ratio: '1:1' },
      idempotency_key: 'run-1:node-1',
    });
  });

  it('createTaskAsync: wait=true добавляет флаг в тело', async () => {
    const fetchMock = mockFetchWith(taskPayload);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    await provider.createTaskAsync({ ...taskInput, wait: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(bodyOf(init)).toEqual(
      expect.objectContaining({ wait: true }),
    );
  });

  it('createTaskAsync: 401 → ключ не принят, повтор бессмыслен', async () => {
    mockFetchWith({ code: 401, error: 'unauthorized' }, 401);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider
      .createTaskAsync(taskInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(MediaProviderException);
    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as MediaProviderException).message).toContain('ключ media API не принят');
    // KI-103 закрыт: провайдер виден в самом исключении.
    expect((error as MediaProviderException).provider).toBe('creativelab');
  });

  it('createTaskAsync: 402 → закончился баланс, повтор бессмыслен', async () => {
    mockFetchWith({ code: 402, error: 'no money' }, 402);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider
      .createTaskAsync(taskInput)
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as MediaProviderException).message).toContain('закончились средства');
  });

  it('createTaskAsync: 429 → повторяемая ошибка', async () => {
    mockFetchWith({ code: 429 }, 429);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider
      .createTaskAsync(taskInput)
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(true);
  });

  it('createTaskAsync: 409 + code:23 → возвращает существующую задачу', async () => {
    // Идемпотентный конфликт: upstream вернул ту же задачу, новой генерации нет.
    mockFetchWith({ ...taskPayload, status: 'running' }, 409);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const task = await provider.createTaskAsync(taskInput);

    expect(task.taskId).toBe('task-1');
    expect(task.status).toBe('running');
  });

  it('createTaskAsync: 400 + code:25 → невалидный вход, повтор бессмыслен', async () => {
    mockFetchWith({ code: 25, error: 'bad param' }, 400);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider
      .createTaskAsync(taskInput)
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as MediaProviderException).message).toContain('невалидный вход');
  });

  it('createTaskAsync: 410 + code:21 → модель снята без аналога', async () => {
    mockFetchWith({ code: 21 }, 410);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const error = await provider
      .createTaskAsync(taskInput)
      .catch((caught: unknown) => caught);

    expect((error as MediaProviderException).retryable).toBe(false);
    expect((error as MediaProviderException).message).toContain('снята с обслуживания');
  });

  it('createTaskAsync: Deprecation: true → warning, задача выполняется', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    mockFetchWith(
      { ...taskPayload, status: 'done', price: 0.6, result: ['https://cdn/img.png'] },
      200,
      { Deprecation: 'true', 'x-model-served': 'flux-pro' },
    );

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const task = await provider.createTaskAsync(taskInput);

    // Запрос прошёл через аналог, поэтому это предупреждение, а не ошибка.
    expect(task.status).toBe('done');
    expect(task.resultUrls).toEqual(['https://cdn/img.png']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('flux-pro'));
  });

  it('createTaskAsync: без ключа бросает', async () => {
    const provider = new CreativeLabProvider(configStub({}));

    await expect(provider.createTaskAsync(taskInput)).rejects.toThrow(
      'GPTUNNEL_MEDIA_API_KEY не задан',
    );
  });

  it('getTaskAsync: возвращает состояние задачи и стоимость', async () => {
    const fetchMock = mockFetchWith({
      ...taskPayload,
      status: 'done',
      price: 0.6,
      result: ['https://cdn/img.png'],
    });

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    const task = await provider.getTaskAsync('task-1');

    expect(task.status).toBe('done');
    expect(task.costRub).toBe(0.6);
    expect(task.resultUrls).toEqual(['https://cdn/img.png']);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gptunnel.ru/api/v2/media/tasks/task-1',
    );
  });

  it('getTaskAsync: 404 → задача не найдена', async () => {
    mockFetchWith({ code: 404, error: 'not found' }, 404);

    const provider = new CreativeLabProvider(
      configStub({ GPTUNNEL_MEDIA_API_KEY: 'media-key' }),
    );

    await expect(provider.getTaskAsync('missing')).rejects.toThrow(
      MediaProviderException,
    );
  });
});