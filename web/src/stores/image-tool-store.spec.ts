import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from './workflow';
import { fetchRunBudgetAsync, getWorkflowAsync } from '@/lib/api';
import type { AppNode, ImageToolNodeData } from '@/types/graph';

/**
 * Заглушка i18n: jsdom настроен (KI-155), но тест проверяет стор, а не
 * переводы. Подмена убирает зависимость от языка и побочных эффектов
 * `@/i18n` (`document.documentElement.lang`, localStorage).
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return {
    default: { t, language: 'ru' },
    setLanguage: () => undefined,
  };
});

/**
 * Заглушка API-слоя (R7.1): узел `image_tool` и бюджет запуска проверяются без
 * сети. Остальные функции модуля возвращаются заглушками, чтобы импорт стора
 * не тянул реальные запросы.
 */
vi.mock('@/lib/api', () => ({
  createRunAsync: vi.fn(),
  createWorkflowAsync: vi.fn(),
  fetchLlmModelsAsync: vi.fn(() => Promise.resolve([])),
  fetchMediaModelsAsync: vi.fn(() => Promise.resolve([])),
  fetchRunBudgetAsync: vi.fn(),
  getWorkflowAsync: vi.fn(),
  planWorkflowAsync: vi.fn(),
  updateWorkflowAsync: vi.fn(),
}));

/** Заглушка SSE-потока: подписка в этих тестах не нужна. */
vi.mock('@/lib/run-stream', () => ({
  subscribeToRunStream: vi.fn(() => () => undefined),
  RunStreamUnavailableError: class RunStreamUnavailableError extends Error {},
}));

/** Идентификатор запуска в тестах. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** Ответ ручки бюджета (значения — как в DESIGN: USD-нормализация + рубли). */
const BUDGET_RESPONSE = {
  ok: true,
  accumulated: 0.15,
  estimated: 0,
  remaining: 4.85,
  maxUsd: 5,
  maxRub: 500,
  mode: 'hard' as const,
};

/**
 * Короткий доступ к состоянию стора.
 *
 * @returns текущее состояние
 */
function state() {
  return useWorkflowStore.getState();
}

describe('useWorkflowStore — узел image_tool (R7.1, KI-196)', () => {
  beforeEach(() => {
    // `loadWorkflowAsync` читает `?runId=` из адресной строки. jsdom-`window`
    // есть (KI-155), но подменяем location/history: тест не должен зависеть
    // от адреса тестового документа и трогать реальную историю.
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/?workflowId=w1' },
      history: { replaceState: () => undefined },
    });
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      past: [],
      future: [],
      selectedNodeId: null,
      toolModels: [],
      toolModelsLoaded: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('addNode создаёт узел с операцией bg_removal и без модели', () => {
    state().addNode('image_tool', { x: 0, y: 0 });

    const node = state().nodes[0];
    const data = node?.data as ImageToolNodeData;

    expect(node?.type).toBe('image_tool');
    expect(data.kind).toBe('image_tool');
    expect(data.operation).toBe('bg_removal');
    // Модель не подставляется молча (KI-069): пусто — дефолт операции.
    expect(data.model).toBeUndefined();
  });

  it('addNode подставляет модель-инструмент, если каталог уже загружен', () => {
    useWorkflowStore.setState({
      toolModels: [
        {
          id: 'bgremover',
          code: 'bgremover',
          type: 'IMAGE',
          price: 10,
          priceUnit: 'per_generation',
          priceInput: null,
          priceInputUnit: null,
          moderation: 'auto',
          prompt: 'required',
          params: [],
          inputs: [{ key: 'image', kind: 'image', required: true }],
        },
      ],
    });

    state().addNode('image_tool', { x: 0, y: 0 });

    const data = state().nodes[0]?.data as ImageToolNodeData;

    expect(data.model).toBe('bgremover');
  });

  it('Load переносит операцию, модель, inputUrl и params (round-trip)', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      name: 'wf',
      version: 1,
      nodes: [
        {
          id: 'tool-1',
          type: 'image_tool',
          position: { x: 0, y: 0 },
          data: {
            operation: 'upscale',
            model: 'upscale-model',
            inputUrl: 'https://cdn/in.png',
            params: { prompt: 'сделай резче' },
          },
        },
      ],
      edges: [],
    });

    await state().loadWorkflowAsync('w1');

    const data = state().nodes[0]?.data as ImageToolNodeData;

    expect(data).toEqual({
      kind: 'image_tool',
      operation: 'upscale',
      model: 'upscale-model',
      inputUrl: 'https://cdn/in.png',
      params: { prompt: 'сделай резче' },
    });
  });

  it('Load с неизвестной операцией не роняет узел: остаётся дефолт bg_removal', async () => {
    vi.mocked(getWorkflowAsync).mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      name: 'wf',
      version: 1,
      nodes: [
        {
          id: 'tool-1',
          type: 'image_tool',
          position: { x: 0, y: 0 },
          // Такого значения нет ни в DESIGN § 3.1, ни в Zod-схеме backend.
          data: { operation: 'teleport' },
        },
      ],
      edges: [],
    });

    await state().loadWorkflowAsync('w1');

    const data = state().nodes[0]?.data as ImageToolNodeData;

    expect(data.operation).toBe('bg_removal');
    // Пустые ключи не появляются (KI-129).
    expect(Object.keys(data).sort()).toEqual(['kind', 'operation']);
  });
});

describe('useWorkflowStore — бюджет запуска (R7.1, KI-048)', () => {
  beforeEach(() => {
    vi.mocked(fetchRunBudgetAsync).mockReset();
    useWorkflowStore.setState({
      nodes: [] as AppNode[],
      edges: [],
      past: [],
      future: [],
      selectedNodeId: null,
      runId: RUN_ID,
      runStatus: 'running',
      runBudget: null,
      nodeStatuses: {},
      nodeOutputs: {},
      nodeErrors: {},
      nodeLogs: {},
      nodeMetrics: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loadRunBudgetAsync кладёт бюджет запуска в стор', async () => {    vi.mocked(fetchRunBudgetAsync).mockResolvedValue(BUDGET_RESPONSE);

    await state().loadRunBudgetAsync();

    expect(fetchRunBudgetAsync).toHaveBeenCalledWith(RUN_ID);
    expect(state().runBudget).toEqual({
      accumulated: 0.15,
      max: 5,
      maxRub: 500,
      remaining: 4.85,
      ok: true,
      mode: 'hard',
    });
  });

  it('без активного запуска запрос не уходит', async () => {
    useWorkflowStore.setState({ runId: null });

    await state().loadRunBudgetAsync();

    expect(fetchRunBudgetAsync).not.toHaveBeenCalled();
    expect(state().runBudget).toBeNull();
  });

  it('сбой запроса не роняет стор: бюджет остаётся прежним', async () => {
    vi.mocked(fetchRunBudgetAsync).mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(state().loadRunBudgetAsync()).resolves.toBeUndefined();
    expect(state().runBudget).toBeNull();
  });

  it('ответ устаревшего запроса игнорируется, если запуск сменился', async () => {
    vi.mocked(fetchRunBudgetAsync).mockImplementation(() => {
      // Пока «идёт запрос», стартует другой запуск (Run → Run).
      useWorkflowStore.setState({ runId: '33333333-3333-4333-8333-333333333333' });

      return Promise.resolve(BUDGET_RESPONSE);
    });

    await state().loadRunBudgetAsync();

    expect(state().runBudget).toBeNull();
  });

  it('node_completed обновляет бюджет (стоимость узла уже в node_runs)', async () => {
    vi.mocked(fetchRunBudgetAsync).mockResolvedValue({
      ...BUDGET_RESPONSE,
      accumulated: 0.4,
      remaining: 4.6,
    });

    state().applyEvent({
      type: 'node_completed',
      runId: RUN_ID,
      nodeId: 'tool-1',
      outputs: { resultUrls: ['https://cdn/out.png'] },
      durationMs: 1000,
      finishedAt: '2026-10-16T10:00:01.000Z',
    });

    // Запрос асинхронный: даём микрозадачам выполниться.
    await vi.waitFor(() => {
      expect(state().runBudget?.accumulated).toBe(0.4);
    });
    expect(fetchRunBudgetAsync).toHaveBeenCalledWith(RUN_ID);
  });

  it('resetRunState очищает бюджет прошлого запуска', async () => {
    useWorkflowStore.setState({
      runBudget: {
        accumulated: 1,
        max: 5,
        maxRub: 500,
        remaining: 4,
        ok: true,
        mode: 'hard',
      },
    });

    state().resetRunState();

    expect(state().runBudget).toBeNull();
    expect(state().runId).toBeNull();
  });
});
