import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { users } from '../db/schema.js';

/** Минимальный контракт запроса, нужный guard'у (без `any`, RULES 4.15). */
interface OwnerOnlyRequest {
  /** Заполняется `JwtAuthGuard`; читается `@CurrentUser()`. */
  user?: JwtPayload;
}

/**
 * Пускает к управлению командой только владельца организации (v1.1.0 S2).
 *
 * Отличается от {@link OrgOwnerGuard} (S3: `owner` **или** `admin`, журнал
 * аудита): смена роли и удаление участника в S2 — исключительно прерогатива
 * владельца (DESIGN V110 § 3.2, постановка S2). `admin`, которого владелец
 * назначил через приглашение, управлять составом не может — это осознанное
 * ограничение среза (KI-603).
 *
 * Роль читается из `users` по `sub` при каждом запросе, а не из access-токена:
 * понижение роли/переезд в другую организацию должны отзывать доступ
 * немедленно, а токен живёт 24 часа (KI-554). Организация для операций тоже
 * резолвится из БД (`OrgMembersService`), поэтому guard'у достаточно роли.
 *
 * Guard ставится **после** `JwtAuthGuard`: без аутентификации он отвечает 401,
 * а не падает с `TypeError`.
 */
@Injectable()
export class OrgOwnerOnlyGuard implements CanActivate {
  /**
   * @param db - соединение Drizzle (инъекция по токену {@link DRIZZLE})
   */
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Проверяет, что пользователь из запроса — владелец организации.
   *
   * @param context - контекст выполнения Nest
   * @returns `true`, если роль пользователя в БД — `owner`
   * @throws UnauthorizedException если `request.user` нет или строка `users`
   *   не найдена
   * @throws ForbiddenException если роль пользователя не `owner`
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerOnlyRequest>();
    const user = request.user;

    if (user === undefined) {
      throw new UnauthorizedException('Пользователь не аутентифицирован');
    }

    const [found] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, user.sub))
      .limit(1);

    if (found === undefined) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    if (found.role !== 'owner') {
      throw new ForbiddenException(
        'Недостаточно прав: управлять командой может только владелец организации',
      );
    }

    return true;
  }
}
