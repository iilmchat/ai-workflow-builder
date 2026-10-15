import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AuthService, type AuthResult, type UserPublic } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { LoginSchema, type LoginDto } from './dto/login.dto.js';
import { RegisterSchema, type RegisterDto } from './dto/register.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import type { JwtPayload } from './interfaces/jwt-payload.js';

/**
 * HTTP-контроллер аутентификации.
 *
 * Префикс маршрутов — `/auth`. Валидация body — ZodValidationPipe, ошибки
 * отдаёт глобальный HttpExceptionFilter (RULES 1.6, 4.7).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * `POST /auth/register` — регистрация и выдача access-токена.
   *
   * @param dto - тело запроса, валидированное по RegisterSchema
   * @returns токен и публичные данные пользователя со статусом 201
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(ZodValidationPipe.create(RegisterSchema)) dto: RegisterDto,
  ): Promise<AuthResult> {
    return this.authService.registerAsync(dto);
  }

  /**
   * `POST /auth/login` — вход по email/паролю.
   *
   * @param dto - тело запроса, валидированное по LoginSchema
   * @returns токен и публичные данные пользователя со статусом 200
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(ZodValidationPipe.create(LoginSchema)) dto: LoginDto,
  ): Promise<AuthResult> {
    return this.authService.loginAsync(dto);
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
}
