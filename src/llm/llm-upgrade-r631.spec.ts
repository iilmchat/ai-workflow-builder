import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import type { ModelInfo } from './llm-provider.interface.js';
import { LlmProviderFactory } from './llm-provider.factory.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { LlmService } from './llm.service.js';
import { LlmNodeExecutor } from './llm-node-executor.service.js';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider.js';
import { AnthropicProvider } from './providers/anthropic.provider.js';

const { openAiCreateMock, anthropicCreateMock } = vi.hoisted(() => ({
  openAiCreateMock: vi.fn(),
  anthropicCreateMock: vi.fn(),
}));

// Реальные SDK не вызываются: клиенты подменяются целиком (без сети).
vi.mock('openai', () => ({
  default: class MockOpenAi {
    readonly chat = { completions: { create: openAiCreateMock } };
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    readonly messages = { create: anthropicCreateMock };
  },
}));

/** Ответ OpenAI-совместимого провайдера с непустым content. */
const OPENAI_ANSWER = {
  choices: [{ finish_reason: 'stop', message: { content: 'ответ' } }],
  usage: { prompt_tokens: 3, completion_tokens: 5 },
};

/** Ответ Anthropic с одним text-блоком. */
const ANTHROPIC_ANSWER = {
  content: [{ type: 'text', text: 'ответ' }],
  usage: { input_tokens: 3, output_tokens: 5 },
};

/**
 * Собирает заглушку ConfigService для фабрики (значения по ключам).
 *
 * @param values - значения переменных окружения
 * @returns заглушка ConfigService
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/**
 * Собирает заглушку ConfigService с одним ключом (для AnthropicProvider).
 *
 * @param apiKey - значение `ANTHROPIC_API_KEY` (или `undefined`)
 * @returns заглушка ConfigService
 */
function apiKeyConfigStub(apiKey?: string): ConfigService {
  return { get: () => apiKey } as unknown as ConfigService;
}

/**
 * Возвращает тело запроса, с которым SDK вызвал Chat Completions.
 *
 * @param callIndex - индекс вызова (по умолчанию первый)
 * @returns тело запроса
 */
function openAiBody(callIndex = 0): Record<string, unknown> {
  const call = openAiCreateMock.mock.calls[callIndex];

  if (!call) {
    throw new Error(`chat.completions.create не вызывался (index=${callIndex})`);
  }

  return call[0] as Record<string, unknown>;
}

/**
 * Создаёт провайдеров из env-значений (публичный путь парсера моделей).
 *
 * @param values - переменные окружения
 * @returns список провайдеров
 */
async function createProviders(
  values: Record<string, string | undefined>,
): Promise<Awaited<ReturnType<LlmProviderFactory['createProvidersAsync']>>> {
  return new LlmProviderFactory(configStub(values)).createProvidersAsync();
}

/**
 * Создаёт OpenAI-совместимый провайдер с заданными моделями.
 *
 * @param models - декларации моделей
 * @returns провайдер под тестом
 */
function openAiProvider(
  models: Array<{
    id: string;
    label: string;
    supportsReasoning?: boolean;
    defaultMaxTokens?: number;
  }>,
): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    name: 'openai',
    apiKey: 'sk-test',
    baseURL: 'https://api.openai.com/v1',
    // KI-317: в фикстурах важны только id/label/reasoning, но ModelInfo
    // требует модальности — дополняем их текстовым дефолтом.
    models: models.map(
      (model): ModelInfo => ({
        ...model,
        inputModalities: ['text'],
        outputModalities: ['text'],
      }),
    ),
    envKey: 'OPENAI_API_KEY',
  });
}

describe('R6.3.1 — парсер env-моделей (суффикс :reasoning)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('модель без суффикса — обычная, лимит модели не задан (берётся дефолт провайдера)', async () => {
    const providers = await createProviders({
      GPTUNNEL_API_KEY: 'sk-test',
      GPTUNNEL_MODELS: 'gpt-5.6-luna:text',
    });
    const [model] = providers[0]?.models ?? [];

    expect(model?.supportsReasoning).toBeFalsy();
    expect(model?.defaultMaxTokens).toBeUndefined();
  });

  it('суффикс :reasoning без модальностей — reasoning-модель, maxTokens=4096', async () => {
    const providers = await createProviders({
      GPTUNNEL_API_KEY: 'sk-test',
      GPTUNNEL_MODELS: 'deepseek-v4-flash:reasoning',
    });
    const [model] = providers[0]?.models ?? [];

    expect(model?.supportsReasoning).toBe(true);
    expect(model?.defaultMaxTokens).toBe(4096);
    expect(model?.inputModalities).toEqual(['text']);
  });

  it('суффикс :reasoning после модальностей сохраняет модальности', async () => {
    const providers = await createProviders({
      GPTUNNEL_API_KEY: 'sk-test',
      GPTUNNEL_MODELS: 'qwen3.8-max:text+vision:reasoning',
    });
    const [model] = providers[0]?.models ?? [];

    expect(model?.supportsReasoning).toBe(true);
    expect(model?.defaultMaxTokens).toBe(4096);
    expect(model?.inputModalities).toEqual(['text', 'vision']);
  });

  it('смешанный список: обычная и reasoning модели в одном env', async () => {
    const providers = await createProviders({
      GPTUNNEL_API_KEY: 'sk-test',
      GPTUNNEL_MODELS: 'claude-5.5-sonnet:text+vision,deepseek-v4-flash:text:reasoning',
    });
    const models = providers[0]?.models ?? [];

    expect(models).toHaveLength(2);
    expect(models[0]?.supportsReasoning).toBeFalsy();
    expect(models[1]?.supportsReasoning).toBe(true);
  });
});

describe('R6.3.1 — OpenAI-совместимый провайдер', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openAiCreateMock.mockResolvedValue(OPENAI_ANSWER);
  });

  it('systemPrompt уходит первым сообщением с ролью system', async () => {
    const provider = openAiProvider([{ id: 'gpt-4o', label: 'GPT-4o' }]);

    await provider.generateAsync('вопрос', {
      model: 'gpt-4o',
      system: 'Отвечай кратко',
    });

    const body = openAiCreateMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.messages).toEqual([
      { role: 'system', content: 'Отвечай кратко' },
      { role: 'user', content: 'вопрос' },
    ]);
  });

  it('без system в messages только пользовательское сообщение', async () => {
    const provider = openAiProvider([{ id: 'gpt-4o', label: 'GPT-4o' }]);

    await provider.generateAsync('вопрос', { model: 'gpt-4o' });

    const body = openAiCreateMock.mock.calls[0]?.[0] as {
      messages: Array<{ role: string }>;
    };

    expect(body.messages).toEqual([{ role: 'user', content: 'вопрос' }]);
  });

  it('maxTokens override перекрывает defaultMaxTokens модели', async () => {
    const provider = openAiProvider([
      { id: 'gpt-4o', label: 'GPT-4o', defaultMaxTokens: 4096 },
    ]);

    await provider.generateAsync('x', { model: 'gpt-4o', maxTokens: 256 });

    expect(openAiBody().max_completion_tokens).toBe(256);
  });

  it('без override берётся defaultMaxTokens модели', async () => {
    const provider = openAiProvider([
      { id: 'gpt-4o', label: 'GPT-4o', defaultMaxTokens: 4096 },
    ]);

    await provider.generateAsync('x', { model: 'gpt-4o' });

    expect(openAiBody().max_completion_tokens).toBe(4096);
  });

  it('reasoning_effort передаётся только модели с supportsReasoning', async () => {
    const reasoning = openAiProvider([
      { id: 'r1', label: 'R1', supportsReasoning: true },
    ]);
    const plain = openAiProvider([{ id: 'p1', label: 'P1' }]);

    await reasoning.generateAsync('x', { model: 'r1', reasoningEffort: 'high' });
    await plain.generateAsync('x', { model: 'p1', reasoningEffort: 'high' });

    expect(openAiBody(0).reasoning_effort).toBe('high');
    expect(openAiBody(1)).not.toHaveProperty('reasoning_effort');
  });

  it('reasoningEffort=off не отправляет поле даже для reasoning-модели', async () => {
    const provider = openAiProvider([
      { id: 'r1', label: 'R1', supportsReasoning: true },
    ]);

    await provider.generateAsync('x', { model: 'r1', reasoningEffort: 'off' });

    expect(openAiCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('reasoning_effort');
  });
});

describe('R6.3.1 — Anthropic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    anthropicCreateMock.mockResolvedValue(ANTHROPIC_ANSWER);
  });

  it('system уходит отдельным полем, maxTokens — в max_tokens', async () => {
    const provider = new AnthropicProvider(apiKeyConfigStub('sk-ant-test'));

    await provider.generateAsync('вопрос', {
      model: 'claude-sonnet-4-20250514',
      system: 'Отвечай кратко',
      maxTokens: 777,
    });

    const body = anthropicCreateMock.mock.calls[0]?.[0] as {
      system: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };

    expect(body.system).toBe('Отвечай кратко');
    expect(body.max_tokens).toBe(777);
    expect(body.messages).toEqual([{ role: 'user', content: 'вопрос' }]);
  });

  it('reasoningEffort не ломает вызов (extended thinking — v0.8.x)', async () => {
    const provider = new AnthropicProvider(apiKeyConfigStub('sk-ant-test'));

    const result = await provider.generateAsync('вопрос', {
      model: 'claude-sonnet-4-20250514',
      reasoningEffort: 'high',
    });

    expect(result.text).toBe('ответ');
    expect(anthropicCreateMock.mock.calls[0]?.[0]).not.toHaveProperty('thinking');
  });
});

describe('R6.3.1 — реестр отдаёт признаки reasoning в /llm/models', () => {
  it('supportsReasoning и defaultMaxTokens попадают в listModels, обычная модель — без них', () => {
    const provider = openAiProvider([
      { id: 'r1', label: 'R1', supportsReasoning: true, defaultMaxTokens: 4096 },
      { id: 'p1', label: 'P1' },
    ]);
    const models = new LlmRegistryService([provider]).listModels();

    expect(models[0]).toMatchObject({
      id: 'r1',
      supportsReasoning: true,
      defaultMaxTokens: 4096,
    });
    expect(models[1]).not.toHaveProperty('supportsReasoning');
    expect(models[1]).not.toHaveProperty('defaultMaxTokens');
  });
});

describe('R6.3.1 — LlmNodeExecutor читает настройки из data', () => {
  let executor: LlmNodeExecutor;
  const generateMock = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    generateMock.mockResolvedValue({
      text: 'ок',
      usage: { inputTokens: 1, outputTokens: 2, model: 'm1' },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmNodeExecutor,
        { provide: LlmService, useValue: { generateAsync: generateMock } },
        // R7.1 (KI-048): предохранитель по стоимости — в этих тестах `runId`
        // не передаётся, поэтому заглушка не вызывается.
        {
          provide: CostBudgetService,
          useValue: { assertWithinBudgetAsync: vi.fn(() => Promise.resolve()) },
        },
      ],
    }).compile();

    executor = moduleRef.get(LlmNodeExecutor);
  });

  /**
   * Собирает llm-узел с заданным `data`.
   *
   * @param data - поля узла
   * @returns узел графа
   */
  function llmNode(data: Record<string, unknown>): NodeDto {
    return {
      id: 'n1',
      type: 'llm',
      data,
    } as unknown as NodeDto;
  }

  it('systemPrompt и maxTokensOverride уходят в options', async () => {
    await executor.executeAsync(
      llmNode({
        model: 'm1',
        prompt: 'вопрос',
        systemPrompt: 'Отвечай кратко',
        maxTokensOverride: 2048,
      }),
      {},
    );

    expect(generateMock).toHaveBeenCalledWith(
      'вопрос',
      'm1',
      expect.objectContaining({ system: 'Отвечай кратко', maxTokens: 2048 }),
    );
  });

  it('reasoningEffort из data уходит в options, мусор игнорируется', async () => {
    await executor.executeAsync(
      llmNode({ model: 'm1', prompt: 'x', reasoningEffort: 'medium' }),
      {},
    );
    await executor.executeAsync(
      llmNode({ model: 'm1', prompt: 'x', reasoningEffort: 'ultra' }),
      {},
    );

    expect(generateMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ reasoningEffort: 'medium' }),
    );
    expect(generateMock.mock.calls[1]?.[2]).not.toHaveProperty('reasoningEffort');
  });

  it('data.system остаётся совместимым источником system prompt', async () => {
    await executor.executeAsync(
      llmNode({ model: 'm1', prompt: 'x', system: 'старое поле' }),
      {},
    );

    expect(generateMock.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ system: 'старое поле' }),
    );
  });
});
