import { ConfigService } from '@nestjs/config';
import { LlmProviderException } from '../llm-provider.interface.js';
import { OpenAiProvider } from './openai.provider.js';

const { createMock, constructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  constructorMock: vi.fn(),
}));

// Реальный SDK в юнит-тестах не вызывается: подменяем клиент целиком
// (RULES: никаких сетевых вызовов в тестах). Опции конструктора запоминаем,
// чтобы проверять проброс baseURL (R5.0).
vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = { completions: { create: createMock } };

    constructor(options: unknown) {
      constructorMock(options);
    }
  },
}));

/**
 * Создаёт заглушку `ConfigService`.
 *
 * @param values - значения переменных окружения по ключам
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Возвращает опции, с которыми был создан клиент SDK.
 *
 * @returns опции конструктора OpenAI
 */
function lastConstructorOptions(): Record<string, unknown> {
  const call = constructorMock.mock.calls.at(-1);

  if (!call) {
    throw new Error('конструктор OpenAI не вызывался');
  }

  return call[0] as Record<string, unknown>;
}

/**
 * Вызывает провайдера и возвращает пойманную ошибку.
 *
 * @param provider - провайдер под тестом
 * @returns ошибка, которую бросил вызов
 */
async function catchGenerateError(provider: OpenAiProvider): Promise<unknown> {
  try {
    await provider.generateAsync('x', { model: 'm' });
  } catch (error: unknown) {
    return error;
  }

  throw new Error('ожидалась ошибка провайдера');
}

/**
 * Достаёт флаг `retryable` из ошибки.
 *
 * @param error - пойманная ошибка
 * @returns признак повторяемости вызова
 */
function retryableOf(error: unknown): boolean {
  if (!(error instanceof LlmProviderException)) {
    throw new Error(`ожидалась LlmProviderException, получено: ${String(error)}`);
  }

  return error.retryable;
}

describe('OpenAiProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('создаёт клиент без baseURL, если OPENAI_BASE_URL не задан (R5.0)', () => {
    new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(lastConstructorOptions()).toEqual({ apiKey: 'sk-test' });
    expect(lastConstructorOptions()).not.toHaveProperty('baseURL');
  });

  it('прокидывает baseURL из OPENAI_BASE_URL (R5.0)', () => {
    new OpenAiProvider(
      configStub({
        OPENAI_API_KEY: 'sk-router',
        OPENAI_BASE_URL: 'https://routerai.ru/api/v1',
      }),
    );

    expect(lastConstructorOptions()).toEqual({
      apiKey: 'sk-router',
      baseURL: 'https://routerai.ru/api/v1',
    });
  });

  it('игнорирует пустой OPENAI_BASE_URL и берёт дефолт SDK (R5.0)', () => {
    new OpenAiProvider(
      configStub({ OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: '' }),
    );

    // Пустая строка (частый случай в .env) не должна попадать в SDK:
    // иначе baseURL перекроет дефолт https://api.openai.com/v1.
    expect(lastConstructorOptions()).toEqual({ apiKey: 'sk-test' });
    expect(lastConstructorOptions()).not.toHaveProperty('baseURL');
  });

  it('возвращает content ответа и передаёт параметры в SDK', async () => {
    createMock.mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 20, completion_tokens: 7 },
      choices: [{ message: { content: 'ответ gpt' } }],
    });

    const provider = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    await expect(
      provider.generateAsync('вопрос', { model: 'gpt-4o', maxTokens: 5, system: 'ты кот' }),
    ).resolves.toEqual({
      text: 'ответ gpt',
      // KI-038: метрики вызова прокидываются наверх.
      usage: { inputTokens: 20, outputTokens: 7, model: 'gpt-4o' },
    });

    const [body, options] = createMock.mock.calls[0];

    expect(body).toEqual(
      expect.objectContaining({
        model: 'gpt-4o',
        max_completion_tokens: 5,
        messages: [
          { role: 'system', content: 'ты кот' },
          { role: 'user', content: 'вопрос' },
        ],
      }),
    );
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('isConfigured отражает наличие ключа (KI-039)', () => {
    expect(new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' })).isConfigured).toBe(true);
    expect(new OpenAiProvider(configStub({ OPENAI_API_KEY: undefined })).isConfigured).toBe(false);
  });

  it('возвращает пустой текст и usage: null, если контента и метрик нет (KI-038)', async () => {
    createMock.mockResolvedValue({ choices: [] });

    const provider = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    await expect(provider.generateAsync('x', { model: 'gpt-4o' })).resolves.toEqual({
      text: '',
      usage: null,
    });
  });

  it('оборачивает ошибку SDK и падает без ключа', async () => {
    const failing = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    createMock.mockRejectedValue(new Error('boom'));

    await expect(failing.generateAsync('x', { model: 'gpt-4o' })).rejects.toThrow(
      LlmProviderException,
    );

    const withoutKey = new OpenAiProvider(configStub({ OPENAI_API_KEY: undefined }));

    await expect(withoutKey.generateAsync('x', { model: 'gpt-4o' })).rejects.toThrow(
      'OPENAI_API_KEY не задан',
    );
  });

  it('помечает 503 как повторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('service unavailable'), { status: 503 }),
    );

    const provider = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });

  it('помечает 401 как неповторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );

    const provider = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    expect(retryableOf(await catchGenerateError(provider))).toBe(false);
  });

  it('помечает таймаут сигнала как повторяемую ошибку (KI-036)', async () => {
    const provider = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    createMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });
});
