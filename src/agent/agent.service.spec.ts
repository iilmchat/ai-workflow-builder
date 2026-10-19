import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { NodeDataValidationException } from '../engine/errors.js';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../llm/llm-constants.js';
import {
  LlmProviderException,
  type LlmGenerateResult,
  type LlmUsage,
} from '../llm/llm-provider.interface.js';
import { LlmRegistryService } from '../llm/llm-registry.service.js';
import { LlmService } from '../llm/llm.service.js';
import { McpClientService } from '../mcp/mcp-client.service.js';
import { McpUnavailableException } from '../mcp/mcp.errors.js';
import {
  McpToolAdapter,
  normalizeToolResult,
} from '../mcp/mcp-tool.adapter.js';
import type { McpToolDescriptor } from '../mcp/mcp.types.js';
import {
  resetTracingAdapter,
  setTracingAdapter,
} from '../observability/tracing.js';
import {
  BudgetExceededException,
  CostBudgetService,
  type BudgetCheckResult,
} from '../runs/cost-budget.service.js';
import { QuickJsRunnerService } from '../sandbox/quickjs-runner.service.js';
import { VectorStoreService } from '../vector/vector-store.service.js';
import { TOOL_REGISTRY } from './agent-tools.js';
import { AgentService, isSideEffectingTool } from './agent.service.js';
import {
  AGENT_DEFAULT_MAX_ITERATIONS,
  AGENT_DEFAULT_MAX_TOKENS_PER_STEP,
  AgentIterationLimitException,
  AgentRunException,
  type AgentNodeData,
  type AgentTool,
} from './agent.types.js';

/**
 * Вектор нужной размерности: колонка `workflow_vectors.embedding` — vector(1536).
 *
 * @param fill - значение каждой компоненты
 * @returns массив длины {@link DEFAULT_EMBEDDING_DIMENSIONS}
 */
function vector(fill = 0.1): number[] {
  return Array.from({ length: DEFAULT_EMBEDDING_DIMENSIONS }, () => fill);
}

/**
 * Данные узла агента по умолчанию: одна модель, один инструмент, без лимитов.
 *
 * @param overrides - точечные замены полей узла
 * @returns валидированная форма `AgentNodeData`
 */
function agentNode(overrides: Partial<AgentNodeData> = {}): AgentNodeData {
  return {
    kind: 'agent',
    model: 'claude-test',
    tools: ['vector_query'],
    ...overrides,
  };
}

/** Один ответ LLM в сценарии. */
interface ScriptedReply {
  /** Текст ответа модели (JSON-протокол либо обычный текст). */
  text?: string;
  /** usage вызова; `null` — провайдер не отдал токены. */
  usage?: LlmUsage | null;
  /** Обслужен ли вызов локальным провайдером (KI-148). */
  isLocal?: boolean;
  /** Ошибка вместо ответа (для проверки retry-guard, v0.11 S7). */
  error?: unknown;
}

/**
 * Собирает `AgentService` через Nest-DI с моками всех внешних зависимостей.
 *
 * RULES 4.13: сервис с зависимостями собирается `Test.createTestingModule`,
 * а не `new AgentService(…)`; RULES 4.14 — `vi.fn`, не `jest.fn`.
 *
 * @param replies - ответы модели по порядку итераций
 * @param options.queryVectors - реализация поиска (для сценария ошибки tool)
 * @returns сервис и моки для проверки вызовов
 */
async function createHarness(
  replies: ScriptedReply[],
  options: { queryVectors?: () => Promise<unknown[]> } = {},
): Promise<{
  service: AgentService;
  generateAsync: ReturnType<typeof vi.fn>;
  assertWithinBudgetAsync: ReturnType<typeof vi.fn>;
  findWorkflowIdByRunAsync: ReturnType<typeof vi.fn>;
  queryVectorsAsync: ReturnType<typeof vi.fn>;
  writeMemoryAsync: ReturnType<typeof vi.fn>;
  configGet: ReturnType<typeof vi.fn>;
  mcpIsEnabled: ReturnType<typeof vi.fn>;
  mcpHasServer: ReturnType<typeof vi.fn>;
  mcpPrepareAsync: ReturnType<typeof vi.fn>;
  mcpListToolsAsync: ReturnType<typeof vi.fn>;
  mcpCreateTool: ReturnType<typeof vi.fn>;
}> {
  const generateAsync = vi.fn(
    (
      _prompt: string,
      _model: string,
      _options?: { maxTokens?: number },
    ): Promise<LlmGenerateResult> => {
      const reply = replies.shift();

      if (reply === undefined) {
        return Promise.reject(new Error('сценарий исчерпан: лишний вызов LLM'));
      }

      if (reply.error !== undefined) {
        return Promise.reject(reply.error);
      }

      return Promise.resolve({
        text: reply.text ?? '',
        usage:
          reply.usage === undefined
            ? { inputTokens: 10, outputTokens: 5, model: 'claude-test' }
            : reply.usage,
        ...(reply.isLocal === undefined ? {} : { isLocal: reply.isLocal }),
      });
    },
  );
  const findWorkflowIdByRunAsync = vi.fn(() => Promise.resolve('wf-1'));
  const queryVectorsAsync = vi.fn(
    options.queryVectors ?? (() => Promise.resolve([])),
  );
  const writeMemoryAsync = vi.fn(() => Promise.resolve());
  const embedAsync = vi.fn(() => Promise.resolve([vector()]));
  const configGet = vi.fn(() => undefined);
  // v0.11 S7: MCP-клиент и адаптер — внешние границы. По умолчанию preflight
  // пустой (нативные тесты), каталог пуст, adapters собираются по месту.
  const mcpIsEnabled = vi.fn(() => true);
  const mcpHasServer = vi.fn((_server: string) => true);
  const mcpPrepareAsync = vi.fn((_servers: readonly string[]) =>
    Promise.resolve(),
  );
  const mcpListToolsAsync = vi.fn((_server: string) =>
    Promise.resolve<readonly McpToolDescriptor[]>([]),
  );
  const mcpCreateTool = vi.fn(
    (server: string, descriptor: McpToolDescriptor): AgentTool => ({
      name: `mcp__${server}__${descriptor.name}`,
      description: descriptor.description ?? '',
      inputSchema: z.record(z.string(), z.unknown()),
      executeAsync: () => Promise.resolve({ ok: true }),
    }),
  );
  // KI-407: бюджет — внешняя граница (БД), в юнит-тесте только «пускает» или
  // «бросает». Оценка фиксируется в моке, чтобы тест проверил, что передана
  // именно накопленная стоимость цикла.
  const assertWithinBudgetAsync = vi.fn(
    (
      _runId: string,
      estimate: { usd?: number; rub?: number } = {},
    ): Promise<BudgetCheckResult> =>
      Promise.resolve({
        ok: true,
        accumulated: 0,
        estimated: estimate.usd ?? 0,
        remaining: 5,
        maxUsd: 5,
        maxRub: 500,
        mode: 'hard',
      }),
  );

  const moduleRef = await Test.createTestingModule({
    providers: [
      AgentService,
      { provide: LlmService, useValue: { generateAsync } },
      {
        provide: LlmRegistryService,
        useValue: {
          resolveEmbeddingProviderAsync: vi.fn(() =>
            Promise.resolve({ embedAsync }),
          ),
        },
      },
      {
        provide: VectorStoreService,
        useValue: {
          findWorkflowIdByRunAsync,
          insertVectorAsync: vi.fn(() => Promise.resolve({ id: 'vec-1' })),
          queryVectorsAsync,
          readMemoryAsync: vi.fn(() => Promise.resolve(undefined)),
          writeMemoryAsync,
        },
      },
      {
        provide: QuickJsRunnerService,
        useValue: {
          evaluateSandboxedAsync: vi.fn(() => Promise.resolve({ result: 1 })),
        },
      },
      { provide: ConfigService, useValue: { get: configGet } },
      {
        provide: CostBudgetService,
        useValue: { assertWithinBudgetAsync },
      },
      {
        provide: McpClientService,
        useValue: {
          isEnabled: mcpIsEnabled,
          hasServer: mcpHasServer,
          prepareAsync: mcpPrepareAsync,
          listToolsAsync: mcpListToolsAsync,
        },
      },
      {
        provide: McpToolAdapter,
        useValue: { createAgentTool: mcpCreateTool },
      },
    ],
  }).compile();

  return {
    service: moduleRef.get(AgentService),
    generateAsync,
    assertWithinBudgetAsync,
    findWorkflowIdByRunAsync,
    queryVectorsAsync,
    writeMemoryAsync,
    configGet,
    mcpIsEnabled,
    mcpHasServer,
    mcpPrepareAsync,
    mcpListToolsAsync,
    mcpCreateTool,
  };
}

/**
 * Подменяет глобальный `fetch` и возвращает мок.
 *
 * `AgentService` собирает контекст инструментов сам, поэтому подмена
 * глобального клиента — единственный способ проверить `http_request` без
 * реальной сети (и без DI-правки ради тестов).
 *
 * @param impl - реализация ответа
 * @returns мок fetch
 */
function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);

  vi.stubGlobal('fetch', mock);

  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // KI-416: адаптер трассировки — модульное состояние; тест со span'ом не
  // должен влиять на соседние.
  resetTracingAdapter();
});

/**
 * Юнит-тесты цикла агента (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Покрывают главное поведение: успешный цикл, исчерпание итераций, сбой
 * инструмента (не роняет запуск), неизвестный инструмент, ответ не по
 * протоколу и агрегацию usage.
 */
describe('AgentService.runAgentAsync (R7.4b)', () => {
  it('выполняет цикл tool → final и отдаёт шаги, итерации и usage', async () => {
    const { service, generateAsync, queryVectorsAsync } = await createHarness([
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"молоко"}}',
      },
      { text: '{"final":"В базе есть молоко"}' },
    ]);

    queryVectorsAsync.mockResolvedValue([
      { id: 'v1', content: { text: 'молоко' }, metadata: {}, score: 0.9 },
    ]);

    const result = await service.runAgentAsync(
      agentNode(),
      { prompt: 'что есть в базе?' },
      'run-1',
      'agent-1',
    );

    expect(result.answer).toBe('В базе есть молоко');
    expect(result.iterations).toBe(2);
    expect(result.steps.map((step) => step.kind)).toEqual([
      'llm',
      'tool',
      'llm',
      'final',
    ]);

    const toolStep = result.steps[1];

    expect(toolStep).toMatchObject({
      kind: 'tool',
      name: 'vector_query',
    });
    // `toMatchObject` игнорирует отсутствующий ключ `error`, поэтому проверка
    // «ошибки нет» — отдельная и явная.
    expect(
      toolStep?.kind === 'tool' ? toolStep.error : 'not-a-tool',
    ).toBeUndefined();
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
    // KI-407: те же токены продублированы плоскими полями для `node_runs`.
    expect(result.tokensIn).toBe(20);
    expect(result.tokensOut).toBe(10);
    // Модели `claude-test` нет в прайсе — стоимость «неизвестна», а не 0.
    expect(result.costUsd).toBeNull();

    // Второй промпт содержит результат инструмента: модель видит данные,
    // иначе цепочка tool → final была бы бессмысленной.
    const secondPrompt = generateAsync.mock.calls[1]?.[0] as string;

    expect(secondPrompt).toContain('### TOOL RESULT');
    expect(secondPrompt).toContain('молоко');

    // Входные данные ушли первым user-сообщением JSON'ом.
    expect(generateAsync.mock.calls[0]?.[0] as string).toContain(
      '{"prompt":"что есть в базе?"}',
    );
  });

  it('сбой инструмента не роняет запуск: ошибка уходит в шаг и в транскрипт', async () => {
    const { service, generateAsync } = await createHarness(
      [
        {
          text: '{"tool":"vector_query","input":{"collection":"docs","query":"x"}}',
        },
        { text: '{"final":"Не удалось найти, но отвечаю"}' },
      ],
      {
        queryVectors: () =>
          Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5433')),
      },
    );

    const result = await service.runAgentAsync(agentNode(), {}, 'run-1');

    expect(result.answer).toBe('Не удалось найти, но отвечаю');
    expect(result.steps[1]).toMatchObject({
      kind: 'tool',
      output: null,
      error: 'connect ECONNREFUSED 127.0.0.1:5433',
    });

    const secondPrompt = generateAsync.mock.calls[1]?.[0] as string;

    expect(secondPrompt).toContain('ECONNREFUSED');
  });

  it('исчерпание maxIterations бросает AgentIterationLimitException', async () => {
    const { service, generateAsync } = await createHarness([
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"a"}}',
      },
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"b"}}',
      },
      // Третий ответ не должен запрашиваться: лимит — 2.
      { text: '{"final":"поздно"}' },
    ]);

    const rejection = service.runAgentAsync(
      agentNode({ maxIterations: 2 }),
      {},
      'run-1',
    );

    await expect(rejection).rejects.toBeInstanceOf(
      AgentIterationLimitException,
    );
    await expect(rejection).rejects.toMatchObject({ iterations: 2 });

    expect(generateAsync).toHaveBeenCalledTimes(2);
  });

  it('инструмент не из узла: шаг с ошибкой, цикл продолжается', async () => {
    const { service } = await createHarness([
      {
        text: '{"tool":"memory_read","input":{"key":"profile"}}',
      },
      { text: '{"final":"Память недоступна, отвечаю без неё"}' },
    ]);

    const result = await service.runAgentAsync(
      agentNode({ tools: ['vector_query'] }),
      {},
      'run-1',
    );

    expect(result.steps[1]).toMatchObject({
      kind: 'tool',
      name: 'memory_read',
      output: null,
      error: "Инструмент 'memory_read' не подключён к узлу агента",
    });
    expect(result.answer).toBe('Память недоступна, отвечаю без неё');
  });

  it('ответ не по протоколу считается финальным (запуск не падает)', async () => {
    const { service } = await createHarness([
      { text: '  Просто текстовый ответ  ' },
    ]);

    const result = await service.runAgentAsync(agentNode(), {}, 'run-1');

    expect(result.answer).toBe('Просто текстовый ответ');
    expect(result.steps.map((step) => step.kind)).toEqual(['llm', 'final']);
    expect(result.iterations).toBe(1);
  });

  it('usage=null у провайдера не превращается в нули', async () => {
    const { service } = await createHarness([
      { text: '{"final":"ответ"}', usage: null },
    ]);

    const result = await service.runAgentAsync(agentNode(), {}, 'run-1');

    expect(result.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
    });
  });

  it('http_request работает через глобальный fetch и не трогает БД', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{"temp":20}', { status: 200 })),
    );
    const { service, findWorkflowIdByRunAsync, generateAsync } =
      await createHarness([
        {
          // Публичный IP-литерал: SSRF-проверка (KI-409) не делает DNS-запрос,
          // поэтому юнит-тест не зависит от сети.
          text: '{"tool":"http_request","input":{"url":"https://93.184.216.34/weather"}}',
        },
        { text: '{"final":"20 градусов"}' },
      ]);

    const result = await service.runAgentAsync(
      agentNode({ tools: ['http_request'] }),
      {},
      'run-1',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe('20 градусов');
    // workflow_id нужен только vector/memory-инструментам.
    expect(findWorkflowIdByRunAsync).not.toHaveBeenCalled();
    // maxTokens по умолчанию уходит в каждый вызов (DESIGN § 3.4).
    expect(generateAsync.mock.calls[0]?.[2]).toEqual({
      maxTokens: AGENT_DEFAULT_MAX_TOKENS_PER_STEP,
    });
  });

  it('дефолтный лимит итераций берётся из env (ConfigService)', async () => {
    const { service, configGet, generateAsync } = await createHarness([
      { text: '{"final":"ok"}' },
    ]);

    await service.runAgentAsync(agentNode(), {}, 'run-1');

    expect(configGet).toHaveBeenCalledWith('AGENT_MAX_ITERATIONS_DEFAULT');
    expect(configGet).toHaveBeenCalledWith('AGENT_MAX_TOKENS_PER_STEP_DEFAULT');
    // Конфиг вернул undefined — сервис использует константы DESIGN § 3.4.
    expect(AGENT_DEFAULT_MAX_ITERATIONS).toBe(5);
    expect(generateAsync).toHaveBeenCalledTimes(1);
  });

  it('memory_write доступен как инструмент и получает workflow из запуска', async () => {
    const { service, writeMemoryAsync, findWorkflowIdByRunAsync } =
      await createHarness([
        {
          text: '{"tool":"memory_write","input":{"key":"last","value":42}}',
        },
        { text: '{"final":"запомнил"}' },
      ]);

    const result = await service.runAgentAsync(
      agentNode({ tools: ['memory_write'] }),
      {},
      'run-1',
    );

    expect(findWorkflowIdByRunAsync).toHaveBeenCalledWith('run-1');
    expect(writeMemoryAsync).toHaveBeenCalledWith('wf-1', 'last', 42);
    expect(result.answer).toBe('запомнил');
  });
});

/**
 * Учёт стоимости и бюджет цикла (KI-407, R7.1/KI-048).
 *
 * Проверяется контракт с `CostBudgetService`: стоимость считается по прайсу
 * после каждого платного вызова, накапливается по шагам и передаётся в
 * проверку бюджета как оценка; при превышении цикл обрывается.
 */
describe('AgentService — стоимость и бюджет (KI-407)', () => {
  it('суммирует токены и стоимость шагов, проверяя бюджет после каждого шага', async () => {
    const { service, assertWithinBudgetAsync } = await createHarness([
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"a"}}',
        usage: { inputTokens: 1_000, outputTokens: 500, model: 'gpt-4o' },
      },
      {
        text: '{"final":"готово"}',
        usage: { inputTokens: 500, outputTokens: 250, model: 'gpt-4o' },
      },
    ]);

    const result = await service.runAgentAsync(
      agentNode({ model: 'gpt-4o' }),
      {},
      'run-1',
    );

    expect(result.tokensIn).toBe(1_500);
    expect(result.tokensOut).toBe(750);
    // gpt-4o: $2.5/1M вход, $10/1M выход.
    // Шаг 1: 0.0025 + 0.005 = 0.0075; шаг 2: 0.00125 + 0.0025 = 0.00375.
    expect(result.costUsd).toBe(0.01125);
    // Проверка бюджета — после каждого шага, с накопленной стоимостью цикла:
    // собственные траты в `node_runs` ещё не записаны движком.
    expect(assertWithinBudgetAsync).toHaveBeenCalledTimes(2);
    expect(assertWithinBudgetAsync).toHaveBeenNthCalledWith(1, 'run-1', {
      usd: 0.0075,
    });
    expect(assertWithinBudgetAsync).toHaveBeenNthCalledWith(2, 'run-1', {
      usd: 0.01125,
    });
  });

  it('v0.11 S11: агрегирует кэш-токены шагов в usage и плоских метриках', async () => {
    const { service } = await createHarness([
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"a"}}',
        usage: {
          inputTokens: 1_000,
          outputTokens: 500,
          cacheReadTokens: 800,
          cacheCreationTokens: 200,
          model: 'gpt-4o',
        },
      },
      {
        text: '{"final":"готово"}',
        usage: {
          inputTokens: 500,
          outputTokens: 250,
          cacheReadTokens: 100,
          model: 'gpt-4o',
        },
      },
    ]);

    const result = await service.runAgentAsync(
      agentNode({ model: 'gpt-4o' }),
      {},
      'run-1',
    );

    // Кэш-токены суммируются отдельно от input/output: у кэша своя цена
    // (R7.7/KI-055), поэтому в `inputTokens` они не подмешиваются.
    expect(result.usage).toEqual({
      inputTokens: 1_500,
      outputTokens: 750,
      cacheReadTokens: 900,
      cacheCreationTokens: 200,
    });
    // Плоские поля для `node_runs.cache_read_tokens/cache_creation_tokens`.
    expect(result.cacheReadTokens).toBe(900);
    expect(result.cacheCreationTokens).toBe(200);
  });

  it('превышение бюджета бросает BudgetExceededException и обрывает цикл', async () => {
    const { service, assertWithinBudgetAsync, generateAsync } =
      await createHarness([
        {
          text: '{"tool":"vector_query","input":{"collection":"docs","query":"a"}}',
          usage: { inputTokens: 1_000, outputTokens: 500, model: 'gpt-4o' },
        },
        // Второй ответ не должен запрашиваться: бюджет исчерпан на первом шаге.
        { text: '{"final":"поздно"}' },
      ]);

    assertWithinBudgetAsync.mockRejectedValueOnce(
      new BudgetExceededException(0.0075, 0.001),
    );

    await expect(
      service.runAgentAsync(agentNode({ model: 'gpt-4o' }), {}, 'run-1'),
    ).rejects.toBeInstanceOf(BudgetExceededException);

    expect(generateAsync).toHaveBeenCalledTimes(1);
    expect(assertWithinBudgetAsync).toHaveBeenCalledTimes(1);
  });

  it('локальный провайдер стоит 0, а не null (KI-148)', async () => {
    const { service } = await createHarness([
      {
        text: '{"final":"ок"}',
        usage: { inputTokens: 10, outputTokens: 5, model: 'local' },
        isLocal: true,
      },
    ]);

    const result = await service.runAgentAsync(
      agentNode({ model: 'local' }),
      {},
      'run-1',
    );

    // `calculateCostUsd` вернул бы null (модели нет в прайсе), но локальный
    // вызов бесплатен — это `0`, и бюджет должен видеть именно его.
    expect(result.costUsd).toBe(0);
  });

  it('учитывает платный llm_call внутри tool-шага', async () => {
    const { service, assertWithinBudgetAsync } = await createHarness([
      // Шаг 1: модель просит `llm_call` (свой вызов — 1000/500 токенов).
      {
        text: '{"tool":"llm_call","input":{"prompt":"привет"}}',
        usage: { inputTokens: 1_000, outputTokens: 500, model: 'gpt-4o' },
      },
      // Вызов внутри инструмента: 2000/500 токенов.
      {
        text: 'ответ инструмента',
        usage: { inputTokens: 2_000, outputTokens: 500, model: 'gpt-4o' },
      },
      // Шаг 2: финальный ответ; usage прокси не отдал.
      { text: '{"final":"готово"}', usage: null },
    ]);

    const result = await service.runAgentAsync(
      agentNode({ model: 'gpt-4o', tools: ['llm_call'] }),
      {},
      'run-1',
    );

    // Токены цикла + токены инструмента.
    expect(result.tokensIn).toBe(3_000);
    expect(result.tokensOut).toBe(1_000);
    // Шаг 1: 0.0075; llm_call: 0.01; итого 0.0175.
    expect(result.costUsd).toBe(0.0175);
    // Проверка после шага, после инструмента и на финальном шаге (usage=null,
    // стоимость не меняется).
    expect(assertWithinBudgetAsync).toHaveBeenNthCalledWith(2, 'run-1', {
      usd: 0.0175,
    });
    expect(assertWithinBudgetAsync).toHaveBeenCalledTimes(3);
  });
});

/**
 * Span `agent.step` (KI-416, DESIGN v0.9 § 3.7.1).
 *
 * Подменяем адаптер трассировки записывающим: проверяем имя span'а на каждой
 * итерации и атрибуты `iteration` / `tool_name`.
 */
describe('AgentService — span agent.step (KI-416)', () => {
  /** Записанный span: имя и итоговые атрибуты. */
  interface RecordedSpan {
    name: string;
    attributes: Record<string, unknown>;
  }

  /**
   * Ставит записывающий адаптер трассировки.
   *
   * @returns массив, в который попадут завершённые span'ы
   */
  function recordSpans(): RecordedSpan[] {
    const recorded: RecordedSpan[] = [];

    setTracingAdapter({
      async runAsync(name, options, fn) {
        const attributes: Record<string, unknown> = { ...options.attributes };
        const span = {
          setAttribute: (key: string, value: unknown): void => {
            attributes[key] = value;
          },
          recordException: (): void => undefined,
        };

        try {
          return await fn(span);
        } finally {
          recorded.push({ name, attributes });
        }
      },
    });

    return recorded;
  }

  it('оборачивает каждую итерацию и выставляет iteration / tool_name', async () => {
    const recorded = recordSpans();
    const { service } = await createHarness([
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"a"}}',
      },
      { text: '{"final":"готово"}' },
    ]);

    await service.runAgentAsync(agentNode(), {}, 'run-1');

    expect(recorded.map((entry) => entry.name)).toEqual([
      'agent.step',
      'agent.step',
    ]);
    expect(recorded[0]?.attributes).toMatchObject({
      iteration: 1,
      tool_name: 'vector_query',
    });
    // Финальная итерация инструмент не вызывала — атрибута нет.
    expect(recorded[1]?.attributes).toMatchObject({ iteration: 2 });
    expect(recorded[1]?.attributes.tool_name).toBeUndefined();
  });
});

/** Описание MCP-инструмента для сценариев агента. */
const READ_FILE_DESCRIPTOR: McpToolDescriptor = {
  name: 'read_file',
  description: 'Reads a file',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  annotations: { readOnlyHint: true, idempotentHint: true },
};

/**
 * MCP-интеграция агента (v0.11 S7, DESIGN § 3.2.5, § 3.3.2).
 *
 * Проверяется контракт между `AgentService`, MCP-клиентом и адаптером:
 * preflight до первого LLM-вызова, MCP-only узел, classification побочных
 * эффектов и retry-guard.
 */
describe('AgentService — MCP-интеграция (v0.11 S7)', () => {
  it('MCP-only узел: preflight, адаптер, tool-шаг и финальный ответ', async () => {
    const {
      service,
      generateAsync,
      mcpPrepareAsync,
      mcpListToolsAsync,
      mcpCreateTool,
    } = await createHarness([
      {
        text: '{"tool":"mcp__filesystem__read_file","input":{"path":"a.txt"}}',
      },
      { text: '{"final":"Файл прочитан"}' },
    ]);
    const executeAsync = vi.fn(() => Promise.resolve('file body'));

    mcpListToolsAsync.mockResolvedValue([READ_FILE_DESCRIPTOR]);
    mcpCreateTool.mockReturnValue({
      name: 'mcp__filesystem__read_file',
      description: 'Reads a file',
      inputSchema: z.record(z.string(), z.unknown()),
      readOnlyHint: true,
      executeAsync,
    });

    const result = await service.runAgentAsync(
      agentNode({
        tools: [],
        mcpTools: [{ server: 'filesystem', tool: 'read_file' }],
      }),
      {},
      'run-1',
      'agent-1',
    );

    expect(mcpPrepareAsync).toHaveBeenCalledWith(['filesystem']);
    expect(mcpListToolsAsync).toHaveBeenCalledWith('filesystem');
    expect(mcpCreateTool).toHaveBeenCalledWith(
      'filesystem',
      READ_FILE_DESCRIPTOR,
    );
    expect(executeAsync).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe('Файл прочитан');
    expect(result.steps[1]).toMatchObject({
      kind: 'tool',
      name: 'mcp__filesystem__read_file',
      output: 'file body',
    });

    // DESIGN § 3.2.5: в системном промпте есть правило о недоверенном контенте.
    expect(generateAsync.mock.calls[0]?.[0]).toContain('untrusted data');
    expect(generateAsync.mock.calls[0]?.[0]).toContain(
      '- mcp__filesystem__read_file:',
    );
  });

  it('preflight fail → узел падает без LLM-вызова', async () => {
    const { service, generateAsync, mcpPrepareAsync } = await createHarness([
      { text: '{"final":"поздно"}' },
    ]);

    mcpPrepareAsync.mockRejectedValue(
      new McpUnavailableException('filesystem', 'нет связи'),
    );

    await expect(
      service.runAgentAsync(
        agentNode({
          tools: [],
          mcpTools: [{ server: 'filesystem', tool: 'read_file' }],
        }),
        {},
        'run-1',
      ),
    ).rejects.toBeInstanceOf(McpUnavailableException);
    expect(generateAsync).not.toHaveBeenCalled();
  });

  it('неизвестный MCP-сервер → NodeDataValidationException до preflight', async () => {
    const { service, generateAsync, mcpHasServer, mcpPrepareAsync } =
      await createHarness([{ text: '{"final":"поздно"}' }]);

    mcpHasServer.mockReturnValue(false);

    await expect(
      service.runAgentAsync(
        agentNode({
          tools: [],
          mcpTools: [{ server: 'unknown', tool: 'read_file' }],
        }),
        {},
        'run-1',
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
    expect(mcpPrepareAsync).not.toHaveBeenCalled();
    expect(generateAsync).not.toHaveBeenCalled();
  });

  it('неизвестный MCP-инструмент → NodeDataValidationException без LLM', async () => {
    const { service, generateAsync, mcpListToolsAsync } = await createHarness([
      { text: '{"final":"поздно"}' },
    ]);

    mcpListToolsAsync.mockResolvedValue([READ_FILE_DESCRIPTOR]);

    await expect(
      service.runAgentAsync(
        agentNode({
          tools: [],
          mcpTools: [{ server: 'filesystem', tool: 'missing_tool' }],
        }),
        {},
        'run-1',
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
    expect(generateAsync).not.toHaveBeenCalled();
  });

  it('side-effect tool → AgentRunException (non-retryable), причина сохранена', async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(new Response('{}', { status: 200 })),
    );
    const providerError = new LlmProviderException('anthropic', 'rate limit', {
      retryable: true,
    });
    const { service, generateAsync } = await createHarness([
      {
        text:
          '{"tool":"http_request","input":{"method":"POST",' +
          '"url":"https://93.184.216.34/x","body":"{}"}}',
      },
      { error: providerError },
    ]);

    const error: unknown = await service
      .runAgentAsync(agentNode({ tools: ['http_request'] }), {}, 'run-1')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentRunException);
    expect(error).not.toBeInstanceOf(LlmProviderException);
    expect((error as AgentRunException).message).toContain('повтор запрещён');
    expect((error as AgentRunException).cause).toBe(providerError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(generateAsync).toHaveBeenCalledTimes(2);
  });

  it('read-only tool → retryable LlmProviderException пробрасывается как есть', async () => {
    const providerError = new LlmProviderException('anthropic', 'overloaded', {
      retryable: true,
    });
    const { service } = await createHarness([
      {
        text: '{"tool":"vector_query","input":{"collection":"docs","query":"a"}}',
      },
      { error: providerError },
    ]);

    const error: unknown = await service
      .runAgentAsync(agentNode({ tools: ['vector_query'] }), {}, 'run-1')
      .catch((caught: unknown) => caught);

    // Побочных эффектов не было: движок увидит retryable-ошибку и повторит узел.
    expect(error).toBe(providerError);
    expect((error as LlmProviderException).retryable).toBe(true);
  });

  it('MCP read-only hint → повтор разрешён, destructive → запрещён', async () => {
    const readOnly = adapterTool('read_file', { readOnlyHint: true });
    const idempotent = adapterTool('list_files', { idempotentHint: true });
    const destructive = adapterTool('write_file', { destructiveHint: true });
    const unannotated = adapterTool('click');

    expect(isSideEffectingTool(readOnly, {})).toBe(false);
    expect(isSideEffectingTool(idempotent, {})).toBe(false);
    expect(isSideEffectingTool(destructive, {})).toBe(true);
    expect(isSideEffectingTool(unannotated, {})).toBe(true);
  });

  it('нативные side-effect инструменты классифицируются по методу/имени', () => {
    expect(
      isSideEffectingTool(TOOL_REGISTRY.http_request, {
        method: 'GET',
        url: 'https://example.com',
      }),
    ).toBe(false);
    expect(
      isSideEffectingTool(TOOL_REGISTRY.http_request, {
        method: 'POST',
        url: 'https://example.com',
      }),
    ).toBe(true);
    expect(isSideEffectingTool(TOOL_REGISTRY.vector_query, {})).toBe(false);
    expect(isSideEffectingTool(TOOL_REGISTRY.memory_write, {})).toBe(true);
    expect(isSideEffectingTool(TOOL_REGISTRY.code_eval, {})).toBe(true);
  });
});

describe('normalizeToolResult — недоверенный контент в агенте (v0.11 S7)', () => {
  it('image/resource заменяются placeholder, text остаётся', () => {
    const result = {
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        {
          type: 'resource',
          resource: { uri: 'file:///a.txt', text: 'body' },
        },
      ],
    } as CallToolResult;

    expect(normalizeToolResult(result, 4000)).toBe(
      'hello\n[image omitted]\n[resource omitted]',
    );
  });
});

/**
 * Собирает MCP-`AgentTool` с заданными аннотациями.
 *
 * @param name - имя инструмента на сервере
 * @param hints - MCP-аннотации
 * @returns инструмент для классификатора побочных эффектов
 */
function adapterTool(
  name: string,
  hints: Partial<
    Pick<AgentTool, 'readOnlyHint' | 'destructiveHint' | 'idempotentHint'>
  > = {},
): AgentTool {
  return {
    name: `mcp__filesystem__${name}`,
    description: name,
    inputSchema: z.record(z.string(), z.unknown()),
    ...hints,
    executeAsync: () => Promise.resolve(null),
  };
}
