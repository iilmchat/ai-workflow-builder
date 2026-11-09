import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { deviceTokens, users } from '../db/schema.js';
import { DeviceTokensService } from './device-tokens.service.js';

/** Стабильные идентификаторы тестовых данных. */
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const FCM_TOKEN = 'fcm-device-token-abc123';

/** Методы цепочки `select(...)` (`DeviceTokensService.resolveOrganizationIdAsync`). */
const SELECT_METHODS = ['from', 'where', 'limit'] as const;

/** Методы цепочки `insert(...)` (`DeviceTokensService.upsertAsync`). */
const INSERT_METHODS = ['values', 'onConflictDoUpdate'] as const;

/** Объединение методов обеих цепочек Drizzle. */
type ChainMethod =
  | (typeof SELECT_METHODS)[number]
  | (typeof INSERT_METHODS)[number];

/** Spy-методы одной цепочки-заглушки Drizzle. */
type ChainSpies = Record<ChainMethod, ReturnType<typeof vi.fn>>;

/**
 * Создаёт цепочку-заглушку Drizzle query builder (как в
 * `org-members.service.spec.ts`).
 *
 * Каждый метод возвращает саму цепочку, поэтому её можно дожидаться через
 * `await`; значение, которое получит `await`, задаётся через `resolveWith`.
 * Свойство `then` живёт только в proxy: сам объект цепочки не thenable
 * (правило `unicorn/no-thenable`), а `await` получает результат запроса.
 *
 * @param methods - методы, которые есть у цепочки (select или insert)
 * @param resolveWith - результат, который эмулирует выполненный запрос
 * @returns proxy-цепочка со spy-методами
 */
function chain(
  methods: readonly ChainMethod[],
  resolveWith: unknown,
): ChainSpies {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as unknown as ChainSpies;

  for (const method of methods) {
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

describe('DeviceTokensService (v1.5.0 S3)', () => {
  let service: DeviceTokensService;
  let select: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;
  /** Очередь ответов для `select`-запросов. */
  let selectResults: unknown[][];
  /** Все созданные `select`-цепочки: по ним проверяются FROM/WHERE/LIMIT. */
  let selectChains: ChainSpies[];
  /** Все созданные `insert`-цепочки: по ним проверяются VALUES/ON CONFLICT. */
  let insertChains: ChainSpies[];

  beforeEach(async () => {
    selectResults = [];
    selectChains = [];
    insertChains = [];

    select = vi.fn(() => {
      const created = chain(SELECT_METHODS, selectResults.shift() ?? []);
      selectChains.push(created);

      return created;
    });
    insert = vi.fn(() => {
      const created = chain(INSERT_METHODS, []);
      insertChains.push(created);

      return created;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        DeviceTokensService,
        {
          provide: DRIZZLE,
          useValue: { select, insert } as unknown as Database,
        },
      ],
    }).compile();

    service = moduleRef.get(DeviceTokensService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('upsertAsync', () => {
    it('делает INSERT ... ON CONFLICT (token) DO UPDATE SET user_id, organization_id', async () => {
      await service.upsertAsync(USER_ID, ORG_ID, FCM_TOKEN, 'android');

      // Один INSERT, без предварительного SELECT: конфликт разрешает сам Postgres.
      expect(select).not.toHaveBeenCalled();
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledWith(deviceTokens);

      const chain_ = insertChains[0];

      expect(chain_?.values).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        token: FCM_TOKEN,
        platform: 'android',
      });

      // Конфликт — по UNIQUE (token), а обновляется только владелец/арендатор:
      // platform и created_at при повторной регистрации не перезаписываются.
      const conflict = chain_?.onConflictDoUpdate.mock.calls[0]?.[0] as
        | { target: unknown; set: Record<string, unknown> }
        | undefined;

      expect(conflict?.target).toBe(deviceTokens.token);
      expect(conflict?.set).toEqual({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(Object.keys(conflict?.set ?? {})).toEqual([
        'userId',
        'organizationId',
      ]);
    });

    it('принимает все платформы из CHECK-домена (android/ios/web)', async () => {
      for (const platform of ['android', 'ios', 'web'] as const) {
        await service.upsertAsync(USER_ID, ORG_ID, FCM_TOKEN, platform);
      }

      expect(insert).toHaveBeenCalledTimes(3);
      expect(
        insertChains.map(
          (insertChain) => insertChain.values.mock.calls[0]?.[0]?.platform,
        ),
      ).toEqual(['android', 'ios', 'web']);
    });
  });

  describe('resolveOrganizationIdAsync', () => {
    it('читает organization_id из строки users, а не из токена (KI-554)', async () => {
      // Организация в БД заведомо не совпадает с orgId access-токена.
      selectResults.push([{ organizationId: ORG_ID }]);

      await expect(service.resolveOrganizationIdAsync(USER_ID)).resolves.toBe(
        ORG_ID,
      );

      // Один SELECT по users.id — и только он.
      expect(select).toHaveBeenCalledTimes(1);
      expect(select).toHaveBeenCalledWith({ organizationId: users.organizationId });

      const selectChain = selectChains[0];

      expect(selectChain?.from).toHaveBeenCalledWith(users);
      expect(sqlParams(selectChain?.where.mock.calls[0]?.[0])).toContain(USER_ID);
      expect(selectChain?.limit).toHaveBeenCalledWith(1);
    });

    it('бросает UnauthorizedException, если строки users нет', async () => {
      selectResults.push([]);

      await expect(service.resolveOrganizationIdAsync(USER_ID)).rejects.toThrow(
        UnauthorizedException,
      );
      // UPSERT не выполняется: без организации токен привязывать некуда.
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
