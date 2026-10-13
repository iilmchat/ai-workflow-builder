import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Sse,
  SseSignal,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CreateRunSchema, type CreateRunDto } from './dto/index.js';
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
 */
@Controller('runs')
export class RunsController {
  constructor(
    private readonly runsService: RunsService,
    private readonly runsStreamService: RunsStreamService,
  ) {}

  /**
   * `POST /runs` — создаёт запуск workflow и ставит задание в очередь.
   *
   * @param dto - тело запроса, валидированное по CreateRunSchema
   * @returns публичное представление запуска со статусом 201
   * @throws NotFoundException если workflow не найден (пробрасывается из сервиса)
   * @throws InternalServerErrorException если очередь недоступна
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(ZodValidationPipe.create(CreateRunSchema)) dto: CreateRunDto,
  ): Promise<RunResponse> {
    return this.runsService.createRunAsync(dto);
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
  ): Promise<RunResponse> {
    return this.runsService.getRunAsync(params.id);
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
  ): Promise<Observable<MessageEvent>> {
    await this.runsStreamService.assertRunExistsAsync(params.id);

    return this.runsStreamService.streamAsync(params.id, signal);
  }
}
