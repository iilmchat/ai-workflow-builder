import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { SharedWorkflow, ShareTokenDto } from './dto/index.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';
import { WorkflowShareController } from './workflow-share.controller.js';

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const SHARE_TOKEN = '55555555-5555-4555-8555-555555555555';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');

/** Публичный граф, который отдаёт сервис. */
const sharedWorkflow: SharedWorkflow = {
  id: WORKFLOW_ID,
  name: 'Shared graph',
  nodes: [{ id: 'n1', type: 'text' }],
  edges: [],
  createdAt: CREATED_AT.toISOString(),
};

describe('WorkflowService — share (R6.2.1)', () => {
  let service: WorkflowService;
  let updateSet: ReturnType<typeof vi.fn>;
  let updateReturning: ReturnType<typeof vi.fn>;
  let selectLimit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateReturning = vi.fn(() => Promise.resolve([{ shareToken: SHARE_TOKEN, id: WORKFLOW_ID }]));
    updateSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: updateReturning })),
    }));
    selectLimit = vi.fn(() => Promise.resolve([]));

    const db = {
      update: vi.fn(() => ({ set: updateSet })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
      })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    service = moduleRef.get(WorkflowService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createShareTokenAsync выдаёт токен владельцу и путь ссылки', async () => {
    const result: ShareTokenDto = await service.createShareTokenAsync(WORKFLOW_ID, USER_ID);

    expect(result.shareToken).toBe(SHARE_TOKEN);
    expect(result.shareUrl).toBe(`/workflow/share/${SHARE_TOKEN}`);
    // Токен генерирует БД (capability-токен), updatedAt обновляется.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );
  });

  it('createShareTokenAsync: чужой или несуществующий workflow → NotFoundException', async () => {
    updateReturning.mockResolvedValue([]);

    await expect(service.createShareTokenAsync(WORKFLOW_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('revokeShareTokenAsync обнуляет share_token', async () => {
    await expect(service.revokeShareTokenAsync(WORKFLOW_ID, USER_ID)).resolves.toBeUndefined();

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ shareToken: null }),
    );
  });

  it('revokeShareTokenAsync: чужой или несуществующий workflow → NotFoundException', async () => {
    updateReturning.mockResolvedValue([]);

    await expect(service.revokeShareTokenAsync(WORKFLOW_ID, USER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('findSharedAsync отдаёт только публичные поля (без userId и shareToken)', async () => {
    selectLimit.mockResolvedValue([
      {
        id: WORKFLOW_ID,
        name: 'Shared graph',
        nodes: sharedWorkflow.nodes,
        edges: sharedWorkflow.edges,
        createdAt: CREATED_AT,
      },
    ]);

    const result = await service.findSharedAsync(SHARE_TOKEN);

    expect(result).toEqual(sharedWorkflow);
    expect(Object.keys(result).sort()).toEqual(['createdAt', 'edges', 'id', 'name', 'nodes']);
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('shareToken');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('findSharedAsync: неизвестный или отозванный токен → NotFoundException', async () => {
    selectLimit.mockResolvedValue([]);

    await expect(service.findSharedAsync(SHARE_TOKEN)).rejects.toThrow(NotFoundException);
  });
});

describe('Share-эндпоинты (R6.2.1)', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let authDisabled: boolean;

  beforeEach(async () => {
    authDisabled = true;

    service = {
      createAsync: vi.fn(),
      findAllAsync: vi.fn(),
      findOneAsync: vi.fn(),
      updateAsync: vi.fn(),
      removeAsync: vi.fn(),
      createShareTokenAsync: vi.fn(() =>
        Promise.resolve({ shareToken: SHARE_TOKEN, shareUrl: `/workflow/share/${SHARE_TOKEN}` }),
      ),
      revokeShareTokenAsync: vi.fn(() => Promise.resolve()),
      findSharedAsync: vi.fn(() => Promise.resolve(sharedWorkflow)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController, WorkflowShareController],
      providers: [
        { provide: WorkflowService, useValue: service },
        // JwtAuthGuard (R6.1a): для 401-пути AUTH_DISABLED переключается в тесте.
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
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('POST /workflow/:id/share — 200 и токен для владельца', async () => {
    const response = await request(app.getHttpServer())
      .post(`/workflow/${WORKFLOW_ID}/share`)
      .expect(200);

    expect(response.body).toEqual({
      shareToken: SHARE_TOKEN,
      shareUrl: `/workflow/share/${SHARE_TOKEN}`,
    });
    expect(service.createShareTokenAsync).toHaveBeenCalledWith(
      WORKFLOW_ID,
      '00000000-0000-0000-0000-000000000001',
    );
  });

  it('POST /workflow/:id/share — 401 без токена при AUTH_DISABLED=false', async () => {
    authDisabled = false;

    await request(app.getHttpServer()).post(`/workflow/${WORKFLOW_ID}/share`).expect(401);
    expect(service.createShareTokenAsync).not.toHaveBeenCalled();
  });

  it('DELETE /workflow/:id/share — 204', async () => {
    await request(app.getHttpServer())
      .delete(`/workflow/${WORKFLOW_ID}/share`)
      .expect(204);

    expect(service.revokeShareTokenAsync).toHaveBeenCalled();
  });

  it('POST /workflow/:id/share — 400 на невалидный uuid', async () => {
    await request(app.getHttpServer()).post('/workflow/not-a-uuid/share').expect(400);
  });

  it('GET /workflow/share/:token — 200 без auth и без служебных полей', async () => {
    const response = await request(app.getHttpServer())
      .get(`/workflow/share/${SHARE_TOKEN}`)
      .expect(200);

    expect(response.body).toEqual(sharedWorkflow);
    expect(response.body).not.toHaveProperty('userId');
    expect(response.body).not.toHaveProperty('shareToken');
    expect(response.body).not.toHaveProperty('updatedAt');
  });

  it('GET /workflow/share/:token — 400 на не-uuid, 404 на неизвестный токен', async () => {
    await request(app.getHttpServer()).get('/workflow/share/not-a-uuid').expect(400);

    service.findSharedAsync.mockRejectedValue(
      new NotFoundException('Workflow по ссылке не найден'),
    );

    await request(app.getHttpServer())
      .get(`/workflow/share/${SHARE_TOKEN}`)
      .expect(404);
  });
});
