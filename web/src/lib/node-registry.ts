import type { ComponentType } from 'react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import { ImageGenNode } from '@/components/nodes/ImageGenNode';
import { LLMNode } from '@/components/nodes/LLMNode';
import { TextNode } from '@/components/nodes/TextNode';
import type {
  AppNode,
  ImageGenFlowNode,
  LlmFlowNode,
  NodeCategory,
  NodeType,
  TextFlowNode,
} from '@/types/graph';

/**
 * Компонент узла в реестре.
 *
 * У каждого типа узла свои props (`NodeProps<TextFlowNode>` и т. д.), а
 * `NodeProps` инвариантен по данным узла, поэтому общий
 * `ComponentType<NodeProps>` конкретные компоненты не принимает без
 * `as unknown`. Объединяем конкретные типы — проверка типов сохраняется.
 */
export type NodeComponent =
  | ComponentType<NodeProps<TextFlowNode>>
  | ComponentType<NodeProps<LlmFlowNode>>
  | ComponentType<NodeProps<ImageGenFlowNode>>;

/**
 * Описание узла в реестре: единый источник правды.
 *
 * Ключи — `NodeType`; `tsc` ловит пропущенные/лишние типы (KI-121).
 */
export interface NodeRegistryEntry {
  /** Отображаемое имя (RU) — временно, до i18n (KI-126). */
  readonly label: string;
  /** Иконка узла: текстовый плейсхолдер, пока нет SVG. */
  readonly icon: string;
  /** Эмодзи для кнопки тулбара (v0.6.x). */
  readonly iconEmoji: string;
  /** Английская подпись (временно, до i18n KI-126) — для тулбара. */
  readonly labelEn: string;
  /** Категория для каталога (KI-127). */
  readonly category: NodeCategory;
  /** React-компонент узла. */
  readonly component: NodeComponent;
}

/**
 * Единый реестр типов узлов.
 *
 * `Record<NodeType, ...>` — tsc ловит забытые типы: добавили тип в
 * `NodeType` и не добавили в реестр → ошибка компиляции. Порядок ключей —
 * это порядок узлов в тулбаре и (в будущем) в каталоге (KI-121, KI-127).
 */
export const NODE_REGISTRY: Record<NodeType, NodeRegistryEntry> = {
  text: {
    label: 'Текст',
    icon: 'T',
    iconEmoji: '📝',
    labelEn: 'Text',
    category: 'input',
    component: TextNode,
  },
  llm: {
    label: 'LLM',
    icon: 'LLM',
    iconEmoji: '🤖',
    labelEn: 'LLM',
    category: 'ai',
    component: LLMNode,
  },
  image_generation: {
    label: 'Генерация изображения',
    icon: 'IMG',
    iconEmoji: '🖼',
    labelEn: 'Image Generation',
    category: 'ai',
    component: ImageGenNode,
  },
};

/** Список всех типов (для валидации и обхода) — выводится из реестра. */
export const NODE_TYPES = Object.keys(NODE_REGISTRY) as NodeType[];

/**
 * Проверка: строка — валидный `NodeType`.
 *
 * Нужна на границе с backend (`fromApiWorkflow`): раньше там была цепочка
 * `!== 'text' && !== 'llm' && ...`, и забытый тип не ловил ни tsc, ни тест
 * (KI-121).
 *
 * @param value - значение `node.type` из API
 * @returns `true`, если тип есть в реестре
 */
export function isNodeType(value: string): value is NodeType {
  return value in NODE_REGISTRY;
}

/**
 * `nodeTypes` для React Flow — выводится из реестра.
 *
 * Двойное приведение нужно из-за инвариантности `NodeProps`: конкретные
 * компоненты подходят под `NodeTypes` только после стирания их props.
 * Во время выполнения React Flow передаёт компоненту props именно его узла.
 */
export const nodeTypes = Object.fromEntries(
  NODE_TYPES.map((type) => [type, NODE_REGISTRY[type].component]),
) as unknown as NodeTypes;

/** Подписи узлов по типу — для тулбара и шапки узла (KI-123). */
export const NODE_TYPE_LABELS: Record<NodeType, string> = Object.fromEntries(
  NODE_TYPES.map((type) => [type, NODE_REGISTRY[type].label]),
) as Record<NodeType, string>;

/** Иконки узлов по типу — для тулбара и шапки узла (KI-123). */
export const NODE_TYPE_ICONS: Record<NodeType, string> = Object.fromEntries(
  NODE_TYPES.map((type) => [type, NODE_REGISTRY[type].icon]),
) as Record<NodeType, string>;

/**
 * Подпись узла для UI: берётся **только** из реестра.
 *
 * `data.label` удалён (v0.6.x): подпись типа узла — это метаданные реестра,
 * а не данные графа, поэтому хранить её в узле и в БД больше не нужно.
 *
 * @param node - узел графа (у узлов неизвестного типа `type` может быть не задан)
 * @param fallback - запасной текст, обычно id узла
 * @returns подпись из реестра либо `fallback`
 */
export function nodeLabelOf(node: AppNode | undefined, fallback: string): string {
  const type = node?.type;

  return type !== undefined && isNodeType(type)
    ? NODE_REGISTRY[type].label
    : fallback;
}
