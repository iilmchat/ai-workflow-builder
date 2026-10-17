import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { Workflow } from '../db/schema.js';
import type { CollaboratorResponse } from './dto/index.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

/** Стабильные идентификаторы тестовых данных (валидные uuid). */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const PARTICIPANT_ID = '33333333-3333-4333-8333-333333333333';
const INVITED_AT = new Date('2026-10-17T10:00:00.000Z');
/** id системного пользователя в AUTH_DISABLED-режиме (R6.1a). */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Workflow владельца — нужен для findOneAsync в getCollaboratorsAsync. */
const baseWorkflow: Workflow = {
  id: WORKFLOW_ID,
  userId: OWNER_ID,
  name: 'Shared graph',
  description: null,
  nodes: [],
  edges: [],
  shareToken: null,
  version: 1,
  createdAt: INVITED_AT,
  updatedAt: INVITED_AT,
};

/** Участник, которого возвращают моки. */
const participant: CollaboratorResponse = {
  userId: PARTICIPANT_ID,
  email: 'viewer@example.com',
  role: 'viewer',
  invitedAt: INVITED_AT.toISOString(),
  invitedBy: OWNER_ID,
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * @param resolveWith - значение, которое получит `await` цепочки
 * @returns прокси с методами `from`/`where`/`orderBy`/`limit`/`values`/`set`/`returning`
 */
function chain(resolveWith: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const link = {} as Record<string, ReturnType<typeof vi.fn>>;

  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of [
    'from',
    'innerJoin',
    'where',
    'orderBy',
    'limit',
    'values',
    'set',
  ]) {
    link[method] = vi.fn(() => proxy);
  }

  link.returning = vi.fn(() => resolveWith);

  return proxy;
}

describe('WorkflowService — участники (R7.6)', () => {
  let service: WorkflowService;
  let selectResults: unknown[][];
  let insertResult: unknown[];
  let updateResult: unknown[];
  let deleteResult: unknown[];
  let db: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    selectResults = [];
    insertResult = [];
    updateResult = [];
    deleteResult = [];

    db = {
      select: vi.fn(() => chain(selectResults.shift() ?? [])),
      insert: vi.fn(() => chain(insertResult)),
      update: vi.fn(() => chain(updateResult)),
      delete: vi.fn(() => chain(deleteResult)),
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

  it('getCollaboratorsAsync отдаёт участников с email и ISO-датой', async () => {
    selectResults = [
      // Порядок вызовов: сначала основной SELECT workflow, затем EXISTS-
      // подзапрос внутри фильтра доступа (мок-цепочка его не исполняет),
      // и только потом запрос участников.
      [baseWorkflow],
      [],
      [
        {
          userId: PARTICIPANT_ID,
          email: 'viewer@example.com',
          role: 'viewer',
          invitedAt: INVITED_AT,
          invitedBy: OWNER_ID,
        },
      ],
    ];

    const result = await service.getCollaboratorsAsync(WORKFLOW_ID, PARTICIPANT_ID);

    expect(result).toEqual([participant]);
    // Чтение списка доступно и viewer: доступ проверяется тем же findOneAsync.
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it('getCollaboratorsAsync: чужой workflow → NotFoundException', async () => {
    selectResults = [[]];

    await expect(
      service.getCollaboratorsAsync(WORKFLOW_ID, PARTICIPANT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('inviteCollaboratorAsync: владелец приглашает editor (R7.6)', async () => {
    selectResults = [
      [{ ownerId: OWNER_ID }],
      [{ id: PARTICIPANT_ID, email: 'viewer@example.com' }],
      [],
    ];
    insertResult = [
      {
        workflowId: WORKFLOW_ID,
        userId: PARTICIPANT_ID,
        role: 'editor',
        invitedAt: INVITED_AT,
        invitedBy: OWNER_ID,
      },
    ];

    const result = await service.inviteCollaboratorAsync(WORKFLOW_ID, OWNER_ID, {
      userId: PARTICIPANT_ID,
      role: 'editor',
    });

    expect(result).toEqual({ ...participant, role: 'editor' });
    expect(db.insert).toHaveBeenCalled();
    // invitedBy берётся из токена, а не из тела запроса.
    const values = db.insert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(values.values).toHaveBeenCalledWith(
      expect.objectContaining({ invitedBy: OWNER_ID, role: 'editor' }),
    );
  });

  it('inviteCollaboratorAsync: участник (не владелец) получает 404', async () => {
    selectResults = [[]];

    await expect(
      service.inviteCollaboratorAsync(WORKFLOW_ID, PARTICIPANT_ID, {
        userId: '44444444-4444-4444-8444-444444444444',
        role: 'viewer',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inviteCollaboratorAsync: нельзя пригласить владельца', async () => {
    selectResults = [[{ ownerId: OWNER_ID }]];

    await expect(
      service.inviteCollaboratorAsync(WORKFLOW_ID, OWNER_ID, {
        userId: OWNER_ID,
        role: 'viewer',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('inviteCollaboratorAsync: неизвестный пользователь → 404', async () => {
    selectResults = [[{ ownerId: OWNER_ID }], []];

    await expect(
      service.inviteCollaboratorAsync(WORKFLOW_ID, OWNER_ID, {
        userId: PARTICIPANT_ID,
        role: 'viewer',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('inviteCollaboratorAsync: повторный инвайт → ConflictException', async () => {
    selectResults = [
      [{ ownerId: OWNER_ID }],
      [{ id: PARTICIPANT_ID, email: 'viewer@example.com' }],
      [{ userId: PARTICIPANT_ID }],
    ];

    await expect(
      service.inviteCollaboratorAsync(WORKFLOW_ID, OWNER_ID, {
        userId: PARTICIPANT_ID,
        role: 'editor',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('updateCollaboratorRoleAsync меняет роль', async () => {
    selectResults = [[{ ownerId: OWNER_ID }]];
    updateResult = [
      {
        workflowId: WORKFLOW_ID,
        userId: PARTICIPANT_ID,
        role: 'editor',
        invitedAt: INVITED_AT,
        invitedBy: OWNER_ID,
      },
    ];

    const result = await service.updateCollaboratorRoleAsync(
      WORKFLOW_ID,
      OWNER_ID,
      PARTICIPANT_ID,
      { role: 'editor' },
    );

    expect(result).toMatchObject({ userId: PARTICIPANT_ID, role: 'editor' });
    const updateChain = db.update.mock.results[0]?.value as {
      set: ReturnType<typeof vi.fn>;
    };
    expect(updateChain.set).toHaveBeenCalledWith({ role: 'editor' });
  });

  it('updateCollaboratorRoleAsync: участник не найден → 404', async () => {
    selectResults = [[{ ownerId: OWNER_ID }]];
    updateResult = [];

    await expect(
      service.updateCollaboratorRoleAsync(WORKFLOW_ID, OWNER_ID, PARTICIPANT_ID, {
        role: 'viewer',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('removeCollaboratorAsync удаляет участие', async () => {
    selectResults = [[{ ownerId: OWNER_ID }]];
    deleteResult = [{ userId: PARTICIPANT_ID }];

    await expect(
      service.removeCollaboratorAsync(WORKFLOW_ID, OWNER_ID, PARTICIPANT_ID),
    ).resolves.toBeUndefined();
    expect(db.delete).toHaveBeenCalled();
  });

  it('removeCollaboratorAsync: участник не найден → 404', async () => {
    selectResults = [[{ ownerId: OWNER_ID }]];
    deleteResult = [];

    await expect(
      service.removeCollaboratorAsync(WORKFLOW_ID, OWNER_ID, PARTICIPANT_ID),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('Collaborator-эндпоинты (R7.6)', () => {
  let app: INestApplication;
  let service: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    service = {
      getCollaboratorsAsync: vi.fn(() => Promise.resolve([participant])),
      inviteCollaboratorAsync: vi.fn(() => Promise.resolve(participant)),
      updateCollaboratorRoleAsync: vi.fn(() => Promise.resolve(participant)),
      removeCollaboratorAsync: vi.fn(() => Promise.resolve()),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        { provide: WorkflowService, useValue: service },
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        {
          provide: ConfigService,
          useValue: {
            // AUTH_DISABLED=true: запросы идут от системного пользователя.
            get: vi.fn((key: string) => (key === 'AUTH_DISABLED' ? true : undefined)),
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

  it('GET /workflow/:id/collaborators — 200 и список участников', async () => {
    const response = await request(app.getHttpServer())
      .get(`/workflow/${WORKFLOW_ID}/collaborators`)
      .expect(200);

    expect(response.body).toEqual([participant]);
    expect(service.getCollaboratorsAsync).toHaveBeenCalledWith(
      WORKFLOW_ID,
      SYSTEM_USER_ID,
    );
  });

  it('POST /workflow/:id/collaborators — 201 и приглашение', async () => {
    const response = await request(app.getHttpServer())
      .post(`/workflow/${WORKFLOW_ID}/collaborators`)
      .send({ userId: PARTICIPANT_ID, role: 'viewer' })
      .expect(201);

    expect(response.body).toEqual(participant);
    expect(service.inviteCollaboratorAsync).toHaveBeenCalledWith(
      WORKFLOW_ID,
      SYSTEM_USER_ID,
      { userId: PARTICIPANT_ID, role: 'viewer' },
    );
  });

  it('POST — 400 на невалидный uuid пользователя и роль owner', async () => {
    await request(app.getHttpServer())
      .post(`/workflow/${WORKFLOW_ID}/collaborators`)
      .send({ userId: 'not-a-uuid', role: 'viewer' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/workflow/${WORKFLOW_ID}/collaborators`)
      .send({ userId: PARTICIPANT_ID, role: 'owner' })
      .expect(400);

    expect(service.inviteCollaboratorAsync).not.toHaveBeenCalled();
  });

  it('PATCH /workflow/:id/collaborators/:userId — 200 и новая роль', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/workflow/${WORKFLOW_ID}/collaborators/${PARTICIPANT_ID}`)
      .send({ role: 'editor' })
      .expect(200);

    expect(response.body).toEqual(participant);
    expect(service.updateCollaboratorRoleAsync).toHaveBeenCalledWith(
      WORKFLOW_ID,
      SYSTEM_USER_ID,
      PARTICIPANT_ID,
      { role: 'editor' },
    );
  });

  it('DELETE /workflow/:id/collaborators/:userId — 204', async () => {
    await request(app.getHttpServer())
      .delete(`/workflow/${WORKFLOW_ID}/collaborators/${PARTICIPANT_ID}`)
      .expect(204);

    expect(service.removeCollaboratorAsync).toHaveBeenCalledWith(
      WORKFLOW_ID,
      SYSTEM_USER_ID,
      PARTICIPANT_ID,
    );
  });

  it('GET /workflow/:id/collaborators — 400 на невалидный uuid workflow', async () => {
    await request(app.getHttpServer()).get('/workflow/not-a-uuid/collaborators').expect(400);
  });
});
