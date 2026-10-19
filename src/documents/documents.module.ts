import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentTemplateService } from './document-template.service.js';
import { DocumentTemplatesController } from './document-templates.controller.js';
import { DocumentTemplatesService } from './document-templates.service.js';
import { DocumentService } from './document.service.js';

/**
 * Модуль генерации документов (v0.10 S6; шаблоны — v0.11 S2/S3).
 *
 * Три сервиса с разной ответственностью:
 * - `DocumentService` — чистый рендерер Markdown/JSON → DOCX (`docx`);
 * - `DocumentTemplateService` — чистый рендерер/инспектор DOCX-шаблонов
 *   (`docxtemplater` + `pizzip`), не знает о БД;
 * - `DocumentTemplatesService` — CRUD шаблонов, права и `loadAsync` из БД для
 *   исполнителя узла (S4), не знает о `docxtemplater`.
 *
 * Модуль экспортирует сервисы: `RunsModule` собирает `ExecutionEngineService`
 * и передаёт их исполнителям. `AuthModule` импортируется ради `JwtAuthGuard`
 * контроллера шаблонов (guard инжектит `JwtService`/`ConfigService`).
 */
@Module({
  imports: [AuthModule],
  controllers: [DocumentTemplatesController],
  providers: [
    DocumentService,
    DocumentTemplateService,
    DocumentTemplatesService,
  ],
  exports: [DocumentService, DocumentTemplateService, DocumentTemplatesService],
})
export class DocumentsModule {}
