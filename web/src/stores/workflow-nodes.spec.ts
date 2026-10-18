import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkflowAsync, type ApiWorkflow } from '@/lib/api';
import type { ApiGraphNode } from '@/lib/api';
import { useWorkflowStore } from './workflow';
import type { NodeType } from '@/types/graph';

/**
 * Заглушка i18n: jsdom настроен (KI-155), но тест проверяет стор, а не
 * переводы. Подмена убирает зависимость от языка и побочных эффектов
 * `@/i18n` (`document.documentElement.lang`, localStorage).
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return { default: { t, language: 'ru' }, setLanguage: () => undefined };
});

/**
 * Частичная заглушка API: настоящие функции остаются, подменяется только
 * `getWorkflowAsync` — Load идёт ровно тем же путём, что и в браузере
 * (`fromApiWorkflow` → `nodeDataFromApi`), но без сети.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();

  return { ...actual, getWorkflowAsync: vi.fn() };
});

/**
 * Заглушка url-sync: `loadWorkflowAsync` читает `?runId=` из адресной строки
 * (KI-271). jsdom-`window` есть (KI-155), но тест не должен зависеть от
 * адреса тестового документа. `null` — «страницу не перезагружали посреди
 * запуска», то есть поток не переподписывается.
 */
vi.mock('@/lib/url-sync', () => ({
  getRunIdFromUrl: () => null,
  setRunIdInUrl: () => undefined,
  clearRunIdFromUrl: () => undefined,
}));

/** Позиция узла для тестов (на графе она не важна). */
const AT_ZERO = { x: 0, y: 0 };

/** Короткий доступ к состоянию. */
function state() {
  return useWorkflowStore.getState();
}

/**
 * Добавляет узел типа и возвращает его данные.
 *
 * @param type - тип узла
 * @returns `data` созданного узла
 */
function dataOfNewNode(type: NodeType): Record<string, unknown> {
  state().addNode(type, AT_ZERO);

  const nodes = state().nodes;

  return nodes[nodes.length - 1]?.data ?? {};
}

/**
 * Собирает ответ backend из узлов стора — как это сделал бы Save.
 *
 * @param nodes - узлы графа редактора
 * @returns workflow в формате API
 */
function workflowFromStore(nodes: readonly ApiGraphNode[]): ApiWorkflow {
  return {
    id: 'wf-round-trip',
    userId: 'user-smoke',
    name: 'R6.5.2 round-trip',
    nodes: [...nodes],
    edges: [],
    version: 1,
  };
}

describe('createNode — дефолты узлов R6.5.2', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ nodes: [], edges: [], past: [], future: [] });
  });

  it('http: GET и пустой URL, лишних ключей нет (KI-129)', () => {
    const data = dataOfNewNode('http');

    expect(data).toEqual({ kind: 'http', method: 'GET', url: '' });
    // `headers`/`body`/`timeoutMs` не создаём заранее: иначе пустые ключи
    // попадали бы в JSON и в `Object.keys(data)`.
    expect(Object.keys(data).sort()).toEqual(['kind', 'method', 'url']);
  });

  it('condition: пустые операнды, === и DSL по умолчанию', () => {
    expect(dataOfNewNode('condition')).toEqual({
      kind: 'condition',
      mode: 'dsl',
      left: '',
      operator: '===',
      right: '',
    });
  });

  it('output: имя выхода по умолчанию — result', () => {
    expect(dataOfNewNode('output')).toEqual({ kind: 'output', name: 'result' });
  });

  it('compare: единственный поддерживаемый режим — diff', () => {
    expect(dataOfNewNode('compare')).toEqual({ kind: 'compare', mode: 'diff' });
  });

  it('тип узла в графе совпадает с типом реестра', () => {
    for (const type of ['http', 'condition', 'output', 'compare'] as const) {
      useWorkflowStore.setState({ nodes: [], edges: [], past: [], future: [] });
      state().addNode(type, AT_ZERO);

      expect(state().nodes[0]?.type, type).toBe(type);
    }
  });
});

describe('nodeDataFromApi — Load узлов R6.5.2', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      notice: null,
      isLoading: false,
    });
    vi.mocked(getWorkflowAsync).mockReset();
  });

  it('http: переносит method/url/headers/body/timeoutMs', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-1',
      userId: 'user-smoke',
      name: 'http',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'http-1',
          type: 'http',
          position: AT_ZERO,
          data: {
            kind: 'http',
            method: 'POST',
            url: 'https://api.example.com/items',
            headers: { 'X-Api-Key': 'secret' },
            body: '{"q":1}',
            timeoutMs: 5000,
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-1');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'http',
      method: 'POST',
      url: 'https://api.example.com/items',
      headers: { 'X-Api-Key': 'secret' },
      body: '{"q":1}',
      timeoutMs: 5000,
    });
  });

  it('http: мусор из jsonb отбрасывается, неизвестный метод → GET', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-2',
      userId: 'user-smoke',
      name: 'http-мусор',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'http-2',
          type: 'http',
          position: AT_ZERO,
          data: {
            method: 'PATCH',
            url: 42,
            headers: { A: 1, B: 'ok' },
            body: 7,
            timeoutMs: '5000',
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-2');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'http',
      method: 'GET',
      url: '',
      headers: { B: 'ok' },
    });
  });

  it('condition: операнды переносятся, неизвестная операция → ===', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-3',
      userId: 'user-smoke',
      name: 'condition',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'cond-1',
          type: 'condition',
          position: AT_ZERO,
          data: { left: 'input.value', operator: '!=', right: '10' },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-3');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'condition',
      mode: 'dsl',
      left: 'input.value',
      operator: '===',
      right: '10',
    });
  });

  it('condition: mode=sandbox и expression переносятся (R7.5)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-3b',
      userId: 'user-smoke',
      name: 'condition-sandbox',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'cond-2',
          type: 'condition',
          position: AT_ZERO,
          data: {
            mode: 'sandbox',
            expression: 'input.length > 3',
            left: '',
            operator: '===',
            right: '',
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-3b');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'condition',
      mode: 'sandbox',
      left: '',
      operator: '===',
      right: '',
      expression: 'input.length > 3',
    });
  });

  it('output: имя не подменяется (пустое остаётся пустым — ср. KI-069)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-4',
      userId: 'user-smoke',
      name: 'output',
      version: 1,
      edges: [],
      nodes: [
        { id: 'out-1', type: 'output', position: AT_ZERO, data: { name: 'answer' } },
        { id: 'out-2', type: 'output', position: AT_ZERO, data: {} },
      ],
    });

    await state().loadWorkflowAsync('wf-4');

    expect(state().nodes[0]?.data).toEqual({ kind: 'output', name: 'answer' });
    expect(state().nodes[1]?.data).toEqual({ kind: 'output', name: '' });
  });

  it('compare: чужой режим (llm-judge) не переносится — узел остаётся запускаемым', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-5',
      userId: 'user-smoke',
      name: 'compare',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'cmp-1',
          type: 'compare',
          position: AT_ZERO,
          data: { mode: 'llm-judge' },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-5');

    expect(state().nodes[0]?.data).toEqual({ kind: 'compare', mode: 'diff' });
  });

  it('узел неизвестного типа пропускается с предупреждением (KI-121)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-6',
      userId: 'user-smoke',
      name: 'note',
      version: 1,
      edges: [],
      nodes: [
        { id: 'note-1', type: 'note', position: AT_ZERO, data: { text: 'стикер' } },
        { id: 'out-1', type: 'output', position: AT_ZERO, data: { name: 'result' } },
      ],
    });

    await state().loadWorkflowAsync('wf-6');

    expect(state().nodes).toHaveLength(1);
    expect(state().nodes[0]?.id).toBe('out-1');
    expect(state().notice?.kind).toBe('error');
  });

  it('round-trip Save → Load идемпотентен: второй Load не теряет поля', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-7',
      userId: 'user-smoke',
      name: 'round-trip',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'http-1',
          type: 'http',
          position: AT_ZERO,
          data: { method: 'PUT', url: 'https://api.example.com', timeoutMs: 1000 },
        },
        {
          id: 'cond-1',
          type: 'condition',
          position: AT_ZERO,
          data: { left: 'input.value', operator: 'includes', right: "'ок'" },
        },
        { id: 'out-1', type: 'output', position: AT_ZERO, data: { name: 'answer' } },
        { id: 'cmp-1', type: 'compare', position: AT_ZERO, data: { mode: 'diff' } },
      ],
    });

    await state().loadWorkflowAsync('wf-7');
    const firstLoad = state().nodes.map((node) => node.data);

    // Второй Load — из того, что узел отдал бы на Save (`toApiNode`).
    vi.mocked(getWorkflowAsync).mockResolvedValue(
      workflowFromStore(
        state().nodes.map((node) => ({
          id: node.id,
          type: node.type ?? '',
          position: node.position,
          data: node.data,
        })),
      ),
    );

    useWorkflowStore.setState({ nodes: [] });
    await state().loadWorkflowAsync('wf-7');

    expect(state().nodes.map((node) => node.data)).toEqual(firstLoad);
    expect(firstLoad).toHaveLength(4);
  });
});

describe('sub_workflow — createNode и Load (R6.7, KI-200)', () => {
  /** uuid подграфа (как в БД). */
  const SUB_WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      notice: null,
      isLoading: false,
    });
    vi.mocked(getWorkflowAsync).mockReset();
  });

  it('createNode: пустая ссылка и никаких лишних ключей', () => {
    const data = dataOfNewNode('sub_workflow');

    expect(data).toEqual({ kind: 'sub_workflow', workflowId: '' });
    // `version` появится только в момент выбора подграфа (DESIGN § 5.5).
    expect(Object.keys(data).sort()).toEqual(['kind', 'workflowId']);
  });

  it('type узла в графе — sub_workflow (backend-контракт, KI-200)', () => {
    state().addNode('sub_workflow', AT_ZERO);

    expect(state().nodes[0]?.type).toBe('sub_workflow');
  });

  it('nodeDataFromApi: переносит workflowId, version и inputsMap', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-sub',
      userId: 'user-smoke',
      name: 'Родитель',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'sub-1',
          type: 'sub_workflow',
          position: AT_ZERO,
          data: {
            kind: 'sub_workflow',
            workflowId: SUB_WORKFLOW_ID,
            version: 4,
            inputsMap: { prompt: 'text' },
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-sub');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'sub_workflow',
      workflowId: SUB_WORKFLOW_ID,
      version: 4,
      inputsMap: { prompt: 'text' },
    });
  });

  it('nodeDataFromApi: мусор из jsonb отбрасывается, ссылка остаётся пустой', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-sub-мусор',
      userId: 'user-smoke',
      name: 'мусор',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'sub-2',
          type: 'sub_workflow',
          position: AT_ZERO,
          data: {
            kind: 'sub_workflow',
            workflowId: 42,
            version: '4',
            inputsMap: { prompt: 1 },
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-sub-мусор');

    // Пустое значение честно остаётся пустым (KI-069): подстановки «первого
    // попавшегося» workflow нет, Run упадёт валидацией на backend.
    expect(state().nodes[0]?.data).toEqual({ kind: 'sub_workflow', workflowId: '' });
  });

  it('round-trip Save → Load сохраняет ссылку и снимок версии', async () => {
    const data = {
      kind: 'sub_workflow',
      workflowId: SUB_WORKFLOW_ID,
      version: 4,
      inputsMap: { prompt: 'text' },
    };

    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-sub-2',
      userId: 'user-smoke',
      name: 'round-trip',
      version: 1,
      edges: [],
      nodes: [
        { id: 'sub-3', type: 'sub_workflow', position: AT_ZERO, data },
      ],
    });

    await state().loadWorkflowAsync('wf-sub-2');
    const firstLoad = state().nodes[0]?.data;

    // Второй Load — из того, что узел отдал бы на Save (`toApiNode`).
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-sub-2',
      userId: 'user-smoke',
      name: 'round-trip',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'sub-3',
          type: 'sub_workflow',
          position: AT_ZERO,
          data: firstLoad ?? {},
        },
      ],
    });

    useWorkflowStore.setState({ nodes: [] });
    await state().loadWorkflowAsync('wf-sub-2');

    expect(state().nodes[0]?.data).toEqual(firstLoad);
  });
});

describe('vector/memory — createNode и Load (R7.4a, KI-128)', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      notice: null,
      isLoading: false,
    });
    vi.mocked(getWorkflowAsync).mockReset();
  });

  it('createNode: vector_upsert — модель по умолчанию, пустая коллекция', () => {
    const data = dataOfNewNode('vector_upsert');

    expect(data).toEqual({
      kind: 'vector_upsert',
      collection: '',
      embeddingModel: 'text-embedding-3-small',
    });
  });

  it('createNode: vector_query — дефолты topK=5 и scoreThreshold=0.7', () => {
    const data = dataOfNewNode('vector_query');

    expect(data).toEqual({
      kind: 'vector_query',
      collection: '',
      embeddingModel: 'text-embedding-3-small',
      topK: 5,
      scoreThreshold: 0.7,
    });
  });

  it('createNode: memory_read / memory_write — пустой ключ, без лишних полей', () => {
    expect(dataOfNewNode('memory_read')).toEqual({ kind: 'memory_read', key: '' });
    expect(dataOfNewNode('memory_write')).toEqual({ kind: 'memory_write', key: '' });
  });

  it('nodeDataFromApi: поля vector_upsert/vector_query переносятся и валидируются', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-vector',
      userId: 'user-smoke',
      name: 'R7.4a',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'vu-1',
          type: 'vector_upsert',
          position: AT_ZERO,
          data: {
            kind: 'vector_upsert',
            collection: 'docs',
            embeddingModel: 'text-embedding-3-small',
            contentField: 'body',
            prompt: 'текст',
          },
        },
        {
          id: 'vq-1',
          type: 'vector_query',
          position: AT_ZERO,
          data: {
            kind: 'vector_query',
            collection: 'docs',
            embeddingModel: 'text-embedding-3-large',
            topK: 500,
            scoreThreshold: 7,
          },
        },
        {
          id: 'mr-1',
          type: 'memory_read',
          position: AT_ZERO,
          data: { kind: 'memory_read', key: 42 },
        },
        {
          id: 'mw-1',
          type: 'memory_write',
          position: AT_ZERO,
          data: { kind: 'memory_write', key: 'profile', value: 'Аня' },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-vector');

    const loaded = state().nodes.map((node) => node.data);

    expect(loaded[0]).toEqual({
      kind: 'vector_upsert',
      collection: 'docs',
      embeddingModel: 'text-embedding-3-small',
      contentField: 'body',
      prompt: 'текст',
    });
    // 3-large не помещается в vector(1536) → дефолт; topK 500 и порог 7
    // отбрасываются (backend применит свои дефолты).
    expect(loaded[1]).toEqual({
      kind: 'vector_query',
      collection: 'docs',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(loaded[2]).toEqual({ kind: 'memory_read', key: '' });
    expect(loaded[3]).toEqual({
      kind: 'memory_write',
      key: 'profile',
      value: 'Аня',
    });
  });
});
