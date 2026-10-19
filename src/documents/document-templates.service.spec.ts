import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  DocumentTemplateInvalidException,
  DocumentTemplateNotFoundException,
} from './document.errors.js';
import { DocumentTemplateService } from './document-template.service.js';
import { DocumentTemplatesService } from './document-templates.service.js';
import { DOCX_MIME_TYPE } from './document.service.js';
import type { DocumentTemplateSummary } from './dto/document-template.dto.js';

/**
 * CRUD-сервис DOCX-шаблонов (v0.11 S3, DESIGN § 3.1.5).
 *
 * Drizzle подменён цепочкой с очередью результатов: каждая `await`-точка
 * (проверка прав viewer/editor, лимит, INSERT/list/delete) получает свой
 * ответ. Реальный `DocumentTemplateService` не подменяется — валидация
 * содержимого проверяется на настоящих `.docx`, собранных `pizzip`.
 */

/** Стабильные uuid тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-10-19T10:00:00.000Z');

/**
 * Собирает валидный (структурно) `.docx` с одним плейсхолдером.
 *
 * @param body - XML-тело `word/document.xml` (по умолчанию — абзац `{name}`)
 * @returns буфер ZIP-архива
 */
function makeDocx(body = '<w:p><w:r><w:t>{name}</w:t></w:r></w:p>'): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ' +
      'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
      'Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  );

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Готовый `.docx`-шаблон для строки БД и загрузок. */
const TEMPLATE_CONTENT = makeDocx();

/** Строка `document_templates`, которую вернёт INSERT. */
const createdRow = {
  id: TEMPLATE_ID,
  workflowId: WORKFLOW_ID,
  createdBy: USER_ID,
  name: 'contract.docx',
  content: TEMPLATE_CONTENT,
  bytes: TEMPLATE_CONTENT.byteLength,
  sha256: 'a'.repeat(64),
  placeholders: ['name'],
  createdAt: CREATED_AT,
};

/** Публичное представление той же строки. */
const createdSummary: DocumentTemplateSummary = {
  id: TEMPLATE_ID,
  name: 'contract.docx',
  bytes: createdRow.bytes,
  placeholders: ['name'],
  createdAt: CREATED_AT.toISOString(),
};

/**
 * Загруженный файл для сервиса (структурный `UploadedFileLike`).
 *
 * @param buffer - содержимое
 * @param originalname - имя файла (по нему проверяется расширение)
 * @param mimetype - MIME-тип multipart-части
 * @returns объект, совместимый с `Express.Multer.File`
 */
function upload(
  buffer: Buffer = makeDocx(),
  originalname = 'contract.docx',
  mimetype = DOCX_MIME_TYPE,
): {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
} {
  return { originalname, mimetype, size: buffer.byteLength, buffer };
}

/**
 * Drizzle-заглушка с очередью результатов запросов.
 *
 * Каждый `await` на цепочке отдаёт следующий массив строк; `.returning()`
 * разрешается сразу массивом. Значения INSERT перехватываются для проверки
 * `sha256`/`bytes`/`placeholders`.
 *
 * @returns клиент, функция пополнения очереди и последние значения INSERT
 */
function createDbMock(): {
  db: Database;
  enqueue: (...results: unknown[][]) => void;
  insertedValues: () => unknown;
} {
  const queue: unknown[][] = [];
  let captured: unknown;

  /**
   * Создаёт thenable-цепочку Drizzle: объявленные методы продолжают цепочку,
   * `await` берёт следующий результат очереди.
   *
   * `getSQL` намеренно **не** объявлен: иначе вложенный подзапрос
   * `workflowAccessFilter` выглядел бы для `exists()` как SQL-обёртка, и
   * Drizzle попытался бы рендерить заглушку (см. такую же заглушку в
   * `src/workflow/workflow.service.spec.ts`).
   *
   * @returns прокси цепочки
   */
  const createChain = (): unknown => {
    const link: Record<string, unknown> = {};
    const proxy: unknown = new Proxy(link, {
      get: (target, property) => {
        if (property === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve(queue.shift() ?? []);
        }

        return Reflect.get(target, property) as unknown;
      },
    });

    for (const method of ['from', 'where', 'orderBy', 'limit', 'offset']) {
      link[method] = () => proxy;
    }

    link.values = (values: unknown) => {
      captured = values;

      return proxy;
    };
    link.returning = () => Promise.resolve(queue.shift() ?? []);

    return proxy;
  };

  const db = {
    select: () => createChain(),
    insert: () => createChain(),
    delete: () => createChain(),
    update: () => createChain(),
  } as unknown as Database;

  return {
    db,
    enqueue: (...results) => {
      queue.push(...results);
    },
    insertedValues: () => captured,
  };
}

/**
 * Создаёт сервис с настоящим рендерером и заглушкой БД.
 *
 * @param overrides - значения `ConfigService` (лимиты)
 * @returns сервис и управление заглушкой БД
 */
async function createHarness(
  overrides: Readonly<Record<string, number>> = {},
): Promise<{
  service: DocumentTemplatesService;
  enqueue: (...results: unknown[][]) => void;
  insertedValues: () => unknown;
}> {
  const { db, enqueue, insertedValues } = createDbMock();

  const moduleRef = await Test.createTestingModule({
    providers: [
      DocumentTemplatesService,
      DocumentTemplateService,
      { provide: DRIZZLE, useValue: db },
      {
        provide: ConfigService,
        useValue: { get: (key: string): number | undefined => overrides[key] },
      },
    ],
  }).compile();

  return { service: moduleRef.get(DocumentTemplatesService), enqueue, insertedValues };
}

describe('DocumentTemplatesService: загрузка шаблона (S3)', () => {
  it('201-сценарий: проверяет права, инспектирует и сохраняет метаданные', async () => {
    const { service, enqueue, insertedValues } = await createHarness();
    // viewer-доступ, editor-доступ, пустой список шаблонов, INSERT.
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }], [], [createdRow]);
    const file = upload();

    const summary = await service.createAsync(WORKFLOW_ID, USER_ID, file, {});

    expect(summary).toEqual(createdSummary);
    expect(insertedValues()).toMatchObject({
      workflowId: WORKFLOW_ID,
      createdBy: USER_ID,
      name: 'contract.docx',
      bytes: file.buffer.byteLength,
      placeholders: ['name'],
    });
    const values = insertedValues() as { sha256?: string; content?: Buffer };
    expect(values.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(values.content?.equals(file.buffer)).toBe(true);
  });

  it('имя из тела формы важнее имени файла', async () => {
    const { service, enqueue, insertedValues } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }], [], [createdRow]);

    await service.createAsync(WORKFLOW_ID, USER_ID, upload(), {
      name: 'Договор 2026',
    });

    expect(insertedValues()).toMatchObject({ name: 'Договор 2026' });
  });

  it('чужой workflow — 404, шаблон не сохраняется', async () => {
    const { service, enqueue, insertedValues } = await createHarness();
    enqueue([]);

    await expect(
      service.createAsync(WORKFLOW_ID, USER_ID, upload(), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insertedValues()).toBeUndefined();
  });

  it('viewer без прав editor — 403', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], []);

    await expect(
      service.createAsync(WORKFLOW_ID, USER_ID, upload(), {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('размер больше DOCUMENT_TEMPLATE_MAX_BYTES — 413', async () => {
    const { service, enqueue } = await createHarness({
      DOCUMENT_TEMPLATE_MAX_BYTES: 1_024,
    });
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }]);

    await expect(
      service.createAsync(WORKFLOW_ID, USER_ID, upload(Buffer.alloc(2_048, 0x41)), {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('битый .docx — 400 с кодом доменной ошибки', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }]);

    await expect(
      service.createAsync(
        WORKFLOW_ID,
        USER_ID,
        upload(Buffer.from('это не zip'), 'contract.docx'),
        {},
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'invalid-zip' }),
    });
  });

  it('.docm отклоняется по расширению — 400', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }]);

    await expect(
      service.createAsync(
        WORKFLOW_ID,
        USER_ID,
        upload(makeDocx(), 'contract.docm'),
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('неподдерживаемый MIME — 400', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }]);

    await expect(
      service.createAsync(
        WORKFLOW_ID,
        USER_ID,
        upload(makeDocx(), 'contract.docx', 'text/plain'),
        {},
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('слишком длинное имя файла — 400', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }]);
    const longName = `${'я'.repeat(130)}.docx`;

    await expect(
      service.createAsync(WORKFLOW_ID, USER_ID, upload(makeDocx(), longName), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('больше DOCUMENT_TEMPLATE_MAX_PLACEHOLDERS — 400', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }]);
    const placeholders = Array.from(
      { length: 501 },
      (_, index) => `<w:p><w:r><w:t>{p${index}}</w:t></w:r></w:p>`,
    ).join('');

    await expect(
      service.createAsync(WORKFLOW_ID, USER_ID, upload(makeDocx(placeholders)), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('лимит шаблонов на workflow — 400', async () => {
    const { service, enqueue } = await createHarness({
      DOCUMENT_TEMPLATE_MAX_PER_WORKFLOW: 2,
    });
    enqueue(
      [{ id: WORKFLOW_ID }],
      [{ id: WORKFLOW_ID }],
      [{ id: TEMPLATE_ID }, { id: TEMPLATE_ID }],
    );

    await expect(
      service.createAsync(WORKFLOW_ID, USER_ID, upload(), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DocumentTemplatesService: список, файл, удаление (S3)', () => {
  it('listAsync отдаёт шаблоны без содержимого', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [createdRow]);

    const summaries = await service.listAsync(WORKFLOW_ID, USER_ID);

    expect(summaries).toEqual([createdSummary]);
    expect(summaries[0]).not.toHaveProperty('content');
  });

  it('listAsync чужого workflow — 404', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([]);

    await expect(service.listAsync(WORKFLOW_ID, USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getFileAsync отдаёт содержимое и размер', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [
      { name: 'contract.docx', content: createdRow.content, bytes: createdRow.bytes },
    ]);

    const file = await service.getFileAsync(TEMPLATE_ID, WORKFLOW_ID, USER_ID);

    expect(file.name).toBe('contract.docx');
    expect(file.content.equals(createdRow.content)).toBe(true);
    expect(file.bytes).toBe(createdRow.bytes);
  });

  it('getFileAsync несуществующего шаблона — 404', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], []);

    await expect(
      service.getFileAsync(TEMPLATE_ID, WORKFLOW_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteAsync удаляет шаблон workflow', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }], [{ id: TEMPLATE_ID }]);

    await expect(
      service.deleteAsync(TEMPLATE_ID, WORKFLOW_ID, USER_ID),
    ).resolves.toBeUndefined();
  });

  it('deleteAsync несуществующего шаблона — 404', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], [{ id: WORKFLOW_ID }], []);

    await expect(
      service.deleteAsync(TEMPLATE_ID, WORKFLOW_ID, USER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deleteAsync viewer — 403', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ id: WORKFLOW_ID }], []);

    await expect(
      service.deleteAsync(TEMPLATE_ID, WORKFLOW_ID, USER_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentTemplatesService: loadAsync для исполнителя (S4)', () => {
  it('отдаёт шаблон, принадлежащий workflow запуска', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([{ name: 'contract.docx', content: createdRow.content }]);

    const loaded = await service.loadAsync(TEMPLATE_ID, WORKFLOW_ID);

    expect(loaded.name).toBe('contract.docx');
    expect(loaded.content.equals(createdRow.content)).toBe(true);
  });

  it('шаблон чужого/удалённого workflow — DocumentTemplateNotFoundException', async () => {
    const { service, enqueue } = await createHarness();
    enqueue([]);

    await expect(service.loadAsync(TEMPLATE_ID, WORKFLOW_ID)).rejects.toBeInstanceOf(
      DocumentTemplateNotFoundException,
    );
  });
});

describe('DocumentTemplateInvalidException (S2/S3)', () => {
  it('сохраняет код и подробности', () => {
    const error = new DocumentTemplateInvalidException('syntax', 'теги', [
      'word/document.xml: Unclosed tag',
    ]);

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('syntax');
    expect(error.details).toEqual(['word/document.xml: Unclosed tag']);
    expect(error.message).toContain('Unclosed tag');
  });
});
