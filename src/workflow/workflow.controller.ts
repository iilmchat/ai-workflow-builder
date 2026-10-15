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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { Workflow } from '../db/schema.js';
import {
  CreateWorkflowSchema,
  ListWorkflowsQuerySchema,
  UpdateWorkflowSchema,
  ImportWorkflowSchema,
  type CreateWorkflowDto,
  type ExportWorkflowDto,
  type ImportWorkflowDto,
  type ListWorkflowsQueryDto,
  type ShareTokenDto,
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
 *
 * R6.1a: контроллер целиком закрыт JwtAuthGuard, владелец берётся из токена
 * (`@CurrentUser`), а не из тела/query — клиент не может выбрать чужой
 * `userId`.
 */
@UseGuards(JwtAuthGuard)
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  /**
   * `POST /workflow` — создаёт workflow.
   *
   * @param dto - тело запроса, валидированное по CreateWorkflowSchema
   * @param user - владелец из access-токена
   * @returns созданный workflow со статусом 201
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(ZodValidationPipe.create(CreateWorkflowSchema)) dto: CreateWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Workflow> {
    // Владелец — только из токена (R6.1a); в body его больше нет (KI-204).
    return this.workflowService.createAsync(dto, user.sub);
  }

  /**
   * `GET /workflow` — список workflow с фильтром по владельцу и пагинацией.
   *
   * @param query - query-параметры `limit`, `offset` (устаревший `userId`
   *   игнорируется: список ограничен владельцем токена)
   * @param user - владелец из access-токена
   * @returns массив workflow (сначала новые)
   */
  @Get()
  async findAll(
    @Query(ZodValidationPipe.create(ListWorkflowsQuerySchema)) query: ListWorkflowsQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Workflow[]> {
    return this.workflowService.findAllAsync(user.sub, query.limit, query.offset);
  }

  /**
   * `POST /workflow/import` — создаёт workflow из экспортированного артефакта
   * (R6.6.1, DESIGN v0.8 § 9).
   *
   * Объявлен **до** параметрических маршрутов (`:id`, `:id/share`) сознательно:
   * Nest сопоставляет маршруты в порядке объявления, и хотя `import` — это
   * отдельный статический сегмент (конфликта с `:id` нет: у `:id` тоже один
   * сегмент, но `POST /workflow/import` попал бы в `@Post(':id')`, если такой
   * появится позже), порядок «сначала статика, потом параметры» избавляет от
   * сюрпризов при добавлении новых ручек.
   *
   * Владелец берётся из токена: `userId` в артефакте отсутствует по построению,
   * и подставить чужого владельца через body невозможно.
   *
   * @param dto - тело запроса, валидированное по ImportWorkflowSchema
   * @param user - владелец нового workflow из access-токена
   * @returns созданный workflow со статусом 201
   */
  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  async importAsync(
    @Body(ZodValidationPipe.create(ImportWorkflowSchema)) dto: ImportWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Workflow> {
    return this.workflowService.importAsync(dto, user.sub);
  }

  /**
   * `GET /workflow/:id/export` — выгружает workflow владельца в sharable JSON
   * (R6.6.1, DESIGN v0.8 § 9).
   *
   * Ответ — сам артефакт, без envelope. `id`/`userId`/`shareToken`/`createdAt`
   * в него не попадают: служебные поля не выбираются из БД (см.
   * `WorkflowService.exportAsync`), поэтому утечка capability-токена исключена
   * структурно, а не фильтрацией после выборки.
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - владелец из access-токена
   * @returns артефакт `{ version, name, nodes, edges, exportedAt }`
   * @throws NotFoundException если workflow не существует или чужой
   */
  @Get(':id/export')
  @HttpCode(HttpStatus.OK)
  async exportAsync(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ExportWorkflowDto> {
    return this.workflowService.exportAsync(params.id, user.sub);
  }

  /**
   * `GET /workflow/:id` — один workflow по идентификатору.
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - владелец из access-токена
   * @returns найденный workflow
   * @throws NotFoundException если workflow не найден
   */
  @Get(':id')
  async findOne(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Workflow> {
    const workflow = await this.workflowService.findOneAsync(params.id, user.sub);

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
   * @param user - владелец из access-токена
   * @returns обновлённый workflow
   * @throws NotFoundException если workflow не найден
   */
  @Patch(':id')
  async update(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @Body(ZodValidationPipe.create(UpdateWorkflowSchema)) dto: UpdateWorkflowDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Workflow> {
    const updated = await this.workflowService.updateAsync(params.id, dto, user.sub);

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
   * @param user - владелец из access-токена
   * @returns пустой ответ со статусом 204
   * @throws NotFoundException если workflow не найден
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    const removed = await this.workflowService.removeAsync(params.id, user.sub);

    if (!removed) {
      throw new NotFoundException(`Workflow ${params.id} не найден`);
    }
  }

  /**
   * `POST /workflow/:id/share` — создаёт или перевыпускает share-ссылку.
   *
   * Guard уже стоит на классе, поэтому дополнительный `@UseGuards` не нужен.
   * Токен возвращается владельцу один раз и в логи не пишется (RULES 5.9).
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - владелец из access-токена
   * @returns токен и относительная ссылка
   * @throws NotFoundException если workflow не найден или чужой
   */
  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  async share(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ShareTokenDto> {
    return this.workflowService.createShareTokenAsync(params.id, user.sub);
  }

  /**
   * `DELETE /workflow/:id/share` — отзывает share-ссылку (`share_token = NULL`).
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - владелец из access-токена
   * @returns пустой ответ со статусом 204
   * @throws NotFoundException если workflow не найден или чужой
   */
  @Delete(':id/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unshare(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.workflowService.revokeShareTokenAsync(params.id, user.sub);
  }
}
