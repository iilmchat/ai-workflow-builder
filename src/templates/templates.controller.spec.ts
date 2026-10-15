import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DEMO_USER_ID } from '../auth/auth.constants.js';
import type { Workflow } from '../db/schema.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { TemplateLoaderService } from './template-loader.service.js';
import { TemplatesController } from './templates.controller.js';

/** Workflow, который «создаёт» мок сервиса при инстанцировании шаблона. */
const createdWorkflow: Workflow = {
  id: '77777777-7777-4777-8777-777777777777',
  userId: DEMO_USER_ID,
  name: 'Text → LLM',
  description: null,
  nodes: [],
  edges: [],
  version: 1,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('TemplatesController (R6.6.1)', () => {
  let app: INestApplication;
  let templateLoader: TemplateLoaderService;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let authDisabled: boolean;

  beforeEach(async () => {
    authDisabled = true;

    service = {
      importAsync: vi.fn(() => Promise.resolve(createdWorkflow)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TemplatesController],
      // Загрузчик — настоящий: тест проверяет и реальные файлы src/templates/*.json,
      // а не только маршрутизацию (onModuleInit вызывается на app.init()).
      providers: [
        TemplateLoaderService,
        { provide: WorkflowService, useValue: service },
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => (key === 'AUTH_DISABLED' ? authDisabled : undefined)),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    templateLoader = moduleRef.get(TemplateLoaderService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /templates — 200 и список из трёх шаблонов без графов', async () => {
    const response = await request(app.getHttpServer()).get('/templates').expect(200);

    expect(response.body.map((item: { id: string }) => item.id)).toEqual([
      'http-llm',
      'text-llm',
      'text-llm-image',
    ]);
    expect(Object.keys(response.body[0]).sort()).toEqual([
      'description',
      'id',
      'name',
      'nodeCount',
    ]);
    // Граф в списке не отдаётся: он запрашивается только при инстанцировании.
    expect(response.body[0]).not.toHaveProperty('nodes');
  });

  it('POST /templates/text-llm/instantiate — 201 и workflow из шаблона', async () => {
    const response = await request(app.getHttpServer())
      .post('/templates/text-llm/instantiate')
      .expect(201);

    expect(response.body).toEqual({ ...createdWorkflow, createdAt: expect.any(String), updatedAt: expect.any(String) });

    const [artifact, userId] = service.importAsync.mock.calls[0] as [
      { name: string; nodes: unknown[]; edges: unknown[] },
      string,
    ];

    expect(artifact.name).toBe('Text → LLM');
    expect(artifact.nodes).toHaveLength(2);
    expect(artifact.edges).toHaveLength(1);
    // Владелец — из токена (AUTH_DISABLED → системный пользователь).
    expect(userId).toBe(DEMO_USER_ID);
  });

  it('POST /templates/nonexistent/instantiate — 404 без вызова сервиса', async () => {
    await request(app.getHttpServer()).post('/templates/nonexistent/instantiate').expect(404);

    expect(service.importAsync).not.toHaveBeenCalled();
  });

  it('POST /templates/BAD_slug/instantiate — 400 на невалидный id', async () => {
    await request(app.getHttpServer()).post('/templates/BAD_slug/instantiate').expect(400);
    expect(service.importAsync).not.toHaveBeenCalled();
  });

  it('GET /templates — 401 без токена при AUTH_DISABLED=false', async () => {
    authDisabled = false;

    await request(app.getHttpServer()).get('/templates').expect(401);
    await expect(templateLoader.listAsync()).resolves.toHaveLength(3);
  });
});
