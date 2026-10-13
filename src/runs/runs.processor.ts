import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns } from '../db/schema.js';
import { ExecuteRunJobSchema, type ExecuteRunJobDto } from './dto/index.js';
import { WORKFLOW_RUNS_QUEUE } from './runs.constants.js';

/**
 * Обработчик очереди {@link WORKFLOW_RUNS_QUEUE}.
 *
 * СКЕЛЕТ: реальный executor графа здесь отсутствует — он появится в R2
 * (`EngineService.buildExecutionPlanAsync()` + прогон узлов в `node_runs`).
 * Задача R1 — проверить сквозной путь HTTP → Postgres → BullMQ → worker →
 * Postgres, поэтому обработчик только логирует задание и закрывает запуск
 * статусом `completed`.
 *
 * `EngineService` сознательно НЕ импортируется: подключение executor'а — R2.
 */
@Processor(WORKFLOW_RUNS_QUEUE)
export class RunsProcessor extends WorkerHost {
  private readonly logger = new Logger(RunsProcessor.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {
    super();
  }

  /**
   * Обрабатывает задание на выполнение workflow.
   *
   * @param job - задание BullMQ с payload `{ runId }`
   * @returns промис без значения; результат виден в строке `workflow_runs`
   * @throws Error если payload задания невалиден или обновление статуса не удалось
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

    this.logger.log(`Processing run ${runId}`);

    try {
      await this.db
        .update(workflowRuns)
        .set({ status: 'completed', finishedAt: new Date() })
        .where(eq(workflowRuns.id, runId));

      this.logger.log(`Запуск ${runId} помечен как completed (скелет R1, executor — R2)`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Не удалось обновить статус запуска ${runId}: ${message}`);

      // Стек не гасим: job должен уйти в failed и быть виден в мониторинге (RULES 1.7).
      throw new Error(`Не удалось обновить статус запуска ${runId}: ${message}`, {
        cause: error,
      });
    }
  }
}
