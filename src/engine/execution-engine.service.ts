import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns, workflowRuns } from '../db/schema.js';
import { RunEventsService } from '../runs/run-events.service.js';
import { LlmNodeExecutor, type LlmNodeMetrics } from '../llm/llm-node-executor.service.js';
import { LlmProviderException } from '../llm/llm-provider.interface.js';
import {
  MediaNodeExecutor,
  type MediaNodeMetrics,
} from '../media/media-node-executor.service.js';
import type { GraphDto, NodeDto } from './dto/index.js';
import { EngineService, type ExecutionPlanDto } from './engine.service.js';
import {
  UnsupportedNodeTypeException,
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
type NodeStepResult =
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
        failures.push({
          nodeId,
          error: toMessage(result.reason),
          reason: result.reason,
        });
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
    
    // KI-247: раньше было «узлов=${executedNodes}» — при падении первого
    // узла счётчик = 0, и лог «узлов=0» путал (узел-то выполнялся).
    // Движок прерывается на первом failed — `провалено` ∈ {0, 1}.
     this.logger.log(
      `Запуск ${runId} завершён: status=${status},`
        + ` узлов выполнено=${executedNodes},`
        + ` провалено=${failed ? 1 : 0}`
        + (failed ? `, ошибка: ${failed.error}` : ''),
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
   * @returns выходы узла (свежие либо переиспользованные)
   * @throws Error если узел отсутствует в графе, исчерпал попытки или не удалось записать статус
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
          const step = await this.runNodeAsync(node, inputs, runId);
          const durationMs = Date.now() - startedAt;

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
   * {@link LlmNodeExecutor} и возвращает метрики в USD, `image_generation` —
   * через {@link MediaNodeExecutor} с метриками в рублях, `text` — чистое
   * преобразование без метрик.
   *
   * @param node - узел графа
   * @param inputs - нормализованные входы узла (KI-034: ключ `prompt`/`text`)
   * @param runId - id запуска (нужен media-узлу для ключа идемпотентности)
   * @returns выходы узла и метрики вызова (`null` для чистых преобразований)
   * @throws UnsupportedNodeTypeException если тип узла неизвестен
   * @throws LlmProviderException если вызов LLM-провайдера упал
   * @throws MediaProviderException если генерация media упала
   */
  private async runNodeAsync(
    node: NodeDto,
    inputs: Record<string, unknown>,
    runId: string,
  ): Promise<NodeStepResult> {
    switch (node.type) {
      case 'text':
        return { kind: 'plain', outputs: executeTextNode(node), metrics: null };
      case 'llm': {
        const result = await this.llmExecutor.executeAsync(node, inputs);

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
      default:
        throw new UnsupportedNodeTypeException(node.type);
    }
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
}
