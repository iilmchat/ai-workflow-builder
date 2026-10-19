import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore, type GraphSnapshot } from './workflow';
import {
  ApiError,
  ApiWorkflowSchema,
  fetchRunAsync,
  fetchRunBudgetAsync,
  fetchRunNodesAsync,
  type ApiRun,
} from '@/lib/api';
import type { AppNode } from '@/types/graph';
import type { NodeRunSnapshot, SnapshotMessage } from '@/types/run-stream';

/**
 * Заглушка i18n: jsdom настроен (KI-155), но тест проверяет стор, а не
 * переводы. Подмена убирает зависимость от языка и побочных эффектов
 * `@/i18n` (`document.documentElement.lang`, localStorage).
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
 * Счетчик подписок на SSE: `restoreRunAsync` открывает поток только для
 * незавершённого запуска (v0.11 S12, DESIGN § 3.4.3). Настоящий
 * `subscribeToRunStream` пошёл бы в сеть через `fetch`, поэтому модуль
 * подменяется.
 *
 * `vi.hoisted` нужен, чтобы мок-фабрика могла обратиться к переменной: она
 * вычисляется раньше импортов, а обычная `const` была бы в temporal dead zone.
 */
const { subscribeToRunStreamMock } = vi.hoisted(() => ({
  // Аргументы объявлены, чтобы `mock.calls` был типизирован: тест проверяет,
  // с каким `runId` открыт поток, а не только факт подписки.
  subscribeToRunStreamMock: vi.fn(
    (_runId: string, _handlers: unknown) => vi.fn(),
  ),
}));

vi.mock('@/lib/run-stream', () => ({
  subscribeToRunStream: subscribeToRunStreamMock,
  RunStreamUnavailableError: class RunStreamUnavailableError extends Error {},
}));

/**
 * Подмена двух API-функций восстановления запуска (v0.11 S12).
 *
 * `restoreRunAsync` ходит в сеть, поэтому ответы задаёт тест. Остальные
 * экспорты берутся из оригинала: `ApiWorkflowSchema` разбирается в других
 * describe'ах этого файла, а `ApiError` — тот же класс, что проверяет `instanceof`.
 */
vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();

  return {
    ...original,
    fetchRunAsync: vi.fn(),
    fetchRunNodesAsync: vi.fn(),
    // `restoreRunAsync` после подписки на SSE обновляет прогресс-бар бюджета;
    // без заглушки тест ждал бы реальный `fetch` (jsdom, относительный URL).
    fetchRunBudgetAsync: vi.fn(() =>
      Promise.resolve({
        ok: true,
        accumulated: 0,
        estimated: 0,
        remaining: 5,
        maxUsd: 5,
        maxRub: 500,
        mode: 'soft' as const,
      }),
    ),
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
    // Снимок завершённого запуска трогает `?runId=` (`window`). jsdom-`window`
    // есть (KI-155), но подменяем location/history: тест не должен зависеть
    // от адреса тестового документа.
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
    // Снимок завершённого запуска трогает `?runId=` (`window`). jsdom-`window`
    // есть (KI-155), но подменяем location/history ради детерминизма.
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

describe('useWorkflowStore — роль доступа (KI-397)', () => {
  beforeEach(() => {
    useWorkflowStore.setState({ ...EMPTY_STATE, accessRole: null, notice: null });
  });

  it('setAccessRole выставляет роль, newWorkflow её сбрасывает', () => {
    state().setAccessRole('viewer');

    expect(state().accessRole).toBe('viewer');

    state().newWorkflow();

    expect(state().accessRole).toBeNull();
  });

  it('viewer не сохраняет workflow: уведомление вместо запроса на backend', async () => {
    state().setAccessRole('viewer');

    await state().saveWorkflowAsync();

    // i18n в этом спеке замокан (`t` возвращает ключ) — проверяем ключ,
    // а не текст: паритет ru/en проверяет отдельный i18n-спек.
    expect(state().notice).toEqual({
      kind: 'error',
      text: 'topbar.viewer_readonly',
    });
    expect(state().isSaving).toBe(false);
  });
});

describe('ApiWorkflowSchema — роль доступа (KI-397)', () => {
  /** Минимальный валидный workflow: `nodes`/`edges`/`version` имеют дефолты. */
  const MINIMAL_WORKFLOW = {
    id: 'wf-1',
    userId: 'u-1',
    name: 'wf',
  };

  it('принимает роль viewer из ответа backend', () => {
    const parsed = ApiWorkflowSchema.parse({
      ...MINIMAL_WORKFLOW,
      accessRole: 'viewer',
    });

    expect(parsed.accessRole).toBe('viewer');
  });

  it('без поля роль неизвестна — обратная совместимость', () => {
    // Пока backend не отдаёт `accessRole` во всех ответах (KI-398), поле
    // необязательно: `undefined` трактуется как «неизвестна».
    expect(ApiWorkflowSchema.parse(MINIMAL_WORKFLOW).accessRole).toBeUndefined();
    expect(
      ApiWorkflowSchema.parse({ ...MINIMAL_WORKFLOW, accessRole: null }).accessRole,
    ).toBeNull();
  });

  it('неизвестную роль отклоняет', () => {
    expect(() =>
      ApiWorkflowSchema.parse({ ...MINIMAL_WORKFLOW, accessRole: 'admin' }),
    ).toThrow();
  });
});

describe('useWorkflowStore — восстановление запуска после F5 (v0.11 S12)', () => {
  /** ISO-время в тестовых ответах. */
  const ISO_AT = '2026-10-19T10:00:00.000Z';

  /** uuid восстанавливаемого запуска. */
  const RUN_ID = '55555555-5555-4555-8555-555555555555';

  /** Шпион `history.replaceState`: `clearRunIdFromUrl` правит адресную строку. */
  let replaceState: ReturnType<typeof vi.fn>;

  /**
   * Собирает снимок узла, как его отдаёт `GET /runs/:id/nodes`.
   *
   * @param overrides - поля, которые нужно переопределить
   * @returns снимок узла
   */
  function nodeSnapshot(
    overrides: Partial<NodeRunSnapshot> = {},
  ): NodeRunSnapshot {
    return {
      nodeId: 'A',
      nodeType: 'llm',
      status: 'completed',
      inputs: {},
      outputs: { text: 'готово' },
      error: null,
      logs: null,
      tokensIn: 10,
      tokensOut: 20,
      costUsd: '0.000300',
      costRub: '0.600000',
      durationMs: 42,
      startedAt: ISO_AT,
      finishedAt: ISO_AT,
      ...overrides,
    };
  }

  /**
   * Собирает ответ `GET /runs/:id`.
   *
   * @param overrides - поля, которые нужно переопределить
   * @returns публичное представление запуска
   */
  function apiRun(overrides: Partial<ApiRun> = {}): ApiRun {
    return {
      id: RUN_ID,
      workflowId: 'w1',
      status: 'completed',
      createdAt: ISO_AT,
      error: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    // Адресная строка «как после F5»: `?runId=` уже есть.
    replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { href: `http://127.0.0.1:5173/?workflowId=w1&runId=${RUN_ID}` },
      history: { replaceState },
    });
    useWorkflowStore.setState({
      ...EMPTY_STATE,
      runId: null,
      runStatus: null,
      runError: null,
      nodeStatuses: {},
      nodeOutputs: {},
      nodeErrors: {},
      nodeLogs: {},
      nodeMetrics: {},
      notice: null,
    });
    subscribeToRunStreamMock.mockClear();
    vi.mocked(fetchRunAsync).mockReset();
    vi.mocked(fetchRunNodesAsync).mockReset();
    vi.mocked(fetchRunBudgetAsync).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restoreRunAsync восстанавливает nodeOutputs и nodeMetrics из GET /runs/:id/nodes', async () => {
    vi.mocked(fetchRunAsync).mockResolvedValue(apiRun());
    vi.mocked(fetchRunNodesAsync).mockResolvedValue([
      nodeSnapshot(),
      nodeSnapshot({
        nodeId: 'B',
        nodeType: 'http',
        status: 'failed',
        outputs: null,
        error: 'HTTP 404',
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        costRub: null,
        cacheReadTokens: 100,
        cacheSavingsUsd: 0.00125,
        storedUrl: 'https://s3.test/run-1/B.png',
        storedExpiresAt: ISO_AT,
      }),
    ]);

    await state().restoreRunAsync(RUN_ID);

    expect(fetchRunAsync).toHaveBeenCalledWith(RUN_ID);
    expect(fetchRunNodesAsync).toHaveBeenCalledWith(RUN_ID);
    expect(state().runId).toBe(RUN_ID);
    expect(state().runStatus).toBe('completed');
    // Выходы и метрики — то, ради чего история и запрашивается: после F5
    // панель результата показывает их без SSE.
    expect(state().nodeStatuses).toEqual({ A: 'completed', B: 'failed' });
    expect(state().nodeOutputs.A).toEqual({ text: 'готово' });
    expect(state().nodeErrors.B).toBe('HTTP 404');
    expect(state().nodeMetrics.A).toEqual({
      durationMs: 42,
      tokensIn: 10,
      tokensOut: 20,
      costUsd: '0.000300',
      costRub: '0.600000',
      cacheReadTokens: null,
      cacheCreationTokens: null,
      cacheSavingsUsd: null,
      storedUrl: null,
      storedExpiresAt: null,
    });
    expect(state().nodeMetrics.B).toMatchObject({
      tokensIn: null,
      costUsd: null,
      cacheReadTokens: 100,
      cacheSavingsUsd: 0.00125,
      storedUrl: 'https://s3.test/run-1/B.png',
    });
  });

  it('при финальном статусе SSE не открывается, а ?runId= убирается из адреса', async () => {
    vi.mocked(fetchRunAsync).mockResolvedValue(
      apiRun({ status: 'failed', error: 'Узел B упал: HTTP 404' }),
    );
    vi.mocked(fetchRunNodesAsync).mockResolvedValue([]);

    await state().restoreRunAsync(RUN_ID);

    // Событий больше не будет: подписка на поток не нужна (KI-060/KI-271).
    expect(subscribeToRunStreamMock).not.toHaveBeenCalled();
    // `?runId=` убран — следующий F5 не станет восстанавливать тот же запуск.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(String(replaceState.mock.calls[0]?.[2])).not.toContain('runId=');
    // KI-347: причина падения восстановлена из GET /runs/:id.
    expect(state().runError).toBe('Узел B упал: HTTP 404');
    expect(state().runStatus).toBe('failed');
  });

  it('при running подписывается на SSE: снимок потока свежее REST', async () => {
    vi.mocked(fetchRunAsync).mockResolvedValue(
      apiRun({ status: 'running' }),
    );
    vi.mocked(fetchRunNodesAsync).mockResolvedValue([nodeSnapshot()]);

    await state().restoreRunAsync(RUN_ID);

    expect(subscribeToRunStreamMock).toHaveBeenCalledTimes(1);
    expect(subscribeToRunStreamMock.mock.calls[0]?.[0]).toBe(RUN_ID);
    // `?runId=` остаётся: после повторного F5 подписка должна восстановиться.
    expect(replaceState).not.toHaveBeenCalled();
    // R7.1 (KI-048): прогресс-бар бюджета тоже восстанавливается.
    expect(fetchRunBudgetAsync).toHaveBeenCalledWith(RUN_ID);
  });

  it('404 сбрасывает состояние запуска, убирает ?runId= и показывает toast', async () => {
    vi.mocked(fetchRunAsync).mockRejectedValue(
      new ApiError('Запуск не найден', 404),
    );
    vi.mocked(fetchRunNodesAsync).mockResolvedValue([]);

    await state().restoreRunAsync(RUN_ID);

    expect(state().runId).toBeNull();
    expect(state().runStatus).toBeNull();
    expect(replaceState).toHaveBeenCalledTimes(1);
    // i18n в этом спеке замокан (`t` возвращает ключ) — проверяем ключ.
    expect(state().notice).toEqual({
      kind: 'error',
      text: 'toast.run_not_found',
    });
    expect(subscribeToRunStreamMock).not.toHaveBeenCalled();
  });

  it('прочие ошибки не ломают загрузку графа — только уведомление', async () => {
    vi.mocked(fetchRunAsync).mockRejectedValue(new ApiError('Сеть недоступна'));
    vi.mocked(fetchRunNodesAsync).mockResolvedValue([]);

    await expect(state().restoreRunAsync(RUN_ID)).resolves.toBeUndefined();

    expect(state().notice).toEqual({
      kind: 'error',
      text: 'Сеть недоступна',
    });
    // Состояние запуска не заполнено, но `?runId=` не тронут: следующий F5
    // попробует восстановить его снова.
    expect(replaceState).not.toHaveBeenCalled();
  });
});

