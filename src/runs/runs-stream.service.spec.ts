import type { MessageEvent } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Observable } from 'rxjs';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { NodeRun } from '../db/schema.js';
import { RunEventsService } from './run-events.service.js';
import { RunsService, type RunResponse } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';
import type { RunEventDto, RunStreamMessage } from './dto/index.js';

const RUN_ID = '22222222-2222-4222-8222-222222222222';
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

const runResponse: RunResponse = {
  id: RUN_ID,
  workflowId: WORKFLOW_ID,
  status: 'running',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
};

/**
 * Создаёт строку `node_runs` для заглушки БД.
 *
 * @param overrides - поля, которые нужно переопределить
 * @returns строка таблицы `node_runs`
 */
function nodeRun(overrides: Partial<NodeRun> = {}): NodeRun {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    runId: RUN_ID,
    nodeId: 'A',
    nodeType: 'text',
    status: 'completed',
    inputs: {},
    outputs: { text: 'привет' },
    error: null,
    logs: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    durationMs: 5,
    startedAt: new Date('2024-01-01T00:00:01.000Z'),
    finishedAt: new Date('2024-01-01T00:00:01.005Z'),
    ...overrides,
  };
}

/**
 * Создаёт заглушку Drizzle, отдающую фиксированный список строк `node_runs`.
 *
 * @param rows - строки, которые вернёт запрос
 * @returns заглушка соединения с БД
 */
function dbStub(rows: NodeRun[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as unknown as Database;
}

/** Пустая подписка: генератор сразу завершается, событий нет. */
const emptyEvents: AsyncIterable<RunEventDto> = {
  [Symbol.asyncIterator]: () => ({
    next: (): Promise<IteratorResult<RunEventDto>> =>
      Promise.resolve({ done: true, value: undefined }),
  }),
};

/**
 * Создаёт подписку, которая молчит, пока сигнал не будет аборчен.
 *
 * @param signal - сигнал отмены
 * @param onCleanup - вызывается при закрытии итератора
 * @returns асинхронный итератор событий
 */
function hangingEvents(
  signal: AbortSignal | undefined,
  onCleanup: () => void,
): AsyncIterable<RunEventDto> {
  const aborted = new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();

      return;
    }

    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
  let cleaned = false;

  return {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<RunEventDto>> => {
        await aborted;

        return { done: true, value: undefined };
      },
      return: async (): Promise<IteratorResult<RunEventDto>> => {
        if (!cleaned) {
          cleaned = true;
          onCleanup();
        }

        return { done: true, value: undefined };
      },
    }),
  };
}

/**
 * Собирает все сообщения потока до его завершения.
 *
 * @param stream - поток SSE-сообщений
 * @returns массив полученных сообщений
 */
function collectAsync(stream: Observable<MessageEvent>): Promise<MessageEvent[]> {
  return new Promise((resolve, reject) => {
    const messages: MessageEvent[] = [];

    stream.subscribe({
      next: (message) => messages.push(message),
      error: (error: unknown) => reject(error),
      complete: () => resolve(messages),
    });
  });
}

/**
 * Достаёт payload'ы сообщений (Nest принимает объект в `data`).
 *
 * @param messages - сообщения потока
 * @returns сообщения потока как типизированные объекты
 */
function payloads(messages: MessageEvent[]): RunStreamMessage[] {
  return messages.map((message) => message.data as RunStreamMessage);
}

describe('RunsStreamService', () => {
  /**
   * Собирает сервис на заглушках.
   *
   * @param options - строки `node_runs`, подписка и поведение `getRunAsync`
   * @returns сервис и его заглушки
   */
  async function createService(options: {
    rows?: NodeRun[];
    events?: { subscribeAsync: ReturnType<typeof vi.fn> };
    run?: RunResponse | null;
  }): Promise<{
    service: RunsStreamService;
    runs: { getRunAsync: ReturnType<typeof vi.fn> };
    events: { subscribeAsync: ReturnType<typeof vi.fn> };
  }> {
    const runs = {
      getRunAsync: vi.fn(() =>
        options.run === null
          ? Promise.reject(new NotFoundException('Запуск не найден'))
          : Promise.resolve(options.run ?? runResponse),
      ),
    };
    const events = options.events ?? {
      subscribeAsync: vi.fn(() => emptyEvents),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunsStreamService,
        { provide: RunsService, useValue: runs },
        { provide: RunEventsService, useValue: events },
        { provide: DRIZZLE, useValue: dbStub(options.rows ?? []) },
      ],
    }).compile();

    return { service: moduleRef.get(RunsStreamService), runs, events };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('отдаёт snapshot первым сообщением: запуск и строки node_runs', async () => {
    const { service } = await createService({ rows: [nodeRun()] });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );

    expect(messages).toHaveLength(1);
    expect(payloads(messages)[0]).toEqual({
      type: 'snapshot',
      run: {
        id: RUN_ID,
        workflowId: WORKFLOW_ID,
        status: 'running',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
      nodes: [
        {
          nodeId: 'A',
          nodeType: 'text',
          status: 'completed',
          inputs: {},
          outputs: { text: 'привет' },
          error: null,
          logs: null,
          tokensIn: null,
          tokensOut: null,
          costUsd: null,
          durationMs: 5,
          startedAt: '2024-01-01T00:00:01.000Z',
          finishedAt: '2024-01-01T00:00:01.005Z',
        },
      ],
    });
  });

  it('пробрасывает события после snapshot и замолкает на run_completed', async () => {
    const events: RunEventDto[] = [
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:01.000Z' },
      {
        type: 'node_completed',
        runId: RUN_ID,
        nodeId: 'A',
        outputs: { text: 'ok' },
        durationMs: 3,
        finishedAt: '2024-01-01T00:00:02.000Z',
      },
      {
        type: 'run_completed',
        runId: RUN_ID,
        status: 'completed',
        finishedAt: '2024-01-01T00:00:03.000Z',
      },
      // Событие «после» терминального: в поток попасть не должно.
      {
        type: 'node_started',
        runId: RUN_ID,
        nodeId: 'B',
        nodeType: 'llm',
        startedAt: '2024-01-01T00:00:04.000Z',
      },
    ];

    const { service } = await createService({
      rows: [],
      events: {
        subscribeAsync: vi.fn(async function* generate(): AsyncIterable<RunEventDto> {
          for (const event of events) {
            yield event;
          }
        }),
      },
    });

    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const types = payloads(messages).map((message) => message.type);

    expect(types).toEqual(['snapshot', 'run_started', 'node_completed', 'run_completed']);
  });

  it('не закрывает поток на run_completed(failed): запуск может быть переигран (KI-040)', async () => {
    const events: RunEventDto[] = [
      {
        type: 'run_completed',
        runId: RUN_ID,
        status: 'failed',
        finishedAt: '2024-01-01T00:00:03.000Z',
      },
      // Job-level retry (KI-040): новая попытка того же запуска.
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:05.000Z' },
      {
        type: 'run_completed',
        runId: RUN_ID,
        status: 'completed',
        finishedAt: '2024-01-01T00:00:06.000Z',
      },
    ];

    const { service } = await createService({
      rows: [],
      events: {
        subscribeAsync: vi.fn(async function* generate(): AsyncIterable<RunEventDto> {
          for (const event of events) {
            yield event;
          }
        }),
      },
    });

    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );

    expect(payloads(messages).map((message) => message.type)).toEqual([
      'snapshot',
      'run_completed',
      'run_started',
      'run_completed',
    ]);
  });

  it('закрывает подписку при отмене сигнала', async () => {
    const controller = new AbortController();
    let markCleaned: (() => void) | undefined;
    const cleaned = new Promise<void>((resolve) => {
      markCleaned = resolve;
    });

    const { service } = await createService({
      rows: [],
      events: {
        subscribeAsync: vi.fn((_runId: string, signal?: AbortSignal) =>
          hangingEvents(signal, () => markCleaned?.()),
        ),
      },
    });

    const received: MessageEvent[] = [];
    let resolveFirst: ((message: MessageEvent) => void) | undefined;
    const firstMessage = new Promise<MessageEvent>((resolve) => {
      resolveFirst = resolve;
    });

    const subscription = service.streamAsync(RUN_ID, controller.signal).subscribe({
      next: (message) => {
        received.push(message);
        resolveFirst?.(message);
      },
    });

    // Снапшот приходит до первого события из Redis.
    await firstMessage;
    expect(payloads(received)).toHaveLength(1);

    // Клиент отключился — подписка должна закрыться.
    controller.abort();
    await cleaned;

    subscription.unsubscribe();
  });

  it('не отдаёт сообщений, если сигнал аборчен до подписки', async () => {
    const { service } = await createService({ rows: [nodeRun()] });
    const controller = new AbortController();

    controller.abort();

    const messages = await collectAsync(service.streamAsync(RUN_ID, controller.signal));

    expect(messages).toEqual([]);
  });

  it('проверяет существование запуска и пробрасывает ошибку в поток', async () => {
    const { service } = await createService({ run: null });

    await expect(service.assertRunExistsAsync(RUN_ID)).rejects.toThrow(
      NotFoundException,
    );

    await expect(
      collectAsync(service.streamAsync(RUN_ID, new AbortController().signal)),
    ).rejects.toThrow(NotFoundException);
  });
});
