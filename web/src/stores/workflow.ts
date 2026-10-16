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
  fetchRunBudgetAsync,
  getWorkflowAsync,
  planWorkflowAsync,
  updateWorkflowAsync,
  type ApiGraphEdge,
  type ApiGraphNode,
  type ApiWorkflow,
  type LlmModelInfo,
} from '@/lib/api';
import { subscribeToRunStream, RunStreamUnavailableError } from '@/lib/run-stream';
import type { RunStreamHandlers } from '@/lib/run-stream';
import { levelsToMap } from '@/lib/plan';
import {
  pickDefaultMediaModel,
  pickDefaultToolModel,
  pickToolModels,
} from '@/lib/media';
import {
  GENERATION_MEDIA_TYPE_BY_NODE,
  pickDefaultGenerationModel,
  pickGenerationModels,
  type GenerationMediaType,
} from '@/lib/generation-node';
import { canInsertOnEdge, isNodeType, nodeLabelOf } from '@/lib/node-registry';
import type { MediaModelInfo } from '@/types/media';
import {
  DEFAULT_CONDITION_OPERATOR,
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_OUTPUT_NAME,
  IMAGE_TOOL_OPERATIONS,
  type AppNode,
  type AudioGenNodeData,
  type CommentNodeData,
  type CompareNodeData,
  type ConditionNodeData,
  type HttpNodeData,
  type ImageGenNodeData,
  type ImageToolNodeData,
  type ImageToolOperation,
  type LlmNodeData,
  type MusicGenNodeData,
  type NodeData,
  type NodeType,
  type OutputNodeData,
  type SubWorkflowNodeData,
  type VideoGenNodeData,
} from '@/types/graph';
import {
  DEFAULT_HTTP_METHOD,
  validateHttpHeaders,
  validateHttpMethod,
  validateTimeoutMs,
} from '@/lib/http-node-fields';
import { validateConditionOperator } from '@/lib/condition-node-fields';
import {
  validateInputsMap,
  validateWorkflowVersion,
} from '@/lib/sub-workflow-fields';
import { validateMaxTokensOverride, validateReasoningEffort } from '@/lib/llm-node-fields';
import {
  cloneNodesForDuplicate,
  insertPositionOnEdge,
  NODE_DEFAULT_HEIGHT,
  NODE_DEFAULT_WIDTH,
} from '@/lib/graph-edit';
import { computeGraphHash } from '@/lib/graph-hash';
import {
  clearRunIdFromUrl,
  getRunIdFromUrl,
  setRunIdInUrl,
} from '@/lib/url-sync';
import {
  toBackendEdges,
  toBackendNodes,
} from '@/lib/graph-payload';
import { invalidateWorkflowListCache } from '@/lib/workflow-list-cache';
import type {
  NodeRunStatus,
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

/** Запись частичного состояния стора — то, что нужно обработчикам потока. */
type StoreSet = (partial: Partial<WorkflowState>) => void;

/**
 * Собирает колбэки подписки на SSE-поток запуска.
 *
 * Один и тот же набор нужен в двух местах: при старте запуска
 * (`startRunAsync`) и при восстановлении подписки после F5
 * (`loadWorkflowAsync`, KI-271) — поэтому он живёт отдельной функцией, а не
 * дублируется на месте подписки.
 *
 * @param set - запись состояния стора
 * @param get - чтение состояния стора
 * @returns колбэки для `subscribeToRunStream`
 */
function buildRunStreamHandlers(
  set: StoreSet,
  get: () => WorkflowState,
): RunStreamHandlers {
  return {
    onMessage: (message) => {
      if (message.type === 'snapshot') {
        get().applySnapshot(message);

        return;
      }

      get().applyEvent(message);
    },
    onError: (error) => {
      // KI-271: запуск из `?runId=` недоступен (404 — удалён или чужой; 401 —
      // сессия не восстановлена). Повтор не поможет: убираем id из адресной
      // строки и сбрасываем состояние запуска, иначе UI завис бы на «выполняется».
      if (error instanceof RunStreamUnavailableError) {
        console.warn('Поток запуска недоступен — состояние запуска сброшено', error);
        clearRunIdFromUrl();
        get().resetRunState();

        return;
      }

      // KI-268: поток переподключается сам, пока ошибки идут подряд (до
      // `MAX_CONSECUTIVE_ERRORS`); закрываем только завершённый запуск — иначе
      // повторное подключение принесёт новый snapshot и состояние
      // восстановится (KI-049).
      if (isFinalStatus(get().runStatus)) {
        closeStreamIfAny();
      }
    },
    onClose: () => {
      // Поток закрылся сам (сервер завершил ответ либо попытки исчерпаны):
      // handle больше не нужен, повторный abort бессмыслен.
      closeRunStream = null;
    },
    onFatalError: (attempts) => {
      const text = i18n.t('toast.stream_stalled', { count: attempts });

      set({ runError: text, notice: { kind: 'error', text } });
    },
  };
}

/**
 * Возвращает патч состояния с новым статусом узла.
 *
 * @param state - текущее состояние стора
 * @param nodeId - id узла графа
 * @param status - новый статус узла (включая `skipped`, KI-288)
 * @returns патч `nodeStatuses` для `set`
 */
function withNodeStatus(
  state: WorkflowState,
  nodeId: string,
  status: NodeRunStatus,
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

/**
 * Бюджет текущего запуска (R7.1, KI-048).
 *
 * Приходит из отдельной ручки `GET /runs/:id/budget` (не из SSE-снимка:
 * контракт потока в R7.1 не меняется) и обновляется при старте запуска и после
 * каждого завершённого узла.
 */
export interface RunBudget {
  /** Потрачено запуском, USD (рубли приведены к доллару на backend). */
  accumulated: number;
  /** Лимит запуска в USD — максимум шкалы прогресс-бара. */
  max: number;
  /** Лимит запуска в рублях (media-узлы тарифицируются в рублях). */
  maxRub: number;
  /** Остаток бюджета, USD (может быть отрицательным). */
  remaining: number;
  /** Укладывается ли следующий вызов в лимиты (факт, без учёта режима). */
  ok: boolean;
  /** Режим бюджета: `hard` блокирует вызов, `soft` предупреждает. */
  mode: 'hard' | 'soft';
}

/** Функция поиска центра вьюпорта, которую отдаёт Canvas. */
export type FindCenterHandler = () => Position;

/**
 * Снимок графа для undo/redo (DESIGN v0.8 § 7.2).
 *
 * Снимок хранит **только** `nodes`/`edges`: состояние запуска
 * (`runStatus`, `nodeStatuses`, `runId`, …) и UI-выделение к графу не
 * относятся и откату не подлежат.
 */
export interface GraphSnapshot {
  /** Узлы графа на момент снимка (глубокая копия). */
  readonly nodes: readonly AppNode[];
  /** Связи графа на момент снимка (глубокая копия). */
  readonly edges: readonly Edge[];
}

/**
 * История правок графа (DESIGN v0.8 § 7.2).
 *
 * `past` — стопка снимков «до изменения» (последний элемент — ближайший
 * откат), `future` — отменённые состояния для повтора. Обе стопки живут в
 * том же Zustand-сторе, что и граф: так `pushHistory` вызывается из тех же
 * actions, что меняют `nodes`/`edges`, без синхронизации двух хранилищ.
 */
export interface HistorySlice {
  /** Снимки «до изменения»; последний элемент — цель ближайшего `undo`. */
  past: GraphSnapshot[];
  /** Отменённые состояния; первый элемент — цель ближайшего `redo`. */
  future: GraphSnapshot[];
}

/**
 * Глубина истории: сколько последних правок можно откатить (DESIGN v0.8 § 7.2).
 *
 * Старые снимки вытесняются по FIFO: память не растёт при долгой сессии.
 */
const HISTORY_MAX_DEPTH = 50;

/**
 * Окно склейки правок полей узла, мс (R6.4b.2b).
 *
 * Правка текста в узле — это `updateNodeData` на каждый символ, и по одному
 * снимку на символ стек в 50 записей исчерпывался бы за одну фразу. Правки
 * одного поля, разделённые меньшим интервалом, склеиваются в один шаг отката:
 * `Ctrl+Z` после набора текста откатывает фразу целиком.
 */
const FIELD_EDIT_COALESCE_MS = 1000;

/**
 * Момент последней склейки правок полей (`0` — склейки нет).
 *
 * Живёт на уровне модуля, а не в сторе: значение — техническая отметка
 * времени, обновление которой не должно вызывать ре-рендер подписчиков.
 */
let lastFieldEditAt = 0;

/** Состояние редактора графа. */
export interface WorkflowState extends HistorySlice {
  nodes: AppNode[];
  edges: Edge[];

  /**
   * Кладёт снимок текущего графа в `past` (DESIGN v0.8 § 7.2).
   *
   * Вызывается **до** изменения `nodes`/`edges` — снимок описывает состояние
   * «как было». Новое действие очищает `future`: ветка повтора после правки
   * графа недостижима.
   */
  pushHistory: () => void;
  /**
   * Кладёт снимок, если предыдущая правка поля была больше окна склейки назад
   * (R6.4b.2b).
   *
   * Нужен для правок, которые приходят не через actions стора
   * (`updateNodeData` из React Flow): иначе каждый символ текста занял бы
   * отдельный шаг истории.
   */
  pushHistoryCoalesced: () => void;
  /**
   * Откат: последний снимок `past` становится текущим графом, а прежнее
   * состояние уходит в `future`.
   */
  undo: () => void;
  /**
   * Повтор: первый снимок `future` становится текущим графом, а прежнее
   * состояние возвращается в `past`.
   */
  redo: () => void;
  /**
   * Есть ли что откатывать.
   *
   * @returns `true`, если `past` непуст
   */
  canUndo: () => boolean;
  /**
   * Есть ли что повторять.
   *
   * @returns `true`, если `future` непуст
   */
  canRedo: () => boolean;

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
  /**
   * Текст последней ошибки запуска (для панели результата R4.3).
   *
   * Приходит из `node_failed` (событие падения узла) и из `run.error` снимка
   * (KI-347) — так причина видна и сразу, и после F5.
   */
  runError: string | null;
  /** id узла → статус выполнения (snapshot + события потока). */
  nodeStatuses: Record<string, NodeRunStatus>;
  /** id узла → последние выходы узла из `node_completed`. */
  nodeOutputs: Record<string, Record<string, unknown>>;
  /**
   * id узла → текст ошибки (из snapshot, `node_failed` и `node_skipped`).
   *
   * У пропущенного узла здесь причина пропуска (`reason` из `node_skipped`) —
   * панель результата показывает её без дополнительных полей (KI-288).
   */
  nodeErrors: Record<string, string>;
  /** id узла → записи ретраев (KI-036); приходят только в snapshot. */
  nodeLogs: Record<string, string[]>;
  /** id узла → метрики выполнения (длительность, токены, стоимость). */
  nodeMetrics: Record<string, NodeRunMetrics>;
  /**
   * Бюджет текущего запуска (R7.1, KI-048); `null` — запуска нет.
   *
   * Числа те же, что проверяет предохранитель на backend: TopBar рисует по ним
   * прогресс-бар (`data-run-budget`).
   */
  runBudget: RunBudget | null;
  /**
   * Обновляет бюджет запуска из `GET /runs/:id/budget` (R7.1).
   *
   * Вызывается при старте запуска и после каждого завершённого узла; ошибка не
   * критична — прогресс-бар просто не обновится (в консоль).
   */
  loadRunBudgetAsync: () => Promise<void>;
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
  /**
   * Модели-инструменты для узла `image_tool` (R7.1): `type=TOOL`, а при пустом
   * ответе — модели с обязательным входным файлом (см. `pickToolModels`).
   */
  toolModels: MediaModelInfo[];
  /** Загружен ли список моделей-инструментов в этой сессии. */
  toolModelsLoaded: boolean;
  /** Ленивая загрузка моделей-инструментов (кэшируется в сторе). */
  loadToolModelsAsync: () => Promise<void>;
  /**
   * Каталоги моделей media-генерации R7.2 по типу (KI-361).
   *
   * Для `AUDIO` сюда попадают и TTS-модели из `MUSIC`: реальный каталог
   * CreativeLab не отдаёт `type=AUDIO` (см. `lib/generation-node`).
   */
  generationModels: Record<GenerationMediaType, MediaModelInfo[]>;
  /** Загружен ли каталог каждого типа в этой сессии. */
  generationModelsLoaded: Record<GenerationMediaType, boolean>;
  /** Ленивая загрузка каталога media-генерации (кэшируется в сторе). */
  loadGenerationModelsAsync: (type: GenerationMediaType) => Promise<void>;

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
   * Исключение — `runError`: он обновляется только непустым `run.error`
   * (KI-347), иначе снимок промежуточной попытки стёр бы уже известную причину.
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
 * Проверяет, что значение — обычный объект (не массив и не `null`).
 *
 * Данные узла приходят из jsonb без типов (RULES 1.17): `params` узла
 * `image_tool` переносим дальше только если это словарь.
 *
 * @param value - значение из `data` узла
 * @returns `true`, если это объект-словарь
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Приводит операцию узла `image_tool` к известному значению (R7.1).
 *
 * Неизвестное значение заменить нечем (в селекте пять операций DESIGN § 3.1),
 * а валидный Save других значений не создаёт: backend-схема принимает ровно
 * пять. Поэтому мусор трактуется как «операция не выбрана» — дефолт
 * `bg_removal`, у которого есть модель в каталоге.
 *
 * @param value - значение `data.operation` из API
 * @returns известную операцию
 */
function validateImageToolOperation(value: unknown): ImageToolOperation {
  return IMAGE_TOOL_OPERATIONS.find((operation) => operation === value) ?? 'bg_removal';
}

/**
 * Проверяет и нормализует длительность media-узла (R7.2).
 *
 * Значения приходят из jsonb: строка, отрицательное число или мусор сделали бы
 * запуск падающим на Zod-схеме backend, поэтому нечисловой ввод отбрасывается
 * (поле просто не создаётся — KI-129), а дробное значение округляется к целому:
 * у моделей `duration` — enum целых секунд.
 *
 * @param value - значение `data.durationSec` из API
 * @returns целые секунды (1–300) либо `undefined`
 */
function validateSec(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const rounded = Math.round(parsed);

  // Границы шире DESIGN § 3.2 (video 3–10, music 15–120): реальный каталог
  // допускает, например, 30 секунд у `kling-v4`, а точный набор значений
  // задаёт enum модели (`duration` в каталоге).
  return rounded >= 1 && rounded <= 300 ? rounded : undefined;
}

/**
 * Проверяет скорость речи узла озвучки (R7.2).
 *
 * Диапазон — 0.5–2.0 (DESIGN v0.9 § 3.2): значение вне него backend-схема
 * отвергнет, поэтому оно не переносится из jsonb.
 *
 * @param value - значение `data.speed` из API
 * @returns скорость 0.5–2 либо `undefined`
 */
function validateSpeechSpeed(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2
    ? parsed
    : undefined;
}

/**
 * Создаёт узел нужного типа с дефолтными данными.
 *
 * @param type - тип узла из тулбара
 * @param position - позиция на холсте
 * @param index - порядковый номер узла, нужен для уникального id
 * @param defaultModelId - id первой доступной модели (KI-074); если список ещё
 *   не загружен или пуст, используется {@link DEFAULT_LLM_MODEL_ID}
 * @param defaultMediaModelId - id первой text-to-image модели (KI-154)
 * @param defaultToolModelId - id модели-инструмента по умолчанию (R7.1); пусто —
 *   модель выберет пользователь, а для `bg_removal`/`lipsync` сработает дефолт
 *   операции на backend
 * @param defaultGenerationModelId - id модели media-генерации по умолчанию
 *   (R7.2, KI-361): VIDEO/AUDIO/MUSIC-модель из каталога; пусто — модель
 *   подберёт backend (`MediaNodeExecutor`), а узел останется запускаемым
 */
function createNode(
  type: NodeType,
  position: Position,
  index: number,
  defaultModelId?: string,
  defaultMediaModelId?: string,
  defaultToolModelId?: string,
  defaultGenerationModelId?: string,
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
    // R7.1 (KI-196): media-инструмент. Операция по умолчанию — удаление фона:
    // у неё в каталоге CreativeLab есть модель (`bgremover`), поэтому узел
    // запускаем сразу после выбора входа. Модель не подставляем молча (KI-069):
    // пустое значение означает дефолт операции на backend.
    case 'image_tool':
      return {
        ...shared,
        type: 'image_tool',
        data: {
          kind: 'image_tool',
          operation: 'bg_removal',
          ...(defaultToolModelId !== undefined && defaultToolModelId !== ''
            ? { model: defaultToolModelId }
            : {}),
        },
      };
    case 'comment':
      return {
        ...shared,
        type: 'comment',
        // KI-187: стикер создаётся видимым; текст пользователь вводит сам.
        data: { kind: 'comment', text: '', visible: true },
      };

    // R7.2 (KI-361, DESIGN v0.9 § 3.2): три узла media-генерации. Модель
    // подставляется, если каталог уже загружен (иначе `''` — её выберет
    // backend по типу модели, чтобы узел не остался без модели вовсе).
    // Пустых ключей не создаём (KI-129): поля без значения не присваиваются.
    case 'video_generation':
      return {
        ...shared,
        type: 'video_generation',
        data: {
          kind: 'video_generation',
          ...(defaultGenerationModelId !== undefined &&
          defaultGenerationModelId !== ''
            ? { model: defaultGenerationModelId }
            : {}),
        },
      };
    case 'audio_generation':
      return {
        ...shared,
        type: 'audio_generation',
        data: {
          kind: 'audio_generation',
          ...(defaultGenerationModelId !== undefined &&
          defaultGenerationModelId !== ''
            ? { model: defaultGenerationModelId }
            : {}),
        },
      };
    case 'music_generation':
      return {
        ...shared,
        type: 'music_generation',
        data: {
          kind: 'music_generation',
          ...(defaultGenerationModelId !== undefined &&
          defaultGenerationModelId !== ''
            ? { model: defaultGenerationModelId }
            : {}),
        },
      };

    // R6.5.2 (KI-105): четыре вычислительных узла DESIGN v0.8 § 8. Поля-ключи
    // `headers`/`body`/`timeoutMs` у `http` не создаём заранее: `undefined`-ключ
    // — это пустое поле в JSON и лишний ключ в `Object.keys(data)` (KI-129).
    case 'http':
      return {
        ...shared,
        type: 'http',
        data: { kind: 'http', method: DEFAULT_HTTP_METHOD, url: '' },
      };
    case 'condition':
      return {
        ...shared,
        type: 'condition',
        // Оператор по умолчанию — строгое равенство: самый предсказуемый
        // вариант для строкового входа от Text-узла.
        data: { kind: 'condition', left: '', operator: DEFAULT_CONDITION_OPERATOR, right: '' },
      };
    case 'output':
      return {
        ...shared,
        type: 'output',
        data: { kind: 'output', name: DEFAULT_OUTPUT_NAME },
      };
    case 'compare':
      return {
        ...shared,
        type: 'compare',
        // Режим в v0.8 один (DESIGN § 8.5): `llm-judge` — задача v0.8.x.
        data: { kind: 'compare', mode: 'diff' },
      };
    // R6.7 (KI-200): ссылка на другой workflow. Пустая до выбора в селекте;
    // снимок `version` появляется в момент выбора подграфа (DESIGN § 5.5).
    case 'sub_workflow':
      return {
        ...shared,
        type: 'sub_workflow',
        data: { kind: 'sub_workflow', workflowId: '' },
      };
    // Нет default: — новый NodeType поймает tsc (KI-129).
  }
}

/**
 * Возвращает тип media-модели для узла media-генерации (R7.2).
 *
 * @param type - тип узла из тулбара
 * @returns `VIDEO`/`AUDIO`/`MUSIC` либо `null` — узел не про media-генерацию
 */
function generationTypeOf(type: NodeType): GenerationMediaType | null {
  return type in GENERATION_MEDIA_TYPE_BY_NODE
    ? GENERATION_MEDIA_TYPE_BY_NODE[type]
    : null;
}

/** Приводит узел к формату backend. */
function toApiNode(node: AppNode): ApiGraphNode {  return {
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
function nodeDataFromApi(type: NodeType, data: Record<string, unknown>): NodeData {
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
    // R7.1 (KI-196): media-инструмент. Операция обязана быть одной из пяти:
    // неизвестное значение не отрисовать в селекте (как у `condition`),
    // а валидный Save других значений и не создаёт — Zod-схема backend
    // принимает ровно пять операций DESIGN § 3.1.
    case 'image_tool': {
      const result: ImageToolNodeData = {
        kind: 'image_tool',
        operation: validateImageToolOperation(data.operation),
      };

      if (typeof data.model === 'string') {
        result.model = data.model;
      }

      if (typeof data.inputUrl === 'string') {
        result.inputUrl = data.inputUrl;
      }

      if (isPlainObject(data.params)) {
        result.params = data.params;
      }

      return result;
    }
    case 'comment': {      // KI-266: комментарий — полноправный узел графа: backend хранит его в
      // `workflows.nodes` наравне с остальными и возвращает при Load.
      // KI-129: `visible` по умолчанию `true` (как в `createNode`), чтобы
      // отсутствие поля не скрывало стикер.
      const result: CommentNodeData = {
        kind: 'comment',
        text: typeof data.text === 'string' ? data.text : '',
        visible: data.visible !== false,
      };

      return result;
    }
    // R7.2 (KI-361): media-генерация video/audio/music. Все значения приходят
    // из `jsonb` без типов, поэтому проверяются на границе (RULES 1.17), а поля
    // без значения не присваиваются вовсе — KI-129: иначе Load терял бы
    // настройки автора, а следующий Save затирал их в БД.
    case 'video_generation': {
      const result: VideoGenNodeData = { kind: 'video_generation' };

      if (typeof data.model === 'string') {
        result.model = data.model;
      }

      if (typeof data.prompt === 'string') {
        result.prompt = data.prompt;
      }

      if (typeof data.imageUrl === 'string') {
        result.imageUrl = data.imageUrl;
      }

      const durationSec = validateSec(data.durationSec);

      if (durationSec !== undefined) {
        result.durationSec = durationSec;
      }

      if (typeof data.aspectRatio === 'string') {
        result.aspectRatio = data.aspectRatio;
      }

      if (isPlainObject(data.params)) {
        result.params = data.params;
      }

      return result;
    }
    case 'audio_generation': {
      const result: AudioGenNodeData = { kind: 'audio_generation' };

      if (typeof data.model === 'string') {
        result.model = data.model;
      }

      // Старые workflow могли хранить текст синтеза в `prompt` — переносим,
      // чтобы текст не потерялся при Load (тот же приём, что у KI-166).
      const text =
        typeof data.text === 'string'
          ? data.text
          : typeof data.prompt === 'string'
            ? data.prompt
            : undefined;

      if (text !== undefined) {
        result.text = text;
      }

      if (typeof data.voiceId === 'string') {
        result.voiceId = data.voiceId;
      }

      const speed = validateSpeechSpeed(data.speed);

      if (speed !== undefined) {
        result.speed = speed;
      }

      if (isPlainObject(data.params)) {
        result.params = data.params;
      }

      return result;
    }
    case 'music_generation': {
      const result: MusicGenNodeData = { kind: 'music_generation' };

      if (typeof data.model === 'string') {
        result.model = data.model;
      }

      if (typeof data.prompt === 'string') {
        result.prompt = data.prompt;
      }

      const durationSec = validateSec(data.durationSec);

      if (durationSec !== undefined) {
        result.durationSec = durationSec;
      }

      if (typeof data.genre === 'string') {
        result.genre = data.genre;
      }

      if (isPlainObject(data.params)) {
        result.params = data.params;
      }

      return result;
    }
    // `jsonb` без типов, поэтому каждое проверяется (typeof / lib-валидатор), а
    // поля со значением `undefined` не присваиваются вовсе (KI-129) — иначе
    // Load терял бы настройки автора, а следующий Save затирал их в БД.
    // R6.5.2 (KI-105): четыре вычислительных узла.
    case 'http': {
      const result: HttpNodeData = {
        kind: 'http',
        method: validateHttpMethod(data.method),
        // Пустой URL — валидное состояние: адрес возьмётся из входа `prompt`.
        url: typeof data.url === 'string' ? data.url : '',
      };

      const headers = validateHttpHeaders(data.headers);

      if (headers !== undefined) {
        result.headers = headers;
      }

      if (typeof data.body === 'string') {
        result.body = data.body;
      }

      const timeoutMs = validateTimeoutMs(data.timeoutMs);

      if (timeoutMs !== undefined) {
        result.timeoutMs = timeoutMs;
      }

      return result;
    }
    case 'condition': {
      // KI-069-принцип здесь не работает: операцию нельзя «оставить как есть»,
      // если её нет в `<select>` (неизвестное значение не отрисовать), а
      // валидный Save других значений и не создаёт — Zod-схема backend
      // принимает ровно шесть операций MVP-DSL.
      const result: ConditionNodeData = {
        kind: 'condition',
        left: typeof data.left === 'string' ? data.left : '',
        operator: validateConditionOperator(data.operator),
        right: typeof data.right === 'string' ? data.right : '',
      };

      return result;
    }
    case 'output': {
      // Имя не подменяем (ср. KI-069): пустое значение честно упадёт на
      // валидации backend (`name`: `min(1)`), а не превратится молча в
      // `result` — иначе следующий Save перезаписал бы выбор автора.
      const result: OutputNodeData = {
        kind: 'output',
        name: typeof data.name === 'string' ? data.name : '',
      };

      return result;
    }
    case 'compare': {
      // Режим пока один: `llm-judge` из DESIGN § 8.5 — задача v0.8.x, и Zod
      // backend его отвергнет, поэтому чужое значение не переносим (иначе узел
      // стал бы незапускаемым).
      const result: CompareNodeData = { kind: 'compare', mode: 'diff' };

      return result;
    }
    case 'sub_workflow': {
      // R6.7 (KI-200): переносим ссылку на подграф, снимок версии и маппинг
      // входов. Пустой `workflowId` не подменяем (KI-069): узел честно
      // остаётся «не выбран», а Run падает валидацией на backend.
      // KI-129: поля со значением `undefined` не присваиваем вовсе — иначе
      // Load терял бы настройки автора, а следующий Save затирал их в БД.
      const result: SubWorkflowNodeData = {
        kind: 'sub_workflow',
        workflowId: typeof data.workflowId === 'string' ? data.workflowId : '',
      };

      const version = validateWorkflowVersion(data.version);

      if (version !== undefined) {
        result.version = version;
      }

      const inputsMap = validateInputsMap(data.inputsMap);

      if (inputsMap !== undefined) {
        result.inputsMap = inputsMap;
      }

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

    // KI-266: комментарий — обычный узел графа (реестр его знает с KI-187),
    // поэтому приходит из API наравне с остальными и собирается общим путём.
    // Раньше он был local-only и не мог появиться в ответе backend.
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
 * Делает глубокий снимок графа для истории (DESIGN v0.8 § 7.2).
 *
 * `structuredClone` выбран вместо ручного копирования: узлы React Flow —
 * вложенные структуры (`data`, `measured`, `position`), а поверхностная копия
 * оставила бы в снимке ссылки на живые объекты, и откат вернул бы изменённое
 * состояние. Клонируются только данные: функций и React-элементов в
 * `AppNode` нет.
 *
 * @param nodes - текущие узлы графа
 * @param edges - текущие связи графа
 * @returns снимок с глубокими копиями узлов и связей
 */
function snapshotOf(nodes: AppNode[], edges: Edge[]): GraphSnapshot {
  return {
    nodes: structuredClone(nodes),
    edges: structuredClone(edges),
  };
}

/**
 * Восстанавливает снимок графа после undo/redo (DESIGN v0.8 § 7.2).
 *
 * Помимо самих `nodes`/`edges` сбрасывается `executionLevels`: план
 * выполнения описывает прежний граф, и подсветка уровней после отката
 * указывала бы на несуществующие узлы. Выделенные узлы восстанавливаются
 * вместе с графом (`selected` — часть React Flow-состояния узла), а
 * `selectedNodeId` правит вызывающий: снимок его не хранит.
 *
 * @param snapshot - снимок, который становится текущим графом
 * @returns поля состояния для `set` (граф + сброшенный план)
 */
function restorePatch(snapshot: GraphSnapshot): {
  nodes: AppNode[];
  edges: Edge[];
  executionLevels: Record<string, number>;
} {
  return {
    nodes: [...snapshot.nodes],
    edges: [...snapshot.edges],
    executionLevels: {},
  };
}

/**
 * Стор редактора workflow: состояние графа, сохранение и план выполнения.
 */
export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],

  // R6.4b.2b: история правок графа. Пустые стопки на старте — откатывать
  // нечего, а снимок пустого графа в `past` дал бы «холостой» Ctrl+Z.
  past: [],
  future: [],

  pushHistory: () => {
    const { nodes, edges, past } = get();
    const nextPast = [...past, snapshotOf(nodes, edges)];

    // FIFO: старая история вытесняется, чтобы сессия не росла в памяти.
    if (nextPast.length > HISTORY_MAX_DEPTH) {
      nextPast.shift();
    }

    // Новое действие обрывает ветку повтора: `future` относится к отменённому
    // будущему, которого после правки графа уже не будет.
    lastFieldEditAt = 0;
    set({ past: nextPast, future: [] });
  },

  pushHistoryCoalesced: () => {
    const now = Date.now();

    // Первая правка после паузы — обычный снимок; продолжение набора текста
    // (в пределах окна) остаётся в том же шаге истории.
    if (now - lastFieldEditAt >= FIELD_EDIT_COALESCE_MS) {
      get().pushHistory();
      // Отметку ставим после снимка: `pushHistory` сбрасывает её в `0`
      // (новое действие обрывает окно склейки), поэтому иначе каждая
      // следующая правка поля считалась бы первой.
      lastFieldEditAt = now;

      return;
    }

    // Снимок уже лежит в `past` — окно склейки двигаем, чтобы долгий
    // непрерывный ввод не превратился в серию шагов.
    lastFieldEditAt = now;
  },

  undo: () => {
    const { past, future, nodes, edges } = get();
    const previous = past.at(-1);

    if (previous === undefined) {
      return;
    }

    set({
      past: past.slice(0, -1),
      // Текущее состояние уходит вперёд стопки повтора: порядок `redo` —
      // от ближайшего отменённого к самому старому.
      future: [snapshotOf(nodes, edges), ...future],
      ...restorePatch(previous),
    });

    // KI-187: выделение сбрасываем, если восстановленный граф не содержит
    // выбранного узла — иначе нижняя панель показывала бы данные узла,
    // которого после отката нет (та же логика, что в `removeNode`).
    const { selectedNodeId } = get();

    if (
      selectedNodeId !== null &&
      !previous.nodes.some((node) => node.id === selectedNodeId)
    ) {
      set({ selectedNodeId: null });
    }
  },

  redo: () => {
    const { past, future, nodes, edges } = get();
    const next = future.at(0);

    if (next === undefined) {
      return;
    }

    set({
      past: [...past, snapshotOf(nodes, edges)],
      future: future.slice(1),
      ...restorePatch(next),
    });

    const { selectedNodeId } = get();

    if (
      selectedNodeId !== null &&
      !next.nodes.some((node) => node.id === selectedNodeId)
    ) {
      set({ selectedNodeId: null });
    }
  },

  canUndo: () => get().past.length > 0,

  canRedo: () => get().future.length > 0,

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
  toolModels: [],
  toolModelsLoaded: false,
  generationModels: { VIDEO: [], AUDIO: [], MUSIC: [] },
  generationModelsLoaded: { VIDEO: false, AUDIO: false, MUSIC: false },
  runBudget: null,

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

  addNode: (type, position) => {
    // R6.4b.2b: состояние «до» попадает в историю (DESIGN v0.8 § 7.2).
    get().pushHistory();

    return set((state) => {
      // Модель нового LLM-узла берём из загруженного списка (KI-074), чтобы
      // узел сразу был запускаемым; fallback — дефолтный id из types/graph.
      // Для image-узла — первая media-модель (v0.6.0b.2.3).
      const generationType = generationTypeOf(type);
      const node = createNode(
        type,
        position,
        state.nodes.length,
        state.llmModels[0]?.id,
        // KI-154: не mediaModels[0] (там bgremover — image-to-image),
        // а первая text-to-image модель каталога.
        pickDefaultMediaModel(state.mediaModels),
        // R7.1: модель-инструмент по умолчанию (у операции `bg_removal`).
        pickDefaultToolModel(state.toolModels, 'bg_removal'),
        // R7.2: модель media-генерации по умолчанию (VIDEO/AUDIO/MUSIC).
        generationType === null
          ? undefined
          : pickDefaultGenerationModel(
              state.generationModels[generationType],
              generationType,
            ),
      );

      return {
        nodes: [
          ...state.nodes.map((existing) => ({ ...existing, selected: false })),
          { ...node, selected: true },
        ],
        // После правки графа прежний план выполнения уже неактуален.
        executionLevels: {},
      };
    });
  },

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

  onConnect: (connection) => {
    // R6.4b.2b: новая связь — обычная отменяемая правка графа.
    get().pushHistory();

    return set((state) => {
      // id генерируем сами: backend требует непустой id у каждой связи.
      const nextEdges = addEdge(connection, state.edges).map((edge) =>
        edge.id.startsWith('xy-edge__')
          ? { ...edge, id: `edge-${crypto.randomUUID()}` }
          : edge,
      );

      return { edges: nextEdges, executionLevels: {} };
    });
  },

  removeNode: (nodeId) => {
    // R6.4b.2b: удаление узла (вместе с его связями) откатывается одним шагом.
    get().pushHistory();

    return set((state) => {
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
    });
  },

  removeEdge: (edgeId) => {
    // R6.4b.2b: удаление связи — отдельный шаг истории.
    get().pushHistory();

    return set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      executionLevels: {},
    }));
  },

  newWorkflow: () => {
    // Поток предыдущего запуска закрываем, иначе его события продолжали бы
    // менять состояние уже пустого редактора.
    closeStreamIfAny();
    set({
      nodes: [],
      edges: [],
      // R6.4b.2b: «Новый» — это новый документ, а не правка графа: история
      // прежнего workflow очищается. Иначе после Load + «Новый» Ctrl+Z вернул
      // бы узлы чужого workflow, а `future` позволил бы «повторить» их.
      past: [],
      future: [],
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
      // R7.1 (KI-048): бюджет прошлого запуска к новому workflow не относится.
      runBudget: null,
    });
    // Сброс истории обнуляет и окно склейки правок полей.
    lastFieldEditAt = 0;
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

    const generationType = generationTypeOf(type);
    const node = createNode(
      type,
      position,
      state.nodes.length,
      state.llmModels[0]?.id,
      pickDefaultMediaModel(state.mediaModels),
      // R7.1: модель-инструмент по умолчанию для узла `image_tool`.
      pickDefaultToolModel(state.toolModels, 'bg_removal'),
      // R7.2: модель media-генерации по умолчанию.
      generationType === null
        ? undefined
        : pickDefaultGenerationModel(
            state.generationModels[generationType],
            generationType,
          ),
    );

    // R6.4b.2b: снимок — только после всех проверок выше: отказ вставки
    // (связь исчезла, тип не вставляется) граф не меняет, и шаг истории был бы
    // «холостым».
    get().pushHistory();

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

      // R6.4b.2b: снимок берём здесь, а не «первой строкой»: при пустом
      // результате дублирования граф не меняется, и шаг истории был бы
      // «холостым» (Ctrl+Z выглядел бы как неработающий).
      get().pushHistory();

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
    // KI-266: комментарии уходят на backend вместе с остальными узлами —
    // движок хранит их в графе, но в план выполнения не включает. Фильтр
    // `toBackendNodes` оставлен как историческая точка защиты и сейчас пуст.
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
      // KI-302: Save меняет список workflow (первое сохранение создаёт его,
      // повторное — двигает имя и `version`). Кэш селекта `sub_workflow` обязан
      // это увидеть, иначе созданный workflow не появится там до F5.
      invalidateWorkflowListCache();
    } catch (error) {
      const message = messageOf(error);
      set({ isSaving: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  loadWorkflowAsync: async (id) => {
    set({ isLoading: true, error: null });

    // KI-271: `?runId=` в адресной строке означает, что страницу перезагрузили
    // (F5) посреди запуска — состояние запуска не сбрасываем, а подписываемся на
    // поток заново: `snapshot` вернёт статусы узлов и run-уровня (KI-049).
    const runIdFromUrl = getRunIdFromUrl();

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

      if (runIdFromUrl === null) {
        // Загружен другой граф: состояние прошлого запуска сбрасываем.
        get().resetRunState();
      } else {
        // Поток от прошлого монтирования (StrictMode вызывает эффект дважды)
        // закрываем, состояние до прихода snapshot — «выполняется»: так Run
        // недоступен, пока факт запуска не подтверждён снимком.
        closeStreamIfAny();
        set({ runId: runIdFromUrl, runStatus: 'pending' });
        closeRunStream = subscribeToRunStream(
          runIdFromUrl,
          buildRunStreamHandlers(set, get),
        );
      }
    } catch (error) {
      const message = messageOf(error);
      set({ isLoading: false, error: message, notice: { kind: 'error', text: message } });
    }
  },

  runPlanAsync: async () => {
    const { nodes, edges } = get();
    // KI-266: комментарии отправляем как есть — backend сам исключает
    // аннотации из плана (`ANNOTATION_NODE_TYPES`), поэтому в `order`/`levels`
    // их не будет и попытки выполнить стикер не возникнет.
    const backendNodes = toBackendNodes(nodes);

    // Граф без узлов выполнения (только комментарии) планировать нечего:
    // backend ответил бы «Граф содержит только аннотации, нечего выполнять»
    // (RULES 1.6: понятный UI-текст).
    if (nodes.filter((node) => node.type !== 'comment').length === 0) {
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
      // Ищем по всем узлам графа: в `plan.order` аннотаций нет (KI-266).
      const order = plan.order
        .map((nodeId) =>
          nodeLabelOf(
            nodes.find((item) => item.id === nodeId),
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
      // KI-271: id запуска — в адресную строку, чтобы F5 посреди запуска
      // восстановил подписку на поток (см. `loadWorkflowAsync`).
      setRunIdInUrl(run.id);
    } catch (error) {
      const message = messageOf(error);

      set({
        runStatus: 'failed',
        runError: message,
        notice: { kind: 'error', text: message },
      });

      return;
    }

    closeRunStream = subscribeToRunStream(runId, buildRunStreamHandlers(set, get));
  },

  applySnapshot: (snapshot) => {
    const nodeStatuses: Record<string, NodeRunStatus> = {};
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
    set((state) => ({
      runId: snapshot.run.id,
      runStatus: snapshot.run.status,
      // KI-347: причина падения запуска приходит и в снимке — после F5 панель
      // показывает её, а не «причина недоступна». `null` не перетирает уже
      // известную ошибку (KI-271): снимок промежуточной попытки мог быть собран
      // до того, как `workflow_runs.error` заполнился.
      runError: snapshot.run.error ?? state.runError,
      nodeStatuses,
      nodeOutputs,
      nodeErrors,
      nodeLogs,
      nodeMetrics,
    }));

    // R7.1 (KI-048): после переподключения (F5 посреди запуска) прогресс-бар
    // бюджета восстанавливается из ручки `GET /runs/:id/budget`.
    void get().loadRunBudgetAsync();

    // KI-271: снимок уже завершённого запуска (F5 после финала на backend, где
    // `run_completed` больше не придёт) — `?runId=` в адресной строке устарел.
    // Поток при этом не закрываем: признак «повторов не будет» (`final`) в
    // снимок не попадает (KI-063), а обрыв подписки потерял бы события
    // оставшейся попытки job'а (KI-070).
    if (isFinalStatus(snapshot.run.status)) {
      clearRunIdFromUrl();
    }
  },

  applyEvent: (event) => {
    // R7.1 (KI-048): стоимость запуска меняется на старте, при финале каждого
    // узла и при финале запуска — в этих точках обновляем бюджет (прогресс-бар
    // в TopBar). Запрос отдельный: контракт SSE в R7.1 не расширяется.
    if (
      event.type === 'run_started' ||
      event.type === 'node_completed' ||
      event.type === 'node_failed' ||
      event.type === 'run_completed'
    ) {
      void get().loadRunBudgetAsync();
    }

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

      case 'node_skipped':
        // KI-288: движок не выполнял узел, потому что упал (или был пропущен)
        // его предшественник. `runError` намеренно не трогаем: пропуск — не
        // ошибка запуска, а следствие падения другого узла, и его текст уже
        // лежит в `runError` (пришёл с `node_failed`).
        set((state) => ({
          ...withNodeStatus(state, event.nodeId, 'skipped'),
          nodeErrors: { ...state.nodeErrors, [event.nodeId]: event.reason },
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
        // KI-271: и убираем `?runId=` — после F5 подписываться уже не на что.
        // При промежуточном провале (`final: false`) URL НЕ трогаем: у job'а
        // остались попытки (KI-070), и подписка должна пережить перезагрузку.
        if (event.final) {
          clearRunIdFromUrl();
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
      // R7.1 (KI-048): бюджет относится к конкретному запуску — сбрасываем,
      // иначе прогресс-бар показывал бы траты прошлого прогона.
      runBudget: null,
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

  /**
   * Загружает модели-инструменты для узла `image_tool` (R7.1, KI-196).
   *
   * Сначала запрашивается `type=TOOL` (как требует DESIGN v0.9 § 3.1). Реальный
   * каталог CreativeLab такого типа не отдаёт — инструменты объявлены обычными
   * моделями с обязательным входным файлом, поэтому фолбэк берёт IMAGE-модели
   * с обязательными входами (удаление фона, замена лиц). Без фолбэка селект был
   * бы пустым и узел нельзя было бы запустить.
   */
  loadToolModelsAsync: async () => {
    if (get().toolModelsLoaded) {
      return;
    }

    try {
      const [toolModels, imageModels] = await Promise.all([
        fetchMediaModelsAsync('TOOL'),
        fetchMediaModelsAsync('IMAGE'),
      ]);
      const models = pickToolModels({ toolModels, fallbackModels: imageModels });

      set({ toolModels: [...models], toolModelsLoaded: true });
    } catch (error: unknown) {
      // Не критично: селект покажет «нет доступных моделей-инструментов»,
      // причина — в консоли; повтор при следующем монтировании узла.
      console.warn('Не удалось загрузить список моделей-инструментов', error);
    }
  },

  /**
   * Загружает каталог моделей media-генерации по типу (R7.2, KI-361).
   *
   * Для `AUDIO` запрашиваются и `AUDIO`, и `MUSIC`: реальный каталог CreativeLab
   * не отдаёт `type=AUDIO` (TTS-модель `tts2` объявлена как `MUSIC`), поэтому
   * без фолбэка селект озвучки был бы пустым. Остальные типы — один запрос.
   *
   * @param type - тип модели узла (`VIDEO`/`AUDIO`/`MUSIC`)
   */
  loadGenerationModelsAsync: async (type) => {
    if (get().generationModelsLoaded[type]) {
      return;
    }

    try {
      const catalog =
        type === 'AUDIO'
          ? await Promise.all([
              fetchMediaModelsAsync('AUDIO'),
              fetchMediaModelsAsync('MUSIC'),
            ]).then(([audio, music]) => [...audio, ...music])
          : await fetchMediaModelsAsync(type);
      const models = pickGenerationModels(catalog, type);

      set((state) => ({
        generationModels: { ...state.generationModels, [type]: [...models] },
        generationModelsLoaded: { ...state.generationModelsLoaded, [type]: true },
      }));
    } catch (error: unknown) {
      // Не критично: селект покажет «нет доступных моделей», причина — в
      // консоли; повтор при следующем монтировании узла (флаг не выставлен).
      console.warn('Не удалось загрузить каталог media-генерации', type, error);
    }
  },

  /**
   * Обновляет бюджет текущего запуска (R7.1, KI-048).
   *
   * Бюджет приходит отдельной ручкой, а не в SSE-снимке: контракт потока в
   * R7.1 не расширяется. Запуск без `runId` ничего не запрашивает.
   */
  loadRunBudgetAsync: async () => {
    const runId = get().runId;

    if (runId === null) {
      return;
    }

    try {
      const budget = await fetchRunBudgetAsync(runId);

      // Запуск мог смениться, пока шёл запрос: тогда ответ уже неактуален.
      if (get().runId !== runId) {
        return;
      }

      set({
        runBudget: {
          accumulated: budget.accumulated,
          max: budget.maxUsd,
          maxRub: budget.maxRub,
          remaining: budget.remaining,
          ok: budget.ok,
          mode: budget.mode,
        },
      });
    } catch (error: unknown) {
      // Прогресс-бар — индикатор, а не источник истины: сбой запроса не должен
      // ломать запуск. Причина видна в консоли.
      console.warn('Не удалось загрузить бюджет запуска', error);
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
