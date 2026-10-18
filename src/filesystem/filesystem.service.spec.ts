import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILESYSTEM_MAX_FILE_BYTES,
  FileTooLargeException,
  FilesystemService,
  PathTraversalException,
} from './filesystem.service.js';

/**
 * Тесты безопасного workspace (v0.10 S7, RULES 4.38).
 *
 * Сервис строит корень от `process.cwd()`, поэтому тест подменяет `cwd`
 * временным каталогом: реальный `data/workspace` репозитория не трогается, а
 * прогон остаётся изолированным (после каждого теста temp удаляется).
 */
describe('FilesystemService (v0.10 S7)', () => {
  /** Временный «корень проекта» для текущего теста. */
  let projectRoot: string;
  /** Сервис под тестом. */
  let service: FilesystemService;
  /** Спай `process.cwd`, чтобы корень workspace указывал в temp. */
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'workflow-filesystem-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    service = new FilesystemService();
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await rm(projectRoot, { recursive: true, force: true });
  });

  /**
   * Возвращает абсолютный путь файла внутри тестового workspace.
   *
   * @param workflowId - идентификатор workflow
   * @param filePath - относительный путь
   * @returns абсолютный путь под `data/workspace/{workflowId}`
   */
  function workspacePath(workflowId: string, filePath: string): string {
    return resolve(projectRoot, 'data', 'workspace', workflowId, filePath);
  }

  describe('чтение и запись', () => {
    it('записывает файл, создаёт вложенные директории и читает его обратно', async () => {
      const filePath = 'notes/2026-10-18.txt';

      await service.writeFileAsync('wf-1', filePath, 'привет');

      // Директория создана рекурсивно (RULES 4.38 / задача S7).
      expect((await stat(workspacePath('wf-1', 'notes'))).isDirectory()).toBe(true);
      expect(await readFile(workspacePath('wf-1', filePath), 'utf8')).toBe('привет');
      expect(await service.readFileAsync('wf-1', filePath)).toBe('привет');
    });

    it('перезаписывает существующий файл', async () => {
      await service.writeFileAsync('wf-1', 'report.json', '{"v":1}');
      await service.writeFileAsync('wf-1', 'report.json', '{"v":2}');

      expect(await service.readFileAsync('wf-1', 'report.json')).toBe('{"v":2}');
    });

    it('читает UTF-8 без искажений', async () => {
      const content = 'строка 1\nстрока 2 — кириллица и эмодзи 🚀';

      await service.writeFileAsync('wf-1', 'unicode.txt', content);

      expect(await service.readFileAsync('wf-1', 'unicode.txt')).toBe(content);
    });

    it('пробрасывает ENOENT, если файла нет (без подмены ошибки)', async () => {
      await expect(service.readFileAsync('wf-1', 'missing.txt')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('изолирует workspace разных workflow', async () => {
      await service.writeFileAsync('wf-1', 'same.txt', 'первый');
      await service.writeFileAsync('wf-2', 'same.txt', 'второй');

      expect(await service.readFileAsync('wf-1', 'same.txt')).toBe('первый');
      expect(await service.readFileAsync('wf-2', 'same.txt')).toBe('второй');
    });
  });

  describe('path traversal guard (RULES 4.38)', () => {
    /** Пути, которые обязаны быть отвергнуты до любой операции с диском. */
    const traversalPaths = [
      '../outside.txt',
      '../../outside.txt',
      '..\\outside.txt',
      'sub/../../outside.txt',
      // Абсолютный путь вне workspace.
      join(tmpdir(), 'outside.txt'),
      // Windows-абсолютные формы, в том числе на POSIX-хосте.
      'C:\\Windows\\win.ini',
      '\\\\server\\share\\secret.txt',
    ];

    it.each(traversalPaths)('отвергает чтение «%s»', async (filePath) => {
      await expect(service.readFileAsync('wf-1', filePath)).rejects.toBeInstanceOf(
        PathTraversalException,
      );
    });

    it.each(traversalPaths)('отвергает запись «%s»', async (filePath) => {
      await expect(
        service.writeFileAsync('wf-1', filePath, 'данные'),
      ).rejects.toBeInstanceOf(PathTraversalException);
    });

    it('не создаёт файл за пределами workspace после отказа', async () => {
      await expect(
        service.writeFileAsync('wf-1', '../escape.txt', 'данные'),
      ).rejects.toBeInstanceOf(PathTraversalException);

      await expect(
        stat(resolve(projectRoot, 'data', 'workspace', 'escape.txt')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('отвергает абсолютный путь даже внутри workspace', async () => {
      const inside = workspacePath('wf-1', 'ok.txt');

      await mkdir(dirname(inside), { recursive: true });
      await writeFile(inside, 'ok', 'utf8');

      // Узел обязан передавать относительный путь (RULES 4.38): абсолютный
      // отвергается явно, а не «прощается» из-за совпадения префикса.
      await expect(service.readFileAsync('wf-1', inside)).rejects.toBeInstanceOf(
        PathTraversalException,
      );
    });

    it('не даёт соседнему каталогу с общим префиксом притвориться workspace', async () => {
      // `data/workspace/wf-1-evil` начинается с `data/workspace/wf-1`, но это
      // другой workflow: проверка границы идёт по разделителю пути.
      const sibling = resolve(projectRoot, 'data', 'workspace', 'wf-1-evil');

      await mkdir(sibling, { recursive: true });
      await writeFile(join(sibling, 'secret.txt'), 'secret', 'utf8');

      await expect(
        service.readFileAsync('wf-1', '../wf-1-evil/secret.txt'),
      ).rejects.toBeInstanceOf(PathTraversalException);
    });

    it('отвергает небезопасный workflowId (а не только filePath)', async () => {
      for (const workflowId of ['..', '../evil', 'wf/other', 'wf\\other', 'C:evil']) {
        await expect(
          service.readFileAsync(workflowId, 'file.txt'),
        ).rejects.toBeInstanceOf(PathTraversalException);
      }
    });

    it('отвергает пустой путь и NUL-байт', async () => {
      for (const filePath of ['', 'file\0.txt']) {
        await expect(service.readFileAsync('wf-1', filePath)).rejects.toBeInstanceOf(
          PathTraversalException,
        );
      }
    });
  });

  describe('лимит 5 МБ (FileTooLargeException)', () => {
    it('записывает файл ровно на границе лимита', async () => {
      const content = 'x'.repeat(FILESYSTEM_MAX_FILE_BYTES);

      await service.writeFileAsync('wf-1', 'limit.txt', content);

      expect((await stat(workspacePath('wf-1', 'limit.txt'))).size).toBe(
        FILESYSTEM_MAX_FILE_BYTES,
      );
      expect(await service.readFileAsync('wf-1', 'limit.txt')).toHaveLength(
        FILESYSTEM_MAX_FILE_BYTES,
      );
    });

    it('отвергает запись контента больше 5 МБ и не создаёт файл', async () => {
      const content = 'x'.repeat(FILESYSTEM_MAX_FILE_BYTES + 1);

      await expect(
        service.writeFileAsync('wf-1', 'big.txt', content),
      ).rejects.toBeInstanceOf(FileTooLargeException);

      await expect(
        stat(workspacePath('wf-1', 'big.txt')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('отвергает чтение файла больше 5 МБ (по stat.size)', async () => {
      const target = workspacePath('wf-1', 'big-read.txt');

      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.alloc(FILESYSTEM_MAX_FILE_BYTES + 1, 0x78));

      const error = await service.readFileAsync('wf-1', 'big-read.txt').catch(
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(FileTooLargeException);
      expect(error).toMatchObject({
        bytes: FILESYSTEM_MAX_FILE_BYTES + 1,
        maxBytes: FILESYSTEM_MAX_FILE_BYTES,
      });
    });

    it('считает лимит в байтах UTF-8, а не в символах', async () => {
      // Кириллица занимает 2 байта: половина лимита символов уже превышает
      // лимит байт.
      const content = 'я'.repeat(Math.ceil(FILESYSTEM_MAX_FILE_BYTES / 2) + 1);

      await expect(
        service.writeFileAsync('wf-1', 'cyrillic.txt', content),
      ).rejects.toBeInstanceOf(FileTooLargeException);
    });
  });
});
