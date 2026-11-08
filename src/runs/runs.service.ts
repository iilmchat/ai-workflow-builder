import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { JobType, Queue } from 'bullmq';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  nodeRuns,
  workflowRuns,
  workflows,
  TERMINAL_WORKFLOW_RUN_STATUSES,
  type NodeRunStatus,
  type RunStatus,
  type WorkflowRun,
} from '../db/schema.js';
import type {
  NodeDiff,
  NodeRunSnapshot,
  RunCompareResponse,
  RunHistoryCursor,
  RunHistoryResponse,
  RunSummary,
} from './dto/index.js';
import type { CreateRunDto, ExecuteRunJobDto } from './dto/index.js';
import {
  encodeRunHistoryCursor,
  MAX_COMPARE_DIFF_BYTES,
  MAX_RUN_HISTORY_LIMIT,
} from './dto/index.js';
import {
  accessibleWorkflowIdsSubquery,
  workflowAccessFilter,
  type WorkflowAccess,
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
 * Ответ `POST /runs/:id/cancel` (v1.4.0 S1, DESIGN V140 § 3.1).
 *
 * Отдельный минимальный DTO, а не `RunResponse`: ручка не отдаёт строку
 * запуска (в ней нет ничего полезного клиенту — `cancelled_at` и так станет
 * известен из SSE/`GET /runs/:id`), а сообщает только факт отмены.
 */
export interface CancelRunResponse {
  /** Итоговый статус отменённого запуска. */
  status: 'cancelled';
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
 * Строка `node_runs`, нужная сравнению запусков (v1.4.0 S2).
 *
 * Проекция узкая: `outputs` для diff, `status`/`duration_ms`/стоимости для
 * таблицы. `snapshot`/`inputs`/`logs` не читаются — сравнение не должно
 * тянуть мегабайты логов.
 */
interface CompareNodeRow {
  /** uuid запуска, к которому относится строка. */
  runId: string;
  /** `id` узла внутри snapshot. */
  nodeId: string;
  /** Статус выполнения узла. */
  status: NodeRunStatus;
  /** Выходы узла (JSONB) либо `null`, если узел ещё не завершался. */
  outputs: Record<string, unknown> | null;
  /** Длительность узла, мс; `null` — узел не завершён. */
  durationMs: number | null;
  /** Стоимость узла в USD строкой (RULES 4.23). */
  costUsd: string | null;
  /** Стоимость узла в рублях строкой. */
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
   * @param access - пользователь и его организация из access-токена (R6.1a,
   *   v1.0.0 S2): если передан, чужой workflow и workflow другой организации
   *   не запускаются (404, чтобы не раскрывать существование)
   * @returns публичное представление созданного запуска
   * @throws NotFoundException если workflow с таким id не найден, принадлежит
   *   другому пользователю/организации либо доступен только с ролью viewer
   *   (R7.6: запуск — право editor)
   * @throws InternalServerErrorException если не удалось поставить задание в очередь
   */
  async createRunAsync(
    dto: CreateRunDto,
    access?: WorkflowAccess,
  ): Promise<RunResponse> {
    const [workflow] = await this.db
      .select()
      .from(workflows)
      .where(
        access === undefined
          ? eq(workflows.id, dto.workflowId)
          : // R7.6 + S2: запускать может владелец или участник с ролью editor
            // строго в своей организации. Viewer/чужой workflow → пустая
            // выборка → 404, как несуществующий.
            workflowAccessFilter(this.db, dto.workflowId, access, 'editor'),
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
      //
      // v1.4.0 S1: `jobId` = uuid запуска. Это даёт отмене прямую адресацию
      // задания (`queue.getJob(runId)`), не перебирая всю очередь. UUID
      // безопасен как jobId (BullMQ запрещает только `:`), а повторная
      // постановка того же запуска невозможна — uuid уникален.
      await this.queue.add(
        EXECUTE_RUN_JOB,
        {
          runId: run.id,
          instanceId: RUNS_INSTANCE_ID,
        },
        { jobId: run.id },
      );
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
   * KI-202: если передан `access`, чужой запуск неотличим от несуществующего —
   * отдаём 404, а не 403, чтобы не раскрывать факт существования. С v1.0.0 S2
   * то же правило действует для запусков workflow другой организации.
   *
   * v0.11 S12 (DESIGN § 3.4.2): узлов в ответе нет — история узлов вынесена в
   * {@link listNodeRunsAsync} (`GET /runs/:id/nodes`). Здесь отдаётся только
   * статус и причина падения (`error`), поэтому ручка остаётся дешёвой для
   * поллинга.
   *
   * @param id - uuid запуска
   * @param access - пользователь и его организация из access-токена
   *   (необязательный: без него фильтр доступа не применяется)
   * @returns публичное представление запуска
   * @throws NotFoundException если запуск не найден, принадлежит другому
   *   пользователю или другой организации
   */
  async getRunAsync(id: string, access?: WorkflowAccess): Promise<RunResponse> {
    const run = await this.getRunRowAsync(id, access);

    return this.toRunResponse(run);
  }

  /**
   * Отменяет запуск workflow (`POST /runs/:id/cancel`, v1.4.0 S1).
   *
   * **Права.** Отменить может владелец workflow или участник с ролью `editor`
   * (R7.6 — та же роль, что у запуска). Viewer и запуск чужой организации
   * неотличимы от несуществующего — 404, чтобы не раскрывать факт
   * существования (KI-202). Проверка выполняется **до** любых записей:
   * `getRunRowAsync` с `minimumRole = 'editor'` уже отфильтровал чужое.
   *
   * **Семантика по статусам.**
   * - `pending` — BullMQ ещё не взял задание: запуск сразу становится
   *   `cancelled`, `cancelled_at`/`finished_at` = now(), а задание удаляется из
   *   очереди. Движок его не увидит вовсе.
   * - `running` — прерывать процесс из HTTP-запроса нельзя: движок живёт в
   *   worker'е. Поэтому ставится только `cancelled_at`, а
   *   `ExecutionEngineService` замечает флаг перед следующим уровнем/узлом,
   *   бросает `RunCancelledException`, и `RunsProcessor` закрывает запуск
   *   `cancelled` (событие `run_completed` со статусом `cancelled`).
   * - `completed`/`failed`/`cancelled` — терминальные: 409 Conflict. Отменять
   *   завершённый запуск нечем, а 409 честнее 200, который ничего не сделал.
   *
   * **Гонка `pending → running`.** UPDATE ограничен условием
   * `status = <прочитанный>`, поэтому строка не будет перезаписана, если
   * worker успел сменить статус между SELECT и UPDATE. Если `pending`-ветка
   * проиграла гонку, метод перечитывает строку и обрабатывает её как
   * `running`. Окончательный арбитр — флаг `cancelled_at`: движок проверяет
   * его независимо от того, кто выиграл гонку.
   *
   * @param id - uuid запуска
   * @param access - пользователь и его организация из access-токена
   * @returns `{ status: 'cancelled' }`
   * @throws NotFoundException если запуск не найден, чужой, другой организации
   *   или пользователь — только `viewer`
   * @throws ConflictException если запуск уже терминальный
   */
  async cancelRunAsync(
    id: string,
    access: WorkflowAccess,
  ): Promise<CancelRunResponse> {
    const run = await this.getRunRowAsync(id, access, 'editor');

    if (isTerminalRunStatus(run.status)) {
      throw new ConflictException(
        `Запуск ${id} уже завершён (status=${run.status}) — отмена невозможна`,
      );
    }

    if (run.status === 'pending') {
      const cancelledAt = new Date();

      // Условие `status = 'pending'` — защита от гонки с воркером: если он
      // уже перевёл запуск в `running`, этот UPDATE не тронет строку, и ниже
      // сработает ветка running.
      const cancelledPending = await this.db
        .update(workflowRuns)
        .set({
          status: 'cancelled',
          cancelledAt,
          finishedAt: cancelledAt,
        })
        .where(and(eq(workflowRuns.id, id), eq(workflowRuns.status, 'pending')))
        .returning({ id: workflowRuns.id });

      if (cancelledPending.length > 0) {
        // v1.4.0 S1: pending-задание ещё лежит в Redis — удаляем его, чтобы
        // worker не начал выполнение уже отменённого запуска. Сбой удаления
        // не отменяет отмену: статус уже `cancelled`, а движок дополнительно
        // проверит флаг.
        await this.removeQueuedJobAsync(id);

        this.logger.log(`Запуск ${id} отменён до старта (pending)`);

        return { status: 'cancelled' };
      }

      const current = await this.getRunRowAsync(id, access, 'editor');

      if (isTerminalRunStatus(current.status)) {
        throw new ConflictException(
          `Запуск ${id} уже завершён (status=${current.status}) — отмена невозможна`,
        );
      }
    }

    // running (штатная ветка либо проигранная гонка из pending): ставим
    // только флаг. Статус и событие — за движком и RunsProcessor.
    const cancelledRunning = await this.db
      .update(workflowRuns)
      .set({ cancelledAt: new Date() })
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.status, 'running')))
      .returning({ id: workflowRuns.id });

    if (cancelledRunning.length === 0) {
      // Запуск успел завершиться между SELECT и UPDATE: отменять нечего.
      // Честный 409 вместо 200, который ничего не сделал.
      const current = await this.getRunRowAsync(id, access, 'editor');

      throw new ConflictException(
        `Запуск ${id} уже завершён (status=${current.status}) — отмена невозможна`,
      );
    }

    this.logger.log(`Запуск ${id}: запрошена отмена во время выполнения`);

    return { status: 'cancelled' };
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
   * @param access - пользователь и его организация из access-токена: чужой
   *   запуск / запуск другой организации → 404
   * @returns снимки всех узлов запуска (порядок — по `nodeId`)
   * @throws NotFoundException если запуск не найден, принадлежит другому
   *   пользователю или другой организации
   */
  async listNodeRunsAsync(
    runId: string,
    access?: WorkflowAccess,
  ): Promise<NodeRunSnapshot[]> {
    const run = await this.getRunRowAsync(runId, access);

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
   * запросов к `workflow_runs`/`node_runs` не выполняется. S2: workflow другой
   * организации отсекается тем же фильтром доступа — тоже 404, без утечки
   * существования чужого арендатора.
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
   * @param access - пользователь и его организация из access-токена
   *   (владелец или `editor`); S2: workflow другой организации неотличим от
   *   несуществующего — 404
   * @param limit - размер страницы (1..{@link MAX_RUN_HISTORY_LIMIT})
   * @param cursor - позиция последнего элемента предыдущей страницы; `undefined` — первая страница
   * @returns запуски страницы и общее число запусков workflow
   * @throws NotFoundException если workflow не найден, чужой, принадлежит
   *   другой организации или доступен только с ролью `viewer`
   * @throws BadRequestException если декодированный курсор содержит невалидную дату
   */
  async listRunsAsync(
    workflowId: string,
    access: WorkflowAccess,
    limit: number,
    cursor?: RunHistoryCursor,
  ): Promise<RunHistoryResponse> {
    const [workflow] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      // R7.6: история — право editor (как запуск); viewer получает 404.
      // S2: organization_id = access.orgId обязателен и здесь — история
      // запусков чужой организации не читается даже по известному uuid.
      .where(workflowAccessFilter(this.db, workflowId, access, 'editor'))
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
   * Сравнивает два запуска workflow (`GET /runs/:id1/compare/:id2`,
   * v1.4.0 S2, DESIGN V140 § 3.2).
   *
   * **Права.** Сравнение — операция чтения, но запуски содержат outputs,
   * поэтому доступ проверяется для **обоих** запусков с ролью `editor`
   * (R7.6, как у истории и отмены). Чужой/несуществующий запуск неотличим от
   * отсутствующего — 404 (KI-202), без раскрытия факта существования.
   *
   * **Что сравнивается.** Объединение `node_runs` обоих запусков по `nodeId`:
   * - `status1`/`status2` — статусы узла (`completed`/`failed`/`skipped`/…);
   * - `duration1`/`duration2` — `node_runs.duration_ms`;
   * - `cost1`/`cost2` — `node_runs.cost_usd` (USD; рублёвые суммы media — в
   *   `totalDiff.costRub`, RULES 4.23);
   * - `outputsDiff` — `{ changed, onlyRun1, onlyRun2 }` в JSON, только если
   *   выходы различаются. Строка обрезается до
   *   {@link MAX_COMPARE_DIFF_BYTES} (100 КБ) с пометкой в конце.
   *
   * `run1`/`run2` — проекция {@link RunSummary}; суммы считаются по тем же
   * `node_runs`, что и diff, поэтому отдельного агрегата не требуется.
   *
   * @param id1 - uuid первого запуска (левая колонка UI)
   * @param id2 - uuid второго запуска (правая колонка UI)
   * @param access - пользователь и его организация из access-токена
   * @returns запуски и поузловые/суммарные различия
   * @throws NotFoundException если хотя бы один запуск не найден, чужой,
   *   принадлежит другой организации или доступен только `viewer`
   */
  async compareRunsAsync(
    id1: string,
    id2: string,
    access: WorkflowAccess,
  ): Promise<RunCompareResponse> {
    // Запуски независимы — читаем параллельно (RULES 4.17). Каждый вызов
    // проверяет доступ `editor`: сравнение отдаёт outputs, поэтому `viewer`
    // не должен получать даже косвенную информацию о содержимом.
    const [run1, run2] = await Promise.all([
      this.getRunRowAsync(id1, access, 'editor'),
      this.getRunRowAsync(id2, access, 'editor'),
    ]);

    const rows = await this.db
      .select({
        runId: nodeRuns.runId,
        nodeId: nodeRuns.nodeId,
        status: nodeRuns.status,
        outputs: nodeRuns.outputs,
        durationMs: nodeRuns.durationMs,
        costUsd: nodeRuns.costUsd,
        costRub: nodeRuns.costRub,
      })
      .from(nodeRuns)
      .where(inArray(nodeRuns.runId, [id1, id2]))
      // Детерминированный порядок таблицы: diff двух запусков не должен
      // «прыгать» между запросами из-за порядка строк в БД.
      .orderBy(asc(nodeRuns.nodeId));

    const run1Rows = new Map<string, CompareNodeRow>();
    const run2Rows = new Map<string, CompareNodeRow>();

    for (const row of rows) {
      const target = row.runId === id1 ? run1Rows : run2Rows;
      target.set(row.nodeId, row);
    }

    // Объединение узлов, а не пересечение: узел, который был только в одном
    // запуске (граф изменился/запуск остановился раньше), — тоже различие.
    const nodeIds = [...new Set(rows.map((row) => row.nodeId))].sort((a, b) =>
      a.localeCompare(b),
    );
    const nodeDiffs = nodeIds.map((nodeId) =>
      buildNodeDiff(nodeId, run1Rows.get(nodeId), run2Rows.get(nodeId)),
    );

    const cost1 = sumNodeCost(Array.from(run1Rows.values()), 'costUsd');
    const costRub1 = sumNodeCost(Array.from(run1Rows.values()), 'costRub');
    const cost2 = sumNodeCost(Array.from(run2Rows.values()), 'costUsd');
    const costRub2 = sumNodeCost(Array.from(run2Rows.values()), 'costRub');

    const summary1 = toRunSummary(
      {
        id: run1.id,
        status: run1.status,
        createdAt: run1.createdAt,
        startedAt: run1.startedAt,
        finishedAt: run1.finishedAt,
      },
      {
        runId: run1.id,
        costUsd: String(cost1),
        costRub: String(costRub1),
      },
    );
    const summary2 = toRunSummary(
      {
        id: run2.id,
        status: run2.status,
        createdAt: run2.createdAt,
        startedAt: run2.startedAt,
        finishedAt: run2.finishedAt,
      },
      {
        runId: run2.id,
        costUsd: String(cost2),
        costRub: String(costRub2),
      },
    );

    return {
      run1: summary1,
      run2: summary2,
      diffs: {
        nodeDiffs,
        totalDiff: {
          // null, если хотя бы один запуск ещё не завершён: вычитать
          // «неизвестно» из числа нельзя (в отличие от стоимости, которая
          // всегда агрегируется по существующим node_runs).
          durationMs:
            summary1.durationMs === null || summary2.durationMs === null
              ? null
              : summary2.durationMs - summary1.durationMs,
          costUsd: cost2 - cost1,
          costRub: costRub2 - costRub1,
        },
      },
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
   * KI-202: если передан `access`, чужой запуск неотличим от несуществующего —
   * отдаём 404, а не 403, чтобы не раскрывать факт существования. С v1.0.0 S2
   * запуск ищется только среди workflow **своей организации** — uuid запуска
   * другой организации даёт 404, а не данные чужого арендатора.
   *
   * @param id - uuid запуска
   * @param access - пользователь и его организация из access-токена
   *   (необязательный: без него фильтр доступа не применяется)
   * @param minimumRole - минимальная роль участника workflow (v1.4.0 S1):
   *   чтение — `viewer` (дефолт), отмена запуска — `editor`
   * @returns строка таблицы `workflow_runs`
   * @throws NotFoundException если запуск не найден, принадлежит другому
   *   пользователю или другой организации
   */
  async getRunRowAsync(
    id: string,
    access?: WorkflowAccess,
    minimumRole: 'viewer' | 'editor' = 'viewer',
  ): Promise<WorkflowRun> {
    const [run] = await this.db
      .select()
      .from(workflowRuns)
      .where(
        access === undefined
          ? eq(workflowRuns.id, id)
          : and(
              eq(workflowRuns.id, id),
              // Владелец запуска — владелец его workflow. R7.6: участник
              // workflow тоже видит запуски (иначе SSE-поток editor'а,
              // который сам же запустил граф, отвечал бы 404).
              // S2: подзапрос `accessibleWorkflowIdsSubquery` уже ограничен
              // organization_id арендатора, поэтому запуск чужой организации
              // не проходит фильтр.
              inArray(
                workflowRuns.workflowId,
                accessibleWorkflowIdsSubquery(this.db, access, minimumRole),
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
   * Удаляет задание запуска из BullMQ «по возможности» (v1.4.0 S1).
   *
   * Сначала используется прямой адрес: с v1.4.0 `queue.add` ставит
   * `jobId = run.id`. Для заданий, поставленных до обновления (у них
   * сгенерированный BullMQ id), выполняется запасной поиск по payload
   * `data.runId` среди ожидающих/отложенных заданий — иначе отмена
   * `pending`-запуска после деплоя не убрала бы старое задание.
   *
   * Сбой Redis **не отменяет отмену**: статус уже `cancelled`, а движок
   * проверит `cancelled_at` перед первым уровнем и всё равно остановится
   * (RULES 4.18 — ошибку не проглатываем, а логируем).
   *
   * @param runId - uuid запуска, чьё задание нужно удалить
   * @returns промис без значения
   */
  private async removeQueuedJobAsync(runId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(runId);

      if (job !== null && job !== undefined) {
        await job.remove();

        return;
      }

      // Запасной путь для заданий без кастомного jobId (поставлены до
      // v1.4.0). Перебираются только состояния, из которых задание ещё не
      // начало выполняться.
      const pendingStates: JobType[] = ['waiting', 'delayed', 'prioritized'];
      const jobs = await this.queue.getJobs(pendingStates);
      const match = jobs.find((candidate) => candidate.data?.runId === runId);

      if (match !== undefined) {
        await match.remove();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Не удалось удалить задание запуска ${runId} из очереди: ${message}`,
      );
    }
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
 * Маркер обрезанного `outputsDiff` (v1.4.0 S2).
 *
 * Пишется в конец строки: клиент видит, что diff неполный, а не думает, что
 * outputs закончились. Входит в лимит {@link MAX_COMPARE_DIFF_BYTES}.
 */
const DIFF_TRUNCATED_MARKER = '\n… [diff обрезан: лимит 100 КБ]';

/**
 * Проверяет, что значение из JSONB — обычный объект.
 *
 * `node_runs.outputs` в схеме типизирован объектом, но исторические/битые
 * строки могут содержать массив или скаляр; сравнение приводит их к `{}`,
 * чтобы не падать на `Object.keys(null)`.
 *
 * @param value - значение из JSONB
 * @returns `true`, если значение можно читать как `Record<string, unknown>`
 */
function isPlainOutputs(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Собирает diff выходов одного узла (v1.4.0 S2).
 *
 * Формат `{ changed, onlyRun1, onlyRun2 }` вместо полной копии обоих outputs:
 * так строка короче и пользователь сразу видит, **что** изменилось, а не
 * ищет различие в двух JSON-полотнах. Ключи сортируются — diff стабилен между
 * запросами.
 *
 * @param outputs1 - outputs узла в первом запуске либо `null`
 * @param outputs2 - outputs узла во втором запуске либо `null`
 * @returns JSON-строка diff либо `undefined`, если выходы совпали
 */
function buildOutputsDiff(
  outputs1: Record<string, unknown> | null,
  outputs2: Record<string, unknown> | null,
): string | undefined {
  const left = isPlainOutputs(outputs1) ? outputs1 : {};
  const right = isPlainOutputs(outputs2) ? outputs2 : {};

  if (isDeepStrictEqual(left, right)) {
    return undefined;
  }

  const changed: Record<string, { run1: unknown; run2: unknown }> = {};
  const onlyRun1: Record<string, unknown> = {};
  const onlyRun2: Record<string, unknown> = {};

  for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
    const inLeft = Object.hasOwn(left, key);
    const inRight = Object.hasOwn(right, key);

    if (inLeft && inRight) {
      if (!isDeepStrictEqual(left[key], right[key])) {
        changed[key] = { run1: left[key], run2: right[key] };
      }
    } else if (inLeft) {
      onlyRun1[key] = left[key];
    } else {
      onlyRun2[key] = right[key];
    }
  }

  return truncateDiff(
    JSON.stringify({ changed, onlyRun1, onlyRun2 }, null, 2),
  );
}

/**
 * Обрезает diff до 100 КБ, сохраняя маркер целиком (v1.4.0 S2).
 *
 * Режется по **границе code unit строки** с бинарным поиском, а не по срезу
 * `Buffer`: так итоговый размер не превышает лимит даже для кириллицы и
 * эмодзи (у них разная длина в байтах и code units). Маркер входит в лимит —
 * иначе ответ был бы на несколько десятков байт больше заявленного.
 *
 * @param text - полная JSON-строка diff
 * @returns исходная строка либо обрезанная с {@link DIFF_TRUNCATED_MARKER}
 */
function truncateDiff(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_COMPARE_DIFF_BYTES) {
    return text;
  }

  const markerBytes = Buffer.byteLength(DIFF_TRUNCATED_MARKER, 'utf8');
  const budget = MAX_COMPARE_DIFF_BYTES - markerBytes;
  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);

    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= budget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return `${text.slice(0, low)}${DIFF_TRUNCATED_MARKER}`;
}

/**
 * Собирает различие одного узла между запусками.
 *
 * @param nodeId - `id` узла
 * @param row1 - строка `node_runs` первого запуска либо `undefined`
 * @param row2 - строка `node_runs` второго запуска либо `undefined`
 * @returns поузловое различие для ответа API
 */
function buildNodeDiff(
  nodeId: string,
  row1: CompareNodeRow | undefined,
  row2: CompareNodeRow | undefined,
): NodeDiff {
  return {
    nodeId,
    status1: row1?.status ?? null,
    status2: row2?.status ?? null,
    outputsDiff: buildOutputsDiff(row1?.outputs ?? null, row2?.outputs ?? null),
    duration1: row1?.durationMs ?? null,
    duration2: row2?.durationMs ?? null,
    cost1: row1 === undefined ? null : toAmount(row1.costUsd),
    cost2: row2 === undefined ? null : toAmount(row2.costUsd),
  };
}

/**
 * Суммирует стоимость узлов запуска в указанной валюте.
 *
 * `node_runs.cost_usd`/`cost_rub` — `numeric`, Drizzle отдаёт их строкой
 * (RULES 4.23); `toAmount` приводит к числу и гасит `null` в `0`.
 *
 * @param rows - строки `node_runs` одного запуска
 * @param field - колонка валюты (`costUsd`/`costRub`)
 * @returns сумма в валюте колонки
 */
function sumNodeCost(
  rows: readonly CompareNodeRow[],
  field: 'costUsd' | 'costRub',
): number {
  return rows.reduce((sum, row) => sum + toAmount(row[field]), 0);
}

/**
 * Проверяет, что запуск уже завершён и отменять нечего (v1.4.0 S1).
 *
 * Единственный источник списка — {@link TERMINAL_WORKFLOW_RUN_STATUSES}: если
 * добавят новый финальный статус, `cancelRunAsync` получит 409 без правки
 * метода.
 *
 * @param status - статус запуска из `workflow_runs.status`
 * @returns `true` для `completed`, `failed` и `cancelled`
 */
function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUSES.some((terminal) => terminal === status);
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
