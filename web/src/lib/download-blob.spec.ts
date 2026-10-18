import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportFileNameOf, triggerDownload } from './download-blob';

afterEach(() => {
  // jsdom (KI-155) даёт DOM, но не `URL.createObjectURL`: подменяем `URL` и
  // `document`, чтобы проверить порядок click → revoke без реального скачивания.
  vi.unstubAllGlobals();
});

describe('exportFileNameOf', () => {
  it('добавляет расширение .workflow.json к названию workflow', () => {
    expect(exportFileNameOf('Text → LLM')).toBe('Text → LLM.workflow.json');
  });

  it('заменяет символы, недопустимые в имени файла', () => {
    expect(exportFileNameOf('a/b\\c:d*e?f"g<h>i|j')).toBe(
      'a_b_c_d_e_f_g_h_i_j.workflow.json',
    );
  });

  it('отбрасывает краевые точки и пробелы', () => {
    expect(exportFileNameOf('  ..мой workflow.. ')).toBe(
      'мой workflow.workflow.json',
    );
  });

  it('отбрасывает управляющие символы', () => {
    expect(exportFileNameOf('a\u0000b\u001Fc')).toBe('abc.workflow.json');
  });

  it('подставляет имя по умолчанию для пустого названия', () => {
    expect(exportFileNameOf('   ')).toBe('workflow.workflow.json');
    expect(exportFileNameOf('...')).toBe('workflow.workflow.json');
  });

  it('ограничивает длину имени ста символами', () => {
    expect(exportFileNameOf('a'.repeat(250))).toBe(
      `${'a'.repeat(100)}.workflow.json`,
    );
  });
});

describe('triggerDownload', () => {
  it('отдаёт blob ссылке с именем файла и освобождает blob-URL', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = { href: '', download: '', click, remove };
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.stubGlobal('document', { createElement, body: { appendChild } });

    const blob = new Blob(['{"version":1}'], { type: 'application/json' });

    triggerDownload(blob, `export.workflow.json`);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(createElement).toHaveBeenCalledWith('a');
    expect(anchor.href).toBe('blob:mock');
    expect(anchor.download).toBe('export.workflow.json');
    // Ссылка обязана быть в документе до клика — иначе часть браузеров
    // игнорирует скачивание.
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    // Клик раньше освобождения URL: отзывать его до скачивания нельзя.
    expect(click.mock.invocationCallOrder[0]).toBeLessThan(
      revokeObjectURL.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
