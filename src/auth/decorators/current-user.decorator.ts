import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../interfaces/jwt-payload.js';

/** Минимальный контракт запроса: `user` кладёт {@link JwtAuthGuard}. */
interface AuthRequest {
  user?: JwtPayload;
}

/**
 * Достаёт payload текущего пользователя из запроса.
 *
 * Используется только вместе с `@UseGuards(JwtAuthGuard)` — иначе `user`
 * не заполнен и вернётся `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload | undefined =>
    context.switchToHttp().getRequest<AuthRequest>().user,
);
