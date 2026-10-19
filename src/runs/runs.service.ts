import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  workflowRuns,
  workflows,
  type RunStatus,
  type WorkflowRun,
} from '../db/schema.js';
import type { NodeRunSnapshot } from './dto/index.js';
import type { CreateRunDto, ExecuteRunJobDto } from './dto/index.js';
import {
  accessibleWorkflowIdsSubquery,
  workflowAccessFilter,
} from '../workflow/workflow-access.js';
import { EXECUTE_RUN_JOB, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { RUNS_INSTANCE_ID } from './runs.worker-options.js';
import { NodeRunSnapshotMapper } from './node-run-snapshot.mapper.js';

/**
 * Публичное представление запуска workflow, которое отдаёт API.
 *
 * `createdAt` — это `workflow_runs.created_at` (KI-015): колонка `NOT NULL
 * DEFAULT now()`, поэтому дата создания всегда есть и не зависит от старта
 * выполнения (`started_at`).
 *
 * **`error` (v0.11 S12, DESIGN § 3.4.2).** Причина падения запуска —
 * аддитивное поле: без него восстановленный после F5 `failed`-запуск не
 * показывал причину (SSE-снимок её отдаёт, а `GET /runs/:id` — нет).
 *
 * **Узлов здесь больше нет.** До v0.11 S12 поле `nodes` (v0.10.2, KI-450)
 * дублировало SSE-снимок в ответе запуска; теперь история узлов живёт в
 * отдельной ручке `GET /runs/:id/nodes` (KI-077), чтобы `GET /runs/:id`
 * оставался дешёвым.
 */
export interface RunResponse {
  id: string;
  workflowId: string;
  status: RunStatus;
  createdAt: Date;
  /** Текст ошибки запуска (`workflow_runs.error`); `null` — ошибки не было. */
  error: string | null;
}

/**
 * Сервис запусков workflow.
 *
 * R1 — только инфраструктура: создать строку в `workflow_runs`, поставить
 * задание в BullMQ и прочитать состояние запуска. Реальное выполнение графа
 * (EngineService, `node_runs`) появится в R2.
 */
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @InjectQueue(WORKFLOW_RUNS_QUEUE) private readonly queue: Queue<ExecuteRunJobDto>,
    // v0.11 S12 (DESIGN § 3.4.2): `GET /runs/:id/nodes` отдаёт `node_runs`
    // той же проекцией, что SSE-снимок, — переподпись `stored_url` и ISO-даты
    // живут в общем маппере.
    private readonly snapshotMapper: NodeRunSnapshotMapper,
  ) {}

  /**
   * Создаёт запуск workflow: фиксирует snapshot графа и ставит задание в очередь.
   *
   * Сначала выполняется INSERT со статусом `pending` (запуск виден пользователю,
   * даже если Redis недоступен), затем `queue.add`. Если постановка задания
   * упала, запуск компенсируется статусом `failed`, а клиент получает 500.
   *
   * @param dto - валидированный DTO с идентификатором workflow
   * @param userId - пользователь из access-токена (R6.1a): если передан, чужой
   *   workflow не запускается (404, чтобы не раскрывать существование)
   * @returns публичное представление созданного запуска
   * @throws NotFoundException если workflow с таким id не найден, принадлежит другому пользователю
   *   либо доступен только с ролью viewer (R7.6: запуск — право editor)
   * @throws InternalServerErrorException если не удалось поставить задание в очередь
   */
  async createRunAsync(dto: CreateRunDto, userId?: string): Promise<RunResponse> {
    const [workflow] = await this.db
      .select()
      .from(workflows)
      .where(
        userId
          // R7.6: запускать может владелец или участник с ролью editor.
          // Viewer получает пустую выборку → 404, как чужой workflow.
          ? workflowAccessFilter(this.db, dto.workflowId, userId, 'editor')
          : eq(workflows.id, dto.workflowId),
      )
      .limit(1);

    if (!workflow) {
      throw new NotFoundException(`Workflow ${dto.workflowId} не найден`);
    }

    const [run] = await this.db
      .insert(workflowRuns)
      .values({
        workflowId: workflow.id,
        status: 'pending',
        inputs: {},
        // Копия графа на момент запуска: последующие правки workflow
        // не меняют историю запусков.
        snapshot: { nodes: workflow.nodes, edges: workflow.edges },
      })
      .returning();

    try {
      // KI-387: маркер инстанса в payload. Воркер чужого инстанса пропустит
      // задание, даже если оба процесса смотрят в одну очередь Redis.
      await this.queue.add(EXECUTE_RUN_JOB, {
        runId: run.id,
        instanceId: RUNS_INSTANCE_ID,
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Не удалось поставить запуск ${run.id} в очередь ${WORKFLOW_RUNS_QUEUE}: ${reason}`,
      );
      await this.markRunFailedAsync(run.id, reason);

      throw new InternalServerErrorException(
        `Не удалось поставить запуск ${run.id} в очередь`,
      );
    }

    this.logger.log(`Создан запуск ${run.id} для workflow ${workflow.id}`);

    return this.toRunResponse(run);
  }

  /**
   * Возвращает запуск workflow по идентификатору.
   *
   * KI-202: если передан `userId`, чужой запуск неотличим от несуществующего —
   * отдаём 404, а не 403, чтобы не раскрывать факт существования.
   *
   * v0.11 S12 (DESIGN § 3.4.2): узлов в ответе нет — история узлов вынесена в
   * {@link listNodeRunsAsync} (`GET /runs/:id/nodes`). Здесь отдаётся только
   * статус и причина падения (`error`), поэтому ручка остаётся дешёвой для
   * поллинга.
   *
   * @param id - uuid запуска
   * @param userId - владелец из access-токена (необязательный)
   * @returns публичное представление запуска
   * @throws NotFoundException если запуск не найден или принадлежит другому
   */
  async getRunAsync(id: string, userId?: string): Promise<RunResponse> {
    const run = await this.getRunRowAsync(id, userId);

    return this.toRunResponse(run);
  }

  /**
   * Возвращает историю узлов запуска (`GET /runs/:id/nodes`, KI-077).
   *
   * Сначала проверяется доступ к запуску: чужой/несуществующий отдаёт 404
   * (KI-202), и только затем читаются `node_runs`. Проекция — та же, что в
   * SSE-снимке ({@link NodeRunSnapshotMapper}), поэтому после F5 без SSE UI
   * получает идентичные `outputs`/`error`/`logs`/метрики и переподписанные
   * media-ссылки (KI-443/KI-464).
   *
   * @param runId - uuid запуска
   * @param userId - владелец из access-токена: чужой запуск → 404
   * @returns снимки всех узлов запуска (порядок — по `nodeId`)
   * @throws NotFoundException если запуск не найден или принадлежит другому
   */
  async listNodeRunsAsync(
    runId: string,
    userId?: string,
  ): Promise<NodeRunSnapshot[]> {
    const run = await this.getRunRowAsync(runId, userId);

    return this.snapshotMapper.listAsync(runId, run.snapshot);
  }

  /**
   * Возвращает строку `workflow_runs` целиком — без проекции в публичный ответ.
   *
   * Нужна SSE-снимку (KI-347) и `GET /runs/:id/nodes`: первый отдаёт `error`
   * запуска, второй — граф для пересчёта `cacheSavingsUsd`/подписи ссылок.
   * Публичная проекция запуска (`RunResponse`) ограничена публичными полями;
   * `snapshot`/`inputs`/`outputs` запуска наружу не отдаются.
   *
   * KI-202: если передан `userId`, чужой запуск неотличим от несуществующего —
   * отдаём 404, а не 403, чтобы не раскрывать факт существования.
   *
   * @param id - uuid запуска
   * @param userId - владелец из access-токена (необязательный)
   * @returns строка таблицы `workflow_runs`
   * @throws NotFoundException если запуск не найден или принадлежит другому
   */
  async getRunRowAsync(id: string, userId?: string): Promise<WorkflowRun> {
    const [run] = await this.db
      .select()
      .from(workflowRuns)
      .where(
        userId === undefined
          ? eq(workflowRuns.id, id)
          : and(
              eq(workflowRuns.id, id),
              // Владелец запуска — владелец его workflow. R7.6: участник
              // workflow тоже видит запуски (иначе SSE-поток editor'а,
              // который сам же запустил граф, отвечал бы 404).
              inArray(
                workflowRuns.workflowId,
                accessibleWorkflowIdsSubquery(this.db, userId),
              ),
            ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException(`Запуск ${id} не найден`);
    }

    return run;
  }

  /**
   * Помечает запуск как `failed` — компенсация, если очередь недоступна.
   *
   * Сбой самого UPDATE только логируется: наружу должен уйти исходный сбой
   * Redis, иначе причина потеряется (RULES 4.18).
   *
   * @param id - uuid запуска
   * @param reason - текст ошибки для колонки `error`
   * @returns промис без значения
   */
  private async markRunFailedAsync(id: string, reason: string): Promise<void> {
    try {
      await this.db
        .update(workflowRuns)
        .set({ status: 'failed', error: reason, finishedAt: new Date() })
        .where(eq(workflowRuns.id, id));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Не удалось пометить запуск ${id} как failed: ${message}`);
    }
  }

  /**
   * Преобразует строку `workflow_runs` в публичное представление.
   *
   * @param run - строка таблицы `workflow_runs`
   * @returns публичное представление запуска
   */
  private toRunResponse(run: WorkflowRun): RunResponse {
    return {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      createdAt: run.createdAt,
      // KI-347: причина падения запуска нужна панели результата после F5;
      // SSE-снимок отдаёт её же, поэтому REST и SSE совпадают (DESIGN § 3.4.2).
      error: run.error,
    };
  }
}
