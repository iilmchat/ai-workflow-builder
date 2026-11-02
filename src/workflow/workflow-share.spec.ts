import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { DEMO_ORG_ID, DEMO_USER_ID } from '../auth/auth.constants.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { SharedWorkflow, ShareTokenDto } from './dto/index.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';
import { WorkflowShareController } from './workflow-share.controller.js';
import type { WorkflowAccess } from './workflow-access.js';

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const SHARE_TOKEN = '55555555-5555-4555-8555-555555555555';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '66666666-6666-4666-8666-666666666666';
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');

/** Контекст доступа владельца share-ссылки: пользователь + организация (S2). */
const ACCESS: WorkflowAccess = { userId: USER_ID, orgId: ORG_ID };

/** Диалект нужен только для рендера условий в SQL (запросы в БД не уходят). */
const dialect = new PgDialect();

/**
 * Рендерит условие Drizzle в SQL и параметры.
 *
 * @param condition - SQL-условие
 * @returns текст SQL и значения параметров
 */
function render(condition: Parameters<PgDialect['sqlToQuery']>[0]) {
  return dialect.sqlToQuery(condition);
}

/** Публичный граф, который отдаёт сервис. */
const sharedWorkflow: SharedWorkflow = {
  id: WORKFLOW_ID,
  name: 'Shared graph',
  nodes: [{ id: 'n1', type: 'text' }],
  edges: [],
  createdAt: CREATED_AT.toISOString(),
};

describe('WorkflowService — share (R6.2.1, v1.0 S2)', () => {
  let service: WorkflowService;
  let updateSet: ReturnType<typeof vi.fn>;
  let updateReturning: ReturnType<typeof vi.fn>;
  let updateWhere: ReturnType<typeof vi.fn>;
  let selectLimit: ReturnType<typeof vi.fn>;
  let selectWhere: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    updateReturning = vi.fn(() => Promise.resolve([{ shareToken: SHARE_TOKEN, id: WORKFLOW_ID }]));
    updateWhere = vi.fn(() => ({ returning: updateReturning }));
    updateSet = vi.fn(() => ({ where: updateWhere }));
    selectLimit = vi.fn(() => Promise.resolve([]));
    selectWhere = vi.fn(() => ({ limit: selectLimit }));

    const db = {
      update: vi.fn(() => ({ set: updateSet })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: selectWhere })),
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
    const result: ShareTokenDto = await service.createShareTokenAsync(WORKFLOW_ID, ACCESS);

    expect(result.shareToken).toBe(SHARE_TOKEN);
    expect(result.shareUrl).toBe(`/workflow/share/${SHARE_TOKEN}`);
    // Токен генерирует БД (capability-токен), updatedAt обновляется.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );
  });

  it('createShareTokenAsync: предикат ограничен владельцем и организацией (S2)', async () => {
    await service.createShareTokenAsync(WORKFLOW_ID, ACCESS);

    const query = render(updateWhere.mock.calls[0][0] as Parameters<PgDialect['sqlToQuery']>[0]);

    expect(query.sql).toContain('"workflows"."id" =');
    expect(query.sql).toContain('"workflows"."user_id" =');
    expect(query.sql).toContain('"workflows"."organization_id" =');
    expect(query.params).toEqual([WORKFLOW_ID, USER_ID, ORG_ID]);
  });

  it('createShareTokenAsync: чужой или несуществующий workflow → NotFoundException', async () => {
    updateReturning.mockResolvedValue([]);

    await expect(service.createShareTokenAsync(WORKFLOW_ID, ACCESS)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('revokeShareTokenAsync обнуляет share_token', async () => {
    await expect(service.revokeShareTokenAsync(WORKFLOW_ID, ACCESS)).resolves.toBeUndefined();

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ shareToken: null }),
    );
  });

  it('revokeShareTokenAsync: чужой или несуществующий workflow → NotFoundException', async () => {
    updateReturning.mockResolvedValue([]);

    await expect(service.revokeShareTokenAsync(WORKFLOW_ID, ACCESS)).rejects.toThrow(
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

  it('findSharedAsync не фильтрует по организации: доступ даёт сам токен (S2)', async () => {
    selectLimit.mockResolvedValue([
      {
        id: WORKFLOW_ID,
        name: 'Shared graph',
        nodes: sharedWorkflow.nodes,
        edges: sharedWorkflow.edges,
        createdAt: CREATED_AT,
      },
    ]);

    await service.findSharedAsync(SHARE_TOKEN);

    const query = render(selectWhere.mock.calls[0][0] as Parameters<PgDialect['sqlToQuery']>[0]);

    // Публичная share-ссылка — capability-доступ: организация не проверяется,
    // иначе ссылка не работала бы для внешнего получателя (v1.0 S2).
    expect(query.sql).toContain('"workflows"."share_token" =');
    expect(query.sql).not.toContain('organization_id');
    expect(query.params).toEqual([SHARE_TOKEN]);
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
    expect(service.createShareTokenAsync).toHaveBeenCalledWith(WORKFLOW_ID, {
      userId: DEMO_USER_ID,
      orgId: DEMO_ORG_ID,
    });
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
