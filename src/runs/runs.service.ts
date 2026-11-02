import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  nodeRuns,
  workflowRuns,
  workflows,
  type RunStatus,
  type WorkflowRun,
} from '../db/schema.js';
import type {
  NodeRunSnapshot,
  RunHistoryCursor,
  RunHistoryResponse,
  RunSummary,
} from './dto/index.js';
import type { CreateRunDto, ExecuteRunJobDto } from './dto/index.js';
import {
  encodeRunHistoryCursor,
  MAX_RUN_HISTORY_LIMIT,
} from './dto/index.js';
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
 * Подмножество колонок `workflow_runs`, нужное истории запусков (v0.14 S1).
 *
 * `snapshot`, `inputs`, `outputs` и `error` в список не читаются: история —
 * лёгкая ручка для пагинации, детали отдаёт `GET /runs/:id`.
 */
interface RunHistoryRow {
  /** uuid запуска. */
  id: string;
  /** Статус запуска. */
  status: RunStatus;
  /** Дата постановки запуска в очередь (JS Date, точность — мс). */
  createdAt: Date;
  /**
   * `created_at` с точностью микросекунд (ISO-8601 UTC).
   *
   * `Date` хранит только миллисекунды, а `timestamptz` — микросекунды. Для
   * keyset-курсора нужна исходная точность: иначе фильтр `created_at =
   * cursor.createdAt` не совпадёт со строкой, и tie-break по `id` не сработает
   * В SQL-выборке поле есть всегда; необязательность — для тестовых моков,
   * где дата задана только `Date` (тогда fallback на ms-ISO).
   */
  cursorCreatedAt?: string;
  /** Фактический старт выполнения (выставляет движок). */
  startedAt: Date | null;
  /** Время завершения; `null` — запуск ещё идёт. */
  finishedAt: Date | null;
}

/**
 * Суммы `node_runs` по одному запуску.
 *
 * Drizzle отдаёт `numeric` строкой (RULES 4.23), поэтому значения приводятся
 * к числу только при сборке ответа.
 */
interface RunCostRow {
  /** uuid запуска, к которому относятся суммы. */
  runId: string;
  /** `sum(node_runs.cost_usd)` строкой. */
  costUsd: string | null;
  /** `sum(node_runs.cost_rub)` строкой. */
  costRub: string | null;
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
   * Возвращает историю запусков workflow с пагинацией
   * (`GET /workflow/:id/runs`, v0.14 S1, DESIGN V014 § 3.1).
   *
   * **Права.** Смотреть историю может владелец или участник с ролью `editor`
   * (R7.6, как у запуска): чужой/несуществующий workflow и workflow, где
   * пользователь только `viewer`, дают 404 — факт существования не
   * раскрывается (KI-202). Проверка идёт **до** чтения истории: при отказе
   * запросов к `workflow_runs`/`node_runs` не выполняется.
   *
   * **Запросы.** Три (плюс агрегат) шага вместо join'а с `GROUP BY`:
   * 1) проверка доступа по `workflows`; 2) `count(*)` для `total`;
   * 3) страница `workflow_runs` (`createdAt DESC, id DESC`, keyset-фильтр по
   * курсору — v0.16 S1/KI-542); 4) суммы `node_runs` только по запускам
   * страницы (`IN (...) GROUP BY run_id`). Так агрегат не считается для всей
   * истории, а `total` не теряется на пустой странице.
   *
   * **Keyset-пагинация (KI-542).** Вместо `OFFSET` страница продолжается с
   * позиции последнего элемента: `(created_at, id) < (cursor.createdAt,
   * cursor.id)`. Поэтому появление новых запусков между запросами не сдвигает
   * окно — дублей и пропусков нет. Признак «есть ещё» определяется выборкой
   * `limit + 1`: `nextCursor` равен `null`, когда следующая страница пуста, а
   * не когда `runs.length < total` (total может опережать список). `total`
   * остаётся для счётчика UI.
   *
   * **Длительность/стоимость.** `durationMs` = `finishedAt − startedAt` (в
   * `workflow_runs` нет своей `duration_ms`); `costUsd`/`costRub` — суммы
   * `node_runs`, у запуска без строк `node_runs` — `0`.
   *
   * @param workflowId - uuid workflow
   * @param userId - пользователь из access-токена (владелец или `editor`)
   * @param limit - размер страницы (1..{@link MAX_RUN_HISTORY_LIMIT})
   * @param cursor - позиция последнего элемента предыдущей страницы; `undefined` — первая страница
   * @returns запуски страницы и общее число запусков workflow
   * @throws NotFoundException если workflow не найден, чужой или доступен
   *   только с ролью `viewer`
   * @throws BadRequestException если декодированный курсор содержит невалидную дату
   */
  async listRunsAsync(
    workflowId: string,
    userId: string,
    limit: number,
    cursor?: RunHistoryCursor,
  ): Promise<RunHistoryResponse> {
    const [workflow] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      // R7.6: история — право editor (как запуск); viewer получает 404.
      .where(workflowAccessFilter(this.db, workflowId, userId, 'editor'))
      .limit(1);

    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} не найден`);
    }

    // Защита от некорректных значений, если метод вызовут в обход контроллера:
    // SQL с отрицательным LIMIT всё равно упал бы, а огромный limit вытянул бы
    // всю историю (RULES 1.17: граница валидируется и здесь).
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_RUN_HISTORY_LIMIT);

    if (
      cursor !== undefined &&
      Number.isNaN(Date.parse(cursor.createdAt))
    ) {
      // Контроллер отсекает мусор Zod'ом, но сервис — вторая граница: с
      // невалидной датой SQL-сравнение молча вернуло бы пустую страницу.
      throw new BadRequestException('некорректный cursor истории запусков');
    }

    const pageFilter =
      cursor === undefined
        ? eq(workflowRuns.workflowId, workflowId)
        : and(
            eq(workflowRuns.workflowId, workflowId),
            // Строго после последнего элемента: (created_at, id) меньше
            // курсора при порядке `created_at DESC, id DESC`. Курсор несёт
            // микросекунды, поэтому сравнение не теряет tie-break по id.
            or(
              sql`${workflowRuns.createdAt} < ${cursor.createdAt}::timestamptz`,
              and(
                sql`${workflowRuns.createdAt} = ${cursor.createdAt}::timestamptz`,
                lt(workflowRuns.id, cursor.id),
              ),
            ),
          );

    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId));

    const total = countRow?.total ?? 0;

    const rows = await this.db
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        createdAt: workflowRuns.createdAt,
        // `to_char` с `US` сохраняет микросекунды PostgreSQL: `Date` их теряет,
        // а для keyset-курсора нужна точная позиция (см. RunHistoryRow).
        cursorCreatedAt: sql<string>`to_char(${workflowRuns.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        startedAt: workflowRuns.startedAt,
        finishedAt: workflowRuns.finishedAt,
      })
      .from(workflowRuns)
      .where(pageFilter)
      // Сначала новые; `id` — вторичный ключ, иначе при одинаковом `created_at`
      // (частая ситуация для запусков в одну миллисекунду) порядок страниц
      // «плавал» бы и keyset-курсор терял/дублировал строки.
      .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
      // +1 строка — чтобы отличить «страница последняя» от «есть ещё», не
      // полагаясь на `total` (он меняется, если между запросами появились
      // новые запуски). Лишняя строка в ответ не попадает.
      .limit(safeLimit + 1);

    const hasMore = rows.length > safeLimit;
    const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeRunHistoryCursor({
            createdAt:
              pageRows[pageRows.length - 1].cursorCreatedAt ??
              pageRows[pageRows.length - 1].createdAt.toISOString(),
            id: pageRows[pageRows.length - 1].id,
          })
        : null;

    if (pageRows.length === 0) {
      return { runs: [], nextCursor: null, total };
    }

    const costs = await this.db
      .select({
        runId: nodeRuns.runId,
        costUsd: sql<string | null>`coalesce(sum(${nodeRuns.costUsd}), 0)`,
        costRub: sql<string | null>`coalesce(sum(${nodeRuns.costRub}), 0)`,
      })
      .from(nodeRuns)
      .where(
        inArray(
          nodeRuns.runId,
          pageRows.map((row) => row.id),
        ),
      )
      .groupBy(nodeRuns.runId);

    const costByRunId = new Map(costs.map((cost) => [cost.runId, cost]));

    return {
      runs: pageRows.map((row) => toRunSummary(row, costByRunId.get(row.id))),
      nextCursor,
      total,
    };
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

/**
 * Собирает элемент истории запуска.
 *
 * `cost` отсутствует, если у запуска ещё нет строк `node_runs` (запуск
 * `pending`/`running` без завершённых узлов) — тогда обе суммы `0`.
 *
 * @param row - подмножество колонок `workflow_runs`
 * @param cost - суммы `node_runs` по запуску (если есть)
 * @returns публичный элемент истории запусков
 */
function toRunSummary(row: RunHistoryRow, cost?: RunCostRow): RunSummary {
  return {
    id: row.id,
    // v0.16 S1 (KI-542): курсор этого элемента для следующей страницы.
    // `cursorCreatedAt` — ISO-строка с микросекундами из SQL, не JS Date;
    // fallback на ms — только для тестовых моков без поля.
    cursor: encodeRunHistoryCursor({
      createdAt: row.cursorCreatedAt ?? row.createdAt.toISOString(),
      id: row.id,
    }),
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    // `started_at` выставляется при переходе в `running`, поэтому у `pending`
    // пара дат неполная и длительность неизвестна (а не 0).
    durationMs:
      row.startedAt === null || row.finishedAt === null
        ? null
        : // Расхождение часов приложения и БД могло бы дать отрицательное
          // значение; в истории лучше 0, чем «−5 мс».
          Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime()),
    costUsd: toAmount(cost?.costUsd),
    costRub: toAmount(cost?.costRub),
  };
}

/**
 * Приводит значение `numeric`/`sum` из БД к числу.
 *
 * Drizzle отдаёт `numeric` строкой (RULES 4.23), а агрегат может прийти
 * `null`-ом на пустой выборке: обе формы сводим к `0`. Локальная копия
 * хелпера из `cost-budget.service.ts`: наружу он не экспортирован, а тянуть
 * сервис бюджета в историю запусков ради одной строки — лишняя зависимость.
 *
 * @param value - значение из БД (строка, число или `null`)
 * @returns число; `0`, если значение пустое или не число
 */
function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
