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
    // v1.2 S1: метод обязателен в контракте ILlmProvider.
    isAvailableAsync: vi.fn(() => Promise.resolve(true)),
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
    registry.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
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

  it('hasModel не бросает и отвечает только про известные id (v1.1.0 S4)', () => {
    // Нужно метрикам: model — label, произвольная строка из графа/llm_call
    // не должна создавать новую серию Prometheus.
    expect(registry.hasModel('claude-sonnet-4-20250514')).toBe(true);
    expect(registry.hasModel('gpt-4o')).toBe(true);
    expect(registry.hasModel('unknown-model')).toBe(false);
    expect(registry.hasModel('')).toBe(false);
    // Проверка не зависит от конфигурации провайдера: id объявлен в реестре.
    expect(registry.hasModel('claude-opus-4-20250514')).toBe(true);
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

  describe('возможности моделей (v1.3 S1, KI-617)', () => {
    it('getCapabilities отдаёт заполненный паспорт известной модели', () => {
      // Модели OpenAI в этом spec'е объявлены вручную без `maxTokens`:
      // неизвестный контекст нормализуется в 0, а не в undefined.
      expect(registry.getCapabilities('gpt-4o')).toEqual({
        id: 'gpt-4o',
        provider: 'openai',
        inputModalities: ['text', 'vision'],
        supportsReasoning: false,
        supportsTools: true,
        maxTokens: 0,
      });
      expect(registry.getCapabilities('claude-sonnet-4-20250514')).toEqual({
        id: 'claude-sonnet-4-20250514',
        provider: 'anthropic',
        inputModalities: ['text', 'vision'],
        supportsReasoning: false,
        supportsTools: true,
        maxTokens: 200_000,
      });
    });

    it('getCapabilities неизвестной модели — undefined, без исключения', () => {
      expect(registry.getCapabilities('unknown-model')).toBeUndefined();
      expect(registry.getCapabilities('')).toBeUndefined();
    });

    it('getCapabilities заполняет возможности и для «бедного» объявления', async () => {
      const local = await createRegistry([stubProvider('stub', ['plain'])]);

      expect(local.getCapabilities('plain')).toEqual({
        id: 'plain',
        provider: 'stub',
        inputModalities: ['text'],
        supportsReasoning: false,
        supportsTools: true,
        maxTokens: 0,
      });
    });

    it('findCompatibleRoute учитывает модальности и область поиска', async () => {
      const localProvider = stubProvider('lmstudio', ['text-local']);
      const localProviderWithFlag: ILlmProvider = {
        ...localProvider,
        isLocal: true,
      };
      const local = await createRegistry([localProviderWithFlag, openai]);

      const visionRequirements = {
        inputModalities: ['text', 'vision'] as const,
        requiresReasoning: false,
        requiresTools: false,
        minTokens: 0,
      };

      // Локальная модель текстовая — для vision-требований не подходит.
      expect(
        local.findCompatibleRoute(visionRequirements, { local: true }),
      ).toBeUndefined();
      // В облаке есть gpt-4o с vision — он и должен быть выбран.
      expect(
        local.findCompatibleRoute(visionRequirements, { local: false })?.model.id,
      ).toBe('gpt-4o');
    });

    it('findCompatibleRoute пропускает неконфигурированных провайдеров', async () => {
      const providers = createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });
      const local = await createRegistry([providers.openai, providers.anthropic]);

      const textRequirements = {
        inputModalities: ['text'] as const,
        requiresReasoning: false,
        requiresTools: true,
        minTokens: 0,
      };
      const route = local.findCompatibleRoute(textRequirements, { local: false });

      // OpenAI без ключа не должен выигрывать у сконфигурированного Anthropic.
      expect(route?.provider.name).toBe('anthropic');
    });

    it('findCompatibleRoute учитывает tool-calling', async () => {
      const noTools: ILlmProvider = {
        ...stubProvider('no-tools', ['no-tools-model']),
        models: [
          {
            id: 'no-tools-model',
            label: 'no-tools-model',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsTools: false,
          },
        ],
      };
      const local = await createRegistry([noTools, openai]);

      const toolsRequirements = {
        inputModalities: ['text'] as const,
        requiresReasoning: false,
        requiresTools: true,
        minTokens: 0,
      };

      expect(
        local.findCompatibleRoute(toolsRequirements, { local: false })?.model.id,
      ).toBe('gpt-4o');
    });
  });

  describe('in-memory cache (KI-113)', () => {
    it('listModels повторно отдаёт тот же массив в пределах TTL', () => {
      const first = registry.listModels();
      const second = registry.listModels();

      expect(second).toBe(first);
    });

    it('listModels пересобирается после 5 минут', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const first = registry.listModels();

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const second = registry.listModels();

      expect(second).not.toBe(first);
      expect(second).toEqual(first);
    });

    it('clearCache сбрасывает список и паспорта моделей', () => {
      const firstModels = registry.listModels();
      const firstCapabilities = registry.getCapabilities('gpt-4o');

      registry.clearCache();

      expect(registry.listModels()).not.toBe(firstModels);
      expect(registry.getCapabilities('gpt-4o')).not.toBe(firstCapabilities);
    });

    it('getCapabilities кэшируется по id модели', () => {
      const first = registry.getCapabilities('gpt-4o');

      expect(registry.getCapabilities('gpt-4o')).toBe(first);
      // Неизвестная модель тоже кэшируется — повторный поиск не нужен.
      expect(registry.getCapabilities('unknown')).toBeUndefined();
      expect(registry.getCapabilities('unknown')).toBeUndefined();
    });
  });
});
