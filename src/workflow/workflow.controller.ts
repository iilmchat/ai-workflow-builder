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
  InviteCollaboratorSchema,
  ListWorkflowsQuerySchema,
  UpdateCollaboratorRoleSchema,
  UpdateWorkflowSchema,
  ImportWorkflowSchema,
  type CollaboratorResponse,
  type CreateWorkflowDto,
  type ExportWorkflowDto,
  type ImportWorkflowDto,
  type InviteCollaboratorDto,
  type ListWorkflowsQueryDto,
  type ShareTokenDto,
  type UpdateCollaboratorRoleDto,
  type UpdateWorkflowDto,
} from './dto/index.js';
import { WorkflowService } from './workflow.service.js';

/** Zod-схема path-параметра `:id`. */
const UuidParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
});

/** Валидированный path-параметр `:id`. */
type UuidParamDto = z.infer<typeof UuidParamSchema>;

/** Zod-схема path-параметров `:id` + `:userId` (участники, R7.6). */
const CollaboratorParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
  userId: z.uuid('userId должен быть валидным UUID'),
});

/** Валидированные path-параметры `:id` + `:userId`. */
type CollaboratorParamDto = z.infer<typeof CollaboratorParamSchema>;

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
   * `GET /workflow/:id/collaborators` — участники workflow (R7.6).
   *
   * Список доступен владельцу и любому участнику: это чтение, viewer его тоже
   * видит. Чужой или несуществующий workflow — 404 (KI-202).
   *
   * @param params - path-параметр `id` (uuid)
   * @param user - пользователь из access-токена
   * @returns участники, отсортированные по дате приглашения
   * @throws NotFoundException если workflow недоступен
   */
  @Get(':id/collaborators')
  async getCollaborators(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CollaboratorResponse[]> {
    return this.workflowService.getCollaboratorsAsync(params.id, user.sub);
  }

  /**
   * `POST /workflow/:id/collaborators` — пригласить участника по uuid (R7.6).
   *
   * Только владелец: участник с ролью `editor` не может приглашать других
   * (DESIGN v0.9 § 3.6). Владелец берётся из токена, `invitedBy` клиентом не
   * задаётся.
   *
   * @param params - path-параметр `id` (uuid)
   * @param dto - тело `{ userId, role }`, валидированное Zod
   * @param user - пользователь из access-токена (должен быть владельцем)
   * @returns созданное участие со статусом 201
   * @throws NotFoundException если workflow чужой или пользователь не найден
   * @throws BadRequestException если приглашают владельца
   * @throws ConflictException если пользователь уже участвует
   */
  @Post(':id/collaborators')
  @HttpCode(HttpStatus.CREATED)
  async inviteCollaborator(
    @Param(ZodValidationPipe.create(UuidParamSchema)) params: UuidParamDto,
    @Body(ZodValidationPipe.create(InviteCollaboratorSchema)) dto: InviteCollaboratorDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CollaboratorResponse> {
    return this.workflowService.inviteCollaboratorAsync(params.id, user.sub, dto);
  }

  /**
   * `PATCH /workflow/:id/collaborators/:userId` — сменить роль участника (R7.6).
   *
   * Только владелец. `userId` — из path, роль — из body.
   *
   * @param params - path-параметры `id` и `userId` (uuid)
   * @param dto - тело `{ role }`, валидированное Zod
   * @param user - пользователь из access-токена (должен быть владельцем)
   * @returns обновлённое участие
   * @throws NotFoundException если workflow чужой или участник не найден
   */
  @Patch(':id/collaborators/:userId')
  async updateCollaboratorRole(
    @Param(ZodValidationPipe.create(CollaboratorParamSchema)) params: CollaboratorParamDto,
    @Body(ZodValidationPipe.create(UpdateCollaboratorRoleSchema)) dto: UpdateCollaboratorRoleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CollaboratorResponse> {
    return this.workflowService.updateCollaboratorRoleAsync(
      params.id,
      user.sub,
      params.userId,
      dto,
    );
  }

  /**
   * `DELETE /workflow/:id/collaborators/:userId` — убрать участника (R7.6).
   *
   * Только владелец. Удаление участия не удаляет запуски workflow: они
   * принадлежат графу, а не участнику.
   *
   * @param params - path-параметры `id` и `userId` (uuid)
   * @param user - пользователь из access-токена (должен быть владельцем)
   * @returns пустой ответ со статусом 204
   * @throws NotFoundException если workflow чужой или участник не найден
   */
  @Delete(':id/collaborators/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCollaborator(
    @Param(ZodValidationPipe.create(CollaboratorParamSchema)) params: CollaboratorParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.workflowService.removeCollaboratorAsync(params.id, user.sub, params.userId);
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
