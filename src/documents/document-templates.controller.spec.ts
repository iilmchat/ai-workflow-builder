import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from '../auth/auth.constants.js';
import { DOCUMENT_TEMPLATE_MAX_BYTES } from './document-template.constants.js';
import { DocumentTemplatesController } from './document-templates.controller.js';
import { DocumentTemplatesService } from './document-templates.service.js';
import { DOCX_MIME_TYPE } from './document.service.js';
import type { DocumentTemplateSummary } from './dto/document-template.dto.js';

/**
 * HTTP-контракт API шаблонов (v0.11 S3, DESIGN § 3.1.5).
 *
 * Приложение поднимается целиком (Nest + Express + multer), сервис — заглушка:
 * проверяется роутинг, `ZodValidationPipe` path-параметров, поведение
 * `FileInterceptor`/multipart и коды ответов (201/400/403/404/413/204).
 * Бизнес-логика прав и валидации покрыта
 * `document-templates.service.spec.ts`.
 *
 * `AUTH_DISABLED=true` (как в `runs.controller.spec.ts`): guard подставляет
 * системного пользователя, токен в тестах не нужен.
 */

/** Пользователь, которого подставляет guard при `AUTH_DISABLED=true`. */
const USER = { sub: DEMO_USER_ID, email: DEMO_USER_EMAIL };

/** Стабильные uuid тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';

/** Ответ, который возвращает сервис-заглушка. */
const SUMMARY: DocumentTemplateSummary = {
  id: TEMPLATE_ID,
  name: 'contract.docx',
  bytes: 1_024,
  placeholders: ['name', 'date'],
  createdAt: '2026-10-19T10:00:00.000Z',
};

/** Базовый путь ручек шаблонов. */
const BASE_PATH = `/workflow/${WORKFLOW_ID}/document-templates`;

/** Заглушка сервиса шаблонов. */
interface TemplatesStub {
  listAsync: ReturnType<typeof vi.fn>;
  createAsync: ReturnType<typeof vi.fn>;
  getFileAsync: ReturnType<typeof vi.fn>;
  deleteAsync: ReturnType<typeof vi.fn>;
}

/**
 * Создаёт приложение с заглушкой сервиса.
 *
 * @returns приложение и заглушка сервиса
 */
async function createAppAsync(): Promise<{
  app: INestApplication;
  templates: TemplatesStub;
}> {
  const templates: TemplatesStub = {
    listAsync: vi.fn(() => Promise.resolve([SUMMARY])),
    createAsync: vi.fn(() => Promise.resolve(SUMMARY)),
    getFileAsync: vi.fn(() =>
      Promise.resolve({
        name: 'contract.docx',
        content: Buffer.from('docx-bytes'),
        bytes: 10,
      }),
    ),
    deleteAsync: vi.fn(() => Promise.resolve()),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [DocumentTemplatesController],
    providers: [
      { provide: DocumentTemplatesService, useValue: templates },
      // JwtAuthGuard (R6.1a): AUTH_DISABLED=true — запросы идут от системного
      // пользователя, токен в тестах не нужен.
      { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
      {
        provide: ConfigService,
        useValue: {
          get: vi.fn((key: string) =>
            key === 'AUTH_DISABLED' ? true : undefined,
          ),
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, templates };
}

describe('DocumentTemplatesController: загрузка (S3)', () => {
  let app: INestApplication;
  let templates: TemplatesStub;

  beforeEach(async () => {
    ({ app, templates } = await createAppAsync());
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('POST multipart отвечает 201 и передаёт файл в сервис (KI-479: multipart проходит)', async () => {
    const fileBytes = Buffer.from('fake docx bytes');

    const response = await request(app.getHttpServer())
      .post(BASE_PATH)
      .field('name', 'Договор 2026')
      .attach('file', fileBytes, {
        filename: 'contract.docx',
        contentType: DOCX_MIME_TYPE,
      })
      .expect(201);

    expect(response.body).toEqual(SUMMARY);
    expect(templates.createAsync).toHaveBeenCalledWith(
      WORKFLOW_ID,
      USER.sub,
      expect.objectContaining({
        originalname: 'contract.docx',
        mimetype: DOCX_MIME_TYPE,
        size: fileBytes.byteLength,
      }),
      { name: 'Договор 2026' },
    );
    // Буфер дошёл до сервиса без временных файлов (memory storage).
    const [, , uploaded] = templates.createAsync.mock.calls[0] as [
      string,
      string,
      { buffer: Buffer },
    ];
    expect(uploaded.buffer.equals(fileBytes)).toBe(true);
  });

  it('POST без файла — 400 и сервис не вызывается', async () => {
    await request(app.getHttpServer())
      .post(BASE_PATH)
      .field('name', 'Без файла')
      .expect(400);

    expect(templates.createAsync).not.toHaveBeenCalled();
  });

  it('POST с файлом больше лимита — 413 (MulterError LIMIT_FILE_SIZE)', async () => {
    await request(app.getHttpServer())
      .post(BASE_PATH)
      .attach('file', Buffer.alloc(DOCUMENT_TEMPLATE_MAX_BYTES + 1, 0x41), {
        filename: 'huge.docx',
        contentType: DOCX_MIME_TYPE,
      })
      .expect(413);

    expect(templates.createAsync).not.toHaveBeenCalled();
  });

  it('POST в чужой workflow — 404', async () => {
    templates.createAsync.mockRejectedValue(
      new NotFoundException('Workflow не найден'),
    );

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .attach('file', Buffer.from('bytes'), {
        filename: 'contract.docx',
        contentType: DOCX_MIME_TYPE,
      })
      .expect(404);
  });

  it('POST от viewer — 403', async () => {
    templates.createAsync.mockRejectedValue(
      new ForbiddenException('Нужна роль editor'),
    );

    await request(app.getHttpServer())
      .post(BASE_PATH)
      .attach('file', Buffer.from('bytes'), {
        filename: 'contract.docx',
        contentType: DOCX_MIME_TYPE,
      })
      .expect(403);
  });

  it('POST с невалидным uuid workflow — 400, сервис не вызывается', async () => {
    await request(app.getHttpServer())
      .post('/workflow/not-a-uuid/document-templates')
      .attach('file', Buffer.from('bytes'), {
        filename: 'contract.docx',
        contentType: DOCX_MIME_TYPE,
      })
      .expect(400);

    expect(templates.createAsync).not.toHaveBeenCalled();
  });
});

describe('DocumentTemplatesController: список, файл, удаление (S3)', () => {
  let app: INestApplication;
  let templates: TemplatesStub;

  beforeEach(async () => {
    ({ app, templates } = await createAppAsync());
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET списка отвечает 200 и отдаёт шаблоны', async () => {
    const response = await request(app.getHttpServer())
      .get(BASE_PATH)
      .expect(200);

    expect(response.body).toEqual([SUMMARY]);
    expect(templates.listAsync).toHaveBeenCalledWith(WORKFLOW_ID, USER.sub);
  });

  it('GET списка чужого workflow — 404', async () => {
    templates.listAsync.mockRejectedValue(new NotFoundException('нет доступа'));

    await request(app.getHttpServer()).get(BASE_PATH).expect(404);
  });

  it('GET файла отвечает 200 с DOCX Content-Type', async () => {
    const response = await request(app.getHttpServer())
      .get(`${BASE_PATH}/${TEMPLATE_ID}/file`)
      .expect(200)
      .expect('Content-Type', /wordprocessingml\.document/);

    expect(templates.getFileAsync).toHaveBeenCalledWith(
      TEMPLATE_ID,
      WORKFLOW_ID,
      USER.sub,
    );
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('contract.docx');
  });

  it('GET файла несуществующего шаблона — 404', async () => {
    templates.getFileAsync.mockRejectedValue(
      new NotFoundException('Шаблон не найден'),
    );

    await request(app.getHttpServer())
      .get(`${BASE_PATH}/${TEMPLATE_ID}/file`)
      .expect(404);
  });

  it('GET файла с невалидным templateId — 400', async () => {
    await request(app.getHttpServer())
      .get(`${BASE_PATH}/not-a-uuid/file`)
      .expect(400);

    expect(templates.getFileAsync).not.toHaveBeenCalled();
  });

  it('DELETE отвечает 204 и вызывает сервис', async () => {
    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${TEMPLATE_ID}`)
      .expect(204);

    expect(templates.deleteAsync).toHaveBeenCalledWith(
      TEMPLATE_ID,
      WORKFLOW_ID,
      USER.sub,
    );
  });

  it('DELETE от viewer — 403', async () => {
    templates.deleteAsync.mockRejectedValue(
      new ForbiddenException('Нужна роль editor'),
    );

    await request(app.getHttpServer())
      .delete(`${BASE_PATH}/${TEMPLATE_ID}`)
      .expect(403);
  });
});
