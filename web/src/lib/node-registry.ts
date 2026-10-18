import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { NodeProps, NodeTypes } from '@xyflow/react';
import i18n from '@/i18n';
import type {
  AgentFlowNode,
  AppNode,
  AudioGenFlowNode,
  CommentFlowNode,
  CompareFlowNode,
  ConditionFlowNode,
  HttpFlowNode,
  ImageGenFlowNode,
  ImageToolFlowNode,
  LlmFlowNode,
  MemoryReadFlowNode,
  MemoryWriteFlowNode,
  MusicGenFlowNode,
  NodeCategory,
  NodeType,
  OutputFlowNode,
  SubWorkflowFlowNode,
  TextFlowNode,
  VectorQueryFlowNode,
  VectorUpsertFlowNode,
  VideoGenFlowNode,
} from '@/types/graph';

/**
 * Ленивые компоненты узлов (KI-008).
 *
 * Реестр больше не тянет все 18 узлов в стартовый бандл: компоненты
 * подгружаются при первом рендере узла отдельным ленивым чанком. До этого
 * один `index-*.js` занимал ~775 kB (порог warning'а — 780 kB), и каждый новый
 * тип узла приближал сборку к падению по лимиту.
 *
 * `lazy` требует `default`-экспорт, а компоненты узлов экспортированы
 * именованно, поэтому модуль «переворачивается» через `.then`. Ссылка на
 * ленивый компонент стабильна (создаётся на уровне модуля), так что React Flow
 * не видит новый тип на каждом рендере.
 *
 * Suspense-границы живут у потребителей (`Canvas`, `ShareViewPage`): React Flow
 * рендерит узлы внутри своего дерева, и граница должна быть выше `<ReactFlow>`.
 */
const AgentNode = lazy(() =>
  import('@/components/nodes/AgentNode').then((module) => ({
    default: module.AgentNode,
  })),
);

const CommentNode = lazy(() =>
  import('@/components/nodes/CommentNode').then((module) => ({
    default: module.CommentNode,
  })),
);

const CompareNode = lazy(() =>
  import('@/components/nodes/CompareNode').then((module) => ({
    default: module.CompareNode,
  })),
);

const ConditionNode = lazy(() =>
  import('@/components/nodes/ConditionNode').then((module) => ({
    default: module.ConditionNode,
  })),
);

const HttpNode = lazy(() =>
  import('@/components/nodes/HttpNode').then((module) => ({
    default: module.HttpNode,
  })),
);

const AudioGenNode = lazy(() =>
  import('@/components/nodes/AudioGenNode').then((module) => ({
    default: module.AudioGenNode,
  })),
);

const ImageGenNode = lazy(() =>
  import('@/components/nodes/ImageGenNode').then((module) => ({
    default: module.ImageGenNode,
  })),
);

const ImageToolNode = lazy(() =>
  import('@/components/nodes/ImageToolNode').then((module) => ({
    default: module.ImageToolNode,
  })),
);

const LLMNode = lazy(() =>
  import('@/components/nodes/LLMNode').then((module) => ({
    default: module.LLMNode,
  })),
);

const MemoryReadNode = lazy(() =>
  import('@/components/nodes/MemoryReadNode').then((module) => ({
    default: module.MemoryReadNode,
  })),
);

const MemoryWriteNode = lazy(() =>
  import('@/components/nodes/MemoryWriteNode').then((module) => ({
    default: module.MemoryWriteNode,
  })),
);

const MusicGenNode = lazy(() =>
  import('@/components/nodes/MusicGenNode').then((module) => ({
    default: module.MusicGenNode,
  })),
);

const OutputNode = lazy(() =>
  import('@/components/nodes/OutputNode').then((module) => ({
    default: module.OutputNode,
  })),
);

const SubWorkflowNode = lazy(() =>
  import('@/components/nodes/SubWorkflowNode').then((module) => ({
    default: module.SubWorkflowNode,
  })),
);

const TextNode = lazy(() =>
  import('@/components/nodes/TextNode').then((module) => ({
    default: module.TextNode,
  })),
);

const VectorQueryNode = lazy(() =>
  import('@/components/nodes/VectorQueryNode').then((module) => ({
    default: module.VectorQueryNode,
  })),
);

const VectorUpsertNode = lazy(() =>
  import('@/components/nodes/VectorUpsertNode').then((module) => ({
    default: module.VectorUpsertNode,
  })),
);

const VideoGenNode = lazy(() =>
  import('@/components/nodes/VideoGenNode').then((module) => ({
    default: module.VideoGenNode,
  })),
);

/**
 * Компонент узла одного конкретного типа.
 *
 * `React.lazy` возвращает `LazyExoticComponent`, а не функцию-компонент,
 * поэтому одного `ComponentType` мало: реестр принимает обе формы. Это
 * оставляет проверку props конкретного узла (без `as unknown` и `any`).
 */
type NodeComponentOf<T extends AppNode> =
  | ComponentType<NodeProps<T>>
  | LazyExoticComponent<ComponentType<NodeProps<T>>>;

/**
 * Компонент узла в реестре.
 *
 * У каждого типа узла свои props (`NodeProps<TextFlowNode>` и т. д.), а
 * `NodeProps` инвариантен по данным узла, поэтому общий
 * `ComponentType<NodeProps>` конкретные компоненты не принимает без
 * `as unknown`. Объединяем конкретные типы — проверка типов сохраняется.
 */
export type NodeComponent =
  | NodeComponentOf<TextFlowNode>
  | NodeComponentOf<LlmFlowNode>
  | NodeComponentOf<ImageGenFlowNode>
  | NodeComponentOf<ImageToolFlowNode>
  | NodeComponentOf<VideoGenFlowNode>
  | NodeComponentOf<AudioGenFlowNode>
  | NodeComponentOf<MusicGenFlowNode>
  | NodeComponentOf<CommentFlowNode>
  | NodeComponentOf<HttpFlowNode>
  | NodeComponentOf<ConditionFlowNode>
  | NodeComponentOf<OutputFlowNode>
  | NodeComponentOf<CompareFlowNode>
  | NodeComponentOf<SubWorkflowFlowNode>
  | NodeComponentOf<VectorUpsertFlowNode>
  | NodeComponentOf<VectorQueryFlowNode>
  | NodeComponentOf<MemoryReadFlowNode>
  | NodeComponentOf<MemoryWriteFlowNode>
  | NodeComponentOf<AgentFlowNode>;

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
  /** Ленивый React-компонент узла (KI-008). */
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
  // R7.1 (KI-196, DESIGN v0.9 § 2.2/3.1): media-инструмент (upscale, удаление
  // фона, хромакей, обрезка, липсинк). Категория `media_tools` — отдельная
  // секция каталога: узел не создаёт файл «с нуля», а преобразует входной.
  image_tool: {
    labelKey: 'node.image_tool.label',
    icon: '🪄',
    category: 'media_tools',
    component: ImageToolNode,
    // Вход `image-input` (target) — из него берётся ссылка на файл, поэтому
    // узел можно вставить в существующую связь (KI-259).
    canBeInsertedOnEdge: true,
    // `userConfig`: до запуска выбираются операция и модель.
    capabilities: { externalState: false, userConfig: true },
  },
  // R7.2 (KI-361, DESIGN v0.9 § 2.2/3.2): три узла media-генерации.
  // Категория `media_generation` — отдельная секция каталога: узлы создают
  // файл «с нуля» (как Image Generation), но работают с другим типом
  // media-модели (VIDEO/AUDIO/MUSIC) и потому отделены от `media_tools`.
  // `canBeInsertedOnEdge: true` — у каждого есть вход `text-input` (промпт);
  // `userConfig: true` — до запуска выбираются модель и её параметры.
  video_generation: {
    labelKey: 'node.video_generation.label',
    icon: '🎬',
    category: 'media_generation',
    component: VideoGenNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: true },
  },
  audio_generation: {
    labelKey: 'node.audio_generation.label',
    icon: '🎙',
    category: 'media_generation',
    component: AudioGenNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: false, userConfig: true },
  },
  music_generation: {
    labelKey: 'node.music_generation.label',
    icon: '🎵',
    category: 'media_generation',
    component: MusicGenNode,
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
  // R6.7 (KI-200, DESIGN v0.8 § 5): узел-ссылка на другой workflow владельца.
  // Категория `composition` — секция «Композиция» в каталоге (§ 5.4).
  sub_workflow: {
    labelKey: 'node.sub_workflow.label',
    icon: '🧩',
    category: 'composition',
    component: SubWorkflowNode,
    // Вход `text-input` (порт `prompt`) — узел можно вставить в связь.
    canBeInsertedOnEdge: true,
    // `userConfig`: до запуска нужно выбрать подграф в селекте. `externalState`
    // — `false`: ссылка лежит в `data` самого графа, а не во внешнем хранилище,
    // как у будущих узлов-сервисов (KI-128).
    capabilities: { externalState: false, userConfig: true },
  },
  // R7.4a (KI-128, DESIGN v0.9 § 3.4): vector/memory-узлы.
  //
  // `externalState: true` — впервые в проекте: узлы пишут и читают состояние
  // вне графа (таблицы `workflow_vectors`/`workflow_memory`). Это тот самый
  // класс сервисных узлов, который описан в KI-128, поэтому capability
  // выставлена честно, а не как у чистых преобразований.
  //
  // `userConfig: true` у всех: коллекция/ключ/модель выбираются до запуска.
  // `canBeInsertedOnEdge: true` — у каждого есть target-хендл `text-input`.
  vector_upsert: {
    labelKey: 'node.vector_upsert.label',
    icon: '📚',
    category: 'vector',
    component: VectorUpsertNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: true, userConfig: true },
  },
  vector_query: {
    labelKey: 'node.vector_query.label',
    icon: '🔎',
    category: 'vector',
    component: VectorQueryNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: true, userConfig: true },
  },
  memory_read: {
    labelKey: 'node.memory_read.label',
    icon: '📖',
    category: 'state',
    component: MemoryReadNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: true, userConfig: true },
  },
  memory_write: {
    labelKey: 'node.memory_write.label',
    icon: '💾',
    category: 'state',
    component: MemoryWriteNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: true, userConfig: true },
  },
  // R7.4b (DESIGN v0.9 § 3.4): агент с собственным циклом LLM → tools → final.
  //
  // `externalState: true` — инструменты читают и пишут векторы/память, а
  // `http_request` ходит во внешний мир: узел действительно держит состояние
  // вне графа. `userConfig: true` — модель, инструкция, инструменты и лимит
  // итераций выбираются до запуска. `canBeInsertedOnEdge: true` — есть
  // target-хендл `text-input`.
  agent: {
    labelKey: 'node.agent.label',
    icon: '🧠',
    category: 'ai',
    component: AgentNode,
    canBeInsertedOnEdge: true,
    capabilities: { externalState: true, userConfig: true },
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
 * Значения — ленивые компоненты (`React.lazy`), поэтому потребитель обязан
 * держать `<ReactFlow>` под `<Suspense>` (см. `Canvas` и `ShareViewPage`).
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
export function nodeLabelOf(
  node: AppNode | undefined,
  fallback: string,
): string {
  const type = node?.type;

  return type !== undefined && isNodeType(type)
    ? i18n.t(NODE_REGISTRY[type].labelKey)
    : fallback;
}
