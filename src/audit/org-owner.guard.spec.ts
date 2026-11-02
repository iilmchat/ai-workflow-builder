import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { users } from '../db/schema.js';
import { OrgOwnerGuard } from './org-owner.guard.js';

/** Стабильные данные пользователя из токена. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const ORG_ID = '55555555-5555-4555-8555-555555555555';

/** Payload аутентифицированного пользователя (v1.0 S3). */
const PAYLOAD: JwtPayload = { sub: USER_ID, email: EMAIL, orgId: ORG_ID };

/** Минимальный запрос, который читает guard (без `any`, RULES 4.15). */
interface TestRequest {
  user?: JwtPayload;
}

/**
 * Создаёт контекст выполнения Nest с заданным `request.user`.
 *
 * @param user - payload access-токена либо `undefined` (анонимный запрос)
 * @returns контекст и сам запрос (для проверки `request.user`)
 */
function createContext(user?: JwtPayload): {
  context: ExecutionContext;
  request: TestRequest;
} {
  const request: TestRequest = user === undefined ? {} : { user };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('OrgOwnerGuard (v1.0 S3)', () => {
  let guard: OrgOwnerGuard;
  let select: ReturnType<typeof vi.fn>;
  let selectLimit: ReturnType<typeof vi.fn>;
  /** Условие `WHERE`, собранное guard'ом (для проверки фильтра по `sub`). */
  let whereCondition: SQL | undefined;

  beforeEach(async () => {
    whereCondition = undefined;
    selectLimit = vi.fn(() => Promise.resolve([]));
    select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: SQL) => {
          whereCondition = condition;

          return { limit: selectLimit };
        }),
      })),
    }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrgOwnerGuard,
        { provide: DRIZZLE, useValue: { select } as unknown as Database },
      ],
    }).compile();

    guard = moduleRef.get(OrgOwnerGuard);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('доступ разрешён', () => {
    it('owner проходит и получает `true`', async () => {
      selectLimit.mockResolvedValue([{ role: 'owner' }]);

      const { context } = createContext(PAYLOAD);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      // Из БД читается только роль, а не вся строка пользователя.
      expect(select).toHaveBeenCalledWith({ role: users.role });
      expect(selectLimit).toHaveBeenCalledWith(1);
    });

    it('admin проходит: он тоже допущен к журналу аудита', async () => {
      selectLimit.mockResolvedValue([{ role: 'admin' }]);

      const { context } = createContext(PAYLOAD);

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('читает роль по users.id = sub из токена', async () => {
      selectLimit.mockResolvedValue([{ role: 'owner' }]);

      const { context } = createContext(PAYLOAD);

      await guard.canActivate(context);

      if (whereCondition === undefined) {
        throw new Error('guard не собрал WHERE-условие');
      }

      const query = new PgDialect().sqlToQuery(whereCondition);

      expect(query.params).toEqual([USER_ID]);
      expect(query.sql).toContain('users');
    });
  });

  describe('доступ запрещён', () => {
    it('member отклоняется с 403', async () => {
      selectLimit.mockResolvedValue([{ role: 'member' }]);

      const { context } = createContext(PAYLOAD);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('viewer отклоняется с 403', async () => {
      selectLimit.mockResolvedValue([{ role: 'viewer' }]);

      const { context } = createContext(PAYLOAD);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('на 403 отдаёт понятное сообщение', async () => {
      selectLimit.mockResolvedValue([{ role: 'member' }]);

      const { context } = createContext(PAYLOAD);
      const error = await guard.canActivate(context).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(
        'Недостаточно прав: требуется владелец организации',
      );
    });
  });

  describe('аутентификация', () => {
    it('без request.user бросает 401 и не ходит в БД', async () => {
      const { context } = createContext();

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      expect(select).not.toHaveBeenCalled();
    });

    it('бросает 401, если строки users нет', async () => {
      selectLimit.mockResolvedValue([]);

      const { context } = createContext(PAYLOAD);
      const error = await guard.canActivate(context).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Пользователь не найден');
    });
  });
});
