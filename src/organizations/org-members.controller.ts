import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  MemberParamSchema,
  type InviteMemberDto,
  type InviteMemberResponse,
  type MemberParamDto,
  type OrganizationMemberSummary,
  type OrganizationMembersResponse,
  UpdateMemberRoleSchema,
  type UpdateMemberRoleDto,
} from './dto/member.dto.js';
import { OrgMembersService } from './org-members.service.js';
import { OrgOwnerOnlyGuard } from './org-owner-only.guard.js';

/**
 * HTTP-контроллер команды организации (v1.0.0 S5; управление составом — v1.1.0 S2).
 *
 * Префикс маршрутов — `/admin/members`; префикс `admin` уже зарегистрирован в
 * `api-prefixes.json`, поэтому SPA-исключения и Vite-proxy видят новые ручки без
 * правок реестра.
 *
 * **Три политики доступа.**
 * - `GET` — только `JwtAuthGuard`: состав команды нужен любому участнику
 *   (`member`/`viewer` тоже должны видеть, с кем работают).
 * - `POST invite` — `OrgOwnerGuard` (`owner`/`admin`): приглашение в S5 разрешено
 *   администратору.
 * - `PATCH`/`DELETE` — `OrgOwnerOnlyGuard` (только `owner`): смена роли и
 *   удаление участника в v1.1.0 S2 — прерогатива владельца (DESIGN V110 § 3.2).
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
   * 400 до обращения к сервису. Ответ — 201 с выписанным приглашением. С
   * v1.2.0 S2 письмо ставится в очередь `email-invitations` и отправляется
   * воркером асинхронно, поэтому `emailSent` в ответе всегда `false`
   * (201 означает «приглашение создано», а не «письмо доставлено»), а признак
   * успешной постановки задания несёт `emailQueued` (KI-622).
   *
   * @param user - payload access-токена (кто приглашает)
   * @param dto - валидированные `email` и `role` (`admin`/`member`/`viewer`)
   * @returns выписанное приглашение (письмо — в очереди)
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

  /**
   * `PATCH /admin/members/:userId` — смена роли участника (v1.1.0 S2, KI-586).
   *
   * Доступ — только владелец организации (`OrgOwnerOnlyGuard`). Тело
   * валидируется `UpdateMemberRoleSchema`: `role` — из `admin`/`member`/`viewer`,
   * `owner` назначать нельзя (400). Собственную роль владелец менять не может
   * (400), участник чужой организации неотличим от несуществующего (404).
   *
   * @param user - payload access-токена (владелец организации)
   * @param params - `userId` из пути (валидированный uuid)
   * @param dto - новая роль участника
   * @returns обновлённый участник организации
   * @throws BadRequestException если тело/путь не проходят схемы, цель — сам
   *   актор или роль `owner`
   * @throws ForbiddenException если роль актора не `owner`
   * @throws NotFoundException если участника нет в организации актора
   */
  @Patch(':userId')
  @UseGuards(JwtAuthGuard, OrgOwnerOnlyGuard)
  async updateRole(
    @CurrentUser() user: JwtPayload,
    @Param(ZodValidationPipe.create(MemberParamSchema)) params: MemberParamDto,
    @Body(ZodValidationPipe.create(UpdateMemberRoleSchema))
    dto: UpdateMemberRoleDto,
  ): Promise<OrganizationMemberSummary> {
    return this.orgMembersService.updateRoleAsync(
      user.sub,
      params.userId,
      dto,
    );
  }

  /**
   * `DELETE /admin/members/:userId` — исключение участника из организации
   * (v1.1.0 S2, KI-586).
   *
   * Доступ — только владелец организации. Это **выход из организации**, а не
   * удаление учётной записи: участник переезжает в новую личную организацию,
   * его графы в этой организации переходят владельцу, refresh-токены
   * отзываются (подробности — `OrgMembersService.removeMemberAsync`).
   * Себя и владельца удалить нельзя (400), участника чужой организации нет
   * (404).
   *
   * @param user - payload access-токена (владелец организации)
   * @param params - `userId` из пути (валидированный uuid)
   * @returns пустой ответ 204
   * @throws BadRequestException если `userId` — не uuid, цель — сам актор или
   *   владелец организации
   * @throws ForbiddenException если роль актора не `owner`
   * @throws NotFoundException если участника нет в организации актора
   */
  @Delete(':userId')
  @UseGuards(JwtAuthGuard, OrgOwnerOnlyGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param(ZodValidationPipe.create(MemberParamSchema)) params: MemberParamDto,
  ): Promise<void> {
    await this.orgMembersService.removeMemberAsync(user.sub, params.userId);
  }
}
