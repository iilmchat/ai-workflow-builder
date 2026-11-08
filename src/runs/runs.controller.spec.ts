import { jwtAuthDbProvider } from '../../test/helpers/jwt-auth-db.stub.js';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { INestApplication, MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { of } from 'rxjs';
import request from 'supertest';
import { DEMO_ORG_ID, DEMO_USER_EMAIL, DEMO_USER_ID } from '../auth/auth.constants.js';
import { toWorkflowAccess } from '../workflow/workflow-access.js';
import { CostBudgetService } from './cost-budget.service.js';
import { RunsController, RunsHistoryController } from './runs.controller.js';
import { RunsService, type RunResponse } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';
import type { NodeRunSnapshot, RunHistoryResponse } from './dto/index.js';
import { decodeRunHistoryCursor, encodeRunHistoryCursor } from './dto/index.js';

/** Владелец, которого guard подставляет при `AUTH_DISABLED=true`. */
const USER = {
  sub: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  orgId: DEMO_ORG_ID,
  ver: 0,
};

/**
 * Контекст доступа, который контроллер обязан собрать из токена (v1.0.0 S2).
 *
 * Ожидания — по точному объекту: если `orgId` потеряется в `toWorkflowAccess`,
 * `RunsService` перестанет фильтровать workflow по организации.
 */
const ACCESS = toWorkflowAccess(USER);

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

/** Ответ `GET /workflow/:id/runs` (v0.14 S1; keyset — v0.16 S1, KI-542). */
const historyResponse: RunHistoryResponse = {
  runs: [
    {
      id: RUN_ID,
      cursor: encodeRunHistoryCursor({
        createdAt: '2024-01-01T00:00:00.000000Z',
        id: RUN_ID,
      }),
      status: 'completed',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      startedAt: new Date('2024-01-01T00:00:01.000Z'),
      finishedAt: new Date('2024-01-01T00:00:03.000Z'),
      durationMs: 2000,
      costUsd: 0.5,
      costRub: 0,
    },
  ],
  nextCursor: null,
  total: 1,
};

describe('RunsController', () => {
  let app: INestApplication;
  let controller: RunsController;
  let service: {
    createRunAsync: ReturnType<typeof vi.fn>;
    cancelRunAsync: ReturnType<typeof vi.fn>;
    compareRunsAsync: ReturnType<typeof vi.fn>;
    getRunAsync: ReturnType<typeof vi.fn>;
    getRunRowAsync: ReturnType<typeof vi.fn>;
    listNodeRunsAsync: ReturnType<typeof vi.fn>;
    listRunsAsync: ReturnType<typeof vi.fn>;
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
      // v1.4.0 S1: отмена запуска.
      cancelRunAsync: vi.fn(() => Promise.resolve({ status: 'cancelled' })),
      // v1.4.0 S2: сравнение двух запусков.
      compareRunsAsync: vi.fn(() =>
        Promise.resolve({
          run1: historyResponse.runs[0],
          run2: historyResponse.runs[0],
          diffs: {
            nodeDiffs: [],
            totalDiff: { durationMs: 0, costUsd: 0, costRub: 0 },
          },
        }),
      ),
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
      // v0.14 S1 (DESIGN V014 § 3.1): история запусков workflow.
      listRunsAsync: vi.fn(() => Promise.resolve(historyResponse)),
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
      controllers: [RunsController, RunsHistoryController],
      providers: [
        jwtAuthDbProvider(),
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
        ACCESS,
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
        ACCESS,
      );
    });

    it('v1.0.0 S2: передаёт userId и orgId из токена (изоляция арендаторов)', async () => {
      await controller.create({ workflowId: WORKFLOW_ID }, USER);

      // Точный объект, а не только userId: без orgId сервис перестал бы
      // фильтровать workflow по организации.
      expect(service.createRunAsync).toHaveBeenCalledWith(
        { workflowId: WORKFLOW_ID },
        { userId: DEMO_USER_ID, orgId: DEMO_ORG_ID },
      );
    });
  });

  // v1.4.0 S1 (DESIGN V140 § 3.1): POST /runs/:id/cancel.
  describe('cancel', () => {
    it('POST /runs/:id/cancel отвечает 200 { status: cancelled } и передаёт access', async () => {
      const response = await request(app.getHttpServer())
        .post(`/runs/${RUN_ID}/cancel`)
        .expect(200);

      expect(service.cancelRunAsync).toHaveBeenCalledWith(RUN_ID, ACCESS);
      expect(response.body).toEqual({ status: 'cancelled' });
    });

    it('POST /runs/:id/cancel чужого/несуществующего запуска отвечает 404', async () => {
      service.cancelRunAsync.mockRejectedValue(
        new NotFoundException('Запуск не найден'),
      );

      await request(app.getHttpServer())
        .post(`/runs/${RUN_ID}/cancel`)
        .expect(404);
    });

    it('POST /runs/:id/cancel терминального запуска отвечает 409', async () => {
      service.cancelRunAsync.mockRejectedValue(
        new ConflictException('Запуск уже завершён'),
      );

      await request(app.getHttpServer())
        .post(`/runs/${RUN_ID}/cancel`)
        .expect(409);
    });

    it('POST /runs/:id/cancel отвечает 400 на невалидный uuid', async () => {
      await request(app.getHttpServer())
        .post('/runs/not-a-uuid/cancel')
        .expect(400);

      expect(service.cancelRunAsync).not.toHaveBeenCalled();
    });

    it('POST /runs/:id/cancel отвечает 401 без токена при AUTH_DISABLED=false', async () => {
      authDisabled = false;

      await request(app.getHttpServer())
        .post(`/runs/${RUN_ID}/cancel`)
        .expect(401);

      expect(service.cancelRunAsync).not.toHaveBeenCalled();
    });
  });

  // v1.4.0 S2 (DESIGN V140 § 3.2): GET /runs/:id1/compare/:id2.
  describe('compare', () => {
    /** Второй запуск для path-параметра. */
    const RUN_2_ID = '77777777-7777-4777-8777-777777777777';

    it('GET /runs/:id1/compare/:id2 отвечает 200 и передаёт access', async () => {
      const response = await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/compare/${RUN_2_ID}`)
        .expect(200)
        .expect('Cache-Control', 'no-store');

      expect(service.compareRunsAsync).toHaveBeenCalledWith(
        RUN_ID,
        RUN_2_ID,
        ACCESS,
      );
      expect(response.body.diffs.totalDiff).toEqual({
        durationMs: 0,
        costUsd: 0,
        costRub: 0,
      });
    });

    it('GET /runs/:id1/compare/:id2 чужого запуска отвечает 404', async () => {
      service.compareRunsAsync.mockRejectedValue(
        new NotFoundException('Запуск не найден'),
      );

      await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/compare/${RUN_2_ID}`)
        .expect(404);
    });

    it('GET /runs/:id1/compare/:id2 с невалидным uuid отвечает 400', async () => {
      await request(app.getHttpServer())
        .get(`/runs/not-a-uuid/compare/${RUN_2_ID}`)
        .expect(400);
      await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/compare/not-a-uuid`)
        .expect(400);

      expect(service.compareRunsAsync).not.toHaveBeenCalled();
    });

    it('GET /runs/:id1/compare/:id2 отвечает 401 без токена', async () => {
      authDisabled = false;

      await request(app.getHttpServer())
        .get(`/runs/${RUN_ID}/compare/${RUN_2_ID}`)
        .expect(401);

      expect(service.compareRunsAsync).not.toHaveBeenCalled();
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

      expect(service.listNodeRunsAsync).toHaveBeenCalledWith(RUN_ID, ACCESS);
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

      expect(service.getRunAsync).toHaveBeenCalledWith(RUN_ID, ACCESS);
      expect(response.body.id).toBe(RUN_ID);
    });

    it('GET /runs/:id отвечает 404, если запуск не найден', async () => {
      service.getRunAsync.mockRejectedValue(new NotFoundException('Запуск не найден'));

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(404);
    });

    it('GET /runs/:id передаёт владельца из токена (KI-202)', async () => {
      await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(200);

      expect(service.getRunAsync).toHaveBeenCalledWith(RUN_ID, ACCESS);
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

      expect(service.getRunRowAsync).toHaveBeenCalledWith(RUN_ID, ACCESS);
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

      expect(stream.assertRunExistsAsync).toHaveBeenCalledWith(RUN_ID, ACCESS);
      expect(stream.streamAsync).toHaveBeenCalledWith(RUN_ID, expect.anything(), ACCESS);
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

  // v0.14 S1 (DESIGN V014 § 3.1): GET /workflow/:id/runs — история запусков.
  describe('listRuns (RunsHistoryController)', () => {
    it('GET /workflow/:id/runs отвечает 200 и отдаёт runs/total', async () => {
      const response = await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs`)
        .expect(200)
        // Данные авторизованные и меняются по мере выполнения — кэш запрещён.
        .expect('Cache-Control', 'no-store');

      // Пагинация по умолчанию: limit=20, курсора нет — первая страница.
      expect(service.listRunsAsync).toHaveBeenCalledWith(
        WORKFLOW_ID,
        ACCESS,
        20,
        undefined,
      );
      expect(response.body.total).toBe(1);
      // v0.16 S1 (KI-542): сервер сам сообщает, есть ли следующая страница.
      expect(response.body.nextCursor).toBeNull();
      expect(response.body.runs[0]).toMatchObject({
        id: RUN_ID,
        status: 'completed',
        durationMs: 2000,
        costUsd: 0.5,
        costRub: 0,
        // Date сериализуется в ISO-строку — это и увидит UI.
        createdAt: '2024-01-01T00:00:00.000Z',
      });
      // Курсор — непрозрачная строка, которую UI передаёт обратно (KI-542).
      expect(typeof response.body.runs[0].cursor).toBe('string');
    });

    it('передаёт limit/cursor из query в сервис (keyset, KI-542)', async () => {
      const cursor = encodeRunHistoryCursor({
        createdAt: '2024-01-01T00:00:05.000000Z',
        id: RUN_ID,
      });

      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs?limit=5&cursor=${cursor}`)
        .expect(200);

      expect(service.listRunsAsync).toHaveBeenCalledWith(
        WORKFLOW_ID,
        ACCESS,
        5,
        decodeRunHistoryCursor(cursor),
      );
    });

    it('чужой/несуществующий workflow отдаёт 404', async () => {
      service.listRunsAsync.mockRejectedValue(
        new NotFoundException('Workflow не найден'),
      );

      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs`)
        .expect(404);
    });

    it('невалидный uuid workflow отдаёт 400 и не вызывает сервис', async () => {
      await request(app.getHttpServer())
        .get('/workflow/not-a-uuid/runs')
        .expect(400);

      expect(service.listRunsAsync).not.toHaveBeenCalled();
    });

    it('невалидные limit/cursor отдают 400 и не вызывают сервис', async () => {
      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs?limit=0`)
        .expect(400);
      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs?limit=101`)
        .expect(400);
      // v0.16 S1 (KI-542): мусорный курсор — 400 от Zod-схемы, а не 500.
      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs?cursor=not-a-cursor`)
        .expect(400);
      // offset удалён из контракта: старый параметр теперь просто игнорируется
      // (валидация Zod его не пропускает только при whitelist — здесь проверяем
      // что ручка не падает и отдаёт первую страницу).
      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs?offset=10`)
        .expect(200);

      expect(service.listRunsAsync).toHaveBeenCalledTimes(1);
    });

    it('GET /workflow/:id/runs отвечает 401 без токена при AUTH_DISABLED=false', async () => {
      authDisabled = false;

      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs`)
        .expect(401);
      expect(service.listRunsAsync).not.toHaveBeenCalled();
    });

    it('GET /workflow/:id/runs не перехватывается другими ручками workflow', async () => {
      // Регрессия порядка маршрутов: ручка объявлена в runs-модуле на своём
      // префиксе и не должна colliding'ить с `GET /runs/:id` и прочими.
      await request(app.getHttpServer())
        .get(`/workflow/${WORKFLOW_ID}/runs`)
        .expect(200);

      expect(service.getRunAsync).not.toHaveBeenCalled();
    });
  });
});
