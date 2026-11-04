import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';
import {
  AuditQuerySchema,
  decodeAuditCursor,
  type AuditLogsResponse,
  type AuditQueryDto,
} from './dto/audit.dto.js';
import { OrgOwnerGuard } from './org-owner.guard.js';

/**
 * Административный HTTP-контроллер журнала аудита (v1.0.0 S3, DESIGN V100
 * § 3.2).
 *
 * Префикс маршрутов — `/admin/audit`; префикс `admin` зарегистрирован в
 * `api-prefixes.json`, поэтому SPA-исключения и Vite-proxy видят его так же,
 * как остальные API-маршруты (`src/common/api-prefixes.ts`).
 *
 * **Два guard'а, два разных отказа.** Сначала `JwtAuthGuard` проверяет
 * access-токен (401 без/с невалидным токеном), затем `OrgOwnerGuard` читает
 * роль пользователя в организации и пускает только `owner`/`admin`
 * (403 для `member`/`viewer`). Ролевая проверка — отдельный guard, а не
 * условие в контроллере: она переиспользуется другими административными
 * ручками S5 и не зависит от формата конкретного запроса.
 *
 * Валидация query выполняется `ZodValidationPipe`, ошибки отдаёт глобальный
 * `HttpExceptionFilter`, поэтому try/catch в контроллере нет (RULES 1.6, 4.7).
 */
@UseGuards(JwtAuthGuard, OrgOwnerGuard)
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * `GET /admin/audit?limit=20&cursor=…&action=…&userId=…&from=…&to=…` —
   * журнал действий организации.
   *
   * Keyset-пагинация: `cursor` — непрозрачный курсор последнего элемента
   * предыдущей страницы (`AuditLogSummary.cursor` / `nextCursor` ответа).
   * Порядок — `createdAt DESC, id DESC`.
   *
   * **Организация — из БД, а не из токена (KI-587).** Контроллер передаёт
   * сервису только `user.sub`: `organization_id` сервис читает из строки
   * `users`, поэтому устаревший (или подложенный) `orgId` в access-токене не
   * открывает журнал другой организации. Это же закрывает вектор KI-601:
   * удалённый участник со старым токеном видит журнал своей **новой** личной
   * организации, а не той, из которой его исключили.
   *
   * **Фильтры (v1.1.0 S3, KI-585).** `action` — точный код действия,
   * `userId` — автор, `from`/`to` — границы `created_at` включительно
   * (дата `YYYY-MM-DD` трактуется как UTC-сутки; UI отправляет ISO-моменты).
   * Значения нормализует `AuditQuerySchema`, сервис только строит `WHERE`.
   *
   * `Cache-Control: no-store` — данные авторизованные, персональные и меняются
   * на каждом мутирующем запросе; кэшировать их нельзя.
   *
   * @param query - размер страницы, курсор и фильтры
   * @param user - пользователь из access-токена (`sub`; `orgId` не используется)
   * @returns записи страницы, курсор следующей страницы и общее число записей
   * @throws BadRequestException если query не проходит Zod-схему
   *   (мусорный курсор/дата/`action` — 400, а не 500 из сервиса)
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query(ZodValidationPipe.create(AuditQuerySchema)) query: AuditQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AuditLogsResponse> {
    // Zod-схема уже проверила декодируемость курсора; декодер — чистый и
    // синхронный (RULES 1.4: это не I/O).
    const cursor =
      query.cursor === undefined ? undefined : decodeAuditCursor(query.cursor);

    return this.auditService.listAsync(user.sub, query.limit, cursor, {
      action: query.action,
      userId: query.userId,
      from: query.from,
      to: query.to,
    });
  }
}
