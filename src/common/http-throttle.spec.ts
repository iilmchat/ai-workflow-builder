import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService, type AuthResult } from '../auth/auth.service.js';
import type { SharedWorkflow } from '../workflow/dto/share-workflow.dto.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { WorkflowShareController } from '../workflow/workflow-share.controller.js';
import {
  HTTP_THROTTLE_DEFAULT_LIMIT,
  HTTP_THROTTLE_TTL_MS,
  LOGIN_THROTTLE,
  SHARE_THROTTLE,
} from './http-throttle.constants.js';

/** Стабильные данные тестового пользователя. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const ACCESS_TOKEN = 'signed.jwt.token';
const REFRESH_TOKEN = 'opaque-refresh-token';

/** Результат логина, который отдаёт мок сервиса. */
const authResult: AuthResult = {
  accessToken: ACCESS_TOKEN,
  user: {
    id: USER_ID,
    email: EMAIL,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  },
};

/** Публичный граф, который отдаёт мок share-ручки. */
const sharedWorkflow: SharedWorkflow = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Shared graph',
  nodes: [],
  edges: [],
  createdAt: '2024-01-01T00:00:00.000Z',
};

/** Валидный share-токен (uuid v4) для прохождения Zod-валидации. */
const SHARE_TOKEN = '55555555-5555-4555-8555-555555555555';

/**
 * Юнит-тесты HTTP rate limiting (KI-206, KI-234).
 *
 * Проверяется именно связка «глобальный `ThrottlerGuard` + `@Throttle` на
 * ручке»: модуль поднимает настоящий `ThrottlerModule`, поэтому 429 приходит
 * от guard'а, а не от мока. Лимит по умолчанию (300/мин) заведомо выше
 * строгого (5/мин) — значит, 429 на шестом запросе доказывает, что сработал
 * именно per-route лимит.
 */
describe('HTTP rate limiting: ThrottlerGuard (KI-206, KI-234)', () => {
  let app: INestApplication;
  let loginAsync: ReturnType<typeof vi.fn>;
  let findSharedAsync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    loginAsync = vi.fn(() => Promise.resolve(authResult));
    findSharedAsync = vi.fn(() => Promise.resolve(sharedWorkflow));

    const moduleRef = await Test.createTestingModule({
      imports: [
        // Те же значения, что в AppModule: строгие лимиты приходят из
        // `@Throttle` на ручках, а не из этого конфига.
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: HTTP_THROTTLE_TTL_MS,
            limit: HTTP_THROTTLE_DEFAULT_LIMIT,
          },
        ]),
      ],
      controllers: [AuthController, WorkflowShareController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            loginAsync,
            registerAsync: vi.fn(),
            getMeAsync: vi.fn(),
            createRefreshTokenAsync: vi.fn(() =>
              Promise.resolve({
                token: REFRESH_TOKEN,
                expiresAt: new Date('2026-10-22T00:00:00.000Z'),
              }),
            ),
            rotateRefreshTokenAsync: vi.fn(),
            revokeRefreshTokenAsync: vi.fn(),
          },
        },
        { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(() => undefined),
            getOrThrow: vi.fn(() => '7d'),
          },
        },
        { provide: WorkflowService, useValue: { findSharedAsync } },
        // Как в AppModule: guard глобальный, ограничения — на конкретных ручках.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Как в main.ts: без парсера контроллер не смог бы выставить refresh-cookie.
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('POST /auth/login: шестая попытка за минуту → 429 (KI-206)', async () => {
    for (let attempt = 0; attempt < LOGIN_THROTTLE.limit; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: EMAIL, password: 'test1234' })
        .expect(200);
    }

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: EMAIL, password: 'test1234' })
      .expect(429);

    // Сервис не вызывался шестой раз: guard отсекает запрос до контроллера.
    expect(loginAsync).toHaveBeenCalledTimes(LOGIN_THROTTLE.limit);
    expect(response.body).toMatchObject({ statusCode: 429 });
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('GET /workflow/share/:token: шестой запрос за минуту → 429 (KI-234)', async () => {
    for (let attempt = 0; attempt < SHARE_THROTTLE.limit; attempt += 1) {
      await request(app.getHttpServer())
        .get(`/workflow/share/${SHARE_TOKEN}`)
        .expect(200);
    }

    await request(app.getHttpServer())
      .get(`/workflow/share/${SHARE_TOKEN}`)
      .expect(429);

    expect(findSharedAsync).toHaveBeenCalledTimes(SHARE_THROTTLE.limit);
  });

  it('лимиты ручек строже общего лимита', () => {
    // Регрессия конфигурации: если общий лимит вдруг станет меньше строгого,
    // тест выше перестанет проверять именно `@Throttle`.
    expect(LOGIN_THROTTLE.limit).toBeLessThan(HTTP_THROTTLE_DEFAULT_LIMIT);
    expect(SHARE_THROTTLE.limit).toBeLessThan(HTTP_THROTTLE_DEFAULT_LIMIT);
  });
});
