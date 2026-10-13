import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { LlmProviderException } from './llm-provider.interface.js';
import { DEFAULT_LLM_MODEL, LlmNodeExecutor } from './llm-node-executor.service.js';
import { LlmService } from './llm.service.js';

/**
 * Создаёт LLM-узел с заданными `data`.
 *
 * @param data - данные узла (`model`, `system`)
 * @returns узел графа типа `llm`
 */
function node(data: Record<string, unknown>): NodeDto {
  return { id: 'B', type: 'llm', data };
}

describe('LlmNodeExecutor', () => {
  let executor: LlmNodeExecutor;
  let llm: { generateAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    llm = {
      generateAsync: vi.fn(() =>
        Promise.resolve({
          text: 'ответ модели',
          usage: { inputTokens: 1000, outputTokens: 500, model: 'gpt-4o' },
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [LlmNodeExecutor, { provide: LlmService, useValue: llm }],
    }).compile();

    executor = moduleRef.get(LlmNodeExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('возвращает выходы и метрики с посчитанной стоимостью (KI-038)', async () => {
    const result = await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'привет',
    });

    expect(llm.generateAsync).toHaveBeenCalledWith('привет', 'gpt-4o', {});
    expect(result).toEqual({
      outputs: { text: 'ответ модели' },
      // gpt-4o: 1000 входных токенов * 2.5/1M + 500 выходных * 10/1M = 0.0075
      metrics: {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.0075,
        model: 'gpt-4o',
      },
    });
  });

  it('возвращает метрики с null, если провайдер не отдал usage (KI-038)', async () => {
    llm.generateAsync.mockResolvedValue({ text: 'без метрик', usage: null });

    const result = await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'привет',
    });

    expect(result).toEqual({
      outputs: { text: 'без метрик' },
      // Токены неизвестны — стоимость неизвестна (null, а не 0) после KI-052.
      metrics: {
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        model: 'gpt-4o',
      },
    });
  });

  it('возвращает costUsd: null для модели вне прайс-листа (KI-038)', async () => {
    llm.generateAsync.mockResolvedValue({
      text: 'ответ',
      usage: { inputTokens: 10, outputTokens: 20, model: 'unknown-model' },
    });

    const result = await executor.executeAsync(node({ model: 'unknown-model' }), {
      prompt: 'привет',
    });

    expect(result.metrics).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      costUsd: null,
      model: 'unknown-model',
    });
  });

  it('берёт модель по умолчанию, если data.model не задана', async () => {
    await executor.executeAsync(node({}), { prompt: 'привет' });

    expect(llm.generateAsync).toHaveBeenCalledWith('привет', DEFAULT_LLM_MODEL, {});
  });

  it('передаёт system из data в вызов LLM', async () => {
    await executor.executeAsync(node({ model: 'gpt-4o', system: 'ты кот' }), {
      prompt: 'мяу',
    });

    expect(llm.generateAsync).toHaveBeenCalledWith('мяу', 'gpt-4o', {
      system: 'ты кот',
    });
  });

  it('бросает LlmProviderException на пустой prompt и не вызывает LLM', async () => {
    await expect(executor.executeAsync(node({}), {})).rejects.toThrow(
      LlmProviderException,
    );
    await expect(
      executor.executeAsync(node({}), { prompt: '' }),
    ).rejects.toThrow('Пустой prompt');
    await expect(
      executor.executeAsync(node({}), { prompt: 42 }),
    ).rejects.toThrow('Пустой prompt');

    expect(llm.generateAsync).not.toHaveBeenCalled();
  });
});
