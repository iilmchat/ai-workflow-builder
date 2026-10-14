import { Logger } from '@nestjs/common';
import { LlmProviderException } from '../llm-provider.interface.js';
import {
  OpenAiCompatibleProvider,
  type OpenAiCompatibleConfig,
} from './openai-compatible.provider.js';

const { createMock, constructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  constructorMock: vi.fn(),
}));

// Реальный SDK в юнит-тестах не вызывается: подменяем клиент целиком
// (RULES: никаких сетевых вызовов в тестах). Опции конструктора запоминаем,
// чтобы проверять проброс baseURL и apiKey (R5.0/v0.5.0).
vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = { completions: { create: createMock } };

    constructor(options: unknown) {
      constructorMock(options);
    }
  },
}));

/**
 * Собирает конфиг провайдера с разумными дефолтами.
 *
 * @param overrides - поля, которые нужно переопределить в тесте
 * @returns конфиг OpenAI-совместимого провайдера
 */
function providerConfig(
  overrides: Partial<OpenAiCompatibleConfig> = {},
): OpenAiCompatibleConfig {
  return {
    name: 'openai',
    apiKey: 'sk-test',
    baseURL: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
    envKey: 'OPENAI_API_KEY',
    ...overrides,
  };
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
async function catchGenerateError(
  provider: OpenAiCompatibleProvider,
): Promise<unknown> {
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

describe('OpenAiCompatibleProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('создаёт клиент с apiKey и baseURL из конфига', () => {
    new OpenAiCompatibleProvider(providerConfig());

    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(lastConstructorOptions()).toEqual({
      apiKey: 'sk-test',
      baseURL: 'https://api.openai.com/v1',
    });
  });

  it('использует baseURL конкретного провайдера (RouterAI, v0.5.0)', () => {
    const provider = new OpenAiCompatibleProvider(
      providerConfig({
        name: 'routerai',
        apiKey: 'sk-router',
        baseURL: 'https://routerai.ru/api/v1',
        models: [{ id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }],
        envKey: 'ROUTERAI_API_KEY',
      }),
    );

    expect(provider.name).toBe('routerai');
    expect(provider.models).toEqual([
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
    ]);
    expect(lastConstructorOptions()).toEqual({
      apiKey: 'sk-router',
      baseURL: 'https://routerai.ru/api/v1',
    });
  });

  it('работает без ключа для LM Studio (заглушка not-needed)', () => {
    const provider = new OpenAiCompatibleProvider(
      providerConfig({
        name: 'lmstudio',
        apiKey: 'not-needed',
        baseURL: 'http://localhost:1234/v1',
        models: [{ id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct (local)' }],
        envKey: undefined,
      }),
    );

    expect(provider.isConfigured).toBe(true);
    expect(lastConstructorOptions()).toEqual({
      apiKey: 'not-needed',
      baseURL: 'http://localhost:1234/v1',
    });
  });

  it('isConfigured=false и понятная ошибка, если ключ пустой (KI-039)', async () => {
    const provider = new OpenAiCompatibleProvider(
      providerConfig({ apiKey: '', name: 'deepseek', envKey: 'DEEPSEEK_API_KEY' }),
    );

    expect(constructorMock).not.toHaveBeenCalled();
    expect(provider.isConfigured).toBe(false);

    // В тексте ошибки — имя провайдера и его переменной окружения.
    await expect(provider.generateAsync('x', { model: 'deepseek-chat' })).rejects.toThrow(
      '[deepseek] DEEPSEEK_API_KEY не задан',
    );
  });

  it('KI-159: подменяет id модели через resolveModel (URI для Yandex)', async () => {
    createMock.mockResolvedValue({
      model: 'gpt://b1g-folder/yandexgpt-lite/latest',
      usage: { prompt_tokens: 5, completion_tokens: 3 },
      choices: [{ message: { content: 'ответ yandex' } }],
    });

    const provider = new OpenAiCompatibleProvider(
      providerConfig({
        name: 'yandex',
        models: [{ id: 'yandexgpt-lite', label: 'YandexGPT Lite' }],
        envKey: 'YANDEX_API_KEY',
        resolveModel: (model) => `gpt://b1g-folder/${model}/latest`,
      }),
    );

    await provider.generateAsync('вопрос', { model: 'yandexgpt-lite' });

    // В UI и node.data.model — короткий id, в upstream — полный URI.
    expect(createMock.mock.calls[0][0].model).toBe(
      'gpt://b1g-folder/yandexgpt-lite/latest',
    );
  });

  it('без resolveModel id модели уходит как есть', async () => {
    createMock.mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 5, completion_tokens: 3 },
      choices: [{ message: { content: 'ответ' } }],
    });

    const provider = new OpenAiCompatibleProvider(providerConfig());

    await provider.generateAsync('вопрос', { model: 'gpt-4o' });

    expect(createMock.mock.calls[0][0].model).toBe('gpt-4o');
  });

  it('возвращает content ответа и передаёт параметры в SDK', async () => {    createMock.mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 20, completion_tokens: 7 },
      choices: [{ message: { content: 'ответ gpt' } }],
    });

    const provider = new OpenAiCompatibleProvider(providerConfig());

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

  it('KI-179: пустой ответ — явная ошибка, а не text: ""', async () => {
    createMock.mockResolvedValue({ choices: [] });

    const provider = new OpenAiCompatibleProvider(providerConfig());

    // Раньше возвращался `text: ''`, и следующий узел падал с невнятным
    // «Пустой prompt»; теперь причина названа сразу.
    await expect(provider.generateAsync('x', { model: 'gpt-4o' })).rejects.toThrow(
      'LLM вернул пустой ответ',
    );
  });

  it('KI-179: при пустом content берётся reasoning, но с предупреждением', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    createMock.mockResolvedValue({
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: '',
            reasoning: 'рассуждение модели',
            reasoning_content: null,
          },
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 16 },
    });

    const provider = new OpenAiCompatibleProvider(providerConfig());

    await expect(provider.generateAsync('x', { model: 'deepseek-v4-flash' })).resolves.toEqual({
      text: 'рассуждение модели',
      usage: { inputTokens: 25, outputTokens: 16, model: 'deepseek-v4-flash' },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('использован reasoning'));
  });

  it('KI-179: reasoning_content — альтернативное имя поля', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    createMock.mockResolvedValue({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: '', reasoning_content: 'текст из reasoning_content' },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    const provider = new OpenAiCompatibleProvider(providerConfig());

    await expect(provider.generateAsync('x', { model: 'gpt-4o' })).resolves.toEqual({
      text: 'текст из reasoning_content',
      usage: { inputTokens: 1, outputTokens: 1, model: 'gpt-4o' },
    });
  });

  it('KI-179: непустой content при finish_reason=length остаётся как есть', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          finish_reason: 'length',
          message: { content: 'обрезанный, но валидный ответ' },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });

    const provider = new OpenAiCompatibleProvider(providerConfig());

    await expect(provider.generateAsync('x', { model: 'gpt-4o' })).resolves.toEqual({
      text: 'обрезанный, но валидный ответ',
      usage: { inputTokens: 3, outputTokens: 4, model: 'gpt-4o' },
    });
  });

  it('оборачивает ошибку SDK в LlmProviderException', async () => {
    const failing = new OpenAiCompatibleProvider(providerConfig());

    createMock.mockRejectedValue(new Error('boom'));

    await expect(failing.generateAsync('x', { model: 'gpt-4o' })).rejects.toThrow(
      LlmProviderException,
    );
  });

  it('помечает 503 как повторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('service unavailable'), { status: 503 }),
    );

    const provider = new OpenAiCompatibleProvider(providerConfig());

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });

  it('помечает 401 как неповторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );

    const provider = new OpenAiCompatibleProvider(providerConfig());

    expect(retryableOf(await catchGenerateError(provider))).toBe(false);
  });

  it('помечает таймаут сигнала как повторяемую ошибку (KI-036)', async () => {
    const provider = new OpenAiCompatibleProvider(providerConfig());

    createMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });
});
