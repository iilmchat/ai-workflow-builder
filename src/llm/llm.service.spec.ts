import { Test } from '@nestjs/testing';
import {
  LlmProviderException,
  type ILlmProvider,
  type LlmGenerateOptions,
  type LlmGenerateResult,
} from './llm-provider.interface.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { LlmService } from './llm.service.js';

describe('LlmService', () => {
  let service: LlmService;
  let generateAsync: ReturnType<
    typeof vi.fn<(prompt: string, options: LlmGenerateOptions) => Promise<LlmGenerateResult>>
  >;

  beforeEach(async () => {
    generateAsync = vi.fn((_prompt: string, _options: LlmGenerateOptions) =>
      Promise.resolve({
        text: 'ответ провайдера',
        usage: { inputTokens: 3, outputTokens: 2, model: 'fake-model' },
      }),
    );

    const provider: ILlmProvider = {
      name: 'fake',
      models: [{ id: 'fake-model', label: 'Fake' }],
      isConfigured: true,
      generateAsync,
    };

    const registry = {
      resolveByModel: vi.fn(() => provider),
      listModels: vi.fn(() => []),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: LlmRegistryService, useValue: registry },
      ],
    }).compile();

    service = moduleRef.get(LlmService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('делегирует вызов провайдеру и пробрасывает usage наверх (KI-038)', async () => {
    await expect(service.generateAsync('привет', 'fake-model')).resolves.toEqual({
      text: 'ответ провайдера',
      usage: { inputTokens: 3, outputTokens: 2, model: 'fake-model' },
      // KI-148: сервис проставляет флаг локальности, провайдер его не задал.
      isLocal: false,
    });

    expect(generateAsync).toHaveBeenCalledTimes(1);

    const [prompt, options] = generateAsync.mock.calls[0];

    expect(prompt).toBe('привет');
    expect(options.model).toBe('fake-model');
    // RULES 4.19: вызов не может висеть без таймаута.
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('пробрасывает usage: null, если провайдер не отдал метрики (KI-038)', async () => {
    generateAsync.mockResolvedValue({ text: 'без метрик', usage: null });

    await expect(service.generateAsync('привет', 'fake-model')).resolves.toEqual({
      text: 'без метрик',
      usage: null,
      isLocal: false,
    });
  });

  it('KI-148: помечает результат isLocal для локального провайдера', async () => {
    const localProvider: ILlmProvider = {
      name: 'lmstudio',
      models: [{ id: 'qwen2.5-7b-instruct', label: 'qwen2.5-7b-instruct (local)' }],
      isConfigured: true,
      isLocal: true,
      generateAsync: vi.fn(() =>
        Promise.resolve({
          text: 'локальный ответ',
          usage: { inputTokens: 3, outputTokens: 2, model: 'qwen2.5-7b-instruct' },
        }),
      ),
    };
    const registry = {
      resolveByModel: vi.fn(() => localProvider),
      listModels: vi.fn(() => []),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [LlmService, { provide: LlmRegistryService, useValue: registry }],
    }).compile();
    const localService = moduleRef.get(LlmService);

    await expect(
      localService.generateAsync('привет', 'qwen2.5-7b-instruct'),
    ).resolves.toEqual({
      text: 'локальный ответ',
      usage: { inputTokens: 3, outputTokens: 2, model: 'qwen2.5-7b-instruct' },
      isLocal: true,
    });
  });

  it('пробрасывает LlmProviderException от провайдера, не гася стек', async () => {
    const failure = new LlmProviderException('fake', 'провайдер упал');

    generateAsync.mockRejectedValue(failure);

    await expect(service.generateAsync('привет', 'fake-model')).rejects.toBe(failure);
  });

  it('передаёт system из options', async () => {
    await service.generateAsync('привет', 'fake-model', { system: 'ты кот' });

    expect(generateAsync.mock.calls[0][1].system).toBe('ты кот');
  });
});
