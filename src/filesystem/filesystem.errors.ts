/**
 * Ошибки безопасной работы с файловым workspace (v0.10 S7).
 *
 * Живут отдельно от {@link FilesystemService}, чтобы исполнители узлов
 * (`node-executors.ts`) могли различать отказы, не импортируя `node:fs`.
 * Тот же приём, что у `document.errors.ts` и `engine/errors.ts`.
 *
 * Наследуются от `Error`, а не от Nest `HttpException`: чтение/запись идут в
 * worker'е (RULES 4.21), и ошибка должна переводить узел в `failed`, а не
 * превращаться в HTTP-ответ.
 */

/**
 * Путь выходит за пределы workspace workflow (RULES 4.38).
 *
 * Бросается лексической проверкой `FilesystemService`: абсолютный путь,
 * `..`-сегменты, небезопасный `workflowId` либо путь, который после
 * `path.resolve` оказался вне `./data/workspace/{workflowId}/`.
 *
 * В сообщение попадает **только** пользовательский путь: абсолютный путь
 * сервера (корень workspace) наружу не уходит, иначе ошибка узла раскрывала бы
 * структуру файловой системы хоста.
 */
export class PathTraversalException extends Error {
  /**
   * @param filePath - путь из `data.path` (или `workflowId`), не прошедший guard
   */
  constructor(readonly filePath: string) {
    super(`Недопустимый путь в workspace: «${filePath}» (path traversal запрещён)`);
    this.name = 'PathTraversalException';
  }
}

/**
 * Файл превысил предельный размер (v0.10 S7).
 *
 * Лимит — 5 МБ ({@link FILESYSTEM_MAX_FILE_BYTES}). Для чтения размер берётся
 * из `stat` **до** `readFile`: огромный файл не должен попасть в память
 * worker'а. Для записи проверяется длина контента в байтах UTF-8 **до**
 * создания директорий и записи на диск.
 */
export class FileTooLargeException extends Error {
  /**
   * @param bytes - фактический размер файла/контента в байтах
   * @param maxBytes - разрешённый размер в байтах
   */
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
  ) {
    super(`Файл больше лимита: ${bytes} байт > ${maxBytes} байт`);
    this.name = 'FileTooLargeException';
  }
}
