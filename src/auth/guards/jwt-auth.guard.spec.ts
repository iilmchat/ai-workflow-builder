import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  DEMO_ORG_ID,
  DEMO_USER_EMAIL,
  DEMO_USER_ID,
} from '../auth.constants.js';
import type { JwtPayload } from '../interfaces/jwt-payload.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/** Стабильные данные пользователя из токена. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'signed.jwt.token';

/** Payload актуального токена (v1.0 S1: с orgId). */
const PAYLOAD: JwtPayload = { sub: USER_ID, email: EMAIL, orgId: ORG_ID };

/** Минимальный запрос, который читает guard (без `any`, RULES 4.15). */
interface TestRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: JwtPayload;
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

describe('JwtAuthGuard (v1.0 S1)', () => {
  let guard: JwtAuthGuard;
  let verifyAsync: ReturnType<typeof vi.fn>;
  let authDisabled: boolean;

  beforeEach(async () => {
    authDisabled = false;
    verifyAsync = vi.fn(() => Promise.resolve(PAYLOAD));

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
      });
      // Токен в dev/CI не проверяется — запрос идёт от системного пользователя.
      expect(verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('валидный access-токен', () => {
    it('кладёт payload с orgId в request.user', async () => {
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(PAYLOAD);
      expect(verifyAsync).toHaveBeenCalledWith(TOKEN);
    });

    it('принимает заголовок Authorization как массив', async () => {
      const { context, request } = createContext({
        authorization: [`Bearer ${TOKEN}`],
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user?.orgId).toBe(ORG_ID);
    });
  });

  describe('legacy-токен без orgId (DESIGN § 4)', () => {
    it('отклоняет токен без orgId с понятным сообщением', async () => {
      verifyAsync.mockResolvedValue({ sub: USER_ID, email: EMAIL });
      const { context, request } = createContext({
        authorization: `Bearer ${TOKEN}`,
      });

      const error = await guard.canActivate(context).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toContain('устарел');
      expect(request.user).toBeUndefined();
    });

    it('отклоняет токен с пустым orgId', async () => {
      verifyAsync.mockResolvedValue({ sub: USER_ID, email: EMAIL, orgId: '' });
      const { context } = createContext({ authorization: `Bearer ${TOKEN}` });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('отсутствующий или невалидный токен', () => {
    it('бросает UnauthorizedException без заголовка Authorization', async () => {
      const { context } = createContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Нет токена'),
      );
      expect(verifyAsync).not.toHaveBeenCalled();
    });

    it('бросает UnauthorizedException для не-Bearer заголовка', async () => {
      const { context } = createContext({ authorization: 'Basic abc' });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
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
