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
  createWorkflowAsync,
  getWorkflowAsync,
  planWorkflowAsync,
  updateWorkflowAsync,
  type ApiGraphEdge,
  type ApiGraphNode,
  type ApiWorkflow,
} from '@/lib/api';
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

/** Позиция узла на холсте. */
type Position = { x: number; y: number };

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
