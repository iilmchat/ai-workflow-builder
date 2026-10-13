import { NotFoundException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RunsController } from './runs.controller.js';
import { RunsService, type RunResponse } from './runs.service.js';

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

  beforeEach(async () => {
    service = {
      createRunAsync: vi.fn(() => Promise.resolve(runResponse)),
      getRunAsync: vi.fn(() => Promise.resolve(runResponse)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RunsController],
      providers: [{ provide: RunsService, useValue: service }],
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

      expect(service.createRunAsync).toHaveBeenCalledWith({ workflowId: WORKFLOW_ID });
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
      await expect(controller.create({ workflowId: WORKFLOW_ID })).resolves.toEqual(
        runResponse,
      );
      expect(service.createRunAsync).toHaveBeenCalledWith({ workflowId: WORKFLOW_ID });
    });
  });

  describe('findOne', () => {
    it('GET /runs/:id отвечает 200 и делегирует в сервис', async () => {
      const response = await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(200);

      expect(service.getRunAsync).toHaveBeenCalledWith(RUN_ID);
      expect(response.body.id).toBe(RUN_ID);
    });

    it('GET /runs/:id отвечает 404, если запуск не найден', async () => {
      service.getRunAsync.mockRejectedValue(new NotFoundException('Запуск не найден'));

      await request(app.getHttpServer()).get(`/runs/${RUN_ID}`).expect(404);
    });
  });
});
