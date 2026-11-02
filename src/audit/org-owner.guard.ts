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
import { users, type UserRole } from '../db/schema.js';

/**
 * Роли, которым разрешён журнал аудита (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * `owner` — создатель личной организации; `admin` зарезервирован под S5
 * (управление командой), но доступ к аудиту получает уже сейчас. `member` и
 * `viewer` не должны видеть действия других пользователей организации.
 */
const AUDIT_ALLOWED_ROLES: readonly UserRole[] = ['owner', 'admin'];

/** Минимальный контракт запроса, нужный guard'у (без `any`, RULES 4.15). */
interface OrgOwnerRequest {
  /** Заполняется `JwtAuthGuard`; читается `@CurrentUser()`. */
  user?: JwtPayload;
}

/**
 * Пускает в журнал аудита только владельца или администратора организации
 * (v1.0.0 S3).
 *
 * Роль не лежит в access-токене: она читается из `users` по `sub` при каждом
 * запросе. Это осознанно — понижение роли в БД (S5) должно отзывать доступ
 * немедленно, а не после истечения 24-часового токена. Проверка идёт по
 * глобальному `users.id`, а не по организации из токена: чужая организация
 * в `request.user.orgId` не даёт прав, потому что роль берётся из строки
 * самого пользователя.
 */
@Injectable()
export class OrgOwnerGuard implements CanActivate {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Проверяет роль аутентифицированного пользователя в `users`.
   *
   * @param context - контекст выполнения Nest
   * @returns `true`, если роль пользователя `owner` или `admin`
   * @throws UnauthorizedException если `request.user` нет или строка `users` не найдена
   * @throws ForbiddenException если роль пользователя не даёт доступа к аудиту
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OrgOwnerRequest>();
    const user = request.user;

    // Guard стоит после `JwtAuthGuard`, но без аутентификации его можно
    // навесить и ошибочно — вместо `TypeError` отдаём честный 401.
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

    if (!AUDIT_ALLOWED_ROLES.includes(found.role)) {
      throw new ForbiddenException('Недостаточно прав: требуется владелец организации');
    }

    return true;
  }
}
