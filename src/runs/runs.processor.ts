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
import { RUN_STALE_THRESHOLD_MS, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';

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
  /** Время старта выполнения — основа lease-проверки «зависшего» запуска (KI-023). */
  startedAt: Date | null;
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
   * Идемпотентность построена на lease-логике (KI-023) и job-level retry (KI-040):
   * - `pending` — штатный первый запуск задания;
   * - `running` с `started_at` свежее `RUN_STALE_THRESHOLD_MS` — запуск живой
   *   (его выполняет этот или другой worker), задание пропускается;
   * - `running` с истёкшим `started_at` — worker умер и BullMQ перезапустил
   *   задание, поэтому граф выполняется заново;
   * - `running` без `started_at` — судить о живости нельзя, поэтому
   *   консервативно пропускаем;
   * - `failed` + `job.attemptsMade > 0` — предыдущая попытка упала, а это retry
   *   от BullMQ (`attempts`/backoff, KI-016): граф переигрывается, идемпотентность
   *   обеспечена UPSERT `node_runs` по (`run_id`, `node_id`) (KI-031) и
   *   перезаписью `workflow_runs` в executor'е;
   * - `completed` + `job.attemptsMade > 0` — запуск терминален, повтор не
   *   выполняется: успешный job BullMQ не ретраит, переигрывать нечего;
   * - `running` + `job.attemptsMade > 0` — живой lease важнее повтора: пока
   *   worker не умер, повторную доставку не обрабатываем, иначе получаем два
   *   параллельных прогона одного графа;
   * - `cancelled` — запуск закрыт пользователем, повтор не выполняется.
   *
   * Статус зависшего запуска намеренно НЕ сбрасывается в `pending`: executor
   * сам переведёт запуск в `running` со свежим `started_at`, а лишний UPDATE
   * создал бы окно, в котором запуск выглядит ожидающим задания.
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

    const isStale =
      run.status === 'running' &&
      run.startedAt !== null &&
      Date.now() - run.startedAt.getTime() > RUN_STALE_THRESHOLD_MS;

    // KI-040: повторная доставка от BullMQ (`attemptsMade > 0`) переигрывает
    // только заведомо провалившийся запуск. `completed`/`cancelled` терминальны,
    // а у `running` приоритет у живой аренды.
    const isJobRetry = job.attemptsMade > 0 && run.status === 'failed';

    if (run.status !== 'pending' && !isStale && !isJobRetry) {
      this.logger.warn(
        `Запуск ${runId} в статусе ${run.status} ` +
          `(started_at=${run.startedAt?.toISOString() ?? 'null'}, ` +
          `attemptsMade=${job.attemptsMade}) — задание пропущено`,
      );

      return;
    }

    if (isJobRetry) {
      this.logger.log(
        `Запуск ${runId}: job-level retry ${job.attemptsMade}/${job.opts.attempts} — ` +
          'переигрываем граф (KI-040)',
      );
    }

    if (isStale) {
      this.logger.warn(
        `Запуск ${runId} завис в running дольше ${RUN_STALE_THRESHOLD_MS} мс — ` +
          'выполняем граф заново (KI-023)',
      );
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
   * Достаёт статус, время старта и снимок графа запуска.
   *
   * `startedAt` нужен для lease-проверки «зависшего» запуска (KI-023).
   *
   * @param runId - uuid запуска
   * @returns данные запуска либо `null`, если строки нет
   */
  private async findRunAsync(runId: string): Promise<RunForExecution | null> {
    const [run] = await this.db
      .select({
        status: workflowRuns.status,
        snapshot: workflowRuns.snapshot,
        startedAt: workflowRuns.startedAt,
      })
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
