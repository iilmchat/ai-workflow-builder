import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

/** Текст экспозиции, который «отдаёт» замоканный сервис. */
const METRICS_TEXT =
  '# HELP http_request_duration_seconds Длительность HTTP-запросов API в секундах\n' +
  '# TYPE http_request_duration_seconds histogram\n' +
  'http_request_duration_seconds_count{method="GET",route="/workflow",status="200"} 1\n';

/** Контрактный `Content-Type` экспозиции Prometheus 0.0.4. */
const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

describe('MetricsController', () => {
  let app: INestApplication;
  let getMetrics: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getMetrics = vi.fn(() => Promise.resolve(METRICS_TEXT));

    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: { getMetrics, contentType: CONTENT_TYPE },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /metrics без авторизации отдаёт 200 и текст экспозиции', async () => {
    const response = await request(app.getHttpServer())
      .get('/metrics')
      .expect(200);

    // Guard'а на ручке нет: скрейпер Prometheus не имеет пользовательского
    // токена. Отсутствие 401 — часть контракта.
    // Express переставляет параметры Content-Type при `send` (charset/version),
    // поэтому порядок проверяется семантически; точное значение сервиса
    // пиннит unit-тест контроллера ниже.
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['content-type']).toContain('version=0.0.4');
    expect(response.headers['content-type']).toContain('charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toBe(METRICS_TEXT);
    expect(getMetrics).toHaveBeenCalledTimes(1);
  });

  it('Content-Type берётся из сервиса (реестр может сменить формат)', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: {
            getMetrics: vi.fn(() => Promise.resolve('')),
            contentType: 'application/openmetrics-text; version=1.0.0; charset=utf-8',
          },
        },
      ],
    }).compile();
    const customApp = moduleRef.createNestApplication({ logger: false });

    await customApp.init();

    try {
      const response = await request(customApp.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(response.headers['content-type']).toContain(
        'application/openmetrics-text',
      );
      expect(response.headers['content-type']).toContain('version=1.0.0');
      expect(response.headers['content-type']).toContain('charset=utf-8');
    } finally {
      await customApp.close();
    }
  });

  it('возвращает значение сервиса и выставляет заголовки (тонкий контроллер)', async () => {
    const controller = app.get(MetricsController);
    const setHeader = vi.fn();

    const text = await controller.getMetricsAsync({
      setHeader,
    } as unknown as Response);

    expect(text).toBe(METRICS_TEXT);
    expect(setHeader).toHaveBeenCalledWith('Content-Type', CONTENT_TYPE);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
