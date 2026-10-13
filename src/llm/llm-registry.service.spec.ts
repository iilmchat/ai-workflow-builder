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

describe('LlmRegistryService', () => {
  let registry: LlmRegistryService;
  let anthropic: AnthropicProvider;
  let openai: OpenAiProvider;

  beforeEach(async () => {
    // Провайдеры создаются с фейковыми ключами: SDK-клиент в конструкторе
    // сеть не трогает, реальных HTTP-вызовов в юнит-тестах нет.
    anthropic = new AnthropicProvider(configStub({ ANTHROPIC_API_KEY: 'sk-ant-test' }));
    openai = new OpenAiProvider(configStub({ OPENAI_API_KEY: 'sk-test' }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmRegistryService,
        { provide: AnthropicProvider, useValue: anthropic },
        { provide: OpenAiProvider, useValue: openai },
      ],
    }).compile();

    registry = moduleRef.get(LlmRegistryService);
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
});
