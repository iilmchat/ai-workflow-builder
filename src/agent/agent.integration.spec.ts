import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmGenerateResult } from '../llm/llm-provider.interface.js';
import { LlmRegistryService } from '../llm/llm-registry.service.js';
import { LlmService } from '../llm/llm.service.js';
import { QuickJsRunnerService } from '../sandbox/quickjs-runner.service.js';
import { VectorStoreService } from '../vector/vector-store.service.js';
import { AgentService } from './agent.service.js';
import type { AgentNodeData } from './agent.types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Интеграционный тест агента (R7.4b, DESIGN v0.9 § 3.4).
 *
 * В отличие от юнитов `agent.service.spec.ts`, здесь не мокаются ни реестр
 * инструментов, ни парсер, ни транскрипт: собирается настоящий `AgentService`
 * с настоящими инструментами, подменены только **внешние границы** — ответ
 * модели (сеть провайдера) и `fetch` (HTTP-инструмент). Сценарий — два шага,
 * как требует DESIGN: `http_request` и `final`.
 */
describe('AgentService — интеграция: http_request → final (R7.4b)', () => {
  it('проходит полный цикл и доносит тело HTTP-ответа до модели', async () => {
    const responses: string[] = [
      '{"tool":"http_request","input":{"method":"GET","url":"https://api.test/weather"}}',
      '{"final":"В Москве 20 градусов"}',
    ];
    const prompts: string[] = [];
    const generateAsync = vi.fn(
      (prompt: string): Promise<LlmGenerateResult> => {
        prompts.push(prompt);
        const text = responses.shift();

        if (text === undefined) {
          return Promise.reject(new Error('лишний вызов LLM'));
        }

        return Promise.resolve({
          text,
          usage: { inputTokens: 12, outputTokens: 4, model: 'claude-test' },
        });
      },
    );
    const fetchMock = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(
          new Response('{"city":"Москва","temp":20}', { status: 200 }),
        ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: LlmService, useValue: { generateAsync } },
        {
          provide: LlmRegistryService,
          useValue: {
            // В сценарии нет vector/memory-инструментов: эмбеддинги не нужны.
            resolveEmbeddingProviderAsync: vi.fn(() =>
              Promise.reject(new Error('embeddings не вызываются')),
            ),
          },
        },
        {
          provide: VectorStoreService,
          useValue: {
            findWorkflowIdByRunAsync: vi.fn(() =>
              Promise.reject(new Error('workflow не запрашивается')),
            ),
            insertVectorAsync: vi.fn(),
            queryVectorsAsync: vi.fn(),
            readMemoryAsync: vi.fn(),
            writeMemoryAsync: vi.fn(),
          },
        },
        {
          provide: QuickJsRunnerService,
          useValue: {
            evaluateSandboxedAsync: vi.fn(() =>
              Promise.reject(new Error('песочница не вызывается')),
            ),
          },
        },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const service = moduleRef.get(AgentService);
    const node: AgentNodeData = {
      kind: 'agent',
      model: 'claude-test',
      systemPrompt: 'Отвечай кратко.',
      tools: ['http_request'],
      maxIterations: 3,
    };

    const result = await service.runAgentAsync(
      node,
      { prompt: 'Какая погода в Москве?' },
      'run-integration',
      'agent-1',
    );

    expect(result.answer).toBe('В Москве 20 градусов');
    expect(result.iterations).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 24, outputTokens: 8 });
    expect(result.steps.map((step) => step.kind)).toEqual([
      'llm',
      'tool',
      'llm',
      'final',
    ]);

    // Внешняя граница: ровно один HTTP-запрос на URL из ответа модели.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.test/weather');

    // Транскрипт: системная инструкция пользователя и протокол доехали до
    // модели, а тело HTTP-ответа — до второй итерации.
    expect(prompts[0]).toContain('Отвечай кратко.');
    expect(prompts[0]).toContain('Available tools:');
    expect(prompts[1]).toContain('### TOOL RESULT (call_1)');
    expect(prompts[1]).toContain('Москва');
  });
});
