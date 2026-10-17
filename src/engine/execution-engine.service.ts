import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  nodeRuns,
  workflowRuns,
  workflows,
  type NodeRunStatus,
} from '../db/schema.js';
import { RunEventsService } from '../runs/run-events.service.js';
import { AgentService } from '../agent/agent.service.js';
import { LlmNodeExecutor, type LlmNodeMetrics } from '../llm/llm-node-executor.service.js';
import { LlmProviderException } from '../llm/llm-provider.interface.js';
import { LlmRegistryService } from '../llm/llm-registry.service.js';
import {
  MediaNodeExecutor,
  type MediaNodeMetrics,
} from '../media/media-node-executor.service.js';
import { QuickJsRunnerService } from '../sandbox/quickjs-runner.service.js';
import { VectorStoreService } from '../vector/vector-store.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import type { GraphDto, NodeDto } from './dto/index.js';
import { EngineService, type ExecutionPlanDto } from './engine.service.js';
import {
  UnsupportedNodeTypeException,
  executeCompareNode,
  executeConditionNode,
  executeAgentNodeAsync,
  executeHttpNode,
  executeMemoryReadNodeAsync,
  executeMemoryWriteNodeAsync,
  executeOutputNode,
  executeSubWorkflowNode,
  executeTextNode,
  executeVectorQueryNodeAsync,
  executeVectorUpsertNodeAsync,
  prefixSubWorkflowGraph,
  type SubWorkflowContext,
  type VectorMemoryContext,
} from './node-executors.js';

/**
 * Приводит неизвестную ошибку к тексту для логов и колонки `error`.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Приводит стоимость к виду колонки `numeric`.
 *
 * Drizzle-колонка `cost_usd` объявлена без `mode`, поэтому в TS это строка
 * (RULES 4.23 — snake_case в БД, camelCase в TS). Формат — 6 знаков, как
 * в `numeric(10, 6)`.
 *
 * @param costUsd - стоимость в USD или `null`/`undefined`
 * @returns строка с 6 знаками после запятой либо `null`
 */
function toNumericString(costUsd: number | null | undefined): string | null {
  return typeof costUsd === 'number' ? costUsd.toFixed(6) : null;
}

/**
 * Проверяет, что значение из JSONB — обычный объект (а не массив/скаляр).
 *
 * @param value - значение типа `unknown`
 * @returns `true`, если значение можно читать как `Record<string, unknown>`
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Собирает читаемый текст ошибки планирования.
 *
 * `EngineService` бросает `BadRequestException` с объектом ответа: общая фраза
 * лежит в `message` («Граф не может быть выполнен»), а причина — в `errors`
 * («Граф содержит цикл…»). Без склейки деталей пользователь увидел бы только
 * общую фразу, поэтому `errors` добавляются к тексту (KI-037).
 *
 * @param error - значение из `catch`
 * @returns текст ошибки с деталями, если они есть
 */
function describePlanError(error: unknown): string {
  const base = toMessage(error);

  if (typeof error !== 'object' || error === null) {
    return base;
  }

  const getResponse = (error as { getResponse?: unknown }).getResponse;

  if (typeof getResponse !== 'function') {
    return base;
  }

  const payload = (error as { getResponse: () => unknown }).getResponse();

  if (typeof payload !== 'object' || payload === null) {
    return base;
  }

  const errors = (payload as { errors?: unknown }).errors;

  if (!Array.isArray(errors) || errors.length === 0) {
    return base;
  }

  return `${base}: ${errors.map((item) => String(item)).join('; ')}`;
}

/** Сколько раз пробовать узел при «временной» ошибке провайдера (KI-036). */
const NODE_MAX_ATTEMPTS = 3;
/** Базовая задержка перед повтором узла, мс (далее — экспоненциально). */
const NODE_RETRY_BASE_DELAY_MS = 500;

/**
 * Текст ошибки узла, пропущенного из-за упавшего предшественника (KI-288).
 *
 * Один и тот же текст уходит в `node_runs.error` и в событие `node_skipped`
 * (`reason`), чтобы UI показывал состояние одинаково и из снимка, и из потока.
 */
const NODE_SKIPPED_ERROR = 'Пропущен: упал предшественник';

/**
 * Пауза перед повтором узла.
 *
 * @param ms - длительность паузы в миллисекундах
 * @returns промис, который завершится через `ms` мс
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Результат выполнения узла: выходы и метрики вызова.
 *
 * Размеченное объединение (v0.6.0b.2.2): у LLM-узлов метрики в USD, у
 * media-узлов — в рублях, а у чистых преобразований (`text`) метрик нет вовсе.
 * Валюты не смешиваются: при записи в `node_runs` заполняется либо `cost_usd`,
 * либо `cost_rub` (RULES 4.23).
 */
type NodeStepResult = (
  | {
      kind: 'plain';
      outputs: Record<string, unknown>;
      metrics: null;
    }
  | {
      kind: 'llm';
      outputs: Record<string, unknown>;
      metrics: LlmNodeMetrics;
    }
  | {
      kind: 'media';
      outputs: Record<string, unknown>;
      metrics: MediaNodeMetrics;
    }
) & {
  /**
   * Дополнительные строки в `node_runs.logs` (R7.4b).
   *
   * Агент пишет сюда JSON-шаги цикла (`llm`/`tool`/`final`): они нужны
   * панели результата и разбору «почему модель ответила именно так», но не
   * являются метриками, поэтому живут отдельным полем, а не в `metrics`.
   * Остальные типы узлов поле не задают — массив остаётся пустым.
   */
  logs?: readonly string[];
};

/** Итог выполнения запуска. */
export interface ExecutionResult {
  /** Итоговый статус запуска. */
  status: 'completed' | 'failed';
  /** Сколько узлов успешно завершилось. */
  executedNodes: number;
  /** `id` первого упавшего узла либо `null`. */
  failedNodeId: string | null;
  /** Текст ошибки первого падения либо `null`. */
  error: string | null;
  /** Выходы завершившихся узлов: `nodeId` → outputs. */
  outputs: Record<string, Record<string, unknown>>;
}

/**
 * Executor графа workflow: реально выполняет узлы уровнями и пишет прогресс.
 *
 * Работает внутри BullMQ-worker'а (RULES 4.21), поэтому не знает про HTTP.
 * Узлы `llm` выполняются через LLM-провайдеров (R3), `image_generation` —
 * пока заглушка (R4).
 */
@Injectable()
export class ExecutionEngineService {
  private readonly logger = new Logger(ExecutionEngineService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly engineService: EngineService,
    private readonly runEvents: RunEventsService,
    private readonly llmExecutor: LlmNodeExecutor,
    private readonly mediaExecutor: MediaNodeExecutor,
    // R7.5 (KI-364): режим `sandbox` узла condition — QuickJS-WASM.
    private readonly sandboxRunner: QuickJsRunnerService,
    // R6.7 (KI-200): узел sub_workflow загружает подграф — нужен доступ к
    // workflow того же владельца. WorkflowModule экспортирует сервис.
    private readonly workflowService: WorkflowService,
    // R7.4a (KI-128): vector/memory-узлы. Реестр выбирает провайдера
    // эмбеддингов, хранилище — единственное место с SQL к pgvector.
    private readonly llmRegistry: LlmRegistryService,
    private readonly vectorStore: VectorStoreService,
    // R7.4b (DESIGN v0.9 § 3.4): цикл agent-узла (LLM → tools → final).
    private readonly agentService: AgentService,
  ) {}

  /**
   * Выполняет граф workflow в рамках запуска.
   *
   * Уровни из плана выполняются последовательно, узлы внутри уровня —
   * параллельно (`Promise.allSettled`, RULES 4.16): падение одного узла не
   * роняет ни остальные узлы того же уровня, ни последующие уровни.
   *
   * **KI-287:** план проходится до конца. Раньше уровень с падением прерывал
   * цикл (`break`), и независимые ветки следующих уровней не выполнялись —
   * это противоречило RULES 4.16 (смоук E2 R6.5.2: упавший `http` не дал
   * выполниться независимым `condition` и `compare`). Теперь узел, не зависящий
   * от упавшего, выполняется всегда, сколько бы уровней ни лежало выше.
   *
   * **KI-288:** узел, у которого среди предшественников есть упавший (или уже
   * пропущенный), не выполняется вообще: перед каждым уровнем такие узлы
   * закрываются статусом `skipped` (`node_runs.error` — «Пропущен: упал
   * предшественник») и публикуется событие `node_skipped`. Пропуск транзитивен:
   * потомок пропущенного узла тоже пропускается. До KI-288 зависимый узел
   * запускался с `null`-входами и падал сам, выглядя в UI как самостоятельно
   * сломанный. Заодно закрывается KI-290: fallback-выходы таких узлов больше не
   * попадают в `workflow_runs.outputs` — пропущенный узел туда не пишется.
   *
   * Итоговый статус запуска — `failed`, если упал **хотя бы один** узел,
   * независимо от того, сколько независимых узлов успешно завершилось.
   * Пропущенные узлы статус запуска не меняют: они следствие падения, а не
   * самостоятельная ошибка.
   *
   * В `workflow_runs.outputs` пишется словарь `nodeId` → outputs **всех**
   * успешно завершившихся узлов (а не только последнего уровня): так при
   * падении сохраняется частичный результат, а UI (R4) видит полную картину.
   * Упавшие и пропущенные узлы в `outputs` не попадают.
   *
   * Две разные стратегии обработки ошибок:
   * - **фаза планирования** (KI-037): ошибки детерминированы (цикл, битые
   *   связи), поэтому запуск закрывается `failed` и исключение НЕ
   *   пробрасывается — иначе строка осталась бы в `pending` навсегда;
   * - **фаза выполнения узлов** (KI-036): после исчерпания node-level попыток
   *   запуск тоже закрывается `failed`, но исключение пробрасывается наружу,
   *   чтобы BullMQ зафиксировал провал job'а и задействовал `attempts` (KI-016).
   *
   * @param runId - uuid запуска (строка в workflow_runs уже создана)
   * @param graph - граф из `workflow_runs.snapshot`
   * @returns итог выполнения: статус, число отработавших узлов, outputs
   * @throws Error если узел исчерпал попытки (KI-036) либо не удалось завершить запуск
   * @throws InternalServerErrorException если не удалось обновить запись запуска в БД
   *
   * Событие `run_completed` здесь НЕ публикуется (KI-060): признак финальности
   * зависит от того, сделает ли BullMQ ещё попытку, а это знает только
   * `RunsProcessor` — он и публикует событие после возврата или проброса.
   */
  async executeAsync(runId: string, graph: GraphDto): Promise<ExecutionResult> {
    let plan: ExecutionPlanDto;

    try {
      plan = await this.engineService.buildExecutionPlanAsync(graph);

      await this.markRunRunningAsync(runId);
      await this.runEvents.publishAsync(runId, {
        type: 'run_started',
        runId,
        startedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      // KI-037: запуск не должен остаться в 'pending'. Планирование падает до
      // простановки любого статуса, поэтому закрываем запуск явно.
      const message = describePlanError(error);

      this.logger.error(`Запуск ${runId}: планирование не удалось — ${message}`);
      await this.failRunAsync(runId, message, {});

      return {
        status: 'failed',
        executedNodes: 0,
        failedNodeId: null,
        error: message,
        outputs: {},
      };
    }

    const outputs: Record<string, Record<string, unknown>> = {};
    const failures: Array<{ nodeId: string; error: string; reason: unknown }> = [];

    // KI-288: два множества узлов, которые больше не запускаются.
    // `failedIds` — упавшие по-настоящему, `skippedIds` — не запускавшиеся
    // из-за упавшего (или уже пропущенного) предшественника. Потомок любого из
    // них попадает в `skippedIds` — так получается транзитивное замыкание.
    const failedIds = new Set<string>();
    const skippedIds = new Set<string>();

    // Обратные рёбра плана: «узел → его предшественники». Нужны, чтобы на
    // каждом уровне понять, чей предшественник уже упал (KI-288).
    const predecessors = this.buildPredecessorMap(plan);

    // R6.7 (KI-200): контекст для узлов sub_workflow. Владелец запуска нужен,
    // чтобы подграф загружался только у своего workflow (чужой → 404), а
    // `visitedWorkflows`/`depth` — для защиты от рекурсии. Запрос к БД
    // выполняется, только если в графе есть узел sub_workflow.
    const subContext = await this.createSubWorkflowContextAsync(runId, graph);

    for (const [levelIndex, level] of plan.levels.entries()) {
      // KI-288: узлы с упавшим (или пропущенным) предшественником НЕ
      // выполняются — они сразу закрываются статусом `skipped`. Раньше (после
      // KI-287) такой узел получал `null` во входах и падал сам, выглядя как
      // самостоятельно сломанный.
      // KI-337: тот же механизм используется подграфами `sub_workflow`.
      const blockedBy = await this.skipBlockedNodesAsync(
        runId,
        level,
        graph,
        predecessors,
        failedIds,
        skippedIds,
      );

      const activeLevel = level.filter((nodeId) => !blockedBy.has(nodeId));

      // Весь уровень пропущен — выполнять нечего, следующий уровень читает
      // `skippedIds` (транзитивность через предшественников).
      if (activeLevel.length === 0) {
        continue;
      }

      const results = await Promise.allSettled(
        activeLevel.map((nodeId) =>
          this.executeNodeAsync(runId, nodeId, graph, plan, subContext),
        ),
      );

      // KI-287: падения фиксируются по каждому уровню отдельно — цикл по
      // `plan.levels` НЕ прерывается. Узлы следующих уровней, не зависящие от
      // упавших, обязаны выполниться (RULES 4.16), поэтому уровень закрывается
      // частично, а не «роняет» остаток плана.
      const levelFailures: Array<{ nodeId: string; error: string; reason: unknown }> = [];

      results.forEach((result, index) => {
        const nodeId = activeLevel[index];

        if (result.status === 'fulfilled') {
          // В `outputs` попадают только успешно завершившиеся узлы: у упавших
          // выхода нет, и зависимые читают `null` (KI-046 не переиспользует
          // failed-строку, `collectInputsAsync` ищет только `completed`).
          outputs[nodeId] = result.value;

          return;
        }

        // KI-288: упавший узел блокирует своих потомков — на следующих уровнях
        // они получат `skipped`, а не «запустятся с null-входами и упадут сами».
        failedIds.add(nodeId);

        levelFailures.push({
          nodeId,
          error: toMessage(result.reason),
          reason: result.reason,
        });
      });

      failures.push(...levelFailures);

      if (levelFailures.length > 0 || blockedBy.size > 0) {
        this.logger.warn(
          `Запуск ${runId}: на уровне ${levelIndex} упало узлов=${levelFailures.length},` +
            ` пропущено=${blockedBy.size}` +
            (levelFailures.length > 0
              ? ` (первый: ${levelFailures[0].nodeId} — ${levelFailures[0].error})`
              : '') +
            '; независимые узлы следующих уровней продолжают выполняться (KI-287)',
        );
      }
    }

    const failed = failures[0] ?? null;
    const executedNodes = Object.keys(outputs).length;
    const status = failed === null ? 'completed' : 'failed';

    await this.finishRunAsync(runId, status, outputs, failed?.error ?? null);
    
    // KI-247: раньше было «узлов=${executedNodes}» — при падении первого
    // узла счётчик = 0, и лог «узлов=0» путал (узел-то выполнялся).
    // KI-287: после отказа от `break` падений может быть несколько (по одному
    // на узел), поэтому в логе — реальное число, а не 0/1.
     this.logger.log(
      `Запуск ${runId} завершён: status=${status},`
        + ` узлов выполнено=${executedNodes},`
        + ` провалено=${failures.length},`
        + ` пропущено=${skippedIds.size}`
        + (failed ? `, первая ошибка: ${failed.error}` : ''),
    );

    if (failed) {
      // KI-036: запуск уже закрыт 'failed' в БД и событие опубликовано, но
      // исключение бросаем осознанно — так BullMQ видит провал job'а и
      // применяет attempts/backoff (KI-016). Повторную доставку терминального
      // запуска RunsProcessor пропускает (guard KI-023), поэтому граф не
      // выполняется дважды и LLM не вызывается повторно; на случай, когда
      // повтор всё же произойдёт, node_runs идемпотентен (KI-031).
      throw failed.reason instanceof Error
        ? failed.reason
        : new Error(`Запуск ${runId} упал: ${failed.error}`);
    }

    return {
      status,
      executedNodes,
      failedNodeId: null,
      error: null,
      outputs,
    };
  }

  /**
   * Строит обратный граф зависимостей плана: «узел → его предшественники».
   *
   * Источник — `executionMap.dependents` (прямые рёбра «источник → потомок»),
   * а не `executionMap.inputs`: ключи входов сворачиваются в один
   * нормализованный порт (KI-034/KI-035), поэтому `inputs` может не содержать
   * всех предшественников узла. `dependents` содержит все исходящие связи.
   *
   * @param plan - план выполнения графа
   * @returns карта «id узла → id его предшественников» (пустой массив у корней)
   */
  private buildPredecessorMap(plan: ExecutionPlanDto): Map<string, string[]> {
    const predecessors = new Map<string, string[]>();

    for (const nodeId of Object.keys(plan.executionMap)) {
      predecessors.set(nodeId, []);
    }

    for (const [sourceId, nodePlan] of Object.entries(plan.executionMap)) {
      for (const dependentId of nodePlan.dependents) {
        predecessors.get(dependentId)?.push(sourceId);
      }
    }

    return predecessors;
  }

  /**
   * Ищет узлы уровня, которые нельзя выполнять: их предшественник упал или уже
   * пропущен (KI-288).
   *
   * Все предшественники узла лежат на строго более ранних уровнях (свойство
   * уровней Кана), поэтому к моменту обработки уровня множества заполнены
   * полностью — и пропуск получается транзитивным без отдельного обхода.
   *
   * @param level - узлы текущего уровня плана
   * @param predecessors - карта «узел → его предшественники»
   * @param failedIds - `id` упавших узлов
   * @param skippedIds - `id` узлов, уже пропущенных из-за упавших предшественников
   * @returns карта «id пропускаемого узла → id предшественника, из-за которого он пропущен»
   */
  private findBlockedByPredecessor(
    level: readonly string[],
    predecessors: ReadonlyMap<string, readonly string[]>,
    failedIds: ReadonlySet<string>,
    skippedIds: ReadonlySet<string>,
  ): Map<string, string> {
    const blocked = new Map<string, string>();

    for (const nodeId of level) {
      const blockingPredecessor = (predecessors.get(nodeId) ?? []).find(
        (predecessorId) =>
          failedIds.has(predecessorId) || skippedIds.has(predecessorId),
      );

      if (blockingPredecessor !== undefined) {
        blocked.set(nodeId, blockingPredecessor);
      }
    }

    return blocked;
  }

  /**
   * Закрывает статусом `skipped` узлы уровня, у которых упал или уже пропущен
   * предшественник (KI-288, KI-337).
   *
   * Общий механизм корневого графа и подграфов `sub_workflow`: уровни в обоих
   * случаях строит один и тот же `EngineService`, а карта предшественников — из
   * `executionMap.dependents`. Отличие только в графе: у подграфа id узлов
   * префиксованы (`sub_<nodeId>__`, DESIGN v0.8 § 5.3), поэтому строка
   * `node_runs` пропущенного узла подграфа изолирована от строк родителя.
   *
   * `skippedIds` пополняется синхронно, до записей в БД: следующий уровень
   * увидит пропуски независимо от порядка записей (транзитивность). Сами записи
   * независимы друг от друга и выполняются параллельно (RULES 4.17). Сбой записи
   * или публикации не роняет запуск — он только логируется (RULES 4.16/4.18).
   *
   * @param runId - uuid запуска
   * @param level - узлы текущего уровня плана
   * @param graph - граф, которому принадлежат узлы уровня (корневой или подграф)
   * @param predecessors - карта «узел → его предшественники»
   * @param failedIds - `id` упавших узлов
   * @param skippedIds - `id` пропущенных узлов (пополняется здесь)
   * @returns карта «id пропущенного узла → id предшественника, из-за которого он пропущен»
   */
  private async skipBlockedNodesAsync(
    runId: string,
    level: readonly string[],
    graph: GraphDto,
    predecessors: ReadonlyMap<string, readonly string[]>,
    failedIds: ReadonlySet<string>,
    skippedIds: Set<string>,
  ): Promise<Map<string, string>> {
    const blockedBy = this.findBlockedByPredecessor(
      level,
      predecessors,
      failedIds,
      skippedIds,
    );

    const blockedToSkip: Array<{ node: NodeDto; predecessorId: string }> = [];

    for (const [nodeId, predecessorId] of blockedBy) {
      skippedIds.add(nodeId);

      const skippedNode = graph.nodes.find((candidate) => candidate.id === nodeId);

      if (skippedNode) {
        blockedToSkip.push({ node: skippedNode, predecessorId });
      } else {
        // Недостижимо для узлов плана (план строится по этому же графу), но
        // без строки `node_runs` узел исчез бы из UI — фиксируем громко.
        this.logger.error(
          `Запуск ${runId}: узел ${nodeId} пропущен, но отсутствует в графе`,
        );
      }
    }

    await Promise.all(
      blockedToSkip.map(({ node, predecessorId }) =>
        this.markNodeSkippedAsync(runId, node, predecessorId),
      ),
    );

    return blockedBy;
  }

  /**
   * Ищет завершённую строку `node_runs` с теми же входами (KI-046).
   *
   * Переиспользовать результат можно только если узел уже успешно завершился и
   * его входы не изменились: тогда повторный вызов узла (в том числе платный
   * вызов LLM-провайдера) не нужен. Сравнение — `node:util.isDeepStrictEqual`.
   *
   * Замечание по стоимости: `inputs` лежат в JSONB, поэтому сравнение
   * пропорционально их размеру. Для типичных графов (примитивы и небольшие
   * объекты) это дёшево; при мегабайтных входах стоит перейти на хэш.
   *
   * @param runId - uuid запуска
   * @param nodeId - `id` узла в графе
   * @param inputs - входы, собранные для текущей попытки
   * @returns сохранённые outputs, если узел можно не выполнять, иначе `null`
   */
  private async findReusableNodeRunAsync(
    runId: string,
    nodeId: string,
    inputs: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const [previous] = await this.db
      .select({
        status: nodeRuns.status,
        inputs: nodeRuns.inputs,
        outputs: nodeRuns.outputs,
      })
      .from(nodeRuns)
      .where(and(eq(nodeRuns.runId, runId), eq(nodeRuns.nodeId, nodeId)))
      .limit(1);

    if (!previous || previous.status !== 'completed') {
      return null;
    }

    // `inputs` в БД nullable: отсутствие значения трактуем как пустой словарь.
    if (!isDeepStrictEqual(previous.inputs ?? {}, inputs)) {
      return null;
    }

    return previous.outputs ?? {};
  }

  /**
   * Выполняет один узел: пишет `node_runs`, публикует события, обновляет статус.
   *
   * Порядок работы:
   * 1. собрать входы узла;
   * 2. **KI-046**: если узел уже успешно завершился в предыдущей попытке запуска
   *    и его входы не изменились — переиспользовать сохранённые outputs, не
   *    вызывая узел (для LLM это экономит платные вызовы провайдера);
   * 3. иначе — UPSERT строки `node_runs` (идемпотентно по `run_id`+`node_id`,
   *    KI-031), выполнение узла и закрытие статуса.
   *
   * UPSERT сбрасывает состояние предыдущей попытки целиком — `status`, `inputs`,
   * `error`, `logs`, `outputs`, `duration_ms`, `started_at`, `finished_at`
   * (KI-047): пока новая попытка не закрылась, строка не показывает результат
   * и ошибку прошлой.
   *
   * «Временные» ошибки провайдера (KI-036) повторяются до
   * {@link NODE_MAX_ATTEMPTS} раз с экспоненциальной задержкой; каждая неудачная
   * попытка попадает в `node_runs.logs`, а `duration_ms` считается от первой
   * попытки. Любой сбой (включая падение публикации события) переводит строку в
   * `failed` — записи не остаются «висящими» в `running`, а исходная ошибка
   * пробрасывается наружу без подмены (RULES 1.7).
   *
   * @param runId - uuid запуска
   * @param nodeId - `id` узла в графе
   * @param graph - граф запуска
   * @param plan - план выполнения графа
   * @param subContext - контекст под-воркфлоу (R6.7): владелец, стек, глубина
   * @returns выходы узла (свежие либо переиспользованные)
   * @throws Error если узел отсутствует в графе, исчерпал попытки или не удалось записать статус
   */
  private async executeNodeAsync(
    runId: string,
    nodeId: string,
    graph: GraphDto,
    plan: ExecutionPlanDto,
    subContext: SubWorkflowContext,
  ): Promise<Record<string, unknown>> {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      throw new Error(`Узел ${nodeId} не найден в графе`);
    }

    const inputs = await this.collectInputsAsync(runId, nodeId, plan);

    // KI-046: узел, успешно завершившийся в предыдущей попытке запуска с теми
    // же входами, не выполняется повторно — берём сохранённые outputs. Для
    // LLM-узлов это экономит платные вызовы провайдера при job-level retry.
    const reusable = await this.findReusableNodeRunAsync(runId, nodeId, inputs);

    if (reusable !== null) {
      this.logger.log(
        `Узел ${nodeId} запуска ${runId}: переиспользован результат предыдущей ` +
          'попытки (KI-046)',
      );

      return reusable;
    }

    // KI-031: идемпотентный upsert по (run_id, node_id) — повторный прогон
    // графа (job-level retry после падения worker'а) обновляет ту же строку
    // истории, а не плодит дубли.
    // KI-047: сбрасываем состояние предыдущей попытки целиком (включая outputs
    // и duration_ms), чтобы «running» не показывал результат прошлого прогона.
    const [nodeRun] = await this.db
      .insert(nodeRuns)
      .values({
        runId,
        nodeId,
        nodeType: node.type,
        status: 'running',
        inputs,
        logs: [],
        startedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [nodeRuns.runId, nodeRuns.nodeId],
        set: {
          status: 'running',
          inputs,
          error: null,
          logs: [],
          outputs: null,
          durationMs: null,
          // KI-038: метрики прошлой попытки тоже не должны «прилипать».
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          costRub: null,
          startedAt: new Date(),
          finishedAt: null,
        },
      })
      .returning({ id: nodeRuns.id });

    const startedAt = Date.now();
    const logs: string[] = [];
    let failure: unknown = null;

    try {
      await this.runEvents.publishAsync(runId, {
        type: 'node_started',
        runId,
        nodeId,
        nodeType: node.type,
        startedAt: new Date().toISOString(),
      });

      for (let attempt = 1; attempt <= NODE_MAX_ATTEMPTS; attempt += 1) {
        try {
          const step = await this.runNodeAsync(node, inputs, runId, subContext);
          const durationMs = Date.now() - startedAt;

          // R7.4b: агент отдаёт шаги цикла — они дописываются к логам узла
          // до UPDATE, поэтому попадают и в снимок, и в событие node_completed.
          if (step.logs !== undefined) {
            logs.push(...step.logs);
          }

          await this.db
            .update(nodeRuns)
            .set({
              status: 'completed',
              outputs: step.outputs,
              durationMs,
              logs,
              // KI-038: метрики провайдера раздельно по валютам. У LLM-узла
              // заполняется cost_usd, у media-узла — cost_rub, у чистого
              // преобразования обе колонки остаются NULL (RULES 4.23).
              tokensIn: step.kind === 'llm' ? step.metrics.inputTokens : null,
              tokensOut: step.kind === 'llm' ? step.metrics.outputTokens : null,
              costUsd:
                step.kind === 'llm' ? toNumericString(step.metrics.costUsd) : null,
              costRub:
                step.kind === 'media' ? toNumericString(step.metrics.costRub) : null,
              finishedAt: new Date(),
            })
            .where(eq(nodeRuns.id, nodeRun.id));

          await this.runEvents.publishAsync(runId, {
            type: 'node_completed',
            runId,
            nodeId,
            outputs: step.outputs,
            durationMs,
            // KI-075: метрики кладём и в событие — панель показывает стоимость
            // сразу, а не только после F5 (из snapshot). Те же значения, что
            // записаны в node_runs выше (RULES 4.23: раздельно по валютам).
            costRub:
              step.kind === 'media' ? toNumericString(step.metrics.costRub) : null,
            tokensIn: step.kind === 'llm' ? step.metrics.inputTokens : null,
            tokensOut: step.kind === 'llm' ? step.metrics.outputTokens : null,
            costUsd:
              step.kind === 'llm' ? toNumericString(step.metrics.costUsd) : null,
            logs,
            finishedAt: new Date().toISOString(),
          });

          return step.outputs;
        } catch (error: unknown) {
          failure = error;

          // KI-036: повторяем только «временные» ошибки провайдера
          // (429/5xx/таймаут/сеть) и только пока не исчерпаны попытки.
          const retryable = error instanceof LlmProviderException && error.retryable;

          if (!retryable || attempt === NODE_MAX_ATTEMPTS) {
            break;
          }

          const delayMs = NODE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
          const logLine =
            `попытка ${attempt}/${NODE_MAX_ATTEMPTS} упала: ${toMessage(error)} — ` +
            `повтор через ${delayMs} мс`;

          logs.push(logLine);
          this.logger.warn(`Узел ${nodeId} запуска ${runId}: ${logLine}`);

          await sleep(delayMs);
        }
      }
    } catch (error: unknown) {
      // Сбой до цикла (публикация node_started) или иная инфраструктурная
      // ошибка: фиксируем как падение узла.
      failure = error;
    }

    const message = toMessage(failure);
    const durationMs = Date.now() - startedAt;

    this.logger.error(`Узел ${nodeId} запуска ${runId} упал: ${message}`);

    await this.markNodeFailedAsync(nodeRun.id, message, logs, durationMs);
    await this.publishNodeFailedAsync(runId, nodeId, message, logs);

    // Стек не гасим: ошибку ловит Promise.allSettled в executeAsync (RULES 1.7).
    throw failure instanceof Error ? failure : new Error(message);
  }

  /**
   * Собирает входы узла из outputs его предшественников.
   *
   * Источник — строка `node_runs` предшественника со статусом `completed`;
   * сам предшественник всегда из предыдущего уровня, который уже завершён.
   * Если предшественника нет или в его outputs отсутствует нужный порт,
   * вход получает `null` — узел всё равно выполняется, а не падает из-за
   * отсутствия данных.
   *
   * @param runId - uuid запуска
   * @param nodeId - `id` узла, для которого собираются входы
   * @param plan - план выполнения графа (даёт `executionMap`)
   * @returns словарь «входной порт → значение»
   */
  private async collectInputsAsync(
    runId: string,
    nodeId: string,
    plan: ExecutionPlanDto,
  ): Promise<Record<string, unknown>> {
    const refs = plan.executionMap[nodeId]?.inputs ?? {};

    // Ссылки независимы друг от друга — читаем параллельно (RULES 4.17).
    const entries = await Promise.all(
      Object.entries(refs).map(async ([inputHandle, ref]) => {
        const [source] = await this.db
          .select({ outputs: nodeRuns.outputs })
          .from(nodeRuns)
          .where(
            and(
              eq(nodeRuns.runId, runId),
              eq(nodeRuns.nodeId, ref.fromNode),
              eq(nodeRuns.status, 'completed'),
            ),
          )
          .limit(1);

        const sourceOutputs = source?.outputs;
        const value =
          isPlainRecord(sourceOutputs) && ref.fromPort in sourceOutputs
            ? (sourceOutputs[ref.fromPort] ?? null)
            : null;

        return [inputHandle, value] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  /**
   * Выполняет узел в зависимости от его типа.
   *
   * Метод асинхронный (RULES 1.4): `llm`-узел ходит в провайдера через
   * {@link LlmNodeExecutor} и возвращает метрики в USD, `image_generation`,
   * `image_tool` (R7.1) и media-генерация R7.2 (`video_generation`,
   * `audio_generation`, `music_generation`) — через {@link MediaNodeExecutor} с
   * метриками в рублях, `http` (R6.5.1) — сетевой запрос, `vector_upsert`,
   * `vector_query`, `memory_read`, `memory_write` (R7.4a) — через
   * {@link VectorStoreService} и провайдера эмбеддингов, `agent` (R7.4b) —
   * через {@link AgentService} (цикл LLM → tools → final), остальные (`text`,
   * `condition`, `output`, `compare`) — чистые преобразования без метрик.
   *
   * `runId` передаётся и LLM-исполнителю: там он нужен предохранителю по
   * стоимости (KI-048) — бюджет считается по запуску, а не по узлу.
   *
   * Ни один из новых типов R6.5.1 не помечается `retryable`: `http` может иметь
   * побочные эффекты (POST/PUT/DELETE), а `condition`/`output`/`compare`
   * детерминированы — повтор не изменит результат (KI-041).
   *
   * @param node - узел графа
   * @param inputs - нормализованные входы узла (KI-034: ключ `prompt`/`text`)
   * @param runId - id запуска (нужен media-узлам для ключа идемпотентности и
   *   всем платным узлам — для проверки бюджета, KI-048)
   * @param subContext - контекст под-воркфлоу (R6.7)
   * @returns выходы узла и метрики вызова (`null` для чистых преобразований)
   * @throws UnsupportedNodeTypeException если тип узла неизвестен
   * @throws NodeDataValidationException если `data` узла не прошли Zod-схему
   * @throws SubWorkflowRecursionException при циклической ссылке на workflow
   * @throws SubWorkflowDepthException при превышении глубины вложенности
   * @throws NotFoundException если подграф не найден или чужой
   * @throws LlmProviderException если вызов LLM-провайдера упал
   * @throws MediaProviderException если генерация media упала
   * @throws BudgetExceededException если бюджет запуска исчерпан (KI-048)
   */
  private async runNodeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
    subContext: SubWorkflowContext,
  ): Promise<NodeStepResult> {
    switch (node.type) {
      case 'text':
        return { kind: 'plain', outputs: executeTextNode(node), metrics: null };
      case 'sub_workflow': {
        // R6.7 (KI-200): узел не преобразует входы, а выполняет другой граф
        // как часть текущего запуска. Метрик у него нет — стоимости валют
        // живут на строках узлов подграфа (cost_usd/cost_rub).
        const outputs = await this.executeSubWorkflowGraphAsync(node, runId, subContext);

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'http': {
        const outputs = await executeHttpNode(node.data, inputs);

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'condition': {
        const outputs = await executeConditionNode(
          node.data,
          inputs,
          this.sandboxRunner,
        );

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'output': {
        const outputs = executeOutputNode(node.data, inputs);

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'compare': {
        const outputs = executeCompareNode(node.data, inputs);

        return { kind: 'plain', outputs, metrics: null };
      }
      // R7.4a (KI-128, DESIGN v0.9 § 3.4): vector/memory-узлы. Контекст
      // создаётся на узел: workflow_id — из строки запуска, провайдер
      // эмбеддингов резолвится лениво (в графе может не быть vector-узлов, и
      // тогда реестр embeddings вообще не нужен).
      case 'vector_upsert': {
        const vectorContext = await this.createVectorMemoryContextAsync(runId);
        const outputs = await executeVectorUpsertNodeAsync(
          node.data,
          inputs,
          vectorContext,
        );

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'vector_query': {
        const vectorContext = await this.createVectorMemoryContextAsync(runId);
        const outputs = await executeVectorQueryNodeAsync(
          node.data,
          inputs,
          vectorContext,
        );

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'memory_read': {
        const vectorContext = await this.createVectorMemoryContextAsync(runId);
        const outputs = await executeMemoryReadNodeAsync(node.data, inputs, vectorContext);

        return { kind: 'plain', outputs, metrics: null };
      }
      case 'memory_write': {
        const vectorContext = await this.createVectorMemoryContextAsync(runId);
        const outputs = await executeMemoryWriteNodeAsync(node.data, inputs, vectorContext);

        return { kind: 'plain', outputs, metrics: null };
      }
      // R7.4b (DESIGN v0.9 § 3.4): агент. Сам цикл живёт в AgentService
      // (DI: LLM, эмбеддинги, хранилище, песочница); исполнитель узла только
      // валидирует `data` и раскладывает результат по выходам. Шаги цикла
      // уходят и в `outputs.steps` (timeline в панели), и в `node_runs.logs`
      // JSON-строками — по одной на шаг.
      case 'agent': {
        const { outputs, steps } = await executeAgentNodeAsync(
          node,
          inputs,
          runId,
          this.agentService,
        );

        return {
          kind: 'plain',
          outputs,
          metrics: null,
          logs: steps.map((step) => JSON.stringify(step)),
        };
      }
      case 'llm': {
        const result = await this.llmExecutor.executeAsync(node, inputs, runId);

        return {
          kind: 'llm',
          outputs: result.outputs,
          metrics: result.metrics,
        };
      }
      case 'image_generation': {
        const result = await this.mediaExecutor.executeAsync(node, inputs, runId);

        return {
          kind: 'media',
          outputs: result.outputs,
          metrics: result.metrics,
        };
      }
      // R7.1 (KI-196): media-инструмент (upscale, удаление фона, липсинк, ...).
      // Метрики — в рублях, как у генерации: тот же провайдер CreativeLab.
      case 'image_tool': {
        const result = await this.mediaExecutor.executeToolAsync(node, inputs, runId);

        return {
          kind: 'media',
          outputs: result.outputs,
          metrics: result.metrics,
        };
      }
      // R7.2 (KI-361, DESIGN v0.9 § 3.2): media-генерация video/audio/music.
      // Отдельные методы исполнителя (а не один с типом-параметром) — потому
      // что у каждого узла своя Zod-схема `data` и своё текстовое поле.
      // Выходы те же, что у `image_generation`: `{ mediaUrl, mediaType, taskId }`.
      case 'video_generation': {
        const result = await this.mediaExecutor.executeVideoAsync(node, inputs, runId);

        return {
          kind: 'media',
          outputs: result.outputs,
          metrics: result.metrics,
        };
      }
      case 'audio_generation': {
        const result = await this.mediaExecutor.executeAudioAsync(node, inputs, runId);

        return {
          kind: 'media',
          outputs: result.outputs,
          metrics: result.metrics,
        };
      }
      case 'music_generation': {
        const result = await this.mediaExecutor.executeMusicAsync(node, inputs, runId);

        return {
          kind: 'media',
          outputs: result.outputs,
          metrics: result.metrics,
        };
      }
      default:
        throw new UnsupportedNodeTypeException(node.type);
    }
  }

  /**
   * Собирает контекст vector/memory-узлов (R7.4a).
   *
   * `workflowId` читается из `workflow_runs`: у узла графа нет собственного
   * владельца данных, а коллекции и память изолированы по workflow. Провайдер
   * эмбеддингов резолвится **внутри** `embedAsync` — только когда узел реально
   * дошёл до векторизации (граф без vector-узлов не трогает реестр LLM).
   *
   * @param runId - uuid запуска
   * @returns контекст: workflow, хранилище и ленивый `embedAsync`
   * @throws Error если строка запуска не найдена
   */
  private async createVectorMemoryContextAsync(
    runId: string,
  ): Promise<VectorMemoryContext> {
    const workflowId = await this.vectorStore.findWorkflowIdByRunAsync(runId);

    return {
      workflowId,
      store: this.vectorStore,
      embedAsync: async (texts: string[], model: string): Promise<number[][]> => {
        const provider = await this.llmRegistry.resolveEmbeddingProviderAsync();

        return provider.embedAsync(texts, { model });
      },
    };
  }

  /**
   * Создаёт контекст под-воркфлоу для запуска (R6.7, KI-200).
   *
   * Владелец запуска читается из БД **только** если в графе есть узел
   * `sub_workflow`: для обычных графов лишний запрос не нужен. Если владельца
   * определить не удалось, контекст получает `rootUserId: null` — тогда любой
   * подграф будет отвергнут как чужой (404), а сам запуск не упадёт из-за
   * проблемы с правами на одном узле.
   *
   * @param runId - uuid запуска
   * @param graph - граф запуска
   * @returns контекст ветки: источник workflow, владелец, пустой стек, глубина 0
   */
  private async createSubWorkflowContextAsync(
    runId: string,
    graph: GraphDto,
  ): Promise<SubWorkflowContext> {
    const hasSubWorkflow = graph.nodes.some((node) => node.type === 'sub_workflow');

    return {
      lookup: this.workflowService,
      rootUserId: hasSubWorkflow ? await this.findRootUserIdAsync(runId) : null,
      visitedWorkflows: new Set<string>(),
      depth: 0,
    };
  }

  /**
   * Определяет владельца workflow, к которому относится запуск.
   *
   * `workflow_runs` не хранит владельца, поэтому он берётся у корневого
   * workflow одним join-запросом: подграф `sub_workflow` должен принадлежать
   * тому же пользователю, что и родительский граф (DESIGN v0.8 § 5).
   *
   * Сбой чтения не роняет запуск: возвращается `null`, и узлы `sub_workflow`
   * падают каждый сам (404) — остальной граф выполняется (RULES 4.16/4.18).
   *
   * @param runId - uuid запуска
   * @returns uuid владельца либо `null`, если строки нет или чтение не удалось
   */
  private async findRootUserIdAsync(runId: string): Promise<string | null> {
    try {
      const [row] = await this.db
        .select({ userId: workflows.userId })
        .from(workflowRuns)
        .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
        .where(eq(workflowRuns.id, runId))
        .limit(1);

      return row?.userId ?? null;
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось определить владельца запуска ${runId}: ${toMessage(error)}`,
      );

      return null;
    }
  }

  /**
   * Выполняет подграф узла `sub_workflow` в рамках родительского запуска.
   *
   * Подграф не копируется в родительский план и не выполняется «плоско»: его
   * узлы получают префикс id `sub_<nodeId>__` и проходят собственный план
   * уровней через тот же {@link executeNodeAsync} — с тем же `runId`, но с
   * контекстом ветки (`visitedWorkflows + workflowId`, `depth + 1`). Это даёт
   * полную рекурсию (вложенный `sub_workflow` внутри подграфа работает),
   * изоляцию строк `node_runs` и единый SSE-поток прогресса.
   *
   * Результат — плоский объект `outputs.result`, собранный из выходов
   * терминальных узлов подграфа (у которых нет исходящих связей). Так
   * зависимый узел родителя читает результат через порт `result` (см.
   * `NODE_PORT_CONTRACT.sub_workflow`), не зная внутренних id.
   *
   * **KI-337 (skip-семантика подграфа):** уровни подграфа обрабатываются так же,
   * как уровни корневого графа (KI-287/KI-288). Падение узла не прерывает обход:
   * независимые ветки подграфа доигрываются (RULES 4.16), потомки упавшего узла
   * получают `node_runs.status='skipped'` и событие `node_skipped` — с тем же
   * текстом («Пропущен: упал предшественник»), что и в корневом графе, только с
   * префиксованным id (`sub_<nodeId>__<originalId>`, DESIGN v0.8 § 5.3). До
   * KI-337 исключение бросалось на первом же падении, и непройденные узлы
   * подграфа не попадали в `node_runs` вовсе.
   *
   * Упавший подграф всё равно считается ошибкой узла `sub_workflow` (DESIGN
   * § 5.6): после обхода уровней наружу уходит ошибка **первого** падения, и
   * зависимые узлы родителя пропускаются уже механизмом корневого графа. То есть
   * подграф сам публикует `node_skipped` для своих узлов, но не «прощает»
   * падение — контракт родителя не меняется.
   *
   * @param node - узел `sub_workflow` родительского графа
   * @param runId - uuid запуска
   * @param subContext - контекст ветки родителя
   * @returns `{ result }` — выходы терминальных узлов подграфа
   * @throws NodeDataValidationException если `data` узла не проходят схему
   * @throws SubWorkflowRecursionException при циклической ссылке
   * @throws SubWorkflowDepthException при превышении глубины вложенности
   * @throws NotFoundException если подграф чужой или не найден
   * @throws BadRequestException если подграф нельзя выполнить (цикл внутри, только аннотации)
   * @throws Error если узел подграфа исчерпал попытки (первое падение подграфа)
   */
  private async executeSubWorkflowGraphAsync(
    node: NodeDto,
    runId: string,
    subContext: SubWorkflowContext,
  ): Promise<Record<string, unknown>> {
    const target = await executeSubWorkflowNode(node.data, subContext);

    // Пустой подграф — не ошибка: «выполнять нечего» так же легально, как
    // пустой корневой граф (KI-037). План для него строить незачем.
    if (target.subGraph.nodes.length === 0) {
      this.logger.warn(
        `Узел ${node.id}: подграф ${target.workflowId} пуст — результат пустой`,
      );

      return { result: {} };
    }

    // DESIGN § 5.5: расхождение со снимком версии — предупреждение, а не
    // отказ: иначе правка дочернего workflow делала бы родительский запуск
    // невозможным без ручной перенастройки ссылки.
    if (typeof node.data.version === 'number' && node.data.version !== target.version) {
      this.logger.warn(
        `Узел ${node.id}: подграф ${target.workflowId} изменился ` +
          `(снимок v${node.data.version}, в БД v${target.version}) — запуск продолжается`,
      );
    }

    const prefixed = prefixSubWorkflowGraph(target.subGraph, node.id);
    const subPlan = await this.engineService.buildExecutionPlanAsync(prefixed);

    // Копия стека на ветку: две ссылки на один workflow в разных ветках — не
    // цикл, а вот спуск внутрь уже посещённого — цикл.
    const branchContext: SubWorkflowContext = {
      ...subContext,
      visitedWorkflows: new Set([...subContext.visitedWorkflows, target.workflowId]),
      depth: subContext.depth + 1,
    };

    const outputs: Record<string, Record<string, unknown>> = {};

    // KI-337: внутри подграфа пропуск работает так же, как в корневом графе
    // (KI-288): `failedIds` — упавшие по-настоящему, `skippedIds` — не
    // запускавшиеся из-за упавшего (или уже пропущенного) предшественника.
    // До KI-337 первое падение узла подграфа бросало исключение сразу, и
    // остальные узлы подграфа вообще не получали строк `node_runs` —
    // асимметрия с корневым графом. Теперь подграф доигрывается целиком:
    // независимые узлы выполняются (KI-287), потомки упавшего — `skipped`.
    const failedIds = new Set<string>();
    const skippedIds = new Set<string>();
    const failures: Array<{ nodeId: string; error: string; reason: unknown }> = [];
    const predecessors = this.buildPredecessorMap(subPlan);

    for (const [levelIndex, level] of subPlan.levels.entries()) {
      // KI-337/KI-288: узлы подграфа с упавшим предшественником закрываются
      // `skipped` — с тем же текстом ошибки и тем же событием `node_skipped`,
      // что и в корневом графе (контракт UI не меняется).
      const blockedBy = await this.skipBlockedNodesAsync(
        runId,
        level,
        prefixed,
        predecessors,
        failedIds,
        skippedIds,
      );

      const activeLevel = level.filter((subNodeId) => !blockedBy.has(subNodeId));

      // Весь уровень пропущен — выполнять нечего, следующий уровень прочитает
      // `skippedIds` (транзитивность через предшественников).
      if (activeLevel.length === 0) {
        continue;
      }

      const results = await Promise.allSettled(
        activeLevel.map((subNodeId) =>
          this.executeNodeAsync(runId, subNodeId, prefixed, subPlan, branchContext),
        ),
      );

      // Падение не прерывает обход уровней подграфа (KI-287/KI-337): узлы того
      // же уровня уже отработали (`allSettled`, RULES 4.16), а независимые
      // ветки следующих уровней обязаны доиграться.
      const levelFailures: Array<{ nodeId: string; error: string; reason: unknown }> = [];

      results.forEach((result, index) => {
        const subNodeId = activeLevel[index];

        if (result.status === 'fulfilled') {
          outputs[subNodeId] = result.value;

          return;
        }

        // Упавший узел подграфа блокирует своих потомков (KI-337).
        failedIds.add(subNodeId);
        levelFailures.push({
          nodeId: subNodeId,
          error: toMessage(result.reason),
          reason: result.reason,
        });
      });

      failures.push(...levelFailures);

      if (levelFailures.length > 0 || blockedBy.size > 0) {
        this.logger.warn(
          `Узел ${node.id}: подграф ${target.workflowId}, уровень ${levelIndex}:` +
            ` упало узлов=${levelFailures.length}, пропущено=${blockedBy.size}` +
            (levelFailures.length > 0
              ? ` (первый: ${levelFailures[0].nodeId} — ${levelFailures[0].error})`
              : '') +
            '; независимые узлы подграфа продолжают выполняться (KI-337)',
        );
      }
    }

    // Подграф считается упавшим, если упал хотя бы один его узел: ошибка
    // поднимается наверх как ошибка узла `sub_workflow` (DESIGN § 5.6), и
    // зависимые узлы родителя получают `skipped` на его уровне. Но к этому
    // моменту все узлы подграфа уже получили строки `node_runs` — `completed`,
    // `failed` или `skipped` (KI-337), а не только те, что успели до падения.
    const failed = failures[0] ?? null;

    if (failed !== null) {
      this.logger.error(
        `Узел ${node.id} запуска ${runId}: подграф ${target.workflowId} упал — ` +
          `${failed.nodeId}: ${failed.error} (выполнено узлов=${Object.keys(outputs).length},` +
          ` пропущено=${skippedIds.size})`,
      );

      throw failed.reason instanceof Error
        ? failed.reason
        : new Error(
            `Узел ${node.id}: подграф ${target.workflowId} упал: ${failed.error}`,
          );
    }

    // Терминальные узлы (без исходящих связей) формируют результат узла.
    const result: Record<string, unknown> = {};

    for (const subNodeId of subPlan.order) {
      const dependents = subPlan.executionMap[subNodeId]?.dependents ?? [];

      if (dependents.length === 0) {
        Object.assign(result, outputs[subNodeId] ?? {});
      }
    }

    this.logger.log(
      `Узел ${node.id} запуска ${runId}: подграф ${target.workflowId} ` +
        `(${target.name}) выполнен, узлов=${Object.keys(outputs).length}`,
    );

    return { result };
  }

  /**
   * Переводит запуск в статус `running` в транзакции (RULES 4.22).
   *
   * Сбрасывает `error` и `finished_at` от предыдущей попытки (KI-040): при
   * job-level retry запуск переходит `failed` → `running`, и без сброса UI (R4)
   * видел бы «выполняется» вместе с ошибкой и временем завершения прошлого
   * прогона, а при повторном падении процесса они бы так и остались в строке.
   *
   * @param runId - uuid запуска
   * @returns промис без значения
   * @throws InternalServerErrorException если обновление не удалось
   */
  private async markRunRunningAsync(runId: string): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(workflowRuns)
          .set({
            status: 'running',
            startedAt: new Date(),
            error: null,
            finishedAt: null,
          })
          .where(eq(workflowRuns.id, runId));
      });
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        `Не удалось перевести запуск ${runId} в статус running: ${toMessage(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * Сохраняет итог запуска: статус, outputs, ошибку и время завершения.
   *
   * @param runId - uuid запуска
   * @param status - итоговый статус (`completed`/`failed`)
   * @param outputs - выходы завершившихся узлов
   * @param error - текст ошибки либо `null`
   * @returns промис без значения
   * @throws InternalServerErrorException если обновление не удалось
   */
  private async finishRunAsync(
    runId: string,
    status: 'completed' | 'failed',
    outputs: Record<string, Record<string, unknown>>,
    error: string | null,
  ): Promise<void> {
    try {
      await this.db
        .update(workflowRuns)
        .set({ status, outputs, error, finishedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
    } catch (dbError: unknown) {
      throw new InternalServerErrorException(
        `Не удалось сохранить итог запуска ${runId}: ${toMessage(dbError)}`,
        { cause: dbError },
      );
    }
  }

  /**
   * Закрывает запуск как `failed` «по возможности» (фаза планирования, KI-037).
   *
   * Пишет только статус в БД: событие `run_completed` публикует
   * {@link RunsProcessor} — он знает, будет ли ещё попытка (KI-060). Сбой самого
   * UPDATE только логируется: наружу должна уйти исходная ошибка планирования,
   * иначе причина потеряется (RULES 4.18).
   *
   * @param runId - uuid запуска
   * @param message - текст ошибки планирования
   * @param outputs - частичные выходы (для фазы планирования — пусто)
   * @returns промис без значения
   */
  private async failRunAsync(
    runId: string,
    message: string,
    outputs: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    try {
      await this.finishRunAsync(runId, 'failed', outputs, message);
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось пометить запуск ${runId} как failed: ${toMessage(error)}`,
      );
    }
  }

  /**
   * Помечает строку `node_runs` как `failed`.
   *
   * Сбой самого UPDATE только логируется: наружу должна уйти исходная ошибка
   * узла, иначе причина потеряется (RULES 4.18).
   *
   * @param nodeRunId - uuid строки `node_runs`
   * @param reason - текст ошибки узла
   * @param logs - накопленные записи о попытках (KI-036)
   * @param durationMs - суммарное время работы узла со всеми попытками
   * @returns промис без значения
   */
  private async markNodeFailedAsync(
    nodeRunId: string,
    reason: string,
    logs: string[],
    durationMs: number,
  ): Promise<void> {
    try {
      await this.db
        .update(nodeRuns)
        .set({ status: 'failed', error: reason, logs, durationMs, finishedAt: new Date() })
        .where(eq(nodeRuns.id, nodeRunId));
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось пометить узел ${nodeRunId} как failed: ${toMessage(error)}`,
      );
    }
  }

  /**
   * Публикует `node_failed` «по возможности».
   *
   * Сбой публикации не должен подменять исходную ошибку узла, поэтому он
   * только логируется.
   *
   * @param runId - uuid запуска
   * @param nodeId - `id` упавшего узла
   * @param message - текст ошибки узла
   * @param logs - строки диагностики (ретраи, KI-036)
   * @returns промис без значения
   */
  private async publishNodeFailedAsync(
    runId: string,
    nodeId: string,
    message: string,
    logs: string[],
  ): Promise<void> {
    try {
      await this.runEvents.publishAsync(runId, {
        type: 'node_failed',
        runId,
        nodeId,
        error: message,
        // KI-075: те же поля, что и в node_completed. Метрики провайдера на
        // падении неизвестны (в node_runs они NULL) — отправляем null,
        // чтобы фронтенд не отличал форму события от успешного.
        costRub: null,
        tokensIn: null,
        tokensOut: null,
        costUsd: null,
        logs,
        finishedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось опубликовать node_failed запуска ${runId}: ${toMessage(error)}`,
      );
    }
  }

  /**
   * Закрывает узел статусом `skipped` и публикует событие `node_skipped`
   * (KI-288, KI-337).
   *
   * Узел **не выполнялся**: строка `node_runs` нужна только для истории и UI,
   * чтобы пропуск отличался от самостоятельного падения. Запись идёт тем же
   * UPSERT по (`run_id`, `node_id`), что и у выполняемых узлов (KI-031): при
   * повторном прогоне графа строка обновляется, а не дублируется, и переход
   * «пропущен → выполнен» (когда упавший предшественник на ретрае отработал)
   * остаётся возможным.
   *
   * Сбой записи или публикации не роняет запуск (RULES 4.16/4.18): он только
   * логируется, а сам пропуск уже зафиксирован в `skippedIds` — потомки всё
   * равно будут пропущены.
   *
   * @param runId - uuid запуска
   * @param node - пропускаемый узел графа (нужен `nodeType` для строки истории);
   *   у подграфа id узла префиксован (`sub_<nodeId>__`, DESIGN v0.8 § 5.3)
   * @param predecessorId - `id` предшественника, из-за которого узел пропущен
   * @returns промис без значения
   */
  private async markNodeSkippedAsync(
    runId: string,
    node: NodeDto,
    predecessorId: string,
  ): Promise<void> {
    const now = new Date();
    // KI-336: колонка `node_runs.status` типизирована как `NodeRunStatus`
    // (статусы запуска + `skipped`), поэтому приведение типа не нужно.
    const skippedStatus: NodeRunStatus = 'skipped';

    this.logger.warn(
      `Узел ${node.id} запуска ${runId} пропущен: упал предшественник ` +
        `${predecessorId} (KI-288/KI-337)`,
    );

    try {
      await this.db
        .insert(nodeRuns)
        .values({
          runId,
          nodeId: node.id,
          nodeType: node.type,
          status: skippedStatus,
          // Входы не собирались: узел не выполнялся. Пустой словарь (как у
          // колонки по умолчанию) лучше `null` — `collectInputsAsync` и UI
          // работают с `inputs` как с объектом.
          inputs: {},
          outputs: null,
          error: NODE_SKIPPED_ERROR,
          logs: [],
          durationMs: 0,
          startedAt: now,
          finishedAt: now,
        })
        .onConflictDoUpdate({
          target: [nodeRuns.runId, nodeRuns.nodeId],
          set: {
            status: skippedStatus,
            inputs: {},
            outputs: null,
            error: NODE_SKIPPED_ERROR,
            logs: [],
            durationMs: 0,
            // KI-038: метрики прошлой попытки не должны «прилипать» к пропуску.
            tokensIn: null,
            tokensOut: null,
            costUsd: null,
            costRub: null,
            startedAt: now,
            finishedAt: now,
          },
        })
        // `returning` явно закрывает запрос: тот же приём, что и в
        // `executeNodeAsync` (KI-031), — Drizzle выполняет INSERT/UPDATE только
        // через `await` на терминальном вызове.
        .returning({ id: nodeRuns.id });
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось пометить узел ${node.id} запуска ${runId} как skipped: ` +
          toMessage(error),
      );
    }

    await this.publishNodeSkippedAsync(runId, node);
  }

  /**
   * Публикует `node_skipped` «по возможности».
   *
   * Сбой публикации не должен менять исход пропуска (он уже записан в БД),
   * поэтому он только логируется — как у `node_failed` (KI-024).
   *
   * @param runId - uuid запуска
   * @param node - пропущенный узел графа
   * @returns промис без значения
   */
  private async publishNodeSkippedAsync(runId: string, node: NodeDto): Promise<void> {
    try {
      await this.runEvents.publishAsync(runId, {
        type: 'node_skipped',
        runId,
        nodeId: node.id,
        nodeType: node.type,
        reason: NODE_SKIPPED_ERROR,
        skippedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось опубликовать node_skipped запуска ${runId}: ${toMessage(error)}`,
      );
    }
  }
}
