import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { users, type User } from '../db/schema.js';
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
}
