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

/**
 * Собирает событие `run_completed` (KI-059).
 *
 * @param status - итоговый статус запуска
 * @param attemptsMade - сколько попыток уже сделал BullMQ
 * @param attempts - максимум попыток (null — лимит неизвестен)
 * @returns событие завершения запуска
 */
function completed(
  status: 'completed' | 'failed',
  attemptsMade: number,
  attempts: number | null,
): RunEventDto {
  return {
    type: 'run_completed',
    runId: RUN_ID,
    status,
    attemptsMade,
    attempts,
    finishedAt: '2024-01-01T00:00:03.000Z',
  };
}

/**
 * Отдаёт события и «висит» дальше — как реальная подписка на Redis, которая не
 * завершается сама. Так тесты доказывают, что поток закрылся именно по правилу
 * финальности (KI-059), а не потому что закончился генератор.
 *
 * @param events - события, которые нужно отдать
 * @returns асинхронный итератор событий
 */
function eventsThenHang(events: RunEventDto[]): AsyncIterable<RunEventDto> {
  let index = 0;

  return {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<RunEventDto>> => {
        if (index < events.length) {
          const value = events[index];

          index += 1;

          return Promise.resolve({ done: false, value });
        }

        return new Promise<IteratorResult<RunEventDto>>(() => {
          // Событий больше нет: подписка ждёт новые, не завершаясь.
        });
      },
    }),
  };
}

/**
 * Ждёт завершения потока, падая по таймауту (защита от «вечного» потока).
 *
 * @param stream - поток SSE-сообщений
 * @param timeoutMs - сколько ждать завершения
 * @returns полученные сообщения
 */
function collectWithTimeout(
  stream: Observable<MessageEvent>,
  timeoutMs = 2000,
): Promise<MessageEvent[]> {
  return Promise.race([
    collectAsync(stream),
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('поток не закрылся за отведённое время')),
        timeoutMs,
      );

      timer.unref();
    }),
  ]);
}

/**
 * Даёт потоку доставить уже готовые сообщения (дренаж микротасок + таймер).
 *
 * @returns промис без значения
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 10);
  });
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

  it('пробрасывает события после snapshot и закрывается на run_completed(completed)', async () => {
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
      completed('completed', 0, 3),
      // Событие «после» финального: в поток попасть не должно.
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
      // Подписка сама не завершается: поток обязан закрыться по финальному событию.
      events: { subscribeAsync: vi.fn(() => eventsThenHang(events)) },
    });

    const messages = await collectWithTimeout(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const types = payloads(messages).map((message) => message.type);

    expect(types).toEqual(['snapshot', 'run_started', 'node_completed', 'run_completed']);
  });

  it('закрывается на run_completed(failed) с исчерпанными попытками (KI-059)', async () => {
    const { service } = await createService({
      rows: [],
      // attemptsMade = 2 при attempts = 3 — это последняя попытка.
      events: { subscribeAsync: vi.fn(() => eventsThenHang([completed('failed', 2, 3)])) },
    });

    const messages = await collectWithTimeout(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );

    expect(payloads(messages).map((message) => message.type)).toEqual([
      'snapshot',
      'run_completed',
    ]);
  });

  it('закрывается только на третьей из трёх попыток (KI-059)', async () => {
    const events: RunEventDto[] = [
      completed('failed', 0, 3),
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:05.000Z' },
      completed('failed', 1, 3),
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:08.000Z' },
      completed('failed', 2, 3),
    ];

    const { service } = await createService({
      rows: [],
      events: { subscribeAsync: vi.fn(() => eventsThenHang(events)) },
    });

    const messages = await collectWithTimeout(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const types = payloads(messages).map((message) => message.type);

    expect(types).toEqual([
      'snapshot',
      'run_completed',
      'run_started',
      'run_completed',
      'run_started',
      'run_completed',
    ]);
  });

  it('НЕ закрывается на промежуточном провале: будет retry (KI-059)', async () => {
    const { service } = await createService({
      rows: [],
      // Первая попытка из трёх провалилась — BullMQ ещё переиграет запуск.
      events: { subscribeAsync: vi.fn(() => eventsThenHang([completed('failed', 0, 3)])) },
    });

    const received: MessageEvent[] = [];
    let finished = false;
    const subscription = service
      .streamAsync(RUN_ID, new AbortController().signal)
      .subscribe({
        next: (message) => received.push(message),
        complete: () => {
          finished = true;
        },
      });

    await settle();

    expect(payloads(received).map((message) => message.type)).toEqual([
      'snapshot',
      'run_completed',
    ]);
    // Поток остаётся открытым: клиент ждёт новую попытку того же runId (KI-040).
    expect(finished).toBe(false);

    subscription.unsubscribe();
  });

  it('НЕ закрывается при неизвестном лимите попыток (attempts = null, KI-059)', async () => {
    const { service } = await createService({
      rows: [],
      events: { subscribeAsync: vi.fn(() => eventsThenHang([completed('failed', 7, null)])) },
    });

    const received: MessageEvent[] = [];
    let finished = false;
    const subscription = service
      .streamAsync(RUN_ID, new AbortController().signal)
      .subscribe({
        next: (message) => received.push(message),
        complete: () => {
          finished = true;
        },
      });

    await settle();

    expect(payloads(received).map((message) => message.type)).toEqual([
      'snapshot',
      'run_completed',
    ]);
    // Лимит неизвестен — консервативно ждём возможный retry.
    expect(finished).toBe(false);

    subscription.unsubscribe();
  });

  it('показывает retry того же запуска и закрывается на успешной попытке (KI-040)', async () => {
    const events: RunEventDto[] = [
      // Первая попытка провалилась, но лимит не исчерпан…
      completed('failed', 0, 3),
      // …поэтому job-level retry публикует новую попытку того же запуска.
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:05.000Z' },
      completed('completed', 1, 3),
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
