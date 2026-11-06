import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { jwtAuthDbProvider } from '../../test/helpers/jwt-auth-db.stub.js';
import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from '../auth/auth.constants.js';
import { LlmController } from './llm.controller.js';
import { LlmHealthService } from './llm-health.service.js';
import { LlmRegistryService } from './llm-registry.service.js';
import { LlmRouterService } from './llm-router.service.js';

/** ISO-строка последней завершённой проверки GPU (фикстура). */
const LAST_CHECK = '2026-11-06T09:00:00.000Z';

/** Пользователь из access-токена (v1.3.0 S2, KI-626): его проверяет настоящий guard. */
const USER = {
  sub: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  orgId: DEMO_ORG_ID,
  ver: 0,
};

/** Заголовок авторизации с «валидным» токеном (verifyAsync замокан). */
const AUTH_HEADER = { Authorization: 'Bearer valid-token' };

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
  /** Мок `JwtService` для настоящего `JwtAuthGuard` (verifyAsync). */
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  /** Режим dev/CI: guard подставляет системного пользователя (R6.1a). */
  let authDisabled: boolean;

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
    jwt = { verifyAsync: vi.fn(() => Promise.resolve(USER)) };
    authDisabled = false;

    const moduleRef = await Test.createTestingModule({
      controllers: [LlmController],
      providers: [
        { provide: LlmRegistryService, useValue: registry },
        // KI-618: контроллер читает статус healthcheck и флаг роутера.
        { provide: LlmHealthService, useValue: health },
        { provide: LlmRouterService, useValue: router },
        // KI-626: настоящий `JwtAuthGuard` на `GET /llm/health` требует
        // `JwtService`, `ConfigService` и строку `users` из `DRIZZLE`.
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === 'AUTH_DISABLED' ? authDisabled : undefined,
            ),
          },
        },
        jwtAuthDbProvider(),
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

  it('GET /llm/models остаётся публичным: 200 без токена при AUTH_DISABLED=false (KI-626)', async () => {
    // Осознанное решение S2: список моделей грузится на старте SPA, до
    // подтверждения сессии. Секретов в ответе нет — только id/метки моделей.
    const response = await request(app.getHttpServer()).get('/llm/models').expect(200);

    expect(response.body).toHaveLength(2);
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('делегирует список реестру', () => {
    expect(controller.listModels()).toHaveLength(2);
    expect(registry.listModels).toHaveBeenCalledTimes(1);
  });

  describe('GET /llm/health (v1.2.0 S3, KI-618)', () => {
    it('online: available=true, lastCheck — ISO-строка проверки, routerEnabled=true', async () => {
      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .set(AUTH_HEADER)
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
          .set(AUTH_HEADER)
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
        .set(AUTH_HEADER)
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

  describe('auth-guard на GET /llm/health (v1.3.0 S2, KI-626)', () => {
    it('отвечает 401 без заголовка Authorization и не вызывает health/router', async () => {
      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .expect(401);

      expect(response.body.message).toBe('Нет токена');
      // Guard срабатывает до обработчика: статус GPU не читается.
      expect(health.getStatus).not.toHaveBeenCalled();
      expect(health.getLastCheckAt).not.toHaveBeenCalled();
      expect(router.isEnabled).not.toHaveBeenCalled();
    });

    it('отвечает 401 при невалидном токене', async () => {
      // Настоящий guard ловит именно свой 401, а не пробрасывает ошибку JWT.
      jwt.verifyAsync.mockRejectedValue(new Error('jwt malformed'));

      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .set({ Authorization: 'Bearer broken-token' })
        .expect(401);

      expect(response.body.message).toBe('Невалидный токен');
      expect(health.getStatus).not.toHaveBeenCalled();
    });

    it('отвечает 200 с валидным токеном', async () => {
      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .set(AUTH_HEADER)
        .expect(200);

      expect(response.body.local.available).toBe(true);
      // verifyAsync вызван один раз; строка users сверена с payload.
      expect(jwt.verifyAsync).toHaveBeenCalledTimes(1);
      expect(health.getStatus).toHaveBeenCalledTimes(1);
    });

    it('при AUTH_DISABLED=true (dev/CI) отвечает 200 без токена от системного пользователя', async () => {
      authDisabled = true;

      const response = await request(app.getHttpServer())
        .get('/llm/health')
        .expect(200);

      expect(response.body).toEqual({
        local: { available: true, lastCheck: LAST_CHECK },
        routerEnabled: true,
      });
      // Токен не проверяется: guard подставил системного пользователя.
      expect(jwt.verifyAsync).not.toHaveBeenCalled();
    });
  });
});
