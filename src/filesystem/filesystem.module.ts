import { Module } from '@nestjs/common';
import { FilesystemService } from './filesystem.service.js';

/**
 * Модуль безопасной работы с файловым workspace (v0.10 S7).
 *
 * `FilesystemService` — единственное место, где путь пользователя
 * превращается в путь файловой системы (RULES 4.38). Модуль не импортирует
 * БД и очередь: сервис работает только с `node:fs/promises`, поэтому его
 * легко тестировать и переиспользовать будущими ручками (`list_files`).
 *
 * Сервис экспортируется: `RunsModule` собирает `ExecutionEngineService` и
 * передаёт его исполнителям узлов `read_file`/`write_file` (S8).
 */
@Module({
  providers: [FilesystemService],
  exports: [FilesystemService],
})
export class FilesystemModule {}
