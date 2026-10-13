import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LlmProviderException } from './llm-provider.interface.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';
import { OpenAiProvider } from './providers/openai.provider.js';

/**
 * Создаёт заглушку `ConfigService` с заданными значениями.
 *
 * @param keys - карта «имя переменной → значение»
 * @returns заглушка ConfigService для конструкторов провайдеров
 */
function configStub(keys: Record<string, string>): ConfigService {
  return { get: (key: string) => keys[key] } as unknown as ConfigService;
}

/** Оба ключа заданы — «всё сконфигурировано». */
const ALL_KEYS: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  OPENAI_API_KEY: 'sk-test',
};

/**
 * Создаёт провайдеров с заданными ключами.
 *
 * @param keys - карта «имя переменной → значение»
 * @returns пара «Anthropic + OpenAI»
 */
function createProviders(keys: Record<string, string>): {
  anthropic: AnthropicProvider;
  openai: OpenAiProvider;
} {
  return {
    anthropic: new AnthropicProvider(configStub(keys)),
    openai: new OpenAiProvider(configStub(keys)),
  };
}

/**
 * Собирает реестр на заданных провайдерах.
 *
 * @param anthropicProvider - провайдер Anthropic
 * @param openAiProvider - провайдер OpenAI
 * @returns экземпляр реестра
 */
async function createRegistry(
  anthropicProvider: AnthropicProvider,
  openAiProvider: OpenAiProvider,
): Promise<LlmRegistryService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      LlmRegistryService,
      { provide: AnthropicProvider, useValue: anthropicProvider },
      { provide: OpenAiProvider, useValue: openAiProvider },
    ],
  }).compile();

  return moduleRef.get(LlmRegistryService);
}

describe('LlmRegistryService', () => {
  let registry: LlmRegistryService;
  let anthropic: AnthropicProvider;
  let openai: OpenAiProvider;

  beforeEach(async () => {
    // Провайдеры создаются с фейковыми ключами: SDK-клиент в конструкторе
    // сеть не трогает, реальных HTTP-вызовов в юнит-тестах нет.
    const providers = createProviders(ALL_KEYS);

    anthropic = providers.anthropic;
    openai = providers.openai;
    registry = await createRegistry(anthropic, openai);
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

  it('бросает LlmProviderException на неизвестную модель', () => {
    expect(() => registry.resolveByModel('unknown-model')).toThrow(LlmProviderException);
    expect(() => registry.resolveByModel('unknown-model')).toThrow(
      'Модель не поддерживается',
    );
  });

  it('listModels возвращает модели обоих провайдеров', () => {
    expect(registry.listModels()).toEqual([
      { provider: 'anthropic', id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
      },
      { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o' },
      { provider: 'openai', id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ]);
  });

  it('listModels скрывает модели провайдера без API-ключа (KI-039)', async () => {
    const providers = createProviders({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const local = await createRegistry(providers.anthropic, providers.openai);

    expect(providers.openai.isConfigured).toBe(false);
    expect(local.listModels()).toEqual([
      { provider: 'anthropic', id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
      },
    ]);
  });

  it('listModels возвращает пустой список, если ключей нет вовсе (KI-039)', async () => {
    const providers = createProviders({});
    const local = await createRegistry(providers.anthropic, providers.openai);

    expect(providers.anthropic.isConfigured).toBe(false);
    expect(providers.openai.isConfigured).toBe(false);
    expect(local.listModels()).toEqual([]);
  });

  it('resolveByModel не зависит от конфигурации: ошибка всплывает на вызове (KI-039)', async () => {
    const providers = createProviders({});
    const local = await createRegistry(providers.anthropic, providers.openai);

    // Резолв работает и без ключа: он отвечает только за маршрутизацию модели...
    const resolved = local.resolveByModel('claude-sonnet-4-20250514');

    expect(resolved).toBe(providers.anthropic);
    expect(resolved.isConfigured).toBe(false);

    // ...а понятная ошибка приходит на самом вызове, а не на resolve.
    await expect(
      resolved.generateAsync('привет', { model: 'claude-sonnet-4-20250514' }),
    ).rejects.toThrow('ANTHROPIC_API_KEY не задан');
  });
});
