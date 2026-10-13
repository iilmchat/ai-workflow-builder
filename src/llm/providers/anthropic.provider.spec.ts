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

/**
 * Вызывает провайдера и возвращает пойманную ошибку.
 *
 * @param provider - провайдер под тестом
 * @returns ошибка, которую бросил вызов
 */
async function catchGenerateError(provider: AnthropicProvider): Promise<unknown> {
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

describe('AnthropicProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('склеивает text-блоки ответа и передаёт параметры в SDK', async () => {
    createMock.mockResolvedValue({
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 12, output_tokens: 5 },
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
    ).resolves.toEqual({
      text: 'привет, мир',
      // KI-038: метрики вызова прокидываются наверх.
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        model: 'claude-sonnet-4-20250514',
      },
    });

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

  it('возвращает usage: null, если провайдер не отдал метрики (KI-038)', async () => {
    createMock.mockResolvedValue({
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'без метрик' }],
    });

    const provider = new AnthropicProvider(configStub('sk-ant-test'));

    await expect(provider.generateAsync('x', { model: 'm' })).resolves.toEqual({
      text: 'без метрик',
      usage: null,
    });
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

  it('помечает 429 как повторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 429 }),
    );

    const provider = new AnthropicProvider(configStub('sk-ant-test'));

    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });

  it('помечает 400 как неповторяемую ошибку (KI-036)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('bad request'), { status: 400 }),
    );

    const provider = new AnthropicProvider(configStub('sk-ant-test'));

    expect(retryableOf(await catchGenerateError(provider))).toBe(false);
  });

  it('помечает таймаут и сетевой сбой как повторяемые (KI-036)', async () => {
    const provider = new AnthropicProvider(configStub('sk-ant-test'));

    createMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    expect(retryableOf(await catchGenerateError(provider))).toBe(true);

    createMock.mockRejectedValue(
      Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
    );
    expect(retryableOf(await catchGenerateError(provider))).toBe(true);
  });
});
