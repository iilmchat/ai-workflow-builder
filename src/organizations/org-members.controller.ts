import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.js';
import { OrgOwnerGuard } from '../audit/org-owner.guard.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  InviteMemberSchema,
  type InviteMemberDto,
  type InviteMemberResponse,
  type OrganizationMembersResponse,
} from './dto/member.dto.js';
import { OrgMembersService } from './org-members.service.js';

/**
 * HTTP-контроллер команды организации (v1.0.0 S5).
 *
 * Префикс маршрутов — `/admin/members`; префикс `admin` уже зарегистрирован в
 * `api-prefixes.json`, поэтому SPA-исключения и Vite-proxy видят новые ручки без
 * правок реестра.
 *
 * **Две разные политики доступа.** Список команды нужен каждому участнику
 * (роли `member`/`viewer` тоже должны видеть, с кем работают), поэтому на
 * `GET` стоит только `JwtAuthGuard`. Приглашение меняет состав организации —
 * на `POST` добавляется `OrgOwnerGuard` (`owner`/`admin`, 403 остальным).
 *
 * **Организация — из БД, а не из токена (KI-554).** Контроллер передаёт сервису
 * только `user.sub`; `organizationId` и роль сервис/guard читают из строки
 * `users`. Устаревший `orgId` в access-токене не может увести операцию в чужую
 * организацию.
 */
@Controller('admin/members')
export class OrgMembersController {
  constructor(private readonly orgMembersService: OrgMembersService) {}

  /**
   * `GET /admin/members` — участники организации и ожидающие приглашения.
   *
   * `Cache-Control: no-store` — данные авторизованные, персональные (email
   * коллег) и меняются при каждом приглашении/регистрации; кэшировать их нельзя.
   *
   * @param user - payload access-токена (`sub` — id пользователя)
   * @returns участники и приглашения организации пользователя
   * @throws UnauthorizedException если пользователь удалён (проверка в сервисе)
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  async list(@CurrentUser() user: JwtPayload): Promise<OrganizationMembersResponse> {
    return this.orgMembersService.listAsync(user.sub);
  }

  /**
   * `POST /admin/members/invite` — приглашение в организацию по email.
   *
   * Тело валидируется `ZodValidationPipe`: мусорный email или роль `owner` —
   * 400 до обращения к сервису. Ответ — 201 с выписанным приглашением и
   * признаком `emailSent` (v1.1.0 S1): письмо отправляется best-effort, и 201
   * не означает, что письмо доставлено (fallback при ненастроенном SMTP).
   *
   * @param user - payload access-токена (кто приглашает)
   * @param dto - валидированные `email` и `role` (`admin`/`member`/`viewer`)
   * @returns выписанное приглашение и признак отправки письма
   * @throws BadRequestException если тело не проходит `InviteMemberSchema`
   * @throws ForbiddenException если роль приглашающего не `owner`/`admin`
   * @throws ConflictException если email занят или приглашение уже выписано
   */
  @Post('invite')
  @UseGuards(JwtAuthGuard, OrgOwnerGuard)
  @HttpCode(HttpStatus.CREATED)
  async invite(
    @CurrentUser() user: JwtPayload,
    @Body(ZodValidationPipe.create(InviteMemberSchema)) dto: InviteMemberDto,
  ): Promise<InviteMemberResponse> {
    return this.orgMembersService.inviteAsync(user.sub, dto);
  }
}
