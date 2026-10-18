import { describe, expect, it } from 'vitest';
import {
  DOCX_MIME_TYPE,
  DocumentRenderException,
  DocumentService,
  parseJsonDocument,
  parseMarkdown,
} from './document.service.js';

/**
 * Генерация DOCX (v0.10 S3).
 *
 * Внешних границ у рендера нет: `docx` собирает ZIP в памяти. Поэтому тесты
 * проверяют две вещи — разбор Markdown/JSON в блоки и то, что на выходе
 * действительно DOCX (ZIP-сигнатура `PK`), а не пустой буфер.
 */

/** DOCX — это ZIP; локальный заголовок файла всегда начинается с `PK\x03\x04`. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Проверяет, что буфер похож на настоящий .docx.
 *
 * @param buffer - результат рендера
 */
function expectDocx(buffer: Buffer): void {
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.byteLength).toBeGreaterThan(1_000);
  expect(buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)).toBe(true);
}

describe('parseMarkdown: Markdown → блоки (v0.10 S3)', () => {
  it('разбирает заголовки H1–H6, абзацы, списки, код и таблицу', () => {
    const markdown = [
      '# Заголовок',
      '## Раздел',
      '### Подраздел',
      '#### Глубокий',
      '',
      'Первый абзац',
      'продолжение абзаца.',
      '',
      '- пункт **жирный**',
      '  - вложенный пункт',
      '',
      '1. первый',
      '2. второй',
      '',
      '| Колонка A | Колонка B |',
      '| --- | :---: |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');

    const model = parseMarkdown(markdown);

    expect(model.blocks.map((block) => block.type)).toEqual([
      'heading',
      'heading',
      'heading',
      'heading',
      'paragraph',
      'list',
      'list',
      'table',
      'code',
    ]);

    // H4+ сводятся к H3: DOCX-рендерер поддерживает только три уровня.
    expect(model.blocks.slice(0, 4)).toEqual([
      { type: 'heading', level: 1, text: 'Заголовок' },
      { type: 'heading', level: 2, text: 'Раздел' },
      { type: 'heading', level: 3, text: 'Подраздел' },
      { type: 'heading', level: 3, text: 'Глубокий' },
    ]);

    // Мягкий перенос Markdown — пробел, а не перевод строки.
    expect(model.blocks[4]).toEqual({
      type: 'paragraph',
      text: 'Первый абзац продолжение абзаца.',
    });

    expect(model.blocks[5]).toEqual({
      type: 'list',
      ordered: false,
      items: [
        { text: 'пункт **жирный**', level: 0 },
        { text: 'вложенный пункт', level: 1 },
      ],
    });
    expect(model.blocks[6]).toEqual({
      type: 'list',
      ordered: true,
      items: [
        { text: 'первый', level: 0 },
        { text: 'второй', level: 0 },
      ],
    });

    expect(model.blocks[7]).toEqual({
      type: 'table',
      headers: ['Колонка A', 'Колонка B'],
      rows: [['1', '2']],
    });
    expect(model.blocks[8]).toEqual({
      type: 'code',
      text: 'const x = 1;',
    });
  });

  it('не срезает #, если он часть текста заголовка', () => {
    const model = parseMarkdown('# C#\n## Раздел ##');

    expect(model.blocks).toEqual([
      { type: 'heading', level: 1, text: 'C#' },
      { type: 'heading', level: 2, text: 'Раздел' },
    ]);
  });

  it('не съедает абзацем следующий заголовок или список', () => {
    const model = parseMarkdown('Текст\n# Заголовок\n- пункт');

    expect(model.blocks).toEqual([
      { type: 'paragraph', text: 'Текст' },
      { type: 'heading', level: 1, text: 'Заголовок' },
      {
        type: 'list',
        ordered: false,
        items: [{ text: 'пункт', level: 0 }],
      },
    ]);
  });

  it('закрывает незакрытый fence в конце документа', () => {
    const model = parseMarkdown('```\nстрока 1\nстрока 2');

    expect(model.blocks).toEqual([
      { type: 'code', text: 'строка 1\nстрока 2' },
    ]);
  });
});

describe('parseJsonDocument: JSON → блоки (v0.10 S3)', () => {
  it('приводит структуру с title и blocks к модели', () => {
    const model = parseJsonDocument({
      title: '  Отчёт по рынку  ',
      blocks: [
        { type: 'heading', text: 'Выводы', level: 2 },
        { type: 'paragraph', text: 'Текст отчёта' },
        { type: 'list', text: 'Пункт 1' },
        { type: 'list', text: 'Пункт 2' },
        { type: 'list', text: 'Шаг 1', ordered: true, level: 2 },
      ],
    });

    expect(model.title).toBe('Отчёт по рынку');
    // Соседние list-блоки — один список, чтобы не начинать нумерацию заново.
    expect(model.blocks).toEqual([
      { type: 'heading', level: 2, text: 'Выводы' },
      { type: 'paragraph', text: 'Текст отчёта' },
      {
        type: 'list',
        ordered: false,
        items: [
          { text: 'Пункт 1', level: 0 },
          { text: 'Пункт 2', level: 0 },
        ],
      },
      {
        type: 'list',
        ordered: true,
        items: [{ text: 'Шаг 1', level: 1 }],
      },
    ]);
  });

  it('отклоняет неизвестный тип блока и не-объект', () => {
    expect(() =>
      parseJsonDocument({ blocks: [{ type: 'image', text: 'x' }] }),
    ).toThrow(DocumentRenderException);
    expect(() => parseJsonDocument(null)).toThrow(/Некорректная структура/);
    expect(() => parseJsonDocument({ blocks: 'не массив' })).toThrow(
      DocumentRenderException,
    );
  });
});

describe('DocumentService: DOCX (v0.10 S3)', () => {
  const service = new DocumentService();

  it('генерирует DOCX из Markdown: ZIP-сигнатура и непустой буфер', async () => {
    const buffer = await service.generateDocxFromMarkdownAsync(
      [
        '# Заголовок',
        '',
        'Абзац с **жирным**, *курсивом*, `кодом` и [ссылкой](https://example.com).',
        '',
        '- пункт 1',
        '- пункт 2',
        '',
        '1. первый',
        '2. второй',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
    );

    expectDocx(buffer);
  });

  it('генерирует DOCX из JSON: title, heading, paragraph, list', async () => {
    const buffer = await service.generateDocxFromJsonAsync({
      title: 'Отчёт',
      blocks: [
        { type: 'heading', text: 'Раздел', level: 1 },
        { type: 'paragraph', text: 'Текст' },
        { type: 'list', text: 'Пункт' },
      ],
    });

    expectDocx(buffer);
    expect(DOCX_MIME_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('пустой Markdown даёт валидный пустой DOCX, а не пустой Buffer', async () => {
    expectDocx(await service.generateDocxFromMarkdownAsync(''));
  });

  it('некорректный JSON отклоняется понятной ошибкой', async () => {
    await expect(
      service.generateDocxFromJsonAsync({ blocks: [{ type: 'unknown' }] }),
    ).rejects.toBeInstanceOf(DocumentRenderException);
  });
});
