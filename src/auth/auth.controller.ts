import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LOGIN_THROTTLE } from '../common/http-throttle.constants.js';
import { parseDurationToMs } from '../common/utils/parse-duration.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './auth.cookie.js';
import { AuthService, type AuthResult, type UserPublic } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginSchema, type LoginDto } from './dto/login.dto.js';
import { RegisterSchema, type RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { JwtPayload } from './interfaces/jwt-payload.js';

/**
 * HTTP-контроллер аутентификации.
 *
 * Префикс маршрутов — `/auth`. Access-токен возвращается в теле, refresh —
 * только httpOnly-cookie (`path=/auth`), поэтому в ответах его нет
 * (RULES 5.9): токены и пароли не логируются и не уходят в JSON.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `POST /auth/register` — регистрация, access в теле, refresh в cookie.
   *
   * @param dto - тело запроса, валидированное по RegisterSchema
   * @param response - ответ Express (для `Set-Cookie`)
   * @returns токен доступа и публичные данные пользователя (201)
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(ZodValidationPipe.create(RegisterSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const result = await this.authService.registerAsync(dto);

    await this.issueRefreshCookieAsync(response, result.user.id);

    return result;
  }

  /**
   * `POST /auth/login` — вход, access в теле, refresh в cookie.
   *
   * @param dto - тело запроса, валидированное по LoginSchema
   * @param response - ответ Express (для `Set-Cookie`)
   * @returns токен доступа и публичные данные пользователя (200)
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // KI-206: 5 попыток в минуту с одного IP — защита от брутфорса. Считаются и
  // успешные, и неуспешные попытки, поэтому перебор упирается в 429.
  @Throttle({ default: LOGIN_THROTTLE })
  async login(
    @Body(ZodValidationPipe.create(LoginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const result = await this.authService.loginAsync(dto);

    await this.issueRefreshCookieAsync(response, result.user.id);

    return result;
  }

  /**
   * `POST /auth/refresh` — ротация refresh-токена.
   *
   * Старый токен отзывается, в cookie уезжает новый (R6.1b). Повторное
   * использование старого (в том числе перехваченного) даёт 401.
   *
   * @param request - запрос Express (cookie `refresh_token`)
   * @param response - ответ Express (для нового `Set-Cookie`)
   * @returns новый access-токен и пользователь (200)
   * @throws UnauthorizedException если cookie нет или токен неактивен
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const token = readRefreshCookie(request.cookies);

    if (token === undefined) {
      throw new UnauthorizedException('Нет refresh-токена');
    }

    const rotated = await this.authService.rotateRefreshTokenAsync(token);

    if (rotated === null) {
      throw new UnauthorizedException('Невалидный refresh-токен');
    }

    setRefreshCookie(
      response,
      rotated.newRefresh.token,
      this.refreshTtlMs(),
      this.isSecureCookie(),
    );

    return { accessToken: rotated.accessToken, user: rotated.user };
  }

  /**
   * `POST /auth/logout` — отзыв refresh-токена и очистка cookie.
   *
   * Отзыв «по возможности»: недоступная БД не должна мешать выходу —
   * cookie всё равно очищается, а ошибка пишется в лог без токена (RULES 5.9).
   *
   * @param request - запрос Express (cookie `refresh_token`)
   * @param response - ответ Express (для очистки cookie)
   * @returns пустой ответ 204
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const token = readRefreshCookie(request.cookies);

    if (token !== undefined) {
      try {
        await this.authService.revokeRefreshTokenAsync(token);
      } catch (error: unknown) {
        this.logger.warn(
          `Не удалось отозвать refresh-токен: ${
            error instanceof Error ? error.message : 'неизвестная ошибка'
          }`,
        );
      }
    }

    clearRefreshCookie(response);
  }

  /**
   * `GET /auth/me` — текущий пользователь по access-токену.
   *
   * @param user - payload токена (или системный пользователь при
   *   `AUTH_DISABLED=true`)
   * @returns публичные данные пользователя
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtPayload): Promise<UserPublic> {
    return this.authService.getMeAsync(user.sub);
  }

  /**
   * Создаёт refresh-токен и ставит его в cookie ответа.
   *
   * @param response - ответ Express
   * @param userId - владелец токена
   * @returns промис без значения
   */
  private async issueRefreshCookieAsync(
    response: Response,
    userId: string,
  ): Promise<void> {
    const refresh = await this.authService.createRefreshTokenAsync(userId);

    setRefreshCookie(
      response,
      refresh.token,
      this.refreshTtlMs(),
      this.isSecureCookie(),
    );
  }

  /**
   * Признак `Secure` для cookie: явный `COOKIE_SECURE`, иначе прод-дефолт.
   *
   * @returns `true`, если cookie должна ходить только по https
   */
  private isSecureCookie(): boolean {
    const explicit = this.config.get<boolean>('COOKIE_SECURE');

    return explicit ?? this.config.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Срок жизни refresh-cookie в миллисекундах.
   *
   * @returns TTL из `JWT_REFRESH_EXPIRES_IN`
   */
  private refreshTtlMs(): number {
    return parseDurationToMs(
      this.config.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN'),
    );
  }
}
