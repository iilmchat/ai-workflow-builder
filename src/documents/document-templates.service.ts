import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  documentTemplates,
  workflows,
  type DocumentTemplate,
} from '../db/schema.js';
import {
  workflowAccessFilter,
  type WorkflowAccessRole,
} from '../workflow/workflow-access.js';
import {
  DocumentTemplateInvalidException,
  DocumentTemplateNotFoundException,
} from './document.errors.js';
import {
  DOCUMENT_TEMPLATE_DEFAULT_MAX_BYTES,
  DOCUMENT_TEMPLATE_MAX_PLACEHOLDERS,
} from './document-template.constants.js';
import { DocumentTemplateService } from './document-template.service.js';
import type {
  DocumentTemplateSummary,
  UploadDocumentTemplateDto,
  UploadedFileLike,
} from './dto/document-template.dto.js';
import { DOCX_MIME_TYPE } from './document.service.js';

/**
 * CRUD-сервис DOCX-шаблонов (v0.11 S3, DESIGN § 3.1.5).
 *
 * Отвечает за права (viewer/editor), валидацию загрузки и хранение в
 * PostgreSQL. Рендеринг делегирует {@link DocumentTemplateService}, поэтому
 * `docxtemplater` не попадает в этот сервис, а БД — в рендерер (DESIGN § 3.1.7).
 *
 * **Права.** Список/скачивание — `viewer`; загрузка/удаление — `editor`.
 * Чужой или несуществующий workflow неотличимы и дают 404 (KI-202), а
 * `viewer`, у которого workflow есть, получает 403: он и так знает о
 * существовании графа, скрывать нечего.
 *
 * **Ошибки домена.** Битый/небезопасный шаблон — `BadRequestException` с кодом
 * из {@link DocumentTemplateInvalidException}; превышение размера —
 * `PayloadTooLargeException` (413); лимит шаблонов — 400.
 */
@Injectable()
export class DocumentTemplatesService {
  private readonly logger = new Logger(DocumentTemplatesService.name);

  /** Максимальный размер `.docx` (env `DOCUMENT_TEMPLATE_MAX_BYTES`). */
  private readonly maxBytes: number;

  /** Максимум шаблонов на workflow (env `DOCUMENT_TEMPLATE_MAX_PER_WORKFLOW`). */
  private readonly maxPerWorkflow: number;

  /**
   * @param db - Drizzle-клиент (Singleton из `@Global() DbModule`, RULES 4.10)
   * @param renderer - чистый рендерер/инспектор `docxtemplater`
   * @param config - env через `ConfigService` (RULES 4.6)
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly renderer: DocumentTemplateService,
    private readonly config: ConfigService,
  ) {
    this.maxBytes =
      config.get<number>('DOCUMENT_TEMPLATE_MAX_BYTES') ??
      DOCUMENT_TEMPLATE_DEFAULT_MAX_BYTES;
    this.maxPerWorkflow =
      config.get<number>('DOCUMENT_TEMPLATE_MAX_PER_WORKFLOW') ?? 50;
  }

  /**
   * Загружает `.docx`-шаблон: права editor → валидация → `inspect` → INSERT.
   *
   * Шаблон компилируется **до** INSERT: битый файл не должен попасть в БД, а
   * список плейсхолдеров сохраняется в `placeholders`, чтобы UI не разбирал
   * 5 МБ на каждый `GET`.
   *
   * @param workflowId - uuid workflow из path
   * @param userId - пользователь из access-токена (проверка прав)
   * @param file - загруженный файл (memory storage)
   * @param body - валидированное тело формы (`name` необязательно)
   * @returns публичное представление созданного шаблона
   * @throws NotFoundException если workflow не существует или недоступен
   * @throws ForbiddenException если доступ есть только на чтение (`viewer`)
   * @throws PayloadTooLargeException если файл больше `DOCUMENT_TEMPLATE_MAX_BYTES`
   * @throws BadRequestException если расширение/MIME/размер/ZIP/теги/имя/лимит
   *   шаблонов не проходят проверку
   */
  async createAsync(
    workflowId: string,
    userId: string,
    file: UploadedFileLike,
    body: UploadDocumentTemplateDto,
  ): Promise<DocumentTemplateSummary> {
    await this.assertWorkflowAccessAsync(workflowId, userId, 'editor');

    const upload = this.validateUpload(file, body);
    const placeholders = this.inspectTemplate(upload.content);

    if (placeholders.length > DOCUMENT_TEMPLATE_MAX_PLACEHOLDERS) {
      throw new BadRequestException(
        `В шаблоне слишком много плейсхолдеров: ${placeholders.length} > ${DOCUMENT_TEMPLATE_MAX_PLACEHOLDERS}`,
      );
    }

    await this.assertTemplateLimitAsync(workflowId);

    const bytes = upload.content.byteLength;
    const sha256 = createHash('sha256').update(upload.content).digest('hex');

    const [created] = await this.db
      .insert(documentTemplates)
      .values({
        workflowId,
        createdBy: userId,
        name: upload.name,
        content: upload.content,
        bytes,
        sha256,
        placeholders,
      })
      .returning();

    // RULES 5.9: в лог — метаданные (id/имя/размер/число плейсхолдеров),
    // не содержимое документа и не значения переменных.
    this.logger.log(
      `Загружен шаблон ${created.id} («${upload.name}», ${bytes} байт, ` +
        `плейсхолдеров ${placeholders.length}) в workflow ${workflowId}`,
    );

    return toSummary(created);
  }

  /**
   * Список шаблонов workflow без содержимого.
   *
   * @param workflowId - uuid workflow
   * @param userId - пользователь из access-токена
   * @returns шаблоны workflow, сначала новые
   * @throws NotFoundException если workflow не существует или недоступен
   */
  async listAsync(
    workflowId: string,
    userId: string,
  ): Promise<DocumentTemplateSummary[]> {
    await this.assertWorkflowAccessAsync(workflowId, userId, 'viewer');

    const rows = await this.db
      .select({
        id: documentTemplates.id,
        name: documentTemplates.name,
        bytes: documentTemplates.bytes,
        placeholders: documentTemplates.placeholders,
        createdAt: documentTemplates.createdAt,
      })
      .from(documentTemplates)
      .where(eq(documentTemplates.workflowId, workflowId))
      .orderBy(desc(documentTemplates.createdAt));

    return rows.map(toSummary);
  }

  /**
   * Загружает шаблон для исполнителя узла `document_gen` (S4).
   *
   * Проверяется **принадлежность workflow**: `WHERE id = $templateId AND
   * workflow_id = $runWorkflowId` (DESIGN § 3.1.1), поэтому шаблон чужого
   * workflow неотличим от удалённого — non-retryable
   * {@link DocumentTemplateNotFoundException}. Прав пользователя здесь нет:
   * workflowId берётся из `workflow_runs`, а не из запроса клиента.
   *
   * @param templateId - uuid шаблона из `data.templateId`
   * @param workflowId - uuid workflow запуска
   * @returns имя и содержимое шаблона
   * @throws DocumentTemplateNotFoundException если шаблона нет в этом workflow
   */
  async loadAsync(
    templateId: string,
    workflowId: string,
  ): Promise<{ name: string; content: Buffer }> {
    const [row] = await this.db
      .select({
        name: documentTemplates.name,
        content: documentTemplates.content,
      })
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.id, templateId),
          eq(documentTemplates.workflowId, workflowId),
        ),
      )
      .limit(1);

    if (row === undefined) {
      throw new DocumentTemplateNotFoundException(templateId);
    }

    return { name: row.name, content: row.content };
  }

  /**
   * Отдаёт файл шаблона для скачивания (`GET …/:templateId/file`).
   *
   * @param templateId - uuid шаблона
   * @param workflowId - uuid workflow из path
   * @param userId - пользователь из access-токена (права viewer)
   * @returns имя, содержимое и размер `.docx`
   * @throws NotFoundException если workflow недоступен или шаблона нет
   */
  async getFileAsync(
    templateId: string,
    workflowId: string,
    userId: string,
  ): Promise<{ name: string; content: Buffer; bytes: number }> {
    await this.assertWorkflowAccessAsync(workflowId, userId, 'viewer');

    const [row] = await this.db
      .select({
        name: documentTemplates.name,
        content: documentTemplates.content,
        bytes: documentTemplates.bytes,
      })
      .from(documentTemplates)
      .where(
        and(
          eq(documentTemplates.id, templateId),
          eq(documentTemplates.workflowId, workflowId),
        ),
      )
      .limit(1);

    if (row === undefined) {
      throw new NotFoundException(`Шаблон ${templateId} не найден`);
    }

    return { name: row.name, content: row.content, bytes: row.bytes };
  }

  /**
   * Удаляет шаблон workflow (права editor).
   *
   * @param templateId - uuid шаблона
   * @param workflowId - uuid workflow из path
   * @param userId - пользователь из access-токена (права editor)
   * @returns промис без значения
   * @throws NotFoundException если workflow или шаблон не найдены
   * @throws ForbiddenException если доступ есть только на чтение (`viewer`)
   */
  async deleteAsync(
    templateId: string,
    workflowId: string,
    userId: string,
  ): Promise<void> {
    await this.assertWorkflowAccessAsync(workflowId, userId, 'editor');

    const deleted = await this.db
      .delete(documentTemplates)
      .where(
        and(
          eq(documentTemplates.id, templateId),
          eq(documentTemplates.workflowId, workflowId),
        ),
      )
      .returning({ id: documentTemplates.id });

    if (deleted.length === 0) {
      throw new NotFoundException(`Шаблон ${templateId} не найден`);
    }

    this.logger.log(`Удалён шаблон ${templateId} из workflow ${workflowId}`);
  }

  /**
   * Проверяет доступ к workflow: 404 для чужого, 403 для недостаточной роли.
   *
   * Сначала запрашивается доступ уровня `viewer`: если его нет, workflow
   * неотличим от несуществующего (404, KI-202). Затем — доступ уровня
   * `editor`: если он есть у workflow, но не у пользователя (`viewer`),
   * отдаётся 403 — этот пользователь уже видит workflow в списке, скрывать
   * факт его существования бессмысленно.
   *
   * @param workflowId - uuid workflow
   * @param userId - пользователь из access-токена
   * @param minimumRole - требуемая роль (`viewer` или `editor`)
   * @throws NotFoundException если workflow недоступен пользователю
   * @throws ForbiddenException если доступ есть, но роли недостаточно
   */
  private async assertWorkflowAccessAsync(
    workflowId: string,
    userId: string,
    minimumRole: WorkflowAccessRole,
  ): Promise<void> {
    const [accessible] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(workflowAccessFilter(this.db, workflowId, userId, 'viewer'))
      .limit(1);

    if (accessible === undefined) {
      throw new NotFoundException(`Workflow ${workflowId} не найден`);
    }

    if (minimumRole === 'viewer') {
      return;
    }

    const [editable] = await this.db
      .select({ id: workflows.id })
      .from(workflows)
      .where(workflowAccessFilter(this.db, workflowId, userId, 'editor'))
      .limit(1);

    if (editable === undefined) {
      throw new ForbiddenException(
        'Недостаточно прав: для изменения шаблонов нужна роль editor',
      );
    }
  }

  /**
   * Проверяет лимит шаблонов на workflow до INSERT.
   *
   * @param workflowId - uuid workflow
   * @throws BadRequestException если лимит уже достигнут
   */
  private async assertTemplateLimitAsync(workflowId: string): Promise<void> {
    const rows = await this.db
      .select({ id: documentTemplates.id })
      .from(documentTemplates)
      .where(eq(documentTemplates.workflowId, workflowId));

    if (rows.length >= this.maxPerWorkflow) {
      throw new BadRequestException(
        `Достигнут лимит шаблонов на workflow: ${this.maxPerWorkflow}`,
      );
    }
  }

  /**
   * Валидирует загруженный файл до компиляции шаблона.
   *
   * Проверки DESIGN § 3.1.5 п. 1–2 и 8: расширение `.docx` (case-insensitive),
   * MIME (DOCX или `application/octet-stream`), непустой размер в пределах
   * лимита, имя ≤ 120 символов. Содержимое (сигнатура/ZIP/OOXML/DTD)
   * проверяет `DocumentTemplateService.inspect`.
   *
   * @param file - загруженный файл
   * @param body - валидированное тело формы
   * @returns содержимое и итоговое имя шаблона
   * @throws PayloadTooLargeException если размер больше лимита
   * @throws BadRequestException если файл пуст/не `.docx`/не тот MIME/имя длинное
   */
  private validateUpload(
    file: UploadedFileLike,
    body: UploadDocumentTemplateDto,
  ): { content: Buffer; name: string } {
    const content = file.buffer;
    const bytes = content.byteLength;

    if (bytes === 0) {
      throw new BadRequestException('Файл шаблона пуст');
    }

    if (bytes > this.maxBytes || file.size > this.maxBytes) {
      throw new PayloadTooLargeException(
        `Файл шаблона больше лимита: ${Math.max(bytes, file.size)} байт > ${this.maxBytes} байт`,
      );
    }

    if (!/\.docx$/i.test(file.originalname)) {
      throw new BadRequestException(
        'Шаблон должен быть файлом .docx (макросы .docm не поддерживаются)',
      );
    }

    if (!ALLOWED_TEMPLATE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Неподдерживаемый MIME-тип шаблона: ${file.mimetype}`,
      );
    }

    const name = (body.name ?? basename(file.originalname)).trim();

    if (name.length === 0) {
      throw new BadRequestException('Имя шаблона не может быть пустым');
    }

    if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
      throw new BadRequestException(
        `Имя шаблона длиннее ${MAX_TEMPLATE_NAME_LENGTH} символов`,
      );
    }

    return { content, name };
  }

  /**
   * Компилирует шаблон и возвращает плейсхолдеры, переводя доменную ошибку в 400.
   *
   * @param content - содержимое `.docx`
   * @returns список простых плейсхолдеров
   * @throws BadRequestException если архив/теги битые или небезопасные
   */
  private inspectTemplate(content: Buffer): string[] {
    try {
      return [...this.renderer.inspect(content).placeholders];
    } catch (error: unknown) {
      if (error instanceof DocumentTemplateInvalidException) {
        throw new BadRequestException({
          message: `Некорректный шаблон: ${error.message}`,
          code: error.code,
          details: error.details,
        });
      }

      throw error;
    }
  }
}

/** Допустимые MIME-типы загружаемого шаблона (DESIGN § 3.1.5 п. 1). */
const ALLOWED_TEMPLATE_MIME_TYPES: ReadonlySet<string> = new Set([
  DOCX_MIME_TYPE,
  'application/octet-stream',
]);

/** Максимальная длина имени шаблона (DESIGN § 3.1.5 п. 8). */
const MAX_TEMPLATE_NAME_LENGTH = 120;

/** Минимальный набор полей строки `document_templates` для публичного ответа. */
type DocumentTemplateSummaryRow = Pick<
  DocumentTemplate,
  'id' | 'name' | 'bytes' | 'placeholders' | 'createdAt'
>;

/**
 * Преобразует строку БД в публичное представление.
 *
 * @param row - строка `document_templates` (или проекция без `content`)
 * @returns `DocumentTemplateSummary` без содержимого
 */
function toSummary(row: DocumentTemplateSummaryRow): DocumentTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    bytes: row.bytes,
    placeholders: row.placeholders,
    createdAt: row.createdAt.toISOString(),
  };
}
