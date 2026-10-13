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

describe('OpenAiProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает content ответа и передаёт параметры в SDK', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ответ gpt' } }],
    });

    const provider = new OpenAiProvider(configStub('sk-test'));

    await expect(
      provider.generateAsync('вопрос', { model: 'gpt-4o', maxTokens: 5, system: 'ты кот' }),
    ).resolves.toBe('ответ gpt');

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

  it('возвращает пустую строку, если контента нет', async () => {
    createMock.mockResolvedValue({ choices: [] });

    const provider = new OpenAiProvider(configStub('sk-test'));

    await expect(provider.generateAsync('x', { model: 'gpt-4o' })).resolves.toBe('');
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
});
