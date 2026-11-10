import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  organizationInvitations,
  type InvitableUserRole,
  type User,
  type UserRole,
} from '../db/schema.js';
import { AuthService } from './auth.service.js';

/** Стабильные данные тестового пользователя. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EMAIL = 'user@example.com';
const PASSWORD = 'test1234';
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const TOKEN = 'signed.jwt.token';
/** id строки `refresh_tokens` в моках. */
const TOKEN_ID = '44444444-4444-4444-8444-444444444444';
/** Организация, которую создаёт регистрация (v1.0 S1). */
const ORG_ID = '55555555-5555-4555-8555-555555555555';
/** Ожидаемое имя личной организации по нормализованному email. */
const ORG_NAME = `Personal Workspace - ${EMAIL}`;
/** Приглашение в организацию (v1.0.0 S5, KI-563). */
const INVITATION_ID = '66666666-6666-4666-8666-666666666666';
const INVITER_ID = '77777777-7777-4777-8777-777777777777';
const INVITED_AT = new Date('2024-02-01T00:00:00.000Z');

/** Строка `users` без учёта `passwordHash` (его подставляет тест). */
const baseUser: Omit<User, 'passwordHash'> = {
  id: USER_ID,
  organizationId: ORG_ID,
  email: EMAIL,
  // Регистрация создаёт владельца личной организации (v1.0 S3).
  role: 'owner',
  // v1.1.0 S5: версия access-токена (KI-601).
  tokenVersion: 0,
  createdAt: CREATED_AT,
};

describe('AuthService', () => {
  let service: AuthService;
  let selectLimit: ReturnType<typeof vi.fn>;
  let insertValues: ReturnType<typeof vi.fn>;
  let insertReturning: ReturnType<typeof vi.fn>;
  let updateReturning: ReturnType<typeof vi.fn>;
  let updateSet: ReturnType<typeof vi.fn>;
  let transaction: ReturnType<typeof vi.fn>;
  let signAsync: ReturnType<typeof vi.fn>;
  /** `tx.delete(...)` регистрации по приглашению (v1.0.0 S5). */
  let deleteTable: ReturnType<typeof vi.fn>;
  /** `WHERE` удаления приглашения — проверяется, что удалена нужная строка. */
  let deleteWhere: ReturnType<typeof vi.fn>;
  /** Режим регистрации (v1.6.0 S6-C). */
  let registrationMode: 'open' | 'invite';

  beforeEach(async () => {
    registrationMode = 'open';
    selectLimit = vi.fn(() => Promise.resolve([]));
    insertReturning = vi.fn(() => Promise.resolve([]));
    insertValues = vi.fn(() => ({ returning: insertReturning }));
    updateReturning = vi.fn(() => Promise.resolve([{ id: TOKEN_ID }]));
    updateSet = vi.fn(() => ({
      where: vi.fn(() => ({ returning: updateReturning })),
    }));
    signAsync = vi.fn(() => Promise.resolve(TOKEN));
    deleteWhere = vi.fn(() => Promise.resolve());
    deleteTable = vi.fn(() => ({ where: deleteWhere }));

    const update = vi.fn(() => ({ set: updateSet }));
    const insert = vi.fn(() => ({ values: insertValues }));
    // Регистрация ищет приглашение через `.orderBy(...).limit(1)` (v1.0.0 S5),
    // остальные запросы — сразу `.limit(1)`.
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimit,
          orderBy: vi.fn(() => ({ limit: selectLimit })),
        })),
      })),
    }));

    // Регистрация (RULES 4.22): организация + пользователь в одной транзакции;
    // регистрация по приглашению ещё и удаляет строку приглашения.
    // Ротация refresh-токена (R6.1b) тоже идёт в транзакции.
    transaction = vi.fn((callback: (tx: unknown) => Promise<unknown>) =>
      callback({ select, insert, update, delete: deleteTable }),
    );

    const db = {
      select,
      insert,
      update,
      transaction,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
        { provide: JwtService, useValue: { signAsync } },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn(() => '24h'),
            get: vi.fn((key: string) =>
              key === 'REGISTRATION_MODE' ? registrationMode : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Задаёт ответы INSERT'ов регистрации: организация, затем пользователь.
   *
   * @param organization - строка `organizations`, которую вернёт первый INSERT
   * @param user - строка `users`, которую вернёт второй INSERT
   */
  function mockRegisterInserts(
    organization: { id: string; name: string },
    user: User,
  ): void {
    insertReturning
      .mockResolvedValueOnce([organization])
      .mockResolvedValueOnce([user]);
  }

  /** Строка `users`, которую возвращает INSERT при регистрации. */
  function registeredUser(): User {
    return { ...baseUser, passwordHash: 'scrypt$x$y' };
  }

  /**
   * Строка `organization_invitations`, которую находит регистрация (v1.0.0 S5).
   *
   * @param role - роль, выданная приглашением (по умолчанию `admin`)
   * @returns приглашение в организацию {@link ORG_ID}
   */
  function invitation(role: InvitableUserRole = 'admin'): {
    id: string;
    organizationId: string;
    email: string;
    role: InvitableUserRole;
    invitedBy: string;
    createdAt: Date;
  } {
    return {
      id: INVITATION_ID,
      organizationId: ORG_ID,
      email: EMAIL,
      role,
      invitedBy: INVITER_ID,
      createdAt: INVITED_AT,
    };
  }

  /** Значения второго INSERT'а регистрации — в `users`. */
  function userInsertValues(): {
    email: string;
    passwordHash: string;
    organizationId: string;
    role: UserRole;
  } {
    return insertValues.mock.calls[1][0] as {
      email: string;
      passwordHash: string;
      organizationId: string;
      role: UserRole;
    };
  }

  describe('registerAsync', () => {
    it('создаёт организацию и пользователя в одной транзакции (RULES 4.22)', async () => {
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

      await service.registerAsync({ email: EMAIL, password: PASSWORD });

      // Организация и пользователь неделимы: иначе пользователь остался бы
      // без арендатора, а организация — сиротой.
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(insertValues).toHaveBeenNthCalledWith(1, { name: ORG_NAME });
      expect(insertValues).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ organizationId: ORG_ID, role: 'owner' }),
      );
      expect(userInsertValues().organizationId).toBe(ORG_ID);
      // Создатель личной организации — владелец (v1.0 S3): по роли guard
      // `OrgOwnerGuard` пускает в журнал аудита.
      expect(userInsertValues().role).toBe('owner');
    });

    it('выдаёт токен с orgId созданной организации', async () => {
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

      const result = await service.registerAsync({ email: EMAIL, password: PASSWORD });

      expect(result.accessToken).toBe(TOKEN);
      expect(signAsync).toHaveBeenCalledWith(
        { sub: USER_ID, email: EMAIL, orgId: ORG_ID, ver: 0 },
        expect.objectContaining({ expiresIn: '24h' }),
      );
    });

    it('создаёт пользователя и возвращает токен', async () => {
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

      const result = await service.registerAsync({ email: EMAIL, password: PASSWORD });

      expect(result.accessToken).toBe(TOKEN);
      expect(result.user).toEqual({
        id: USER_ID,
        email: EMAIL,
        organizationId: ORG_ID,
        role: 'owner',
        createdAt: CREATED_AT,
      });
      expect(result.user).not.toHaveProperty('passwordHash');
    });

    it('сохраняет email нормализованным, а пароль — только хэшем (RULES 5.3)', async () => {
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

      await service.registerAsync({ email: '  User@Example.COM ', password: PASSWORD });

      const values = userInsertValues();

      expect(values.email).toBe('user@example.com');
      expect(values.passwordHash.startsWith('scrypt$')).toBe(true);
      expect(values.passwordHash).not.toContain(PASSWORD);
      // Имя личной организации строится от того же нормализованного email.
      expect(insertValues).toHaveBeenNthCalledWith(1, { name: ORG_NAME });
    });

    it('по приглашению создаёт пользователя в организации пригласившего с его ролью (KI-563)', async () => {
      // Первый SELECT — занятость email, второй — самое старое приглашение.
      selectLimit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([invitation('admin')]);
      insertReturning.mockResolvedValueOnce([
        { ...baseUser, role: 'admin', passwordHash: 'scrypt$x$y' },
      ]);

      const result = await service.registerAsync({ email: EMAIL, password: PASSWORD });

      // Пользователь создан сразу в организации пригласившего и с ролью
      // приглашения; личная организация не заводится (один INSERT).
      expect(insertValues).toHaveBeenCalledTimes(1);
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          email: EMAIL,
          organizationId: ORG_ID,
          role: 'admin',
        }),
      );
      expect(insertValues).not.toHaveBeenCalledWith({ name: ORG_NAME });

      // Приглашение «сжигается» в той же транзакции: удалена именно найденная
      // строка (по id), а не все приглашения на этот email.
      expect(deleteTable).toHaveBeenCalledWith(organizationInvitations);
      expect(deleteWhere).toHaveBeenCalledTimes(1);
      const deletedCondition = deleteWhere.mock.calls[0]?.[0] as SQL;
      expect(new PgDialect().sqlToQuery(deletedCondition).params).toContain(
        INVITATION_ID,
      );

      expect(result.accessToken).toBe(TOKEN);
      expect(signAsync).toHaveBeenCalledWith(
        { sub: USER_ID, email: EMAIL, orgId: ORG_ID, ver: 0 },
        expect.objectContaining({ expiresIn: '24h' }),
      );
      expect(result.user).toEqual({
        id: USER_ID,
        email: EMAIL,
        organizationId: ORG_ID,
        role: 'admin',
        createdAt: CREATED_AT,
      });
    });

    it('без приглашения по-прежнему заводит личную организацию и роль owner (регрессия)', async () => {
      // Приглашения на этот email нет — регистрация идёт прежним путём.
      selectLimit.mockResolvedValue([]);
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

      await service.registerAsync({ email: EMAIL, password: PASSWORD });

      expect(insertValues).toHaveBeenNthCalledWith(1, { name: ORG_NAME });
      expect(userInsertValues().organizationId).toBe(ORG_ID);
      expect(userInsertValues().role).toBe('owner');
      expect(deleteTable).not.toHaveBeenCalled();
    });

    it('REGISTRATION_MODE=open: регистрирует без приглашения (S6-C)', async () => {
      registrationMode = 'open';
      selectLimit.mockResolvedValue([]);
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

      const result = await service.registerAsync({
        email: EMAIL,
        password: PASSWORD,
      });

      expect(result.accessToken).toBe(TOKEN);
      expect(userInsertValues().role).toBe('owner');
    });

    it('REGISTRATION_MODE=invite: без приглашения — 403 (S6-C)', async () => {
      registrationMode = 'invite';
      // Занятости email нет, приглашения тоже нет.
      selectLimit.mockResolvedValue([]);

      await expect(
        service.registerAsync({ email: EMAIL, password: PASSWORD }),
      ).rejects.toThrow(ForbiddenException);

      // Отказ до хэширования/транзакции: никаких строк не создано.
      expect(transaction).not.toHaveBeenCalled();
      expect(insertReturning).not.toHaveBeenCalled();
    });

    it('REGISTRATION_MODE=invite: с приглашением — успех и «сжигание» (S6-C)', async () => {
      registrationMode = 'invite';
      selectLimit
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([invitation('member')]);
      insertReturning.mockResolvedValueOnce([
        { ...baseUser, role: 'member', passwordHash: 'scrypt$x$y' },
      ]);

      const result = await service.registerAsync({
        email: EMAIL,
        password: PASSWORD,
      });

      // В пути с приглашением INSERT только один — сразу в users.
      expect(insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          email: EMAIL,
          organizationId: ORG_ID,
          role: 'member',
        }),
      );
      expect(deleteTable).toHaveBeenCalledWith(organizationInvitations);
      expect(result.user.role).toBe('member');
    });

    it('бросает ConflictException на занятый email', async () => {
      selectLimit.mockResolvedValue([{ id: USER_ID }]);

      await expect(
        service.registerAsync({ email: EMAIL, password: PASSWORD }),
      ).rejects.toThrow(ConflictException);
      // Проверка занятости — до транзакции, INSERT'ов нет.
      expect(insertReturning).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it('нормализует email (нижний регистр, без пробелов)', async () => {
      mockRegisterInserts({ id: ORG_ID, name: ORG_NAME }, registeredUser());

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
      // v1.0.0 S5 (KI-555): login отдаёт организацию и роль из строки `users`.
      expect(result.user.organizationId).toBe(ORG_ID);
      expect(result.user.role).toBe('owner');
    });

    it('кладёт organizationId пользователя в orgId токена (v1.0 S1)', async () => {
      const passwordHash = await service.hashPasswordAsync(PASSWORD);
      selectLimit.mockResolvedValue([{ ...baseUser, passwordHash }]);

      await service.loginAsync({ email: EMAIL, password: PASSWORD });

      expect(signAsync).toHaveBeenCalledWith(
        { sub: USER_ID, email: EMAIL, orgId: ORG_ID, ver: 0 },
        expect.objectContaining({ expiresIn: '24h' }),
      );
    });

    it('кладёт tokenVersion в ver access-токена (v1.1.0 S5, KI-601)', async () => {
      const passwordHash = await service.hashPasswordAsync(PASSWORD);
      selectLimit.mockResolvedValue([
        { ...baseUser, passwordHash, tokenVersion: 7 },
      ]);

      await service.loginAsync({ email: EMAIL, password: PASSWORD });

      expect(signAsync).toHaveBeenCalledWith(
        { sub: USER_ID, email: EMAIL, orgId: ORG_ID, ver: 7 },
        expect.objectContaining({ expiresIn: '24h' }),
      );
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
        organizationId: ORG_ID,
        role: 'owner',
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

  describe('refresh-токены (R6.1b)', () => {
    it('createRefreshTokenAsync отдаёт токен, а в БД пишет только хэш', async () => {
      const result = await service.createRefreshTokenAsync(USER_ID);

      expect(result.token.length).toBeGreaterThan(20);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const [values] = insertValues.mock.calls[0] as [
        { userId: string; tokenHash: string },
      ];

      expect(values.userId).toBe(USER_ID);
      expect(values.tokenHash).toBe(
        createHash('sha256').update(result.token).digest('hex'),
      );
      expect(values.tokenHash).not.toBe(result.token);
    });

    it('verifyRefreshTokenAsync возвращает владельца для активного токена', async () => {
      selectLimit.mockResolvedValue([{ id: TOKEN_ID, userId: USER_ID }]);

      await expect(service.verifyRefreshTokenAsync('opaque')).resolves.toEqual({
        userId: USER_ID,
        tokenId: TOKEN_ID,
      });
    });

    it('verifyRefreshTokenAsync возвращает null для неизвестного/отозванного/истёкшего', async () => {
      selectLimit.mockResolvedValue([]);

      await expect(service.verifyRefreshTokenAsync('opaque')).resolves.toBeNull();
    });

    it('rotateRefreshTokenAsync отзывает старый и выдаёт access + новый refresh', async () => {
      // Первый SELECT — строка refresh_tokens, второй — пользователь в транзакции.
      selectLimit
        .mockResolvedValueOnce([{ id: TOKEN_ID, userId: USER_ID }])
        .mockResolvedValueOnce([{ ...baseUser, passwordHash: 'scrypt$x$y' }]);

      const result = await service.rotateRefreshTokenAsync('opaque-old');

      expect(result?.accessToken).toBe(TOKEN);
      expect(result?.user.email).toBe(EMAIL);
      expect(result?.newRefresh.token).not.toBe('opaque-old');
      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );

      const calls = insertValues.mock.calls;
      const [inserted] = calls[calls.length - 1] as [{ tokenHash: string }];

      expect(inserted.tokenHash).not.toBe(result?.newRefresh.token);
    });

    it('rotateRefreshTokenAsync кладёт organizationId в orgId нового токена (v1.0 S1)', async () => {
      selectLimit
        .mockResolvedValueOnce([{ id: TOKEN_ID, userId: USER_ID }])
        .mockResolvedValueOnce([{ ...baseUser, passwordHash: 'scrypt$x$y' }]);

      await service.rotateRefreshTokenAsync('opaque-old');

      expect(signAsync).toHaveBeenCalledWith(
        { sub: USER_ID, email: EMAIL, orgId: ORG_ID, ver: 0 },
        expect.objectContaining({ expiresIn: '24h' }),
      );
    });

    it('rotateRefreshTokenAsync возвращает null при гонке (токен уже отозван)', async () => {
      selectLimit.mockResolvedValue([
        {
          id: TOKEN_ID,
          userId: USER_ID,
          organizationId: ORG_ID,
          email: EMAIL,
          createdAt: CREATED_AT,
        },
      ]);
      updateReturning.mockResolvedValue([]);

      await expect(service.rotateRefreshTokenAsync('opaque-old')).resolves.toBeNull();
      expect(insertValues).not.toHaveBeenCalled();
    });

    it('rotateRefreshTokenAsync возвращает null для неизвестного токена', async () => {
      await expect(service.rotateRefreshTokenAsync('opaque-old')).resolves.toBeNull();
    });

    it('revokeRefreshTokenAsync помечает токен отозванным', async () => {
      await service.revokeRefreshTokenAsync('opaque');

      expect(updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });
});
