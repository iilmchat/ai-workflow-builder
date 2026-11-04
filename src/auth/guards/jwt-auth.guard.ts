import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { DEMO_ORG_ID, DEMO_USER_EMAIL, DEMO_USER_ID } from '../auth.constants.js';
import { DRIZZLE, type Database } from '../../db/db.module.js';
import { users } from '../../db/schema.js';
import type { JwtPayload } from '../interfaces/jwt-payload.js';

/** Минимальный контракт запроса, нужный guard'у (без `any`, RULES 4.15). */
interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Заполняется guard'ом; читается `@CurrentUser()`. */
  user?: JwtPayload;
}

/** Сообщение для legacy-токенов, выпущенных до появления `orgId` (DESIGN § 4). */
const STALE_TOKEN_MESSAGE = 'Токен устарел, войдите заново: в нём нет организации';

/**
 * Сообщение для отозванного/устаревшего токена (v1.1.0 S5, KI-601).
 *
 * Не раскрываем, что именно не совпало (версия или организация): клиенту
 * достаточно знать, что сессия недействительна и нужен повторный вход.
 */
const REVOKED_TOKEN_MESSAGE =
  'Сессия недействительна, войдите заново: токен отозван или устарел';

/**
 * Проверяет access-токен, сверяет его с БД и кладёт payload в `request.user`.
 *
 * Свой guard вместо `passport-jwt`: MVP R6.1a обходится `@nestjs/jwt`, а
 * `passport` тянет лишний слой стратегий.
 *
 * **Сверка с БД (v1.1.0 S5, KI-601).** После проверки подписи guard читает
 * `users.organization_id` и `users.token_version` по `sub`:
 * - нет строки `users` (пользователь удалён) — 401;
 * - `organization_id` не совпадает с `orgId` из токена (участник переехал в
 *   другую организацию после удаления) — 401;
 * - `token_version` не совпадает с `ver` из токена (сессии отозваны) — 401.
 *
 * Если всё совпало, в `request.user` кладётся payload с **актуальным**
 * `orgId`/`ver` из БД: все последующие write-пути (`toWorkflowAccess`,
 * `AuditInterceptor`) видят организацию из БД, а не из токена. Токены,
 * выпущенные до S5, не содержат `ver`; они считаются версией 0 (DEFAULT
 * колонки), но устаревший `orgId` всё равно отклонится.
 *
 * При `AUTH_DISABLED=true` (dev/CI, R6.1a) запросы выполняются от системного
 * пользователя из миграции — это позволяет не трогать фронтенд до R6.1b.
 * Проверка БД в этом режиме пропускается: системный пользователь фиксирован.
 *
 * Токены, выпущенные до v1.0.0, не содержат `orgId` — они отклоняются:
 * DESIGN § 4 объявляет смену payload и инвалидацию старых JWT.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /**
   * Пропускает запрос при валидном токене (или при отключённом auth).
   *
   * @param context - контекст выполнения Nest
   * @returns `true`, если запрос можно обрабатывать
   * @throws UnauthorizedException если токена нет, он невалиден, не содержит
   *   `orgId`, пользователь удалён или токен отозван
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();

    if (this.config.get<boolean>('AUTH_DISABLED') === true) {
      // KI-106: системный пользователь — uuid из миграции, а не строка
      // 'demo-user' (иначе не сработал бы фильтр по workflows.user_id).
      request.user = {
        sub: DEMO_USER_ID,
        email: DEMO_USER_EMAIL,
        orgId: DEMO_ORG_ID,
        ver: 0,
      };

      return true;
    }

    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;

    if (!value?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Нет токена');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(value.slice(7));
    } catch {
      throw new UnauthorizedException('Невалидный токен');
    }

    // Legacy JWT (до v1.0.0) подписан без `orgId`: пускаем только токены,
    // в которых арендатор присутствует непустой строкой (DESIGN § 3.1/§ 4).
    if (typeof payload.orgId !== 'string' || payload.orgId.length === 0) {
      throw new UnauthorizedException(STALE_TOKEN_MESSAGE);
    }

    // S5 (KI-601): сверяем токен с текущей строкой `users`. Это единственный
    // SELECT аутентификации; его результат — актуальные orgId/ver, которые
    // дальше используют все guard'ы и write-пути.
    const [current] = await this.db
      .select({
        organizationId: users.organizationId,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (current === undefined) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    // Токены до S5 не содержат `ver` — считаем их версией 0 (DEFAULT колонки);
    // после первого увеличения версии они перестанут проходить.
    const tokenVersion = typeof payload.ver === 'number' ? payload.ver : 0;

    if (
      tokenVersion !== current.tokenVersion ||
      payload.orgId !== current.organizationId
    ) {
      throw new UnauthorizedException(REVOKED_TOKEN_MESSAGE);
    }

    request.user = {
      ...payload,
      orgId: current.organizationId,
      ver: current.tokenVersion,
    };

    return true;
  }
}
