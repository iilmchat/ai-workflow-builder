import type { INestApplication } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
  OrganizationMemberSummary,
  OrganizationMembersResponse,
} from './dto/member.dto.js';
import { OrgMembersController } from './org-members.controller.js';
import { OrgMembersService } from './org-members.service.js';
import { OrgOwnerOnlyGuard } from './org-owner-only.guard.js';

/** Пользователь из access-токена (JwtAuthGuard проверяет его в этих тестах). */
const USER = {
  sub: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  orgId: DEMO_ORG_ID,
  ver: 0,
};

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

/** Ответ сервиса на приглашение (v1.2.0 S2: письмо в очереди, emailSent=false; KI-622). */
const invitationSummary: InviteMemberResponse = {
  email: 'new@example.com',
  role: 'member',
  invitedBy: DEMO_USER_ID,
  invitedAt: INVITED_AT,
  emailSent: false,
  emailQueued: true,
};

/** Ответ сервиса на смену роли участника (v1.1.0 S2). */
const updatedMember: OrganizationMemberSummary = {
  userId: MEMBER_ID,
  email: 'member@example.com',
  role: 'viewer',
  joinedAt: JOINED_AT,
};

/**
 * Минимальная цепочка Drizzle-запроса, которую выполняет `OrgOwnerGuard`:
 * `select(fields).from(users).where(...).limit(1)`.
 *
 * Объект «тогдабельный»: guard может как дождаться конца цепочки, так и
 * дочитать её через `limit`, поэтому стаб отдаёт строки при `await` на любом
 * звене. Возвращаемые строки вычисляются лениво — роль задаётся тестом.
 */
interface GuardSelectChain extends PromiseLike<Array<{ role: UserRole; organizationId: string; tokenVersion: number }>> {
  from(table: unknown): GuardSelectChain;
  where(condition: unknown): GuardSelectChain;
  limit(count: number): GuardSelectChain;
}

/**
 * Заглушка `DRIZZLE` для `OrgOwnerGuard`: всегда отдаёт текущую роль.
 *
 * @param getRole - функция, возвращающая роль пользователя (
ull` — нет строки)
 * @returns стаб соединения Drizzle с одной таблицей `users`
 */
function createDbStub(getRole: () => UserRole | null): Database {
  const rows = (): Array<{ role: UserRole; organizationId: string; tokenVersion: number }> => {
    const role = getRole();

    return role === null
      ? []
      : [{ role, organizationId: DEMO_ORG_ID, tokenVersion: 0 }];
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
    updateRoleAsync: ReturnType<typeof vi.fn>;
    removeMemberAsync: ReturnType<typeof vi.fn>;
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
      updateRoleAsync: vi.fn(() => Promise.resolve(updatedMember)),
      removeMemberAsync: vi.fn(() => Promise.resolve()),
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
        // OrgOwnerOnlyGuard (v1.1.0 S2): только owner для PATCH/DELETE;
        // использует тот же стаб роли, что и OrgOwnerGuard.
        OrgOwnerOnlyGuard,
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
      // v1.2.0 S2: 201 не означает «письмо доставлено» — emailSent остаётся
      // false, а поставлено ли задание в очередь, сообщает emailQueued (KI-622).
      expect(response.body.emailSent).toBe(false);
      expect(response.body.emailQueued).toBe(true);
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

  describe('PATCH /admin/members/:userId (v1.1.0 S2)', () => {
    it('владелец меняет роль: 200 и обновлённый участник', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .send({ role: 'viewer' })
        .expect(200);

      expect(service.updateRoleAsync).toHaveBeenCalledWith(
        DEMO_USER_ID,
        MEMBER_ID,
        { role: 'viewer' },
      );
      expect(response.body).toEqual(JSON.parse(JSON.stringify(updatedMember)));
    });

    it('роль owner назначать нельзя — 400 от Zod-пайпа, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .send({ role: 'owner' })
        .expect(400);

      expect(service.updateRoleAsync).not.toHaveBeenCalled();
    });

    it('некорректный uuid участника — 400 от Zod-пайпа', async () => {
      await request(app.getHttpServer())
        .patch('/admin/members/not-a-uuid')
        .set(authHeader)
        .send({ role: 'viewer' })
        .expect(400);

      expect(service.updateRoleAsync).not.toHaveBeenCalled();
    });

    it('admin получает 403: управляет только owner', async () => {
      currentRole = 'admin';

      await request(app.getHttpServer())
        .patch(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .send({ role: 'viewer' })
        .expect(403);

      expect(service.updateRoleAsync).not.toHaveBeenCalled();
    });

    it('member получает 403', async () => {
      currentRole = 'member';

      await request(app.getHttpServer())
        .patch(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .send({ role: 'viewer' })
        .expect(403);

      expect(service.updateRoleAsync).not.toHaveBeenCalled();
    });

    it('смена собственной роли — 400 от сервиса', async () => {
      service.updateRoleAsync.mockRejectedValue(
        new BadRequestException('Нельзя изменить собственную роль'),
      );

      await request(app.getHttpServer())
        .patch(`/admin/members/${DEMO_USER_ID}`)
        .set(authHeader)
        .send({ role: 'member' })
        .expect(400);
    });

    it('участник чужой организации/несуществующий — 404', async () => {
      service.updateRoleAsync.mockRejectedValue(
        new NotFoundException('Участник не найден в организации'),
      );

      await request(app.getHttpServer())
        .patch(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .send({ role: 'viewer' })
        .expect(404);
    });

    it('без токена — 401, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/members/${MEMBER_ID}`)
        .send({ role: 'viewer' })
        .expect(401);

      expect(service.updateRoleAsync).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /admin/members/:userId (v1.1.0 S2)', () => {
    it('владелец исключает участника: 204, тело пустое', async () => {
      const response = await request(app.getHttpServer())
        .delete(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .expect(204);

      expect(service.removeMemberAsync).toHaveBeenCalledWith(
        DEMO_USER_ID,
        MEMBER_ID,
      );
      expect(response.text).toBe('');
    });

    it('некорректный uuid участника — 400 от Zod-пайпа', async () => {
      await request(app.getHttpServer())
        .delete('/admin/members/not-a-uuid')
        .set(authHeader)
        .expect(400);

      expect(service.removeMemberAsync).not.toHaveBeenCalled();
    });

    it('admin получает 403: удаляет только owner', async () => {
      currentRole = 'admin';

      await request(app.getHttpServer())
        .delete(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .expect(403);

      expect(service.removeMemberAsync).not.toHaveBeenCalled();
    });

    it('удаление самого себя — 400 от сервиса', async () => {
      service.removeMemberAsync.mockRejectedValue(
        new BadRequestException('Нельзя удалить самого себя из организации'),
      );

      await request(app.getHttpServer())
        .delete(`/admin/members/${DEMO_USER_ID}`)
        .set(authHeader)
        .expect(400);
    });

    it('участник чужой организации/несуществующий — 404', async () => {
      service.removeMemberAsync.mockRejectedValue(
        new NotFoundException('Участник не найден в организации'),
      );

      await request(app.getHttpServer())
        .delete(`/admin/members/${MEMBER_ID}`)
        .set(authHeader)
        .expect(404);
    });

    it('без токена — 401, сервис не вызывается', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/members/${MEMBER_ID}`)
        .expect(401);

      expect(service.removeMemberAsync).not.toHaveBeenCalled();
    });
  });
});
