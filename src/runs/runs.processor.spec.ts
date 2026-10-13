import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { workflowRuns } from '../db/schema.js';
import { ExecutionEngineService } from '../engine/execution-engine.service.js';
import type { ExecuteRunJobDto } from './dto/index.js';
import { RunsProcessor } from './runs.processor.js';

/** Стабильный uuid запуска. */
const RUN_ID = '22222222-2222-4222-8222-222222222222';

/** Валидный снимок графа из одной ноды. */
const snapshot = {
  nodes: [{ id: 'A', type: 'text', data: { value: 'x' } }],
  edges: [],
};

/**
 * Создаёт цепочку-заглушку Drizzle query builder.
 *
 * Каждый метод возвращает саму цепочку (её можно дожидаться через `await`),
 * значение для `await` задаётся через `resolveWith`; терминальный `returning()`
 * возвращает массив строк, как настоящий Drizzle.
 *
 * @param resolveWith - значение, которое получит `await` цепочки
 * @returns прокси-chain с методами-моками
 */
function chain(resolveWith: unknown): Record<string, ReturnType<typeof vi.fn>> {
  const link: Record<string, ReturnType<typeof vi.fn>> = {};

  // Свойство `then` живёт только в прокси, чтобы не заводить thenable
  // в самом объекте цепочки (правило unicorn/no-thenable).
  const proxy = new Proxy(link, {
    get: (target, property, receiver) => {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown) => resolve(resolveWith);
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  for (const method of ['from', 'where', 'limit', 'values', 'set']) {
    link[method] = vi.fn(() => proxy);
  }

  link.returning = vi.fn(() => resolveWith);

  return proxy;
}

/**
 * Оборачивает данные в минимальный объект задания BullMQ.
 *
 * @param data - payload задания
 * @returns задание с `data` (остальные поля не нужны обработчику)
 */
function job(data: unknown): Job<ExecuteRunJobDto> {
  return { id: 'job-1', data } as unknown as Job<ExecuteRunJobDto>;
}

describe('RunsProcessor', () => {
  let processor: RunsProcessor;
  let selectChain: ReturnType<typeof chain>;
  let updateChain: ReturnType<typeof chain>;
  let db: Record<string, ReturnType<typeof vi.fn>>;
  let executor: { executeAsync: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    selectChain = chain([{ status: 'pending', snapshot }]);
    updateChain = chain([{ id: RUN_ID }]);

    db = {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    };

    executor = {
      executeAsync: vi.fn(() =>
        Promise.resolve({
          status: 'completed',
          executedNodes: 1,
          failedNodeId: null,
          error: null,
          outputs: {},
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunsProcessor,
        { provide: DRIZZLE, useValue: db as unknown as Database },
        { provide: ExecutionEngineService, useValue: executor },
      ],
    }).compile();

    processor = moduleRef.get(RunsProcessor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('делегирует выполнение executor-сервису с валидированным снимком графа', async () => {
    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(selectChain.from).toHaveBeenCalledWith(workflowRuns);
    expect(executor.executeAsync).toHaveBeenCalledWith(RUN_ID, {
      nodes: [{ id: 'A', type: 'text', data: { value: 'x' } }],
      edges: [],
    });
  });

  it('помечает запуск failed и бросает при битом snapshot', async () => {
    selectChain.limit.mockImplementation(() => [
      { status: 'pending', snapshot: { nodes: 'не-массив' } },
    ]);

    await expect(processor.process(job({ runId: RUN_ID }))).rejects.toThrow(
      'Некорректный snapshot',
    );

    expect(executor.executeAsync).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledWith(workflowRuns);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('пропускает задание, если запуск уже не pending (идемпотентность)', async () => {
    selectChain.limit.mockImplementation(() => [{ status: 'completed', snapshot }]);

    await expect(processor.process(job({ runId: RUN_ID }))).resolves.toBeUndefined();

    expect(executor.executeAsync).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('бросает, если запуск не найден', async () => {
    selectChain.limit.mockImplementation(() => []);

    await expect(processor.process(job({ runId: RUN_ID }))).rejects.toThrow(
      `Запуск ${RUN_ID} не найден`,
    );
    expect(executor.executeAsync).not.toHaveBeenCalled();
  });

  it('пробрасывает ошибку executor-сервиса, не гася стек', async () => {
    const failure = new Error('граф упал');

    executor.executeAsync.mockRejectedValue(failure);

    await expect(processor.process(job({ runId: RUN_ID }))).rejects.toBe(failure);
  });

  it('отклоняет задание с невалидным payload', async () => {
    await expect(processor.process(job({ runId: 'не-uuid' }))).rejects.toThrow(
      'Некорректный payload',
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});
