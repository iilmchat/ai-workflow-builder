import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns, type RunStatus } from '../db/schema.js';
import { GraphSnapshotSchema, type GraphSnapshotDto } from '../engine/dto/index.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { ExecuteRunJobSchema, type ExecuteRunJobDto } from './dto/index.js';
import { WORKFLOW_RUNS_QUEUE } from './runs.constants.js';

/**
 * Приводит неизвестную ошибку к тексту для логов и колонки `error`.
 *
 * @param error - значение из `catch` (тип `unknown`)
 * @returns текст ошибки
 */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Данные запуска, нужные обработчику для старта выполнения. */
interface RunForExecution {
  status: RunStatus;
  snapshot: GraphSnapshotDto;
}

/**
 * Обработчик очереди {@link WORKFLOW_RUNS_QUEUE}.
 *
 * Достаёт снимок графа из `workflow_runs.snapshot`, валидирует его (данные из
 * JSONB — внешние, RULES 1.17) и передаёт выполнение
 * {@link ExecutionEngineService}. Итоговый статус и `run_completed` пишет сам
 * executor; здесь остаётся только логирование и проброс ошибки, чтобы BullMQ
 * сделал retry согласно `defaultJobOptions` (attempts: 3).
 */
@Processor(WORKFLOW_RUNS_QUEUE)
export class RunsProcessor extends WorkerHost {
  private readonly logger = new Logger(RunsProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly executionEngine: ExecutionEngineService,
  ) {
    super();
  }

  /**
   * Обрабатывает задание на выполнение workflow.
   *
   * Идемпотентность: повторное задание (ретрай BullMQ) для запуска, который
   * уже не в статусе `pending`, пропускается без выполнения графа.
   *
   * @param job - задание BullMQ с payload `{ runId }`
   * @returns промис без значения; итог виден в `workflow_runs`/`node_runs`
   * @throws Error если payload или snapshot невалидны, запуск не найден либо выполнение упало
   */
  async process(job: Job<ExecuteRunJobDto>): Promise<void> {
    const payload = ExecuteRunJobSchema.safeParse(job.data);

    if (!payload.success) {
      const details = z.prettifyError(payload.error);

      this.logger.error(`Некорректный payload задания ${job.id}: ${details}`);

      throw new Error(
        `Некорректный payload задания очереди ${WORKFLOW_RUNS_QUEUE}: ${details}`,
      );
    }

    const { runId } = payload.data;
    const run = await this.findRunAsync(runId);

    if (!run) {
      throw new Error(`Запуск ${runId} не найден`);
    }

    if (run.status !== 'pending') {
      this.logger.warn(
        `Запуск ${runId} уже в статусе ${run.status} — задание пропущено`,
      );

      return;
    }

    const snapshot = GraphSnapshotSchema.safeParse(run.snapshot);

    if (!snapshot.success) {
      const details = z.prettifyError(snapshot.error);

      this.logger.error(`Некорректный snapshot запуска ${runId}: ${details}`);
      await this.markRunFailedAsync(runId, `Некорректный snapshot запуска: ${details}`);

      throw new Error(`Некорректный snapshot запуска ${runId}: ${details}`);
    }

    this.logger.log(
      `Запуск ${runId}: старт выполнения (узлов: ${snapshot.data.nodes.length})`,
    );

    try {
      await this.executionEngine.executeAsync(runId, snapshot.data);
    } catch (error: unknown) {
      // Итог в БД и событие run_completed проставляет сам executor; здесь
      // только логируем и пробрасываем — стек не гасим, job уйдёт в retry.
      this.logger.error(`Запуск ${runId} упал: ${toMessage(error)}`);

      throw error;
    }
  }

  /**
   * Достаёт статус и снимок графа запуска.
   *
   * @param runId - uuid запуска
   * @returns данные запуска либо `null`, если строки нет
   */
  private async findRunAsync(runId: string): Promise<RunForExecution | null> {
    const [run] = await this.db
      .select({ status: workflowRuns.status, snapshot: workflowRuns.snapshot })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .limit(1);

    return run ?? null;
  }

  /**
   * Помечает запуск как `failed` (битый snapshot — выполнять нечего).
   *
   * @param runId - uuid запуска
   * @param reason - текст для колонки `error`
   * @returns промис без значения
   */
  private async markRunFailedAsync(runId: string, reason: string): Promise<void> {
    try {
      await this.db
        .update(workflowRuns)
        .set({ status: 'failed', error: reason, finishedAt: new Date() })
        .where(eq(workflowRuns.id, runId));
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось пометить запуск ${runId} как failed: ${toMessage(error)}`,
      );
    }
  }
}
