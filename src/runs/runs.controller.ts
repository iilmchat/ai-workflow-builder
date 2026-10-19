import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { CostBudgetService } from './cost-budget.service.js';
import {
  CreateRunSchema,
  type CreateRunDto,
  type NodeRunSnapshot,
} from './dto/index.js';
import type { RunBudgetResponse } from './dto/run-budget.dto.js';
import { RunsService, type RunResponse } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';

/** Zod-схема path-параметра `:id`. */
const RunIdParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
});

/** Валидированный path-параметр `:id`. */
type RunIdParamDto = z.infer<typeof RunIdParamSchema>;

/**
 * HTTP-контроллер запусков workflow.
 *
 * Префикс маршрутов — `/runs`. Валидация body/param выполняется
 * ZodValidationPipe, ошибки отдаёт глобальный HttpExceptionFilter, поэтому
 * try/catch в контроллере нет (RULES 1.6, 4.7).
 *
 * R6.1a: контроллер закрыт JwtAuthGuard; владелец берётся из токена.
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
   * @param user - владелец из access-токена
   * @returns публичное представление запуска со статусом 201
   * @throws NotFoundException если workflow не найден (или чужой)
   * @throws InternalServerErrorException если очередь недоступна
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(ZodValidationPipe.create(CreateRunSchema)) dto: CreateRunDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunResponse> {
    return this.runsService.createRunAsync(dto, user.sub);
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
   * @param user - владелец из access-токена
   * @returns узлы запуска (пустой массив — у запуска ещё нет строк в `node_runs`)
   * @throws NotFoundException если запуск не найден или чужой (KI-202)
   */
  @Get(':id/nodes')
  @Header('Cache-Control', 'no-store')
  async findNodes(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<NodeRunSnapshot[]> {
    return this.runsService.listNodeRunsAsync(params.id, user.sub);
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
    // KI-202: владелец обязателен — чужой запуск отдаёт 404.
    return this.runsService.getRunAsync(params.id, user.sub);
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
   * @param user - владелец из access-токена
   * @returns лимиты запуска и потраченное (нормализовано в USD)
   * @throws NotFoundException если запуск не найден или чужой
   */
  @Get(':id/budget')
  async getBudget(
    @Param(ZodValidationPipe.create(RunIdParamSchema)) params: RunIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RunBudgetResponse> {
    // KI-450: для проверки существования достаточно строки запуска.
    // `getRunAsync` теперь читает ещё и `node_runs` с переподписью ссылок —
    // для поллинга бюджета (после каждого узла) это лишняя работа.
    await this.runsService.getRunRowAsync(params.id, user.sub);

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
    await this.runsStreamService.assertRunExistsAsync(params.id, user.sub);

    return this.runsStreamService.streamAsync(params.id, signal, user.sub);
  }
}
