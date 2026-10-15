import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import { create } from 'zustand';
import i18n from '@/i18n';
import {
  createRunAsync,
  createWorkflowAsync,
  fetchLlmModelsAsync,
  fetchMediaModelsAsync,
  getWorkflowAsync,
  planWorkflowAsync,
  updateWorkflowAsync,
  type ApiGraphEdge,
  type ApiGraphNode,
  type ApiWorkflow,
  type LlmModelInfo,
} from '@/lib/api';
import { subscribeToRunStream } from '@/lib/run-stream';
import { levelsToMap } from '@/lib/plan';
import { pickDefaultMediaModel } from '@/lib/media';
import { canInsertOnEdge, isNodeType, nodeLabelOf } from '@/lib/node-registry';
import type { MediaModelInfo } from '@/types/media';
import {
  DEFAULT_LLM_MODEL_ID,
  type AppNode,
  type CommentNodeData,
  type ImageGenNodeData,
  type LlmNodeData,
  type NodeType,
  type TextNodeData,
} from '@/types/graph';
import { validateMaxTokensOverride, validateReasoningEffort } from '@/lib/llm-node-fields';
import {
  cloneNodesForDuplicate,
  insertPositionOnEdge,
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
} from '@/lib/graph-edit';
import { computeGraphHash } from '@/lib/graph-hash';
import {
  toBackendEdges,
  toBackendNodes,
} from '@/lib/graph-payload';
import type {
  RunEventMessage,
  RunStatus,
  SnapshotMessage,
} from '@/types/run-stream';

/** Позиция узла на холсте. */
export type Position = { x: number; y: number };

/**
 * Режим холста (KI-188): `select` — рамка выделения, `pan` — перемещение.
 *
 * Значение живёт в `localStorage`, поэтому строка — единственный формат,
 * который можно записать без сериализации.
 */
export type CanvasMode = 'select' | 'pan';

/** Ключ `localStorage` с режимом холста (KI-188). */
const CANVAS_MODE_STORAGE_KEY = 'canvasMode';

/** Ключ `localStorage` с видимостью миникарты (KI-190). */
const SHOW_MINIMAP_STORAGE_KEY = 'showMinimap';

/**
 * Читает режим холста из `localStorage` (KI-188).
 *
 * Значение проверяется: в хранилище могло остаться что-то из другой версии
 * приложения, а `canvasMode === 'pan'` участвует в логике перетаскивания.
 *
 * @returns `'select'` или `'pan'`; `'select'` при отсутствии/невалидном значении
 */
function readCanvasMode(): CanvasMode {
  try {
    const stored = window.localStorage.getItem(CANVAS_MODE_STORAGE_KEY);

    return stored === 'pan' || stored === 'select' ? stored : 'select';
  } catch {
    // Приватный режим браузера может запретить доступ к localStorage: холст
    // должен открыться с дефолтным режимом, а не упасть на импорте модуля.
    return 'select';
  }
}

/**
 * Читает видимость миникарты из `localStorage` (KI-190).
 *
 * @returns `true`, если миникарта была показана или настройки ещё нет
 */
function readShowMinimap(): boolean {
  try {
    const stored = window.localStorage.getItem(SHOW_MINIMAP_STORAGE_KEY);

    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

/**
 * Записывает значение в `localStorage`, не падая при запрете доступа.
 *
 * @param key - ключ хранилища
 * @param value - строковое значение
 */
function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Настройка не критична для работы редактора: молча остаёмся с текущим
    // состоянием в памяти (приватный режим, переполненная квота).
  }
}

/**
 * Закрытие текущего SSE-потока запуска.
 *
 * Хранится в модульной переменной, а не в состоянии стора: это не данные для
 * рендера, и лишние обновления подписчиков при каждой подписке/отписке не нужны.
 */
let closeRunStream: (() => void) | null = null;

/** Закрывает текущий поток запуска, если он открыт. */
function closeStreamIfAny(): void {
  closeRunStream?.();
  closeRunStream = null;
}

/**
 * Проверяет, что статус запуска финальный.
 *
 * @param status - статус запуска либо `null`
 * @returns `true`, если запуск завершён и поток больше не нужен
 */
function isFinalStatus(status: RunStatus | null): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Возвращает патч состояния с новым статусом узла.
 *
 * @param state - текущее состояние стора
 * @param nodeId - id узла графа
 * @param status - новый статус узла
 * @returns патч `nodeStatuses` для `set`
 */
function withNodeStatus(
  state: WorkflowState,
  nodeId: string,
  status: RunStatus,
): Pick<WorkflowState, 'nodeStatuses'> {
  return { nodeStatuses: { ...state.nodeStatuses, [nodeId]: status } };
}

/**
 * Возвращает патч состояния с логами узла из события.
 *
 * Пустой список игнорируем: у события без ретраев `logs: []`, и затирать им
 * уже известные логи из snapshot нельзя (та же логика, что в snapshot-ветке).
 * KI-149 (KI-075): логи приходят в `node_completed`/`node_failed`.
 *
 * @param state - текущее состояние стора
 * @param nodeId - id узла графа
 * @param logs - логи из события (`null` у старых событий)
 * @returns патч `nodeLogs` либо пустой объект
 */
function withNodeLogs(
  state: WorkflowState,
  nodeId: string,
  logs: readonly string[] | null | undefined,
): Partial<Pick<WorkflowState, 'nodeLogs'>> {
  return logs !== null && logs !== undefined && logs.length > 0
    ? { nodeLogs: { ...state.nodeLogs, [nodeId]: [...logs] } }
    : {};
}

/** Владелец графа: авторизации пока нет, поэтому значение фиксированное. */
export const DEFAULT_USER_ID = 'demo-user';
/** Имя workflow по умолчанию (backend требует непустое). */
/**
 * Имя нового workflow.
 *
 * Оценено на этапе импорта модуля (i18n уже инициализирован в `main.tsx`):
 * это стартовое значение, которое пользователь дальше меняет сам, поэтому
 * переключение языка его не переименовывает.
 */
export const DEFAULT_WORKFLOW_NAME = i18n.t('workflow.default_name');

/** Уведомление для пользователя. */
export interface Notice {
  kind: 'error' | 'success';
  text: string;
}

/** Метрики узла для панели результата (R4.3b; costRub — v0.6.0b.2.3). */
export interface NodeRunMetrics {
  /** Длительность выполнения, мс (`null` — узел ещё не завершался). */
  durationMs: number | null;
  /** Токенов на входе (`null` — провайдер не отдал usage или данных ещё нет). */
  tokensIn: number | null;
  /** Токенов на выходе. */
  tokensOut: number | null;
  /** Стоимость в USD строкой (как отдаёт backend `numeric`). */
  costUsd: string | null;
  /**
   * Стоимость media-генерации в рублях строкой.
   *
   * `null` для LLM-узлов, а также пока backend не передаёт `cost_rub` в
   * SSE-snapshot (см. KI-114 в отчёте): колонка `node_runs.cost_rub` уже
   * заполняется executor'ом, но в снимок не попадает.
   */
  costRub: string | null;
}

/** Пустые метрики: узел ещё не отдавал ни одного значения. */
const EMPTY_METRICS: NodeRunMetrics = {
  durationMs: null,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  costRub: null,
};

/** Функция поиска центра вьюпорта, которую отдаёт Canvas. */
export type FindCenterHandler = () => Position;

/** Состояние редактора графа. */
export interface WorkflowState {
  nodes: AppNode[];
  edges: Edge[];

  /** id текущего workflow (null — ещё не сохранён). */
  currentWorkflowId: string | null;
  /** Название текущего workflow, редактируется в верхней панели. */
  currentWorkflowName: string;

  /** id узла → номер уровня выполнения из `/engine/plan`. */
  executionLevels: Record<string, number>;

  /** id текущего запуска (`null` — запусков ещё не было). */
  runId: string | null;
  /** Статус запуска из SSE (`null` — запуск не стартовал). */
  runStatus: RunStatus | null;
  /** Текст последней ошибки запуска (для панели результата R4.3). */
  runError: string | null;
  /** id узла → статус выполнения (snapshot + события потока). */
  nodeStatuses: Record<string, RunStatus>;
  /** id узла → последние выходы узла из `node_completed`. */
  nodeOutputs: Record<string, Record<string, unknown>>;
  /** id узла → текст ошибки (из snapshot и `node_failed`). */
  nodeErrors: Record<string, string>;
  /** id узла → записи ретраев (KI-036); приходят только в snapshot. */
  nodeLogs: Record<string, string[]>;
  /** id узла → метрики выполнения (длительность, токены, стоимость). */
  nodeMetrics: Record<string, NodeRunMetrics>;
  /**
   * id выбранной ноды для панели результата снизу.
   *
   * `null` — панель показывает run-уровневую информацию.
   */
  selectedNodeId: string | null;
  /**
   * Номер текущей попытки job'а (1-based) для подписи «попытка N/M».
   *
   * Контракт не несёт `attemptsMade` в `run_started`, поэтому счёт ведётся по
   * числу стартов; `attemptsMade` из `run_completed` (KI-059) остаётся
   * авторитетным значением о завершённых попытках.
   */
  attemptNumber: number;
  /** Сколько попыток уже завершил BullMQ (из `run_completed`, KI-059). */
  attemptsMade: number;
  /** Лимит попыток job'а (из `run_completed`; `null` — неизвестен). */
  attempts: number | null;
  /**
   * Есть ли у текущего запуска ещё попытки (KI-040): выставляется промежуточным
   * провалом (`run_completed` с `final: false`) и сбрасывается финалом (KI-070).
   */
  runHasMoreAttempts: boolean;

  /** Доступные модели LLM с backend (`GET /llm/models`, KI-069). */
  llmModels: LlmModelInfo[];
  /** Загружен ли список моделей в этой сессии. */
  llmModelsLoaded: boolean;
  /** Доступные media-модели (`GET /media/models?type=IMAGE`, v0.6.0b.2.3). */
  mediaModels: MediaModelInfo[];
  /** Загружен ли список media-моделей в этой сессии. */
  mediaModelsLoaded: boolean;
  /** Ленивая загрузка media-моделей (кэшируется в сторе). */
  loadMediaModelsAsync: () => Promise<void>;

  isSaving: boolean;
  /** Хэш последнего сохранённого графа: база для индикатора «есть изменения». */
  lastSavedHash: string | null;
  /** Запомнить хэш сохранённого графа (KI-195). */
  markSaved: (hash: string) => void;
  isLoading: boolean;
  error: string | null;
  notice: Notice | null;

  /** Добавляет узел в указанную позицию и делает его выделенным. */
  addNode: (type: NodeType, position: Position) => void;
  /** Применяет изменения узлов от React Flow (drag, select, remove). */
  onNodesChange: (changes: NodeChange<AppNode>[]) => void;
  /** Применяет изменения связей от React Flow. */
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  /** Соединяет два порта новой связью. */
  onConnect: (connection: Connection) => void;

  /**
   * Удаляет узел вместе со всеми его связями (A1).
   *
   * @param nodeId - id удаляемого узла
   */
  removeNode: (nodeId: string) => void;
  /**
   * Удаляет связь по id (A1).
   *
   * @param edgeId - id удаляемой связи
   */
  removeEdge: (edgeId: string) => void;
  /**
   * Вставить узел в связь: старая связь делится на две (KI-185).
   *
   * @param edgeId - id связи, в которую вставляем узел
   * @param type - тип вставляемого узла
   * @returns `true`, если узел вставлен; `false`, если связь уже удалена
   *   (KI-261) или тип нельзя вставить (KI-259) — в обоих случаях с notice
   */
  addNodeOnEdge: (edgeId: string, type: NodeType) => boolean;
  /**
   * Связь, для которой открыт каталог вставки узла (KI-185): `null` — закрыт.
   *
   * Кнопка «+» живёт в кастомном ребре (`InsertableEdge`), а поповер каталога —
   * в `Canvas` (экранные координаты), поэтому связь между ними идёт через стор.
   */
  pendingEdgeId: string | null;
  /**
   * Открывает каталог узлов для вставки в указанную связь (KI-185).
   *
   * @param edgeId - id связи, в которую вставляем узел
   */
  requestInsertOnEdge: (edgeId: string) => void;
  /** Закрывает каталог вставки узла (KI-185). */
  clearPendingEdge: () => void;
  /** Дублировать узлы со сдвигом; связи не копируются (KI-191). */
  duplicateNodes: (ids: string[]) => void;
  /**
   * Сбрасывает редактор к пустому новому workflow (A3): чистит граф, историю
   * запуска и выбранный узел, возвращает имя по умолчанию.
   */
  newWorkflow: () => void;

  setNodes: (nodes: AppNode[]) => void;
  setEdges: (edges: Edge[]) => void;

  /** Сохраняет граф: создаёт workflow или обновляет существующий. */
  saveWorkflowAsync: () => Promise<void>;
  /** Загружает workflow по id и заменяет текущий граф. */
  loadWorkflowAsync: (id: string) => Promise<void>;
  /** Строит план выполнения и раскладывает уровни по узлам. */
  runPlanAsync: () => Promise<void>;

  /**
   * Запускает workflow: `POST /runs` + подписка на SSE-поток прогресса.
   *
   * @param workflowId - id сохранённого workflow
   */
  startRunAsync: (workflowId: string) => Promise<void>;
  /**
   * Применяет снимок состояния: **заменяет** `nodeStatuses`/`nodeOutputs`.
   *
   * Snapshot — источник истины на момент подключения, поэтому слияние с прошлым
   * состоянием неверно (после переподключения остались бы устаревшие статусы).
   *
   * @param snapshot - сообщение-снимок из потока
   */
  applySnapshot: (snapshot: SnapshotMessage) => void;
  /**
   * Применяет событие прогресса запуска.
   *
   * @param event - событие из потока (кроме snapshot)
   */
  applyEvent: (event: RunEventMessage) => void;
  /** Сбрасывает состояние запуска и закрывает поток (Load / Save / новый Run). */
  resetRunState: () => void;

  /**
   * Запоминает выбранную ноду для панели результата.
   *
   * @param id - id узла графа либо `null`, если выбор снят
   */
  setSelectedNodeId: (id: string | null) => void;

  /**
   * Загружает список моделей LLM с backend (один раз за сессию).
   *
   * Кэшируется в сторе: селект LLM-узла читает `llmModels`, поэтому запрос не
   * повторяется на каждый узел и каждое монтирование.
   */
  loadLlmModelsAsync: () => Promise<void>;

  setCurrentWorkflowId: (id: string | null, name?: string) => void;
  setCurrentWorkflowName: (name: string) => void;
  setExecutionLevels: (levels: string[][]) => void;
  clearExecutionLevels: () => void;
  setNotice: (notice: Notice | null) => void;

  /** Canvas регистрирует здесь функцию поиска центра вьюпорта. */
  findCenter: FindCenterHandler | null;
  setFindCenter: (handler: FindCenterHandler) => void;

  /**
   * Режим холста (KI-188): `select` — рамка выделения, `pan` — перемещение.
   *
   * Инициализируется из `localStorage` (ключ `canvasMode`), поэтому режим
   * переживает перезагрузку страницы. Переключается клавишами `S`/`H` и
   * кнопками панели режимов.
   */
  canvasMode: CanvasMode;
  /**
   * Переключает режим холста и сохраняет его в `localStorage` (KI-188).
   *
   * @param mode - новый режим
   */
  setCanvasMode: (mode: CanvasMode) => void;

  /**
   * Видимость миникарты (KI-190).
   *
   * Инициализируется из `localStorage` (ключ `showMinimap`); при отсутствии
   * настройки миникарта показана.
   */
  showMinimap: boolean;
  /**
   * Показывает/скрывает миникарту и сохраняет выбор в `localStorage` (KI-190).
   *
   * @param show - `true` — показать, `false` — скрыть
   */
  setShowMinimap: (show: boolean) => void;

  /**
   * Открыт ли общий каталог узлов (KI-186, хоткей `Tab`).
   *
   * Состояние живёт в сторе, а не в `Toolbar`: каталог открывают два разных
   * места — кнопка «+» в тулбаре и клавиша `Tab` на холсте. Каталог **вставки
   * узла в связь** (KI-185) использует отдельное поле `pendingEdgeId` и это
   * состояние не трогает.
   */
  isCatalogOpen: boolean;
  /**
   * Открывает/закрывает общий каталог узлов (KI-186).
   *
   * @param open - `true` — открыть, `false` — закрыть
   */
  setCatalogOpen: (open: boolean) => void;

  /**
   * Переключает видимость всех комментариев (KI-187, хоткей `Shift+C`).
   *
   * Скрывает стикеры, если виден хотя бы один; иначе показывает все. Так
   * `Shift+C` работает как «показать/скрыть комментарии», а не как «инвертировать
   * каждый» (иначе смешанное состояние переворачивалось бы в противоположное
   * у каждого узла).
   */
  toggleCommentsVisibility: () => void;
}

/**
 * Создаёт узел нужного типа с дефолтными данными.
 *
 * @param type - тип узла из тулбара
 * @param position - позиция на холсте
 * @param index - порядковый номер узла, нужен для уникального id
 * @param defaultModelId - id первой доступной модели (KI-074); если список ещё
 *   не загружен или пуст, используется {@link DEFAULT_LLM_MODEL_ID}
 */
function createNode(
  type: NodeType,
  position: Position,
  index: number,
  defaultModelId?: string,
  defaultMediaModelId?: string,
): AppNode {
  const shared = { id: `${type}-${index}-${crypto.randomUUID()}`, position };

  switch (type) {
    case 'text':
      return {
        ...shared,
        type: 'text',
        data: { kind: 'text', value: '' },
      };
    case 'llm':
      return {
        ...shared,
        type: 'llm',
        data: {
          kind: 'llm',
          model: defaultModelId ?? DEFAULT_LLM_MODEL_ID,
          // KI-180: промпт можно ввести прямо в узле, без связи от Text.
          prompt: '',
        },
      };
    case 'image_generation':
      return {
        ...shared,
        type: 'image_generation',
        data: {
          kind: 'image',
          // Модель по умолчанию — первая доступная в каталоге media
          // (v0.6.0b.2.3): узел сразу запускаем, без выбора вручную.
          model: defaultMediaModelId ?? '',
        },
      };
    case 'comment':
      return {
        ...shared,
        type: 'comment',
        // KI-187: стикер создаётся видимым; текст пользователь вводит сам.
        data: { kind: 'comment', text: '', visible: true },
      };
    // Нет default: — новый NodeType поймает tsc (KI-129).
  }
}

/** Приводит узел к формату backend. */
function toApiNode(node: AppNode): ApiGraphNode {
  return {
    id: node.id,
    type: node.type ?? 'text',
    position: node.position,
    data: node.data,
  };
}

/** Приводит связь к формату backend. */
function toApiEdge(edge: Edge): ApiGraphEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
  };
}

/** Собирает данные узла из ответа backend с учётом его типа. */
function nodeDataFromApi(
  type: NodeType,
  data: Record<string, unknown>,
): TextNodeData | LlmNodeData | ImageGenNodeData | CommentNodeData {
  switch (type) {
    case 'text':
      return {
        kind: 'text',
        value: typeof data.value === 'string' ? data.value : '',
      };
    case 'llm': {
      const prompt =
        typeof data.prompt === 'string'
          ? data.prompt
          : typeof data.value === 'string'
            ? data.value
            : '';

      const result: LlmNodeData = {
        kind: 'llm',
        // Модель НЕ подменяем (KI-069): если id неизвестен текущему списку,
        // селект покажет его как «(недоступно)». Молчаливая подмена на первый
        // из списка перезаписывала сохранённую модель при следующем Save.
        model: typeof data.model === 'string' ? data.model : '',
        // KI-180: промпт узла. Старые workflow хранили его в `value`.
        prompt,
      };

      // R6.3.2 (KI-192/193/183): переносим настройки модели. KI-122/129 —
      // поля со значением `undefined` не присваиваем вовсе, иначе Load терял
      // выбор пользователя, а следующий Save затирал его в БД.
      if (typeof data.systemPrompt === 'string') {
        result.systemPrompt = data.systemPrompt;
      }

      const reasoningEffort = validateReasoningEffort(data.reasoningEffort);

      if (reasoningEffort !== undefined) {
        result.reasoningEffort = reasoningEffort;
      }

      const maxTokensOverride = validateMaxTokensOverride(data.maxTokensOverride);

      if (maxTokensOverride !== undefined) {
        result.maxTokensOverride = maxTokensOverride;
      }

      return result;
    }
    case 'image_generation': {
      // KI-122: переносим `model`/`aspectRatio`, иначе Load терял выбор
      // пользователя и следующий Save затирал его в БД.
      // KI-129: поля со значением `undefined` не присваиваем вовсе — иначе
      // пустые ключи появляются в JSON и в `Object.keys(data)`.
      const result: ImageGenNodeData = { kind: 'image' };

      if (typeof data.model === 'string') {
        result.model = data.model;
      }

      if (typeof data.aspectRatio === 'string') {
        result.aspectRatio = data.aspectRatio;
      }

      // KI-160/KI-166: промпт узла живёт в `data.prompt`. Ранее его писали ещё
      // и в `data.value` — теперь это не нужно, backend читает `data.prompt`.
      // Старые workflow хранили промпт в `value`: переносим его в `prompt`,
      // чтобы текст появился в поле узла (и снова сохранялся уже как `prompt`).
      const prompt =
        typeof data.prompt === 'string'
          ? data.prompt
          : typeof data.value === 'string'
            ? data.value
            : undefined;

      if (prompt !== undefined) {
        result.prompt = prompt;
      }

      if (typeof data.imageUrl === 'string') {
        result.imageUrl = data.imageUrl;
      }

      return result;
    }
    case 'comment': {
      // KI-187: комментарий — local-only узел, backend его не хранит, поэтому
      // ветка нужна только для графов, сохранённых в другой версии/источнике.
      // KI-129: `visible` по умолчанию `true` (как в `createNode`), чтобы
      // отсутствие поля не скрывало стикер.
      const result: CommentNodeData = {
        kind: 'comment',
        text: typeof data.text === 'string' ? data.text : '',
        visible: data.visible !== false,
      };

      return result;
    }
    // Нет default: — новый NodeType поймает tsc (KI-129).
  }
}

/**
 * Преобразует workflow с backend в узлы и связи React Flow.
 *
 * Узлы неизвестных типов пропускаются: их нечем отрисовать, а id нельзя
 * терять молча, поэтому такие случаи перечисляются в предупреждении.
 *
 * @param workflow - workflow из API
 * @returns узлы, связи и предупреждение о пропущенных узлах
 */
function fromApiWorkflow(workflow: ApiWorkflow): {
  nodes: AppNode[];
  edges: Edge[];
  warning: string | null;
} {
  const nodes: AppNode[] = [];
  const skipped: string[] = [];

  for (const node of workflow.nodes) {
    // KI-121: проверка по единому реестру вместо цепочки `!==`. Цепочку tsc
    // не ловил: новый тип узла молча терялся при Load.
    if (!isNodeType(node.type)) {
      console.warn(
        `Неизвестный тип узла: ${node.type} (id: ${node.id}) — узел пропущен`,
      );
      skipped.push(node.id);
      continue;
    }

    // KI-187: local-only узел (комментарий) в графе с backend появиться не
    // может — `toBackendNodes` отсекает его при Save. Если такой узел всё же
    // пришёл (прямая запись в БД, импорт из другого источника), он известен
    // реестру, и данные собираются обычным путём.
    const data = nodeDataFromApi(node.type, node.data ?? {});

    nodes.push({
      id: node.id,
      type: node.type,
      position: node.position,
      data,
    } as AppNode);
  }

  const edges: Edge[] = workflow.edges
    .filter((edge) => nodes.some((node) => node.id === edge.source))
    .filter((edge) => nodes.some((node) => node.id === edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
    }));

  return {
    nodes,
    edges,
    warning: skipped.length
      ? i18n.t('toast.unknown_node_types', { ids: skipped.join(', ') })
      : null,
  };
}

/** Достаёт текст ошибки из неизвестного значения. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : i18n.t('error.unknown');
}

/**
 * Стор редактора workflow: состояние графа, сохранение и план выполнения.
 */
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],

  currentWorkflowId: null,
  currentWorkflowName: DEFAULT_WORKFLOW_NAME,

  executionLevels: {},

  runId: null,
  runStatus: null,
  runError: null,
  nodeStatuses: {},
  nodeOutputs: {},
  nodeErrors: {},
  nodeLogs: {},
  nodeMetrics: {},
  selectedNodeId: null,
  attemptNumber: 0,
  attemptsMade: 0,
  attempts: null,
  runHasMoreAttempts: false,

  llmModels: [],
  llmModelsLoaded: false,
  mediaModels: [],
  mediaModelsLoaded: false,

  isSaving: false,
  isLoading: false,
  error: null,
  lastSavedHash: null,

  notice: null,

  findCenter: null,

  // KI-188/KI-190: UI-настройки холста читаются из localStorage на старте —
  // это оценка при импорте модуля, до монтирования компонентов.
  canvasMode: readCanvasMode(),
  showMinimap: readShowMinimap(),
  isCatalogOpen: false,

  /** Каталог вставки узла в связь закрыт (KI-185). */
  pendingEdgeId: null,

  addNode: (type, position) =>
    set((state) => {
      // Модель нового LLM-узла берём из загруженного списка (KI-074), чтобы
      // узел сразу был запускаемым; fallback — дефолтный id из types/graph.
      // Для image-узла — первая media-модель (v0.6.0b.2.3).
      const node = createNode(
        type,
        position,
        state.nodes.length,
        state.llmModels[0]?.id,
        // KI-154: не mediaModels[0] (там bgremover — image-to-image),
        // а первая text-to-image модель каталога.
        pickDefaultMediaModel(state.mediaModels),
      );

      return {
        nodes: [
          ...state.nodes.map((existing) => ({ ...existing, selected: false })),
          { ...node, selected: true },
        ],
        // После правки графа прежний план выполнения уже неактуален.
        executionLevels: {},
      };
    }),

  onNodesChange: (changes) =>
    set((state) => {
      const nodes = applyNodeChanges(changes, state.nodes);
      // Удалённая нода не должна оставаться выбранной: панель результата иначе
      // показывала бы данные узла, которого уже нет (R4.3b).
      const removed = changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id);
      const selectedNodeId =
        state.selectedNodeId !== null && removed.includes(state.selectedNodeId)
          ? null
          : state.selectedNodeId;

      return { nodes, selectedNodeId };
    }),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => {
      // id генерируем сами: backend требует непустой id у каждой связи.
      const nextEdges = addEdge(connection, state.edges).map((edge) =>
        edge.id.startsWith('xy-edge__')
          ? { ...edge, id: `edge-${crypto.randomUUID()}` }
          : edge,
      );

      return { edges: nextEdges, executionLevels: {} };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      // Узел без своих связей оставил бы висячие рёбра: React Flow попытался бы
      // нарисовать связь к несуществующему узлу.
      const edges = state.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      );

      return {
        nodes: state.nodes.filter((node) => node.id !== nodeId),
        edges,
        // Панель результата не должна показывать данные удалённого узла.
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        // План выполнения после правки графа неактуален.
        executionLevels: {},
      };
    }),

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      executionLevels: {},
    })),

  newWorkflow: () => {
    // Поток предыдущего запуска закрываем, иначе его события продолжали бы
    // менять состояние уже пустого редактора.
    closeStreamIfAny();
    set({
      nodes: [],
      edges: [],
      currentWorkflowId: null,
      currentWorkflowName: DEFAULT_WORKFLOW_NAME,
      executionLevels: {},
      selectedNodeId: null,
      runId: null,
      runStatus: null,
      runError: null,
      nodeStatuses: {},
      nodeOutputs: {},
      nodeErrors: {},
      nodeLogs: {},
      nodeMetrics: {},
      attemptNumber: 0,
      attemptsMade: 0,
      attempts: null,
      runHasMoreAttempts: false,
    });
  },

  addNodeOnEdge: (edgeId, type) => {
    const state = get();
    const edge = state.edges.find((item) => item.id === edgeId);

    // KI-261: связь могли удалить, пока открыт каталог вставки. Молчать нельзя:
    // пользователь выбрал пункт каталога и должен понять, почему ничего не вышло.
    if (!edge) {
      set({ notice: { kind: 'error', text: i18n.t('canvas.edge.gone') } });
      return false;
    }

    // KI-259: у типа без входного порта ребро `source → новый узел` не создать
    // (React Flow не найдёт target handle и вернёт error008). Исходную связь НЕ
    // удаляем — иначе граф потерял бы связь, а узел остался бы висеть без входов.
    // Каталог такие типы не показывает; проверка — защита от регрессии.
    if (!canInsertOnEdge(type)) {
      set({ notice: { kind: 'error', text: i18n.t('canvas.edge.cannotInsert') } });
      return false;
    }

    const source = state.nodes.find((node) => node.id === edge.source);
    const target = state.nodes.find((node) => node.id === edge.target);
    // KI-260: точный размер нового узла до первого рендера неизвестен, поэтому
    // берём `measured` уже существующего узла того же типа, иначе — дефолт.
    const sample = state.nodes.find((node) => node.type === type);
    const size = {
      width: sample?.measured?.width ?? NODE_DEFAULT_WIDTH,
      height: sample?.measured?.height ?? NODE_DEFAULT_HEIGHT,
    };
    const position = insertPositionOnEdge(
      {
        position: source?.position ?? { x: 0, y: 0 },
        width: source?.measured?.width,
        height: source?.measured?.height,
      },
      {
        position: target?.position ?? { x: 0, y: 0 },
        width: target?.measured?.width,
        height: target?.measured?.height,
      },
      size,
    );

    const node = createNode(
      type,
      position,
      state.nodes.length,
      state.llmModels[0]?.id,
      pickDefaultMediaModel(state.mediaModels),
    );

    set({
      nodes: [
        ...state.nodes.map((existing) => ({ ...existing, selected: false })),
        { ...node, selected: true },
      ],
      // Старая связь заменяется двумя: source → новый узел → target.
      // `targetHandle: null` — React Flow подставит первый входной порт узла
      // (типы без входного порта отсекает проверка `canInsertOnEdge` выше).
      edges: [
        ...state.edges.filter((item) => item.id !== edgeId),
        {
          id: `edge-${crypto.randomUUID()}`,
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? null,
          target: node.id,
          targetHandle: null,
        },
        {
          id: `edge-${crypto.randomUUID()}`,
          source: node.id,
          sourceHandle: null,
          target: edge.target,
          targetHandle: edge.targetHandle ?? null,
        },
      ],
      selectedNodeId: node.id,
      executionLevels: {},
    });

    return true;
  },

  requestInsertOnEdge: (edgeId) => set({ pendingEdgeId: edgeId }),

  clearPendingEdge: () => set({ pendingEdgeId: null }),

  duplicateNodes: (ids) =>
    set((state) => {
      const copies = cloneNodesForDuplicate(state.nodes, ids, () =>
        crypto.randomUUID(),
      );

      if (copies.length === 0) {
        return {};
      }

      return {
        nodes: [
          ...state.nodes.map((node) => ({ ...node, selected: false })),
          ...copies,
        ],
        selectedNodeId: copies[0]?.id ?? state.selectedNodeId,
        executionLevels: {},
      };
    }),

  markSaved: (hash) => set({ lastSavedHash: hash }),

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),

  saveWorkflowAsync: async () => {
    const { nodes, edges, currentWorkflowId, currentWorkflowName } = get();
    const name = currentWorkflowName.trim() || DEFAULT_WORKFLOW_NAME;
    // KI-187: local-only узлы (комментарии) на backend не уходят — движок
    // бросает `UnsupportedNodeTypeException` на незнакомый тип и роняет запуск.
    const backendNodes = toBackendNodes(nodes);
    const payload = {
      name,
      nodes: backendNodes.map(toApiNode),
      edges: toBackendEdges(edges, backendNodes).map(toApiEdge),
    };

    set({ isSaving: true, error: null });

    try {
      const saved = currentWorkflowId
        ? await updateWorkflowAsync(currentWorkflowId, payload)
        : await createWorkflowAsync({ userId: DEFAULT_USER_ID, ...payload });

      set({
        currentWorkflowId: saved.id,
        currentWorkflowName: saved.name,
        // KI-195: запомнили «чистое» состояние — индикатор в TopBar погаснет.
        lastSavedHash: computeGraphHash(nodes, edges),
        isSaving: false,
        notice: {
          kind: 'success',
          text: i18n.t('toast.workflow_saved', { name: saved.name }),
        },
      });
      // Сохранён другой граф — прежнее состояние запуска к нему не относится.
      get().resetRunState();
    } catch (error) {
      const message = messageOf(error);
      set({ isSaving: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  loadWorkflowAsync: async (id) => {
    set({ isLoading: true, error: null });

    try {
      const workflow = await getWorkflowAsync(id);
      const { nodes, edges, warning } = fromApiWorkflow(workflow);

      set({
        nodes,
        edges,
        currentWorkflowId: workflow.id,
        currentWorkflowName: workflow.name,
        // KI-195: только что загруженный граф — «чистый» (иначе после F5
        // индикатор показывал бы «есть изменения»).
        lastSavedHash: computeGraphHash(nodes, edges),
        isLoading: false,
        // Прежний план относился к другому графу.
        executionLevels: {},
        // Выбранная нода тоже относилась к другому графу.
        selectedNodeId: null,
        notice: warning
          ? { kind: 'error', text: warning }
          : { kind: 'success', text: i18n.t('toast.workflow_loaded', { name: workflow.name }) },
      });
      // Загружен другой граф: состояние прошлого запуска сбрасываем.
      get().resetRunState();
    } catch (error) {
      const message = messageOf(error);
      set({ isLoading: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  runPlanAsync: async () => {
    const { nodes, edges } = get();
    // KI-187: комментарии в план не отправляем — это UI-стикеры, а не узлы
    // выполнения (backend вернул бы их в `order`/`levels` и попытался выполнить).
    const backendNodes = toBackendNodes(nodes);

    // Граф без узлов выполнения (только комментарии) планировать нечего —
    // backend ответил бы «Граф не содержит узлов» (RULES 1.6: понятный UI-текст).
    if (backendNodes.length === 0) {
      set({ notice: { kind: 'error', text: i18n.t('toast.graph_empty') } });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const plan = await planWorkflowAsync(
        backendNodes.map(toApiNode),
        toBackendEdges(edges, backendNodes).map(toApiEdge),
      );

      const levels = levelsToMap(plan.levels);
      // В сообщении показываем подписи типов узлов из реестра, а не uuid.
      // Ищем по отправленным узлам: в `plan.order` комментариев нет (KI-187).
      const order = plan.order
        .map((nodeId) =>
          nodeLabelOf(
            backendNodes.find((item) => item.id === nodeId),
            nodeId,
          ),
        )
        .join(' → ');

      set({
        executionLevels: levels,
        isLoading: false,
        notice: {
          kind: 'success',
            text: i18n.t('toast.plan', { levels: plan.levels.length, order }),
        },
      });
    } catch (error) {
      const message = messageOf(error);
      set({ isLoading: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  startRunAsync: async (workflowId) => {
    // Новый запуск не должен смешиваться с состоянием предыдущего.
    get().resetRunState();
    set({ runStatus: 'pending', error: null });

    let runId: string;

    try {
      const run = await createRunAsync(workflowId);

      runId = run.id;
      set({ runId: run.id, runStatus: run.status });
    } catch (error) {
      const message = messageOf(error);

      set({
        runStatus: 'failed',
        runError: message,
        notice: { kind: 'error', text: message },
      });

      return;
    }

    closeRunStream = subscribeToRunStream(runId, {
      onMessage: (message) => {
        if (message.type === 'snapshot') {
          get().applySnapshot(message);

          return;
        }

        get().applyEvent(message);
      },
      onError: () => {
        // EventSource переподключается сам; закрываем только завершённый запуск:
        // иначе повторное подключение принесёт новый snapshot и состояние
        // восстановится (KI-049).
        if (isFinalStatus(get().runStatus)) {
          closeStreamIfAny();
        }
      },
      onFatalError: (attempts) => {
        const text = i18n.t('toast.stream_stalled', { count: attempts });

        set({ runError: text, notice: { kind: 'error', text } });
      },
    });
  },

  applySnapshot: (snapshot) => {
    const nodeStatuses: Record<string, RunStatus> = {};
    const nodeOutputs: Record<string, Record<string, unknown>> = {};
    const nodeErrors: Record<string, string> = {};
    const nodeLogs: Record<string, string[]> = {};
    const nodeMetrics: Record<string, NodeRunMetrics> = {};

    for (const node of snapshot.nodes) {
      nodeStatuses[node.nodeId] = node.status;

      if (node.outputs) {
        nodeOutputs[node.nodeId] = node.outputs;
      }

      if (node.error) {
        nodeErrors[node.nodeId] = node.error;
      }

      if (node.logs !== null && node.logs.length > 0) {
        nodeLogs[node.nodeId] = node.logs;
      }

      nodeMetrics[node.nodeId] = {
        durationMs: node.durationMs,
        tokensIn: node.tokensIn,
        tokensOut: node.tokensOut,
        costUsd: node.costUsd,
        // Поле в снимке необязательное (backend пока его не отдаёт, KI-114).
        costRub: node.costRub ?? null,
      };
    }

    // Snapshot — источник истины на момент подключения: карты заменяются
    // целиком, а не сливаются с прошлым состоянием.
    set({
      runId: snapshot.run.id,
      runStatus: snapshot.run.status,
      nodeStatuses,
      nodeOutputs,
      nodeErrors,
      nodeLogs,
      nodeMetrics,
    });
  },

  applyEvent: (event) => {
    switch (event.type) {
      case 'run_started':
        set((state) => ({
          runStatus: 'running',
          // Первый старт — попытка 1. Дальше номер уточняется из run_completed
          // (`attemptsMade`): run_started не несёт этой информации, и первое
          // событие может быть пропущено, если клиент подписался позже старта.
          attemptNumber: state.attemptNumber === 0 ? 1 : state.attemptNumber,
        }));

        return;

      case 'node_started':
        set((state) => withNodeStatus(state, event.nodeId, 'running'));

        return;

      case 'node_completed':
        set((state) => ({
          ...withNodeStatus(state, event.nodeId, 'completed'),
          nodeOutputs: { ...state.nodeOutputs, [event.nodeId]: event.outputs },
          // KI-149 (KI-075): метрики есть и в событии — панель показывает
          // стоимость и токены сразу после Run, а не только после F5.
          // Значения события свежее snapshot, поэтому перекрывают известные.
          nodeMetrics: {
            ...state.nodeMetrics,
            [event.nodeId]: {
              ...(state.nodeMetrics[event.nodeId] ?? EMPTY_METRICS),
              durationMs: event.durationMs,
              costRub: event.costRub ?? null,
              tokensIn: event.tokensIn ?? null,
              tokensOut: event.tokensOut ?? null,
              costUsd: event.costUsd ?? null,
            },
          },
          ...withNodeLogs(state, event.nodeId, event.logs),
        }));

        return;

      case 'node_failed':
        set((state) => ({
          ...withNodeStatus(state, event.nodeId, 'failed'),
          // Текст падения узла доступен сразу — панель результата покажет его
          // до переподключения, а run-уровневый runError остаётся для бейджа.
          runError: event.error,
          nodeErrors: { ...state.nodeErrors, [event.nodeId]: event.error },
          // KI-149 (KI-075): метрики провайдера на падении неизвестны (`null`),
          // зато приходят логи ретраев — панель покажет их до F5.
          nodeMetrics: {
            ...state.nodeMetrics,
            [event.nodeId]: {
              ...(state.nodeMetrics[event.nodeId] ?? EMPTY_METRICS),
              costRub: event.costRub ?? null,
              tokensIn: event.tokensIn ?? null,
              tokensOut: event.tokensOut ?? null,
              costUsd: event.costUsd ?? null,
            },
          },
          ...withNodeLogs(state, event.nodeId, event.logs),
        }));

        return;

      case 'run_completed':
        // KI-070: промежуточный провал (final=false) — не финал, BullMQ повторит
        // запуск (KI-040). Статус остаётся 'running', поэтому UI не показывает
        // «Ошибка» и не разблокирует Run до настоящего финала.
        if (event.status === 'failed' && !event.final) {
          set({
            runStatus: 'running',
            runHasMoreAttempts: true,
            attemptsMade: event.attemptsMade,
            attempts: event.attempts,
            // `attemptsMade` — сколько попыток сделано ДО текущей доставки
            // (KI-059), значит следующая попытка имеет номер attemptsMade + 2.
            attemptNumber: event.attemptsMade + 2,
          });

          return;
        }

        // Финальный провал либо успех.
        set((state) => ({
          runStatus: event.status,
          runHasMoreAttempts: false,
          attemptsMade: event.attemptsMade,
          attempts: event.attempts,
          // Финал: завершилась попытка номер attemptsMade + 1 (attemptsMade —
          // счётчик предыдущих доставок, KI-059).
          attemptNumber: event.attemptsMade + 1,
          runError:
            event.status === 'failed'
              ? (state.runError ?? i18n.t('error.run_failed'))
              : null,
        }));

        // KI-060: `final` — признак того, что retry не будет: поток закрываем.
        if (event.final) {
          closeStreamIfAny();
        }

        return;
    }
  },

  resetRunState: () => {
    closeStreamIfAny();
    set({
      runId: null,
      runStatus: null,
      runError: null,
      nodeStatuses: {},
      nodeOutputs: {},
      nodeErrors: {},
      nodeLogs: {},
      nodeMetrics: {},
      attemptNumber: 0,
      attemptsMade: 0,
      attempts: null,
      runHasMoreAttempts: false,
    });
    // selectedNodeId намеренно НЕ сбрасывается: пользователь может выбрать ноду
    // и после запуска, чтобы посмотреть её результат.
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  loadLlmModelsAsync: async () => {
    if (get().llmModelsLoaded) {
      return;
    }

    try {
      const models = await fetchLlmModelsAsync();

      set({ llmModels: models, llmModelsLoaded: true });
    } catch (error: unknown) {
      // Не критично для работы редактора: селект покажет «нет доступных
      // моделей», а причина видна в консоли. Повторная попытка — при следующем
      // монтировании LLM-узла (флаг loaded не выставлен).
      console.warn('Не удалось загрузить список моделей LLM', error);
    }
  },

  loadMediaModelsAsync: async () => {
    if (get().mediaModelsLoaded) {
      return;
    }

    try {
      const models = await fetchMediaModelsAsync('IMAGE');

      set({ mediaModels: models, mediaModelsLoaded: true });
    } catch (error: unknown) {
      // Как и у LLM: селект покажет «нет доступных image-моделей», причина —
      // в консоли; повтор при следующем монтировании узла (флаг не выставлен).
      console.warn('Не удалось загрузить список media-моделей', error);
    }
  },

  setCurrentWorkflowId: (id, name) =>
    set((state) => ({
      currentWorkflowId: id,
      currentWorkflowName: name ?? state.currentWorkflowName,
    })),
  setCurrentWorkflowName: (name) => set({ currentWorkflowName: name }),

  setExecutionLevels: (levels) => set({ executionLevels: levelsToMap(levels) }),

  clearExecutionLevels: () => set({ executionLevels: {} }),

  setNotice: (notice) => set({ notice }),

  setFindCenter: (handler) => set({ findCenter: handler }),

  setCanvasMode: (mode) => {
    writeStorage(CANVAS_MODE_STORAGE_KEY, mode);
    set({ canvasMode: mode });
  },

  setShowMinimap: (show) => {
    writeStorage(SHOW_MINIMAP_STORAGE_KEY, String(show));
    set({ showMinimap: show });
  },

  setCatalogOpen: (open) => set({ isCatalogOpen: open }),

  toggleCommentsVisibility: () =>
    set((state) => {
      // Скрываем, если виден хотя бы один стикер; иначе показываем все.
      const hide = state.nodes.some(
        (node) => node.type === 'comment' && node.data.visible !== false,
      );

      return {
        nodes: state.nodes.map((node) =>
          node.type === 'comment'
            ? { ...node, data: { ...node.data, visible: !hide } }
            : node,
        ),
      };
    }),
}));
