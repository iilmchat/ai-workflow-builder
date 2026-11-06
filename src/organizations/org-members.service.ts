import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';
import {
  organizationInvitations,
  organizations,
  refreshTokens,
  users,
  workflowCollaborators,
  workflows,
} from '../db/schema.js';
import { EmailService } from '../email/email.service.js';
import type {
  InviteMemberDto,
  InviteMemberResponse,
  OrganizationMemberSummary,
  OrganizationMembersResponse,
  UpdateMemberRoleDto,
} from './dto/member.dto.js';

/** Сообщение 409 для email, занятого действующим пользователем. */
const EMAIL_TAKEN_MESSAGE =
  'Пользователь с этим email уже зарегистрирован: перенос между организациями не поддерживается';

/** Сообщение 409 для уже выписанного приглашения. */
const INVITATION_EXISTS_MESSAGE = 'Приглашение для этого email уже отправлено';

/** Сообщение 400: владелец не может изменить собственную роль (S2). */
const SELF_ROLE_CHANGE_MESSAGE = 'Нельзя изменить собственную роль';

/** Сообщение 400: владелец не может удалить самого себя (S2). */
const SELF_REMOVE_MESSAGE = 'Нельзя удалить самого себя из организации';

/** Сообщение 400: роль `owner` назначается только при создании организации. */
const OWNER_ROLE_IMMUTABLE_MESSAGE =
  'Роль владельца организации нельзя изменить или снять';

/** Сообщение 404: участника нет в организации (в т.ч. чужая организация). */
const MEMBER_NOT_FOUND_MESSAGE = 'Участник не найден в организации';

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
 * недопустим. Роль операций управления проверяет `OrgOwnerOnlyGuard` (S2), тоже
 * по БД.
 *
 * **Управление составом (v1.1.0 S2, KI-586).** Смена роли и удаление участника
 * доступны только владельцу организации. Удаление — это выход из организации, а
 * не удаление учётной записи: пользователь переезжает в новую личную
 * организацию, его графы в этой организации переходят владельцу, а refresh-токены
 * отзываются. Причины такого выбора — KI-599/601 и ADR-0005 (модель членства).
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
   * (`POST /admin/members/invite`) и ставит письмо в очередь (v1.2.0 S2).
   *
   * Порядок проверок:
   * 1. организация актора — из БД, а не из токена (KI-554);
   * 2. email уже принадлежит зарегистрированному пользователю — 409: перенос
   *    между организациями в S5 не поддерживается;
   * 3. INSERT с `ON CONFLICT DO NOTHING` + `.returning()`: повторное приглашение
   *    того же email в ту же организацию ловится уникальным индексом, а не 500
   *    от нарушения ограничения в гонке (KI-400). Пустой `returning()` — 409.
   *
   * **Письмо — best-effort и асинхронное (DESIGN V120 § 3.3).** Приглашение
   * сначала создаётся в БД, затем задание ставится в BullMQ
   * (`email-invitations`, 3 попытки, exponential backoff). HTTP-запрос не ждёт
   * SMTP: отправку делает `EmailProcessor`. Ошибка постановки в Redis не
   * отменяет приглашение — сервис пишет ERROR, приглашение остаётся в БД.
   *
   * Результат постановки возвращается клиенту полем `emailQueued` (KI-622):
   * `emailSent` всегда `false`, потому что доставка в HTTP-ответе не
   * подтверждается.
   *
   * @param userId - `sub` access-токена (кто приглашает)
   * @param dto - валидированные email и роль приглашаемого
   * @returns выписанное приглашение; `emailQueued` — поставлено ли письмо в
   *   очередь, `emailSent` всегда `false` (KI-622)
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

    // Письмо не влияет на успех приглашения: с v1.2.0 S2 оно ставится в
    // очередь `email-invitations`, а ошибка Redis/постановки лишь логируется
    // (`queueInvitationAsync` → `false`). Приглашение уже в БД. Результат
    // постановки возвращается клиенту как `emailQueued` (KI-622).
    const emailQueued = await this.emailService.queueInvitationAsync(
      invitation.email,
      actor.name,
      this.emailService.buildInvitationLink(invitation.id),
    );

    return {
      email: invitation.email,
      role: invitation.role,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      // С v1.2.0 S2 письмо отправляется асинхронно воркером очереди, поэтому
      // в HTTP-ответе доставка ещё не подтверждена (KI-622).
      emailSent: false,
      // `true` — задание в очереди; `false` — очередь/Redis недоступна, письмо
      // не поставлено, но приглашение создано.
      emailQueued,
    };
  }

  /**
   * Меняет роль участника организации (`PATCH /admin/members/:userId`,
   * v1.1.0 S2, KI-586).
   *
   * Правила:
   * 1. участник должен состоять **в организации актора** — выборка парой
   *    `(id, organization_id)`, поэтому чужой пользователь неотличим от
   *    несуществующего (404, класс KI-202: факт существования не раскрывается);
   * 2. собственную роль менять нельзя (400) — иначе владелец мог бы «разжаловать»
   *    себя и оставить организацию без владельца;
   * 3. роль `owner` неизменяема (400): владелец организации один, назначается
   *    при создании организации и снимается только удалением организации.
   *    Пригласить/назначить `owner` нельзя и через `UpdateMemberRoleSchema`.
   *
   * Роль актора проверяет `OrgOwnerOnlyGuard` до вызова сервиса; сервис тем не
   * менее сверяет организацию по БД (token `orgId` не используется — KI-554).
   *
   * @param actorUserId - `sub` access-токена (владелец организации)
   * @param targetUserId - uuid участника из пути
   * @param dto - валидированная новая роль (`admin`/`member`/`viewer`)
   * @returns обновлённый участник (для списка команды)
   * @throws NotFoundException если участника нет в организации актора
   * @throws BadRequestException если цель — сам актор или роль `owner`
   */
  async updateRoleAsync(
    actorUserId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<OrganizationMemberSummary> {
    const actor = await this.resolveActorAsync(actorUserId);

    if (targetUserId === actorUserId) {
      throw new BadRequestException(SELF_ROLE_CHANGE_MESSAGE);
    }

    const [target] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(
        and(
          eq(users.id, targetUserId),
          eq(users.organizationId, actor.organizationId),
        ),
      )
      .limit(1);

    if (target === undefined) {
      throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    }

    if (target.role === 'owner') {
      throw new BadRequestException(OWNER_ROLE_IMMUTABLE_MESSAGE);
    }

    const [updated] = await this.db
      .update(users)
      .set({ role: dto.role })
      .where(
        and(
          eq(users.id, targetUserId),
          eq(users.organizationId, actor.organizationId),
        ),
      )
      .returning({
        userId: users.id,
        email: users.email,
        role: users.role,
        joinedAt: users.createdAt,
      });

    if (updated === undefined) {
      // Гонка: участника удалили между SELECT и UPDATE.
      throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    }

    return updated;
  }

  /**
   * Исключает участника из организации (`DELETE /admin/members/:userId`,
   * v1.1.0 S2, KI-586).
   *
   * **Это выход из организации, а не удаление учётной записи** — осознанно:
   * удаление строки `users` каскадно снесло бы refresh-токены, шаблоны
   * документов (`created_by` CASCADE) и оставило бы «висячие» workflow
   * (у `workflows.user_id` FK нет). Вместо этого в одной транзакции
   * (RULES 4.22):
   *
   * 1. **графы участника в этой организации переходят владельцу** — иначе они
   *    стали бы недоступны никому: предикат доступа требует `user_id` = я или
   *    строку участника, а после переезда ни одно из условий не выполняется
   *    (KI-599; данные не теряются);
   * 2. его строки `workflow_collaborators` удаляются — он больше не участник
   *    workflow этой организации;
   * 3. участник переезжает в новую личную организацию с ролью `owner`
   *    (учётная запись и вход сохраняются);
   * 4. активные refresh-токены отзываются, чтобы сессия не продлевалась (доступ
   *    по уже выданному access-токену живёт до 24 ч — KI-601).
   *
   * Себя удалить нельзя (400), владельца — нельзя (400). Участник из чужой
   * организации неотличим от несуществующего (404). После операции
   * срабатывает `AuditInterceptor` с действием `member.remove`.
   *
   * @param actorUserId - `sub` access-токена (владелец организации)
   * @param targetUserId - uuid участника из пути
   * @returns промис без значения (контроллер отвечает 204)
   * @throws NotFoundException если участника нет в организации актора
   * @throws BadRequestException если цель — сам актор или владелец
   */
  async removeMemberAsync(
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const actor = await this.resolveActorAsync(actorUserId);

    if (targetUserId === actorUserId) {
      throw new BadRequestException(SELF_REMOVE_MESSAGE);
    }

    const [target] = await this.db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.id, targetUserId),
          eq(users.organizationId, actor.organizationId),
        ),
      )
      .limit(1);

    if (target === undefined) {
      throw new NotFoundException(MEMBER_NOT_FOUND_MESSAGE);
    }

    if (target.role === 'owner') {
      throw new BadRequestException(OWNER_ROLE_IMMUTABLE_MESSAGE);
    }

    await this.db.transaction(async (tx) => {
      // 1. Графы участника остаются в организации, но меняют владельца.
      await tx
        .update(workflows)
        .set({ userId: actorUserId })
        .where(
          and(
            eq(workflows.userId, target.id),
            eq(workflows.organizationId, actor.organizationId),
          ),
        );

      // 2. Участие в workflow этой организации прекращается.
      await tx
        .delete(workflowCollaborators)
        .where(eq(workflowCollaborators.userId, target.id));

      // 3. Новая личная организация: учётная запись и вход сохраняются.
      const [personalWorkspace] = await tx
        .insert(organizations)
        .values({ name: `Personal Workspace - ${target.email}` })
        .returning();

      await tx
        .update(users)
        .set({
          organizationId: personalWorkspace.id,
          role: 'owner',
          // v1.1.0 S5 (KI-601): инкремент версии отзывает уже выданные
          // access-токены участника — его следующий запрос получит 401, даже
          // если он не сменил организацию (страховка к org-проверке guard'а).
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(eq(users.id, target.id));

      // 4. Отзыв refresh-токенов: доступ не продлевается за пределы
      //    действующего access-токена (KI-601).
      await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, target.id),
            isNull(refreshTokens.revokedAt),
          ),
        );
    });
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
