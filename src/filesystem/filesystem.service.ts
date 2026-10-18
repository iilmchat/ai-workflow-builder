import { Injectable } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep, win32 } from 'node:path';
import {
  FileTooLargeException,
  PathTraversalException,
} from './filesystem.errors.js';

/**
 * Жёсткий предел размера файла workspace — 5 МБ (v0.10 S7).
 *
 * Ограничение защищает память worker'а и диск: узел `read_file` не должен
 * вычитывать гигабайтный CSV, а `write_file` — записывать его. Проверяется
 * в обе стороны: `stat.size` перед чтением и байты UTF-8 перед записью.
 */
export const FILESYSTEM_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Короткий псевдоним лимита (удобен в тестах и сообщениях об ошибках). */
export const MAX_FILE_BYTES = FILESYSTEM_MAX_FILE_BYTES;

/**
 * Безопасный доступ узлов `read_file`/`write_file` к файловому workspace
 * (v0.10 S7, RULES 4.38).
 *
 * Единственная точка, где путь пользователя превращается в путь файловой
 * системы. Узлы передают **относительный** путь внутри workspace конкретного
 * workflow, а сервис:
 * 1. строит корень `path.resolve(process.cwd(), 'data', 'workspace', workflowId)`;
 * 2. отвергает абсолютные пути и `..`-сегменты;
 * 3. после `path.resolve` проверяет, что итог не вышел за корень;
 * 4. ограничивает размер файла 5 МБ;
 * 5. создаёт недостающие директории только при записи (`recursive: true`).
 *
 * `workflowId` тоже проверяется: это сегмент пути, а не произвольная строка.
 * Он приходит из `workflow_runs.workflow_id` (uuid), но защита не полагается
 * на доверие к БД — `..` или `/` в идентификаторе вывели бы корень за
 * `data/workspace`.
 */
@Injectable()
export class FilesystemService {
  /** Предел размера файла для этого сервиса (5 МБ). */
  static readonly MAX_FILE_BYTES = FILESYSTEM_MAX_FILE_BYTES;

  /**
   * Читает текстовый файл из workspace workflow.
   *
   * @param workflowId - uuid workflow (корень `./data/workspace/{workflowId}`)
   * @param filePath - относительный путь внутри workspace
   * @returns содержимое файла в UTF-8
   * @throws PathTraversalException если путь абсолютный/выходит за workspace
   * @throws FileTooLargeException если файл больше 5 МБ
   * @throws Error если файла нет, нет прав или путь указывает на каталог
   */
  async readFileAsync(workflowId: string, filePath: string): Promise<string> {
    const target = this.resolveSafePath(workflowId, filePath);

    // Размер проверяется до чтения: иначе большой файл уже оказался бы в
    // памяти worker'а, и лимит защищал бы только ответ узла, а не процесс.
    const stats = await stat(target);

    if (stats.size > FILESYSTEM_MAX_FILE_BYTES) {
      throw new FileTooLargeException(stats.size, FILESYSTEM_MAX_FILE_BYTES);
    }

    const content = await readFile(target, 'utf8');

    // Повторная проверка уже прочитанного текста: файл мог вырасти между
    // `stat` и `readFile` (TOCTOU). Стоимость — один `Buffer.byteLength`.
    const bytes = Buffer.byteLength(content, 'utf8');

    if (bytes > FILESYSTEM_MAX_FILE_BYTES) {
      throw new FileTooLargeException(bytes, FILESYSTEM_MAX_FILE_BYTES);
    }

    return content;
  }

  /**
   * Записывает текстовый файл в workspace workflow.
   *
   * Недостающие директории создаются рекурсивно — узел `write_file` может
   * писать в `notes/2026-10-18.txt`, не требуя отдельной операции создания
   * каталога. Лимит проверяется **до** `mkdir`/`writeFile`: слишком большой
   * контент не должен оставлять на диске пустые каталоги и частичные файлы.
   *
   * @param workflowId - uuid workflow (корень `./data/workspace/{workflowId}`)
   * @param filePath - относительный путь внутри workspace
   * @param content - текст в UTF-8
   * @throws PathTraversalException если путь абсолютный/выходит за workspace
   * @throws FileTooLargeException если контент больше 5 МБ
   * @throws Error если запись не удалась (нет прав, диск заполнен, …)
   */
  async writeFileAsync(
    workflowId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    if (typeof content !== 'string') {
      throw new TypeError('FilesystemService: content должен быть строкой');
    }

    const target = this.resolveSafePath(workflowId, filePath);

    const bytes = Buffer.byteLength(content, 'utf8');

    if (bytes > FILESYSTEM_MAX_FILE_BYTES) {
      throw new FileTooLargeException(bytes, FILESYSTEM_MAX_FILE_BYTES);
    }

    // RULES 4.38: каталоги создаются только внутри проверенного workspace —
    // `target` уже гарантированно лежит под `data/workspace/{workflowId}`.
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  /**
   * Строит абсолютный путь и проверяет его принадлежность workspace.
   *
   * Порядок важен: сначала отсекаются заведомо опасные формы (абсолютный путь,
   * NUL, `..`-сегменты), затем `path.resolve`, затем граница корня. Проверка
   * через `startsWith(basePath + sep)` (а не просто `startsWith(basePath)`)
   * не даёт соседнему каталогу `{workflowId}-evil` притвориться workspace'ом.
   *
   * @param workflowId - идентификатор workflow (один безопасный сегмент пути)
   * @param filePath - относительный путь из `data.path`
   * @returns абсолютный путь внутри workspace
   * @throws PathTraversalException если путь небезопасен
   */
  private resolveSafePath(workflowId: string, filePath: string): string {
    const basePath = this.resolveBasePath(workflowId);

    if (
      typeof filePath !== 'string' ||
      filePath.length === 0 ||
      filePath.includes('\0')
    ) {
      throw new PathTraversalException(filePath);
    }

    // Абсолютные пути отвергаются явно, даже если случайно указывают внутрь
    // workspace: узел обязан работать только с относительным путём (RULES 4.38).
    // `win32.isAbsolute` нужен и на POSIX: `C:\…`/UNC — это атака, а не имя файла.
    if (isAbsolute(filePath) || win32.isAbsolute(filePath)) {
      throw new PathTraversalException(filePath);
    }

    // На Windows `\` — разделитель, на POSIX — обычный символ. Приводим оба
    // варианта к разделителю платформы, чтобы `..\..\secret` не проскочил на
    // Linux/macOS как «имя файла».
    const normalizedPath = filePath.replace(/[\\/]+/g, sep);
    const target = resolve(basePath, normalizedPath);

    if (target !== basePath && !target.startsWith(basePath + sep)) {
      throw new PathTraversalException(filePath);
    }

    return target;
  }

  /**
   * Строит корень workspace workflow и валидирует `workflowId`.
   *
   * @param workflowId - идентификатор workflow из `workflow_runs`
   * @returns `path.resolve(process.cwd(), 'data', 'workspace', workflowId)`
   * @throws PathTraversalException если `workflowId` — не один сегмент пути
   */
  private resolveBasePath(workflowId: string): string {
    if (
      typeof workflowId !== 'string' ||
      workflowId.length === 0 ||
      workflowId === '.' ||
      workflowId === '..' ||
      workflowId.includes('\0') ||
      workflowId.includes('/') ||
      workflowId.includes('\\') ||
      // `C:`/`C:foo` на Windows — drive-relative путь, тоже выход из workspace.
      workflowId.includes(':')
    ) {
      throw new PathTraversalException(workflowId);
    }

    return resolve(process.cwd(), 'data', 'workspace', workflowId);
  }
}

// Ошибки реэкспортируются из сервиса, чтобы потребителям (в том числе тестам)
// не нужно было знать про отдельный файл `filesystem.errors.ts`.
export { FileTooLargeException, PathTraversalException } from './filesystem.errors.js';
