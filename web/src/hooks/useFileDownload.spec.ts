import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadAndOpenFileAsync, MIME_DOCX, MIME_PDF } from './useFileDownload';

/**
 * Управляемое состояние моков (v1.5.0 S3).
 *
 * `native` переключает `isNative()` из `@/lib/platform`; `writeFile`/`open` —
 * сами плагины Capacitor. `vi.hoisted` обязателен: фабрики `vi.mock`
 * поднимаются выше объявлений и не видят обычные переменные модуля
 * (тот же приём, что в `useCamera.spec.ts`).
 */
const mocks = vi.hoisted(() => ({
  native: false,
  writeFile: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@/lib/platform', () => ({
  isNative: () => mocks.native,
  isAndroid: () => mocks.native,
  isIOS: () => false,
  isWeb: () => !mocks.native,
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: mocks.writeFile },
  Directory: { Documents: 'DOCUMENTS' },
}));

vi.mock('@capacitor-community/file-opener', () => ({
  FileOpener: { open: mocks.open },
}));

describe('downloadAndOpenFileAsync — нативное скачивание DOCX (v1.5.0 S3)', () => {
  beforeEach(() => {
    mocks.native = false;
    mocks.writeFile.mockReset();
    mocks.open.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('в браузере скачивает через временную ссылку <a> и не трогает плагины', async () => {
    /** Заглушка созданного элемента: `href`/`download` — обычные поля. */
    const anchor = { href: '', download: '', click: vi.fn() };
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor as unknown as HTMLElement);
    // `appendChild`/`removeChild` подменяются целиком: заглушка — не Node.
    const appendSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockReturnValue(anchor as unknown as Node);
    const removeSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockReturnValue(anchor as unknown as Node);

    await downloadAndOpenFileAsync(
      '/media/file/run-1/generated-document-gen-1.docx',
      'generated-document-gen-1.docx',
    );

    expect(createSpy).toHaveBeenCalledWith('a');
    expect(anchor.href).toBe('/media/file/run-1/generated-document-gen-1.docx');
    expect(anchor.download).toBe('generated-document-gen-1.docx');
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalledWith(anchor);
    expect(removeSpy).toHaveBeenCalledWith(anchor);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('в нативе пишет base64 в Documents и открывает файл через FileOpener', async () => {
    mocks.native = true;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(['hello'], { type: MIME_DOCX })),
    });
    vi.stubGlobal('fetch', fetchMock);
    mocks.writeFile.mockResolvedValue({
      uri: 'file:///data/user/0/app/files/Documents/doc.docx',
    });
    mocks.open.mockResolvedValue(undefined);

    await downloadAndOpenFileAsync('https://api.example.com/doc.docx', 'doc.docx');

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/doc.docx');
    // «hello» в base64 — `aGVsbG8=`: подтверждает, что `data:`-префикс срезан.
    expect(mocks.writeFile).toHaveBeenCalledWith({
      path: 'doc.docx',
      data: 'aGVsbG8=',
      directory: 'DOCUMENTS',
      recursive: true,
    });
    expect(mocks.open).toHaveBeenCalledWith({
      filePath: 'file:///data/user/0/app/files/Documents/doc.docx',
      contentType: MIME_DOCX,
    });
  });

  it('передаёт MIME-тип PDF, если он задан явно (второй формат узла)', async () => {
    mocks.native = true;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['%PDF-1.7'], { type: MIME_PDF })),
      }),
    );
    mocks.writeFile.mockResolvedValue({ uri: 'file:///Documents/doc.pdf' });
    mocks.open.mockResolvedValue(undefined);

    await downloadAndOpenFileAsync(
      '/media/file/run-1/doc.pdf',
      'doc.pdf',
      MIME_PDF,
    );

    expect(mocks.open).toHaveBeenCalledWith({
      filePath: 'file:///Documents/doc.pdf',
      contentType: MIME_PDF,
    });
  });

  it('бросает ошибку при не-2xx ответе и не пишет файл', async () => {
    mocks.native = true;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );

    await expect(
      downloadAndOpenFileAsync('https://api.example.com/doc.docx', 'doc.docx'),
    ).rejects.toThrow('Failed to download: 503');

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
