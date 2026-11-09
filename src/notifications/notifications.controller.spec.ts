import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from '../auth/auth.constants.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { DeviceTokensService } from './device-tokens.service.js';
import { NotificationsController } from './notifications.controller.js';

/** Пользователь из access-токена (JwtAuthGuard проверяет его в этих тестах). */
const USER = {
  sub: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  orgId: DEMO_ORG_ID,
  ver: 0,
};

/**
 * Организация, которую вернёт сервис по строке `users`.
 *
 * Заведомо не совпадает с `orgId` из токена: контроллер обязан использовать
 * значение из БД (KI-554), а не `user.orgId`.
 */
const RESOLVED_ORG_ID = '22222222-2222-4222-8222-222222222222';

/** Валидный push-токен устройства (формат проверяет провайдер, не мы). */
const FCM_TOKEN = 'fcm-device-token-abc123';

/** Заголовок авторизации с «валидным» токеном (verifyAsync замокан). */
const authHeader = { Authorization: 'Bearer valid-token' };

/**
 * Минимальная цепочка Drizzle-запроса `JwtAuthGuard` (S5, KI-601):
 * `select(fields).from(users).where(...).limit(1)`.
 *
 * Объект «тогдабельный»: guard дожидается результата на последнем звене, и
 * стаб обязан поддерживать `await` на любом звене цепочки.
 */
interface GuardSelectChain
  extends PromiseLike<Array<{ organizationId: string; tokenVersion: number }>> {
  from(table: unknown): GuardSelectChain;
  where(condition: unknown): GuardSelectChain;
  limit(count: number): GuardSelectChain;
}

/**
 * Заглушка `DRIZZLE` для `JwtAuthGuard`: строка `users` совпадает с токеном.
 *
 * @returns стаб соединения Drizzle с одной таблицей `users`
 */
function createDbStub(): Database {
  const rows = [{ organizationId: DEMO_ORG_ID, tokenVersion: 0 }];

  const selectChain: GuardSelectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => selectChain,
    // Стаб обязан поддерживать `await` на любом звене цепочки guard'а, а не
    // только после `limit`, поэтому объект — thenable (осознанно; правило ниже
    // отключено точечно, как в `org-members.controller.spec.ts`).
    // oxlint-disable-next-line unicorn/no-thenable
    then: (onFulfilled, onRejected) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  };

  const stub = { select: () => selectChain };

  return stub as unknown as Database;
}

describe('NotificationsController (v1.5.0 S3)', () => {
  let app: INestApplication;
  let controller: NotificationsController;
  let service: {
    resolveOrganizationIdAsync: ReturnType<typeof vi.fn>;
    upsertAsync: ReturnType<typeof vi.fn>;
  };
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      resolveOrganizationIdAsync: vi.fn(() => Promise.resolve(RESOLVED_ORG_ID)),
      upsertAsync: vi.fn(() => Promise.resolve()),
    };
    jwt = {
      verifyAsync: vi.fn(() => Promise.resolve(USER)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: DeviceTokensService, useValue: service },
        // JwtAuthGuard (S5): настоящий путь проверки токена — verifyAsync
        // возвращает payload пользователя.
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === 'AUTH_DISABLED' ? false : undefined,
            ),
          },
        },
        // JwtAuthGuard сверяет payload с БД (organization_id + token_version).
        { provide: DRIZZLE, useValue: createDbStub() },
      ],
    }).compile();

    controller = moduleRef.get(NotificationsController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('POST /notifications/register', () => {
    it('регистрирует токен в организации из БД и отвечает {ok:true} с Cache-Control: no-store', async () => {
      const response = await request(app.getHttpServer())
        .post('/notifications/register')
        .set(authHeader)
        .send({ token: FCM_TOKEN, platform: 'android' })
        .expect(201)
        // Авторизованный ответ — кэш запрещён.
        .expect('Cache-Control', 'no-store');

      expect(response.body).toEqual({ ok: true });

      // Контроллер передаёт только `sub`: организация резолвится из БД, а не
      // берётся из orgId токена (KI-554).
      expect(service.resolveOrganizationIdAsync).toHaveBeenCalledWith(
        DEMO_USER_ID,
      );
      expect(service.upsertAsync).toHaveBeenCalledWith(
        DEMO_USER_ID,
        RESOLVED_ORG_ID,
        FCM_TOKEN,
        'android',
      );
      // Порядок важен: без организации UPSERT не начинается.
      expect(
        service.resolveOrganizationIdAsync.mock.invocationCallOrder[0],
      ).toBeLessThan(service.upsertAsync.mock.invocationCallOrder[0] ?? 0);
    });

    it('неизвестная платформа — 400 от Zod-пайпа, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .post('/notifications/register')
        .set(authHeader)
        .send({ token: FCM_TOKEN, platform: 'windows-phone' })
        .expect(400);

      expect(service.resolveOrganizationIdAsync).not.toHaveBeenCalled();
      expect(service.upsertAsync).not.toHaveBeenCalled();
    });

    it('пустой токен — 400 от Zod-пайпа, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .post('/notifications/register')
        .set(authHeader)
        .send({ token: '', platform: 'ios' })
        .expect(400);

      expect(service.upsertAsync).not.toHaveBeenCalled();
    });

    it('без токена — 401, guard не пускает запрос', async () => {
      await request(app.getHttpServer())
        .post('/notifications/register')
        .send({ token: FCM_TOKEN, platform: 'web' })
        .expect(401);

      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(service.upsertAsync).not.toHaveBeenCalled();
    });

    it('пользователь удалён (нет строки users) — 401 от сервиса', async () => {
      service.resolveOrganizationIdAsync.mockRejectedValue(
        new UnauthorizedException('Пользователь не найден'),
      );

      await request(app.getHttpServer())
        .post('/notifications/register')
        .set(authHeader)
        .send({ token: FCM_TOKEN, platform: 'android' })
        .expect(401);

      expect(service.upsertAsync).not.toHaveBeenCalled();
    });

    it('делегирует в сервис и возвращает {ok:true}', async () => {
      await expect(
        controller.register(USER, { token: FCM_TOKEN, platform: 'web' }),
      ).resolves.toEqual({ ok: true });

      expect(service.upsertAsync).toHaveBeenCalledWith(
        DEMO_USER_ID,
        RESOLVED_ORG_ID,
        FCM_TOKEN,
        'web',
      );
    });
  });
});
