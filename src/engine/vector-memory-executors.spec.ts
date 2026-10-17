import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMBEDDING_DIMENSIONS } from '../llm/llm-constants.js';
import {
  NodeDataValidationException,
  executeMemoryReadNodeAsync,
  executeMemoryWriteNodeAsync,
  executeVectorQueryNodeAsync,
  executeVectorUpsertNodeAsync,
  type VectorMemoryContext,
  type VectorMemoryStore,
} from './node-executors.js';

/**
 * Вектор нужной размерности: колонка `workflow_vectors.embedding` — vector(1536).
 *
 * @param fill - значение каждой компоненты
 * @returns массив длины {@link DEFAULT_EMBEDDING_DIMENSIONS}
 */
function vector(fill = 0.1): number[] {
  return Array.from({ length: DEFAULT_EMBEDDING_DIMENSIONS }, () => fill);
}

/** Заглушки методов хранилища и эмбеддингов — общие для всех кейсов. */
interface Mocks {
  embedAsync: ReturnType<
    typeof vi.fn<(texts: string[], model: string) => Promise<number[][]>>
  >;
  insertVectorAsync: ReturnType<typeof vi.fn>;
  queryVectorsAsync: ReturnType<typeof vi.fn>;
  readMemoryAsync: ReturnType<typeof vi.fn>;
  writeMemoryAsync: ReturnType<typeof vi.fn>;
}

/**
 * Собирает контекст с моками (RULES 4.14: `vi.fn`, не `jest.fn`).
 *
 * @returns контекст и моки для проверки аргументов вызовов
 */
function createContext(): { context: VectorMemoryContext; mocks: Mocks } {
  const embedAsync = vi.fn<(texts: string[], model: string) => Promise<number[][]>>(
    () => Promise.resolve([vector()]),
  );
  const insertVectorAsync = vi.fn(() => Promise.resolve({ id: 'vec-1' }));
  const queryVectorsAsync = vi.fn(() => Promise.resolve([]));
  const readMemoryAsync = vi.fn(() => Promise.resolve(undefined));
  const writeMemoryAsync = vi.fn(() => Promise.resolve());

  const store: VectorMemoryStore = {
    insertVectorAsync,
    queryVectorsAsync,
    readMemoryAsync,
    writeMemoryAsync,
  };

  return {
    context: { workflowId: 'wf-1', store, embedAsync },
    mocks: {
      embedAsync,
      insertVectorAsync,
      queryVectorsAsync,
      readMemoryAsync,
      writeMemoryAsync,
    },
  };
}

describe('executeVectorUpsertNodeAsync (R7.4a)', () => {
  it('векторизует inputs.prompt и пишет запись с content={ text }', async () => {
    const { context, mocks } = createContext();

    const outputs = await executeVectorUpsertNodeAsync(
      { collection: 'docs', embeddingModel: 'text-embedding-3-small' },
      { prompt: 'привет, мир' },
      context,
    );

    expect(mocks.embedAsync).toHaveBeenCalledWith(
      ['привет, мир'],
      'text-embedding-3-small',
    );
    expect(mocks.insertVectorAsync).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      collection: 'docs',
      embedding: vector(),
      content: { text: 'привет, мир' },
      metadata: {},
    });
    expect(outputs).toEqual({ result: { id: 'vec-1', collection: 'docs' } });
  });

  it('contentField имеет приоритет над prompt, а пустое поле — ошибка', async () => {
    const { context, mocks } = createContext();

    await executeVectorUpsertNodeAsync(
      { collection: 'docs', embeddingModel: 'm', contentField: 'body' },
      { body: 'из поля body', prompt: 'из prompt' },
      context,
    );

    expect(mocks.embedAsync).toHaveBeenCalledWith(['из поля body'], 'm');
  });

  it('без связи берёт текст из textarea узла (data.prompt)', async () => {
    const { context, mocks } = createContext();

    await executeVectorUpsertNodeAsync(
      { collection: 'docs', embeddingModel: 'm', prompt: 'текст из узла' },
      {},
      context,
    );

    expect(mocks.embedAsync).toHaveBeenCalledWith(['текст из узла'], 'm');
  });

  it('падает понятной ошибкой, если текст не задан нигде', async () => {
    const { context } = createContext();

    await expect(
      executeVectorUpsertNodeAsync(
        { collection: 'docs', embeddingModel: 'm' },
        {},
        context,
      ),
    ).rejects.toThrow('Узел vector_upsert: не задан текст');
  });

  it('валидирует data: пустой collection — NodeDataValidationException', async () => {
    const { context } = createContext();

    await expect(
      executeVectorUpsertNodeAsync(
        { collection: '', embeddingModel: 'm' },
        { prompt: 'x' },
        context,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });

  it('отклоняет вектор неверной размерности (text-embedding-3-large → 3072)', async () => {
    const { context, mocks } = createContext();

    mocks.embedAsync.mockResolvedValue([Array.from({ length: 3072 }, () => 0.1)]);

    await expect(
      executeVectorUpsertNodeAsync(
        { collection: 'docs', embeddingModel: 'text-embedding-3-large' },
        { prompt: 'x' },
        context,
      ),
    ).rejects.toThrow('размерности 3072, ожидается 1536');
    expect(mocks.insertVectorAsync).not.toHaveBeenCalled();
  });
});

describe('executeVectorQueryNodeAsync (R7.4a)', () => {
  it('передаёт topK/scoreThreshold и возвращает совпадения в result', async () => {
    const { context, mocks } = createContext();
    const matches = [
      { id: 'v1', content: { text: 'a' }, metadata: {}, score: 0.91 },
    ];

    mocks.queryVectorsAsync.mockResolvedValue(matches);

    const outputs = await executeVectorQueryNodeAsync(
      {
        collection: 'docs',
        embeddingModel: 'text-embedding-3-small',
        topK: 3,
        scoreThreshold: 0.5,
      },
      { prompt: 'запрос' },
      context,
    );

    expect(mocks.queryVectorsAsync).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      collection: 'docs',
      embedding: vector(),
      topK: 3,
      scoreThreshold: 0.5,
    });
    expect(outputs).toEqual({ result: matches });
  });

  it('применяет дефолты DESIGN § 3.4: topK=5, scoreThreshold=0.7', async () => {
    const { context, mocks } = createContext();

    await executeVectorQueryNodeAsync(
      { collection: 'docs', embeddingModel: 'm' },
      { prompt: 'q' },
      context,
    );

    expect(mocks.queryVectorsAsync.mock.calls[0][0]).toMatchObject({
      topK: 5,
      scoreThreshold: 0.7,
    });
  });

  it('валидирует topK: 0 — ошибка данных узла', async () => {
    const { context } = createContext();

    await expect(
      executeVectorQueryNodeAsync(
        { collection: 'docs', embeddingModel: 'm', topK: 0 },
        { prompt: 'q' },
        context,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });
});

describe('executeMemoryReadNodeAsync (R7.4a)', () => {
  it('возвращает значение и found=true, если ключ есть', async () => {
    const { context, mocks } = createContext();

    mocks.readMemoryAsync.mockResolvedValue({ user: 'Аня' });

    const outputs = await executeMemoryReadNodeAsync(
      { key: 'profile' },
      {},
      context,
    );

    expect(mocks.readMemoryAsync).toHaveBeenCalledWith('wf-1', 'profile');
    expect(outputs).toEqual({ result: { user: 'Аня' }, found: true });
  });

  it('отличает отсутствующий ключ (undefined) от сохранённого null', async () => {
    const { context, mocks } = createContext();

    mocks.readMemoryAsync.mockResolvedValue(null);
    await expect(
      executeMemoryReadNodeAsync({ key: 'k' }, {}, context),
    ).resolves.toEqual({ result: null, found: true });

    mocks.readMemoryAsync.mockResolvedValue(undefined);
    await expect(
      executeMemoryReadNodeAsync({ key: 'k' }, {}, context),
    ).resolves.toEqual({ result: null, found: false });
  });

  it('пустой key — NodeDataValidationException', async () => {
    const { context } = createContext();

    await expect(
      executeMemoryReadNodeAsync({ key: '  ' }, {}, context),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });
});

describe('executeMemoryWriteNodeAsync (R7.4a)', () => {
  it('берёт значение из inputs.prompt и делает UPSERT через хранилище', async () => {
    const { context, mocks } = createContext();

    const outputs = await executeMemoryWriteNodeAsync(
      { key: 'last' },
      { prompt: 'запомнить это' },
      context,
    );

    expect(mocks.writeMemoryAsync).toHaveBeenCalledWith(
      'wf-1',
      'last',
      'запомнить это',
    );
    expect(outputs).toEqual({ result: 'запомнить это', key: 'last' });
  });

  it('valueField имеет приоритет и отсутствие поля — ошибка', async () => {
    const { context, mocks } = createContext();

    await executeMemoryWriteNodeAsync(
      { key: 'k', valueField: 'result' },
      { result: { ok: true }, prompt: 'игнор' },
      context,
    );

    expect(mocks.writeMemoryAsync).toHaveBeenCalledWith('wf-1', 'k', { ok: true });

    await expect(
      executeMemoryWriteNodeAsync(
        { key: 'k', valueField: 'missing' },
        { prompt: 'x' },
        context,
      ),
    ).rejects.toThrow("поле входа 'missing' не найдено");
  });

  it('без связи берёт значение из textarea узла', async () => {
    const { context, mocks } = createContext();

    await executeMemoryWriteNodeAsync({ key: 'k', value: 'из узла' }, {}, context);

    expect(mocks.writeMemoryAsync).toHaveBeenCalledWith('wf-1', 'k', 'из узла');
  });

  it('без значения и без textarea падает понятной ошибкой', async () => {
    const { context } = createContext();

    await expect(
      executeMemoryWriteNodeAsync({ key: 'k' }, {}, context),
    ).rejects.toThrow('Узел memory_write: не задано значение');
  });
});
