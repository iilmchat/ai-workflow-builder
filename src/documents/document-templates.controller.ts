import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DOCUMENT_TEMPLATE_MAX_BYTES } from './document-template.constants.js';
import { DocumentTemplatesService } from './document-templates.service.js';
import { DOCX_MIME_TYPE } from './document.service.js';
import {
  UploadDocumentTemplateSchema,
  type DocumentTemplateSummary,
  type UploadDocumentTemplateDto,
  type UploadedFileLike,
} from './dto/document-template.dto.js';

/** Zod-схема path-параметра `:id` (workflow). */
const WorkflowParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
});

/** Валидированный path-параметр `:id`. */
type WorkflowParamDto = z.infer<typeof WorkflowParamSchema>;

/** Zod-схема path-параметров `:id` + `:templateId`. */
const TemplateParamSchema = z.object({
  id: z.uuid('id должен быть валидным UUID'),
  templateId: z.uuid('templateId должен быть валидным UUID'),
});

/** Валидированные path-параметры `:id` + `:templateId`. */
type TemplateParamDto = z.infer<typeof TemplateParamSchema>;

/**
 * API загрузки и управления DOCX-шаблонами (v0.11 S3, DESIGN § 3.1.5).
 *
 * Маршруты — под `/workflow/:id/document-templates`, поэтому права
 * проверяются тем же `workflowAccessFilter`, что и остальной workflow API
 * (в сервисе): `viewer` — чтение, `editor` — загрузка/удаление. Чужой
 * workflow даёт 404, `viewer` на изменяющей ручке — 403.
 *
 * **Multer.** `FileInterceptor` из `@nestjs/platform-express` использует memory
 * storage, поэтому `file.buffer` доступен без временных файлов (DESIGN § 3.1.5).
 * Лимит `fileSize` — из `DOCUMENT_TEMPLATE_MAX_BYTES`; при превышении multer
 * бросает `MulterError` с `code='LIMIT_FILE_SIZE'`, а Nest **сам** превращает
 * его в `PayloadTooLargeException` (413) внутри своего `transformException`
 * (`@nestjs/platform-express/multer/multer.utils`). Отдельный catch нужен был
 * бы только для старого Nest, поэтому здесь его нет — поведение зафиксировано
 * тестом 413.
 */
@UseGuards(JwtAuthGuard)
@Controller('workflow/:id/document-templates')
export class DocumentTemplatesController {
  /**
   * @param templates - CRUD-сервис шаблонов (права, валидация, БД)
   */
  constructor(private readonly templates: DocumentTemplatesService) {}

  /**
   * `GET /workflow/:id/document-templates` — список шаблонов workflow.
   *
   * @param params - path-параметр `id` (uuid workflow)
   * @param user - пользователь из access-токена
   * @returns шаблоны без содержимого, сначала новые
   * @throws NotFoundException если workflow не существует или недоступен
   */
  @Get()
  async listAsync(
    @Param(ZodValidationPipe.create(WorkflowParamSchema)) params: WorkflowParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentTemplateSummary[]> {
    return this.templates.listAsync(params.id, user.sub);
  }

  /**
   * `POST /workflow/:id/document-templates` — загрузка `.docx`-шаблона.
   *
   * Файл читается в память (лимит 5 МБ), валидируется как OOXML и
   * компилируется docxtemplater до INSERT: битый шаблон не должен попасть в БД.
   *
   * @param params - path-параметр `id` (uuid workflow)
   * @param file - multipart-поле `file` (memory storage)
   * @param body - поле `name` (необязательно), валидированное Zod
   * @param user - пользователь из access-токена
   * @returns созданный шаблон со статусом 201
   * @throws BadRequestException если файла нет или шаблон невалиден
   * @throws PayloadTooLargeException если файл больше лимита (413)
   * @throws NotFoundException/ForbiddenException если нет доступа (404/403)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DOCUMENT_TEMPLATE_MAX_BYTES, files: 1 },
    }),
  )
  async uploadAsync(
    @Param(ZodValidationPipe.create(WorkflowParamSchema)) params: WorkflowParamDto,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body(ZodValidationPipe.create(UploadDocumentTemplateSchema))
    body: UploadDocumentTemplateDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentTemplateSummary> {
    if (file === undefined) {
      throw new BadRequestException('Файл шаблона обязателен (поле file)');
    }

    return this.templates.createAsync(params.id, user.sub, file, body);
  }

  /**
   * `GET /workflow/:id/document-templates/:templateId/file` — скачивание.
   *
   * @param params - path-параметры `id` и `templateId` (uuid)
   * @param user - пользователь из access-токена (права viewer)
   * @returns поток DOCX с `Content-Type` и именем файла
   * @throws NotFoundException если workflow/шаблон не найдены
   */
  @Get(':templateId/file')
  async downloadAsync(
    @Param(ZodValidationPipe.create(TemplateParamSchema)) params: TemplateParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<StreamableFile> {
    const file = await this.templates.getFileAsync(
      params.templateId,
      params.id,
      user.sub,
    );

    return new StreamableFile(file.content, {
      type: DOCX_MIME_TYPE,
      length: file.bytes,
      // RFC 5987: имя может быть на кириллице, поэтому filename* с
      // percent-encoding, а не сырой заголовок.
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
  }

  /**
   * `DELETE /workflow/:id/document-templates/:templateId` — удаление шаблона.
   *
   * @param params - path-параметры `id` и `templateId` (uuid)
   * @param user - пользователь из access-токена (права editor)
   * @returns пустой ответ со статусом 204
   * @throws NotFoundException если workflow/шаблон не найдены
   * @throws ForbiddenException если доступ только на чтение (`viewer`)
   */
  @Delete(':templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAsync(
    @Param(ZodValidationPipe.create(TemplateParamSchema)) params: TemplateParamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.templates.deleteAsync(params.templateId, params.id, user.sub);
  }
}
