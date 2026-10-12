import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { GraphSchema, type GraphDto } from './dto/index.js';
import {
  EngineService,
  type ExecutionPlanDto,
  type GraphValidationResult,
} from './engine.service.js';

/**
 * HTTP-контроллер движка workflow.
 *
 * Префикс маршрутов — `/engine`. Тело запроса валидируется ZodValidationPipe,
 * поэтому в сервис всегда попадает корректный по форме граф.
 */
@Controller('engine')
export class EngineController {
  constructor(private readonly engineService: EngineService) {}

  /**
   * `POST /engine/validate` — проверяет граф и возвращает все найденные проблемы.
   *
   * Всегда отвечает 200: невалидный граф — это результат проверки, а не ошибка
   * запроса. Ошибки формы тела (не тот тип) по-прежнему дают 400 от пайпа.
   *
   * @param graph - тело запроса, валидированное по GraphSchema
   * @returns списки ошибок и предупреждений
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validate(
    @Body(ZodValidationPipe.create(GraphSchema)) graph: GraphDto,
  ): GraphValidationResult {
    return this.engineService.validateGraphAsync(graph);
  }

  /**
   * `POST /engine/sort` — топологический порядок выполнения узлов.
   *
   * @param graph - тело запроса, валидированное по GraphSchema
   * @returns `{ order }` — `id` узлов в порядке выполнения
   * @throws BadRequestException если граф невалиден (цикл, битые связи)
   */
  @Post('sort')
  @HttpCode(HttpStatus.OK)
  async sort(
    @Body(ZodValidationPipe.create(GraphSchema)) graph: GraphDto,
  ): Promise<{ order: string[] }> {
    return { order: await this.engineService.topologicalSortAsync(graph) };
  }

  /**
   * `POST /engine/plan` — план выполнения с уровнями параллелизма.
   *
   * @param graph - тело запроса, валидированное по GraphSchema
   * @returns плоский порядок, уровни и карта выполнения
   * @throws BadRequestException если граф невалиден (цикл, битые связи)
   */
  @Post('plan')
  @HttpCode(HttpStatus.OK)
  async plan(
    @Body(ZodValidationPipe.create(GraphSchema)) graph: GraphDto,
  ): Promise<ExecutionPlanDto> {
    return this.engineService.buildExecutionPlanAsync(graph);
  }
}
