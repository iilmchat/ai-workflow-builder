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
    llm = { generateAsync: vi.fn(() => Promise.resolve('ответ модели')) };

    const moduleRef = await Test.createTestingModule({
      providers: [LlmNodeExecutor, { provide: LlmService, useValue: llm }],
    }).compile();

    executor = moduleRef.get(LlmNodeExecutor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('возвращает { text } с ответом модели и моделью из data', async () => {
    const result = await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'привет',
    });

    expect(result).toEqual({ text: 'ответ модели' });
    expect(llm.generateAsync).toHaveBeenCalledWith('привет', 'gpt-4o', {});
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
