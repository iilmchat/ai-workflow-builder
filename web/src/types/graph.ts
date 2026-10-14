import type { Node } from '@xyflow/react';

/**
 * Дискриминированный union данных узла по `kind`.
 *
 * `kind` — обязательный дискриминатор: без него tsc не сужает тип
 * при работе с `node.data`. Связь `kind` ↔ `NodeType` проверяется
 * через `NODE_REGISTRY satisfies Record<NodeType, NodeRegistryEntry>`
 * (см. `@/lib/node-registry`).
 *
 * `extends Record<string, unknown>` у подтипов сохранено сознательно: этого
 * требуют React Flow (`Node<TData extends Record<string, unknown>>`) и API-слой
 * (`ApiGraphNode.data` — `Record<string, unknown>`), иначе `Node<TextNodeData,
 * 'text'>` и `toApiNode` перестанут компилироваться.
 */
export type NodeData = TextNodeData | LlmNodeData | ImageGenNodeData;

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

/**
 * Типы узлов, доступные из нижнего тулбара.
 *
 * Значение `type` узла уходит в backend как есть (`NodeDto.type`), поэтому
 * имена совпадают с backend-контрактом: `image_generation`, а не `image`
 * (v0.6.0b.2.5). UI-метка узла (`data.kind`) остаётся `image`.
 */
export type NodeType = 'text' | 'llm' | 'image_generation';

/**
 * Категории узлов для каталога (KI-127, § 5.2 DESIGN v0.7).
 *
 * Порядок = порядок секций в каталоге. Категория `media` — для текущего
 * `image_generation` и будущих video/audio-узлов. Сами иконки и привязка типов
 * к категориям живут в едином реестре `@/lib/node-registry`.
 */
export const NODE_CATEGORIES = [
  'input',
  'ai',
  'media',
  'tools',
  'output',
] as const;

/** Категория узла (KI-127). */
export type NodeCategory = (typeof NODE_CATEGORIES)[number];

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

/** Данные узла `text`: строка текста. */
export interface TextNodeData extends Record<string, unknown> {
  kind: 'text';
  value: string;
}

/** Данные узла `llm`: id модели. */
export interface LlmNodeData extends Record<string, unknown> {
  kind: 'llm';
  /** id модели, который принимает backend (`claude-sonnet-4-20250514`) — KI-069. */
  model: string;
}

/** Данные узла `image_generation`: id модели, соотношение, URL. */
export interface ImageGenNodeData extends Record<string, unknown> {
  kind: 'image';
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
  /**
   * Ссылка на результат генерации.
   *
   * Поле появляется только если backend его отдал: `undefined` не присваиваем
   * (KI-129), чтобы пустых ключей не было в JSON и `Object.keys(data)`.
   */
  imageUrl?: string;
}

/** Узел Text в терминах React Flow. */
export type TextFlowNode = Node<TextNodeData, 'text'>;
/** Узел LLM в терминах React Flow. */
export type LlmFlowNode = Node<LlmNodeData, 'llm'>;
/** Узел генерации изображений в терминах React Flow. */
export type ImageGenFlowNode = Node<ImageGenNodeData, 'image_generation'>;

/** Любой узел редактора. */
export type AppNode = TextFlowNode | LlmFlowNode | ImageGenFlowNode;

