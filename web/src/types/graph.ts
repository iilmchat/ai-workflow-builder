import type { Node } from '@xyflow/react';

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

/** Подписи узлов по их типу (используются в тулбаре и в шапке узла). */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  text: 'Text',
  llm: 'LLM',
  image: 'Image Generation',
};

/** Иконки узлов по их типу. */
export const NODE_TYPE_ICONS: Record<NodeType, string> = {
  text: '📝',
  llm: '🤖',
  image: '🖼',
};

/**
 * Типизированные порты узлов.
 *
 * Буква — метка рядом с портом, color — цвет точки порта:
 * T (text) — синий, G (generic) — зелёный, I (image) — серый.
 */
export type DataType = 'text' | 'generic' | 'image';

/** Подпись типа данных для метки порта. */
export const DATA_TYPE_LABELS: Record<DataType, string> = {
  text: 'T',
  generic: 'G',
  image: 'I',
};

/** Цвет порта по типу данных. */
export const DATA_TYPE_COLORS: Record<DataType, string> = {
  text: '#3b82f6',
  generic: '#22c55e',
  image: '#64748b',
};

/** Модели LLM, доступные в выпадающем списке (пока хардкод). */
export const LLM_MODELS = ['Claude Opus 4', 'GPT-4o', 'DeepSeek V4'] as const;

/** Модель LLM. */
export type LlmModel = (typeof LLM_MODELS)[number];

/** Подсказка о скорости/стоимости модели. */
export const LLM_MODEL_HINTS: Record<LlmModel, string> = {
  'Claude Opus 4': 'Высокий',
  'GPT-4o': 'Средний',
  'DeepSeek V4': 'Быстрый',
};

/** Модель генерации изображений (пока одна и неактивная). */
export const IMAGE_MODEL = 'Grom Nova 1K';

/** Данные узла Text. */
export interface TextNodeData extends Record<string, unknown> {
  label?: string;
  kind?: 'text';
  value: string;
}

/** Данные узла LLM. */
export interface LlmNodeData extends Record<string, unknown> {
  label?: string;
  kind?: 'llm';
  model: LlmModel;
}

/** Данные узла генерации изображений. */
export interface ImageGenNodeData extends Record<string, unknown> {
  label?: string;
  kind?: 'image';
  imageUrl?: string;
}

/** Узел Text в терминах React Flow. */
export type TextFlowNode = Node<TextNodeData, 'text'>;
/** Узел LLM в терминах React Flow. */
export type LlmFlowNode = Node<LlmNodeData, 'llm'>;
/** Узел генерации изображений в терминах React Flow. */
export type ImageGenFlowNode = Node<ImageGenNodeData, 'image'>;

/** Любой узел редактора. */
export type AppNode = TextFlowNode | LlmFlowNode | ImageGenFlowNode;

