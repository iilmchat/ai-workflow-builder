import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  workflowRuns,
  workflows,
  type RunStatus,
  type WorkflowRun,
} from '../db/schema.js';
import type { CreateRunDto, ExecuteRunJobDto } from './dto/index.js';
import { EXECUTE_RUN_JOB, WORKFLOW_RUNS_QUEUE } from './runs.constants.js';

/**
 * Публичное представление запуска workflow, которое отдаёт API.
 *
 * `createdAt` — это `workflow_runs.started_at`: отдельной колонки `created_at`
 * в схеме нет (R1 не меняет существующие таблицы), а `started_at`
 * проставляется БД при INSERT. Колонка nullable, поэтому тип `Date | null`.
 */
export interface RunResponse {
  id: string;
  workflowId: string;
  status: RunStatus;
  createdAt: Date | null;
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
  ) {}

  /**
   * Создаёт запуск workflow: фиксирует snapshot графа и ставит задание в очередь.
   *
   * Сначала выполняется INSERT со статусом `pending` (запуск виден пользователю,
   * даже если Redis недоступен), затем `queue.add`. Если постановка задания
   * упала, запуск компенсируется статусом `failed`, а клиент получает 500.
   *
   * @param dto - валидированный DTO с идентификатором workflow
   * @returns публичное представление созданного запуска
   * @throws NotFoundException если workflow с таким id не найден
   * @throws InternalServerErrorException если не удалось поставить задание в очередь
   */
  async createRunAsync(dto: CreateRunDto): Promise<RunResponse> {
    const [workflow] = await this.db
      .select()
      .from(workflows)
      .where(eq(workflows.id, dto.workflowId))
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
      await this.queue.add(EXECUTE_RUN_JOB, { runId: run.id });
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
   * @param id - uuid запуска
   * @returns публичное представление запуска
   * @throws NotFoundException если запуск не найден
   */
  async getRunAsync(id: string): Promise<RunResponse> {
    const [run] = await this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, id))
      .limit(1);

    if (!run) {
      throw new NotFoundException(`Запуск ${id} не найден`);
    }

    return this.toRunResponse(run);
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
      createdAt: run.startedAt,
    };
  }
}
