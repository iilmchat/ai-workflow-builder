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
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from '../media/media-storage.service.js';
import type { NodeRunSnapshot } from './dto/index.js';
import type { CreateRunDto, ExecuteRunJobDto } from './dto/index.js';
import {
  accessibleWorkflowIdsSubquery,
  workflowAccessFilter,
} from '../workflow/workflow-access.js';
import { EXECUTE_RUN_JOB, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';
import { RUNS_INSTANCE_ID } from './runs.worker-options.js';
import { loadRunNodeSnapshotsAsync } from './run-node-snapshots.js';

/**
 * Публичное представление запуска workflow, которое отдаёт API.
 *
 * `createdAt` — это `workflow_runs.created_at` (KI-015): колонка `NOT NULL
 * DEFAULT now()`, поэтому дата создания всегда есть и не зависит от старта
 * выполнения (`started_at`).
 *
 * **`nodes` (v0.10.2, KI-450).** `GET /runs/:id` теперь отдаёт строки
 * `node_runs` той же проекцией, что SSE-снимок (`NodeRunSnapshot`), — UI может
 * восстановить результаты после F5 без открытия SSE. У `POST /runs` массив
 * всегда пуст: у только что созданного запуска узлов ещё нет.
 */
export interface RunResponse {
  id: string;
  workflowId: string;
  status: RunStatus;
  createdAt: Date;
  /** Узлы запуска (KI-450): проекция `node_runs`, как в SSE-снимке. */
  nodes: NodeRunSnapshot[];
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
    // v0.10.2 (KI-450): `GET /runs/:id` отдаёт `node_runs` той же проекцией,
    // что SSE-снимок, — переподпись `stored_url` живёт в общем загрузчике.
    @Inject(MEDIA_STORAGE) private readonly mediaStorage: IMediaStorage,
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
   * v0.10.2 (KI-450): ответ содержит `nodes` — строки `node_runs` в проекции
   * SSE-снимка (`loadRunNodeSnapshotsAsync`). Это позволяет UI восстановить
   * результаты после F5 без SSE и переподписать просроченные media-ссылки.
   *
   * @param id - uuid запуска
   * @param userId - владелец из access-токена (необязательный)
   * @returns публичное представление запуска вместе с узлами
   * @throws NotFoundException если запуск не найден или принадлежит другому
   */
  async getRunAsync(id: string, userId?: string): Promise<RunResponse> {
    const run = await this.getRunRowAsync(id, userId);
    // KI-450: узлы читаются после проверки доступа — чужой запуск уже
    // отсечён 404 в `getRunRowAsync`, лишнего SELECT наружу не уходит.
    const nodes = await loadRunNodeSnapshotsAsync(
      this.db,
      id,
      run.snapshot,
      this.mediaStorage,
    );

    return this.toRunResponse(run, nodes);
  }

  /**
   * Возвращает строку `workflow_runs` целиком — без проекции в публичный ответ.
   *
   * Нужна SSE-снимку (KI-347): он отдаёт `error` запуска, которого нет в
   * {@link RunResponse}. С v0.10.2 (KI-450) публичный `GET /runs/:id` тоже
   * строится из этой строки, но его проекция (`RunResponse`) по-прежнему
   * ограничена публичными полями; `snapshot`/`inputs`/`outputs` запуска наружу
   * не отдаются.
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
   * @param nodes - узлы запуска (KI-450); у `POST /runs` — пустой массив
   * @returns публичное представление запуска
   */
  private toRunResponse(
    run: WorkflowRun,
    nodes: readonly NodeRunSnapshot[] = [],
  ): RunResponse {
    return {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      createdAt: run.createdAt,
      // KI-450: у нового запуска узлов нет — пустой массив вместо лишнего SELECT.
      nodes: [...nodes],
    };
  }
}
