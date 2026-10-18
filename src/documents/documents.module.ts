import { Module } from '@nestjs/common';
import { DocumentService } from './document.service.js';

/**
 * Модуль генерации документов (v0.10 S6).
 *
 * `DocumentService` — чистый рендерер Markdown/JSON → DOCX. Он не знает ни о
 * `node_runs`, ни о хранилище, поэтому модуль не импортирует БД и media:
 * оркестрацию (`saveGeneratedAsync`, запись `storage_key`) выполняет
 * `ExecutionEngineService` через исполнитель узла `document_gen`.
 *
 * Сервис экспортируется: `RunsModule` собирает `ExecutionEngineService` и
 * передаёт его исполнителю. Модуль подключён и в `AppModule` — чтобы сервис
 * существовал в корневом графе DI и переиспользовался будущими ручками
 * (превью документа, шаблоны).
 */
@Module({
  providers: [DocumentService],
  exports: [DocumentService],
})
export class DocumentsModule {}
