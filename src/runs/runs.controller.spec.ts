import { NotFoundException } from '@nestjs/common';
import type { INestApplication, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from '../auth/auth.constants.js';
import { RunsController } from './runs.controller.js';
import { RunsService, type RunResponse } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';

/** Владелец, которого guard подставляет при `AUTH_DISABLED=true`. */
const USER = { sub: DEMO_USER_ID, email: DEMO_USER_EMAIL };

/** Стабильные идентификаторы тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

const runResponse: RunResponse = {
  id: RUN_ID,
  workflowId: WORKFLOW_ID,
  status: 'pending',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('RunsController', () => {
  let app: INestApplication;
  let controller: RunsController;
  let service: {
    createRunAsync: ReturnType<typeof vi.fn>;
    getRunAsync: ReturnType<typeof vi.fn>;
  };
  let stream: {
    assertRunExistsAsync: ReturnType<typeof vi.fn>;
    streamAsync: ReturnType<typeof vi.fn>;
  };
  /** KI-202: переключается в тестах 401-путей (guard реальный). */
  let authDisabled: boolean;

  beforeEach(async () => {
    authDisabled = true;
    service = {
      createRunAsync: vi.fn(() => Promise.resolve(runResponse)),
      getRunAsync: vi.fn(() => Promise.resolve(runResponse)),
    };

    const streamMessages: MessageEvent[] = [
      {
        data: {
          type: 'snapshot',
          run: { ...runResponse, createdAt: '2024-01-01T00:00:00.000Z' },
          nodes: [],
        },
      },
      {
        data: {
          type: 'run_completed',
          runId: RUN_ID,
          status: 'completed',
          finishedAt: '2024-01-01T00:00:03.000Z',
        },
      },
    ];

    stream = {
      assertRunExistsAsync: vi.fn(() => Promise.resolve()),
      streamAsync: vi.fn(() => of(...streamMessages)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RunsController],
      providers: [
        { provide: RunsService, useValue: service },
        { provide: RunsStreamService, useValue: stream },
        // JwtAuthGuard (R6.1a): AUTH_DISABLED=true — запросы идут от
        // системного пользователя, токен в тестах не нужен.
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => (key === 'AUTH_DISABLED' ? authDisabled : undefined)),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(RunsController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('POST /runs с валидным body отвечает 201 и делегирует в сервис', async () => {
      const response = await request(app.getHttpServer())
        .post('/runs')
        .send({ workflowId: WORKFLOW_ID })
        .expect(201);

      expect(service.createRunAsync).toHaveBeenCalledWith(
        { workflowId: WORKFLOW_ID },
        USER.sub,
      );
      expect(response.body).toEqual(
        expect.objectContaining({ id: RUN_ID, workflowId: WORKFLOW_ID, status: 'pending' }),
      );
    });

    it('POST /runs с невалидным uuid отвечает 400 и не вызывает сервис', async () => {
      await request(app.getHttpServer())
        .post('/runs')
        .send({ workflowId: 'not-a-uuid' })
        .expect(400);

      expect(service.createRunAsync).not.toHaveBeenCalled();
    });

    it('делегирует создание сервису и возвращает его результат', async () => {
      await expect(
        controller.create({ workflowId: WORKFLOW_ID }, USER),
      ).resolves.toEqual(runResponse);
      expect(service.createRunAsync).toHaveBeenCalledWith(
        { workflowId: WORKFLOW_ID },
        USER.sub,
      );
    });
  });

  describe('findOne', () => {
    it('GET /runs/:id отвечает 200 и делегирует в сервис', async () => {
      const response = await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(200);

      expect(service.getRunAsync).toHaveBeenCalledWith(RUN_ID, USER.sub);
      expect(response.body.id).toBe(RUN_ID);
    });

    it('GET /runs/:id отвечает 404, если запуск не найден', async () => {
      service.getRunAsync.mockRejectedValue(new NotFoundException('Запуск не найден'));

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(404);
    });

    it('GET /runs/:id передаёт владельца из токена (KI-202)', async () => {
      await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(200);

      expect(service.getRunAsync).toHaveBeenCalledWith(RUN_ID, USER.sub);
    });

    it('GET /runs/:id отвечает 401 без токена при AUTH_DISABLED=false', async () => {
      authDisabled = false;

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(401);
      expect(service.getRunAsync).not.toHaveBeenCalled();
    });

    it('GET /runs/:id/stream отвечает 401 без токена при AUTH_DISABLED=false', async () => {
      authDisabled = false;

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}/stream`).expect(401);
      expect(stream.assertRunExistsAsync).not.toHaveBeenCalled();
    });
  });

  describe('streamRun', () => {
    it('GET /runs/:id/stream отвечает 200 text/event-stream со snapshot первым', async () => {
      const response = await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/stream`)
        .expect(200)
        .expect('Content-Type', /text\/event-stream/);

      expect(stream.assertRunExistsAsync).toHaveBeenCalledWith(RUN_ID, USER.sub);
      expect(stream.streamAsync).toHaveBeenCalledWith(RUN_ID, expect.anything(), USER.sub);
      expect(response.text).toContain('data: {"type":"snapshot"');
      expect(response.text).toContain('"type":"run_completed"');
    });

    it('GET /runs/:id/stream отвечает 404 и не открывает поток, если запуска нет', async () => {
      stream.assertRunExistsAsync.mockRejectedValue(
        new NotFoundException('Запуск не найден'),
      );

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}/stream`).expect(404);

      expect(stream.streamAsync).not.toHaveBeenCalled();
    });

    it('GET /runs/:id/stream отвечает 400 на невалидный uuid', async () => {
      await request(app.getHttpServer()).get('/runs/not-a-uuid/stream').expect(400);

      expect(stream.assertRunExistsAsync).not.toHaveBeenCalled();
    });
  });
});
