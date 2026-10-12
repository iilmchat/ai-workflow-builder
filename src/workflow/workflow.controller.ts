import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { Workflow } from '../db/schema.js';
import {
  CreateWorkflowSchema,
  ListWorkflowsQuerySchema,
  UpdateWorkflowSchema,
  type CreateWorkflowDto,
  type ListWorkflowsQueryDto,
  type UpdateWorkflowDto,
} from './dto/index.js';
import { WorkflowService } from './workflow.service.js';

/** Zod-схема path-параметра `:id`. */
const UuidParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
});

/** Валидированный path-параметр `:id`. */
type UuidParamDto = z.infer<typeof UuidParamSchema>;

/**
 * HTTP-контроллер CRUD-операций над workflow.
 *
 * Префикс маршрутов — `/workflow`. Валидация body/query/param выполняется
 * ZodValidationPipe, поэтому в сервис приходят уже проверенные данные.
 */
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  /**
   * `POST /workflow` — создаёт workflow.
   *
   * @param dto - тело запроса, валидированное по CreateWorkflowSchema
   * @returns созданный workflow со статусом 201
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(ZodValidationPipe.create(CreateWorkflowSchema)) dto: CreateWorkflowDto): Promise<Workflow> {
    return this.workflowService.createAsync(dto);
  }

  /**
   * `GET /workflow` — список workflow с фильтром по владельцу и пагинацией.
   *
   * @param query - query-параметры `userId`, `limit`, `offset`
   * @returns массив workflow (сначала новые)
   */
  @Get()
  async findAll(
    @Query(ZodValidationPipe.create(ListWorkflowsQuerySchema)) query: ListWorkflowsQueryDto,
  ): Promise<Workflow[]> {
    return this.workflowService.findAllAsync(query.userId, query.limit, query.offset);
  }

  /**
   * `GET /workflow/:id` — один workflow по идентификатору.
   *
   * @param params - path-параметр `id` (uuid)
   * @returns найденный workflow
   * @throws NotFoundException если workflow не найден
   */
  @Get(':id')
  async findOne(@Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto): Promise<Workflow> {
    const workflow = await this.workflowService.findOneAsync(params.id);

    if (!workflow) {
      throw new NotFoundException(`Workflow ${params.id} не найден`);
    }

    return workflow;
  }

  /**
   * `PATCH /workflow/:id` — частичное обновление workflow.
   *
   * @param params - path-параметр `id` (uuid)
   * @param dto - тело запроса, валидированное по UpdateWorkflowSchema
   * @returns обновлённый workflow
   * @throws NotFoundException если workflow не найден
   */
  @Patch(':id')
  async update(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @Body(ZodValidationPipe.create(UpdateWorkflowSchema)) dto: UpdateWorkflowDto,
  ): Promise<Workflow> {
    const updated = await this.workflowService.updateAsync(params.id, dto);

    if (!updated) {
      throw new NotFoundException(`Workflow ${params.id} не найден`);
    }

    return updated;
  }

  /**
   * `DELETE /workflow/:id` — удаляет workflow.
   *
   * Связанные запуски удаляются каскадом на уровне БД.
   *
   * @param params - path-параметр `id` (uuid)
   * @returns пустой ответ со статусом 204
   * @throws NotFoundException если workflow не найден
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
  ): Promise<void> {
    const removed = await this.workflowService.removeAsync(params.id);

    if (!removed) {
      throw new NotFoundException(`Workflow ${params.id} не найден`);
    }
  }
}
