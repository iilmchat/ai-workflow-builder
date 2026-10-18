import { describe, expect, it, vi } from 'vitest';
import { NodeDataValidationException } from './node-executors.js';
import {
  executeReadFileNodeAsync,
  executeWriteFileNodeAsync,
  type FilesystemAccess,
} from './node-executors.js';

/**
 * Тесты исполнителей `read_file`/`write_file` (v0.10 S8).
 *
 * Сервис workspace замокан: юнит-тест проверяет контракт исполнителя (какие
 * аргументы уходят в `readFileAsync`/`writeFileAsync` и что возвращается), а
 * path traversal и лимиты покрыты отдельным спеком `FilesystemService`.
 */
function createFilesystem(): FilesystemAccess & {
  readFileAsync: ReturnType<typeof vi.fn>;
  writeFileAsync: ReturnType<typeof vi.fn>;
} {
  return {
    readFileAsync: vi.fn(() => Promise.resolve('')),
    writeFileAsync: vi.fn(() => Promise.resolve()),
  };
}

describe('executeReadFileNodeAsync (v0.10 S8)', () => {
  it('читает файл по data.path и отдаёт { text }', async () => {
    const filesystem = createFilesystem();

    filesystem.readFileAsync.mockResolvedValue('col1,col2\n1,2');

    await expect(
      executeReadFileNodeAsync({ path: 'input.csv' }, 'wf-1', filesystem),
    ).resolves.toEqual({ text: 'col1,col2\n1,2' });

    expect(filesystem.readFileAsync).toHaveBeenCalledWith('wf-1', 'input.csv');
    expect(filesystem.writeFileAsync).not.toHaveBeenCalled();
  });

  it('обрезает пробелы вокруг path (Zod trim)', async () => {
    const filesystem = createFilesystem();

    await executeReadFileNodeAsync({ path: '  notes.txt  ' }, 'wf-1', filesystem);

    expect(filesystem.readFileAsync).toHaveBeenCalledWith('wf-1', 'notes.txt');
  });

  it('игнорирует входы: путь берётся только из data.path', async () => {
    const filesystem = createFilesystem();

    await executeReadFileNodeAsync(
      { path: 'safe.txt', prompt: '../secret.txt' },
      'wf-1',
      filesystem,
    );

    expect(filesystem.readFileAsync).toHaveBeenCalledWith('wf-1', 'safe.txt');
  });

  it('падает NodeDataValidationException, если path отсутствует/пуст', async () => {
    const filesystem = createFilesystem();

    for (const data of [{}, { path: '' }, { path: 42 }]) {
      await expect(
        executeReadFileNodeAsync(data, 'wf-1', filesystem),
      ).rejects.toBeInstanceOf(NodeDataValidationException);
    }

    expect(filesystem.readFileAsync).not.toHaveBeenCalled();
  });

  it('падает, если path длиннее 255 символов', async () => {
    const filesystem = createFilesystem();

    await expect(
      executeReadFileNodeAsync({ path: 'a'.repeat(256) }, 'wf-1', filesystem),
    ).rejects.toBeInstanceOf(NodeDataValidationException);
  });

  it('пробрасывает ошибки сервиса (traversal/лимит/ENOENT)', async () => {
    const filesystem = createFilesystem();
    const failure = new Error('path traversal');

    filesystem.readFileAsync.mockRejectedValue(failure);

    await expect(
      executeReadFileNodeAsync({ path: '../secret.txt' }, 'wf-1', filesystem),
    ).rejects.toBe(failure);
  });
});

describe('executeWriteFileNodeAsync (v0.10 S8)', () => {
  it('пишет inputs.text и отдаёт { success: true, path }', async () => {
    const filesystem = createFilesystem();

    await expect(
      executeWriteFileNodeAsync(
        { path: 'report.json' },
        { text: '{"ok":true}' },
        'wf-1',
        filesystem,
      ),
    ).resolves.toEqual({ success: true, path: 'report.json' });

    expect(filesystem.writeFileAsync).toHaveBeenCalledWith(
      'wf-1',
      'report.json',
      '{"ok":true}',
    );
  });

  it('inputs.text важнее data.content', async () => {
    const filesystem = createFilesystem();

    await executeWriteFileNodeAsync(
      { path: 'out.txt', content: 'из узла' },
      { text: 'из связи' },
      'wf-1',
      filesystem,
    );

    expect(filesystem.writeFileAsync).toHaveBeenCalledWith(
      'wf-1',
      'out.txt',
      'из связи',
    );
  });

  it('использует data.content, если входа нет', async () => {
    const filesystem = createFilesystem();

    await executeWriteFileNodeAsync(
      { path: 'out.txt', content: 'из узла' },
      {},
      'wf-1',
      filesystem,
    );

    expect(filesystem.writeFileAsync).toHaveBeenCalledWith(
      'wf-1',
      'out.txt',
      'из узла',
    );
  });

  it('inputs.prompt работает как fallback нормализованного порта', async () => {
    const filesystem = createFilesystem();

    await executeWriteFileNodeAsync(
      { path: 'out.txt' },
      { prompt: 'из prompt' },
      'wf-1',
      filesystem,
    );

    expect(filesystem.writeFileAsync).toHaveBeenCalledWith(
      'wf-1',
      'out.txt',
      'из prompt',
    );
  });

  it('пишет пустую строку: явный content не считается отсутствующим', async () => {
    const filesystem = createFilesystem();

    await executeWriteFileNodeAsync(
      { path: 'empty.txt', content: '' },
      {},
      'wf-1',
      filesystem,
    );

    expect(filesystem.writeFileAsync).toHaveBeenCalledWith(
      'wf-1',
      'empty.txt',
      '',
    );
  });

  it('отвергает нестроковый вход и отсутствие контента', async () => {
    const filesystem = createFilesystem();

    await expect(
      executeWriteFileNodeAsync(
        { path: 'out.txt' },
        { text: { value: 'объект' } },
        'wf-1',
        filesystem,
      ),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    await expect(
      executeWriteFileNodeAsync({ path: 'out.txt' }, {}, 'wf-1', filesystem),
    ).rejects.toBeInstanceOf(NodeDataValidationException);

    expect(filesystem.writeFileAsync).not.toHaveBeenCalled();
  });

  it('валидирует path: обязателен и не длиннее 255 символов', async () => {
    const filesystem = createFilesystem();

    for (const data of [{}, { path: '' }, { path: 'a'.repeat(256) }, { path: 7 }]) {
      await expect(
        executeWriteFileNodeAsync(data, { text: 'x' }, 'wf-1', filesystem),
      ).rejects.toBeInstanceOf(NodeDataValidationException);
    }

    expect(filesystem.writeFileAsync).not.toHaveBeenCalled();
  });

  it('пробрасывает ошибки сервиса (traversal/лимит)', async () => {
    const filesystem = createFilesystem();
    const failure = new Error('file too large');

    filesystem.writeFileAsync.mockRejectedValue(failure);

    await expect(
      executeWriteFileNodeAsync(
        { path: 'big.txt' },
        { text: 'x' },
        'wf-1',
        filesystem,
      ),
    ).rejects.toBe(failure);
  });
});
