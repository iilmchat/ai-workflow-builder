import { describe, expect, it, vi } from 'vitest';
import type {
  VectorMatch,
  VectorQueryInput,
  VectorRecordInput,
} from '../engine/node-executors.js';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../llm/llm-constants.js';
import type { AgentToolContext } from './agent.types.js';
import { TOOL_REGISTRY } from './agent-tools.js';

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
 * Собирает контекст инструментов с моками (RULES 4.14: `vi.fn`, не `jest.fn`).
 *
 * Каждый инструмент получает ровно те зависимости, которые объявлены в
 * {@link AgentToolContext}; лишнего в контексте нет, поэтому тест ловит
 * случайное обращение к сервису мимо контракта.
 *
 * @param overrides - точечные замены зависимостей
 * @returns контекст и моки для проверки аргументов
 */
function createContext(overrides: Partial<AgentToolContext> = {}): {
  context: AgentToolContext;
  mocks: {
    insertVectorAsync: ReturnType<typeof vi.fn>;
    queryVectorsAsync: ReturnType<typeof vi.fn>;
    readMemoryAsync: ReturnType<typeof vi.fn>;
    writeMemoryAsync: ReturnType<typeof vi.fn>;
    embedAsync: ReturnType<typeof vi.fn>;
    llmGenerateAsync: ReturnType<typeof vi.fn>;
    evaluateSandboxedAsync: ReturnType<typeof vi.fn>;
    fetchAsync: ReturnType<typeof vi.fn>;
    dnsLookupAsync: ReturnType<typeof vi.fn>;
  };
} {
  const insertVectorAsync = vi.fn<
    (record: VectorRecordInput) => Promise<{ id: string }>
  >(() => Promise.resolve({ id: 'vec-1' }));
  const queryVectorsAsync = vi.fn<
    (query: VectorQueryInput) => Promise<VectorMatch[]>
  >(() => Promise.resolve([]));
  const readMemoryAsync = vi.fn<
    (workflowId: string, key: string) => Promise<unknown>
  >(() => Promise.resolve(undefined));
  const writeMemoryAsync = vi.fn<
    (workflowId: string, key: string, value: unknown) => Promise<void>
  >(() => Promise.resolve());
  const embedAsync = vi.fn<
    (texts: string[], model: string) => Promise<number[][]>
  >(() => Promise.resolve([vector()]));
  const llmGenerateAsync = vi.fn(() =>
    Promise.resolve({ text: 'ответ модели', usage: null }),
  );
  const evaluateSandboxedAsync = vi.fn(() => Promise.resolve({ result: 42 }));
  const fetchAsync = vi.fn(() =>
    Promise.resolve(new Response('{"ok":true}', { status: 200 })),
  );
  // KI-409: резолвер DNS подменяется, чтобы тесты не ходили в сеть. Публичный
  // адрес — SSRF-проверка пропускает запрос.
  const dnsLookupAsync = vi.fn(() => Promise.resolve(['93.184.216.34']));

  const context: AgentToolContext = {
    runId: 'run-1',
    nodeId: 'agent-1',
    workflowId: 'wf-1',
    model: 'claude-test',
    store: {
      insertVectorAsync,
      queryVectorsAsync,
      readMemoryAsync,
      writeMemoryAsync,
    },
    embedAsync,
    llmGenerateAsync,
    sandbox: { evaluateSandboxedAsync },
    // Мок повторяет сигнатуру fetch: достаточно, чтобы инструмент получил
    // предсказуемый ответ и тест проверил аргументы вызова.
    fetchAsync: fetchAsync as unknown as typeof fetch,
    dnsLookupAsync,
    ...overrides,
  };

  return {
    context,
    mocks: {
      insertVectorAsync,
      queryVectorsAsync,
      readMemoryAsync,
      writeMemoryAsync,
      embedAsync,
      llmGenerateAsync,
      evaluateSandboxedAsync,
      fetchAsync,
      dnsLookupAsync,
    },
  };
}

/**
 * Юнит-тесты инструментов агента (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Каждый инструмент проверяется изолированно: внешние сервисы заменены
 * моками контекста, поэтому тесты не ходят в сеть, БД и WASM.
 */
describe('TOOL_REGISTRY (R7.4b)', () => {
  it('содержит ровно семь инструментов DESIGN § 3.4', () => {
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([
      'code_eval',
      'http_request',
      'llm_call',
      'memory_read',
      'memory_write',
      'vector_query',
      'vector_upsert',
    ]);
  });

  it('http_request: POST с JSON-телом уходит в fetch, ответ возвращается как данные', async () => {
    const { context, mocks } = createContext();

    const result = await TOOL_REGISTRY.http_request.executeAsync(
      { method: 'POST', url: 'https://api.test/items', body: { a: 1 } },
      context,
    );

    expect(mocks.fetchAsync).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetchAsync.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect(url).toBe('https://api.test/items');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.body).toBe('{"a":1}');
    // Таймаут обязателен для внешнего вызова (RULES 4.19).
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      status: 200,
      ok: true,
      body: '{"ok":true}',
    });
  });

  it('http_request: не-2xx — это данные, а не исключение; длинное тело обрезается', async () => {
    const { context } = createContext({
      fetchAsync: vi.fn(() =>
        Promise.resolve(new Response('x'.repeat(5_000), { status: 503 })),
      ) as unknown as typeof fetch,
    });

    const result = (await TOOL_REGISTRY.http_request.executeAsync(
      { url: 'https://api.test/fail' },
      context,
    )) as { status: number; ok: boolean; body: string };

    expect(result.status).toBe(503);
    expect(result.ok).toBe(false);
    expect(result.body.endsWith('… (truncated)')).toBe(true);
  });

  it('http_request: невалидный url и неизвестный метод отвергаются Zod-схемой', async () => {
    const { context, mocks } = createContext();

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { url: 'not-a-url' },
        context,
      ),
    ).rejects.toThrow();

    await expect(
      TOOL_REGISTRY.http_request.executeAsync(
        { method: 'PATCH', url: 'https://api.test' },
        context,
      ),
    ).rejects.toThrow();

    expect(mocks.fetchAsync).not.toHaveBeenCalled();
  });

  it('vector_query: эмбеддит query и ищет по коллекции без порога score', async () => {
    const matches = [
      {
        id: 'v1',
        content: { text: 'молоко' },
        metadata: {},
        score: 0.91,
      },
    ];
    const { context, mocks } = createContext();

    mocks.queryVectorsAsync.mockResolvedValue(matches);

    const result = await TOOL_REGISTRY.vector_query.executeAsync(
      { collection: 'docs', query: 'молоко', topK: 3 },
      context,
    );

    expect(mocks.embedAsync).toHaveBeenCalledWith(
      ['молоко'],
      'text-embedding-3-small',
    );
    expect(mocks.queryVectorsAsync).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      collection: 'docs',
      embedding: vector(),
      topK: 3,
      // Инструмент отдаёт topK ближайших: релевантность оценивает агент.
      scoreThreshold: -1,
    });
    expect(result).toEqual(matches);
  });

  it('vector_upsert: пишет content в коллекцию и возвращает id', async () => {
    const { context, mocks } = createContext();

    const result = await TOOL_REGISTRY.vector_upsert.executeAsync(
      { collection: 'docs', content: 'хлеб' },
      context,
    );

    expect(mocks.embedAsync).toHaveBeenCalledWith(
      ['хлеб'],
      'text-embedding-3-small',
    );
    expect(mocks.insertVectorAsync).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      collection: 'docs',
      embedding: vector(),
      content: { text: 'хлеб' },
      metadata: {},
    });
    expect(result).toEqual({ id: 'vec-1', collection: 'docs' });
  });

  it('memory_write → memory_read: значение и флаг found', async () => {
    const { context, mocks } = createContext();

    await expect(
      TOOL_REGISTRY.memory_write.executeAsync(
        { key: 'profile', value: { user: 'Аня' } },
        context,
      ),
    ).resolves.toEqual({ key: 'profile', saved: true });

    expect(mocks.writeMemoryAsync).toHaveBeenCalledWith('wf-1', 'profile', {
      user: 'Аня',
    });

    await expect(
      TOOL_REGISTRY.memory_read.executeAsync({ key: 'profile' }, context),
    ).resolves.toEqual({ found: false, value: null });

    mocks.readMemoryAsync.mockResolvedValue({ user: 'Аня' });
    await expect(
      TOOL_REGISTRY.memory_read.executeAsync({ key: 'profile' }, context),
    ).resolves.toEqual({ found: true, value: { user: 'Аня' } });
  });

  it('code_eval: делегирует песочнице и не глушит её ошибку', async () => {
    const { context, mocks } = createContext();

    await expect(
      TOOL_REGISTRY.code_eval.executeAsync(
        { expression: 'input.value * 2', input: { value: 21 } },
        context,
      ),
    ).resolves.toEqual({ result: 42 });

    expect(mocks.evaluateSandboxedAsync).toHaveBeenCalledWith('input.value * 2', {
      value: 21,
    });

    mocks.evaluateSandboxedAsync.mockRejectedValue(
      new Error('Sandbox disabled in env (SANDBOX_ENABLED=false)'),
    );
    await expect(
      TOOL_REGISTRY.code_eval.executeAsync(
        { expression: '1 + 1' },
        context,
      ),
    ).rejects.toThrow('Sandbox disabled');
  });

  it('llm_call: модель берётся из аргумента, иначе — модель агента', async () => {
    const { context, mocks } = createContext();

    await expect(
      TOOL_REGISTRY.llm_call.executeAsync(
        { model: 'gpt-mini', prompt: 'Привет' },
        context,
      ),
    ).resolves.toEqual({
      model: 'gpt-mini',
      text: 'ответ модели',
      usage: null,
    });

    await TOOL_REGISTRY.llm_call.executeAsync({ prompt: 'Ещё раз' }, context);

    expect(mocks.llmGenerateAsync).toHaveBeenLastCalledWith(
      'Ещё раз',
      'claude-test',
    );
  });
});
