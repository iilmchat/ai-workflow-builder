/** Тип данных узла: метка + произвольные параметры конкретного типа узла. */
export type NodeData = {
  label?: string;
  [key: string]: unknown;
};

/** Узел графа — совместим с backend-DTO `NodeDto`. */
export type GraphNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: NodeData;
};

/** Связь графа — совместима с backend-DTO `EdgeDto`. */
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
};

/** Граф целиком — совместим с backend-DTO `GraphDto`. */
export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

/** Типы узлов, доступные из нижнего тулбара. */
export type NodeType = 'text' | 'llm' | 'image';

/** Подписи узлов по их типу (используются в тулбаре и в метке узла). */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  text: 'Text',
  llm: 'LLM',
  image: 'Image Generation',
};
