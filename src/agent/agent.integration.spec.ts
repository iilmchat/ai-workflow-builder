import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  SafeHttpClient,
  type SafeHttpRequest,
  type SafeHttpResponse,
} from '../common/http/safe-http.client.js';
import type { LlmGenerateResult } from '../llm/llm-provider.interface.js';
import { LlmRegistryService } from '../llm/llm-registry.service.js';
import { LlmService } from '../llm/llm.service.js';
import { McpClientService } from '../mcp/mcp-client.service.js';
import { McpToolAdapter } from '../mcp/mcp-tool.adapter.js';
import { CostBudgetService } from '../runs/cost-budget.service.js';
import { QuickJsRunnerService } from '../sandbox/quickjs-runner.service.js';
import { VectorStoreService } from '../vector/vector-store.service.js';
import { AgentService } from './agent.service.js';
import type { AgentNodeData } from './agent.types.js';

/**
 * Интеграционный тест агента (R7.4b, DESIGN v0.9 § 3.4).
 *
 * В отличие от юнитов `agent.service.spec.ts`, здесь не мокаются ни реестр
 * инструментов, ни парсер, ни транскрипт: собирается настоящий `AgentService`
 * с настоящими инструментами, подменены только **внешние границы** — ответ
 * модели (сеть провайдера) и `SafeHttpClient` (HTTP-инструмент, v0.11 S14).
 * Сценарий — два шага, как требует DESIGN: `http_request` и `final`.
 */
describe('AgentService — интеграция: http_request → final (R7.4b)', () => {
  it('проходит полный цикл и доносит тело HTTP-ответа до модели', async () => {
    const responses: string[] = [
      // Публичный IP-литерал: SSRF-проверка (KI-409) не ходит в DNS, а fetch
      // подменён — тест остаётся сетевым только для провайдера модели.
      '{"tool":"http_request","input":{"method":"GET","url":"https://93.184.216.34/weather"}}',
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
    // v0.11 S14: HTTP-инструмент ходит через SafeHttpClient. Подменяем только
    // его — SSRF-логика покрыта `safe-http.client.spec.ts`.
    const httpFetchAsync = vi.fn(
      (_request: SafeHttpRequest): Promise<SafeHttpResponse> =>
        Promise.resolve({
          status: 200,
          ok: true,
          headers: new Headers(),
          body: '{"city":"Москва","temp":20}',
          finalUrl: 'https://93.184.216.34/weather',
        }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: SafeHttpClient, useValue: { fetchAsync: httpFetchAsync } },
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
        {
          // v0.11 S7: MCP-инструменты в сценарии не используются, preflight пуст.
          provide: McpClientService,
          useValue: {
            isEnabled: () => true,
            hasServer: () => true,
            prepareAsync: vi.fn(() => Promise.resolve()),
            listToolsAsync: vi.fn(() => Promise.resolve([])),
          },
        },
        {
          provide: McpToolAdapter,
          useValue: { createAgentTool: vi.fn() },
        },
        {
          // KI-407: бюджет — внешняя граница (БД), в интеграционном тесте
          // достаточно «пускающего» мока.
          provide: CostBudgetService,
          useValue: {
            assertWithinBudgetAsync: vi.fn(() =>
              Promise.resolve({
                ok: true,
                accumulated: 0,
                estimated: 0,
                remaining: 5,
                maxUsd: 5,
                maxRub: 500,
                mode: 'hard',
              }),
            ),
          },
        },
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
    expect(result.usage).toEqual({
      inputTokens: 24,
      outputTokens: 8,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
    // KI-407: плоские метрики для `node_runs` (модель вне прайса → null).
    expect(result.tokensIn).toBe(24);
    expect(result.tokensOut).toBe(8);
    expect(result.costUsd).toBeNull();
    expect(result.steps.map((step) => step.kind)).toEqual([
      'llm',
      'tool',
      'llm',
      'final',
    ]);

    // Внешняя граница: ровно один HTTP-запрос на URL из ответа модели.
    expect(httpFetchAsync).toHaveBeenCalledTimes(1);
    expect(httpFetchAsync.mock.calls[0]?.[0].url).toBe(
      'https://93.184.216.34/weather',
    );

    // Транскрипт: системная инструкция пользователя и протокол доехали до
    // модели, а тело HTTP-ответа — до второй итерации.
    expect(prompts[0]).toContain('Отвечай кратко.');
    expect(prompts[0]).toContain('Available tools:');
    expect(prompts[1]).toContain('### TOOL RESULT (call_1)');
    expect(prompts[1]).toContain('Москва');
  });
});
