import type { ComponentType } from 'react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import { CommentNode } from '@/components/nodes/CommentNode';
import { CompareNode } from '@/components/nodes/CompareNode';
import { ConditionNode } from '@/components/nodes/ConditionNode';
import { HttpNode } from '@/components/nodes/HttpNode';
import { ImageGenNode } from '@/components/nodes/ImageGenNode';
import { LLMNode } from '@/components/nodes/LLMNode';
import { OutputNode } from '@/components/nodes/OutputNode';
import { TextNode } from '@/components/nodes/TextNode';
import i18n from '@/i18n';
import type {
  AppNode,
  CommentFlowNode,
  CompareFlowNode,
  ConditionFlowNode,
  HttpFlowNode,
  ImageGenFlowNode,
  LlmFlowNode,
  NodeCategory,
  NodeType,
  OutputFlowNode,
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
  | ComponentType<NodeProps<ImageGenFlowNode>>
  | ComponentType<NodeProps<CommentFlowNode>>
  | ComponentType<NodeProps<HttpFlowNode>>
  | ComponentType<NodeProps<ConditionFlowNode>>
  | ComponentType<NodeProps<OutputFlowNode>>
  | ComponentType<NodeProps<CompareFlowNode>>;

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
  /**
   * Можно ли вставить узел этого типа в существующую связь (KI-259).
   *
   * `true` только если у узла есть **входной** порт (`Handle type="target"`):
   * иначе ребро `source → новый узел` не создать — React Flow не найдёт target
   * handle и вернёт ошибку `error008`. Поле — единый источник правды: по нему
   * фильтруется каталог вставки (`NodeCatalogPopover.filter`) и защищается
   * `addNodeOnEdge` в сторе.
   */
  readonly canBeInsertedOnEdge: boolean;
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
    // Входного порта нет: у TextNode только `text-output` (source).
    canBeInsertedOnEdge: false,
    capabilities: { externalState: false, userConfig: false },
  },
  llm: {
    labelKey: 'node.llm.label',
    icon: '🤖',
    category: 'ai',
    component: LLMNode,
    // Есть `text-input` (target) и `text-output` (source).
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: false },
  },
  image_generation: {
    labelKey: 'node.image_generation.label',
    icon: '🖼',
    category: 'media',
    component: ImageGenNode,
    // Есть `text-input` (target) и `image-output` (source).
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: true },
  },
  comment: {
    labelKey: 'node.comment.label',
    // 📝 занят Text-узлом, поэтому у стикера — «🗒» (заметка).
    icon: '🗒',
    // Категория `input`: комментарий — это ввод пользователя (свободный текст),
    // а не вычислительный инструмент. Отдельную категорию не заводим: пустые
    // секции каталог и так не показывает, а новая категория потребовала бы
    // ещё и ключ `catalog.category.*` в обоих i18n-файлах.
    category: 'input',
    component: CommentNode,
    // Портов нет: ребро `source → comment` создать нельзя (KI-259).
    canBeInsertedOnEdge: false,
    // Узел хранит текст в графе; backend переносит его между Save/Load, но
    // исключает из плана выполнения (KI-266).
    capabilities: { externalState: false, userConfig: false },
  },
  // R6.5.2 (KI-105, DESIGN v0.8 § 8): четыре вычислительных узла. У всех есть
  // входной порт (`canBeInsertedOnEdge: true`), кроме того у `http` есть
  // пользовательская конфигурация до запуска — адрес и метод запроса.
  http: {
    labelKey: 'node.http.label',
    icon: '🌐',
    category: 'tools',
    component: HttpNode,
    // Вход `text-input` (порт `prompt`) — из него берётся URL-фолбэк.
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: true },
  },
  condition: {
    labelKey: 'node.condition.label',
    icon: '🔀',
    category: 'tools',
    component: ConditionNode,
    // Вход `condition-input` (порт `input`). Выходов визуально два
    // (`true-output`/`false-output`), маршрутизации веток в v0.8 нет (KI-278).
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: false },
  },
  output: {
    labelKey: 'node.output.label',
    icon: '📤',
    category: 'output',
    component: OutputNode,
    // Вход `text-input` (порт `prompt`); выходов нет — узел терминальный.
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: false },
  },
  compare: {
    labelKey: 'node.compare.label',
    icon: '⚖️',
    category: 'ai',
    component: CompareNode,
    // Два входа `a`/`b` — оба target-хендлы, поэтому вставка в связь возможна.
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: false },
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
 * Можно ли вставить узел этого типа в существующую связь (KI-259).
 *
 * Обёртка над полем реестра `canBeInsertedOnEdge`: один источник правды и для
 * фильтра каталога (`NodeCatalogPopover.filter`), и для защиты в
 * `addNodeOnEdge`. Функция, а не инлайн-предикат, чтобы передавать её пропом
 * без пересоздания на каждом рендере.
 *
 * @param type - тип узла из реестра
 * @returns `true`, если у узла есть входной порт и ребро `source → новый узел` создаётся
 */
export function canInsertOnEdge(type: NodeType): boolean {
  return NODE_REGISTRY[type].canBeInsertedOnEdge;
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
 * Подпись узла для UI: берётся **только** из реестра.
 *
 * `data.label` удалён (v0.6.x): подпись типа узла — это метаданные реестра,
 * а не данные графа, поэтому хранить её в узле и в БД больше не нужно.
 * Резолвит ключ глобальный инстанс i18next (R5.3): функция вызывается и вне
 * React-компонентов (TopBar, RunResultPanel, стор), где хука нет.
 *
 * @param node - узел графа (у узлов неизвестного типа `type` может быть не задан)
 * @param fallback - запасной текст, обычно id узла
 * @returns подпись из реестра либо `fallback`
 */
export function nodeLabelOf(node: AppNode | undefined, fallback: string): string {
  const type = node?.type;

  return type !== undefined && isNodeType(type)
    ? i18n.t(NODE_REGISTRY[type].labelKey)
    : fallback;
}
