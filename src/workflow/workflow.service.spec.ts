import { Test } from '@nestjs/testing';
import { Param } from 'drizzle-orm';
import type { Database } from '../db/db.module.js';
import { DRIZZLE } from '../db/db.module.js';
import { workflows, type Workflow } from '../db/schema.js';
import { WorkflowService } from './workflow.service.js';

/** Стабильный uuid для тестовых данных. */
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

const baseWorkflow: Workflow = {
  id: WORKFLOW_ID,
  userId: 'user-1',
  name: 'My workflow',
  description: null,
  nodes: [],
  edges: [],
  version: 1,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * Каждый метод (`from`/`where`/`orderBy`/`limit`/`offset`) возвращает саму
 * цепочку, а значение, которое вернёт запрос при `await`, задаётся через
 * `resolveWith`. Дополнительно доступен терминальный `returning()`, который
 * возвращает массив строк как настоящий Drizzle.
 */
function chain(resolveWith: () => unknown) {
  const link = {} as Record<string, ReturnType<typeof vi.fn>>;

  // Настоящий Drizzle query builder — thenable, поэтому цепочку можно
  // дожидаться через await. Свойство `then` живёт только в прокси, чтобы не
  // заводить его в самом объекте цепочки (правило unicorn/no-thenable).
  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith());
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of [
    'values',
    'from',
    'set',
    'where',
    'orderBy',
    'limit',
    'offset',
  ]) {
    // Методы возвращают именно прокси, иначе await получит обычный объект.
    link[method] = vi.fn(() => proxy);
  }

  link.returning = vi.fn(() => resolveWith());

  return proxy as Record<string, ReturnType<typeof vi.fn>>;
}

/** Извлекает имя таблицы из PgTable (Drizzle хранит его в Symbol(drizzle:Name)). */
function tableName(table: unknown): string {
  for (const symbol of Object.getOwnPropertySymbols(table ?? {})) {
    const value = (table as Record<symbol, unknown>)[symbol];

    if (symbol.description === 'drizzle:Name' && typeof value === 'string') {
      return value;
    }
  }

  return '';
}

/**
 * Рендерит условие Drizzle (`eq`/`and`/`desc`) в SQL-подобную строку.
 *
 * Drizzle отдаёт не готовый SQL, а дерево `queryChunks` с колонками, `Param`
 * и текстовыми чанками, поэтому собираем строку вручную — так тест проверяет
 * именно то, что уйдёт в базу.
 */
function renderSQL(node: unknown): string {
  if (Array.isArray(node)) {
    return node.map(renderSQL).join('');
  }

  if (!node || typeof node !== 'object') {
    return String(node);
  }

  const wrapper = node as { name?: unknown; table?: unknown; queryChunks?: unknown[] };

  // Колонка: у чанка есть имя и таблица.
  if (typeof wrapper.name === 'string' && wrapper.table) {
    return `"${tableName(wrapper.table)}"."${wrapper.name}"`;
  }

  // Param оборачивает значение параметра запроса.
  if (node instanceof Param) {
    return String(node.value);
  }

  // SQL-обёртка или StringChunk: рендерим вложенные чанки.
  if (Array.isArray(wrapper.queryChunks)) {
    return wrapper.queryChunks.map(renderSQL).join(' ').replace(/\s+/g, ' ');
  }

  const value = (node as { value?: unknown }).value;

  if (value === undefined) {
    return '';
  }

  // StringChunk хранит свой текст либо строкой, либо массивом частей.
  return Array.isArray(value)
    ? value.map(renderSQL).join('')
    : typeof value === 'string'
      ? value
      : '';
}

/** Собирает значения `Param` из дерева чанков Drizzle. */
function paramsOf(node: unknown): unknown[] {
  if (Array.isArray(node)) {
    return node.flatMap(paramsOf);
  }

  if (!node || typeof node !== 'object') {
    return [];
  }

  if (node instanceof Param) {
    return [node.value];
  }

  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;

  return Array.isArray(chunks) ? chunks.flatMap(paramsOf) : [];
}

/** Возвращает SQL-строку условия WHERE, переданного в мок. */
function whereSQL(spy: ReturnType<typeof vi.fn>, call = 0): string {
  return renderSQL(spy.mock.calls[call][0]).trim();
}

/** Возвращает значения параметров условия WHERE, переданного в мок. */
function whereParams(spy: ReturnType<typeof vi.fn>, call = 0): unknown[] {
  return paramsOf(spy.mock.calls[call][0]);
}

describe('WorkflowService', () => {
  let service: WorkflowService;
  let insertChain: ReturnType<typeof chain>;
  let selectChain: ReturnType<typeof chain>;
  let updateChain: ReturnType<typeof chain>;
  let deleteChain: ReturnType<typeof chain>;
  let db: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    insertChain = chain(() => [baseWorkflow]);
    selectChain = chain(() => [baseWorkflow]);
    updateChain = chain(() => [baseWorkflow]);
    deleteChain = chain(() => [{ id: WORKFLOW_ID }]);

    db = {
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    service = moduleRef.get(WorkflowService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createAsync', () => {
    it('вставляет запись через Drizzle и возвращает созданный workflow', async () => {
      const dto = { userId: 'user-1', name: 'My workflow', nodes: [], edges: [] };

      const result = await service.createAsync(dto);

      expect(db.insert).toHaveBeenCalledWith(workflows);
      expect(insertChain.values).toHaveBeenCalledWith({
        userId: 'user-1',
        name: 'My workflow',
        description: undefined,
        nodes: [],
        edges: [],
      });
      expect(insertChain.returning).toHaveBeenCalled();
      expect(result).toEqual(baseWorkflow);
    });

    it('прокидывает description, nodes и edges без изменений', async () => {
      const nodes = [{ id: 'n1', type: 'llm' }];
      const edges = [{ from: 'n1', to: 'n2' }];

      await service.createAsync({
        userId: 'user-2',
        name: 'Graph',
        description: 'описание',
        nodes,
        edges,
      });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'описание',
          nodes,
          edges,
        }),
      );
    });
  });

  describe('findAllAsync', () => {
    it('без userId не применяет фильтр по владельцу', async () => {
      const result = await service.findAllAsync();

      expect(db.select).toHaveBeenCalledTimes(1);
      expect(selectChain.from).toHaveBeenCalledWith(workflows);
      expect(selectChain.where).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([baseWorkflow]);
    });

    it('с userId фильтрует по владельцу', async () => {
      await service.findAllAsync('user-1');

      expect(whereSQL(selectChain.where)).toContain('"workflows"."user_id" = user-1');
      expect(whereParams(selectChain.where)).toEqual(['user-1']);
    });

    it('сортирует по createdAt по убыванию', async () => {
      await service.findAllAsync();

      const orderBySQL = renderSQL(selectChain.orderBy.mock.calls[0][0]);

      expect(orderBySQL).toContain('"workflows"."created_at"');
      expect(orderBySQL).toContain('desc');
    });

    it('применяет limit и offset', async () => {
      await service.findAllAsync('user-1', 5, 10);

      expect(selectChain.limit).toHaveBeenCalledWith(5);
      expect(selectChain.offset).toHaveBeenCalledWith(10);
    });

    it('использует значения limit/offset по умолчанию (50 и 0)', async () => {
      await service.findAllAsync();

      expect(selectChain.limit).toHaveBeenCalledWith(50);
      expect(selectChain.offset).toHaveBeenCalledWith(0);
    });
  });

  describe('findOneAsync', () => {
    it('возвращает workflow, найденный по id', async () => {
      const result = await service.findOneAsync(WORKFLOW_ID);

      expect(db.select).toHaveBeenCalledTimes(1);
      expect(selectChain.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual(baseWorkflow);
    });

    it('возвращает null, если запись не найдена', async () => {
      selectChain.limit.mockImplementation(() => []);

      const result = await service.findOneAsync(WORKFLOW_ID);

      expect(result).toBeNull();
    });

    it('с userId добавляет проверку принадлежности', async () => {
      await service.findOneAsync(WORKFLOW_ID, 'user-1');

      expect(whereSQL(selectChain.where)).toContain(`"workflows"."id" = ${WORKFLOW_ID}`);
      expect(whereSQL(selectChain.where)).toContain('"workflows"."user_id" = user-1');
      expect(whereParams(selectChain.where)).toEqual([WORKFLOW_ID, 'user-1']);
    });
  });

  describe('updateAsync', () => {
    it('обновляет запись и возвращает результат', async () => {
      const result = await service.updateAsync(WORKFLOW_ID, { name: 'Updated' });

      expect(db.update).toHaveBeenCalledWith(workflows);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated' }),
      );
      expect(updateChain.where).toHaveBeenCalled();
      expect(updateChain.returning).toHaveBeenCalled();
      expect(result).toEqual(baseWorkflow);
    });

    it('проставляет свежий updatedAt', async () => {
      const before = Date.now();

      await service.updateAsync(WORKFLOW_ID, { name: 'Updated' });

      const setArg = updateChain.set.mock.calls[0][0] as { updatedAt: Date };

      expect(setArg.updatedAt).toBeInstanceOf(Date);
      expect(setArg.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(setArg.updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('с userId учитывает принадлежность при обновлении', async () => {
      await service.updateAsync(WORKFLOW_ID, { name: 'Updated' }, 'user-1');

      expect(whereSQL(updateChain.where)).toContain('"workflows"."user_id" = user-1');
    });

    it('возвращает null, если запись не найдена', async () => {
      updateChain.returning.mockImplementation(() => []);

      const result = await service.updateAsync(WORKFLOW_ID, { name: 'Updated' });

      expect(result).toBeNull();
    });

    it('бросает BadRequestException при пустом DTO (defense in depth)', async () => {
      // Через HTTP сюда пустой объект уже не доедет: его отклонит
      // UpdateWorkflowSchema.refine() в ZodValidationPipe. Проверка в сервисе
      // остаётся как страховка на случай прямого вызова сервиса.
      await expect(service.updateAsync(WORKFLOW_ID, {})).rejects.toThrow(
        'Не передано ни одного поля для обновления',
      );
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('removeAsync', () => {
    it('возвращает true, когда запись удалена', async () => {
      const result = await service.removeAsync(WORKFLOW_ID);

      expect(db.delete).toHaveBeenCalledWith(workflows);
      expect(deleteChain.where).toHaveBeenCalled();
      expect(deleteChain.returning).toHaveBeenCalledWith({ id: workflows.id });
      expect(result).toBe(true);
    });

    it('с userId учитывает принадлежность при удалении', async () => {
      await service.removeAsync(WORKFLOW_ID, 'user-1');

      expect(whereSQL(deleteChain.where)).toContain('"workflows"."user_id" = user-1');
      expect(whereParams(deleteChain.where)).toEqual([WORKFLOW_ID, 'user-1']);
    });

    it('возвращает false, если ничего не удалено', async () => {
      deleteChain.returning.mockImplementation(() => []);

      const result = await service.removeAsync(WORKFLOW_ID);

      expect(result).toBe(false);
    });
  });
});
