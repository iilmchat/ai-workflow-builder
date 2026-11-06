import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LlmController } from './llm.controller.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { LlmRouterService } from './llm-router.service.js';

/** ISO-строка последней завершённой проверки GPU (фикстура). */
const LAST_CHECK = '2026-11-06T09:00:00.000Z';

describe('LlmController', () => {
  let app: INestApplication;
  let controller: LlmController;
  let registry: { listModels: ReturnType<typeof vi.fn> };
  /** Мок healthcheck: статус и время последней проверки. */
  let health: {
    getStatus: ReturnType<typeof vi.fn>;
    getLastCheckAt: ReturnType<typeof vi.fn>;
  };
  /** Мок роутера: флаг `LLM_ROUTER_ENABLED`. */
  let router: { isEnabled: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    registry = {
      listModels: vi.fn(() => [
        {
          provider: 'anthropic',
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
        },
        { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o' },
      ]),
    };
    // Дефолт — «GPU online, роутер включён»; offline-кейсы переопределяют мок.
    health = {
      getStatus: vi.fn(() => 'available'),
      getLastCheckAt: vi.fn(() => LAST_CHECK),
    };
    router = { isEnabled: vi.fn(() => true) };

    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        { provide: LlmRegistryService, useValue: registry },
        // KI-618: контроллер читает статус healthcheck и флаг роутера.
        { provide: LlmHealthService, useValue: health },
        { provide: LlmRouterService, useValue: router },
      ],
    }).compile();

    controller = moduleRef.get(LlmController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /llm/models отвечает 200 и отдаёт модели сконфигурированных провайдеров', async () => {
    const response = await request(app.getHttpServer()).get('/llm/models').expect(200);

    expect(registry.listModels).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual([
      {
        provider: 'anthropic',
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
      },
      { provider: 'openai', id: 'gpt-4o', label: 'GPT-4o' },
    ]);
  });

  it('GET /llm/models отдаёт пустой массив, если провайдеры не настроены (KI-039)', async () => {
    registry.listModels.mockReturnValue([]);

    const response = await request(app.getHttpServer()).get('/llm/models').expect(200);

    expect(response.body).toEqual([]);
  });

  it('делегирует список реестру', () => {
    expect(controller.listModels()).toHaveLength(2);
    expect(registry.listModels).toHaveBeenCalledTimes(1);
  });

  describe('GET /llm/health (v1.2.0 S3, KI-618)', () => {
    it('online: available=true, lastCheck — ISO-строка проверки, routerEnabled=true', async () => {
      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .expect(200);

      // Состав ответа фиксирован: ровно два верхних ключа и два поля в `local`.
      expect(response.body).toEqual({
        local: { available: true, lastCheck: LAST_CHECK },
        routerEnabled: true,
      });
      expect(Object.keys(response.body).sort()).toEqual(['local', 'routerEnabled']);
      expect(health.getStatus).toHaveBeenCalledTimes(1);
      expect(health.getLastCheckAt).toHaveBeenCalledTimes(1);
      expect(router.isEnabled).toHaveBeenCalledTimes(1);
    });

    it.each(['unknown', 'unavailable'])(
      'offline (%s): available=false, lastCheck="" — проверок ещё не было',
      async (status) => {
        health.getStatus.mockReturnValue(status);
        health.getLastCheckAt.mockReturnValue('');

        const response = await request(app.getHttpServer())
          .get('/llm/health')
          .expect(200);

        // `unknown` и `unavailable` для UI-индикатора — одинаково «GPU офлайн»;
        // различие видно по lastCheck ('' — проверок не было).
        expect(response.body).toEqual({
          local: { available: false, lastCheck: '' },
          routerEnabled: true,
        });
        expect(response.body.local.available).toBe(false);
        expect(response.body.local.lastCheck).toBe('');
      },
    );

    it('routerEnabled=false, когда LLM_ROUTER_ENABLED выключен', async () => {
      router.isEnabled.mockReturnValue(false);

      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .expect(200);

      expect(response.body.routerEnabled).toBe(false);
      // Статус GPU при выключенном роутере всё равно отдаётся: healthcheck
      // работает независимо от флага (DESIGN V120 § 3.4).
      expect(response.body.local).toEqual({
        available: true,
        lastCheck: LAST_CHECK,
      });
    });

    it('делегирует health/router и возвращает их значения', () => {
      expect(controller.getHealth()).toEqual({
        local: { available: true, lastCheck: LAST_CHECK },
        routerEnabled: true,
      });
      expect(health.getStatus).toHaveBeenCalledTimes(1);
      expect(health.getLastCheckAt).toHaveBeenCalledTimes(1);
      expect(router.isEnabled).toHaveBeenCalledTimes(1);
    });
  });
});
