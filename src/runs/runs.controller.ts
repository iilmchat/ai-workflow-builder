import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CreateRunSchema, type CreateRunDto } from './dto/index.js';
import { RunsService, type RunResponse } from './runs.service.js';

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
  constructor(private readonly runsService: RunsService) {}

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
}
