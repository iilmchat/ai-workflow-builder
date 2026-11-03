import type { INestApplication } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
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
import type { UserRole } from '../db/schema.js';
import type {
  InviteMemberResponse,
  OrganizationMembersResponse,
} from './dto/member.dto.js';
import { OrgMembersController } from './org-members.controller.js';
import { OrgMembersService } from './org-members.service.js';

/** Пользователь из access-токена (JwtAuthGuard проверяет его в этих тестах). */
const USER = { sub: DEMO_USER_ID, email: DEMO_USER_EMAIL, orgId: DEMO_ORG_ID };

/** Стабильные идентификаторы тестовых данных. */
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const JOINED_AT = new Date('2024-02-01T00:00:00.000Z');
const INVITED_AT = new Date('2024-03-01T00:00:00.000Z');

/** Ответ сервиса списка команды (v1.0.0 S5). */
const membersResponse: OrganizationMembersResponse = {
  members: [
    {
      userId: DEMO_USER_ID,
      email: DEMO_USER_EMAIL,
      role: 'owner',
      joinedAt: CREATED_AT,
    },
    {
      userId: MEMBER_ID,
      email: 'member@example.com',
      role: 'member',
      joinedAt: JOINED_AT,
    },
  ],
  invitations: [
    {
      email: 'invite@example.com',
      role: 'viewer',
      invitedBy: DEMO_USER_ID,
      invitedAt: INVITED_AT,
    },
  ],
};

/** Ответ сервиса на приглашение (v1.1.0 S1: + признак отправки письма). */
const invitationSummary: InviteMemberResponse = {
  email: 'new@example.com',
  role: 'member',
  invitedBy: DEMO_USER_ID,
  invitedAt: INVITED_AT,
  emailSent: true,
};

/**
 * Минимальная цепочка Drizzle-запроса, которую выполняет `OrgOwnerGuard`:
 * `select(fields).from(users).where(...).limit(1)`.
 *
 * Объект «тогдабельный»: guard может как дождаться конца цепочки, так и
 * дочитать её через `limit`, поэтому стаб отдаёт строки при `await` на любом
 * звене. Возвращаемые строки вычисляются лениво — роль задаётся тестом.
 */
interface GuardSelectChain extends PromiseLike<Array<{ role: UserRole }>> {
  from(table: unknown): GuardSelectChain;
  where(condition: unknown): GuardSelectChain;
  limit(count: number): GuardSelectChain;
}

/**
 * Заглушка `DRIZZLE` для `OrgOwnerGuard`: всегда отдаёт текущую роль.
 *
 * @param getRole - функция, возвращающая роль пользователя (`null` — нет строки)
 * @returns стаб соединения Drizzle с одной таблицей `users`
 */
function createDbStub(getRole: () => UserRole | null): Database {
  const rows = (): Array<{ role: UserRole }> => {
    const role = getRole();

    return role === null ? [] : [{ role }];
  };

  const chain: GuardSelectChain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    // Стаб обязан поддерживать `await` на любом звене цепочки guard'а, а не
    // только после `limit`, поэтому объект — thenable (это осознанно, не
    // случайный `then`; правило ниже отключено точечно).
    // oxlint-disable-next-line unicorn/no-thenable
    then: (onFulfilled, onRejected) =>
      Promise.resolve(rows()).then(onFulfilled, onRejected),
  };

  const stub = { select: () => chain };

  return stub as unknown as Database;
}

describe('OrgMembersController (v1.0.0 S5)', () => {
  let app: INestApplication;
  let controller: OrgMembersController;
  let service: {
    listAsync: ReturnType<typeof vi.fn>;
    inviteAsync: ReturnType<typeof vi.fn>;
  };
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  /** Роль пользователя, которую вернёт заглушка `DRIZZLE` (guard). */
  let currentRole: UserRole | null;

  /** Заголовок авторизации с «валидным» токеном (verifyAsync замокан). */
  const authHeader = { Authorization: 'Bearer valid-token' };

  beforeEach(async () => {
    currentRole = 'owner';
    service = {
      listAsync: vi.fn(() => Promise.resolve(membersResponse)),
      inviteAsync: vi.fn(() => Promise.resolve(invitationSummary)),
    };
    jwt = {
      verifyAsync: vi.fn(() => Promise.resolve(USER)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [OrgMembersController],
      providers: [
        { provide: OrgMembersService, useValue: service },
        // JwtAuthGuard (R6.1a): AUTH_DISABLED=false — идём настоящим путём
        // проверки токена, verifyAsync возвращает payload пользователя.
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === 'AUTH_DISABLED' ? false : undefined,
            ),
          },
        },
        // OrgOwnerGuard (v1.0.0 S3/S5): читает users.role по user.sub.
        { provide: DRIZZLE, useValue: createDbStub(() => currentRole) },
      ],
    }).compile();

    controller = moduleRef.get(OrgMembersController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('GET /admin/members', () => {
    it('отвечает 200 и отдаёт {members,invitations} с Cache-Control: no-store', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/members')
        .set(authHeader)
        .expect(200)
        // Персональные авторизованные данные — кэш запрещён.
        .expect('Cache-Control', 'no-store');

      // Сервису передаётся только id пользователя: организация резолвится из
      // БД, а не из orgId токена (KI-554).
      expect(service.listAsync).toHaveBeenCalledWith(DEMO_USER_ID);
      expect(response.body).toEqual(JSON.parse(JSON.stringify(membersResponse)));
    });

    it('доступен любому участнику: role=member тоже получает 200', async () => {
      currentRole = 'member';

      await request(app.getHttpServer())
        .get('/admin/members')
        .set(authHeader)
        .expect(200);

      expect(service.listAsync).toHaveBeenCalledTimes(1);
    });

    it('без токена отвечает 401, сервис не вызывается', async () => {
      await request(app.getHttpServer()).get('/admin/members').expect(401);

      expect(jwt.verifyAsync).not.toHaveBeenCalled();
      expect(service.listAsync).not.toHaveBeenCalled();
    });

    it('невалидный токен отвечает 401, сервис не вызывается', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('bad token'));

      await request(app.getHttpServer())
        .get('/admin/members')
        .set('Authorization', 'Bearer broken-token')
        .expect(401);

      expect(service.listAsync).not.toHaveBeenCalled();
    });

    it('делегирует в сервис и возвращает его результат', async () => {
      await expect(controller.list(USER)).resolves.toEqual(membersResponse);
      expect(service.listAsync).toHaveBeenCalledWith(DEMO_USER_ID);
    });
  });

  describe('POST /admin/members/invite', () => {
    it('отвечает 201 и отдаёт выписанное приглашение', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'new@example.com', role: 'member' })
        .expect(201);

      expect(service.inviteAsync).toHaveBeenCalledWith(DEMO_USER_ID, {
        email: 'new@example.com',
        role: 'member',
      });
      expect(response.body).toEqual(JSON.parse(JSON.stringify(invitationSummary)));
      // v1.1.0 S1: 201 не означает «письмо доставлено» — признак отправки
      // приходит клиенту отдельным полем.
      expect(response.body.emailSent).toBe(true);
    });

    it('администратор (role=admin) тоже может приглашать', async () => {
      currentRole = 'admin';

      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'new@example.com', role: 'viewer' })
        .expect(201);

      expect(service.inviteAsync).toHaveBeenCalledTimes(1);
    });

    it('участник (role=member) получает 403, сервис не вызывается', async () => {
      currentRole = 'member';

      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'new@example.com', role: 'member' })
        .expect(403);

      expect(service.inviteAsync).not.toHaveBeenCalled();
    });

    it('role=viewer получает 403, сервис не вызывается', async () => {
      currentRole = 'viewer';

      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'new@example.com', role: 'member' })
        .expect(403);

      expect(service.inviteAsync).not.toHaveBeenCalled();
    });

    it('без токена отвечает 401, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .send({ email: 'new@example.com', role: 'member' })
        .expect(401);

      expect(service.inviteAsync).not.toHaveBeenCalled();
    });

    it('некорректный email — 400 от Zod-пайпа, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'not-an-email', role: 'member' })
        .expect(400);

      expect(service.inviteAsync).not.toHaveBeenCalled();
    });

    it('роль owner назначать нельзя — 400 от Zod-пайпа (KI-563)', async () => {
      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'new@example.com', role: 'owner' })
        .expect(400);

      expect(service.inviteAsync).not.toHaveBeenCalled();
    });

    it('пробрасывает 409 сервиса (email занят), тело запроса не меняется', async () => {
      service.inviteAsync.mockRejectedValue(
        new ConflictException('email уже занят'),
      );

      await request(app.getHttpServer())
        .post('/admin/members/invite')
        .set(authHeader)
        .send({ email: 'taken@example.com', role: 'member' })
        .expect(409);
    });

    it('делегирует в сервис и возвращает его результат', async () => {
      await expect(
        controller.invite(USER, { email: 'new@example.com', role: 'member' }),
      ).resolves.toEqual(invitationSummary);
      expect(service.inviteAsync).toHaveBeenCalledWith(DEMO_USER_ID, {
        email: 'new@example.com',
        role: 'member',
      });
    });
  });
});
