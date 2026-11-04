import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from '../auth.constants.js';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import type { JwtPayload } from '../interfaces/jwt-payload.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/** Стабильные данные пользователя из токена. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG_ID = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'signed.jwt.token';

/** Payload актуального токена (v1.1.0 S5: с версией). */
const PAYLOAD: JwtPayload = {
  sub: USER_ID,
  email: EMAIL,
  orgId: ORG_ID,
  ver: 1,
};

/** Текущая строка `users`, которую видит guard. */
interface CurrentUser {
  organizationId: string;
  tokenVersion: number;
}

/** Минимальный запрос, который читает guard (без `any`, RULES 4.15). */
interface TestRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: JwtPayload;
}

/**
 * Цепочка `select(...).from(users).where(...).limit(1)` для заглушки DRIZZLE.
 *
 * Объект «тогдабельный»: guard может дождаться конца цепочки на любом звене.
 */
interface GuardSelectChain extends PromiseLike<CurrentUser[]> {
  from(table: unknown): GuardSelectChain;
  where(condition: unknown): GuardSelectChain;
  limit(count: number): GuardSelectChain;
}

/**
 * Заглушка DRIZZLE: отдаёт текущую строку `users` по требованию guard'а.
 *
 * @param current - функция, возвращающая строку или `null` (пользователя нет)
 * @returns соединение Drizzle с одним `select`
 */
function createDbStub(current: () => CurrentUser | null): Database {
  const rows = (): CurrentUser[] => {
    const found = current();

    return found === null ? [] : [found];
  };

  const chain: GuardSelectChain = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    // Стаб обязан поддерживать `await` на любом звене цепочки guard'а, а не
    // только после `limit`, поэтому объект — thenable (осознанно).
    // oxlint-disable-next-line unicorn/no-thenable
    then: (onFulfilled, onRejected) =>
      Promise.resolve(rows()).then(onFulfilled, onRejected),
  };

  return { select: () => chain } as unknown as Database;
}

/**
 * Создаёт контекст выполнения Nest с заданными заголовками запроса.
 *
 * @param headers - заголовки входящего запроса
 * @returns контекст и сам запрос (для проверки `request.user`)
 */
function createContext(headers: Record<string, string | string[] | undefined>): {
  context: ExecutionContext;
  request: TestRequest;
} {
  const request: TestRequest = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('JwtAuthGuard (v1.0 S1; сверка с БД — v1.1.0 S5)', () => {
  let guard: JwtAuthGuard;
  let verifyAsync: ReturnType<typeof vi.fn>;
  let authDisabled: boolean;
  /** Текущая строка users, которую вернёт заглушка БД. */
  let currentUser: CurrentUser | null;
  let select: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    authDisabled = false;
    currentUser = { organizationId: ORG_ID, tokenVersion: 1 };
    verifyAsync = vi.fn(() => Promise.resolve(PAYLOAD));
    const db = createDbStub(() => currentUser);
    select = vi.spyOn(db, 'select');

    const moduleRef = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: { verifyAsync } },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) =>
              key === 'AUTH_DISABLED' ? authDisabled : undefined,
            ),
          },
        },
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    guard = moduleRef.get(JwtAuthGuard);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AUTH_DISABLED=true', () => {
    it('подставляет системного пользователя с orgId демо-организации', async () => {
      authDisabled = true;
      const { context, request } = createContext({});

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({
        sub: DEMO_USER_ID,
        email: DEMO_USER_EMAIL,
        orgId: DEMO_ORG_ID,
        ver: 0,
      });
      // Токен и БД в dev/CI не проверяются — запрос идёт от системного пользователя.
      expect(verifyAsync).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    });
  });

  describe('валидный access-токен', () => {
    it('кладёт payload с orgId из БД в request.user', async () => {
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(PAYLOAD);
      expect(verifyAsync).toHaveBeenCalledWith(TOKEN);
      // Сверка с БД — ровно один SELECT по `sub` (форма запроса проверяется
      // косвенно: несовпадение org/version ниже даёт 401).
      expect(select).toHaveBeenCalledTimes(1);
    });

    it('принимает заголовок Authorization как массив', async () => {
      const { context, request } = createContext({
        authorization: [`Bearer ${TOKEN}`],
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user?.orgId).toBe(ORG_ID);
    });

    it('legacy-токен без ver считается версией 0 (совместимость)', async () => {
      currentUser = { organizationId: ORG_ID, tokenVersion: 0 };
      verifyAsync.mockResolvedValue({ sub: USER_ID, email: EMAIL, orgId: ORG_ID });
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({
        sub: USER_ID,
        email: EMAIL,
        orgId: ORG_ID,
        ver: 0,
      });
    });
  });

  describe('KI-601: токен отозван или организация изменилась', () => {
    it('401, если orgId в токене не совпадает с organization_id в БД', async () => {
      currentUser = { organizationId: OTHER_ORG_ID, tokenVersion: 1 };
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(request.user).toBeUndefined();
    });

    it('401, если token_version в БД больше ver из токена', async () => {
      currentUser = { organizationId: ORG_ID, tokenVersion: 2 };
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      const error = await guard
        .canActivate(context)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toContain('отозван');
      expect(request.user).toBeUndefined();
    });

    it('401, если строки users нет (пользователь удалён)', async () => {
      currentUser = null;
      const { context } = createContext({ authorization: `Bearer ${TOKEN}` });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Пользователь не найден'),
      );
    });
  });

  describe('legacy-токен без orgId (DESIGN § 4)', () => {
    it('отклоняет токен без orgId с понятным сообщением', async () => {
      verifyAsync.mockResolvedValue({ sub: USER_ID, email: EMAIL });
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      const error = await guard
        .canActivate(context)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toContain('устарел');
      expect(request.user).toBeUndefined();
      // До БД дело не доходит: payload уже невалиден.
      expect(select).not.toHaveBeenCalled();
    });

    it('отклоняет токен с пустым orgId', async () => {
      verifyAsync.mockResolvedValue({ sub: USER_ID, email: EMAIL, orgId: '' });
      const { context } = createContext({ authorization: `Bearer ${TOKEN}` });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('отсутствующий или невалидный токен', () => {
    it('бросает UnauthorizedException без заголовка Authorization', async () => {
      const { context } = createContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Нет токена'),
      );
      expect(verifyAsync).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    });

    it('бросает UnauthorizedException для не-Bearer заголовка', async () => {
      const { context } = createContext({ authorization: 'Basic abc' });

      await expect(guard.canActivate(context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('бросает UnauthorizedException, если verifyAsync отклонил токен', async () => {
      verifyAsync.mockRejectedValue(new Error('invalid signature'));
      const { context } = createContext({ authorization: `Bearer ${TOKEN}` });

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Невалидный токен'),
      );
    });
  });
});
