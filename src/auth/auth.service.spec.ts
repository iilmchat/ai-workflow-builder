import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { User } from '../db/schema.js';
import { AuthService } from './auth.service.js';

/** Стабильные данные тестового пользователя. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const PASSWORD = 'test1234';
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const TOKEN = 'signed.jwt.token';

/** Строка `users` без учёта `passwordHash` (его подставляет тест). */
const baseUser: Omit<User, 'passwordHash'> = {
  id: USER_ID,
  email: EMAIL,
  createdAt: CREATED_AT,
};

describe('AuthService', () => {
  let service: AuthService;
  let selectLimit: ReturnType<typeof vi.fn>;
  let insertValues: ReturnType<typeof vi.fn>;
  let insertReturning: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    selectLimit = vi.fn(() => Promise.resolve([]));
    insertReturning = vi.fn(() => Promise.resolve([]));
    insertValues = vi.fn(() => ({ returning: insertReturning }));

    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => ({ limit: selectLimit })) })),
      })),
      insert: vi.fn(() => ({ values: insertValues })),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
        { provide: JwtService, useValue: { signAsync: vi.fn(() => Promise.resolve(TOKEN)) } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: vi.fn(() => '24h') },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerAsync', () => {
    it('создаёт пользователя и возвращает токен', async () => {
      insertReturning.mockResolvedValue([{ ...baseUser, passwordHash: 'scrypt$x$y' }]);

      const result = await service.registerAsync({ email: EMAIL, password: PASSWORD });

      expect(result.accessToken).toBe(TOKEN);
      expect(result.user).toEqual({ id: USER_ID, email: EMAIL, createdAt: CREATED_AT });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('сохраняет email нормализованным, а пароль — только хэшем (RULES 5.3)', async () => {
      insertReturning.mockResolvedValue([{ ...baseUser, passwordHash: 'scrypt$x$y' }]);

      await service.registerAsync({ email: '  User@Example.COM ', password: PASSWORD });

      const [values] = insertValues.mock.calls[0] as [
        { email: string; passwordHash: string },
      ];

      expect(values.email).toBe('user@example.com');
      expect(values.passwordHash.startsWith('scrypt$')).toBe(true);
      expect(values.passwordHash).not.toContain(PASSWORD);
    });

    it('бросает ConflictException на занятый email', async () => {
      selectLimit.mockResolvedValue([{ id: USER_ID }]);

      await expect(
        service.registerAsync({ email: EMAIL, password: PASSWORD }),
      ).rejects.toThrow(ConflictException);
      expect(insertReturning).not.toHaveBeenCalled();
    });

    it('нормализует email (нижний регистр, без пробелов)', async () => {
      insertReturning.mockResolvedValue([{ ...baseUser, passwordHash: 'scrypt$x$y' }]);

      const result = await service.registerAsync({
        email: '  User@Example.COM ',
        password: PASSWORD,
      });

      expect(result.user.email).toBe('user@example.com');
    });
  });

  describe('loginAsync', () => {
    it('возвращает токен при верном пароле', async () => {
      const passwordHash = await service.hashPasswordAsync(PASSWORD);
      selectLimit.mockResolvedValue([{ ...baseUser, passwordHash }]);

      const result = await service.loginAsync({ email: EMAIL, password: PASSWORD });

      expect(result.accessToken).toBe(TOKEN);
      expect(result.user.email).toBe(EMAIL);
    });

    it('бросает UnauthorizedException, если пользователя нет', async () => {
      await expect(
        service.loginAsync({ email: 'nobody@example.com', password: PASSWORD }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('бросает UnauthorizedException при неверном пароле', async () => {
      const passwordHash = await service.hashPasswordAsync(PASSWORD);
      selectLimit.mockResolvedValue([{ ...baseUser, passwordHash }]);

      await expect(
        service.loginAsync({ email: EMAIL, password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('не различает «нет пользователя» и «неверный пароль» по тексту', async () => {
      const missing = await service
        .loginAsync({ email: 'nobody@example.com', password: PASSWORD })
        .catch((error: unknown) => error);

      const passwordHash = await service.hashPasswordAsync(PASSWORD);
      selectLimit.mockResolvedValue([{ ...baseUser, passwordHash }]);

      const wrong = await service
        .loginAsync({ email: EMAIL, password: 'wrong-password' })
        .catch((error: unknown) => error);

      expect((missing as Error).message).toBe((wrong as Error).message);
    });
  });

  describe('getMeAsync', () => {
    it('возвращает публичные данные пользователя', async () => {
      selectLimit.mockResolvedValue([{ ...baseUser, passwordHash: 'scrypt$x$y' }]);

      await expect(service.getMeAsync(USER_ID)).resolves.toEqual({
        id: USER_ID,
        email: EMAIL,
        createdAt: CREATED_AT,
      });
    });

    it('бросает UnauthorizedException, если пользователь удалён', async () => {
      await expect(service.getMeAsync(USER_ID)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('пароли (scrypt)', () => {
    it('хеширует один пароль по-разному (уникальная соль)', async () => {
      const first = await service.hashPasswordAsync(PASSWORD);
      const second = await service.hashPasswordAsync(PASSWORD);

      expect(first).not.toBe(second);
      expect(first.startsWith('scrypt$')).toBe(true);
      expect(first.includes(PASSWORD)).toBe(false);
    });

    it('проверяет верный и неверный пароль', async () => {
      const stored = await service.hashPasswordAsync(PASSWORD);

      await expect(service.verifyPasswordAsync(PASSWORD, stored)).resolves.toBe(true);
      await expect(service.verifyPasswordAsync('other', stored)).resolves.toBe(false);
    });

    it('отвергает системный хэш-заглушку и битые значения', async () => {
      await expect(
        service.verifyPasswordAsync(PASSWORD, 'scrypt$disabled$disabled'),
      ).resolves.toBe(false);
      await expect(service.verifyPasswordAsync(PASSWORD, 'plain')).resolves.toBe(false);
      await expect(service.verifyPasswordAsync(PASSWORD, '')).resolves.toBe(false);
    });
  });
});
