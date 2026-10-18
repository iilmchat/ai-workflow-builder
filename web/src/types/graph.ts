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
  | SubWorkflowNodeData
  | VectorUpsertNodeData
  | VectorQueryNodeData
  | MemoryReadNodeData
  | MemoryWriteNodeData
  | AgentNodeData
  // v0.10 S0: каркас новых узлов (исполнители и компоненты — S1+).
  | WebSearchNodeData
  | DocumentGenNodeData
  | ReadFileNodeData
  | WriteFileNodeData;

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
 *
 * R7.4a (KI-128, DESIGN v0.9 § 3.4): четыре узла vector/memory —
 * `vector_upsert`, `vector_query`, `memory_read`, `memory_write`. Типы совпадают
 * с backend-контрактом (`node-executors.ts`): значения уходят в граф как есть.
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
  | 'sub_workflow'
  | 'vector_upsert'
  | 'vector_query'
  | 'memory_read'
  | 'memory_write'
  | 'agent'
  // v0.10 S0 (Foundation): четыре новых типа. Компоненты появятся в S1+,
  // поэтому в реестре у них пока `component: undefined`.
  | 'web_search'
  | 'document_gen'
  | 'read_file'
  | 'write_file';

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
  // R7.4a: vector-узлы (pgvector) и state-узлы (память workflow).
  'vector',
  'state',
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
   * (`bg_removal`, `lipsync`, `trim`, `upscale`) backend подставит дефолт из
   * каталога; у `chromakey` модели в каталоге нет — запуск упадёт понятной
   * ошибкой, молчаливой подмены нет (KI-069, KI-367).
   */
  model?: string;
  /**
   * Ссылка на входной файл — фолбэк, если узел не связан с источником.
   *
   * `undefined` не присваиваем (KI-129): пустых ключей в JSON быть не должно.
   */
  inputUrl?: string;
  /**
   * Параметры конкретной операции.
   *
   * Для `lipsync` здесь лежит `audioUrl` — второй обязательный вход (KI-369);
   * остальные ключи (промпт, поля модели) уходят в `params` запроса upstream.
   */
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
 * Стикер без портов: в потоке данных не участвует, в план выполнения не
 * попадает — backend исключает аннотации из плана (KI-266).
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
 * Режим вычисления условия (R7.5, KI-364, DESIGN v0.9 § 3.5).
 *
 * `dsl` — MVP-DSL (`left`/`operator`/`right`); `sandbox` — JS-выражение,
 * исполняемое на сервере в QuickJS-WASM.
 */
export type ConditionMode = 'dsl' | 'sandbox';

/**
 * Режим условия по умолчанию.
 *
 * `dsl` — backward compat: старые workflow не имеют поля `mode` и должны
 * открываться в прежнем режиме.
 */
export const DEFAULT_CONDITION_MODE: ConditionMode = 'dsl';

/**
 * Данные узла `condition` (R6.5.2, DESIGN v0.8 § 8.2; R7.5 — режим sandbox).
 *
 * Порты (`src/engine/node-ports.ts`, R6.5.1): вход `condition-input` → порт
 * `input`. Выходов у узла два (`true-output` / `false-output`), но
 * зарегистрированный контракт описывает один источник (`condition-output`),
 * поэтому оба хендла дают один и тот же порт `result` — маршрутизации веток в
 * v0.8 нет, обе ветки выполняются (KI-278).
 */
export interface ConditionNodeData extends Record<string, unknown> {
  kind: 'condition';
  /** Режим вычисления (R7.5); отсутствует в старых графах → `dsl`. */
  mode: ConditionMode;
  /** Левая часть DSL: `input.X` либо литерал (`5`, `'abc'`, `true`). */
  left: string;
  /** Операция сравнения DSL. */
  operator: ConditionOperator;
  /** Правая часть DSL: `input.X` либо литерал. */
  right: string;
  /**
   * JS-выражение для режима `sandbox` (R7.5). Пустая строка/`undefined` —
   * поле не задано; сохраняется при переключении в DSL, чтобы не терять текст.
   */
  expression?: string;
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

/**
 * Модели эмбеддингов, доступные в UI (R7.4a).
 *
 * Список намеренно короткий: колонка `workflow_vectors.embedding` объявлена
 * как `vector(1536)`, поэтому `text-embedding-3-large` (3072) в неё не
 * помещается — backend отклонит его проверкой размерности. Предлагать
 * несовместимую модель в селекте — значит гарантированно ронять Run.
 */
export const EMBEDDING_MODELS = ['text-embedding-3-small'] as const;

/** id модели эмбеддингов. */
export type EmbeddingModelId = (typeof EMBEDDING_MODELS)[number];

/** Модель эмбеддингов по умолчанию — как на backend (`llm-constants.ts`). */
export const DEFAULT_EMBEDDING_MODEL: EmbeddingModelId = 'text-embedding-3-small';

/** Верхняя граница `topK` узла `vector_query` (совпадает с backend-схемой). */
export const VECTOR_TOPK_LIMIT = 100;

/** `topK` по умолчанию (DESIGN v0.9 § 3.4). */
export const DEFAULT_VECTOR_TOPK = 5;

/** Порог косинусной близости по умолчанию (DESIGN v0.9 § 3.4). */
export const DEFAULT_VECTOR_SCORE_THRESHOLD = 0.7;

/**
 * Данные узла `vector_upsert` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` → порт `prompt`
 * (текст чанка; `contentField` позволяет взять другой ключ входа), выход
 * `vector-output` → порт `result`.
 */
export interface VectorUpsertNodeData extends Record<string, unknown> {
  kind: 'vector_upsert';
  /** Логическая коллекция внутри workflow. */
  collection: string;
  /** id модели эмбеддингов (`text-embedding-3-small`). */
  embeddingModel: string;
  /**
   * Ключ `inputs`, из которого брать текст (необязательно).
   *
   * Если задан, его отсутствие — ошибка узла, а не тихая подмена `prompt`
   * (принцип KI-069: не угадывать за автора).
   */
  contentField?: string;
  /** Текст, введённый прямо в узле; связь `inputs.prompt` важнее. */
  prompt?: string;
}

/**
 * Данные узла `vector_query` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Порты: вход `text-input` → порт `prompt` (текст запроса), выход
 * `vector-output` → порт `result` (массив совпадений `{ id, content, metadata,
 * score }`).
 */
export interface VectorQueryNodeData extends Record<string, unknown> {
  kind: 'vector_query';
  /** Логическая коллекция внутри workflow. */
  collection: string;
  /** id модели эмбеддингов. */
  embeddingModel: string;
  /** Сколько ближайших записей вернуть; `undefined` — дефолт backend (5). */
  topK?: number;
  /** Минимальная косинусная близость; `undefined` — дефолт backend (0.7). */
  scoreThreshold?: number;
  /** Текст запроса, введённый прямо в узле (иначе — вход `prompt`). */
  prompt?: string;
}

/**
 * Данные узла `memory_read` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Входов у узла нет (кроме зарегистрированного `text-input` ради вставки в
 * связь), выход `memory-output` → порт `result` + `found`.
 */
export interface MemoryReadNodeData extends Record<string, unknown> {
  kind: 'memory_read';
  /** Ключ памяти workflow. */
  key: string;
}

/**
 * Данные узла `memory_write` (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Значение берётся из `inputs[valueField]` либо из входа `prompt`, либо из
 * textarea узла; запись UPSERT по `(workflow_id, key)`.
 */
export interface MemoryWriteNodeData extends Record<string, unknown> {
  kind: 'memory_write';
  /** Ключ памяти workflow. */
  key: string;
  /** Ключ `inputs`, из которого брать значение (необязательно). */
  valueField?: string;
  /** Значение, введённое прямо в узле; связь важнее. */
  value?: string;
}

/**
 * Инструменты agent-узла (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Список — зеркало backend `AGENT_TOOL_NAMES` (`src/agent/agent.types.ts`):
 * значения уходят в граф как есть и проверяются Zod-схемой узла на backend,
 * поэтому UI не должен предлагать инструмент, который executor отвергнет.
 */
export const AGENT_TOOLS = [
  'http_request',
  'vector_query',
  'vector_upsert',
  'memory_read',
  'memory_write',
  'code_eval',
  'llm_call',
] as const;

/** Имя инструмента агента. */
export type AgentToolName = (typeof AGENT_TOOLS)[number];

/** Минимум инструментов: агент без инструментов — это LLM-узел с циклом. */
export const AGENT_MIN_TOOLS = 1;

/** Максимум инструментов (совпадает с backend-схемой). */
export const AGENT_MAX_TOOLS = AGENT_TOOLS.length;

/** Нижняя граница итераций (DESIGN § 3.4, UI-диапазон). */
export const AGENT_MIN_ITERATIONS = 1;

/** Верхняя граница итераций (совпадает с backend-схемой). */
export const AGENT_MAX_ITERATIONS_LIMIT = 10;

/** Лимит итераций по умолчанию (DESIGN § 3.4). */
export const DEFAULT_AGENT_MAX_ITERATIONS = 5;

/**
 * Инструменты нового узла.
 *
 * Один `http_request` — минимальный рабочий набор: узел сразу запускаем, а
 * остальные инструменты пользователь включает осознанно. Пул инструментов
 * `vector_*`/`memory_*` требует настроенной коллекции/ключа, поэтому не
 * включается молча (принцип KI-069).
 */
export const DEFAULT_AGENT_TOOLS: readonly AgentToolName[] = ['http_request'];

/**
 * Данные узла `agent` (R7.4b, DESIGN v0.9 § 3.4).
 *
 * Порты (`src/engine/node-ports.ts`): вход `text-input` → порт `prompt`
 * (текст задачи), выход `result-output` → порт `result` (финальный ответ).
 * Сам цикл (LLM → tools → final) исполняет backend `AgentService`; в `data`
 * хранится только конфигурация.
 */
export interface AgentNodeData extends Record<string, unknown> {
  kind: 'agent';
  /** id модели, которая ведёт цикл (из `GET /llm/models`). */
  model: string;
  /** Системная инструкция; backend добавляет её перед протоколом агента. */
  systemPrompt?: string;
  /** Включённые инструменты: от {@link AGENT_MIN_TOOLS} до {@link AGENT_MAX_TOOLS}. */
  tools: AgentToolName[];
  /** Предел итераций 1–10; `undefined` — дефолт backend (5). */
  maxIterations?: number;
  /**
   * Лимит токенов на шаг (DESIGN § 3.4). В UI поля нет — значение
   * переносится между Load/Save, чтобы не терять настройку, заданную через
   * API (KI-129: `undefined`-ключи не создаём).
   */
  maxTokensPerStep?: number;
}

/* ──────────────── Новые узлы v0.10 S0 (Foundation) ──────────────── */

/**
 * Верхняя граница `maxResults` узла `web_search` (v0.10 S2).
 *
 * Совпадает с backend-схемой `WebSearchNodeDataSchema`: UI не должен
 * предлагать значение, которое исполнитель отвергнет валидацией.
 */
export const WEB_SEARCH_MAX_RESULTS_LIMIT = 10;

/** `maxResults` по умолчанию — как на backend (DESIGN v0.10 § 3.1.1). */
export const DEFAULT_WEB_SEARCH_MAX_RESULTS = 5;

/**
 * Данные узла `web_search` (v0.10 S2, DESIGN v0.10 § 3.1).
 *
 * Backend S2 валидирует `query`/`maxResults`, а поля DESIGN `searchDepth`,
 * `includeAnswer`, `topic`, `days` пока не отправляются провайдеру (S1 принимает
 * только `maxResults`, KI-461): они сохраняются в графе между Save/Load и будут
 * задействованы после расширения `IWebSearchProvider`.
 *
 * Запрос приоритетно берётся из входа `prompt`; `query` — fallback для узла,
 * к которому не подключён Text/LLM.
 */
export interface WebSearchNodeData extends Record<string, unknown> {
  kind: 'web_search';
  /** Запрос, если он не пришёл по связи `inputs.prompt`. */
  query?: string;
  /** Сколько результатов вернуть (1–10; дефолт backend — 5). */
  maxResults?: number;
  /** Глубина поиска Tavily. */
  searchDepth?: 'basic' | 'advanced';
  /** Просить ли у провайдера готовый ответ. */
  includeAnswer?: boolean;
  /** Тема поиска (`news` включает фильтр по дням). */
  topic?: 'general' | 'news';
  /** Только для `topic='news'`: окно в днях. */
  days?: number;
}

/**
 * Данные узла `document_gen` (v0.10 S0, DESIGN v0.10 § 3.2).
 *
 * Имя типа сокращено до `document_gen` (контракт S0); сам конвейер
 * Markdown/JSON → DOCX/PDF появится в S6.
 */
export interface DocumentGenNodeData extends Record<string, unknown> {
  kind: 'document_gen';
  /** Выходной формат документа. */
  format?: 'docx' | 'pdf';
  /** Интерпретация входного содержимого. */
  source?: 'markdown' | 'json';
  /** Заголовок документа (необязательно). */
  title?: string;
  /** Содержимое, если оно не пришло по связи `inputs.prompt`. */
  content?: string;
  /** Имя файла без пути (необязательно). */
  fileName?: string;
}

/**
 * Данные узла `read_file` (v0.10 S0, DESIGN v0.10 § 3.3).
 *
 * Путь читается **только** из `data.path`, не из входа: иначе prompt injection
 * смог бы вычитать чужой файл внутри workspace (S8).
 */
export interface ReadFileNodeData extends Record<string, unknown> {
  kind: 'read_file';
  /** Относительный путь внутри workspace workflow. */
  path: string;
  /** Формат чтения; `auto` — по расширению. */
  format?: 'auto' | 'txt' | 'csv' | 'json';
}

/**
 * Данные узла `write_file` (v0.10 S0, DESIGN v0.10 § 3.3).
 *
 * Контент — из входа `prompt` или `data.content`; путь — только из `data.path`.
 */
export interface WriteFileNodeData extends Record<string, unknown> {
  kind: 'write_file';
  /** Относительный путь внутри workspace workflow. */
  path: string;
  /** Формат записи. */
  format?: 'txt' | 'csv' | 'json';
  /** Разрешить перезапись существующего файла (дефолт false). */
  overwrite?: boolean;
  /** Содержимое, если оно не пришло по связи `inputs.prompt`. */
  content?: string;
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
/** Узел записи в векторную коллекцию (R7.4a). */
export type VectorUpsertFlowNode = Node<VectorUpsertNodeData, 'vector_upsert'>;
/** Узел косинусного поиска по коллекции (R7.4a). */
export type VectorQueryFlowNode = Node<VectorQueryNodeData, 'vector_query'>;
/** Узел чтения памяти workflow (R7.4a). */
export type MemoryReadFlowNode = Node<MemoryReadNodeData, 'memory_read'>;
/** Узел записи памяти workflow (R7.4a). */
export type MemoryWriteFlowNode = Node<MemoryWriteNodeData, 'memory_write'>;
/** Узел агента с циклом LLM → tools → final (R7.4b). */
export type AgentFlowNode = Node<AgentNodeData, 'agent'>;
/** Узел веб-поиска (v0.10 S0; компонент — S2). */
export type WebSearchFlowNode = Node<WebSearchNodeData, 'web_search'>;
/** Узел генерации документа (v0.10 S0; компонент — S6). */
export type DocumentGenFlowNode = Node<DocumentGenNodeData, 'document_gen'>;
/** Узел чтения файла из workspace (v0.10 S0; компонент — S8). */
export type ReadFileFlowNode = Node<ReadFileNodeData, 'read_file'>;
/** Узел записи файла в workspace (v0.10 S0; компонент — S8). */
export type WriteFileFlowNode = Node<WriteFileNodeData, 'write_file'>;

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
  | SubWorkflowFlowNode
  | VectorUpsertFlowNode
  | VectorQueryFlowNode
  | MemoryReadFlowNode
  | MemoryWriteFlowNode
  | AgentFlowNode
  | WebSearchFlowNode
  | DocumentGenFlowNode
  | ReadFileFlowNode
  | WriteFileFlowNode;

