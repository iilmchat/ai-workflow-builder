import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { organizationInvitations, organizations, users } from '../db/schema.js';
import { EmailService } from '../email/email.service.js';
import type {
  InviteMemberDto,
  InviteMemberResponse,
  OrganizationMembersResponse,
} from './dto/member.dto.js';

/** Сообщение 409 для email, занятого действующим пользователем. */
const EMAIL_TAKEN_MESSAGE =
  'Пользователь с этим email уже зарегистрирован: перенос между организациями не поддерживается';

/** Сообщение 409 для уже выписанного приглашения. */
const INVITATION_EXISTS_MESSAGE = 'Приглашение для этого email уже отправлено';

/**
 * Сервис команды организации (v1.0.0 S5, KI-555/KI-563).
 *
 * Отдельной таблицы членства в продукте нет: организация — это `users` с общим
 * `organization_id`, роль — `users.role`. Поэтому список команды читается прямо
 * из `users`, а ожидающие приглашения — из `organization_invitations`.
 *
 * **Организация всегда резолвится из БД (KI-554).** На вход сервис получает
 * только `userId` (из `sub` access-токена), а `organization_id` и роль читает из
 * строки `users`. Токен живёт 24 часа, и после переезда пользователя в другую
 * организацию `orgId` в нём устарел бы: список/инвайт из чужого арендатора
 * недопустим. Роль приглашающего проверяет `OrgOwnerGuard` — тоже по БД.
 */
@Injectable()
export class OrgMembersService {
  /**
   * @param db - соединение Drizzle (инъекция по токену {@link DRIZZLE})
   * @param emailService - отправка письма-приглашения (v1.1.0 S1); сбой
   *   отправки не отменяет приглашение (fallback по DESIGN § 3.1)
   */
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Возвращает участников организации и ожидающие приглашения
   * (`GET /admin/members`).
   *
   * Состав организации фильтруется по `organization_id` актора, а не по
   * `orgId` из токена (KI-554). Порядок фиксирован: участники — по дате
   * вступления, приглашения — сначала новые; вторичный ключ `id` делает
   * порядок стабильным при одинаковых датах (как в keyset-пагинации аудита).
   *
   * @param userId - `sub` access-токена (id пользователя)
   * @returns участники организации и ожидающие приглашения
   * @throws UnauthorizedException если пользователь не найден в БД
   */
  async listAsync(userId: string): Promise<OrganizationMembersResponse> {
    const actor = await this.resolveActorAsync(userId);
    const organizationId = actor.organizationId;

    const members = await this.db
      .select({
        userId: users.id,
        email: users.email,
        role: users.role,
        // Отдельной даты «вступления» нет: пользователь появляется в
        // организации одновременно с учётной записью.
        joinedAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.organizationId, organizationId))
      .orderBy(asc(users.createdAt), asc(users.id));

    const invitations = await this.db
      .select({
        email: organizationInvitations.email,
        role: organizationInvitations.role,
        invitedBy: organizationInvitations.invitedBy,
        invitedAt: organizationInvitations.createdAt,
      })
      .from(organizationInvitations)
      .where(eq(organizationInvitations.organizationId, organizationId))
      .orderBy(desc(organizationInvitations.createdAt), desc(organizationInvitations.id));

    return { members, invitations };
  }

  /**
   * Выписывает приглашение в организацию актора
   * (`POST /admin/members/invite`) и пытается отправить письмо (v1.1.0 S1).
   *
   * Порядок проверок:
   * 1. организация актора — из БД, а не из токена (KI-554);
   * 2. email уже принадлежит зарегистрированному пользователю — 409: перенос
   *    между организациями в S5 не поддерживается;
   * 3. INSERT с `ON CONFLICT DO NOTHING` + `.returning()`: повторное приглашение
   *    того же email в ту же организацию ловится уникальным индексом, а не 500
   *    от нарушения ограничения в гонке (KI-400). Пустой `returning()` — 409.
   *
   * **Письмо — best-effort (DESIGN V110 § 3.1).** Приглашение в БД уже создано,
   * поэтому сбой/отсутствие SMTP не отменяет операцию: `EmailService` ловит
   * ошибку и возвращает `false`, а результат уезжает в ответ полем `emailSent`.
   * Запрос ждёт отправку (outbox/очереди в v1.1.0 нет, KI-593), но таймауты
   * SMTP ограничены в `EmailService`.
   *
   * @param userId - `sub` access-токена (кто приглашает)
   * @param dto - валидированные email и роль приглашаемого
   * @returns выписанное приглашение и признак отправки письма
   * @throws UnauthorizedException если пользователь не найден в БД
   * @throws ConflictException если email занят или приглашение уже выписано
   */
  async inviteAsync(
    userId: string,
    dto: InviteMemberDto,
  ): Promise<InviteMemberResponse> {
    const actor = await this.resolveActorAsync(userId);
    const email = this.normalizeEmail(dto.email);

    const [registered] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (registered !== undefined) {
      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const [invitation] = await this.db
      .insert(organizationInvitations)
      .values({
        organizationId: actor.organizationId,
        email,
        role: dto.role,
        invitedBy: userId,
      })
      // Гонка двух одновременных инвайтов: второй INSERT не падает 500, а
      // ничего не возвращает — и это превращается в честный 409 (KI-400).
      .onConflictDoNothing()
      .returning();

    if (invitation === undefined) {
      throw new ConflictException(INVITATION_EXISTS_MESSAGE);
    }

    // Письмо не влияет на успех приглашения: `false` — SMTP не настроен или
    // отказал, приглашение уже в БД (fallback DESIGN § 3.1).
    const emailSent = await this.emailService.sendInvitationAsync(
      invitation.email,
      actor.name,
      this.emailService.buildInvitationLink(invitation.id),
    );

    return {
      email: invitation.email,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      emailSent,
    };
  }

  /**
   * Возвращает организацию пользователя (id и название) по строке `users`.
   *
   * Организация резолвится из БД, а не из access-токена (KI-554): токен живёт
   * 24 часа, и после переезда пользователя в другую организацию `orgId` в нём
   * устарел бы. JOIN с `organizations` нужен, чтобы тема письма-приглашения
   * содержала название организации (v1.1.0 S1).
   *
   * @param userId - `sub` access-токена
   * @returns uuid организации и её название
   * @throws UnauthorizedException если строка `users` не найдена
   */
  private async resolveActorAsync(
    userId: string,
  ): Promise<{ organizationId: string; name: string }> {
    const [actor] = await this.db
      .select({
        organizationId: users.organizationId,
        name: organizations.name,
      })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (actor === undefined) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return actor;
  }

  /**
   * Приводит email к каноничному виду: без пробелов, в нижнем регистре.
   *
   * Та же нормализация, что в `AuthService.registerAsync`: иначе приглашение на
   * `User@Example.COM` не совпало бы с регистрацией по `user@example.com`.
   *
   * @param email - email из запроса
   * @returns нормализованный email
   */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
