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
 * Ключи — `NodeType`; tsc ловит пропущенные/лишние через
 * `Record<NodeType, ...>` и `satisfies`.
 */
export interface NodeRegistryEntry {
  /** i18n-ключ подписи (R5.3). До i18n — резолвится через `tLabel()`. */
  readonly labelKey: string;
  /** Эмодзи-иконка (в каталоге и в тулбаре). */
  readonly icon: string;
  /** Категория для каталога (§ 5.2 DESIGN v0.7). */
  readonly category: NodeCategory;
  /** React-компонент узла. */
  readonly component: NodeComponent;
  /** Capabilities — задел под KI-128 (сервисные узлы). */
  readonly capabilities: {
    /** Узел хранит внешнее состояние (БД, индекс, память). */
    readonly externalState: boolean;
    /** Требует пользовательской конфигурации до запуска. */
    readonly userConfig: boolean;
  };
}

/**
 * Единый реестр типов узлов.
 *
 * `as const satisfies Record<NodeType, NodeRegistryEntry>`:
 * - `Record<NodeType, ...>` — tsc требует запись для каждого типа;
 * - `as const` — литеральные типы для `labelKey`/`category`;
 * - `satisfies` — проверка формы без расширения типов.
 *
 * Порядок ключей — это порядок узлов в тулбаре и (в будущем) в каталоге.
 * Новый узел = новый файл-компонент + одна запись здесь (RULES 1.15).
 */
export const NODE_REGISTRY = {
  text: {
    labelKey: 'node.text.label',
    icon: '📝',
    category: 'input',
    component: TextNode,
    capabilities: { externalState: false, userConfig: false },
  },
  llm: {
    labelKey: 'node.llm.label',
    icon: '🤖',
    category: 'ai',
    component: LLMNode,
    capabilities: { externalState: false, userConfig: false },
  },
  image_generation: {
    labelKey: 'node.image_generation.label',
    icon: '🖼',
    category: 'media',
    component: ImageGenNode,
    capabilities: { externalState: false, userConfig: true },
  },
} as const satisfies Record<NodeType, NodeRegistryEntry>;

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

/**
 * Временный резолвер i18n-ключей до R5.3 (react-i18next).
 *
 * При добавлении нового ключа — добавить пару здесь. В R5.3
 * этот объект заменяется на `i18next.t()` без изменения
 * вызывающего кода.
 */
const TEMP_LABELS: Record<string, string> = {
  'node.text.label': 'Текст',
  'node.llm.label': 'LLM',
  'node.image_generation.label': 'Генерация изображения',
};

/**
 * Резолвит i18n-ключ подписи узла в строку.
 *
 * До R5.3 — через {@link TEMP_LABELS}; после — через `i18next.t()`.
 * Неизвестный ключ возвращается как есть, чтобы пропажа пары была видна в UI.
 *
 * @param key - i18n-ключ (например, `node.text.label`)
 * @returns подпись для UI либо сам ключ, если перевода ещё нет
 */
export function tLabel(key: string): string {
  return TEMP_LABELS[key] ?? key;
}

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
    ? tLabel(NODE_REGISTRY[type].labelKey)
    : fallback;
}
