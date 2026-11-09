import {
  Body,
  Controller,
  Header,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  RegisterDeviceTokenSchema,
  type RegisterDeviceTokenDto,
} from './dto/register-device-token.dto.js';
import { DeviceTokensService } from './device-tokens.service.js';

/**
 * HTTP-контроллер push-уведомлений (v1.5.0 S3, DESIGN V150 § 3 S3).
 *
 * Префикс `notifications` зарегистрирован в `api-prefixes.json`, поэтому
 * SPA-fallback backend'а и Vite-proxy видят ручку без правок `app.module.ts`
 * (KI-472).
 *
 * Сейчас контроллер отдаёт одну ручку — `POST /notifications/register`:
 * native-клиент (Capacitor) после получения токена из RuStore Push SDK (S4-B)
 * присылает push-токен. Сама отправка — `DeviceTokensService.sendToUserAsync`
 * / `RuStorePushService` (S4-B); контроллер только сохраняет токен.
 *
 * **Организация — из БД, а не из токена (KI-554).** Контроллер передаёт сервису
 * только `user.sub`, а `organization_id` сервис читает из строки `users`.
 * `orgId` в access-токене живёт до 24 часов и после переезда пользователя в
 * другую организацию устарел бы — токен устройства нельзя привязывать к чужому
 * арендатору.
 */
@Controller('notifications')
export class NotificationsController {
  /**
   * @param deviceTokensService - UPSERT push-токенов (v1.5.0 S3)
   */
  constructor(private readonly deviceTokensService: DeviceTokensService) {}

  /**
   * `POST /notifications/register` — регистрация push-токена устройства.
   *
   * Тело валидируется `ZodValidationPipe` (`RegisterDeviceTokenSchema`):
   * пустой токен или платформа вне `android`/`ios`/`web` — 400 до обращения к
   * сервису. Повторная регистрация того же токена идемпотентна: строка
   * обновляет владельца, а не создаётся заново (`DeviceTokensService`).
   * Ответ — 201 (NestJS-дефолт для POST): клиенту сообщается только факт
   * регистрации, тело ресурса не нужно.
   *
   * `Cache-Control: no-store` — ответ авторизованный и содержит решение по
   * устройству пользователя; кэшировать его нельзя.
   *
   * @param user - payload access-токена (`sub` — id пользователя)
   * @param dto - валидированные `token` и `platform`
   * @returns `{ ok: true }` — токен зарегистрирован (создан или перепривязан)
   * @throws BadRequestException если тело не проходит `RegisterDeviceTokenSchema`
   * @throws UnauthorizedException если токен невалиден (guard) или строка
   *   `users` не найдена (сервис)
   */
  @Post('register')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  async register(
    @CurrentUser() user: JwtPayload,
    @Body(ZodValidationPipe.create(RegisterDeviceTokenSchema))
    dto: RegisterDeviceTokenDto,
  ): Promise<{ ok: true }> {
    const organizationId = await this.deviceTokensService.resolveOrganizationIdAsync(
      user.sub,
    );

    await this.deviceTokensService.upsertAsync(
      user.sub,
      organizationId,
      dto.token,
      dto.platform,
    );

    return { ok: true };
  }
}
