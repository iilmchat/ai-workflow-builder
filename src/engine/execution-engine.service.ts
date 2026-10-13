import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns, workflowRuns } from '../db/schema.js';
import { RunEventsService } from '../runs/run-events.service.js';
import { LlmNodeExecutor } from '../llm/llm-node-executor.service.js';
import type { GraphDto, NodeDto } from './dto/index.js';
import { EngineService, type ExecutionPlanDto } from './engine.service.js';
import {
  UnsupportedNodeTypeException,
  executeImageGenNodeStub,
  executeTextNode,
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
 * Проверяет, что значение из JSONB — обычный объект (а не массив/скаляр).
 *
 * @param value - значение типа `unknown`
 * @returns `true`, если значение можно читать как `Record<string, unknown>`
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
  ) {}

  /**
   * Выполняет граф workflow в рамках запуска.
   *
   * Уровни из плана выполняются последовательно, узлы внутри уровня —
   * параллельно (`Promise.allSettled`, RULES 4.16): падение одного узла не
   * роняет остальные узлы того же уровня. Уровни после первого падения не
   * запускаются: зависимый узел всё равно не сможет прочитать outputs
   * предшественника.
   *
   * В `workflow_runs.outputs` пишется словарь `nodeId` → outputs **всех**
   * успешно завершившихся узлов (а не только последнего уровня): так при
   * падении сохраняется частичный результат, а UI (R4) видит полную картину.
   *
   * @param runId - uuid запуска (строка в workflow_runs уже создана)
   * @param graph - граф из `workflow_runs.snapshot`
   * @returns итог выполнения: статус, число отработавших узлов, outputs
   * @throws InternalServerErrorException если не удалось обновить запись запуска в БД
   * @throws BadRequestException если граф неисполним (цикл, битые связи)
   */
  async executeAsync(runId: string, graph: GraphDto): Promise<ExecutionResult> {
    const plan = await this.engineService.buildExecutionPlanAsync(graph);

    await this.markRunRunningAsync(runId);
    await this.runEvents.publishAsync(runId, {
      type: 'run_started',
      runId,
      startedAt: new Date().toISOString(),
    });

    const outputs: Record<string, Record<string, unknown>> = {};
    const failures: Array<{ nodeId: string; error: string }> = [];

    for (const [levelIndex, level] of plan.levels.entries()) {
      const results = await Promise.allSettled(
        level.map((nodeId) => this.executeNodeAsync(runId, nodeId, graph, plan)),
      );

      results.forEach((result, index) => {
        const nodeId = level[index];

        if (result.status === 'fulfilled') {
          outputs[nodeId] = result.value;

          return;
        }

        // Фиксируем падение узла: уровни после первого падения не выполняются.
        failures.push({ nodeId, error: toMessage(result.reason) });
      });

      if (failures.length > 0) {
        this.logger.warn(
          `Запуск ${runId}: уровень ${levelIndex} прерван из-за узла ${failures[0].nodeId}`,
        );

        break;
      }
    }

    const failed = failures[0] ?? null;
    const executedNodes = Object.keys(outputs).length;
    const status = failed === null ? 'completed' : 'failed';

    await this.finishRunAsync(runId, status, outputs, failed?.error ?? null);
    await this.runEvents.publishAsync(runId, {
      type: 'run_completed',
      runId,
      status,
      finishedAt: new Date().toISOString(),
    });

    this.logger.log(
      `Запуск ${runId} завершён: status=${status}, узлов=${executedNodes}` +
        (failed ? `, ошибка: ${failed.error}` : ''),
    );

    return {
      status,
      executedNodes,
      failedNodeId: failed?.nodeId ?? null,
      error: failed?.error ?? null,
      outputs,
    };
  }

  /**
   * Выполняет один узел: пишет `node_runs`, публикует события, обновляет статус.
   *
   * Сначала создаётся строка `node_runs` со статусом `running`, затем
   * выполняется сам узел, затем статус закрывается. Любой сбой (включая
   * падение самой публикации события) переводит строку в `failed` — записи
   * не остаются «висящими» в `running`, а исходная ошибка пробрасывается
   * наружу без подмены (RULES 1.7).
   *
   * @param runId - uuid запуска
   * @param nodeId - `id` узла в графе
   * @param graph - граф запуска
   * @param plan - план выполнения графа
   * @returns выходы узла
   * @throws Error если узел отсутствует в графе, упал или не удалось записать статус
   */
  private async executeNodeAsync(
    runId: string,
    nodeId: string,
    graph: GraphDto,
    plan: ExecutionPlanDto,
  ): Promise<Record<string, unknown>> {
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);

    if (!node) {
      throw new Error(`Узел ${nodeId} не найден в графе`);
    }

    const inputs = await this.collectInputsAsync(runId, nodeId, plan);

    const [nodeRun] = await this.db
      .insert(nodeRuns)
      .values({
        runId,
        nodeId,
        nodeType: node.type,
        status: 'running',
        inputs,
        startedAt: new Date(),
      })
      .returning({ id: nodeRuns.id });

    const startedAt = Date.now();

    try {
      await this.runEvents.publishAsync(runId, {
        type: 'node_started',
        runId,
        nodeId,
        nodeType: node.type,
        startedAt: new Date().toISOString(),
      });

      const outputs = await this.runNodeAsync(node, inputs);
      const durationMs = Date.now() - startedAt;

      await this.db
        .update(nodeRuns)
        .set({ status: 'completed', outputs, durationMs, finishedAt: new Date() })
        .where(eq(nodeRuns.id, nodeRun.id));

      await this.runEvents.publishAsync(runId, {
        type: 'node_completed',
        runId,
        nodeId,
        outputs,
        durationMs,
        finishedAt: new Date().toISOString(),
      });

      return outputs;
    } catch (error: unknown) {
      const message = toMessage(error);

      this.logger.error(`Узел ${nodeId} запуска ${runId} упал: ${message}`);

      await this.markNodeFailedAsync(nodeRun.id, message);
      await this.publishNodeFailedAsync(runId, nodeId, message);

      // Стек не гасим: ошибку ловит Promise.allSettled в executeAsync (RULES 1.7).
      throw error;
    }
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
   * {@link LlmNodeExecutor}. `image_generation` пока заглушка (R4).
   *
   * @param node - узел графа
   * @param inputs - нормализованные входы узла (KI-034: ключ `prompt`/`text`)
   * @returns выходы узла
   * @throws UnsupportedNodeTypeException если тип узла неизвестен
   * @throws LlmProviderException если вызов LLM-провайдера упал
   */
  private async runNodeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    switch (node.type) {
      case 'text':
        return executeTextNode(node);
      case 'llm':
        return this.llmExecutor.executeAsync(node, inputs);
      case 'image_generation':
        return executeImageGenNodeStub(node);
      default:
        throw new UnsupportedNodeTypeException(node.type);
    }
  }

  /**
   * Переводит запуск в статус `running` в транзакции (RULES 4.22).
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
          .set({ status: 'running', startedAt: new Date() })
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
   * Помечает строку `node_runs` как `failed`.
   *
   * Сбой самого UPDATE только логируется: наружу должна уйти исходная ошибка
   * узла, иначе причина потеряется (RULES 4.18).
   *
   * @param nodeRunId - uuid строки `node_runs`
   * @param reason - текст ошибки узла
   * @returns промис без значения
   */
  private async markNodeFailedAsync(nodeRunId: string, reason: string): Promise<void> {
    try {
      await this.db
        .update(nodeRuns)
        .set({ status: 'failed', error: reason, finishedAt: new Date() })
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
   * @returns промис без значения
   */
  private async publishNodeFailedAsync(
    runId: string,
    nodeId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.runEvents.publishAsync(runId, {
        type: 'node_failed',
        runId,
        nodeId,
        error: message,
        finishedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось опубликовать node_failed запуска ${runId}: ${toMessage(error)}`,
      );
    }
  }
}
