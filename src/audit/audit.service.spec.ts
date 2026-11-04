import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { auditLogs, users } from '../db/schema.js';
import { encodeAuditCursor } from './dto/audit.dto.js';
import { AuditService, type AuditEntry } from './audit.service.js';

/** Стабильные идентификаторы тестовых данных. */
const LOG_ID = '11111111-1111-4111-8111-111111111111';
const LOG_ID_2 = '22222222-2222-4222-8222-222222222222';
const LOG_ID_3 = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const AUTHOR_ID = '88888888-8888-4888-8888-888888888888';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG_ID = '66666666-6666-4666-8666-666666666666';
const RESOURCE_ID = '77777777-7777-4777-8777-777777777777';

const CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const METADATA: Record<string, unknown> = {
  method: 'POST',
  path: '/workflow',
  params: {},
  body: { name: 'Мой workflow' },
  statusCode: 201,
};

/** Строка `audit_logs`, как её отдаёт SQL-проекция `listAsync`. */
interface AuditLogRowFixture {
  id: string;
  createdAt: Date;
  cursorCreatedAt?: string;
  userId: string;
  organizationId: string;
  action: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Строка журнала для проверки маппинга в публичный ответ.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns строка `audit_logs` с дефолтными значениями
 */
function baseRow(overrides: Partial<AuditLogRowFixture> = {}): AuditLogRowFixture {
  return {
    id: LOG_ID,
    createdAt: CREATED_AT,
    cursorCreatedAt: '2024-01-01T00:00:00.000123Z',
    userId: USER_ID,
    organizationId: ORG_ID,
    action: 'workflow.create',
    resourceId: RESOURCE_ID,
    metadata: METADATA,
    ...overrides,
  };
}

/** Запись, которую интерсептор передаёт в `recordAsync`. */
const ENTRY: AuditEntry = {
  userId: USER_ID,
  organizationId: ORG_ID,
  action: 'workflow.create',
  resourceId: RESOURCE_ID,
  metadata: METADATA,
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * Каждый метод (`from`/`where`/`orderBy`/`limit`/`values`) возвращает саму
 * цепочку, поэтому её можно дожидаться через `await`; значение, которое
 * получит `await`, задаётся через `resolveWith`. Для вставки достаточно
 * `values()` — `returning()` сервис аудита не использует.
 *
 * @param resolveWith - результат, который эмулирует выполненный запрос
 * @returns proxy-цепочка с spy-методами
 */
function chain(resolveWith: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  // Свойство `then` живёт только в прокси: сам объект цепочки не thenable
  // (правило unicorn/no-thenable), а `await` получает результат запроса.
  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of ['from', 'where', 'orderBy', 'limit', 'values']) {
    link[method] = vi.fn(() => proxy);
  }

  return proxy;
}

/**
 * Ищет bind-параметр `expected` во вложенных чанках SQL-условия Drizzle.
 *
 * Мок Drizzle не исполняет SQL, поэтому проверяются внутренние чанки `SQL`:
 * `eq(column, value)` кладёт значение в `Param.value`, а сырая вставка строки в
 * `sql`-шаблон (например, `cursor.createdAt`) попадает в чанки как примитив
 * (при сборке запроса он тоже становится bind-параметром — см.
 * `buildQueryFromSourceParams`). Так тест доказывает, что фильтр по
 * организации/курсору действительно попал в WHERE.
 *
 * @param sql - SQL-условие (или любой вложенный чанк)
 * @param expected - значение, которое обязано быть в SQL
 * @param depth - текущая глубина рекурсии (защита от циклов)
 * @returns `true`, если значение найдено среди параметров условия
 */
function sqlContainsValue(sql: unknown, expected: unknown, depth = 0): boolean {
  if (depth > 30) {
    return false;
  }

  // Значение найдено: либо параметр (Param.value), либо сырой чанк-строка.
  if (sql === expected) {
    return true;
  }

  if (sql === null || typeof sql !== 'object') {
    return false;
  }

  const node = sql as { value?: unknown; queryChunks?: unknown[] };

  if ('value' in node && node.value === expected) {
    return true;
  }

  return (
    Array.isArray(node.queryChunks) &&
    node.queryChunks.some((chunk) => sqlContainsValue(chunk, expected, depth + 1))
  );
}

/**
 * Собирает SQL-условия, переданные в `where` тестовой цепочки Drizzle.
 *
 * @param target - цепочка-заглушка Drizzle
 * @returns аргументы всех вызовов `where`
 */
function whereConditions(
  target: Record<string, ReturnType<typeof vi.fn>>,
): unknown[] {
  return target.where.mock.calls.map((call) => call[0] as unknown);
}

describe('AuditService', () => {
  let service: AuditService;
  let selectChain: ReturnType<typeof chain>;
  let insertChain: ReturnType<typeof chain>;
  let db: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    selectChain = chain([]);
    insertChain = chain([ENTRY]);
    db = {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    service = moduleRef.get(AuditService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordAsync', () => {
    it('вставляет действие в audit_logs с автором и организацией', async () => {
      await service.recordAsync(ENTRY);

      expect(db.insert).toHaveBeenCalledWith(auditLogs);
      expect(insertChain.values).toHaveBeenCalledTimes(1);
      expect(insertChain.values).toHaveBeenCalledWith({
        userId: USER_ID,
        organizationId: ORG_ID,
        action: 'workflow.create',
        resourceId: RESOURCE_ID,
        metadata: METADATA,
      });
    });

    it('пишет null-resourceId (действие без ресурса)', async () => {
      await service.recordAsync({ ...ENTRY, resourceId: null });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: null }),
      );
    });

    it('пробрасывает сбой INSERT наверх (обработка — в интерсепторе)', async () => {
      insertChain.values.mockImplementation(() =>
        Promise.reject(new Error('БД недоступна')),
      );

      await expect(service.recordAsync(ENTRY)).rejects.toThrow('БД недоступна');
    });
  });

  describe('listAsync', () => {
    /** Строка `users` с организацией актора (результат резолва org). */
    type ActorRow = { organizationId: string };

    /** Цепочки очередных SELECT'ов: users → count → страница. */
    let chains: ReturnType<typeof chain>[];

    /** Фильтр `from` — начало суток UTC (как отдаёт `AuditQuerySchema`). */
    const FROM = new Date('2026-11-01T00:00:00.000Z');
    /** Фильтр `to` — конец суток UTC включительно. */
    const TO = new Date('2026-11-02T23:59:59.999Z');
    /** Код действия для фильтра. */
    const ACTION = 'workflow.create';

    /**
     * Настраивает `db.select` на последовательность ответов.
     *
     * `listAsync` делает три SELECT'а: организацию актора из `users`,
     * `count(*)` для total и страницу журнала. Первый ответ задаётся отдельно
     * (`actor`), остальные — по порядку; недостающие — пустые массивы.
     *
     * @param actor - строка `users` с `organization_id` либо `undefined`
     *   (пользователь не найден)
     * @param batches - результаты последовательных SELECT'ов журнала
     */
    function stubSelects(
      actor: ActorRow | undefined,
      ...batches: unknown[][]
    ): void {
      const results: unknown[][] = [
        actor === undefined ? [] : [actor],
        ...batches,
      ];

      chains = [];
      db.select.mockImplementation(() => {
        const next = chain(results.shift() ?? []);
        chains.push(next);

        return next;
      });
    }

    it('резолвит организацию из users по sub, а не из токена (KI-587)', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 1 }], [baseRow()]);

      await service.listAsync(USER_ID, 20);

      // Первый SELECT — users.organization_id по id пользователя.
      expect(chains[0].from).toHaveBeenCalledWith(users);
      expect(
        whereConditions(chains[0]).some((condition) =>
          sqlContainsValue(condition, USER_ID),
        ),
      ).toBe(true);
      expect(chains[0].limit).toHaveBeenCalledWith(1);

      // Найденная организация уходит в WHERE count и страницы.
      for (const chainIndex of [1, 2]) {
        expect(chains[chainIndex].from).toHaveBeenCalledWith(auditLogs);
        expect(
          whereConditions(chains[chainIndex]).some((condition) =>
            sqlContainsValue(condition, ORG_ID),
          ),
        ).toBe(true);
        // Чужая организация в WHERE не попадает.
        expect(
          whereConditions(chains[chainIndex]).some((condition) =>
            sqlContainsValue(condition, OTHER_ORG_ID),
          ),
        ).toBe(false);
      }
    });

    it('удалённый из организации участник не видит журнал старой организации (KI-601)', async () => {
      // После удаления пользователь переехал в новую личную организацию:
      // строка users уже содержит новый organization_id. Устаревший orgId
      // в access-токене в сервис вообще не передаётся.
      stubSelects({ organizationId: OTHER_ORG_ID }, [{ total: 0 }], []);

      const result = await service.listAsync(USER_ID, 20);

      expect(result).toEqual({ logs: [], nextCursor: null, total: 0 });
      for (const chainIndex of [1, 2]) {
        const conditions = whereConditions(chains[chainIndex]);

        expect(
          conditions.some((condition) => sqlContainsValue(condition, OTHER_ORG_ID)),
        ).toBe(true);
        // Старая организация (ORG_ID) не должна попасть в SQL ни одним путём.
        expect(
          conditions.some((condition) => sqlContainsValue(condition, ORG_ID)),
        ).toBe(false);
      }
    });

    it('нет строки users — 401 и ни одного запроса к audit_logs', async () => {
      stubSelects(undefined);

      await expect(service.listAsync(USER_ID, 20)).rejects.toThrow(
        UnauthorizedException,
      );

      // Резолв организации — единственный SELECT; журнал не читался.
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('применяет фильтры action/userId/from/to и в count, и в странице', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 1 }], [baseRow()]);

      await service.listAsync(USER_ID, 20, undefined, {
        action: ACTION,
        userId: AUTHOR_ID,
        from: FROM,
        to: TO,
      });

      for (const chainIndex of [1, 2]) {
        const conditions = whereConditions(chains[chainIndex]);

        // total считается по тому же предикату, что страница (KI-585/KI-571):
        // иначе счётчик «Показано N из M» показывал бы записи вне фильтра.
        for (const expected of [ORG_ID, ACTION, AUTHOR_ID, FROM, TO]) {
          expect(
            conditions.some((condition) =>
              sqlContainsValue(condition, expected),
            ),
            `фильтр ${String(expected)} не попал в WHERE (chain ${chainIndex})`,
          ).toBe(true);
        }
      }
    });

    it('без фильтров не добавляет условий по действию и автору', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 0 }], []);

      await service.listAsync(USER_ID, 20);

      for (const chainIndex of [1, 2]) {
        const conditions = whereConditions(chains[chainIndex]);

        expect(
          conditions.some((condition) => sqlContainsValue(condition, ACTION)),
        ).toBe(false);
        expect(
          conditions.some((condition) => sqlContainsValue(condition, AUTHOR_ID)),
        ).toBe(false);
      }
    });

    it('возвращает страницу: порядок, limit + 1 и total', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 1 }], [baseRow()]);

      const result = await service.listAsync(USER_ID, 20);

      expect(chains[2].orderBy).toHaveBeenCalled();
      // +1 строка — сервер сам определяет «есть ли ещё», не полагаясь на total.
      expect(chains[2].limit).toHaveBeenCalledWith(21);
      expect(result.total).toBe(1);
      expect(result.nextCursor).toBeNull();
    });

    it('маппит строку в AuditLogSummary с курсором из µs-точности', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 1 }], [baseRow()]);

      const result = await service.listAsync(USER_ID, 20);

      expect(result.logs).toEqual([
        {
          id: LOG_ID,
          // Курсор — из SQL (µs), а не из JS Date (мс): иначе tie-break по id
          // мог бы пропускать записи, сделанные в одну миллисекунду.
          cursor: encodeAuditCursor({
            createdAt: '2024-01-01T00:00:00.000123Z',
            id: LOG_ID,
          }),
          createdAt: CREATED_AT,
          userId: USER_ID,
          organizationId: ORG_ID,
          action: 'workflow.create',
          resourceId: RESOURCE_ID,
          metadata: METADATA,
        },
      ]);
    });

    it('возвращает nextCursor, когда строк больше limit (limit + 1)', async () => {
      stubSelects(
        { organizationId: ORG_ID },
        [{ total: 3 }],
        [
          baseRow({ id: LOG_ID }),
          baseRow({
            id: LOG_ID_2,
            cursorCreatedAt: '2024-01-01T00:00:00.000456Z',
          }),
          // «Лишняя» строка: доказывает, что есть следующая страница.
          baseRow({ id: LOG_ID_3 }),
        ],
      );

      const result = await service.listAsync(USER_ID, 2);

      expect(result.logs).toHaveLength(2);
      expect(result.nextCursor).toBe(
        encodeAuditCursor({
          createdAt: '2024-01-01T00:00:00.000456Z',
          id: LOG_ID_2,
        }),
      );
      expect(chains[2].limit).toHaveBeenCalledWith(3);
      // Курсор последнего элемента страницы совпадает с nextCursor.
      expect(result.logs[1]?.cursor).toBe(result.nextCursor);
    });

    it('ровно limit строк — nextCursor=null (страница последняя)', async () => {
      stubSelects(
        { organizationId: ORG_ID },
        [{ total: 2 }],
        [baseRow(), baseRow({ id: LOG_ID_2 })],
      );

      const result = await service.listAsync(USER_ID, 2);

      expect(result.logs).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
      // Запрос всё равно берёт limit + 1: 2 строки вместо 3 — больше нет.
      expect(chains[2].limit).toHaveBeenCalledWith(3);
    });

    it('пустая страница отдаёт total и не падает', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 7 }], []);

      const result = await service.listAsync(USER_ID, 20, {
        createdAt: '2024-01-01T00:00:00.000000Z',
        id: LOG_ID_2,
      });

      expect(result).toEqual({ logs: [], nextCursor: null, total: 7 });
      expect(db.select).toHaveBeenCalledTimes(3);
      // На пустой странице WHERE всё равно содержит фильтр организации.
      expect(
        whereConditions(chains[2]).some((condition) =>
          sqlContainsValue(condition, ORG_ID),
        ),
      ).toBe(true);
    });

    it('применяет keyset-условие курсора к странице (createdAt + id)', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 1 }], []);

      const cursor = {
        createdAt: '2024-01-01T00:00:00.000456Z',
        id: LOG_ID_2,
      };

      await service.listAsync(USER_ID, 20, cursor);

      const pageConditions = whereConditions(chains[2]);

      // µs-время курсора и вторичный ключ id доехали до SQL страницы.
      expect(
        pageConditions.some((condition) =>
          sqlContainsValue(condition, cursor.createdAt),
        ),
      ).toBe(true);
      expect(
        pageConditions.some((condition) =>
          sqlContainsValue(condition, cursor.id),
        ),
      ).toBe(true);
      // count(*) — по всей организации, курсор на него не влияет.
      expect(
        whereConditions(chains[1]).some((condition) =>
          sqlContainsValue(condition, cursor.createdAt),
        ),
      ).toBe(false);
    });

    it('невалидная дата курсора — 400, а не молчаливый пустой результат', async () => {
      await expect(
        service.listAsync(USER_ID, 20, {
          createdAt: '2026-13-40T00:00:00.000000Z',
          id: LOG_ID,
        }),
      ).rejects.toThrow(BadRequestException);

      // Курсор проверен до запросов — в БД не ходим.
      expect(db.select).not.toHaveBeenCalled();
    });

    it('ограничивает limit сверху (вторая граница после Zod)', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 0 }], []);

      await service.listAsync(USER_ID, 10_000);

      expect(chains[2].limit).toHaveBeenCalledWith(101);
    });

    it('приводит limit снизу к 1 (SQL с LIMIT 0 вернул бы пусто)', async () => {
      stubSelects({ organizationId: ORG_ID }, [{ total: 0 }], []);

      await service.listAsync(USER_ID, 0);

      expect(chains[2].limit).toHaveBeenCalledWith(2);
    });
  });
});
