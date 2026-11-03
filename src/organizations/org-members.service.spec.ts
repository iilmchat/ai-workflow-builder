import { ConflictException, UnauthorizedException } from '@nestjs/common';
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

describe('OrgMembersService (v1.0.0 S5; v1.1.0 S1 — письмо)', () => {
  let service: OrgMembersService;
  let select: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;
  /** Заглушка `EmailService` (v1.1.0 S1): отправка письма и сборка ссылки. */
  let emailService: {
    sendInvitationAsync: ReturnType<typeof vi.fn>;
    buildInvitationLink: ReturnType<typeof vi.fn>;
  };
  /** Очередь ответов для последовательных `select`-запросов. */
  let selectResults: unknown[][];
  /** Очередь ответов для `insert`-запросов. */
  let insertResults: unknown[][];
  /** Все созданные `select`-цепочки: по ним проверяются WHERE и ORDER BY. */
  let selectChains: ChainSpies[];
  /** Цепочка последнего `insert` (проверка values/onConflictDoNothing). */
  let insertChain: ChainSpies | undefined;

  beforeEach(async () => {
    selectResults = [];
    insertResults = [];
    selectChains = [];
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
    emailService = {
      sendInvitationAsync: vi.fn(() => Promise.resolve(true)),
      buildInvitationLink: vi.fn(
        (invitationId: string) =>
          `http://localhost:3000/login?invite=${invitationId}`,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrgMembersService,
        { provide: DRIZZLE, useValue: { select, insert } as unknown as Database },
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
        // v1.1.0 S1: письмо отправлено (заглушка EmailService вернула true).
        emailSent: true,
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
      // v1.1.0 S1: письмо уходит на нормализованный email, с названием
      // организации из БД и ссылкой по id приглашения.
      expect(emailService.buildInvitationLink).toHaveBeenCalledWith(INVITATION_ID);
      expect(emailService.sendInvitationAsync).toHaveBeenCalledWith(
        'new@example.com',
        'Acme Org',
        `http://localhost:3000/login?invite=${INVITATION_ID}`,
      );
    });

    it('возвращает 201-подобный ответ с emailSent=false, если SMTP не отправил (v1.1.0 S1)', async () => {
      // Fallback DESIGN V110 § 3.1: приглашение в БД есть, письма нет.
      emailService.sendInvitationAsync.mockResolvedValue(false);
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

      // Приглашение не отменяется из-за письма: 409/исключения нет.
      expect(result).toMatchObject({
        email: 'new@example.com',
        role: 'viewer',
        emailSent: false,
      });
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
      // До INSERT дело не доходит, письмо не отправляется.
      expect(insert).not.toHaveBeenCalled();
      expect(emailService.sendInvitationAsync).not.toHaveBeenCalled();
    });

    it('бросает ConflictException (409), если приглашение уже выписано (гонка)', async () => {
      mockSelects([{ organizationId: ORG_ID, name: 'Acme Org' }], []);
      // ON CONFLICT DO NOTHING: уникальный индекс не дал вставить дубль,
      // returning() пуст — сервис отдаёт 409, а не 500.
      mockInsert([]);

      await expect(
        service.inviteAsync(USER_ID, { email: 'invite@example.com', role: 'admin' }),
      ).rejects.toThrow(ConflictException);
      // Письмо на дубль не отправляется.
      expect(emailService.sendInvitationAsync).not.toHaveBeenCalled();
    });

    it('бросает UnauthorizedException, если строки users нет', async () => {
      mockSelects([]);

      await expect(
        service.inviteAsync(USER_ID, { email: 'new@example.com', role: 'member' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(insert).not.toHaveBeenCalled();
      expect(emailService.sendInvitationAsync).not.toHaveBeenCalled();
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
