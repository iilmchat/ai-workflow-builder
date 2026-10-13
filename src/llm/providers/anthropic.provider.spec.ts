import { ConfigService } from '@nestjs/config';
import { LlmProviderException } from '../llm-provider.interface.js';
import { AnthropicProvider } from './anthropic.provider.js';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

// Реальный SDK в юнит-тестах не вызывается: подменяем клиент целиком
// (RULES: никаких сетевых вызовов в тестах).
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    readonly messages = { create: createMock };
  },
}));

/**
 * Создаёт заглушку `ConfigService`.
 *
 * @param apiKey - значение `ANTHROPIC_API_KEY` (или `undefined`)
 * @returns заглушка ConfigService
 */
function configStub(apiKey?: string): ConfigService {
  return { get: () => apiKey } as unknown as ConfigService;
}

describe('AnthropicProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('склеивает text-блоки ответа и передаёт параметры в SDK', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'text', text: 'привет' },
        { type: 'tool_use', id: 't1', name: 'tool', input: {} },
        { type: 'text', text: ', мир' },
      ],
    });

    const provider = new AnthropicProvider(configStub('sk-ant-test'));

    await expect(
      provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        maxTokens: 10,
      }),
    ).resolves.toBe('привет, мир');

    const [body, options] = createMock.mock.calls[0];

    expect(body).toEqual(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'вопрос' }],
      }),
    );
    // RULES 4.19: у вызова всегда есть signal (таймаут или внешний).
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('оборачивает ошибку SDK в LlmProviderException', async () => {
    createMock.mockRejectedValue(new Error('boom'));

    const provider = new AnthropicProvider(configStub('sk-ant-test'));

    await expect(provider.generateAsync('x', { model: 'm' })).rejects.toThrow(
      LlmProviderException,
    );
    await expect(provider.generateAsync('x', { model: 'm' })).rejects.toThrow(
      '[anthropic] boom',
    );
  });

  it('без ключа не роняет конструктор, но падает при вызове', async () => {
    const provider = new AnthropicProvider(configStub(undefined));

    expect(provider.models).toHaveLength(2);
    expect(createMock).not.toHaveBeenCalled();
    await expect(provider.generateAsync('x', { model: 'm' })).rejects.toThrow(
      'ANTHROPIC_API_KEY не задан',
    );
  });
});
