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
export type NodeData =
  | TextNodeData
  | LlmNodeData
  | ImageGenNodeData
  | ImageToolNodeData
  | VideoGenNodeData
  | AudioGenNodeData
  | MusicGenNodeData
  | CommentNodeData
  | HttpNodeData
  | ConditionNodeData
  | OutputNodeData
  | CompareNodeData
  | SubWorkflowNodeData;

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
 *
 * `comment` (KI-187, KI-266) — узел-аннотация: сохраняется в графе наравне с
 * остальными типами, но backend исключает его из плана выполнения
 * (`ANNOTATION_NODE_TYPES` в `src/engine/node-executors.ts`). Имя совпадает с
 * типом React Flow — другого контракта у него нет.
 *
 * R6.5.2 (KI-105, DESIGN v0.8 § 8): добавлены четыре вычислительных узла —
 * `http` (§ 8.1), `condition` (§ 8.2), `output` (§ 8.3) и `compare` (§ 8.5).
 * Узел `note` из DESIGN § 8.4 отдельным типом **не** заводится: он реализован
 * как `comment` ещё в R6.4b.2a (KI-187), дублировать его не нужно.
 *
 * R6.7 (KI-200, DESIGN v0.8 § 5): добавлен исполняемый узел `sub_workflow` —
 * ссылка на другой workflow владельца. В `ANNOTATION_NODE_TYPES` (backend) его
 * нет: узел выполняется, а не лежит заметкой на холсте.
 */
export type NodeType =
  | 'text'
  | 'llm'
  | 'image_generation'
  | 'image_tool'
  | 'video_generation'
  | 'audio_generation'
  | 'music_generation'
  | 'comment'
  | 'http'
  | 'condition'
  | 'output'
  | 'compare'
  | 'sub_workflow';

/**
 * Категории узлов для каталога (KI-127, § 5.2 DESIGN v0.7).
 *
 * Порядок = порядок секций в каталоге. Категория `media` — для текущего
 * `image_generation` и будущих video/audio-узлов. `media_tools` (R7.1, DESIGN
 * v0.9 § 2.2) — секция media-**инструментов** (upscale, удаление фона, липсинк):
 * они не создают файл «с нуля», а преобразуют входной, поэтому отделены от
 * генерации. `media_generation` (R7.2, DESIGN v0.9 § 3.2) — секция
 * media-**генерации** (`video_generation`, `audio_generation`,
 * `music_generation`): узлы создают новый файл по промпту, как
 * `image_generation`, но помечены отдельной секцией, потому что работают с
 * другим типом media-модели (VIDEO/AUDIO/MUSIC). `composition` (R6.7) — секция
 * «Композиция» (DESIGN v0.8 § 5.4) для узлов, которые собирают граф из других
 * графов (`sub_workflow`). Сами иконки и привязка типов к категориям живут в
 * едином реестре `@/lib/node-registry`.
 */
export const NODE_CATEGORIES = [
  'input',
  'ai',
  'media',
  'media_generation',
  'media_tools',
  'tools',
  'composition',
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

/** Данные узла `llm`: id модели и (необязательно) промпт. */
export interface LlmNodeData extends Record<string, unknown> {
  kind: 'llm';
  /** id модели, который принимает backend (`claude-sonnet-4-20250514`) — KI-069. */
  model: string;
  /**
   * Промпт, введённый прямо в узле (KI-180).
   *
   * Если он непустой, используется, когда нет связи от Text-узла
   * (`inputs.prompt` приоритетнее).
   */
  prompt?: string;
  /**
   * System prompt узла (R6.3.2, KI-192).
   *
   * Backend отправляет его первым system-сообщением; тексты промптов в логи не
   * пишутся (RULES 5.9).
   */
  systemPrompt?: string;
  /**
   * Режим reasoning (R6.3.2, KI-193).
   *
   * Поле показывается только для моделей с `supportsReasoning`; `'off'` —
   * «не передавать провайдеру».
   */
  reasoningEffort?: 'off' | 'medium' | 'high';
  /** Override лимита токенов ответа (R6.3.2, KI-183); пусто — дефолт модели. */
  maxTokensOverride?: number;
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
  /**
   * Промпт, заданный прямо в узле (KI-160).
   *
   * Если он непустой, генерация идёт по нему, иначе — по входу `prompt` от
   * Text/LLM-узла (обратная совместимость). Backend читает `data.prompt`
   * с fallback на `data.value` для workflow, сохранённых раньше (KI-166).
   */
  prompt?: string;
}

/**
 * Операции media-инструмента (R7.1, DESIGN v0.9 § 3.1).
 *
 * Зеркало backend `IMAGE_TOOL_OPERATIONS` (`src/media/image-tool.ts`): значения
 * уходят в граф как есть и проверяются Zod-схемой узла на backend, поэтому UI
 * не должен предлагать операцию, которую executor отвергнет.
 */
export const IMAGE_TOOL_OPERATIONS = [
  'upscale',
  'bg_removal',
  'chromakey',
  'trim',
  'lipsync',
] as const;

/** Операция media-инструмента. */
export type ImageToolOperation = (typeof IMAGE_TOOL_OPERATIONS)[number];

/**
 * Данные узла `image_tool` (R7.1, DESIGN v0.9 § 3.1).
 *
 * Узел применяет media-инструмент (upscale, удаление фона, хромакей, обрезка,
 * липсинк) к **готовому файлу**: вход — ссылка на файл по связи
 * (`inputs.url` от `image_generation` либо любого узла с портом `text`) или
 * `inputUrl`, заданный прямо в узле (fallback, если связи нет).
 *
 * Порты (`src/engine/node-ports.ts`): вход `image-input` → порт `url`, выход
 * `image-output` → порт `resultUrls` (массив ссылок, DESIGN § 3.1).
 */
export interface ImageToolNodeData extends Record<string, unknown> {
  kind: 'image_tool';
  /** Операция инструмента; `undefined` трактуется как «не выбрана». */
  operation: ImageToolOperation;
  /**
   * id модели-инструмента из каталога media (`GET /media/models?type=TOOL`).
   *
   * `''` — «модель ещё не выбрана». У операций с известной моделью
   * (`bg_removal`, `lipsync`) backend подставит дефолт, у остальных запуск
   * упадёт понятной ошибкой — молчаливой подмены нет (KI-069).
   */
  model?: string;
  /**
   * Ссылка на входной файл — фолбэк, если узел не связан с источником.
   *
   * `undefined` не присваиваем (KI-129): пустых ключей в JSON быть не должно.
   */
  inputUrl?: string;
  /** Параметры конкретной операции (промпт, audioUrl, поля модели). */
  params?: Record<string, unknown>;
}

/**
 * Данные узла `video_generation` (R7.2, KI-361, DESIGN v0.9 § 3.2).
 *
 * Узел генерирует видео по промпту, опционально — из картинки
 * (image-to-video). Порты (`src/engine/node-ports.ts`): вход `text-input` →
 * порт `prompt`, выход `video-output` → порт `mediaUrl` (тот же ключ, что у
 * `image_generation`, — урок KI-368).
 *
 * Картинка для image-to-video задаётся полем `imageUrl`, а не вторым входом:
 * у узла один входной хендл, иначе React Flow свернул бы обе связи в один
 * ключ (KI-035).
 */
export interface VideoGenNodeData extends Record<string, unknown> {
  kind: 'video_generation';
  /** id VIDEO-модели из каталога media; `''` — не выбрана (дефолт backend). */
  model?: string;
  /** Промпт; если пуст, берётся вход `prompt` от Text/LLM-узла. */
  prompt?: string;
  /** Ссылка на изображение для image-to-video (слот выберет backend). */
  imageUrl?: string;
  /**
   * Длительность в секундах (DESIGN § 3.2 — 3–10, каталог допускает до 30).
   *
   * Значение уходит параметром `duration` только у моделей, которые его
   * объявили; UI предлагает значения из схемы модели.
   */
  durationSec?: number;
  /** Соотношение сторон (`aspect_ratio`), если модель его объявляет. */
  aspectRatio?: string;
  /** Прочие параметры модели (уходят только объявленные каталогом). */
  params?: Record<string, unknown>;
}

/**
 * Данные узла `audio_generation` (R7.2, KI-361, DESIGN v0.9 § 3.2).
 *
 * Синтез речи (TTS): текст — из входа `prompt` либо `data.text`, голос и
 * скорость — параметры модели. Порты: вход `text-input` → `prompt`, выход
 * `audio-output` → `mediaUrl`.
 */
export interface AudioGenNodeData extends Record<string, unknown> {
  kind: 'audio_generation';
  /** id модели озвучки; `''` — не выбрана (backend берёт TTS из каталога). */
  model?: string;
  /** Текст для синтеза; вход `prompt` приоритетнее. */
  text?: string;
  /** id голоса → параметр `voice`/`voice_id` (ключ выбирается по каталогу). */
  voiceId?: string;
  /** Скорость речи 0.5–2.0 (DESIGN § 3.2), если модель её объявляет. */
  speed?: number;
  /** Прочие параметры модели (уходят только объявленные каталогом). */
  params?: Record<string, unknown>;
}

/**
 * Данные узла `music_generation` (R7.2, KI-361, DESIGN v0.9 § 3.2).
 *
 * Порты: вход `text-input` → `prompt`, выход `music-output` → `mediaUrl`.
 */
export interface MusicGenNodeData extends Record<string, unknown> {
  kind: 'music_generation';
  /** id MUSIC-модели из каталога media; `''` — не выбрана (дефолт backend). */
  model?: string;
  /** Промпт; если пуст, берётся вход `prompt`. */
  prompt?: string;
  /** Длительность в секундах → параметр `duration` (если объявлен моделью). */
  durationSec?: number;
  /** Жанр → параметр `genre`/`tags` (если объявлен моделью). */
  genre?: string;
  /** Прочие параметры модели (уходят только объявленные каталогом). */
  params?: Record<string, unknown>;
}

/**
 * Данные узла-комментария (KI-187).
 * Стикер без портов: в потоке данных не участвует, в `executionLevels` не
 * попадает — backend исключает аннотации из плана выполнения (KI-266).
 */
export interface CommentNodeData extends Record<string, unknown> {
  kind: 'comment';
  /** Текст комментария. */
  text: string;
  /**
   * Видимость на холсте (KI-187, хоткей `Shift+C`).
   *
   * `false` — узел скрыт (`CommentNode` возвращает `null`); `undefined`
   * трактуется как «видим» — так старые графы и узлы, созданные до появления
   * поля, не исчезают с холста.
   */
  visible?: boolean;
}

/**
 * Методы HTTP-узла (DESIGN v0.8 § 8.1).
 *
 * Набор совпадает с backend-схемой `HttpNodeDataSchema` (`src/engine/node-executors.ts`,
 * R6.5.1): значения уходят в граф как есть, поэтому UI не должен предлагать
 * метод, который backend отвергнет.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Данные узла `http` (R6.5.2, DESIGN v0.8 § 8.1).
 *
 * Порты (`src/engine/node-ports.ts`, R6.5.1): вход `text-input` → порт `prompt`
 * (URL-фолбэк, если поле пустое), выход `http-output` → порт `result`.
 */
export interface HttpNodeData extends Record<string, unknown> {
  kind: 'http';
  /** HTTP-метод запроса. */
  method: HttpMethod;
  /**
   * Абсолютный URL (`http`/`https`).
   *
   * Пустая строка — валидное состояние: backend возьмёт адрес из входа
   * `prompt` (`executeHttpNode`), поэтому узел остаётся запускаемым с одним
   * Text-предшественником.
   */
  url: string;
  /** Заголовки запроса; `undefined` — не заданы (KI-129: пустых ключей нет). */
  headers?: Record<string, string>;
  /**
   * Тело запроса (JSON).
   *
   * Показывается в UI только для методов с телом (`POST`/`PUT`/`DELETE`):
   * у `GET` оно всё равно отбрасывается исполнителем.
   */
  body?: string;
  /** Таймаут запроса в мс; `undefined` — дефолт backend (30 000 мс). */
  timeoutMs?: number;
}

/** Операции сравнения узла `condition` (DESIGN v0.8 § 8.2, MVP-DSL). */
export type ConditionOperator = '>' | '<' | '>=' | '<=' | '===' | 'includes';

/** Операция условия по умолчанию — как в `createNode` (§ 8.2). */
export const DEFAULT_CONDITION_OPERATOR: ConditionOperator = '===';

/**
 * Данные узла `condition` (R6.5.2, DESIGN v0.8 § 8.2).
 *
 * Порты (`src/engine/node-ports.ts`, R6.5.1): вход `condition-input` → порт
 * `input`. Выходов у узла два (`true-output` / `false-output`), но
 * зарегистрированный контракт описывает один источник (`condition-output`),
 * поэтому оба хендла дают один и тот же порт `result` — маршрутизации веток в
 * v0.8 нет, обе ветки выполняются (KI-278).
 */
export interface ConditionNodeData extends Record<string, unknown> {
  kind: 'condition';
  /** Левая часть: `input.X` либо литерал (`5`, `'abc'`, `true`). */
  left: string;
  /** Операция сравнения. */
  operator: ConditionOperator;
  /** Правая часть: `input.X` либо литерал. */
  right: string;
}

/** Имя выхода узла `output` по умолчанию (как в `createNode`). */
export const DEFAULT_OUTPUT_NAME = 'result';

/**
 * Данные узла `output` (R6.5.2, DESIGN v0.8 § 8.3).
 *
 * Терминальный узел: вход `text-input` → порт `prompt`, выходов нет. Значение
 * первого непустого входа попадает в `node_runs.outputs` под ключом `name`.
 */
export interface OutputNodeData extends Record<string, unknown> {
  kind: 'output';
  /**
   * Ключ, под которым результат попадёт в `outputs`.
   *
   * Backend требует непустое имя (`OutputNodeDataSchema`: `min(1)`), но UI
   * значение не подменяет: пустое поле честно роняет запуск с ошибкой
   * валидации, а не превращается молча в `result` (ср. KI-069).
   */
  name: string;
}

/**
 * Данные узла `compare` (R6.5.2, DESIGN v0.8 § 8.5).
 *
 * Порты: два входа `a`/`b` (без записи в `NODE_PORT_CONTRACT`, поэтому ключ
 * входа берётся из `edge.targetHandle` — KI-279) и один выход `text-output`.
 * Режим пока один: `llm-judge` из DESIGN § 8.5 — задача v0.8.x.
 */
export interface CompareNodeData extends Record<string, unknown> {
  kind: 'compare';
  /** Режим сравнения; backend поддерживает только `diff`. */
  mode: 'diff';
}

/**
 * Данные узла `sub_workflow` (R6.7, DESIGN v0.8 § 5.2).
 *
 * Узел — ссылка на другой workflow **того же владельца**. Executor backend
 * загружает подграф, выполняет его как часть родительского запуска и кладёт
 * выходы терминальных узлов подграфа в `outputs.result`.
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` → порт `prompt`,
 * выход `result-output` → порт `result`. Выходной хендл назван отдельно от
 * `text-output`: тот уже занят `text`/`llm` и переводится в порт `text`
 * (KI-301), из-за чего результат подграфа терялся бы.
 */
export interface SubWorkflowNodeData extends Record<string, unknown> {
  kind: 'sub_workflow';
  /**
   * uuid выбранного workflow.
   *
   * Пустая строка — валидное состояние «ещё не выбран»: Run упадёт ошибкой
   * валидации узла на backend, а UI молча ничего не подставляет (KI-069).
   */
  workflowId: string;
  /**
   * Снимок версии графа на момент выбора (DESIGN § 5.5).
   *
   * `undefined` — ссылка без снимка (например, граф сохранён до R6.7):
   * сравнение версий не выполняется, warning не показывается.
   */
  version?: number;
  /**
   * Маппинг «имя входа родителя → ключ в `inputs` подграфа».
   *
   * В v0.8 хранится и переносится между Save/Load, но executor его пока не
   * применяет (KI-303): у подграфа один вход, именованные входы — KI-278/279.
   */
  inputsMap?: Record<string, string>;
}

/** Узел Text в терминах React Flow. */
export type TextFlowNode = Node<TextNodeData, 'text'>;
/** Узел LLM в терминах React Flow. */
export type LlmFlowNode = Node<LlmNodeData, 'llm'>;
/** Узел генерации изображений в терминах React Flow. */
export type ImageGenFlowNode = Node<ImageGenNodeData, 'image_generation'>;
/** Узел media-инструмента в терминах React Flow (R7.1, KI-196). */
export type ImageToolFlowNode = Node<ImageToolNodeData, 'image_tool'>;
/** Узел генерации видео в терминах React Flow (R7.2, KI-361). */
export type VideoGenFlowNode = Node<VideoGenNodeData, 'video_generation'>;
/** Узел синтеза речи в терминах React Flow (R7.2, KI-361). */
export type AudioGenFlowNode = Node<AudioGenNodeData, 'audio_generation'>;
/** Узел генерации музыки в терминах React Flow (R7.2, KI-361). */
export type MusicGenFlowNode = Node<MusicGenNodeData, 'music_generation'>;
/** Узел-комментарий в терминах React Flow (KI-187). */
export type CommentFlowNode = Node<CommentNodeData, 'comment'>;
/** Узел HTTP-запроса в терминах React Flow (R6.5.2). */
export type HttpFlowNode = Node<HttpNodeData, 'http'>;
/** Узел условия в терминах React Flow (R6.5.2). */
export type ConditionFlowNode = Node<ConditionNodeData, 'condition'>;
/** Терминальный узел вывода в терминах React Flow (R6.5.2). */
export type OutputFlowNode = Node<OutputNodeData, 'output'>;
/** Узел сравнения в терминах React Flow (R6.5.2). */
export type CompareFlowNode = Node<CompareNodeData, 'compare'>;
/** Узел под-workflow в терминах React Flow (R6.7, KI-200). */
export type SubWorkflowFlowNode = Node<SubWorkflowNodeData, 'sub_workflow'>;

/** Любой узел редактора. */
export type AppNode =
  | TextFlowNode
  | LlmFlowNode
  | ImageGenFlowNode
  | ImageToolFlowNode
  | VideoGenFlowNode
  | AudioGenFlowNode
  | MusicGenFlowNode
  | CommentFlowNode
  | HttpFlowNode
  | ConditionFlowNode
  | OutputFlowNode
  | CompareFlowNode
  | SubWorkflowFlowNode;

