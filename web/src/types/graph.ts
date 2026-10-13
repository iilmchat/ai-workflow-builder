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

/**
 * Модель LLM по умолчанию для нового узла.
 *
 * Временный fallback: список доступных моделей приходит с backend
 * (`GET /llm/models`, R4.1b) и кэшируется в сторе, но узел создаётся в момент,
 * когда список ещё может быть не загружен. Если этого id нет среди доступных,
 * селект покажет его как «(недоступно)» — молчаливой подмены модели нет
 * (KI-069). Выбор модели из уже загруженного списка при создании узла — задача
 * R4.3b (вместе с панелью и тулбаром).
 */
export const DEFAULT_LLM_MODEL_ID = 'claude-sonnet-4-20250514';

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
  /** id модели, который принимает backend (`claude-sonnet-4-20250514`) — KI-069. */
  model: string;
}

/** Данные узла генерации изображений. */
export interface ImageGenNodeData extends Record<string, unknown> {
  label?: string;
  kind?: 'image';
  imageUrl?: string;
  /**
   * id выбранной image-модели из каталога media (`GET /media/models`).
   *
   * Заполняется при создании узла первой доступной моделью
   * (v0.6.0b.2.3) и меняется в селекте; `''` — модель ещё не выбрана.
   */
  model?: string;
  /**
   * Соотношение сторон генерации (`aspect_ratio` в параметрах модели,
   * v0.6.0b.2.3). Пусто — используется дефолт модели из каталога.
   */
  aspectRatio?: string;
}

/** Узел Text в терминах React Flow. */
export type TextFlowNode = Node<TextNodeData, 'text'>;
/** Узел LLM в терминах React Flow. */
export type LlmFlowNode = Node<LlmNodeData, 'llm'>;
/** Узел генерации изображений в терминах React Flow. */
export type ImageGenFlowNode = Node<ImageGenNodeData, 'image'>;

/** Любой узел редактора. */
export type AppNode = TextFlowNode | LlmFlowNode | ImageGenFlowNode;

