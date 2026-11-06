import { LmStudioProvider } from './lmstudio.provider.js';

/** Тип мока `fetch` с сигнатурой, как у глобального. */
type FetchMock = ReturnType<
  typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>
>;

/**
 * Подменяет глобальный `fetch` и возвращает типизированный мок.
 *
 * @param handler - реализация ответа
 * @returns мок с типизированными аргументами
 */
function stubFetch(handler: () => Promise<Response>): FetchMock {
  const mock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
    handler,
  );

  vi.stubGlobal('fetch', mock);

  return mock;
}

/**
 * Собирает провайдера LM Studio для теста healthcheck'а.
 *
 * @param baseURL - адрес локального сервера
 * @returns провайдер с одной текстовой моделью
 */
function createProvider(baseURL = 'http://127.0.0.1:1234/v1'): LmStudioProvider {
  return new LmStudioProvider({
    name: 'lmstudio',
    apiKey: 'not-needed',
    baseURL,
    models: [
      {
        id: 'qwen-local',
        label: 'qwen-local (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ],
    isLocal: true,
  });
}

describe('LmStudioProvider.isAvailableAsync (v1.2 S1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('пингует GET {baseURL}/models и возвращает true на 2xx', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );

    await expect(createProvider().isAvailableAsync()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:1234/v1/models',
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    // RULES 4.19: пинг не может висеть без таймаута.
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('срезает завершающий слэш в baseURL', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );

    await createProvider('http://127.0.0.1:1234/v1///').isAvailableAsync();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:1234/v1/models',
    );
  });

  it('не-2xx — false, без исключения', async () => {
    stubFetch(() => Promise.resolve(new Response('down', { status: 503 })));

    await expect(createProvider().isAvailableAsync()).resolves.toBe(false);
  });

  it('сетевая ошибка — false, без исключения', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    await expect(createProvider().isAvailableAsync()).resolves.toBe(false);
  });
});
