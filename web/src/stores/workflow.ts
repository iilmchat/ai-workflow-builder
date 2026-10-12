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
  LLM_MODELS,
  type AppNode,
  type NodeType,
} from '@/types/graph';

/** Состояние редактора графа. */
export interface WorkflowState {
  nodes: AppNode[];
  edges: Edge[];
  /** Создаёт узел нужного типа в указанной позиции и делает его выделенным. */
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  /** Применяет изменения узлов от React Flow (drag, select, remove). */
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  /** Применяет изменения связей от React Flow. */
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  /** Соединяет два порта новой связью. */
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: AppNode[]) => void;
  setEdges: (edges: Edge[]) => void;
}

/**
 * Создаёт узел нужного типа с дефолтными данными.
 *
 * @param type - тип узла из тулбара
 * @param position - позиция на холсте
 * @param index - порядковый номер узла, нужен для уникального id
 */
function createNode(
  type: NodeType,
  position: { x: number; y: number },
  index: number,
): AppNode {
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

/**
 * Стор редактора workflow.
 *
 * Пока хранит только узлы и связи; синхронизация с backend появится
 * в следующих задачах.
 */
export const useWorkflowStore = create<WorkflowState>((set) => ({
  nodes: [],
  edges: [],

  addNode: (type, position) =>
    set((state) => {
      const node = createNode(type, position, state.nodes.length);

      return {
        // Новый узел выделяем, а с остальных выделение снимаем.
        nodes: [
          ...state.nodes.map((existing) => ({ ...existing, selected: false })),
          { ...node, selected: true },
        ],
      };
    }),

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => ({ edges: addEdge(connection, state.edges) })),

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),
}));
