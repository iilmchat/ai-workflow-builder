import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { NodeDataValidationException } from '../engine/errors.js';
import {
  DocumentTemplateInvalidException,
  type DocumentTemplateInvalidCode,
} from './document.errors.js';
import {
  DocumentTemplateService,
  extractPlaceholders,
  resolveTemplateVariables,
  sanitizeVariables,
  type DocumentTemplateRenderResult,
} from './document-template.service.js';

/**
 * Рендерер DOCX-шаблонов (v0.11 S2, DESIGN § 3.1.3–3.1.4).
 *
 * Проверяются три группы контракта:
 * 1. рендер: простые плейсхолдеры, циклы, кириллица, спецсимволы XML,
 *    отсутствующие переменные;
 * 2. защита архива: битый ZIP, отсутствие OOXML-частей, макросы, XXE, zip bomb;
 * 3. разрешение переменных узла: объект/массив/JSON-строка/ошибки и
 *    sanitize прототипных ключей.
 *
 * Тестовые `.docx` собираются в памяти `pizzip`: реальный файл Word для
 * проверки ZIP/OOXML-логики не нужен.
 */

/** DOCX MIME-тип не нужен, но структура — OOXML, поэтому части обязательны. */
const CONTENT_TYPES = (extra = ''): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  `${extra}</Types>`;

/** Минимальный `.rels`, который ожидает docxtemplater. */
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="word/document.xml"/></Relationships>';

/** Абзац WordprocessingML с текстом. */
const paragraph = (text: string): string =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

/** Опции сборки тестового `.docx`. */
interface DocxOptions {
  /** Тело `word/document.xml` (абзацы). */
  readonly body?: string;
  /** Дополнительные записи архива (имя → содержимое). */
  readonly extraFiles?: Readonly<Record<string, string>>;
  /** Дополнительный content-type (например, `macroEnabled`). */
  readonly contentTypesExtra?: string;
  /** Части, которые нужно не добавлять (для проверки обязательных файлов). */
  readonly omit?: readonly string[];
}

/**
 * Собирает валидный (структурно) `.docx` в памяти.
 *
 * @param options - тело документа и дополнительные записи
 * @returns буфер ZIP-архива с OOXML-частями
 */
function makeDocx(options: DocxOptions = {}): Buffer {
  const { body = paragraph('Hello'), extraFiles = {}, contentTypesExtra = '', omit = [] } =
    options;
  const entries: Record<string, string> = {
    '[Content_Types].xml': CONTENT_TYPES(contentTypesExtra),
    '_rels/.rels': ROOT_RELS,
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
    ...extraFiles,
  };
  const zip = new PizZip();

  for (const [name, content] of Object.entries(entries)) {
    if (!omit.includes(name)) {
      zip.file(name, content);
    }
  }

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Создаёт сервис с env-заглушкой через Nest DI (RULES 4.13).
 *
 * @param overrides - значения `ConfigService` (остальные ключи дают `undefined`,
 *   и сервис применяет дефолты `EnvSchema`)
 * @returns сервис для теста
 */
async function createService(
  overrides: Readonly<Record<string, number>> = {},
): Promise<DocumentTemplateService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      DocumentTemplateService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string): number | undefined => overrides[key],
        },
      },
    ],
  }).compile();

  return moduleRef.get(DocumentTemplateService);
}

/**
 * Достаёт текст `<w:t>` из отрендеренного документа.
 *
 * @param result - результат рендера
 * @returns текстовые узлы в порядке следования
 */
function documentTexts(result: DocumentTemplateRenderResult): string[] {
  const zip = new PizZip(result.buffer);
  const document = zip.file('word/document.xml')?.asText() ?? '';

  return [...document.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(
    (match) => match[1] ?? '',
  );
}

/**
 * Проверяет, что вызов бросил {@link DocumentTemplateInvalidException} с
 * ожидаемым кодом.
 *
 * Отдельный helper, а не `toThrow(expect.objectContaining(...))`: последний
 * сравнивает сообщение, а не поля ошибки, и проверка кода была бы ложно
 * зелёной.
 *
 * @param fn - вызов, который обязан бросить
 * @param code - ожидаемый машинный код отказа
 * @returns пойманное исключение для дополнительных проверок
 */
function expectTemplateInvalid(
  fn: () => unknown,
  code: DocumentTemplateInvalidCode,
): DocumentTemplateInvalidException {
  try {
    fn();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DocumentTemplateInvalidException);
    const invalid = error as DocumentTemplateInvalidException;
    expect(invalid.code).toBe(code);

    return invalid;
  }

  throw new Error(`ожидалась DocumentTemplateInvalidException(${code})`);
}

describe('DocumentTemplateService: рендер DOCX-шаблона (v0.11 S2)', () => {
  it('подставляет простой плейсхолдер {name}', async () => {
    const service = await createService();
    const template = makeDocx({ body: paragraph('Привет, {name}!') });

    const result = await service.renderAsync(template, { name: 'Иван' });

    expect(documentTexts(result)).toEqual(['Привет, Иван!']);
    expect(result.missingVariables).toEqual([]);
    // DOCX — это ZIP: результат обязан начинаться с сигнатуры `PK\x03\x04`.
    expect(result.buffer.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('подставляет несколько плейсхолдеров и кириллицу', async () => {
    const service = await createService();
    const template = makeDocx({
      body: paragraph('Договор {number} от {date} для {client}'),
    });

    const result = await service.renderAsync(template, {
      number: '42-А',
      date: '19.10.2026',
      client: 'ООО «Ромашка»',
    });

    expect(documentTexts(result)).toEqual([
      'Договор 42-А от 19.10.2026 для ООО «Ромашка»',
    ]);
  });

  it('экранирует спецсимволы XML в значениях', async () => {
    const service = await createService();
    const template = makeDocx({ body: paragraph('{value}') });

    const result = await service.renderAsync(template, { value: '<&>"\'' });

    // docxtemplater экранирует значение при вставке в XML — это и есть защита
    // от «инъекции разметки» через переменную.
    expect(documentTexts(result)).toEqual(['&lt;&amp;&gt;&quot;&apos;']);
    const xml = new PizZip(result.buffer).file('word/document.xml')?.asText() ?? '';
    expect(xml).toContain('&lt;&amp;&gt;&quot;&apos;');
    expect(xml).not.toContain('<w:t><&>');
  });

  it('рендерит цикл {#items}…{/items}', async () => {
    const service = await createService();
    const template = makeDocx({
      body: paragraph('{#items}') + paragraph('• {title}') + paragraph('{/items}'),
    });

    const result = await service.renderAsync(template, {
      items: [{ title: 'Первый' }, { title: 'Второй' }],
    });

    expect(documentTexts(result)).toContain('• Первый');
    expect(documentTexts(result)).toContain('• Второй');
  });

  it('отсутствующая переменная рендерится пустой строкой и попадает в missingVariables', async () => {
    const service = await createService();
    const template = makeDocx({ body: paragraph('{name}/{date}') });

    const result = await service.renderAsync(template, { name: 'Иван' });

    expect(result.missingVariables).toEqual(['date']);
    expect(documentTexts(result)).toEqual(['Иван/']);
  });

  it('inspect возвращает простые плейсхолдеры без модификаторов и дублей', async () => {
    const service = await createService();
    const template = makeDocx({
      body:
        paragraph('{name} {date} {name}') +
        paragraph('{#items}') +
        paragraph('{title}') +
        paragraph('{/items}'),
    });

    const inspection = service.inspect(template);

    expect(inspection.placeholders).toEqual(['date', 'items', 'name', 'title']);
  });

  it('extractPlaceholders снимает модификаторы #, /, ^, @, =', () => {
    expect(
      extractPlaceholders('{name}{#items}{/items}{^empty}{@raw}{=formula}'),
    ).toEqual(['empty', 'formula', 'items', 'name', 'raw']);
  });
});

describe('DocumentTemplateService: защита архива (v0.11 S2)', () => {
  it('не-ZIP буфер — invalid-zip', async () => {
    const service = await createService();

    expectTemplateInvalid(
      () => service.inspect(Buffer.from('это не zip')),
      'invalid-zip',
    );
  });

  it('битый ZIP (сигнатура есть, структура сломана) — invalid-zip', async () => {
    const service = await createService();
    const broken = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('broken archive body'),
    ]);

    expectTemplateInvalid(() => service.inspect(broken), 'invalid-zip');
  });

  it('архив без word/document.xml — invalid-docx', async () => {
    const service = await createService();

    expectTemplateInvalid(
      () => service.inspect(makeDocx({ omit: ['word/document.xml'] })),
      'invalid-docx',
    );
  });

  it('.docm с vbaProject.bin — invalid-docx', async () => {
    const service = await createService();
    const template = makeDocx({
      extraFiles: { 'word/vbaProject.bin': 'MZ fake vba project' },
    });

    expectTemplateInvalid(() => service.inspect(template), 'invalid-docx');
  });

  it('macroEnabled в [Content_Types].xml — invalid-docx', async () => {
    const service = await createService();
    const template = makeDocx({
      contentTypesExtra:
        '<Override PartName="/word/document.xml" ' +
        'ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>',
    });

    expectTemplateInvalid(() => service.inspect(template), 'invalid-docx');
  });

  it('DTD/ENTITY в XML (<!DOCTYPE) — invalid-docx (XXE)', async () => {
    const service = await createService();
    const template = makeDocx({
      body: paragraph('{name}'),
      extraFiles: {
        'word/styles.xml':
          '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' +
          '<styles>&xxe;</styles>',
      },
    });

    expectTemplateInvalid(() => service.inspect(template), 'invalid-docx');
  });

  it('превышение распакованного размера — invalid-docx', async () => {
    const service = await createService({
      DOCUMENT_TEMPLATE_MAX_UNCOMPRESSED_BYTES: 2_048,
    });
    const template = makeDocx({
      body: paragraph('A'.repeat(10_000)),
    });

    expectTemplateInvalid(() => service.inspect(template), 'invalid-docx');
  });

  it('подозрительный коэффициент сжатия (zip bomb) — invalid-docx', async () => {
    const service = await createService();
    // Сильно сжимаемый текст: архив маленький, распакованный размер — большой.
    const template = makeDocx({ body: paragraph('A'.repeat(400_000)) });

    expectTemplateInvalid(() => service.inspect(template), 'invalid-docx');
  });

  it('слишком много записей архива — invalid-docx', async () => {
    const service = await createService({ DOCUMENT_TEMPLATE_MAX_ENTRIES: 10 });
    const extraFiles = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        `word/extra-${index}.xml`,
        '<?xml version="1.0"?><extra/>',
      ]),
    );
    const template = makeDocx({ extraFiles });

    expectTemplateInvalid(() => service.inspect(template), 'invalid-docx');
  });

  it('незакрытый тег docxtemplater — syntax с подробностями и без содержимого документа', async () => {
    const service = await createService();
    const template = makeDocx({ body: paragraph('Привет, {name') });

    const invalid = expectTemplateInvalid(
      () => service.inspect(template),
      'syntax',
    );

    expect(invalid.details.join(' ')).toContain('word/document.xml');
    // RULES 5.9: содержимое документа (текст «Привет») в текст ошибки не попадает.
    expect(invalid.message).not.toContain('Привет');
  });

  it('ошибка рендера (Promise-переменная) — render', async () => {
    const service = await createService();
    const template = makeDocx({ body: paragraph('{value}') });

    await expect(
      service.renderAsync(template, {
        value: Promise.reject(new Error('провайдер упал')),
      }),
    ).rejects.toMatchObject({ name: 'DocumentTemplateInvalidException', code: 'render' });
  });

  it('переменные больше лимита — render', async () => {
    const service = await createService({
      DOCUMENT_TEMPLATE_MAX_VARIABLES_BYTES: 1_024,
    });
    const template = makeDocx({ body: paragraph('{value}') });

    await expect(
      service.renderAsync(template, { value: 'x'.repeat(4_096) }),
    ).rejects.toMatchObject({ code: 'render' });
  });
});

describe('resolveTemplateVariables: источники и sanitize (DESIGN § 3.1.4)', () => {
  it('без входа берёт fallback из узла', () => {
    expect(resolveTemplateVariables({}, { client: 'ООО «Ромашка»' })).toEqual({
      client: 'ООО «Ромашка»',
    });
  });

  it('объект из inputs.prompt важнее fallback', () => {
    expect(
      resolveTemplateVariables(
        { prompt: { client: 'Из входа' } },
        { client: 'Из узла', amount: 100 },
      ),
    ).toEqual({ client: 'Из входа', amount: 100 });
  });

  it('массив заворачивается в {items}', () => {
    expect(resolveTemplateVariables({ prompt: [{ title: 'A' }] }, {})).toEqual({
      items: [{ title: 'A' }],
    });
  });

  it('JSON-строка от LLM разбирается в объект', () => {
    expect(
      resolveTemplateVariables({ prompt: '{"client":"Иван","amount":42}' }, {}),
    ).toEqual({ client: 'Иван', amount: 42 });
  });

  it('невалидный JSON — NodeDataValidationException', () => {
    expect(() =>
      resolveTemplateVariables({ prompt: 'Вот ваш договор: ...' }, {}),
    ).toThrowError(NodeDataValidationException);
  });

  it('JSON-массив/примитив в строке — NodeDataValidationException', () => {
    expect(() => resolveTemplateVariables({ prompt: '[1,2,3]' }, {})).toThrowError(
      NodeDataValidationException,
    );
    expect(() => resolveTemplateVariables({ prompt: '"строка"' }, {})).toThrowError(
      NodeDataValidationException,
    );
  });

  it('неподдерживаемый тип входа (число) — NodeDataValidationException', () => {
    expect(() => resolveTemplateVariables({ prompt: 42 }, {})).toThrowError(
      NodeDataValidationException,
    );
  });

  it('sanitize удаляет __proto__/constructor/prototype', () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"safe":3}',
    ) as Record<string, unknown>;

    const result = resolveTemplateVariables({ prompt: input }, {});

    expect(Object.keys(result)).toEqual(['safe']);
    expect(result.safe).toBe(3);
    // Прототип глобального объекта не загрязнён.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('sanitizeVariables копирует только безопасные ключи', () => {
    const input: Record<string, unknown> = { a: 1 };
    // Собственный enumerable-ключ `__proto__` (как после JSON.parse):
    // обычный литерал задал бы прототип, а не свойство.
    Object.defineProperty(input, '__proto__', {
      value: { b: 2 },
      enumerable: true,
      configurable: true,
    });

    expect(sanitizeVariables(input)).toEqual({ a: 1 });
  });
});
