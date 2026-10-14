import { Logger } from '@nestjs/common';
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

  it('объявляет у Anthropic модели с text+vision на входе (v0.6.0a)', () => {
    const anthropic = createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' })[0];

    expect(anthropic.models).toEqual([
      {
        id: 'claude-opus-4-20250514',
        label: 'Claude Opus 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('создаёт OpenAI-провайдера с ключом и дефолтным baseURL', () => {
    const openai = byName({ OPENAI_API_KEY: 'sk-test' }, 'openai');

    expect(openai?.name).toBe('openai');
    expect(openai?.models).toEqual([
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
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
    // KI-148: LM Studio крутится локально, стоимость вызова считается нулевой.
    expect(lmstudio?.isLocal).toBe(true);
    // Без суффикса модальностей модель считается текстовой (v0.6.0a).
    expect(lmstudio?.models).toEqual([
      {
        id: 'qwen2.5-7b-instruct',
        label: 'qwen2.5-7b-instruct (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'llama-3.3-70b',
        label: 'llama-3.3-70b (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('KI-148: облачные провайдеры не помечены локальными', () => {
    // Только LM Studio бесплатен: у остальных стоимость считается по прайсу.
    expect(byName({ OPENAI_API_KEY: 'sk-openai' }, 'openai')?.isLocal).toBe(false);
    expect(byName({ DEEPSEEK_API_KEY: 'sk-deepseek' }, 'deepseek')?.isLocal).toBe(false);
    expect(
      byName({ ANTHROPIC_API_KEY: 'sk-ant-test' }, 'anthropic')?.isLocal,
    ).toBeUndefined();
  });

  it('разбирает модальности LM Studio из суффикса (v0.6.0a)', () => {    const lmstudio = byName(
      {
        LMSTUDIO_MODELS:
          'qwen2.5-coder-7b-instruct:text,qwen/qwen2.5-vl-7b:text+vision',
      },
      'lmstudio',
    );

    expect(lmstudio?.models).toEqual([
      {
        id: 'qwen2.5-coder-7b-instruct',
        label: 'qwen2.5-coder-7b-instruct (local)',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'qwen/qwen2.5-vl-7b',
        label: 'qwen/qwen2.5-vl-7b (local)',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('пропускает модель LM Studio с неизвестной модальностью (v0.6.0a)', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const lmstudio = byName(
      { LMSTUDIO_MODELS: 'good-model:text,broken-model:foo' },
      'lmstudio',
    );

    // Невалидная запись пропускается, валидная остаётся: опечатка в env
    // не должна оставлять пользователя без провайдера целиком.
    expect(lmstudio?.models.map((model) => model.id)).toEqual(['good-model']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('broken-model неизвестная модальность "foo"'),
    );

    warn.mockRestore();
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
      {
        id: 'qwen3.6-35b-a3b/latest',
        label: 'Qwen3.6-35B (Yandex)',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('включает GPTunnel с ключом и списком моделей (v0.6.0b.1)', () => {
    const gptunnel = byName(
      {
        GPTUNNEL_API_KEY: 'sk-gptunnel',
        GPTUNNEL_MODELS:
          'claude-5.5-sonnet:text+vision,gpt-5.6-luna:text,deepseek-v4-flash',
      },
      'gptunnel',
    );

    expect(gptunnel?.isConfigured).toBe(true);
    // Подпись без суффикса: провайдер и так виден в UI отдельной группой.
    expect(gptunnel?.models).toEqual([
      {
        id: 'claude-5.5-sonnet',
        label: 'claude-5.5-sonnet',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        id: 'gpt-5.6-luna',
        label: 'gpt-5.6-luna',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
      {
        id: 'deepseek-v4-flash',
        label: 'deepseek-v4-flash',
        inputModalities: ['text'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('не включает GPTunnel без списка моделей (v0.6.0b.1)', () => {
    expect(createProviders({ GPTUNNEL_API_KEY: 'sk-gptunnel' })).toEqual([]);
    expect(
      createProviders({ GPTUNNEL_API_KEY: 'sk-gptunnel', GPTUNNEL_MODELS: '  ,  ' }),
    ).toEqual([]);
  });

  it('не включает GPTunnel без ключа, даже если список задан (v0.6.0b.1)', () => {
    expect(createProviders({ GPTUNNEL_MODELS: 'gpt-5.6-luna:text' })).toEqual([]);
  });

  it('берёт baseURL GPTunnel из окружения (v0.6.0b.1)', () => {
    byName(
      {
        GPTUNNEL_API_KEY: 'sk-gptunnel',
        GPTUNNEL_MODELS: 'gpt-5.6-luna',
        GPTUNNEL_BASE_URL: 'http://localhost:7777/v1',
      },
      'gptunnel',
    );

    expect(openAiConstructorMock).toHaveBeenCalledWith({
      apiKey: 'sk-gptunnel',
      baseURL: 'http://localhost:7777/v1',
    });
  });

  it('пропускает модель GPTunnel с неизвестной модальностью (v0.6.0b.1)', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const gptunnel = byName(
      {
        GPTUNNEL_API_KEY: 'sk-gptunnel',
        GPTUNNEL_MODELS: 'gpt-5.6-luna:text,broken-model:foo',
      },
      'gptunnel',
    );

    expect(gptunnel?.models.map((model) => model.id)).toEqual(['gpt-5.6-luna']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('GPTUNNEL_MODELS: у модели broken-model неизвестная модальность "foo"'),
    );

    warn.mockRestore();
  });

  it('работает с GPTunnel и RouterAI одновременно (v0.6.0b.1)', () => {
    const providers = createProviders({
      ROUTERAI_API_KEY: 'sk-router',
      GPTUNNEL_API_KEY: 'sk-gptunnel',
      GPTUNNEL_MODELS: 'gpt-5.6-luna:text',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'routerai',
      'gptunnel',
    ]);
  });

  it('ставит GPTunnel в приоритете после RouterAI (v0.6.0b.1)', () => {
    const providers = createProviders({
      ANTHROPIC_API_KEY: 'sk-ant',
      OPENAI_API_KEY: 'sk-openai',
      ROUTERAI_API_KEY: 'sk-router',
      GPTUNNEL_API_KEY: 'sk-gptunnel',
      GPTUNNEL_MODELS: 'gpt-5.6-luna:text',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      YANDEX_API_KEY: 'sk-yandex',
      LMSTUDIO_MODELS: 'qwen2.5-coder-7b-instruct:text',
    });

    expect(providers.map((provider) => provider.name)).toEqual([
      'anthropic',
      'openai',
      'routerai',
      'gptunnel',
      'deepseek',
      'yandex',
      'lmstudio',
    ]);
  });
});
