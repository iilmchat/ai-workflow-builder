import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore, type GraphSnapshot } from './workflow';
import type { AppNode } from '@/types/graph';
import type { SnapshotMessage } from '@/types/run-stream';

/**
 * Заглушка i18n: настоящий модуль на импорте пишет `document.documentElement.lang`
 * (см. `@/i18n`), а тесты идут в `environment: 'node'` — без jsdom (KI-155).
 *
 * `vi.mock` поднимается к началу файла, поэтому реальный модуль не выполняется
 * ни при импорте стора, ни при импорте его зависимостей (`@/lib/api`).
 */
vi.mock('@/i18n', () => {
  const t = (key: string): string => key;

  return {
    default: { t, language: 'ru' },
    setLanguage: () => undefined,
  };
});

/**
 * Снимок пустого редактора для сброса между тестами.
 *
 * Zustand-стор — модульный синглтон: тесты меняют его состояние, поэтому в
 * `beforeEach` возвращаем исходные значения (как в `auth.spec.ts`).
 */
const EMPTY_STATE = {
  nodes: [] as AppNode[],
  edges: [],
  past: [] as GraphSnapshot[],
  future: [] as GraphSnapshot[],
  selectedNodeId: null,
  executionLevels: {} as Record<string, number>,
};

/** Позиция узла для тестов (на графе она не важна). */
const AT_ZERO = { x: 0, y: 0 };

/** Короткий доступ к состоянию. */
function state() {
  return useWorkflowStore.getState();
}

describe('useWorkflowStore — история правок (R6.4b.2b)', () => {
  beforeEach(() => {
    useWorkflowStore.setState(EMPTY_STATE);
  });

  it('стартовое состояние: истории нет', () => {
    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
  });

  it('pushHistory кладёт снимок в past и очищает future', () => {
    state().pushHistory();

    expect(state().past).toHaveLength(1);
    expect(state().canUndo()).toBe(true);

    // Ветка повтора обрывается новым действием.
    state().pushHistory();
    expect(state().future).toEqual([]);
  });

  it('pushHistory снимает глубокую копию: снимок не меняется вместе с графом', () => {
    state().addNode('text', AT_ZERO);
    const nodeId = state().nodes[0]?.id ?? '';

    // Второй `addNode` снимает снимок, в котором текст первого узла ещё пуст.
    state().addNode('llm', { x: 100, y: 0 });
    const snapshotBefore = state().past.at(-1);
    const snapshotNode = snapshotBefore?.nodes.find((node) => node.id === nodeId);

    // Меняем текст узла после снимка.
    useWorkflowStore.setState((current) => ({
      nodes: current.nodes.map((node) =>
        node.type === 'text'
          ? { ...node, data: { kind: 'text' as const, value: 'изменено' } }
          : node,
      ),
    }));

    expect(snapshotNode?.data).toEqual({ kind: 'text', value: '' });
    expect(state().nodes[0]?.data).toEqual({ kind: 'text', value: 'изменено' });
  });

  it('undo восстанавливает граф, снимает шаг из past и кладёт состояние в future', () => {
    state().addNode('text', AT_ZERO);
    state().addNode('llm', { x: 100, y: 0 });

    expect(state().nodes).toHaveLength(2);
    expect(state().past).toHaveLength(2);
    expect(state().undo).toBeDefined();

    state().undo();

    expect(state().nodes).toHaveLength(1);
    expect(state().nodes[0]?.type).toBe('text');
    expect(state().past).toHaveLength(1);
    expect(state().future).toHaveLength(1);
    expect(state().canRedo()).toBe(true);
  });

  it('redo возвращает отменённое состояние', () => {
    state().addNode('text', AT_ZERO);
    state().undo();
    expect(state().nodes).toHaveLength(0);

    state().redo();

    expect(state().nodes).toHaveLength(1);
    expect(state().nodes[0]?.type).toBe('text');
    expect(state().past).toHaveLength(1);
    expect(state().future).toHaveLength(0);
    expect(state().canRedo()).toBe(false);
  });

  it('undo на пустой истории — no-op', () => {
    state().undo();

    expect(state().nodes).toEqual([]);
    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
  });

  it('redo на пустой истории повтора — no-op', () => {
    state().addNode('text', AT_ZERO);
    state().redo();

    expect(state().nodes).toHaveLength(1);
    expect(state().future).toEqual([]);
  });

  it('новое действие очищает future (ветка повтора обрывается)', () => {
    state().addNode('text', AT_ZERO);
    state().addNode('llm', { x: 100, y: 0 });
    state().undo();
    expect(state().future).toHaveLength(1);

    state().addNode('comment', { x: 200, y: 0 });

    expect(state().future).toEqual([]);
    expect(state().canRedo()).toBe(false);
  });

  it('глубина истории ограничена 50 снимками (FIFO)', () => {
    for (let index = 0; index < 60; index += 1) {
      state().addNode('text', { x: index * 10, y: 0 });
    }

    expect(state().nodes).toHaveLength(60);
    expect(state().past).toHaveLength(50);

    // Вытеснены самые старые снимки: 50 откатов возвращают к 10 узлам.
    for (let index = 0; index < 50; index += 1) {
      state().undo();
    }

    expect(state().nodes).toHaveLength(10);
    expect(state().canUndo()).toBe(false);
  });

  it('удаление узла откатывается вместе с его связями', () => {
    state().addNode('text', AT_ZERO);
    state().addNode('llm', { x: 100, y: 0 });

    const [text, llm] = state().nodes;

    state().onConnect({
      source: text?.id ?? '',
      sourceHandle: 'text-output',
      target: llm?.id ?? '',
      targetHandle: 'text-input',
    });
    expect(state().edges).toHaveLength(1);

    state().removeNode(text?.id ?? '');
    expect(state().nodes).toHaveLength(1);
    expect(state().edges).toHaveLength(0);

    // Откат удаления: узел и связь на месте.
    state().undo();
    expect(state().nodes).toHaveLength(2);
    expect(state().edges).toHaveLength(1);
  });

  it('undo сбрасывает выделение, если выбранного узла в снимке уже нет', () => {
    state().addNode('text', AT_ZERO);
    const nodeId = state().nodes[0]?.id ?? '';
    state().setSelectedNodeId(nodeId);

    // Удаляем узел: selectedNodeId сбрасывается самим removeNode.
    state().removeNode(nodeId);
    expect(state().selectedNodeId).toBeNull();

    // Откат возвращает узел — и выделение «оживает» вместе с ним (KI-187:
    // панель показывает тот же узел, что подсвечен на холсте).
    state().undo();
    expect(state().nodes).toHaveLength(1);
    expect(state().selectedNodeId).toBeNull();
  });

  it('undo сбрасывает план выполнения (executionLevels устарели)', () => {
    state().addNode('text', AT_ZERO);
    state().addNode('llm', { x: 100, y: 0 });
    state().addNode('comment', { x: 200, y: 0 });

    const first = state().nodes[0]?.id ?? '';
    state().setExecutionLevels([[first]]);
    expect(Object.keys(state().executionLevels)).toEqual([first]);

    state().undo();

    expect(state().executionLevels).toEqual({});
  });

  it('поток позиций от перетаскивания не создаёт шагов истории', () => {
    state().addNode('text', AT_ZERO);
    const nodeId = state().nodes[0]?.id ?? '';
    const pastAfterAdd = state().past.length;

    // Поток кадров перетаскивания: снимок не берётся (его делает Canvas на
    // `onNodeDragStart`, а не каждый `onNodesChange`).
    for (let index = 1; index <= 5; index += 1) {
      state().onNodesChange([
        {
          id: nodeId,
          type: 'position',
          position: { x: index * 10, y: 0 },
          dragging: true,
        },
      ]);
    }

    expect(state().past).toHaveLength(pastAfterAdd);
    expect(state().nodes[0]?.position).toEqual({ x: 50, y: 0 });

    // Завершающее изменение (`dragging: false`) историю тоже не трогает:
    // React Flow применяет финальную позицию раньше, чем зовёт
    // `onNodeDragStop`, поэтому снимок здесь был бы уже «после» перетаскивания.
    state().onNodesChange([
      {
        id: nodeId,
        type: 'position',
        position: { x: 60, y: 0 },
        dragging: false,
      },
    ]);

    expect(state().past).toHaveLength(pastAfterAdd);
    expect(state().nodes[0]?.position).toEqual({ x: 60, y: 0 });
  });

  it('выделение узла не создаёт шаг истории', () => {
    state().addNode('text', AT_ZERO);
    const nodeId = state().nodes[0]?.id ?? '';
    const pastAfterAdd = state().past.length;

    state().onNodesChange([{ id: nodeId, type: 'select', selected: true }]);

    expect(state().past).toHaveLength(pastAfterAdd);
  });

  it('pushHistoryCoalesced склеивает частые правки и разводит редкие', () => {
    state().addNode('text', AT_ZERO);
    const afterAdd = state().past.length;

    // Первая правка поля — отдельный шаг.
    state().pushHistoryCoalesced();
    expect(state().past).toHaveLength(afterAdd + 1);

    // Продолжение ввода в пределах окна — тот же шаг.
    state().pushHistoryCoalesced();
    state().pushHistoryCoalesced();
    expect(state().past).toHaveLength(afterAdd + 1);

    // После паузы (окно склейки 1000 мс) — новый шаг. `Date.now` подменяем,
    // чтобы тест не зависел от реального ожидания.
    const realNow = Date.now;
    Date.now = () => realNow() + 5000;

    try {
      state().pushHistoryCoalesced();
    } finally {
      Date.now = realNow;
    }

    expect(state().past).toHaveLength(afterAdd + 2);
  });

  it('newWorkflow очищает граф и историю (новый документ, а не правка)', () => {
    state().addNode('text', AT_ZERO);
    state().addNode('llm', { x: 100, y: 0 });
    state().undo();
    expect(state().future).toHaveLength(1);

    state().newWorkflow();

    expect(state().nodes).toEqual([]);
    expect(state().edges).toEqual([]);
    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
    expect(state().canUndo()).toBe(false);
    expect(state().canRedo()).toBe(false);
  });

  it('состояние запуска не входит в историю (undo его не трогает)', () => {
    state().addNode('text', AT_ZERO);
    useWorkflowStore.setState({
      runStatus: 'running',
      nodeStatuses: { 'node-1': 'completed' },
    });

    state().undo();

    expect(state().runStatus).toBe('running');
    expect(state().nodeStatuses).toEqual({ 'node-1': 'completed' });
  });
});

describe('useWorkflowStore — SSE-события статуса узла (KI-288)', () => {
  /** ISO-время событий в тестах. */
  const ISO_AT = '2026-10-16T10:00:00.000Z';
  /** Причина пропуска, которую присылает backend (`node_runs.error`). */
  const SKIP_REASON = 'Пропущен: упал предшественник';

  beforeEach(() => {
    useWorkflowStore.setState({
      ...EMPTY_STATE,
      runStatus: null,
      runError: null,
      nodeStatuses: {},
      nodeErrors: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('node_skipped переводит узел в skipped и сохраняет причину', () => {
    state().applyEvent({
      type: 'node_skipped',
      runId: 'run-1',
      nodeId: 'C',
      nodeType: 'llm',
      reason: SKIP_REASON,
      skippedAt: ISO_AT,
    });

    expect(state().nodeStatuses.C).toBe('skipped');
    // Причина лежит в `nodeErrors` — панель результата показывает её без
    // отдельного поля `nodeSkipReasons`.
    expect(state().nodeErrors.C).toBe(SKIP_REASON);
  });

  it('node_skipped не перетирает ошибку запуска от упавшего узла', () => {
    state().applyEvent({
      type: 'node_failed',
      runId: 'run-1',
      nodeId: 'B',
      error: 'HTTP 404',
      finishedAt: ISO_AT,
    });
    state().applyEvent({
      type: 'node_skipped',
      runId: 'run-1',
      nodeId: 'C',
      nodeType: 'llm',
      reason: SKIP_REASON,
      skippedAt: ISO_AT,
    });

    expect(state().nodeStatuses.B).toBe('failed');
    expect(state().nodeStatuses.C).toBe('skipped');
    // Пропуск — следствие падения, а не самостоятельная ошибка запуска:
    // `runError` остаётся текстом реального падения.
    expect(state().runError).toBe('HTTP 404');
    expect(state().nodeErrors.B).toBe('HTTP 404');
    expect(state().nodeErrors.C).toBe(SKIP_REASON);
  });

  it('node_completed очищает ошибку предыдущей попытки job (R7.4b)', () => {
    // Сценарий смоука R7.4b: попытка 1 упала (агент исчерпал итерации),
    // BullMQ перезапустил job, попытка 2 завершилась успешно. `node_failed`
    // первой попытки не должен оставлять «ОШИБКА» у completed-узла.
    state().applyEvent({
      type: 'node_failed',
      runId: 'run-1',
      nodeId: 'B',
      error: 'Агент исчерпал лимит итераций (4)',
      finishedAt: ISO_AT,
    });
    state().applyEvent({
      type: 'node_completed',
      runId: 'run-1',
      nodeId: 'B',
      outputs: { result: 'готово', steps: [] },
      durationMs: 12,
      logs: [],
      finishedAt: ISO_AT,
    });

    expect(state().nodeStatuses.B).toBe('completed');
    expect(state().nodeErrors.B).toBeUndefined();
  });

  it('снимок с skipped-узлом применяется целиком', () => {
    // Снимок завершённого запуска трогает `?runId=` (`window`), а тесты идут в
    // node-окружении (см. `vitest.config.ts`): подставляем минимальный window.
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/?workflowId=w1' },
      history: { replaceState: () => undefined },
    });

    state().applySnapshot({
      type: 'snapshot',
      run: {
        id: 'run-1',
        workflowId: 'w1',
        status: 'failed',
        createdAt: ISO_AT,
        // KI-347: причина падения запуска приходит в снимке.
        error: 'Узел B упал: HTTP 404',
      },
      nodes: [
        {
          nodeId: 'A',
          nodeType: 'text',
          status: 'completed',
          inputs: {},
          outputs: { text: 'a' },
          error: null,
          logs: null,
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          costRub: null,
          durationMs: 1,
          startedAt: ISO_AT,
          finishedAt: ISO_AT,
        },
        {
          nodeId: 'B',
          nodeType: 'http',
          status: 'failed',
          inputs: {},
          outputs: null,
          error: 'HTTP 404',
          logs: null,
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          costRub: null,
          durationMs: 13,
          startedAt: ISO_AT,
          finishedAt: ISO_AT,
        },
        {
          nodeId: 'C',
          nodeType: 'text',
          status: 'skipped',
          inputs: {},
          outputs: null,
          error: SKIP_REASON,
          logs: null,
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          costRub: null,
          durationMs: 0,
          startedAt: ISO_AT,
          finishedAt: ISO_AT,
        },
      ],
    });

    // Снимок — источник истины: карта статусов заменяется целиком, `skipped`
    // не теряется (до KI-288 Zod отбрасывал такое сообщение).
    expect(state().nodeStatuses).toEqual({
      A: 'completed',
      B: 'failed',
      C: 'skipped',
    });
    expect(state().nodeErrors.C).toBe(SKIP_REASON);
    expect(state().runStatus).toBe('failed');
    expect(state().nodeOutputs.A).toEqual({ text: 'a' });
    // KI-347: причина падения запуска из снимка — то, что панель показывает
    // после F5 вместо «причина недоступна».
    expect(state().runError).toBe('Узел B упал: HTTP 404');
  });
});

describe('useWorkflowStore — run.error в снимке (KI-347)', () => {
  /** ISO-время снимка. */
  const ISO_SNAPSHOT_AT = '2026-10-16T11:00:00.000Z';

  beforeEach(() => {
    // Снимок завершённого запуска трогает `?runId=` (`window`), а тесты идут в
    // node-окружении — подставляем минимальный window (как в KI-288-спеке).
    vi.stubGlobal('window', {
      location: { href: 'http://127.0.0.1:5173/?workflowId=w1' },
      history: { replaceState: () => undefined },
    });
    useWorkflowStore.setState({ ...EMPTY_STATE, runStatus: null, runError: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Собирает снимок завершившегося с ошибкой запуска.
   *
   * @param error - значение `run.error` (`null` — ошибки ещё нет)
   * @returns сообщение-снимок без узлов
   */
  function snapshotWithError(error: string | null): SnapshotMessage {
    return {
      type: 'snapshot',
      run: {
        id: 'run-1',
        workflowId: 'w1',
        status: 'failed',
        createdAt: ISO_SNAPSHOT_AT,
        error,
      },
      nodes: [],
    };
  }

  it('снимок с непустым error заполняет runError', () => {
    state().applySnapshot(snapshotWithError('Узел B упал: HTTP 404'));

    expect(state().runError).toBe('Узел B упал: HTTP 404');
    expect(state().runStatus).toBe('failed');
  });

  it('снимок с error=null не перетирает уже известную ошибку', () => {
    state().applySnapshot(snapshotWithError('Узел B упал: HTTP 404'));
    // Снимок, собранный до заполнения `workflow_runs.error`, не должен стирать
    // причину, пришедшую с `node_failed` (принцип KI-271).
    state().applySnapshot(snapshotWithError(null));

    expect(state().runError).toBe('Узел B упал: HTTP 404');
  });

  it('снимок с error=null при пустом runError оставляет null', () => {
    state().applySnapshot(snapshotWithError(null));

    expect(state().runError).toBeNull();
  });
});
