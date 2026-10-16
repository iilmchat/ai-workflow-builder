import { NotFoundException, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DEMO_USER_ID } from '../auth/auth.constants.js';
import type { Workflow } from '../db/schema.js';
import type { ExportWorkflowDto } from './dto/index.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

/** Владелец из access-токена: контроллер берёт userId только отсюда (R6.1a). */
const USER = { sub: 'user-1', email: 'user@example.com' };

const workflow: Workflow = {
  id: WORKFLOW_ID,
  userId: 'user-1',
  name: 'My workflow',
  description: null,
  nodes: [],
  edges: [],
  // KI-317: поле схемы обязательно в типе — у непубличного workflow null.
  shareToken: null,
  version: 1,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('WorkflowController', () => {
  let controller: WorkflowController;
  let service: {
    createAsync: ReturnType<typeof vi.fn>;
    findAllAsync: ReturnType<typeof vi.fn>;
    findOneAsync: ReturnType<typeof vi.fn>;
    updateAsync: ReturnType<typeof vi.fn>;
    removeAsync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createAsync: vi.fn(() => Promise.resolve(workflow)),
      findAllAsync: vi.fn(() => Promise.resolve([workflow])),
      findOneAsync: vi.fn(() => Promise.resolve(workflow)),
      updateAsync: vi.fn(() => Promise.resolve(workflow)),
      removeAsync: vi.fn(() => Promise.resolve(true)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        { provide: WorkflowService, useValue: service },
        // JwtAuthGuard (R6.1a) требует JwtService и ConfigService. Контроллер
        // вызывается напрямую, поэтому guard не срабатывает — зависимости нужны
        // только для сборки модуля.
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        { provide: ConfigService, useValue: { get: vi.fn(() => true) } },
      ],
    }).compile();

    controller = moduleRef.get(WorkflowController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('делегирует создание сервису и возвращает результат', async () => {
      const dto = { userId: 'attacker', name: 'My workflow', nodes: [], edges: [] };

      await expect(controller.create(dto, USER)).resolves.toEqual(workflow);
      // KI-204: `userId` из тела игнорируется — владелец приходит из токена
      // вторым аргументом сервиса.
      expect(service.createAsync).toHaveBeenCalledWith(dto, USER.sub);
    });
  });

  describe('findAll', () => {
    it('передаёт userId из токена, limit и offset в сервис', async () => {
      const query = { userId: 'attacker', limit: 10, offset: 20 };

      await expect(controller.findAll(query, USER)).resolves.toEqual([workflow]);
      // KI-204: чужой `userId` из query не влияет — фильтр строится по токену.
      expect(service.findAllAsync).toHaveBeenCalledWith(USER.sub, 10, 20);
    });
  });

  describe('findOne', () => {
    it('возвращает workflow, если он найден', async () => {
      await expect(controller.findOne({ id: WORKFLOW_ID }, USER)).resolves.toEqual(
        workflow,
      );
      expect(service.findOneAsync).toHaveBeenCalledWith(WORKFLOW_ID, USER.sub);
    });

    it('бросает NotFoundException, если сервис вернул null', async () => {
      service.findOneAsync.mockResolvedValue(null);

      await expect(controller.findOne({ id: WORKFLOW_ID }, USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('возвращает обновлённый workflow', async () => {
      const dto = { name: 'Updated' };

      await expect(controller.update({ id: WORKFLOW_ID }, dto, USER)).resolves.toEqual(
        workflow,
      );
      expect(service.updateAsync).toHaveBeenCalledWith(WORKFLOW_ID, dto, USER.sub);
    });

    it('бросает NotFoundException, если сервис вернул null', async () => {
      service.updateAsync.mockResolvedValue(null);

      await expect(
        controller.update({ id: WORKFLOW_ID }, { name: 'Updated' }, USER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('завершается успешно, когда сервис удалил запись', async () => {
      await expect(controller.remove({ id: WORKFLOW_ID }, USER)).resolves.toBeUndefined();
      expect(service.removeAsync).toHaveBeenCalledWith(WORKFLOW_ID, USER.sub);
    });

    it('бросает NotFoundException, если сервис вернул false', async () => {
      service.removeAsync.mockResolvedValue(false);

      await expect(controller.remove({ id: WORKFLOW_ID }, USER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

/** Артефакт экспорта: то, что отдаёт сервис и принимает импорт (R6.6.1). */
const artifact: ExportWorkflowDto = {
  version: 1,
  name: 'My workflow',
  nodes: [
    {
      id: 'n1',
      type: 'text',
      position: { x: 0, y: 0 },
      data: { kind: 'text', value: '' },
    },
  ],
  edges: [],
  exportedAt: '2026-10-16T00:00:00.000Z',
};

describe('WorkflowController — export/import (R6.6.1)', () => {
  let app: INestApplication;
  let service: {
    createAsync: ReturnType<typeof vi.fn>;
    findAllAsync: ReturnType<typeof vi.fn>;
    findOneAsync: ReturnType<typeof vi.fn>;
    updateAsync: ReturnType<typeof vi.fn>;
    removeAsync: ReturnType<typeof vi.fn>;
    exportAsync: ReturnType<typeof vi.fn>;
    importAsync: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    service = {
      createAsync: vi.fn(),
      findAllAsync: vi.fn(),
      findOneAsync: vi.fn(),
      updateAsync: vi.fn(),
      removeAsync: vi.fn(),
      exportAsync: vi.fn(() => Promise.resolve(artifact)),
      importAsync: vi.fn(() => Promise.resolve(workflow)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        { provide: WorkflowService, useValue: service },
        // AUTH_DISABLED=true → запросы идут от системного пользователя
        // (как в workflow-share.spec.ts), поэтому владельца можно проверить.
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        { provide: ConfigService, useValue: { get: vi.fn(() => true) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /workflow/:id/export — 200, артефакт версии 1 без служебных полей', async () => {
    const response = await request(app.getHttpServer())
      .get(`/workflow/${WORKFLOW_ID}/export`)
      .expect(200);

    expect(response.body).toEqual(artifact);
    // Sharable-артефакт: ровно пять полей, ни одного служебного.
    expect(Object.keys(response.body).sort()).toEqual([
      'edges',
      'exportedAt',
      'name',
      'nodes',
      'version',
    ]);
    expect(response.body).not.toHaveProperty('id');
    expect(response.body).not.toHaveProperty('userId');
    expect(response.body).not.toHaveProperty('shareToken');
    expect(response.body).not.toHaveProperty('createdAt');
    expect(response.body.version).toBe(1);
    expect(service.exportAsync).toHaveBeenCalledWith(WORKFLOW_ID, DEMO_USER_ID);
  });

  it('GET /workflow/:id/export — 404, если workflow чужой или не существует', async () => {
    service.exportAsync.mockRejectedValue(new NotFoundException('Workflow не найден'));

    await request(app.getHttpServer()).get(`/workflow/${WORKFLOW_ID}/export`).expect(404);
  });

  it('GET /workflow/:id/export — 400 на не-uuid id', async () => {
    await request(app.getHttpServer()).get('/workflow/not-a-uuid/export').expect(400);
    expect(service.exportAsync).not.toHaveBeenCalled();
  });

  it('POST /workflow/import — 201, владелец берётся из токена, а не из body', async () => {
    const response = await request(app.getHttpServer())
      .post('/workflow/import')
      .send({ ...artifact, id: 'evil-id', userId: 'attacker', shareToken: 'evil' })
      .expect(201);

    expect(response.body).toEqual({ ...workflow, createdAt: expect.any(String), updatedAt: expect.any(String) });
    // Лишние ключи отброшены Zod'ом: подменить владельца или id через body нельзя.
    expect(service.importAsync).toHaveBeenCalledWith(artifact, DEMO_USER_ID);
  });

  it('POST /workflow/import — 400 без обязательного version', async () => {
    const { version, ...withoutVersion } = artifact;

    expect(version).toBe(1);

    await request(app.getHttpServer())
      .post('/workflow/import')
      .send(withoutVersion)
      .expect(400);

    expect(service.importAsync).not.toHaveBeenCalled();
  });
});
