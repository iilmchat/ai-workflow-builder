import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { LlmProviderException, type ILlmProvider } from './llm-provider.interface.js';
import { LLM_PROVIDERS, LlmRegistryService } from './llm-registry.service.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';

// Клиенты SDK в тестах реестра не нужны: подменяем оба (RULES: без сети).
vi.mock('openai', () => ({
  default: class MockOpenAI {
    readonly chat = { completions: { create: vi.fn() } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    readonly messages = { create: vi.fn() };
  },
}));

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * @param keys - карта «имя переменной → значение»
 * @returns заглушка ConfigService для конструкторов провайдеров
 */
function configStub(keys: Record<string, string>): ConfigService {
  return { get: (key: string) => keys[key] } as unknown as ConfigService;
}

/** Оба «нативных» ключа заданы — Anthropic и OpenAI сконфигурированы. */
const ALL_KEYS: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  OPENAI_API_KEY: 'sk-test',
};

/**
 * Создаёт провайдеров с заданными ключами.
 *
 * @param keys - карта «имя переменной → значение»
 * @returns пара «Anthropic + OpenAI-совместимый»
 */
function createProviders(keys: Record<string, string>): {
  anthropic: AnthropicProvider;
  openai: OpenAiCompatibleProvider;
} {
  return {
    anthropic: new AnthropicProvider(configStub(keys)),
    openai: new OpenAiCompatibleProvider({
      name: 'openai',
      apiKey: keys.OPENAI_API_KEY ?? '',
      baseURL: 'https://api.openai.com/v1',
      models: [
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
      ],
      envKey: 'OPENAI_API_KEY',
    }),
  };
}

/**
 * Собирает реестр на переданном списке провайдеров.
 *
 * @param providers - провайдеры в порядке приоритета
 * @returns экземпляр реестра
 */
async function createRegistry(
  providers: ILlmProvider[],
): Promise<LlmRegistryService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      LlmRegistryService,
      { provide: LLM_PROVIDERS, useValue: providers },
    ],
  }).compile();

  return moduleRef.get(LlmRegistryService);
}

/**
 * Создаёт минимального провайдера-заглушку для проверки конфликтов id моделей.
 *
 * @param name - идентификатор провайдера
 * @param modelIds - id моделей, которые он объявляет
 * @returns провайдер-заглушка
 */
function stubProvider(name: string, modelIds: string[]): ILlmProvider {
  return {
    name,
    models: modelIds.map((id) => ({
      id,
      label: id,
      // KI-317: модальности обязательны в ModelInfo — заглушке достаточно текста.
      inputModalities: ['text'],
      outputModalities: ['text'],
    })),
    isConfigured: true,
    generateAsync: vi.fn(),
    // R7.4a: метод обязателен в контракте ILlmProvider.
    embedAsync: vi.fn(),
  };
}

describe('LlmRegistryService', () => {
  let registry: LlmRegistryService;
  let anthropic: AnthropicProvider;
  let openai: OpenAiCompatibleProvider;

  beforeEach(async () => {
    // Провайдеры создаются с фейковыми ключами: SDK-клиент в конструкторе
    // сеть не трогает, реальных HTTP-вызовов в юнит-тестах нет.
    const providers = createProviders(ALL_KEYS);

    anthropic = providers.anthropic;
    openai = providers.openai;
    registry = await createRegistry([anthropic, openai]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('находит Anthropic по id модели claude-*', () => {
    expect(registry.resolveByModel('claude-sonnet-4-20250514')).toBe(anthropic);
    expect(registry.resolveByModel('claude-opus-4-20250514')).toBe(anthropic);
  });

  it('находит OpenAI по id модели gpt-*', () => {
    expect(registry.resolveByModel('gpt-4o')).toBe(openai);
    expect(registry.resolveByModel('gpt-4o-mini')).toBe(openai);
  });

  it('находит модель у любого провайдера из массива (v0.5.0)', async () => {
    const routerai = new OpenAiCompatibleProvider({
      name: 'routerai',
      apiKey: 'sk-router',
      baseURL: 'https://routerai.ru/api/v1',
      // KI-317: модальности обязательны в ModelInfo.
      models: [
        {
          id: 'anthropic/claude-sonnet-4',
          label: 'Claude Sonnet 4 (RouterAI)',
          inputModalities: ['text'],
          outputModalities: ['text'],
        },
      ],
      envKey: 'ROUTERAI_API_KEY',
    });

    const local = await createRegistry([anthropic, openai, routerai]);

    expect(local.resolveByModel('anthropic/claude-sonnet-4')).toBe(routerai);
    // Провайдеры не перекрывают друг друга: native-модель остаётся у Anthropic.
    expect(local.resolveByModel('claude-sonnet-4-20250514')).toBe(anthropic);
  });

  it('бросает LlmProviderException на неизвестную модель', () => {
    expect(() => registry.resolveByModel('unknown-model')).toThrow(LlmProviderException);
    expect(() => registry.resolveByModel('unknown-model')).toThrow(
      'Модель не поддерживается',
    );
  });

  it('listModels возвращает модели обоих провайдеров с модальностями', () => {
    expect(registry.listModels()).toEqual([
      {
        provider: 'anthropic',
        id: 'claude-opus-4-20250514',
        label: 'Claude Opus 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        provider: 'openai',
        id: 'gpt-4o',
        label: 'GPT-4o',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        provider: 'openai',
        id: 'gpt-4o-mini',
        label: 'GPT-4o mini',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('listModels скрывает модели провайдера без API-ключа (KI-039)', async () => {
    const providers = createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const local = await createRegistry([providers.anthropic, providers.openai]);

    expect(providers.openai.isConfigured).toBe(false);
    expect(local.listModels()).toEqual([
      {
        provider: 'anthropic',
        id: 'claude-opus-4-20250514',
        label: 'Claude Opus 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        inputModalities: ['text', 'vision'],
        outputModalities: ['text'],
      },
    ]);
  });

  it('listModels возвращает пустой список, если ключей нет вовсе (KI-039)', async () => {
    const providers = createProviders({});
    const local = await createRegistry([providers.anthropic, providers.openai]);

    expect(providers.anthropic.isConfigured).toBe(false);
    expect(providers.openai.isConfigured).toBe(false);
    expect(local.listModels()).toEqual([]);
  });

  it('resolveByModel не зависит от конфигурации: ошибка всплывает на вызове (KI-039)', async () => {
    const providers = createProviders({});
    const local = await createRegistry([providers.anthropic, providers.openai]);

    // Резолв работает и без ключа: он отвечает только за маршрутизацию модели...
    const resolved = local.resolveByModel('claude-sonnet-4-20250514');

    expect(resolved).toBe(providers.anthropic);
    expect(resolved.isConfigured).toBe(false);

    // ...а понятная ошибка приходит на самом вызове, а не на resolve.
    await expect(
      resolved.generateAsync('привет', { model: 'claude-sonnet-4-20250514' }),
    ).rejects.toThrow('ANTHROPIC_API_KEY не задан');
  });

  it('при конфликте id побеждает первый провайдер и пишется warning (v0.5.0)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const first = stubProvider('first', ['shared-model']);
    const second = stubProvider('second', ['shared-model']);

    const local = await createRegistry([first, second]);

    // Решение: первый в массиве выигрывает — маршрутизация детерминирована.
    expect(local.resolveByModel('shared-model')).toBe(first);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Модель shared-model объявлена у провайдеров first и second'),
    );
  });

  it('не пишет warning, когда конфликтов нет', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const first = stubProvider('first', ['a']);
    const second = stubProvider('second', ['b']);

    const local = await createRegistry([first, second]);

    expect(local.resolveByModel('a')).toBe(first);
    expect(local.resolveByModel('b')).toBe(second);
    expect(warn).not.toHaveBeenCalled();
  });

  it('работает с пустым списком провайдеров', async () => {
    const local = await createRegistry([]);

    expect(local.listModels()).toEqual([]);
    expect(() => local.resolveByModel('gpt-4o')).toThrow('Модель не поддерживается');
  });
});
