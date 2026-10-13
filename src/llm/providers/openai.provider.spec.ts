import { ConfigService } from '@nestjs/config';
import { LlmProviderException } from '../llm-provider.interface.js';
import { OpenAiProvider } from './openai.provider.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

// Реальный SDK в юнит-тестах не вызывается: подменяем клиент целиком
// (RULES: никаких сетевых вызовов в тестах).
vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = { completions: { create: createMock } };
  },
}));

/**
 * Создаёт заглушку `ConfigService`.
 *
 * @param apiKey - значение `OPENAI_API_KEY` (или `undefined`)
 * @returns заглушка ConfigService
 */
function configStub(apiKey?: string): ConfigService {
  return { get: () => apiKey } as unknown as ConfigService;
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

  it('возвращает content ответа и передаёт параметры в SDK', async () => {
    createMock.mockResolvedValue({
      model: 'gpt-4o',
      usage: { prompt_tokens: 20, completion_tokens: 7 },
      choices: [{ message: { content: 'ответ gpt' } }],
    });

    const provider = new OpenAiProvider(configStub('sk-test'));

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

  it('возвращает пустой текст и usage: null, если контента и метрик нет (KI-038)', async () => {
    createMock.mockResolvedValue({ choices: [] });

    const provider = new OpenAiProvider(configStub('sk-test'));

    await expect(provider.generateAsync('x', { model: 'gpt-4o' })).resolves.toEqual({
      text: '',
      usage: null,
    });
  });

  it('оборачивает ошибку SDK и падает без ключа', async () => {
    const failing = new OpenAiProvider(configStub('sk-test'));

    createMock.mockRejectedValue(new Error('boom'));

    await expect(failing.generateAsync('x', { model: 'gpt-4o' })).rejects.toThrow(
      LlmProviderException,
    );

    const withoutKey = new OpenAiProvider(configStub(undefined));

    await expect(withoutKey.generateAsync('x', { model: 'gpt-4o' })).rejects.toThrow(
      'OPENAI_API_KEY не задан',
    );
  });

  it('помечает 503 как повторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('service unavailable'), { status: 503 }),
    );

    const provider = new OpenAiProvider(configStub('sk-test'));

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });

  it('помечает 401 как неповторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('unauthorized'), { status: 401 }),
    );

    const provider = new OpenAiProvider(configStub('sk-test'));

    expect(retryableOf(await catchGenerateError(provider))).toBe(false);
  });

  it('помечает таймаут сигнала как повторяемую ошибку (KI-036)', async () => {
    const provider = new OpenAiProvider(configStub('sk-test'));

    createMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });
});
