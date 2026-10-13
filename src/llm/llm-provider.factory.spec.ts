import { ConfigService } from '@nestjs/config';
import { LlmProviderFactory } from './llm-provider.factory.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

const { openAiConstructorMock } = vi.hoisted(() => ({
  openAiConstructorMock: vi.fn(),
}));

// Конструкторы провайдеров создают клиенты SDK. В юнит-тестах сеть не нужна,
// поэтому оба SDK подменены заглушками (RULES: никаких сетевых вызовов).
// Опции конструктора OpenAI запоминаем, чтобы проверить выбор baseURL.
vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = { completions: { create: vi.fn() } };

    constructor(options: unknown) {
      openAiConstructorMock(options);
    }
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    readonly messages = { create: vi.fn() };

    constructor() {
      // См. выше.
    }
  },
}));

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * @param values - карта «имя переменной → значение»
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Собирает фабрику на заданном окружении и возвращает созданных провайдеров.
 *
 * @param values - переменные окружения
 * @returns провайдеры в порядке приоритета
 */
function createProviders(values: Record<string, string | undefined>) {
  return new LlmProviderFactory(configStub(values)).createProviders();
}

/**
 * Возвращает OpenAI-совместимого провайдера с нужным именем.
 *
 * @param values - переменные окружения
 * @param name - идентификатор провайдера
 * @returns провайдер или `undefined`
 */
function byName(
  values: Record<string, string | undefined>,
  name: string,
): OpenAiCompatibleProvider | undefined {
  const provider = createProviders(values).find((item) => item.name === name);

  return provider instanceof OpenAiCompatibleProvider ? provider : undefined;
}

describe('LlmProviderFactory', () => {
  it('возвращает пустой список, если не задан ни один ключ', () => {
    expect(createProviders({})).toEqual([]);
  });

  it('включает только Anthropic, когда задан только его ключ', () => {
    const providers = createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(providers.map((provider) => provider.name)).toEqual(['anthropic']);
  });

  it('создаёт OpenAI-провайдера с ключом и дефолтным baseURL', () => {
    const openai = byName({ OPENAI_API_KEY: 'sk-test' }, 'openai');

    expect(openai?.name).toBe('openai');
    expect(openai?.models).toEqual([
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ]);
    expect(openai?.isConfigured).toBe(true);
  });

  it('работает с OpenAI и RouterAI одновременно (v0.5.0)', () => {
    const providers = createProviders({
      OPENAI_API_KEY: 'sk-test',
      ROUTERAI_API_KEY: 'sk-router',
    });

    expect(providers.map((provider) => provider.name)).toEqual(['openai', 'routerai']);

    const routerai = byName({ ROUTERAI_API_KEY: 'sk-router' }, 'routerai');

    expect(routerai?.models.map((model) => model.id)).toContain(
      'anthropic/claude-sonnet-4',
    );
  });

  it('включает LM Studio без ключа, если задан список моделей', () => {
    const lmstudio = byName(
      { LMSTUDIO_MODELS: 'qwen2.5-7b-instruct, llama-3.3-70b' },
      'lmstudio',
    );

    expect(lmstudio?.isConfigured).toBe(true);
    expect(lmstudio?.models).toEqual([
      { id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct (local)' },
      { id: 'llama-3.3-70b', label: 'llama-3.3-70b (local)' },
    ]);
  });

  it('не включает LM Studio без списка моделей', () => {
    expect(createProviders({ LMSTUDIO_MODELS: '' })).toEqual([]);
    expect(createProviders({ LMSTUDIO_MODELS: '  ,  ' })).toEqual([]);
  });

  it('собирает всех провайдеров в порядке приоритета', () => {
    const providers = createProviders({
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-openai',
      ROUTERAI_API_KEY: 'sk-router',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      YANDEX_API_KEY: 'sk-yandex',
      LMSTUDIO_MODELS: 'qwen2.5-7b-instruct',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'anthropic',
      'openai',
      'routerai',
      'deepseek',
      'yandex',
      'lmstudio',
    ]);
  });

  it('берёт baseURL провайдера из его переменной окружения', () => {
    byName(
      {
        DEEPSEEK_API_KEY: 'sk-deepseek',
        DEEPSEEK_BASE_URL: 'http://localhost:9999/v1',
      },
      'deepseek',
    );

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-deepseek',
      baseURL: 'http://localhost:9999/v1',
    });
  });

  it('подставляет дефолтный baseURL, если переменная не задана', () => {
    byName({ ROUTERAI_API_KEY: 'sk-router' }, 'routerai');

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-router',
      baseURL: 'https://routerai.ru/api/v1',
    });
  });

  it('включает Yandex с ключом', () => {
    const yandex = byName({ YANDEX_API_KEY: 'sk-yandex' }, 'yandex');

    expect(yandex?.models).toEqual([
      { id: 'qwen3.6-35b-a3b/latest', label: 'Qwen3.6-35B (Yandex)' },
    ]);
  });
});
