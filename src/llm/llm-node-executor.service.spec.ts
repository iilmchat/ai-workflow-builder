import { Test } from '@nestjs/testing';
import type { NodeDto } from '../engine/dto/index.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
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
      providers: [
        LlmNodeExecutor,
        { provide: LlmService, useValue: llm },
        // R7.1 (KI-048): предохранитель по стоимости. Здесь он не проверяется —
        // вызовы идут без `runId`, поэтому заглушка просто не вызывается;
        // собственные тесты бюджета — `src/runs/cost-budget.service.spec.ts`.
        {
          provide: CostBudgetService,
          useValue: { assertWithinBudgetAsync: vi.fn(() => Promise.resolve()) },
        },
      ],
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
    expect(result).toMatchObject({
      outputs: { text: 'ответ модели', costStatus: 'exact' },
      // gpt-4o: 1000 входных токенов * 2.5/1M + 500 выходных * 10/1M = 0.0075
      metrics: {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.0075,
        // R7.7: кэша в ответе нет — поля `null`, экономия не считается.
        cacheReadTokens: null,
        cacheCreationTokens: null,
        cacheSavingsUsd: null,
        model: 'gpt-4o',
        costStatus: 'exact',
      },
    });
  });

  it('при cached-ответе не начисляет стоимость и кладёт флаг в outputs (S8)', async () => {
    llm.generateAsync.mockResolvedValue({
      text: 'из кэша',
      usage: { inputTokens: 1000, outputTokens: 500, model: 'gpt-4o' },
      cached: true,
    });

    const result = await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'привет',
    });

    expect(result.outputs).toEqual({
      text: 'из кэша',
      cached: true,
      costStatus: 'cached',
    });
    // Токены исходного вызова остаются, но повторный вызов бесплатен.
    expect(result.metrics.costUsd).toBe(0);
    expect(result.metrics.cached).toBe(true);
    expect(result.metrics.costStatus).toBe('cached');
  });

  it('передаёт orgId в LlmService для tenant-кэша (S8)', async () => {
    await executor.executeAsync(
      node({ model: 'gpt-4o' }),
      { prompt: 'привет' },
      'run-1',
      'org-1',
    );

    expect(llm.generateAsync).toHaveBeenCalledWith('привет', 'gpt-4o', {
      orgId: 'org-1',
    });
  });

  it('при локальном провайдере ставит costStatus=local и стоимость 0 (S8.1)', async () => {
    llm.generateAsync.mockResolvedValue({
      text: 'локальный ответ',
      usage: { inputTokens: 10, outputTokens: 5, model: 'qwen2.5' },
      isLocal: true,
    });

    const result = await executor.executeAsync(node({ model: 'qwen2.5' }), {
      prompt: 'привет',
    });

    expect(result.metrics.costStatus).toBe('local');
    expect(result.metrics.costUsd).toBe(0);
    expect(result.outputs).toMatchObject({ costStatus: 'local' });
  });

  it('без usage ставит costStatus=unknown (S8.1)', async () => {
    llm.generateAsync.mockResolvedValue({ text: 'без метрик', usage: null });

    const result = await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'привет',
    });

    expect(result.metrics.costStatus).toBe('unknown');
    expect(result.metrics.costUsd).toBeNull();
    expect(result.outputs).toMatchObject({ costStatus: 'unknown' });
  });

  it('возвращает метрики с null, если провайдер не отдал usage (KI-038)', async () => {    llm.generateAsync.mockResolvedValue({ text: 'без метрик', usage: null });

    const result = await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'привет',
    });

    expect(result).toMatchObject({
      outputs: { text: 'без метрик' },
      // Токены неизвестны — стоимость неизвестна (null, а не 0) после KI-052.
      metrics: {
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        cacheSavingsUsd: null,
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

    expect(result.metrics).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      costUsd: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      cacheSavingsUsd: null,
      model: 'unknown-model',
    });
  });

  it('KI-148: для локального провайдера costUsd = 0, а не null', async () => {
    llm.generateAsync.mockResolvedValue({
      text: 'локальный ответ',
      usage: { inputTokens: 10, outputTokens: 20, model: 'qwen2.5-7b-instruct' },
      isLocal: true,
    });

    const result = await executor.executeAsync(
      node({ model: 'qwen2.5-7b-instruct' }),
      { prompt: 'привет' },
    );

    // Модель вне прайс-листа, но провайдер локальный: вызов бесплатен → 0.
    expect(result.metrics).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 0,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      cacheSavingsUsd: null,
      model: 'qwen2.5-7b-instruct',
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

  it('KI-414: data.promptCache=true прокидывается в options', async () => {
    await executor.executeAsync(
      node({ model: 'gpt-4o', system: 'длинный system', promptCache: true }),
      { prompt: 'вопрос' },
    );

    expect(llm.generateAsync).toHaveBeenCalledWith('вопрос', 'gpt-4o', {
      system: 'длинный system',
      promptCache: true,
    });
  });

  it('KI-414: без data.promptCache флаг не передаётся (поведение до R7.7)', async () => {
    await executor.executeAsync(node({ model: 'gpt-4o' }), {
      prompt: 'вопрос',
    });

    expect(llm.generateAsync).toHaveBeenCalledWith('вопрос', 'gpt-4o', {});
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
