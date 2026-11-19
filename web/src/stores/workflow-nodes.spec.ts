import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkflowAsync,
  getWorkflowAsync,
  type ApiWorkflow,
} from '@/lib/api';
import type { ApiGraphNode } from '@/lib/api';
import { useWorkflowStore } from './workflow';
import { REASONING_EFFORTS } from '@/lib/llm-node-fields';
import type { AppNode, NodeType } from '@/types/graph';

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

  return {
    ...actual,
    getWorkflowAsync: vi.fn(),
    createWorkflowAsync: vi.fn(),
  };
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

  it('llm: переносит prompt/systemPrompt/reasoningEffort/maxTokensOverride', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-llm-1',
      userId: 'user-smoke',
      name: 'llm',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'llm-1',
          type: 'llm',
          position: AT_ZERO,
          data: {
            model: 'gpt-4o',
            prompt: 'Вопрос пользователя',
            systemPrompt: 'Ты помощник',
            // KI-249: расширенные режимы больше не теряются при Load.
            reasoningEffort: 'low',
            maxTokensOverride: 4096,
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-llm-1');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'llm',
      model: 'gpt-4o',
      prompt: 'Вопрос пользователя',
      systemPrompt: 'Ты помощник',
      reasoningEffort: 'low',
      maxTokensOverride: 4096,
    });
  });

  it('llm: все шесть режимов reasoning переживают Load (KI-249/251)', async () => {
    for (const effort of REASONING_EFFORTS) {
      useWorkflowStore.setState({ nodes: [], edges: [] });
      vi.mocked(getWorkflowAsync).mockResolvedValue({
        id: `wf-llm-${effort}`,
        userId: 'user-smoke',
        name: 'llm-effort',
        version: 1,
        edges: [],
        nodes: [
          {
            id: `llm-${effort}`,
            type: 'llm',
            position: AT_ZERO,
            data: { prompt: 'x', reasoningEffort: effort },
          },
        ],
      });

      await state().loadWorkflowAsync(`wf-llm-${effort}`);

      expect(state().nodes[0]?.data, effort).toMatchObject({
        reasoningEffort: effort,
      });
    }
  });

  it('llm: старый value → prompt, мусор отбрасывается (KI-251)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-llm-2',
      userId: 'user-smoke',
      name: 'llm-мусор',
      version: 1,
      edges: [],
      nodes: [
        {
          id: 'llm-2',
          type: 'llm',
          position: AT_ZERO,
          data: {
            model: 42,
            value: 'старый промпт',
            systemPrompt: 7,
            reasoningEffort: 'ultra',
            maxTokensOverride: -1,
          },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-llm-2');

    expect(state().nodes[0]?.data).toEqual({
      kind: 'llm',
      model: '',
      prompt: 'старый промпт',
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

describe('KI-252: новые узлы выравниваются по сетке 8×8', () => {
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

  it('addNode: позиция из Toolbar округляется до шага сетки', () => {
    state().addNode('text', { x: 13, y: 200.5 });

    expect(state().nodes[0]?.position).toEqual({ x: 16, y: 200 });
  });

  it('addNodeOnEdge: вставленный в связь узел тоже попадает на сетку', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-grid',
      userId: 'user-smoke',
      name: 'grid',
      version: 1,
      edges: [{ id: 'edge-1', source: 'n1', target: 'n2' }],
      nodes: [
        {
          id: 'n1',
          type: 'text',
          position: { x: 0, y: 0 },
          data: { value: 'a' },
        },
        {
          id: 'n2',
          type: 'llm',
          position: { x: 401, y: 203 },
          data: { prompt: 'b' },
        },
      ],
    });

    await state().loadWorkflowAsync('wf-grid');
    expect(state().addNodeOnEdge('edge-1', 'llm')).toBe(true);

    const inserted = state().nodes.find(
      (node) => node.id !== 'n1' && node.id !== 'n2',
    );

    expect(inserted).toBeDefined();
    expect((inserted?.position?.x ?? NaN) % 8).toBe(0);
    expect((inserted?.position?.y ?? NaN) % 8).toBe(0);
  });
});

describe('KI-254: Ctrl+D не переключает панель результата', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      notice: null,
      isLoading: false,
    });
  });

  it('selectedNodeId остаётся на оригинале, копия выделяется визуально', () => {
    state().addNode('text', AT_ZERO);
    const originalId = state().nodes[0]?.id ?? '';
    state().setSelectedNodeId(originalId);

    state().duplicateNodes([originalId]);

    const nodes = state().nodes;
    const original = nodes.find((node) => node.id === originalId);
    const copy = nodes.find((node) => node.id !== originalId);

    expect(nodes).toHaveLength(2);
    expect(state().selectedNodeId).toBe(originalId);
    expect(original?.selected).toBe(true);
    expect(copy?.selected).toBe(true);
  });
});

describe('KI-267/270: диагностика Load и DTO создания', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      currentWorkflowId: null,
      notice: null,
      isLoading: false,
    });
    vi.mocked(getWorkflowAsync).mockReset();
    vi.mocked(createWorkflowAsync).mockReset();
  });

  it('Load пишет ошибку схемы в console.warn, а не только в notice', async () => {
    const failure = new Error('Zod: неверный формат workflow');
    vi.mocked(getWorkflowAsync).mockRejectedValue(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await state().loadWorkflowAsync('wf-broken');

    expect(warn).toHaveBeenCalledWith('[loadWorkflow]', failure);
    expect(state().notice?.kind).toBe('error');
    expect(state().isLoading).toBe(false);

    warn.mockRestore();
  });

  it('POST /workflow не содержит мёртвое поле userId', async () => {
    useWorkflowStore.setState({ currentWorkflowName: 'Новый' });
    vi.mocked(createWorkflowAsync).mockResolvedValue({
      id: 'wf-new',
      userId: '11111111-1111-4111-8111-111111111111',
      name: 'Новый',
      nodes: [],
      edges: [],
      version: 1,
    });

    await state().saveWorkflowAsync();

    const payload = vi.mocked(createWorkflowAsync).mock.calls[0]?.[0];

    expect(payload).toBeDefined();
    expect(payload).not.toHaveProperty('userId');
    expect(payload).toMatchObject({ name: 'Новый', nodes: [], edges: [] });
  });
});

describe('KI-273/277: хоткеи и история Load', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      currentWorkflowId: null,
      selectedNodeId: null,
      notice: null,
      isLoading: false,
    });
  });

  it('Ctrl+A / Ctrl+C / Ctrl+V создаёт копии со сдвигом', () => {
    state().addNode('text', { x: 0, y: 0 });
    const originalId = state().nodes[0]?.id ?? '';

    state().selectAllNodes();
    expect(state().nodes[0]?.selected).toBe(true);

    state().copySelectedNodes();
    state().pasteNodes();

    const copy = state().nodes.find((node) => node.id !== originalId);

    expect(state().nodes).toHaveLength(2);
    expect(copy?.position).toEqual({ x: 30, y: 30 });
    expect(copy?.data).toEqual({ kind: 'text', value: '' });
    expect(copy?.data).not.toBe(state().nodes[0]?.data);
  });

  it('Ctrl+Shift+Backspace чистит prompt выделенных узлов', () => {
    state().addNode('llm', AT_ZERO);
    const original = state().nodes[0] as AppNode;
    const patched = {
      ...original,
      data: { ...original.data, prompt: 'старый запрос' },
    } as AppNode;
    useWorkflowStore.setState({ nodes: [patched] });

    state().clearSelectedNodesPrompt();

    expect(state().nodes[0]?.data).toMatchObject({ prompt: '' });
    expect(state().past.length).toBeGreaterThan(0);
  });

  it('Load очищает историю undo/redo (KI-277)', async () => {
    useWorkflowStore.setState({
      past: [{ nodes: [], edges: [] }],
      future: [{ nodes: [], edges: [] }],
    });
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'wf-load-history',
      userId: 'user-smoke',
      name: 'load',
      version: 1,
      edges: [],
      nodes: [],
    });

    await state().loadWorkflowAsync('wf-load-history');

    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
    expect(state().canUndo()).toBe(false);
  });
});
