import type { INestApplication } from '@nestjs/common';
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
import { AdminAuditController } from './admin-audit.controller.js';
import { AuditService } from './audit.service.js';
import {
  decodeAuditCursor,
  encodeAuditCursor,
  type AuditLogsResponse,
} from './dto/audit.dto.js';

/** Пользователь из access-токена (JwtAuthGuard проверяет его в этих тестах). */
const USER = { sub: DEMO_USER_ID, email: DEMO_USER_EMAIL, orgId: DEMO_ORG_ID };

/** Организация, которой нет у пользователя в актуальной строке `users`. */
const STALE_ORG_ID = '99999999-9999-4999-8999-999999999999';

/** Автор действия для фильтра `userId`. */
const FILTER_USER_ID = '88888888-8888-4888-8888-888888888888';

/** Стабильные идентификаторы тестовых данных. */
const LOG_ID = '33333333-3333-4333-8333-333333333333';
const RESOURCE_ID = '44444444-4444-4444-8444-444444444444';

/** Строка журнала в ответе сервиса (v1.0.0 S3). */
const auditLogsResponse: AuditLogsResponse = {
  logs: [
    {
      id: LOG_ID,
      cursor: encodeAuditCursor({
        createdAt: '2024-01-01T00:00:00.000000Z',
        id: LOG_ID,
      }),
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      userId: DEMO_USER_ID,
      organizationId: DEMO_ORG_ID,
      action: 'workflow.create',
      resourceId: RESOURCE_ID,
      metadata: {
        method: 'POST',
        path: '/workflow',
        params: {},
        body: { name: 'demo' },
        statusCode: 201,
      },
    },
  ],
  nextCursor: null,
  total: 1,
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

describe('AdminAuditController (v1.0.0 S3)', () => {
  let app: INestApplication;
  let controller: AdminAuditController;
  let service: { listAsync: ReturnType<typeof vi.fn> };
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  /** Роль пользователя, которую вернёт заглушка `DRIZZLE` (guard). */
  let currentRole: UserRole | null;

  /** Заголовок авторизации с «валидным» токеном (verifyAsync замокан). */
  const authHeader = { Authorization: 'Bearer valid-token' };

  beforeEach(async () => {
    currentRole = 'owner';
    service = {
      listAsync: vi.fn(() => Promise.resolve(auditLogsResponse)),
    };
    jwt = {
      verifyAsync: vi.fn(() => Promise.resolve(USER)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAuditController],
      providers: [
        { provide: AuditService, useValue: service },
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
        // OrgOwnerGuard (v1.0.0 S3): читает users.role по user.sub.
        { provide: DRIZZLE, useValue: createDbStub(() => currentRole) },
      ],
    }).compile();

    controller = moduleRef.get(AdminAuditController);
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('GET /admin/audit отвечает 200 и отдаёт {logs,nextCursor,total} владельцу', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(200)
      // Персональные авторизованные данные — кэш запрещён.
      .expect('Cache-Control', 'no-store');

    // Страница по умолчанию: limit=20, курсора и фильтров нет.
    expect(service.listAsync).toHaveBeenCalledWith(
      DEMO_USER_ID,
      20,
      undefined,
      {},
    );
    expect(response.body).toEqual(
      JSON.parse(JSON.stringify(auditLogsResponse)),
    );
  });

  it('KI-587: передаёт в сервис только sub — orgId из токена не используется', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(200);

    // Второй аргумент — размер страницы, третий — курсор, четвёртый — фильтры;
    // организации в аргументах нет вообще: её резолвит сервис из users.
    expect(service.listAsync).toHaveBeenCalledWith(
      DEMO_USER_ID,
      20,
      undefined,
      {},
    );
  });

  it('KI-601: устаревший orgId в токене не попадает в сервис', async () => {
    // Пользователь удалён из организации: в токене остался старый orgId,
    // в БД он уже owner личной организации. Аудит должен читаться по БД.
    jwt.verifyAsync.mockResolvedValue({ ...USER, orgId: STALE_ORG_ID });

    await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(200);

    expect(service.listAsync).toHaveBeenCalledWith(
      DEMO_USER_ID,
      20,
      undefined,
      {},
    );
    // Старая организация не утекла ни в один аргумент вызова.
    expect(JSON.stringify(service.listAsync.mock.calls)).not.toContain(
      STALE_ORG_ID,
    );
  });

  it('администратор (role=admin) тоже получает 200', async () => {
    currentRole = 'admin';

    await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(200);

    expect(service.listAsync).toHaveBeenCalledTimes(1);
  });

  it('участник (role=member) получает 403, сервис не вызывается', async () => {
    currentRole = 'member';

    await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(403);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('role=viewer получает 403, сервис не вызывается', async () => {
    currentRole = 'viewer';

    await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(403);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('без токена отвечает 401 и не вызывает ни guard-БД, ни сервис', async () => {
    await request(app.getHttpServer()).get('/admin/audit').expect(401);

    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('невалидный токен отвечает 401, сервис не вызывается', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('bad token'));

    await request(app.getHttpServer())
      .get('/admin/audit')
      .set('Authorization', 'Bearer broken-token')
      .expect(401);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('несуществующий пользователь (нет строки users) — 401 от guard', async () => {
    currentRole = null;

    await request(app.getHttpServer())
      .get('/admin/audit')
      .set(authHeader)
      .expect(401);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('передаёт limit и раскодированный cursor из query в сервис', async () => {
    const cursor = encodeAuditCursor({
      createdAt: '2024-01-01T00:00:05.000000Z',
      id: LOG_ID,
    });

    await request(app.getHttpServer())
      .get(`/admin/audit?limit=5&cursor=${cursor}`)
      .set(authHeader)
      .expect(200);

    expect(service.listAsync).toHaveBeenCalledWith(
      DEMO_USER_ID,
      5,
      decodeAuditCursor(cursor),
      {},
    );
  });

  it('передаёт фильтры action/userId/from/to в сервис (KI-585)', async () => {
    await request(app.getHttpServer())
      .get(
        `/admin/audit?action=workflow.create&userId=${FILTER_USER_ID}` +
          '&from=2026-11-01&to=2026-11-02',
      )
      .set(authHeader)
      .expect(200);

    expect(service.listAsync).toHaveBeenCalledWith(
      DEMO_USER_ID,
      20,
      undefined,
      {
        action: 'workflow.create',
        userId: FILTER_USER_ID,
        // Дата без времени трактуется как UTC-сутки: from — начало,
        // to — конец включительно.
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: new Date('2026-11-02T23:59:59.999Z'),
      },
    );
  });

  it('невалидный action — 400 от Zod-пайпа, сервис не вызывается', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?action=not%20an%20action')
      .set(authHeader)
      .expect(400);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('невалидный userId — 400 от Zod-пайпа, сервис не вызывается', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?userId=not-a-uuid')
      .set(authHeader)
      .expect(400);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('from позже to — 400, а не пустая страница «молча»', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?from=2026-11-03&to=2026-11-01')
      .set(authHeader)
      .expect(400);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('несуществующая календарная дата (2026-02-30) — 400', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?from=2026-02-30')
      .set(authHeader)
      .expect(400);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('мусорный cursor — 400 от Zod-пайпа, сервис не вызывается', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?cursor=not-a-cursor')
      .set(authHeader)
      .expect(400);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('невалидный limit — 400 и сервис не вызывается', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit?limit=0')
      .set(authHeader)
      .expect(400);
    await request(app.getHttpServer())
      .get('/admin/audit?limit=101')
      .set(authHeader)
      .expect(400);

    expect(service.listAsync).not.toHaveBeenCalled();
  });

  it('делегирует в сервис и возвращает его результат', async () => {
    await expect(controller.list({ limit: 20 }, USER)).resolves.toEqual(
      auditLogsResponse,
    );
    expect(service.listAsync).toHaveBeenCalledWith(
      DEMO_USER_ID,
      20,
      undefined,
      {},
    );
  });
});
