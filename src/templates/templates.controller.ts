import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { Workflow } from '../db/schema.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import type { TemplateSummary } from './dto/template.dto.js';
import { TemplateLoaderService } from './template-loader.service.js';

/**
 * Zod-схема path-параметра `:id` шаблона.
 *
 * Это **не** uuid, а слаг вида `text-llm` (имя файла в `src/templates`), поэтому
 * проверяется не формат uuid, а безопасный набор символов: слаг попадает в имя
 * файла и в ключ реестра, и любые `/`, `..` или пробелы здесь недопустимы
 * (RULES 1.9 — явные проверки путей).
 */
const TemplateIdParamSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'id шаблона — только строчные латинские буквы, цифры и дефис',
    ),
});

/** Валидированный path-параметр `:id`. */
type TemplateIdParamDto = z.infer<typeof TemplateIdParamSchema>;

/**
 * HTTP-контроллер шаблонов workflow (R6.6.1, DESIGN v0.8 § 9).
 *
 * Префикс маршрутов — `/templates`. Контроллер целиком закрыт `JwtAuthGuard`:
 * список шаблонов — часть поставки, но инстанцирование создаёт запись у
 * конкретного пользователя, поэтому оба маршрута требуют токен (как
 * `WorkflowController`).
 *
 * Список отдаётся **без envelope**: ответ — голый массив `TemplateSummary[]`,
 * как и у `GET /workflow` (RULES 1.6 — единый формат ошибок, но не успешных
 * ответов).
 */
@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templateLoader: TemplateLoaderService,
    private readonly workflowService: WorkflowService,
  ) {}

  /**
   * `GET /templates` — краткий список доступных шаблонов.
   *
   * @returns карточки шаблонов без графов (отсортированы по id)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async listAsync(): Promise<TemplateSummary[]> {
    return this.templateLoader.listAsync();
  }

  /**
   * `POST /templates/:id/instantiate` — создаёт workflow из шаблона.
   *
   * Тело запроса не читается: имя, узлы и связи берутся из шаблона целиком.
   * Переименование — отдельный `PATCH /workflow/:id` после создания, иначе
   * пришлось бы валидировать «частичный шаблон» вторым набором правил.
   *
   * Внутри переиспользуется {@link WorkflowService.importAsync}: шаблон — тот
   * же sharable-артефакт, что отдаёт `GET /workflow/:id/export`, поэтому
   * «создать из шаблона» и «импортировать файл» — одна операция с разным
   * источником данных.
   *
   * @param params - path-параметр `id` (слаг шаблона)
   * @param user - владелец нового workflow из access-токена
   * @returns созданный workflow со статусом 201
   * @throws NotFoundException если шаблона с таким id нет
   */
  @Post(':id/instantiate')
  @HttpCode(HttpStatus.CREATED)
  async instantiateAsync(
    @Param(ZodValidationPipe.create(TemplateIdParamSchema)) params: TemplateIdParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<Workflow> {
    const template = await this.templateLoader.getAsync(params.id);

    if (template === null) {
      throw new NotFoundException(`Шаблон ${params.id} не найден`);
    }

    return this.workflowService.importAsync(template, user.sub);
  }
}
