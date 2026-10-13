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
