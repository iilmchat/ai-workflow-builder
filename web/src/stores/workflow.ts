import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import type { NodeData } from '@/types/graph';

/** Состояние редактора графа. */
export interface WorkflowState {
  nodes: Node<NodeData>[];
  edges: Edge[];
  /** Добавляет узел и делает его единственным выделенным. */
  addNode: (node: Node<NodeData>) => void;
  /** Применяет изменения узлов от React Flow (drag, select, remove). */
  onNodesChange: (changes: NodeChange<Node<NodeData>>[]) => void;
  /** Применяет изменения связей от React Flow. */
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  /** Соединяет два порта новой связью. */
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node<NodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
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

  addNode: (node) =>
    set((state) => ({
      // Новый узел выделяем, а с остальных выделение снимаем.
      nodes: [
        ...state.nodes.map((existing) => ({ ...existing, selected: false })),
        node,
      ],
    })),

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => ({ edges: addEdge(connection, state.edges) })),

  setNodes: (nodes) => set({ nodes }),

  setEdges: (edges) => set({ edges }),
}));
