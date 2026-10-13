import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import {
  createRunAsync,
  createWorkflowAsync,
  getWorkflowAsync,
  planWorkflowAsync,
  updateWorkflowAsync,
  type ApiGraphEdge,
  type ApiGraphNode,
  type ApiWorkflow,
} from '@/lib/api';
import { subscribeToRunStream } from '@/lib/run-stream';
import { levelsToMap } from '@/lib/plan';
import {
  LLM_MODELS,
  type AppNode,
  type ImageGenNodeData,
  type LlmModel,
  type LlmNodeData,
  type NodeType,
  type TextNodeData,
} from '@/types/graph';
import type {
  RunEventMessage,
  RunStatus,
  SnapshotMessage,
} from '@/types/run-stream';

/** Позиция узла на холсте. */
type Position = { x: number; y: number };

/**
 * Закрытие текущего SSE-потока запуска.
 *
 * Хранится в модульной переменной, а не в состоянии стора: это не данные для
 * рендера, и лишние обновления подписчиков при каждой подписке/отписке не нужны.
 */
let closeRunStream: (() => void) | null = null;

/** Закрывает текущий поток запуска, если он открыт. */
function closeStreamIfAny(): void {
  closeRunStream?.();
  closeRunStream = null;
}

/**
 * Проверяет, что статус запуска финальный.
 *
 * @param status - статус запуска либо `null`
 * @returns `true`, если запуск завершён и поток больше не нужен
 */
function isFinalStatus(status: RunStatus | null): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Возвращает патч состояния с новым статусом узла.
 *
 * @param state - текущее состояние стора
 * @param nodeId - id узла графа
 * @param status - новый статус узла
 * @returns патч `nodeStatuses` для `set`
 */
function withNodeStatus(
  state: WorkflowState,
  nodeId: string,
  status: RunStatus,
): Pick<WorkflowState, 'nodeStatuses'> {
  return { nodeStatuses: { ...state.nodeStatuses, [nodeId]: status } };
}

/** Владелец графа: авторизации пока нет, поэтому значение фиксированное. */
export const DEFAULT_USER_ID = 'demo-user';
/** Имя workflow по умолчанию (backend требует непустое). */
export const DEFAULT_WORKFLOW_NAME = 'Новый workflow';

/** Уведомление для пользователя. */
export interface Notice {
  kind: 'error' | 'success';
  text: string;
}

/** Функция поиска центра вьюпорта, которую отдаёт Canvas. */
export type FindCenterHandler = () => Position;

/** Состояние редактора графа. */
export interface WorkflowState {
  nodes: AppNode[];
  edges: Edge[];

  /** id текущего workflow (null — ещё не сохранён). */
  currentWorkflowId: string | null;
  /** Название текущего workflow, редактируется в верхней панели. */
  currentWorkflowName: string;

  /** id узла → номер уровня выполнения из `/engine/plan`. */
  executionLevels: Record<string, number>;

  /** id текущего запуска (`null` — запусков ещё не было). */
  runId: string | null;
  /** Статус запуска из SSE (`null` — запуск не стартовал). */
  runStatus: RunStatus | null;
  /** Текст последней ошибки запуска (для панели результата R4.3). */
  runError: string | null;
  /** id узла → статус выполнения (snapshot + события потока). */
  nodeStatuses: Record<string, RunStatus>;
  /** id узла → последние выходы узла из `node_completed`. */
  nodeOutputs: Record<string, Record<string, unknown>>;
  /**
   * Номер текущей попытки job'а (1-based) для подписи «попытка N/M».
   *
   * Контракт не несёт `attemptsMade` в `run_started`, поэтому счёт ведётся по
   * числу стартов; `attemptsMade` из `run_completed` (KI-059) остаётся
   * авторитетным значением о завершённых попытках.
   */
  attemptNumber: number;
  /** Сколько попыток уже завершил BullMQ (из `run_completed`, KI-059). */
  attemptsMade: number;
  /** Лимит попыток job'а (из `run_completed`; `null` — неизвестен). */
  attempts: number | null;

  isSaving: boolean;
  isLoading: boolean;
  error: string | null;
  notice: Notice | null;

  /** Добавляет узел в указанную позицию и делает его выделенным. */
  addNode: (type: NodeType, position: Position) => void;
  /** Применяет изменения узлов от React Flow (drag, select, remove). */
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  /** Применяет изменения связей от React Flow. */
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  /** Соединяет два порта новой связью. */
  onConnect: (connection: Connection) => void;

  setNodes: (nodes: AppNode[]) => void;
  setEdges: (edges: Edge[]) => void;

  /** Сохраняет граф: создаёт workflow или обновляет существующий. */
  saveWorkflowAsync: () => Promise<void>;
  /** Загружает workflow по id и заменяет текущий граф. */
  loadWorkflowAsync: (id: string) => Promise<void>;
  /** Строит план выполнения и раскладывает уровни по узлам. */
  runPlanAsync: () => Promise<void>;

  /**
   * Запускает workflow: `POST /runs` + подписка на SSE-поток прогресса.
   *
   * @param workflowId - id сохранённого workflow
   */
  startRunAsync: (workflowId: string) => Promise<void>;
  /**
   * Применяет снимок состояния: **заменяет** `nodeStatuses`/`nodeOutputs`.
   *
   * Snapshot — источник истины на момент подключения, поэтому слияние с прошлым
   * состоянием неверно (после переподключения остались бы устаревшие статусы).
   *
   * @param snapshot - сообщение-снимок из потока
   */
  applySnapshot: (snapshot: SnapshotMessage) => void;
  /**
   * Применяет событие прогресса запуска.
   *
   * @param event - событие из потока (кроме snapshot)
   */
  applyEvent: (event: RunEventMessage) => void;
  /** Сбрасывает состояние запуска и закрывает поток (Load / Save / новый Run). */
  resetRunState: () => void;

  setCurrentWorkflowId: (id: string | null, name?: string) => void;
  setCurrentWorkflowName: (name: string) => void;
  setExecutionLevels: (levels: string[][]) => void;
  clearExecutionLevels: () => void;
  setNotice: (notice: Notice | null) => void;

  /** Canvas регистрирует здесь функцию поиска центра вьюпорта. */
  findCenter: FindCenterHandler | null;
  setFindCenter: (handler: FindCenterHandler) => void;
}

/**
 * Создаёт узел нужного типа с дефолтными данными.
 *
 * @param type - тип узла из тулбара
 * @param position - позиция на холсте
 * @param index - порядковый номер узла, нужен для уникального id
 */
function createNode(type: NodeType, position: Position, index: number): AppNode {
  const shared = { id: `${type}-${index}-${crypto.randomUUID()}`, position };

  switch (type) {
    case 'llm':
      return {
        ...shared,
        type: 'llm',
        data: { kind: 'llm', label: 'LLM', model: LLM_MODELS[0] },
      };
    case 'image':
      return {
        ...shared,
        type: 'image',
        data: { kind: 'image', label: 'Image Generation' },
      };
    default:
      return {
        ...shared,
        type: 'text',
        data: { kind: 'text', label: 'Text', value: '' },
      };
  }
}

/** Приводит узел к формату backend. */
function toApiNode(node: AppNode): ApiGraphNode {
  return {
    id: node.id,
    type: node.type ?? 'text',
    position: node.position,
    data: node.data,
  };
}

/** Приводит связь к формату backend. */
function toApiEdge(edge: Edge): ApiGraphEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  };
}

/** Собирает данные узла из ответа backend с учётом его типа. */
function nodeDataFromApi(
  type: NodeType,
  data: Record<string, unknown>,
): TextNodeData | LlmNodeData | ImageGenNodeData {
  const label = typeof data.label === 'string' ? data.label : undefined;

  switch (type) {
    case 'llm': {
      const model = data.model;
      return {
        kind: 'llm',
        label,
        model: LLM_MODELS.includes(model as LlmModel)
          ? (model as LlmModel)
          : LLM_MODELS[0],
      };
    }
    case 'image':
      return {
        kind: 'image',
        label,
        imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : undefined,
      };
    default:
      return {
        kind: 'text',
        label,
        value: typeof data.value === 'string' ? data.value : '',
      };
  }
}

/**
 * Преобразует workflow с backend в узлы и связи React Flow.
 *
 * Узлы неизвестных типов пропускаются: их нечем отрисовать, а id нельзя
 * терять молча, поэтому такие случаи перечисляются в предупреждении.
 *
 * @param workflow - workflow из API
 * @returns узлы, связи и предупреждение о пропущенных узлах
 */
function fromApiWorkflow(workflow: ApiWorkflow): {
  nodes: AppNode[];
  edges: Edge[];
  warning: string | null;
} {
  const nodes: AppNode[] = [];
  const skipped: string[] = [];

  for (const node of workflow.nodes) {
    if (node.type !== 'text' && node.type !== 'llm' && node.type !== 'image') {
      skipped.push(node.id);
      continue;
    }

    const data = nodeDataFromApi(node.type, node.data ?? {});

    nodes.push({
      id: node.id,
      type: node.type,
      position: node.position,
      data,
    } as AppNode);
  }

  const edges: Edge[] = workflow.edges
    .filter((edge) => nodes.some((node) => node.id === edge.source))
    .filter((edge) => nodes.some((node) => node.id === edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    }));

  return {
    nodes,
    edges,
    warning: skipped.length
      ? `Пропущены узлы неизвестного типа: ${skipped.join(', ')}`
      : null,
  };
}

/** Достаёт текст ошибки из неизвестного значения. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}

/**
 * Стор редактора workflow: состояние графа, сохранение и план выполнения.
 */
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],

  currentWorkflowId: null,
  currentWorkflowName: DEFAULT_WORKFLOW_NAME,

  executionLevels: {},

  runId: null,
  runStatus: null,
  runError: null,
  nodeStatuses: {},
  nodeOutputs: {},
  attemptNumber: 0,
  attemptsMade: 0,
  attempts: null,

  isSaving: false,
  isLoading: false,
  error: null,
  notice: null,

  findCenter: null,

  addNode: (type, position) =>
    set((state) => {
      const node = createNode(type, position, state.nodes.length);

      return {
        nodes: [
          ...state.nodes.map((existing) => ({ ...existing, selected: false })),
          { ...node, selected: true },
        ],
        // После правки графа прежний план выполнения уже неактуален.
        executionLevels: {},
      };
    }),

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => {
      // id генерируем сами: backend требует непустой id у каждой связи.
      const nextEdges = addEdge(connection, state.edges).map((edge) =>
        edge.id.startsWith('xy-edge__')
          ? { ...edge, id: `edge-${crypto.randomUUID()}` }
          : edge,
      );

      return { edges: nextEdges, executionLevels: {} };
    }),

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  saveWorkflowAsync: async () => {
    const { nodes, edges, currentWorkflowId, currentWorkflowName } = get();
    const name = currentWorkflowName.trim() || DEFAULT_WORKFLOW_NAME;
    const payload = {
      name,
      nodes: nodes.map(toApiNode),
      edges: edges.map(toApiEdge),
    };

    set({ isSaving: true, error: null });

    try {
      const saved = currentWorkflowId
        ? await updateWorkflowAsync(currentWorkflowId, payload)
        : await createWorkflowAsync({ userId: DEFAULT_USER_ID, ...payload });

      set({
        currentWorkflowId: saved.id,
        currentWorkflowName: saved.name,
        isSaving: false,
        notice: { kind: 'success', text: `Workflow сохранён: ${saved.name}` },
      });
      // Сохранён другой граф — прежнее состояние запуска к нему не относится.
      get().resetRunState();
    } catch (error) {
      const message = messageOf(error);
      set({ isSaving: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  loadWorkflowAsync: async (id) => {
    set({ isLoading: true, error: null });

    try {
      const workflow = await getWorkflowAsync(id);
      const { nodes, edges, warning } = fromApiWorkflow(workflow);

      set({
        nodes,
        edges,
        currentWorkflowId: workflow.id,
        currentWorkflowName: workflow.name,
        isLoading: false,
        // Прежний план относился к другому графу.
        executionLevels: {},
        notice: warning
          ? { kind: 'error', text: warning }
          : { kind: 'success', text: `Workflow загружен: ${workflow.name}` },
      });
      // Загружен другой граф: состояние прошлого запуска сбрасываем.
      get().resetRunState();
    } catch (error) {
      const message = messageOf(error);
      set({ isLoading: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  runPlanAsync: async () => {
    const { nodes, edges } = get();

    if (nodes.length === 0) {
      set({ notice: { kind: 'error', text: 'Граф пуст: добавьте хотя бы один узел' } });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const plan = await planWorkflowAsync(
        nodes.map(toApiNode),
        edges.map(toApiEdge),
      );

      const levels = levelsToMap(plan.levels);
      // В сообщении показываем типы узлов, а не их uuid: ids нечитаемы.
      const order = plan.order
        .map((nodeId) => {
          const node = nodes.find((item) => item.id === nodeId);
          return node?.data.label ?? node?.type ?? nodeId;
        })
        .join(' → ');

      set({
        executionLevels: levels,
        isLoading: false,
        notice: {
          kind: 'success',
          text: `План: ${plan.levels.length} ур., порядок ${order}`,
        },
      });
    } catch (error) {
      const message = messageOf(error);
      set({ isLoading: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  startRunAsync: async (workflowId) => {
    // Новый запуск не должен смешиваться с состоянием предыдущего.
    get().resetRunState();
    set({ runStatus: 'pending', error: null });

    let runId: string;

    try {
      const run = await createRunAsync(workflowId);

      runId = run.id;
      set({ runId: run.id, runStatus: run.status });
    } catch (error) {
      const message = messageOf(error);

      set({
        runStatus: 'failed',
        runError: message,
        notice: { kind: 'error', text: message },
      });

      return;
    }

    closeRunStream = subscribeToRunStream(runId, {
      onMessage: (message) => {
        if (message.type === 'snapshot') {
          get().applySnapshot(message);

          return;
        }

        get().applyEvent(message);
      },
      onError: () => {
        // EventSource переподключается сам; закрываем только завершённый запуск:
        // иначе повторное подключение принесёт новый snapshot и состояние
        // восстановится (KI-049).
        if (isFinalStatus(get().runStatus)) {
          closeStreamIfAny();
        }
      },
      onFatalError: (attempts) => {
        const text = `Поток запуска не отвечает (ошибок подряд: ${attempts})`;

        set({ runError: text, notice: { kind: 'error', text } });
      },
    });
  },

  applySnapshot: (snapshot) => {
    const nodeStatuses: Record<string, RunStatus> = {};
    const nodeOutputs: Record<string, Record<string, unknown>> = {};

    for (const node of snapshot.nodes) {
      nodeStatuses[node.nodeId] = node.status;

      if (node.outputs) {
        nodeOutputs[node.nodeId] = node.outputs;
      }
    }

    // Snapshot — источник истины на момент подключения: карты заменяются
    // целиком, а не сливаются с прошлым состоянием.
    set({
      runId: snapshot.run.id,
      runStatus: snapshot.run.status,
      nodeStatuses,
      nodeOutputs,
    });
  },

  applyEvent: (event) => {
    switch (event.type) {
      case 'run_started':
        set((state) => ({
          runStatus: 'running',
          // Первый старт — попытка 1. Дальше номер уточняется из run_completed
          // (`attemptsMade`): run_started не несёт этой информации, и первое
          // событие может быть пропущено, если клиент подписался позже старта.
          attemptNumber: state.attemptNumber === 0 ? 1 : state.attemptNumber,
        }));

        return;

      case 'node_started':
        set((state) => withNodeStatus(state, event.nodeId, 'running'));

        return;

      case 'node_completed':
        set((state) => ({
          ...withNodeStatus(state, event.nodeId, 'completed'),
          nodeOutputs: { ...state.nodeOutputs, [event.nodeId]: event.outputs },
        }));

        return;

      case 'node_failed':
        set((state) => ({
          ...withNodeStatus(state, event.nodeId, 'failed'),
          // Текст падения узла доступен сразу — пригодится в панели R4.3.
          runError: event.error,
        }));

        return;

      case 'run_completed':
        set((state) => ({
          runStatus: event.status,
          attemptsMade: event.attemptsMade,
          attempts: event.attempts,
          // `attemptsMade` — сколько попыток BullMQ сделал ДО текущей доставки
          // (KI-059), значит следующая попытка имеет номер attemptsMade + 2.
          attemptNumber: event.attemptsMade + 2,
          runError:
            event.status === 'failed'
              ? (state.runError ?? 'Запуск завершился с ошибкой')
              : null,
        }));

        // KI-060: `final` — признак того, что retry не будет: поток закрываем.
        if (event.final) {
          closeStreamIfAny();
        }

        return;
    }
  },

  resetRunState: () => {
    closeStreamIfAny();
    set({
      runId: null,
      runStatus: null,
      runError: null,
      nodeStatuses: {},
      nodeOutputs: {},
      attemptNumber: 0,
      attemptsMade: 0,
      attempts: null,
    });
  },

  setCurrentWorkflowId: (id, name) =>
    set((state) => ({
      currentWorkflowId: id,
      currentWorkflowName: name ?? state.currentWorkflowName,
    })),
  setCurrentWorkflowName: (name) => set({ currentWorkflowName: name }),

  setExecutionLevels: (levels) => set({ executionLevels: levelsToMap(levels) }),

  clearExecutionLevels: () => set({ executionLevels: {} }),

  setNotice: (notice) => set({ notice }),

  setFindCenter: (handler) => set({ findCenter: handler }),
}));
