import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { EmailService } from '../email/email.service.js';
import { OrgMembersService } from './org-members.service.js';
import type {
  OrganizationInvitationSummary,
  OrganizationMembersResponse,
} from './dto/member.dto.js';

/** Стабильные идентификаторы тестовых данных. */
const USER_ID = '33333333-3333-4333-8333-333333333333';
const MEMBER_ID = '44444444-4444-4444-8444-444444444444';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
/** Организация из строки `users` — заведомо не совпадает с «токенной» (KI-554). */
const OTHER_ORG_ID = '66666666-6666-4666-8666-666666666666';
const REGISTERED_ID = '77777777-7777-4777-8777-777777777777';
const INVITATION_ID = '88888888-8888-4888-8888-888888888888';
/** uuid личной организации, в которую переезжает удалённый участник (S2). */
const NEW_ORG_ID = '99999999-9999-4999-8999-999999999999';

const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const JOINED_AT = new Date('2024-02-01T00:00:00.000Z');
const INVITED_AT = new Date('2024-03-01T00:00:00.000Z');

/** Методы Drizzle-цепочки, которые вызывают сервис и его тестовая заглушка. */
const CHAIN_METHODS = [
  'from',
  'innerJoin',
  'where',
  'orderBy',
  'limit',
  'set',
  'values',
  'onConflictDoNothing',
  'returning',
] as const;

/** Тип метода цепочки Drizzle. */
type ChainMethod = (typeof CHAIN_METHODS)[number];

/** Spy-методы одной цепочки-заглушки Drizzle. */
type ChainSpies = Record<ChainMethod, ReturnType<typeof vi.fn>>;

/**
 * Создаёт цепочку-заглушку Drizzle query builder (как в `audit.service.spec.ts`).
 *
 * Каждый метод возвращает саму цепочку, поэтому её можно дожидаться через
 * `await`; значение, которое получит `await`, задаётся через `resolveWith`.
 * Свойство `then` живёт только в proxy: сам объект цепочки не thenable
 * (правило `unicorn/no-thenable`), а `await` получает результат запроса.
 *
 * @param resolveWith - результат, который эмулирует выполненный запрос
 * @returns proxy-цепочка со spy-методами
 */
function chain(resolveWith: unknown): ChainSpies {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as unknown as ChainSpies;

  for (const method of CHAIN_METHODS) {
    link[method] = vi.fn(() => proxy);
  }

  return proxy;
}

/**
 * Достаёт bind-параметры SQL-условия (мок Drizzle SQL не исполняет).
 *
 * @param condition - аргумент `where`, переданный сервисом
 * @returns значения bind-параметров условия
 */
function sqlParams(condition: unknown): unknown[] {
  return new PgDialect().sqlToQuery(condition as SQL).params;
}

describe('OrgMembersService (v1.0.0 S5; S1 — письмо; v1.1.0 S2 — управление)', () => {
  let service: OrgMembersService;
  let select: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let removeRows: ReturnType<typeof vi.fn>;
  /** Заглушка `EmailService` (v1.2.0 S2): постановка письма в очередь и ссылка. */
  let emailService: {
    queueInvitationAsync: ReturnType<typeof vi.fn>;
    buildInvitationLink: ReturnType<typeof vi.fn>;
  };
  /** Очередь ответов для последовательных `select`-запросов. */
  let selectResults: unknown[][];
  /** Очередь ответов для `insert`-запросов. */
  let insertResults: unknown[][];
  /** Очередь ответов для `update`-запросов (`.returning()`). */
  let updateResults: unknown[][];
  /** Все созданные `select`-цепочки: по ним проверяются WHERE и ORDER BY. */
  let selectChains: ChainSpies[];
  /** Все созданные `update`-цепочки: по ним проверяются SET/WHERE. */
  let updateChains: ChainSpies[];
  /** Цепочка последнего `insert` (проверка values/onConflictDoNothing). */
  let insertChain: ChainSpies | undefined;

  beforeEach(async () => {
    selectResults = [];
    insertResults = [];
    updateResults = [];
    selectChains = [];
    updateChains = [];
    insertChain = undefined;

    select = vi.fn(() => {
      const created = chain(selectResults.shift() ?? []);
      selectChains.push(created);

      return created;
    });
    insert = vi.fn(() => {
      insertChain = chain(insertResults.shift() ?? []);

      return insertChain;
    });
    update = vi.fn(() => {
      const created = chain(updateResults.shift() ?? []);
      updateChains.push(created);

      return created;
    });
    removeRows = vi.fn(() => chain([]));
    emailService = {
      queueInvitationAsync: vi.fn(() => Promise.resolve(true)),
      buildInvitationLink: vi.fn(
        (invitationId: string) =>
          `http://localhost:3000/login?invite=${invitationId}`,
      ),
    };

    /** Объект, который сервис получает как `tx` внутри `db.transaction`. */
    const tx = { select, insert, update, delete: removeRows };
    const db = {
      select,
      insert,
      update,
      delete: removeRows,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(tx),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrgMembersService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = moduleRef.get(OrgMembersService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Задаёт ответы последовательных `select`-запросов.
   *
   * @param results - результаты запросов в порядке вызова
   */
  function mockSelects(...results: unknown[][]): void {
    selectResults.push(...results);
  }

  /**
   * Задаёт ответ `insert`-запроса.
   *
   * @param result - строки, которые вернёт `.returning()`
   */
  function mockInsert(result: unknown[]): void {
    insertResults.push(result);
  }

  /**
   * Задаёт ответ `update`-запроса с `.returning()`.
   *
   * @param result - строки, которые вернёт `.returning()`
   */
  function mockUpdate(result: unknown[]): void {
    updateResults.push(result);
  }

  describe('listAsync', () => {
    it('отдаёт участников и приглашения организации из БД (KI-554)', async () => {
      const members: OrganizationMembersResponse['members'] = [
        {
          userId: USER_ID,
          email: 'owner@example.com',
          role: 'owner',
          joinedAt: CREATED_AT,
        },
        {
          userId: MEMBER_ID,
          email: 'member@example.com',
          role: 'member',
          joinedAt: JOINED_AT,
        },
      ];
      const invitations: OrganizationMembersResponse['invitations'] = [
        {
          email: 'invite@example.com',
          role: 'viewer',
          invitedBy: USER_ID,
          invitedAt: INVITED_AT,
        },
      ];
      // Строка актора возвращает ДРУГУЮ организацию: список обязан строиться по
      // ней, а не по orgId из токена (сервис токена вообще не получает).
      mockSelects([{ organizationId: OTHER_ORG_ID }], members, invitations);

      const result = await service.listAsync(USER_ID);

      expect(result).toEqual({ members, invitations });
      // Три запроса: актор, участники, приглашения.
      expect(selectChains).toHaveLength(3);
      // Фильтр по организации из строки `users` — в обоих списках.
      expect(sqlParams(selectChains[1]?.where.mock.calls[0]?.[0])).toContain(
        OTHER_ORG_ID,
      );
      expect(sqlParams(selectChains[2]?.where.mock.calls[0]?.[0])).toContain(
        OTHER_ORG_ID,
      );
      // Порядок задан явно: участники — по дате вступления, приглашения — новые
      // первыми (вторичный ключ `id` делает порядок стабильным).
      expect(selectChains[1]?.orderBy).toHaveBeenCalledTimes(1);
      expect(selectChains[2]?.orderBy).toHaveBeenCalledTimes(1);
    });

    it('бросает UnauthorizedException, если строки users нет', async () => {
      mockSelects([]);

      await expect(service.listAsync(USER_ID)).rejects.toThrow(
        UnauthorizedException,
      );
      // Отсутствие актора прерывает запрос до выборок списков.
      expect(selectChains).toHaveLength(1);
    });
  });

  describe('inviteAsync', () => {
    it('выписывает приглашение в организацию из БД, а не из токена (KI-554)', async () => {
      mockSelects([{ organizationId: OTHER_ORG_ID, name: 'Acme Org' }], []);
      mockInsert([
        {
          id: INVITATION_ID,
          organizationId: OTHER_ORG_ID,
          email: 'new@example.com',
          role: 'member',
          invitedBy: USER_ID,
          createdAt: INVITED_AT,
        },
      ]);

      const result = await service.inviteAsync(USER_ID, {
        email: '  New@Example.COM ',
        role: 'member',
      });

      expect(result).toEqual({
        email: 'new@example.com',
        role: 'member',
        invitedBy: USER_ID,
        invitedAt: INVITED_AT,
        // v1.2.0 S2: доставка ещё не подтверждена — emailSent всегда false.
        emailSent: false,
        // KI-622: очередь ответила успехом — задание поставлено.
        emailQueued: true,
      });
      // Email нормализован, организация — из строки `users` актора.
      expect(insertChain?.values).toHaveBeenCalledWith({
        organizationId: OTHER_ORG_ID,
        email: 'new@example.com',
        role: 'member',
        invitedBy: USER_ID,
      });
      // Гонка инвайтов разрешается ON CONFLICT DO NOTHING + returning (KI-400).
      expect(insertChain?.onConflictDoNothing).toHaveBeenCalledTimes(1);
      expect(insertChain?.returning).toHaveBeenCalledTimes(1);
      // v1.2.0 S2: письмо ставится в очередь на нормализованный email, с
      // названием организации из БД и ссылкой по id приглашения; синхронной
      // отправки в HTTP-пути больше нет.
      expect(emailService.buildInvitationLink).toHaveBeenCalledWith(INVITATION_ID);
      expect(emailService.queueInvitationAsync).toHaveBeenCalledWith(
        'new@example.com',
        'Acme Org',
        `http://localhost:3000/login?invite=${INVITATION_ID}`,
      );
    });

    it('возвращает emailQueued=false и emailSent=false, если очередь недоступна (Redis), но приглашение создано', async () => {
      // Fallback DESIGN V120 § 3.3: приглашение в БД есть, письмо не поставлено.
      emailService.queueInvitationAsync.mockResolvedValue(false);
      mockSelects([{ organizationId: ORG_ID, name: 'Acme Org' }], []);
      mockInsert([
        {
          id: INVITATION_ID,
          organizationId: ORG_ID,
          email: 'new@example.com',
          role: 'viewer',
          invitedBy: USER_ID,
          createdAt: INVITED_AT,
        },
      ]);

      const result = await service.inviteAsync(USER_ID, {
        email: 'new@example.com',
        role: 'viewer',
      });

      // Приглашение не отменяется из-за письма: 409/исключения нет. Очередь
      // недоступна — emailQueued честно false (KI-622), доставки не будет.
      expect(result).toMatchObject({
        email: 'new@example.com',
        role: 'viewer',
        emailSent: false,
        emailQueued: false,
      });
      expect(result.emailQueued).toBe(false);
      expect(result.emailSent).toBe(false);
      expect(emailService.queueInvitationAsync).toHaveBeenCalledTimes(1);
    });

    it('бросает ConflictException (409), если email уже зарегистрирован', async () => {
      mockSelects(
        [{ organizationId: ORG_ID, name: 'Acme Org' }],
        [{ id: REGISTERED_ID }],
      );

      const error = await service
        .inviteAsync(USER_ID, { email: 'taken@example.com', role: 'viewer' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toContain(
        'перенос между организациями не поддерживается',
      );
      // До INSERT дело не доходит, письмо не ставится в очередь.
      expect(insert).not.toHaveBeenCalled();
      expect(emailService.queueInvitationAsync).not.toHaveBeenCalled();
    });

    it('бросает ConflictException (409), если приглашение уже выписано (гонка)', async () => {
      mockSelects([{ organizationId: ORG_ID, name: 'Acme Org' }], []);
      // ON CONFLICT DO NOTHING: уникальный индекс не дал вставить дубль,
      // returning() пуст — сервис отдаёт 409, а не 500.
      mockInsert([]);

      await expect(
        service.inviteAsync(USER_ID, { email: 'invite@example.com', role: 'admin' }),
      ).rejects.toThrow(ConflictException);
      // Письмо на дубль не ставится в очередь.
      expect(emailService.queueInvitationAsync).not.toHaveBeenCalled();
    });

    it('бросает UnauthorizedException, если строки users нет', async () => {
      mockSelects([]);

      await expect(
        service.inviteAsync(USER_ID, { email: 'new@example.com', role: 'member' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(insert).not.toHaveBeenCalled();
      expect(emailService.queueInvitationAsync).not.toHaveBeenCalled();
    });
  });

  describe('updateRoleAsync (v1.1.0 S2)', () => {
    it('меняет роль участника организации и возвращает обновлённую строку', async () => {
      mockSelects(
        [{ organizationId: ORG_ID, name: 'Acme' }],
        [{ role: 'member' }],
      );
      mockUpdate([
        {
          userId: MEMBER_ID,
          email: 'member@example.com',
          role: 'viewer',
          joinedAt: JOINED_AT,
        },
      ]);

      const result = await service.updateRoleAsync(USER_ID, MEMBER_ID, {
        role: 'viewer',
      });

      expect(result).toEqual({
        userId: MEMBER_ID,
        email: 'member@example.com',
        role: 'viewer',
        joinedAt: JOINED_AT,
      });
      expect(updateChains[0]?.set).toHaveBeenCalledWith({ role: 'viewer' });
      // UPDATE ограничен парой (участник, организация актора) — KI-554.
      const updateParams = sqlParams(
        updateChains[0]?.where.mock.calls[0]?.[0],
      );
      expect(updateParams).toContain(MEMBER_ID);
      expect(updateParams).toContain(ORG_ID);
    });

    it('нельзя менять собственную роль — BadRequest, UPDATE не выполняется', async () => {
      mockSelects([{ organizationId: ORG_ID, name: 'Acme' }]);

      await expect(
        service.updateRoleAsync(USER_ID, USER_ID, { role: 'viewer' }),
      ).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('роль owner неизменяема — BadRequest, UPDATE не выполняется', async () => {
      mockSelects(
        [{ organizationId: ORG_ID, name: 'Acme' }],
        [{ role: 'owner' }],
      );

      await expect(
        service.updateRoleAsync(USER_ID, MEMBER_ID, { role: 'admin' }),
      ).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('участник из другой организации — NotFound, UPDATE не выполняется', async () => {
      // Выборка пары (id, organization_id) пуста: чужая организация неотличима
      // от несуществующего участника.
      mockSelects([{ organizationId: ORG_ID, name: 'Acme' }], []);

      await expect(
        service.updateRoleAsync(USER_ID, MEMBER_ID, { role: 'viewer' }),
      ).rejects.toThrow(NotFoundException);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('removeMemberAsync (v1.1.0 S2)', () => {
    it('переносит графы владельцу, убирает участие, создаёт личную организацию и отзывает refresh-токены', async () => {
      mockSelects(
        [{ organizationId: ORG_ID, name: 'Acme' }],
        [{ id: MEMBER_ID, email: 'member@example.com', role: 'member' }],
      );
      mockInsert([{ id: NEW_ORG_ID }]);

      await expect(
        service.removeMemberAsync(USER_ID, MEMBER_ID),
      ).resolves.toBeUndefined();

      // Три UPDATE в транзакции: перенос графов, переезд, отзыв токенов.
      expect(update).toHaveBeenCalledTimes(3);
      expect(updateChains[0]?.set).toHaveBeenCalledWith({ userId: USER_ID });
      const transferParams = sqlParams(
        updateChains[0]?.where.mock.calls[0]?.[0],
      );
      expect(transferParams).toContain(MEMBER_ID);
      expect(transferParams).toContain(ORG_ID);
      expect(updateChains[1]?.set).toHaveBeenCalledWith({
        organizationId: NEW_ORG_ID,
        role: 'owner',
        // v1.1.0 S5 (KI-601): версия токена инкрементится — старый access
        // перестаёт действовать сразу, не дожидаясь истечения.
        tokenVersion: expect.anything(),
      });
      expect(updateChains[2]?.set).toHaveBeenCalledWith({
        revokedAt: expect.any(Date),
      });

      // Участие в workflow этой организации удалено.
      expect(removeRows).toHaveBeenCalledTimes(1);
      // Личная организация участника создана в той же транзакции.
      expect(insertChain?.values).toHaveBeenCalledWith({
        name: 'Personal Workspace - member@example.com',
      });
    });

    it('нельзя удалить самого себя — BadRequest, транзакция не начинается', async () => {
      mockSelects([{ organizationId: ORG_ID, name: 'Acme' }]);

      await expect(
        service.removeMemberAsync(USER_ID, USER_ID),
      ).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
      expect(removeRows).not.toHaveBeenCalled();
    });

    it('владельца организации удалить нельзя — BadRequest', async () => {
      mockSelects(
        [{ organizationId: ORG_ID, name: 'Acme' }],
        [{ id: MEMBER_ID, email: 'owner@example.com', role: 'owner' }],
      );

      await expect(
        service.removeMemberAsync(USER_ID, MEMBER_ID),
      ).rejects.toThrow(BadRequestException);
      expect(update).not.toHaveBeenCalled();
    });

    it('участник из другой организации — NotFound, транзакция не начинается', async () => {
      mockSelects([{ organizationId: ORG_ID, name: 'Acme' }], []);

      await expect(
        service.removeMemberAsync(USER_ID, MEMBER_ID),
      ).rejects.toThrow(NotFoundException);
      expect(update).not.toHaveBeenCalled();
      expect(removeRows).not.toHaveBeenCalled();
    });
  });

  it('тип ответа списка содержит только лёгкие поля (без passwordHash)', async () => {
    const response: OrganizationMembersResponse = {
      members: [
        { userId: USER_ID, email: 'owner@example.com', role: 'owner', joinedAt: CREATED_AT },
      ],
      invitations: [] satisfies OrganizationInvitationSummary[],
    };

    mockSelects([{ organizationId: ORG_ID }], response.members, response.invitations);

    await expect(service.listAsync(USER_ID)).resolves.toEqual(response);
    expect(Object.keys(response.members[0] ?? {})).not.toContain('passwordHash');
  });
});
