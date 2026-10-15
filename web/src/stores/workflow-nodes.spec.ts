import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkflowAsync, type ApiWorkflow } from '@/lib/api';
import type { ApiGraphNode } from '@/lib/api';
import { useWorkflowStore } from './workflow';
import type { NodeType } from '@/types/graph';

/**
 * Заглушка i18n: настоящий модуль на импорте пишет `document.documentElement.lang`
 * (см. `@/i18n`), а тесты идут в `environment: 'node'` — без jsdom (KI-155).
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
 * (KI-271), а в node-окружении `window` нет. `null` — «страницу не
 * перезагружали посреди запуска», то есть поток не переподписывается.
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

  it('condition: пустые операнды и === по умолчанию', () => {
    expect(dataOfNewNode('condition')).toEqual({
      kind: 'condition',
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
      left: 'input.value',
      operator: '===',
      right: '10',
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
