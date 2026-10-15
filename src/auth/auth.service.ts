import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { parseDurationToMs } from '../common/utils/parse-duration.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { refreshTokens, users, type User } from '../db/schema.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { JwtPayload } from './interfaces/jwt-payload.js';

/**
 * `scrypt` из `node:crypto` в промис-виде.
 *
 * `promisify` теряет перегрузки, поэтому тип задан явно — без `any`
 * (RULES 4.15).
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Длина соли в байтах. */
const SALT_BYTES = 16;
/** Длина производного ключа в байтах. */
const KEY_LENGTH = 64;
/** Метка схемы хранения пароля. */
const HASH_SCHEME = 'scrypt';
/** Длина opaque refresh-токена в байтах (R6.1b). */
const REFRESH_TOKEN_BYTES = 32;

/**
 * Считает sha256-хэш refresh-токена.
 *
 * В БД хранится только хэш: сам токен знает лишь клиент, поэтому дамп
 * `refresh_tokens` не позволяет войти (RULES 5.1/5.9).
 *
 * @param token - opaque refresh-токен
 * @returns hex-строка хэша
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
/** Единое сообщение для неудачного входа: не подсказываем, что именно неверно. */
const INVALID_CREDENTIALS_MESSAGE = 'Неверный email или пароль';

/** Публичное представление пользователя (без хэша пароля). */
export interface UserPublic {
  /** id пользователя (uuid). */
  id: string;
  /** Email пользователя. */
  email: string;
  /** Дата регистрации. */
  createdAt: Date;
}

/** Результат регистрации/входа. */
export interface AuthResult {
  /** Access-токен (JWT, срок жизни — `JWT_EXPIRES_IN`). */
  accessToken: string;
  /** Публичные данные пользователя. */
  user: UserPublic;
}

/**
 * Приводит строку пользователя к публичному виду.
 *
 * @param user - строка `users` из БД
 * @returns данные без `passwordHash`
 */
function toPublic(user: User): UserPublic {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

/**
 * Аутентификация и выдача access-токена (R6.1a, KI-106).
 *
 * Пароли хранятся как `scrypt$<salt_b64>$<hash_b64>` (node:crypto, без
 * внешних зависимостей). Хэш и пароль никогда не логируются (RULES 5.3).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Хэширует пароль со свежей солью.
   *
   * @param password - пароль в открытом виде
   * @returns строка `scrypt$<salt_b64>$<hash_b64>`
   */
  async hashPasswordAsync(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const hash = await scryptAsync(password, salt, KEY_LENGTH);

    return `${HASH_SCHEME}$${salt.toString('base64')}$${hash.toString('base64')}`;
  }

  /**
   * Проверяет пароль по сохранённому хэшу.
   *
   * Неизвестная/битая схема — `false` (системный пользователь миграции хранит
   * `scrypt$disabled$disabled`, то есть заведомо не аутентифицируется).
   *
   * @param password - пароль в открытом виде
   * @param stored - значение `users.password_hash`
   * @returns `true`, если пароль совпал
   */
  async verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
    const [scheme, saltB64, hashB64] = stored.split('$');

    if (scheme !== HASH_SCHEME || !saltB64 || !hashB64) {
      return false;
    }

    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scryptAsync(
      password,
      Buffer.from(saltB64, 'base64'),
      expected.length,
    );

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /**
   * Регистрирует пользователя и сразу выдаёт токен.
   *
   * @param dto - валидированные email/пароль
   * @returns токен и публичные данные пользователя
   * @throws ConflictException если email уже занят
   */
  async registerAsync(dto: RegisterDto): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      throw new ConflictException('Email уже зарегистрирован');
    }

    const passwordHash = await this.hashPasswordAsync(dto.password);
    const [created] = await this.db
      .insert(users)
      .values({ email, passwordHash })
      .returning();

    return {
      accessToken: await this.generateAccessTokenAsync(created),
      user: toPublic(created),
    };
  }

  /**
   * Проверяет учётные данные и выдаёт токен.
   *
   * @param dto - валидированные email/пароль
   * @returns токен и публичные данные пользователя
   * @throws UnauthorizedException если пользователя нет или пароль неверен
   */
  async loginAsync(dto: LoginDto): Promise<AuthResult> {
    const email = this.normalizeEmail(dto.email);
    const [found] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!found) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const valid = await this.verifyPasswordAsync(dto.password, found.passwordHash);

    if (!valid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return {
      accessToken: await this.generateAccessTokenAsync(found),
      user: toPublic(found),
    };
  }

  /**
   * Возвращает публичные данные пользователя по id из токена.
   *
   * @param userId - `sub` access-токена
   * @returns публичные данные пользователя
   * @throws UnauthorizedException если пользователь удалён
   */
  async getMeAsync(userId: string): Promise<UserPublic> {
    const [found] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!found) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return toPublic(found);
  }

  /**
   * Подписывает access-токен.
   *
   * `expiresIn` читается типом из `JwtSignOptions`: `ms` принимает только
   * шаблонные литералы (`'24h'`), а строка из окружения — обычный `string`,
   * поэтому тип берём от самого параметра, без приведения (RULES 4.15).
   *
   * @param user - строка `users`
   * @returns подписанный JWT
   */
  async generateAccessTokenAsync(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email };

    return this.jwt.signAsync(payload, {
      expiresIn: this.config.getOrThrow<JwtSignOptions['expiresIn']>('JWT_EXPIRES_IN'),
    });
  }

  /**
   * Приводит email к каноничному виду: без пробелов, в нижнем регистре.
   *
   * @param email - email из запроса
   * @returns нормализованный email
   */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Создаёт opaque refresh-токен и сохраняет его хэш.
   *
   * @param userId - id пользователя (uuid)
   * @returns токен для cookie и момент истечения
   */
  async createRefreshTokenAsync(
    userId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    await this.db
      .insert(refreshTokens)
      .values({ userId, tokenHash: hashToken(token), expiresAt });

    return { token, expiresAt };
  }

  /**
   * Ищет активный refresh-токен по хэшу.
   *
   * @param token - opaque refresh-токен из cookie
   * @returns владелец и id строки либо `null` (нет, отозван, истёк)
   */
  async verifyRefreshTokenAsync(
    token: string,
  ): Promise<{ userId: string; tokenId: string } | null> {
    const [found] = await this.db
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, hashToken(token)),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    return found === undefined
      ? null
      : { userId: found.userId, tokenId: found.id };
  }

  /**
   * Ротирует refresh-токен: старый отзывается, выдаётся новый access + refresh.
   *
   * Всё в одной транзакции (RULES 4.22): отзыв старого и вставка нового
   * неделимы, иначе сбой между ними оставил бы пользователя без сессии.
   * Отзыв идёт с условием `revoked_at IS NULL`: если строку уже отозвал
   * параллельный запрос, ротация не состоится — это защита от гонки и от
   * повторного использования перехваченного токена.
   *
   * @param oldToken - текущий refresh-токен из cookie
   * @returns новая пара токенов и пользователь либо `null`, если токен неактивен
   */
  async rotateRefreshTokenAsync(oldToken: string): Promise<{
    accessToken: string;
    user: UserPublic;
    newRefresh: { token: string; expiresAt: Date };
  } | null> {
    const verified = await this.verifyRefreshTokenAsync(oldToken);

    if (verified === null) {
      return null;
    }

    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    const user = await this.db.transaction(async (tx) => {
      const revoked = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.id, verified.tokenId),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning({ id: refreshTokens.id });

      if (revoked.length === 0) {
        return null;
      }

      await tx.insert(refreshTokens).values({
        userId: verified.userId,
        tokenHash: hashToken(token),
        expiresAt,
      });

      const [found] = await tx
        .select()
        .from(users)
        .where(eq(users.id, verified.userId))
        .limit(1);

      return found ?? null;
    });

    if (user === null) {
      return null;
    }

    return {
      accessToken: await this.generateAccessTokenAsync(user),
      user: toPublic(user),
      newRefresh: { token, expiresAt },
    };
  }

  /**
   * Отзывает refresh-токен (logout). Идемпотентно: повторный вызов — no-op.
   *
   * @param token - opaque refresh-токен из cookie
   * @returns промис без значения
   */
  async revokeRefreshTokenAsync(token: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, hashToken(token)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  /**
   * Срок жизни refresh-токена в миллисекундах.
   *
   * @returns TTL из `JWT_REFRESH_EXPIRES_IN`
   */
  private refreshTtlMs(): number {
    return parseDurationToMs(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );
  }
}
