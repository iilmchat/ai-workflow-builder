import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns, type RunStatus } from '../db/schema.js';
import { GraphSnapshotSchema, type GraphSnapshotDto } from '../engine/dto/index.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import { ExecuteRunJobSchema, type ExecuteRunJobDto } from './dto/index.js';
import { RunEventsService } from './run-events.service.js';
import { WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import {
  RUN_STALE_THRESHOLD_MS,
  RUNS_INSTANCE_ID,
  WORKFLOW_RUNS_WORKER_OPTIONS,
} from './runs.worker-options.js';

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
  /** Время старта выполнения — fallback для строк без аренды (KI-023). */
  startedAt: Date | null;
  /** Срок аренды (v0.11 S9): `NULL` у строк, созданных до миграции 0013. */
  leaseExpiresAt: Date | null;
  /** Аренда истекла — worker, продлевавший её, умер (DESIGN § 3.3.1). */
  leaseExpired: boolean;
  /** Строка без аренды (`lease_expires_at IS NULL`) и старше порога — старый fallback. */
  legacyStale: boolean;
}

/**
 * Обработчик очереди {@link WORKFLOW_RUNS_QUEUE}.
 *
 * Достаёт снимок графа из `workflow_runs.snapshot`, валидирует его (данные из
 * JSONB — внешние, RULES 1.17) и передаёт выполнение
 * {@link ExecutionEngineService}.
 *
 * Событие `run_completed` публикует **здесь**, а не в executor'е (KI-060): только
 * процессор знает, пробросил ли executor исключение, а значит — будет ли BullMQ
 * делать retry. Это даёт явный признак финальности `final` вместо эвристики по
 * `attemptsMade`, которая ломалась на детерминированных провалах планирования
 * (KI-037): там исключения нет, retry не будет, а лимит попыток не исчерпан.
 *
 * Статус запуска в БД по-прежнему пишет executor (он владеет `workflow_runs`
 * и `node_runs`).
 *
 * Настройки воркера (`concurrency`, `lockDuration`, `maxStalledCount`) приходят
 * из {@link WORKFLOW_RUNS_WORKER_OPTIONS} — они разобраны из окружения в момент
 * загрузки модуля, потому что декоратор `@Processor` статичен и не может
 * инжектить `ConfigService` (KI-065). `concurrency > 1` снимает head-of-line
 * blocking: раньше один медленный запуск блокировал очередь целиком.
 */
@Processor(WORKFLOW_RUNS_QUEUE, WORKFLOW_RUNS_WORKER_OPTIONS)
export class RunsProcessor extends WorkerHost {
  private readonly logger = new Logger(RunsProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly executionEngine: ExecutionEngineService,
    private readonly runEvents: RunEventsService,
  ) {
    super();
  }

  /**
   * Обрабатывает задание на выполнение workflow.
   *
   * Идемпотентность построена на lease-логике (KI-023, v0.11 S9) и job-level
   * retry (KI-040):
   * - `pending` — штатный первый запуск задания;
   * - `running` с живой арендой (`lease_expires_at > now()`) — запуск живой
   *   (его выполняет этот или другой worker), задание пропускается;
   * - `running` с истёкшей арендой (`lease_expires_at <= now()`) — worker умер,
   *   BullMQ перезапустил задание, поэтому граф выполняется заново;
   * - `running` без аренды (`lease_expires_at IS NULL` — строки, созданные до
   *   миграции 0013) — прежний fallback по `started_at` + `RUN_STALE_THRESHOLD_MS`;
   * - `running` без `started_at` и без аренды — судить о живости нельзя, поэтому
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
   * **Изоляция инстансов (KI-387).** Если payload несёт `instanceId` и он не
   * совпадает с идентификатором текущего процесса, задание создано другим
   * backend-ом (dev/smoke/prod) на общем Redis: воркер его пропускает, чтобы не
   * выполнить чужой запуск и не списать деньги боевым ключом. Задание без
   * маркера считается «своим» — это совместимость с заданиями, поставленными до
   * введения проверки. Главный рубеж изоляции — префикс/БД Redis
   * (`BULLMQ_PREFIX`, `REDIS_QUEUE_DB`), маркер — второй рубеж на случай, когда
   * два инстанса всё же смотрят в одно пространство ключей.
   *
   * @param job - задание BullMQ с payload `{ runId, instanceId? }`
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

    const { runId, instanceId } = payload.data;

    // KI-387: задание чужого инстанса не выполняем и не трогаем его запуск в
    // БД — владелец задания сам доведёт запуск до финала в своём процессе.
    if (instanceId !== undefined && instanceId !== RUNS_INSTANCE_ID) {
      this.logger.warn(
        `Запуск ${runId}: задание создано инстансом ${instanceId}, ` +
          `текущий инстанс ${RUNS_INSTANCE_ID} — пропущено (KI-387)`,
      );

      return;
    }

    const run = await this.findRunAsync(runId);

    if (!run) {
      throw new Error(`Запуск ${runId} не найден`);
    }

    // v0.11 S9 (DESIGN § 3.3.1): «завис» — это истёкшая аренда, а не возраст
    // `started_at`. Heartbeat продлевает `lease_expires_at`, пока worker жив,
    // поэтому легитимно долгий запуск больше не переигрывается параллельно.
    // `legacyStale` сохраняет прежнее поведение для строк без аренды.
    const isStale =
      run.status === 'running' && (run.leaseExpired || run.legacyStale);

    // KI-040: повторная доставка от BullMQ (`attemptsMade > 0`) переигрывает
    // только заведомо провалившийся запуск. `completed`/`cancelled` терминальны,
    // а у `running` приоритет у живой аренды.
    const isJobRetry = job.attemptsMade > 0 && run.status === 'failed';

    if (run.status !== 'pending' && !isStale && !isJobRetry) {
      this.logger.warn(
        `Запуск ${runId} в статусе ${run.status} ` +
          `(lease_expires_at=${run.leaseExpiresAt?.toISOString() ?? 'null'}, ` +
          `started_at=${run.startedAt?.toISOString() ?? 'null'}, ` +
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
        `Запуск ${runId}: аренда истекла (lease_expires_at=` +
          `${run.leaseExpiresAt?.toISOString() ?? 'null'}, ` +
          `started_at=${run.startedAt?.toISOString() ?? 'null'}, ` +
          `fallback-порог ${RUN_STALE_THRESHOLD_MS} мс) — ` +
          'выполняем граф заново (KI-023, v0.11 S9)',
      );
    }

    const attemptsMade = job.attemptsMade;
    const attempts = job.opts.attempts ?? null;
    // Останется ли у BullMQ ещё одна попытка, если job пробросит исключение.
    // `attempts = null` — лимит не задан, а BullMQ без лимита не ретраит.
    const willRetry = attempts !== null && attemptsMade < attempts - 1;

    try {
      const snapshot = GraphSnapshotSchema.safeParse(run.snapshot);

      if (!snapshot.success) {
        const details = z.prettifyError(snapshot.error);

        this.logger.error(`Некорректный snapshot запуска ${runId}: ${details}`);
        await this.markRunFailedAsync(
          runId,
          `Некорректный snapshot запуска: ${details}`,
        );

        throw new Error(`Некорректный snapshot запуска ${runId}: ${details}`);
      }

      this.logger.log(
        `Запуск ${runId}: старт выполнения (узлов: ${snapshot.data.nodes.length})`,
      );

      const result = await this.executionEngine.executeAsync(runId, snapshot.data);

      // KI-060: исключение не проброшено — повторять запуск нечего (успех либо
      // детерминированный провал фазы планирования, KI-037), это финал.
      await this.publishRunCompletedAsync(runId, {
        status: result.status,
        attemptsMade,
        attempts,
        final: true,
      });
    } catch (error: unknown) {
      // Проброс исключения означает провал job'а: BullMQ сделает retry, если
      // попытки остались. Публикуем итог попытки и пробрасываем дальше — стек
      // не гасим (RULES 1.7).
      this.logger.error(`Запуск ${runId} упал: ${toMessage(error)}`);

      await this.publishRunCompletedAsync(runId, {
        status: 'failed',
        attemptsMade,
        attempts,
        final: !willRetry,
      });

      throw error;
    }
  }

  /**
   * Публикует событие завершения попытки запуска (KI-060).
   *
   * Сбой публикации не подменяет исходную ошибку выполнения и не превращает
   * успешный запуск в упавший job (RULES 4.18): он только логируется. Клиент
   * в этом случае узнает о состоянии из `GET /runs/:id`.
   *
   * @param runId - uuid запуска
   * @param completion - статус попытки, номера попыток и признак финала
   * @returns промис без значения
   */
  private async publishRunCompletedAsync(
    runId: string,
    completion: {
      status: 'completed' | 'failed';
      attemptsMade: number;
      attempts: number | null;
      final: boolean;
    },
  ): Promise<void> {
    try {
      await this.runEvents.publishAsync(runId, {
        type: 'run_completed',
        runId,
        status: completion.status,
        attemptsMade: completion.attemptsMade,
        attempts: completion.attempts,
        final: completion.final,
        finishedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      this.logger.error(
        `Не удалось опубликовать run_completed запуска ${runId}: ${toMessage(error)}`,
      );
    }
  }

  /**
   * Достаёт статус, время старта, аренду и снимок графа запуска.
   *
   * `leaseExpired`/`legacyStale` вычисляются **по часам БД** (`now()`), как и
   * продление аренды в `RunLeaseService.renewAsync` (v0.11 S9, DESIGN § 3.3.1):
   * часы приложения и PostgreSQL могут расходиться, а решение «жив ли запуск»
   * должно быть единым для всех worker'ов.
   *
   * - `leaseExpired` — аренда есть и уже истекла: worker, продлевавший её, умер;
   * - `legacyStale` — аренды нет (`NULL`, строка до миграции 0013), поэтому
   *   работает прежний fallback по `started_at` + `RUN_STALE_THRESHOLD_MS`.
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
        leaseExpiresAt: workflowRuns.leaseExpiresAt,
        leaseExpired: sql<boolean>`
          ${workflowRuns.leaseExpiresAt} IS NOT NULL
          AND ${workflowRuns.leaseExpiresAt} <= now()
        `,
        legacyStale: sql<boolean>`
          ${workflowRuns.leaseExpiresAt} IS NULL
          AND ${workflowRuns.startedAt} IS NOT NULL
          AND ${workflowRuns.startedAt} <
            now() - ${RUN_STALE_THRESHOLD_MS} * interval '1 millisecond'
        `,
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
