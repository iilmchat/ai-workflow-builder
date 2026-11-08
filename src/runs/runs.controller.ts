import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Sse,
  SseSignal,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { toWorkflowAccess } from '../workflow/workflow-access.js';
import { CostBudgetService } from './cost-budget.service.js';
import {
  CreateRunSchema,
  RunHistoryQuerySchema,
  decodeRunHistoryCursor,
  type CreateRunDto,
  type NodeRunSnapshot,
  type RunHistoryQueryDto,
  type RunHistoryResponse,
} from './dto/index.js';
import type { RunBudgetResponse } from './dto/run-budget.dto.js';
import {
  RunsService,
  type CancelRunResponse,
  type RunResponse,
} from './runs.service.js';
import type { RunCompareResponse } from './dto/index.js';
import { RunsStreamService } from './runs-stream.service.js';

/** Zod-схема path-параметра `:id`. */
const RunIdParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
});

/** Валидированный path-параметр `:id`. */
type RunIdParamDto = z.infer<typeof RunIdParamSchema>;

/**
 * Zod-схема path-параметров сравнения запусков
 * (`GET /runs/:id1/compare/:id2`, v1.4.0 S2).
 *
 * Оба параметра — uuid запусков. Схема отдельная, а не два `RunIdParamSchema`:
 * в ошибке 400 должно быть понятно, какой именно идентификатор некорректен
 * (`id1`/`id2`), а не обезличенный `id`.
 */
const CompareRunsParamSchema = z.object({
  id1: z.uuid('id1 должен быть валидным UUID'),
  id2: z.uuid('id2 должен быть валидным UUID'),
});

/** Валидированные path-параметры сравнения запусков. */
type CompareRunsParamDto = z.infer<typeof CompareRunsParamSchema>;

/**
 * Zod-схема path-параметра `:id` истории запусков workflow
 * (`GET /workflow/:id/runs`).
 *
 * Отдельная константа, а не переиспользование `RunIdParamSchema`: смысл
 * параметра другой (uuid workflow, а не запуска), и в ошибке 400 это должно
 * читаться однозначно.
 */
const WorkflowIdParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
});

/** Валидированный path-параметр `:id` истории запусков. */
type WorkflowIdParamDto = z.infer<typeof WorkflowIdParamSchema>;

/**
 * HTTP-контроллер запусков workflow.
 *
 * Префикс маршрутов — `/runs`. Валидация body/param выполняется
 * ZodValidationPipe, ошибки отдаёт глобальный HttpExceptionFilter, поэтому
 * try/catch в контроллере нет (RULES 1.6, 4.7).
 *
 * R6.1a: контроллер закрыт JwtAuthGuard; пользователь берётся из токена.
 * v1.0.0 S2: в сервисы уходит `{userId, orgId}` (`toWorkflowAccess`) — доступ
 * ограничен не только пользователем, но и организацией-арендатором.
 */
@UseGuards(JwtAuthGuard)
@Controller('runs')
export class RunsController {
  constructor(
    private readonly runsService: RunsService,
    private readonly runsStreamService: RunsStreamService,
    private readonly costBudget: CostBudgetService,
  ) {}

  /**
   * `POST /runs` — создаёт запуск workflow и ставит задание в очередь.
   *
   * @param dto - тело запроса, валидированное по CreateRunSchema
   * @param user - пользователь и его организация из access-токена (S2)
   * @returns публичное представление запуска со статусом 201
   * @throws NotFoundException если workflow не найден (или чужой/другой организации)
   * @throws InternalServerErrorException если очередь недоступна
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(ZodValidationPipe.create(CreateRunSchema)) dto: CreateRunDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunResponse> {
    // v1.0.0 S2: orgId из токена обязателен — сервис фильтрует workflow ещё
    // и по организации арендатора, поэтому собираем access общим хелпером.
    return this.runsService.createRunAsync(dto, toWorkflowAccess(user));
  }

  /**
   * `POST /runs/:id/cancel` — отмена запуска (v1.4.0 S1, DESIGN V140 § 3.1).
   *
   * Ручка закрыта `JwtAuthGuard`; `RunsService.cancelRunAsync` проверяет, что
   * пользователь — владелец workflow или участник с ролью `editor`, и
   * возвращает 404 на чужой/несуществующий запуск. Ответ — `200
   * { status: 'cancelled' }`: отмена `pending`-запуска завершается сразу,
   * отмена `running` — кооперативная (движок остановится перед следующим
   * уровнем/узлом, финал придёт событием `run_completed`).
   *
   * @param params - path-параметр `id` (uuid запуска)
   * @param user - пользователь и его организация из access-токена
   * @returns `{ status: 'cancelled' }`
   * @throws NotFoundException если запуск не найден, чужой, другой организации
   *   или пользователь — только `viewer`
   * @throws ConflictException если запуск уже `completed`/`failed`/`cancelled`
   */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CancelRunResponse> {
    return this.runsService.cancelRunAsync(params.id, toWorkflowAccess(user));
  }

  /**
   * `GET /runs/:id1/compare/:id2` — сравнение двух запусков (v1.4.0 S2,
   * DESIGN V140 § 3.2).
   *
   * Отдаёт оба запуска в лёгкой проекции истории и поузловые различия:
   * статусы, длительности, стоимости (USD) и diff outputs. Доступ проверяется
   * для **обоих** запусков с ролью `editor`; чужой/несуществующий — 404
   * (KI-202). `Cache-Control: no-store` — данные авторизованные.
   *
   * `outputsDiff` ограничен 100 КБ на узел; обрезка помечается в конце строки
   * (DESIGN § 7). Ручка не меняет состояние — только читает.
   *
   * @param params - path-параметры `id1`/`id2` (uuid запусков)
   * @param user - пользователь и его организация из access-токена
   * @returns запуски и различия (`nodeDiffs`, `totalDiff`)
   * @throws NotFoundException если хотя бы один запуск не найден, чужой,
   *   другой организации или доступен только `viewer`
   */
  @Get(':id1/compare/:id2')
  @Header('Cache-Control', 'no-store')
  async compare(
    @Param(ZodValidationPipe.create(CompareRunsParamSchema))
    params: CompareRunsParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunCompareResponse> {
    return this.runsService.compareRunsAsync(
      params.id1,
      params.id2,
      toWorkflowAccess(user),
    );
  }

  /**
   * `GET /runs/:id/nodes` — история узлов запуска (v0.11 S12, KI-077).
   *
   * Отдельная ручка, а не расширение `RunResponse` полем `nodes`: `GET /runs/:id`
   * остаётся дешёвым для поллинга, а массив `node_runs` запрашивается только
   * при восстановлении старого запуска после F5. Ответ — массив
   * `NodeRunSnapshot`, **тот же**, что приходит в SSE-снимке (DESIGN § 3.4.2),
   * поэтому фронтенду не нужен второй формат.
   *
   * Маршрут объявлен до `:id`: порядок фиксируем явно, чтобы Nest не пытался
   * матчить `nodes` как часть `:id` (сейчас спасает число сегментов, но
   * полагаться на это не стоит).
   *
   * `Cache-Control: no-store` — данные авторизованные и меняются во время
   * запуска, кэшировать их нельзя.
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - пользователь и его организация из access-токена (S2)
   * @returns узлы запуска (пустой массив — у запуска ещё нет строк в `node_runs`)
   * @throws NotFoundException если запуск не найден, чужой или другой организации (KI-202)
   */
  @Get(':id/nodes')
  @Header('Cache-Control', 'no-store')
  async findNodes(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<NodeRunSnapshot[]> {
    return this.runsService.listNodeRunsAsync(params.id, toWorkflowAccess(user));
  }

  /**
   * `GET /runs/:id` — текущее состояние запуска.
   *
   * @param params - path-параметр `id` (uuid)
   * @returns публичное представление запуска со статусом 200
   * @throws NotFoundException если запуск не найден
   */
  @Get(':id')
  async findOne(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunResponse> {
    // KI-202: access обязателен — чужой запуск (в т.ч. другой организации)
    // отдаёт 404.
    return this.runsService.getRunAsync(params.id, toWorkflowAccess(user));
  }

  /**
   * `GET /runs/:id/budget` — бюджет запуска для прогресс-бара в TopBar
   * (R7.1, KI-048).
   *
   * Отдельная ручка вместо поля в SSE-снимке: контракт потока
   * (`docs/development/sse-contract.json`, KI-348) в R7.1 не расширяется.
   * Владелец проверяется через {@link RunsService.getRunRowAsync} — чужой
   * запуск отдаёт 404, а не свои траты (KI-202). История узлов
   * (`GET /runs/:id/nodes`, v0.11 S12) здесь не нужна: бюджет обновляется
   * после каждого узла, лишний SELECT + подпись ссылок были бы работой на
   * каждый поллинг.
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - пользователь и его организация из access-токена (S2)
   * @returns лимиты запуска и потраченное (нормализовано в USD)
   * @throws NotFoundException если запуск не найден, чужой или другой организации
   */
  @Get(':id/budget')
  async getBudget(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunBudgetResponse> {
    // KI-450: для проверки существования достаточно строки запуска.
    // `getRunAsync` теперь читает ещё и `node_runs` с переподпиской ссылок —
    // для поллинга бюджета (после каждого узла) это лишняя работа.
    // S2: access с orgId — запуск другой организации тоже 404.
    await this.runsService.getRunRowAsync(params.id, toWorkflowAccess(user));

    const check = await this.costBudget.checkBudgetAsync(params.id);

    return {
      ok: check.ok,
      accumulated: check.accumulated,
      estimated: check.estimated,
      remaining: check.remaining,
      maxUsd: check.maxUsd,
      maxRub: check.maxRub,
      mode: check.mode,
    };
  }

  /**
   * `GET /runs/:id/stream` — SSE-поток прогресса запуска (R4.1a).
   *
   * Первым сообщением приходит `snapshot` (текущий запуск + все `node_runs`,
   * KI-049), далее — события прогресса из Redis pub/sub. Поток завершается
   * после `run_completed` либо при отключении клиента: Nest аборит сигнал, и
   * подписка на Redis закрывается (RULES 4.19, 4.20).
   *
   * Существование запуска проверяется до открытия потока: иначе клиент получил
   * бы `200 text/event-stream` без сообщений вместо честного 404.
   *
   * @param params - path-параметр `id` (uuid)
   * @param signal - `AbortSignal` запроса, который Nest аборит при отключении
   * @returns поток SSE-сообщений (`data` — JSON `RunStreamMessage`)
   * @throws NotFoundException если запуск не найден
   */
  @Get(':id/stream')
  @Sse()
  async streamRun(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @SseSignal() signal: AbortSignal,
    @CurrentUser() user: JwtPayload,
  ): Promise<Observable<MessageEvent>> {
    // KI-202: проверка владельца до открытия потока (иначе чужой run утекал бы).
    // v1.0.0 S2: access содержит orgId — запуск другой организации тоже 404.
    const access = toWorkflowAccess(user);

    await this.runsStreamService.assertRunExistsAsync(params.id, access);

    return this.runsStreamService.streamAsync(params.id, signal, access);
  }
}

/**
 * HTTP-контроллер истории запусков workflow (v0.14 S1, DESIGN V014 § 3.1).
 *
 * **Почему отдельный класс, а не метод в {@link RunsController}.** Контракт
 * DESIGN задаёт маршрут `GET /workflow/:id/runs`, а `RunsController` целиком
 * висит на префиксе `/runs`; у одного класса в Nest ровно один `@Controller`
 * prefix. Класс живёт в этом же файле и в `RunsModule`, потому что истории
 * нужен `RunsService` (а не `WorkflowService`, который импортирует
 * `RunsModule` — импорт в обратную сторону дал бы циклическую зависимость).
 */
@UseGuards(JwtAuthGuard)
@Controller('workflow/:id/runs')
export class RunsHistoryController {
  constructor(private readonly runsService: RunsService) {}

  /**
   * `GET /workflow/:id/runs?limit=20&cursor=…` — история запусков workflow.
   *
   * С v0.16 S1 (KI-542) пагинация — keyset по курсору последнего элемента
   * (`RunSummary.cursor`), а не `offset`: offset-окно сдвигалось при появлении
   * новых запусков. `total` остаётся для счётчика «загружено N из M».
   * `Cache-Control: no-store` — данные авторизованные и меняются по мере
   * выполнения запусков.
   *
   * @param params - path-параметр `id` (uuid workflow)
   * @param query - `limit` (1..100, по умолчанию 20) и `cursor` (из ответа истории)
   * @param user - пользователь и его организация из access-токена (S2)
   * @returns запуски страницы и общее число запусков
   * @throws NotFoundException если workflow не найден, чужой, другой организации
   *   или только `viewer`
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async listRuns(
    @Param(ZodValidationPipe.create(WorkflowIdParamSchema)) params: WorkflowIdParamDto,
    @Query(ZodValidationPipe.create(RunHistoryQuerySchema)) query: RunHistoryQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunHistoryResponse> {
    // Zod-схема уже проверила декодируемость курсора; декодер — чистый и
    // синхронный (RULES 1.4: это не I/O).
    const cursor =
      query.cursor === undefined
        ? undefined
        : decodeRunHistoryCursor(query.cursor);

    return this.runsService.listRunsAsync(
      params.id,
      toWorkflowAccess(user),
      query.limit,
      cursor,
    );
  }
}
