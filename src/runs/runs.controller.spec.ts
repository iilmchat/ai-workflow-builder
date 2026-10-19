import { NotFoundException } from '@nestjs/common';
import type { INestApplication, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from '../auth/auth.constants.js';
import { CostBudgetService } from './cost-budget.service.js';
import { RunsController } from './runs.controller.js';
import { RunsService, type RunResponse } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';
import type { NodeRunSnapshot } from './dto/index.js';

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
  // v0.11 S12 (KI-347): причина падения запуска — аддитивное поле RunResponse.
  error: null,
};

/** Снимок узла для `GET /runs/:id/nodes` (v0.11 S12, KI-077). */
const nodeSnapshot: NodeRunSnapshot = {
  nodeId: 'A',
  nodeType: 'text',
  status: 'completed',
  inputs: {},
  outputs: { text: 'привет' },
  error: null,
  logs: null,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  costRub: null,
  durationMs: 5,
  startedAt: '2024-01-01T00:00:01.000Z',
  finishedAt: '2024-01-01T00:00:01.005Z',
};

describe('RunsController', () => {
  let app: INestApplication;
  let controller: RunsController;
  let service: {
    createRunAsync: ReturnType<typeof vi.fn>;
    getRunAsync: ReturnType<typeof vi.fn>;
    getRunRowAsync: ReturnType<typeof vi.fn>;
    listNodeRunsAsync: ReturnType<typeof vi.fn>;
  };
  let stream: {
    assertRunExistsAsync: ReturnType<typeof vi.fn>;
    streamAsync: ReturnType<typeof vi.fn>;
  };
  /** R7.1 (KI-048): предохранитель по стоимости — источник `GET /runs/:id/budget`. */
  let costBudget: { checkBudgetAsync: ReturnType<typeof vi.fn> };
  /** KI-202: переключается в тестах 401-путей (guard реальный). */
  let authDisabled: boolean;

  beforeEach(async () => {
    authDisabled = true;
    service = {
      createRunAsync: vi.fn(() => Promise.resolve(runResponse)),
      getRunAsync: vi.fn(() => Promise.resolve(runResponse)),
      // KI-450: ручка бюджета проверяет существование строкой запуска, не
      // читая `node_runs` (поллинг после каждого узла).
      getRunRowAsync: vi.fn(() =>
        Promise.resolve({
          id: RUN_ID,
          workflowId: WORKFLOW_ID,
          status: 'pending',
          inputs: {},
          outputs: {},
          error: null,
          snapshot: { nodes: [], edges: [] },
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          startedAt: null,
          finishedAt: null,
        }),
      ),
      // v0.11 S12 (KI-077): история узлов запуска.
      listNodeRunsAsync: vi.fn(() => Promise.resolve([nodeSnapshot])),
    };
    costBudget = {
      checkBudgetAsync: vi.fn(() =>
        Promise.resolve({
          ok: true,
          accumulated: 0.6,
          estimated: 0,
          remaining: 4.4,
          maxUsd: 5,
          maxRub: 500,
          mode: 'hard' as const,
        }),
      ),
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
        // R7.1 (KI-048): ручка бюджета запуска.
        { provide: CostBudgetService, useValue: costBudget },
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

  // v0.11 S12 (DESIGN § 3.4.2, KI-077): история узлов запуска для F5.
  describe('findNodes', () => {
    it('GET /runs/:id/nodes отвечает 200 массивом NodeRunSnapshot и делегирует в сервис', async () => {
      const response = await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/nodes`)
        .expect(200)
        // Данные авторизованные и меняются во время запуска — кэш запрещён.
        .expect('Cache-Control', 'no-store');

      expect(service.listNodeRunsAsync).toHaveBeenCalledWith(RUN_ID, USER.sub);
      expect(response.body).toEqual([nodeSnapshot]);
    });

    it('GET /runs/:id/nodes чужого/несуществующего запуска отвечает 404', async () => {
      service.listNodeRunsAsync.mockRejectedValue(
        new NotFoundException('Запуск не найден'),
      );

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}/nodes`).expect(404);
    });

    it('GET /runs/:id/nodes отвечает 400 на невалидный uuid и не читает узлы', async () => {
      await request(app.getHttpServer()).get('/runs/not-a-uuid/nodes').expect(400);

      expect(service.listNodeRunsAsync).not.toHaveBeenCalled();
    });

    it('GET /runs/:id/nodes отвечает 401 без токена при AUTH_DISABLED=false', async () => {
      authDisabled = false;

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}/nodes`).expect(401);
      expect(service.listNodeRunsAsync).not.toHaveBeenCalled();
    });

    it('маршрут /nodes не перехватывается как часть :id (порядок объявления)', async () => {
      // Регрессия порядка роутов: `:id/nodes` объявлен до `:id`, поэтому
      // `GET /runs/:id/nodes` не должен попасть в `findOne` с id = `…/nodes`.
      await request(app.getHttpServer()).get(`/runs/${RUN_ID}/nodes`).expect(200);

      expect(service.getRunAsync).not.toHaveBeenCalled();
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

  // R7.1 (KI-048): бюджет запуска для прогресс-бара в TopBar.
  describe('getBudget', () => {
    it('GET /runs/:id/budget отвечает 200 и отдаёт лимиты с потраченным', async () => {
      const response = await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/budget`)
        .expect(200);

      expect(service.getRunRowAsync).toHaveBeenCalledWith(RUN_ID, USER.sub);
      expect(costBudget.checkBudgetAsync).toHaveBeenCalledWith(RUN_ID);
      expect(response.body).toEqual({
        ok: true,
        accumulated: 0.6,
        estimated: 0,
        remaining: 4.4,
        maxUsd: 5,
        maxRub: 500,
        mode: 'hard',
      });
    });

    it('GET /runs/:id/budget чужого/несуществующего запуска отвечает 404 и не считает бюджет', async () => {
      service.getRunRowAsync.mockRejectedValue(new NotFoundException('Запуск не найден'));

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}/budget`).expect(404);

      expect(costBudget.checkBudgetAsync).not.toHaveBeenCalled();
    });

    it('GET /runs/:id/budget отвечает 400 на невалидный uuid', async () => {
      await request(app.getHttpServer()).get('/runs/not-a-uuid/budget').expect(400);

      expect(service.getRunRowAsync).not.toHaveBeenCalled();
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
