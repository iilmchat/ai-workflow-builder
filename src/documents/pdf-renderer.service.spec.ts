/**
 * PDF-рендерер узла `document_gen` (v0.12 S1, DESIGN § 3.1.6).
 *
 * Тест не парсит PDF до текста (в проекте нет PDF-парсера): проверяется
 * контракт рендерера — сигнатура `%PDF-`, встраивание Noto Sans с кириллицей,
 * URI-аннотации ссылок, fallback на Helvetica и ошибка на битом JSON.
 *
 * `node:fs/promises` замокан «прозрачно»: чтение шрифта по умолчанию идёт в
 * реальный файл, а тест fallback подменяет `readFile` на отказ.
 */
import { Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { DocumentRenderException } from './document.service.js';
import { PdfRenderer } from './pdf-renderer.service.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    readFile: vi.fn(actual.readFile),
  };
});

/** Сигнатура любого PDF-файла. */
const PDF_SIGNATURE = '%PDF-';

/**
 * Проверяет, что буфер — PDF по сигнатуре.
 *
 * @param buffer - результат рендера
 */
function expectPdfSignature(buffer: Buffer): void {
  expect(buffer.subarray(0, PDF_SIGNATURE.length).toString('latin1')).toBe(
    PDF_SIGNATURE,
  );
}

describe('PdfRenderer — Markdown (v0.12 S1)', () => {
  it('рендерит кириллицу, H1–H3, абзацы, списки, код и встраивает Noto Sans', async () => {
    const renderer = new PdfRenderer();
    const markdown = [
      '# Отчёт за квартал',
      '',
      'Обычный абзац с **жирным** и *курсивом* — кириллица обязана быть.',
      '',
      '## Раздел',
      '',
      '- первый пункт',
      '- второй пункт',
      '  - вложенный пункт',
      '',
      '### Подраздел',
      '',
      '1. шаг один',
      '2. шаг два',
      '',
      '```ts',
      'const привет = "мир";',
      '```',
    ].join('\n');

    const buffer = await renderer.renderFromMarkdownAsync(markdown);
    const raw = buffer.toString('latin1');

    expectPdfSignature(buffer);
    expect(buffer.byteLength).toBeGreaterThan(1_000);
    // Имя встроенного шрифта попадает в FontDescriptor даже при subsetting.
    expect(raw).toContain('NotoSans');
    expect(raw).toContain('/Type /Page');
  });

  it('ссылка становится URI-аннотацией PDF', async () => {
    const renderer = new PdfRenderer();

    const buffer = await renderer.renderFromMarkdownAsync(
      'Смотрите [документацию](https://example.com/docs?q=1) по ссылке.',
    );
    const raw = buffer.toString('latin1');

    expectPdfSignature(buffer);
    expect(raw).toContain('/URI');
    expect(raw).toContain('https://example.com/docs?q=1');
  });

  it('пустой Markdown даёт валидный пустой PDF', async () => {
    const renderer = new PdfRenderer();

    const buffer = await renderer.renderFromMarkdownAsync('');

    expectPdfSignature(buffer);
  });
});

describe('PdfRenderer — JSON (v0.12 S1)', () => {
  it('рендерит title, заголовок, список, код и ссылку из JSON', async () => {
    const renderer = new PdfRenderer();

    const buffer = await renderer.renderFromJsonAsync({
      title: 'Договор поставки',
      blocks: [
        { type: 'heading', level: 2, text: 'Предмет договора' },
        { type: 'paragraph', text: 'Поставщик обязуется передать товар.' },
        { type: 'list', text: 'Первый пункт', ordered: true },
        { type: 'list', text: 'Второй пункт', ordered: true },
        {
          type: 'paragraph',
          text: 'Условия: [сайт](https://example.com/terms).',
        },
      ],
    });
    const raw = buffer.toString('latin1');

    expectPdfSignature(buffer);
    expect(raw).toContain('NotoSans');
    expect(raw).toContain('https://example.com/terms');
  });

  it('битая структура JSON — DocumentRenderException', async () => {
    const renderer = new PdfRenderer();

    await expect(
      renderer.renderFromJsonAsync({ blocks: 'нет' }),
    ).rejects.toBeInstanceOf(DocumentRenderException);
  });
});

describe('PdfRenderer — fallback шрифта (v0.12 S1)', () => {
  it('без файла шрифта пишет warning и собирает PDF на Helvetica', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: файл не найден'), { code: 'ENOENT' }),
    );

    // Новый экземпляр: кэш шрифта не должен протечь из предыдущих тестов.
    const renderer = new PdfRenderer();
    const buffer = await renderer.renderFromMarkdownAsync('Fallback PDF');

    expectPdfSignature(buffer);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('используется Helvetica'),
    );
  });
});
