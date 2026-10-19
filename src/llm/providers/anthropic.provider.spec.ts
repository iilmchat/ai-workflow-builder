import { ConfigService } from '@nestjs/config';
import { LlmProviderException } from '../llm-provider.interface.js';
import { AnthropicProvider } from './anthropic.provider.js';

const { createMock, constructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  constructorMock: vi.fn(),
}));

// Реальный SDK в юнит-тестах не вызывается: подменяем клиент целиком
// (RULES: никаких сетевых вызовов в тестах). Опции конструктора запоминаем,
// чтобы проверить выключение внутренних ретраев (KI-500).
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    readonly messages = { create: createMock };

    constructor(options: unknown) {
      constructorMock(options);
    }
  },
}));

/**
 * Создаёт заглушку `ConfigService`.
 *
 * @param apiKey - значение `ANTHROPIC_API_KEY` (или `undefined`)
 * @param values - дополнительные переменные окружения (перекрывают apiKey)
 * @returns заглушка ConfigService
 */
function configStub(
  apiKey?: string,
  values: Record<string, string | undefined> = {},
): ConfigService {
  return {
    get: (key: string) => (key in values ? values[key] : apiKey),
  } as unknown as ConfigService;
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

  describe('KI-414: prompt caching', () => {
    /** Короткий ответ SDK: тестам важен только body запроса. */
    const ANSWER = {
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: 'ок' }],
    };

    beforeEach(() => {
      createMock.mockResolvedValue(ANSWER);
    });

    /**
     * Возвращает `system` из тела последнего запроса SDK.
     *
     * @returns поле `system` запроса
     */
    function lastSystem(): unknown {
      const call = createMock.mock.calls.at(-1);

      if (!call) {
        throw new Error('messages.create не вызывался');
      }

      return (call[0] as { system?: unknown }).system;
    }

    it('длинный system + promptCache=true → блок с cache_control ephemeral', async () => {
      const system = 's'.repeat(1025);
      const provider = new AnthropicProvider(configStub('sk-ant-test'));

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        system,
        promptCache: true,
      });

      expect(lastSystem()).toEqual([
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ]);
    });

    it('без promptCache длинный system остаётся строкой (поведение до R7.7)', async () => {
      const system = 's'.repeat(1025);
      const provider = new AnthropicProvider(configStub('sk-ant-test'));

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        system,
      });

      expect(lastSystem()).toBe(system);
    });

    it('promptCache=false оставляет system строкой', async () => {
      const system = 's'.repeat(1025);
      const provider = new AnthropicProvider(configStub('sk-ant-test'));

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        system,
        promptCache: false,
      });

      expect(lastSystem()).toBe(system);
    });

    it('короткий system не кэшируется даже при promptCache=true', async () => {
      const system = 's'.repeat(1024);
      const provider = new AnthropicProvider(configStub('sk-ant-test'));

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        system,
        promptCache: true,
      });

      // Порог строгий: `length > 1024`, ровно 1024 — ещё не кэш.
      expect(lastSystem()).toBe(system);
    });

    it('PROMPT_CACHE_MIN_TOKENS из env перекрывает дефолт 1024', async () => {
      const system = 's'.repeat(1500);
      const provider = new AnthropicProvider(
        configStub('sk-ant-test', { PROMPT_CACHE_MIN_TOKENS: '2048' }),
      );

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        system,
        promptCache: true,
      });

      // 1500 < 2048 — кэш не включается.
      expect(lastSystem()).toBe(system);
    });

    it('мусор в PROMPT_CACHE_MIN_TOKENS не ломает вызов — берётся дефолт', async () => {
      const system = 's'.repeat(1025);
      const provider = new AnthropicProvider(
        configStub('sk-ant-test', { PROMPT_CACHE_MIN_TOKENS: 'не-число' }),
      );

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        system,
        promptCache: true,
      });

      expect(lastSystem()).toEqual([
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ]);
    });

    it('без system поле не передаётся даже при promptCache=true', async () => {
      const provider = new AnthropicProvider(configStub('sk-ant-test'));

      await provider.generateAsync('вопрос', {
        model: 'claude-sonnet-4-20250514',
        promptCache: true,
      });

      expect(lastSystem()).toBeUndefined();
    });
  });

  it('KI-414: Anthropic парсит cache_creation_input_tokens и cache_read_input_tokens', async () => {
    createMock.mockResolvedValue({
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 100,
        output_tokens: 5,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 300,
      },
      content: [{ type: 'text', text: 'ответ' }],
    });

    const provider = new AnthropicProvider(configStub('sk-ant-test'));
    const result = await provider.generateAsync('x', { model: 'm' });

    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 5,
      // Кэш-токены Anthropic не входят в input_tokens — флаг false нужен
      // расчётчику стоимости (model-pricing.ts).
      cacheReadTokens: 2000,
      cacheCreationTokens: 300,
      cacheTokensIncludedInInput: false,
      model: 'claude-sonnet-4-20250514',
    });
  });

  it('isConfigured отражает наличие ключа (KI-039)', () => {
    expect(new AnthropicProvider(configStub('sk-ant-test')).isConfigured).toBe(true);
    expect(new AnthropicProvider(configStub(undefined)).isConfigured).toBe(false);
  });

  it('KI-500: клиент создан с maxRetries: 0 — повторы только у движка', () => {
    new AnthropicProvider(configStub('sk-ant-test'));

    expect(constructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-ant-test',
      maxRetries: 0,
    });
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

  it('v0.11 S10: переносит Retry-After из заголовков SDK в retryAfterMs', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('rate limited'), {
        status: 429,
        // SDK кладёт заголовки ответа в `error.headers` (fetch Headers).
        headers: new Headers({ 'retry-after': '2' }),
      }),
    );

    const provider = new AnthropicProvider(configStub('sk-ant-test'));
    const error = await catchGenerateError(provider);

    expect(error).toBeInstanceOf(LlmProviderException);
    expect((error as LlmProviderException).retryAfterMs).toBe(2_000);
  });

  it('v0.11 S10: заголовки словарём тоже читаются (совместимость SDK)', async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error('rate limited'), {
        status: 429,
        headers: { 'retry-after': '1' },
      }),
    );

    const provider = new AnthropicProvider(configStub('sk-ant-test'));
    const error = await catchGenerateError(provider);

    expect((error as LlmProviderException).retryAfterMs).toBe(1_000);
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
