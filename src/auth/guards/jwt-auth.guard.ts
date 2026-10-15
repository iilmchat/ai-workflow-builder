import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from '../auth.constants.js';
import type { JwtPayload } from '../interfaces/jwt-payload.js';

/** Минимальный контракт запроса, нужный guard'у (без `any`, RULES 4.15). */
interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Заполняется guard'ом; читается `@CurrentUser()`. */
  user?: JwtPayload;
}

/**
 * Проверяет access-токен и кладёт payload в `request.user`.
 *
 * Свой guard вместо `passport-jwt`: MVP R6.1a обходится `@nestjs/jwt`, а
 * `passport` тянет лишний слой стратегий.
 *
 * При `AUTH_DISABLED=true` (dev/CI, R6.1a) запросы выполняются от системного
 * пользователя из миграции — это позволяет не трогать фронтенд до R6.1b.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Пропускает запрос при валидном токене (или при отключённом auth).
   *
   * @param context - контекст выполнения Nest
   * @returns `true`, если запрос можно обрабатывать
   * @throws UnauthorizedException если токена нет или он невалиден
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();

    if (this.config.get<boolean>('AUTH_DISABLED') === true) {
      // KI-106: системный пользователь — uuid из миграции, а не строка
      // 'demo-user' (иначе не сработал бы фильтр по workflows.user_id).
      request.user = { sub: DEMO_USER_ID, email: DEMO_USER_EMAIL };

      return true;
    }

    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Нет токена');
    }

    try {
      request.user = await this.jwt.verifyAsync<JwtPayload>(value.slice(7));

      return true;
    } catch {
      throw new UnauthorizedException('Невалидный токен');
    }
  }
}
