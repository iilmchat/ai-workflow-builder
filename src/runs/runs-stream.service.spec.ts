import type { MessageEvent } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Observable } from 'rxjs';
import { DRIZZLE, type Database } from '../db/db.module.js';
import type { NodeRun, WorkflowRun } from '../db/schema.js';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from '../media/media-storage.service.js';
import { buildSignedMediaPath } from '../media/media-url-signer.js';
import { RunEventsService } from './run-events.service.js';
import { RunsService } from './runs.service.js';
import { RunsStreamService } from './runs-stream.service.js';
import type { RunEventDto, RunStreamMessage } from './dto/index.js';

const RUN_ID = '22222222-2222-4222-8222-222222222222';
const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Строка `workflow_runs` — снимок читает её целиком (KI-347).
 *
 * Остальные колонки нужны только для типизации `WorkflowRun`: снимок берёт из
 * строки `id`, `workflowId`, `status`, `createdAt` и `error`.
 */
const runRow: WorkflowRun = {
  id: RUN_ID,
  workflowId: WORKFLOW_ID,
  status: 'running',
  inputs: {},
  outputs: {},
  error: null,
  snapshot: { nodes: [], edges: [] },
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  startedAt: new Date('2024-01-01T00:00:00.000Z'),
  finishedAt: null,
  // v0.11 S1 (KI-066): аренда запуска; в тестовом снимке не используется.
  leaseExpiresAt: null,
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
    costRub: null,
    // R7.7/R7.8: кэш-токены и своя ссылка на media — колонки, которых у
    // старых строк не было; в заглушке они `null`, как в БД без значения.
    durationMs: 5,
    startedAt: new Date('2024-01-01T00:00:01.000Z'),
    finishedAt: new Date('2024-01-01T00:00:01.005Z'),
    ...overrides,
    // R7.7: после спреда Partial<NodeRun> расширяет тип до `| undefined`.
    // Возвращаем к `number | null` / `string | null`, как объявлено в схеме.
    cacheReadTokens: overrides.cacheReadTokens ?? null,
    cacheCreationTokens: overrides.cacheCreationTokens ?? null,
    storedUrl: overrides.storedUrl ?? null,
    storedExpiresAt: overrides.storedExpiresAt ?? null,
    // KI-451: ключ хранилища — новая nullable-колонка; у старых строк его нет.
    storageKey: overrides.storageKey ?? null,
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
 * @param final - признак финальности (KI-060): можно ли закрывать поток
 * @param attemptsMade - сколько попыток уже сделал BullMQ
 * @param attempts - максимум попыток (null — лимит неизвестен)
 * @returns событие завершения запуска
 */
function completed(
  status: 'completed' | 'failed',
  final: boolean,
  attemptsMade = 0,
  attempts: number | null = 3,
): RunEventDto {
  return {
    type: 'run_completed',
    runId: RUN_ID,
    status,
    attemptsMade,
    attempts,
    final,
    finishedAt: '2024-01-01T00:00:03.000Z',
  };
}

/**
 * Отдаёт события и «висит» дальше — как реальная подписка на Redis, которая не
 * завершается сама. Так тесты доказывают, что поток закрылся именно по признаку
 * финальности (KI-060), а не потому что закончился генератор.
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
   * @param options - строки `node_runs`, подписка и поведение `getRunRowAsync`
   * @returns сервис и его заглушки
   */
  async function createService(options: {
    rows?: NodeRun[];
    events?: { subscribeAsync: ReturnType<typeof vi.fn> };
    run?: WorkflowRun | null;
    storage?: Partial<IMediaStorage>;
  }): Promise<{
    service: RunsStreamService;
    runs: { getRunRowAsync: ReturnType<typeof vi.fn> };
    events: { subscribeAsync: ReturnType<typeof vi.fn> };
  }> {
    const runs = {
      getRunRowAsync: vi.fn(() =>
        options.run === null
          ? Promise.reject(new NotFoundException('Запуск не найден'))
          : Promise.resolve(options.run ?? runRow),
      ),
    };
    const events = options.events ?? {
      subscribeAsync: vi.fn(() => emptyEvents),
    };
    const storage = {
      backend: 'local' as const,
      uploadAsync: vi.fn(() => Promise.resolve(null)),
      openAsync: vi.fn(() => Promise.resolve(null)),
      refreshStoredUrlAsync: vi.fn(() => Promise.resolve(null)),
      refreshStoredUrlByKeyAsync: vi.fn(() => Promise.resolve(null)),
      ...options.storage,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunsStreamService,
        { provide: RunsService, useValue: runs },
        { provide: RunEventsService, useValue: events },
        { provide: DRIZZLE, useValue: dbStub(options.rows ?? []) },
        // KI-443: снимок переподписывает просроченный stored_url.
        { provide: MEDIA_STORAGE, useValue: storage },
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
        // KI-347: у запуска без ошибки поле присутствует и равно null.
        error: null,
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
          costRub: null,
          // R7.7/R7.8: новые колонки присутствуют в снимке (null без данных).
          cacheReadTokens: null,
          cacheCreationTokens: null,
          cacheSavingsUsd: null,
          storedUrl: null,
          storedExpiresAt: null,
          durationMs: 5,
          startedAt: '2024-01-01T00:00:01.000Z',
          finishedAt: '2024-01-01T00:00:01.005Z',
        },
      ],
    });
  });

  it('KI-443: переподписывает просроченный stored_url и отдаёт новый срок', async () => {
    const oldUrl = 'https://s3.test/media/run-1/A.png?X-Amz-Signature=old';
    const freshUrl = 'https://s3.test/media/run-1/A.png?X-Amz-Signature=new';
    const freshExpiresAt = new Date(Date.now() + 3_600_000);
    const refreshStoredUrlAsync = vi.fn(() =>
      Promise.resolve({ storedUrl: freshUrl, storedExpiresAt: freshExpiresAt }),
    );

    const { service } = await createService({
      rows: [
        nodeRun({
          storedUrl: oldUrl,
          // Час назад ссылка была подписана и уже истекла.
          storedExpiresAt: new Date(Date.now() - 60_000),
        }),
      ],
      storage: { refreshStoredUrlAsync },
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      nodes: Array<{ storedUrl: string | null; storedExpiresAt: string | null }>;
    };

    expect(refreshStoredUrlAsync).toHaveBeenCalledWith(oldUrl);
    expect(snapshot.nodes[0]?.storedUrl).toBe(freshUrl);
    // Срок тоже обновлён: иначе UI счёл бы свежий URL истёкшим.
    expect(snapshot.nodes[0]?.storedExpiresAt).toBe(
      freshExpiresAt.toISOString(),
    );
  });

  it('KI-443: свежий stored_url не переподписывается', async () => {
    const refreshStoredUrlAsync = vi.fn(() => Promise.resolve(null));

    const { service } = await createService({
      rows: [
        nodeRun({
          storedUrl: 'https://s3.test/media/run-1/A.png?X-Amz-Signature=live',
          storedExpiresAt: new Date(Date.now() + 60_000),
        }),
      ],
      storage: { refreshStoredUrlAsync },
    });

    await collectAsync(service.streamAsync(RUN_ID, new AbortController().signal));

    expect(refreshStoredUrlAsync).not.toHaveBeenCalled();
  });

  it('KI-443: ошибка переподписи не ломает снимок — остаётся исходная ссылка', async () => {
    const oldUrl = 'https://s3.test/media/run-1/A.png?X-Amz-Signature=old';
    const { service } = await createService({
      rows: [
        nodeRun({
          storedUrl: oldUrl,
          storedExpiresAt: new Date(Date.now() - 60_000),
        }),
      ],
      storage: {
        refreshStoredUrlAsync: vi.fn(() =>
          Promise.reject(new Error('S3 connection refused')),
        ),
      },
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      nodes: Array<{ storedUrl: string | null }>;
    };

    // RULES 4.18: внешняя ошибка логируется, снимок отдаётся как есть.
    expect(snapshot.nodes[0]?.storedUrl).toBe(oldUrl);
  });

  it('KI-464: переподписывает по storage_key, а не разбирая URL', async () => {
    const oldUrl = 'https://s3.test/media/run-1/A.png?X-Amz-Signature=old';
    const freshUrl = 'https://s3.test/media/run-1/A.png?X-Amz-Signature=new';
    const freshExpiresAt = new Date(Date.now() + 3_600_000);
    const refreshStoredUrlByKeyAsync = vi.fn(() =>
      Promise.resolve({ storedUrl: freshUrl, storedExpiresAt: freshExpiresAt }),
    );
    const refreshStoredUrlAsync = vi.fn(() => Promise.resolve(null));

    const { service } = await createService({
      rows: [
        nodeRun({
          storedUrl: oldUrl,
          storedExpiresAt: new Date(Date.now() - 60_000),
          // v0.10 (KI-451): ключ пишется в БД, поэтому URL не парсится.
          storageKey: 'run-1/A.png',
        }),
      ],
      storage: { refreshStoredUrlByKeyAsync, refreshStoredUrlAsync },
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      nodes: Array<{ storedUrl: string | null; storedExpiresAt: string | null }>;
    };

    expect(refreshStoredUrlByKeyAsync).toHaveBeenCalledWith('run-1/A.png');
    expect(refreshStoredUrlAsync).not.toHaveBeenCalled();
    expect(snapshot.nodes[0]?.storedUrl).toBe(freshUrl);
  });

  it('KI-464: обновляет копию ссылки в outputs document_gen (кнопка «Скачать»)', async () => {
    const oldUrl = 'https://s3.test/doc/run-1/generated-A.docx?X-Amz-Signature=old';
    const freshUrl =
      'https://s3.test/doc/run-1/generated-A.docx?X-Amz-Signature=new';

    const { service } = await createService({
      rows: [
        nodeRun({
          nodeType: 'document_gen',
          outputs: {
            fileUrl: oldUrl,
            storedUrl: oldUrl,
            fileName: 'report.docx',
          },
          storedUrl: oldUrl,
          storedExpiresAt: new Date(Date.now() - 60_000),
          storageKey: 'run-1/generated-A.docx',
        }),
      ],
      storage: {
        refreshStoredUrlByKeyAsync: vi.fn(() =>
          Promise.resolve({
            storedUrl: freshUrl,
            storedExpiresAt: new Date(Date.now() + 3_600_000),
          }),
        ),
      },
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      nodes: Array<{ outputs: Record<string, unknown> | null }>;
    };

    // Обе копии обновлены, посторонние поля не потеряны.
    expect(snapshot.nodes[0]?.outputs).toMatchObject({
      fileUrl: freshUrl,
      storedUrl: freshUrl,
      fileName: 'report.docx',
    });
  });

  it('KI-415: истёкшая HMAC-подпись перевыпускается, хотя файловый TTL ещё не вышел', async () => {
    const key = 'run-1/A.png';
    const expired = buildSignedMediaPath(
      key,
      { secret: 'unit-test-media-signing-secret', ttlSeconds: 3600 },
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );
    const freshUrl = buildSignedMediaPath(
      key,
      { secret: 'unit-test-media-signing-secret', ttlSeconds: 3600 },
    ).path;
    const refreshStoredUrlByKeyAsync = vi.fn(() =>
      Promise.resolve({
        storedUrl: freshUrl,
        storedExpiresAt: new Date(Date.now() + 3_600_000),
      }),
    );

    const { service } = await createService({
      rows: [
        nodeRun({
          storedUrl: expired.path,
          // Файл хранится 30 дней: по этому полю ссылку перевыпускать рано.
          storedExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          storageKey: key,
        }),
      ],
      storage: { refreshStoredUrlByKeyAsync },
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      nodes: Array<{ storedUrl: string | null }>;
    };

    expect(refreshStoredUrlByKeyAsync).toHaveBeenCalledWith(key);
    expect(snapshot.nodes[0]?.storedUrl).toBe(freshUrl);
  });

  it('KI-347: отдаёт error запуска из workflow_runs в snapshot', async () => {
    const { service } = await createService({
      rows: [],
      run: {
        ...runRow,
        status: 'failed',
        error: 'Узел B упал: HTTP 404',
      },
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      run: { status: string; error: string | null };
    };

    // После F5 панель берёт причину именно отсюда — до KI-347 в снимке её не
    // было, и UI показывал «причина недоступна» (KI-347).
    expect(snapshot.run.error).toBe('Узел B упал: HTTP 404');
    expect(snapshot.run.status).toBe('failed');
  });

  it('KI-114: отдаёт cost_rub в snapshot — для media-узла и null для остальных', async () => {
    const { service } = await createService({
      rows: [
        nodeRun({ nodeId: 'A', nodeType: 'text' }),
        nodeRun({
          nodeId: 'B',
          nodeType: 'image_generation',
          outputs: { mediaUrl: 'https://cdn/img.png' },
          // Drizzle numeric без mode отдаёт значение строкой (6 знаков).
          costRub: '0.600000',
        }),
      ],
    });
    const messages = await collectAsync(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );
    const snapshot = payloads(messages)[0] as {
      nodes: Array<{ nodeId: string; costRub?: string | null }>;
    };

    expect(snapshot.nodes.find((node) => node.nodeId === 'B')?.costRub).toBe(
      '0.600000',
    );
    // Узел без media-стоимости: поле присутствует и равно null.
    expect(snapshot.nodes.find((node) => node.nodeId === 'A')?.costRub).toBeNull();
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
      completed('completed', true),
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

  it('закрывается на run_completed с final=true (KI-060)', async () => {
    const { service } = await createService({
      rows: [],
      // Последняя попытка: процессор выставил явный признак финала.
      events: {
        subscribeAsync: vi.fn(() => eventsThenHang([completed('failed', true, 2, 3)])),
      },
    });

    const messages = await collectWithTimeout(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );

    expect(payloads(messages).map((message) => message.type)).toEqual([
      'snapshot',
      'run_completed',
    ]);
  });

  it('РЕГРЕСС KI-060: детерминированный провал (цикл) закрывает поток', async () => {
    const { service } = await createService({
      rows: [],
      // Граф с циклом: executeAsync вернул failed без проброса, процессор
      // публикует final=true, хотя attemptsMade (0) < attempts - 1 (2).
      events: {
        subscribeAsync: vi.fn(() => eventsThenHang([completed('failed', true, 0, 3)])),
      },
    });

    // Поток обязан закрыться: раньше здесь висело соединение до отключения.
    const messages = await collectWithTimeout(
      service.streamAsync(RUN_ID, new AbortController().signal),
    );

    expect(payloads(messages).map((message) => message.type)).toEqual([
      'snapshot',
      'run_completed',
    ]);
  });

  it('закрывается только на третьей из трёх попыток (KI-060)', async () => {
    const events: RunEventDto[] = [
      completed('failed', false, 0, 3),
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:05.000Z' },
      completed('failed', false, 1, 3),
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:08.000Z' },
      completed('failed', true, 2, 3),
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

  it('НЕ закрывается на промежуточном провале (final=false, KI-060)', async () => {
    const { service } = await createService({
      rows: [],
      // Первая попытка из трёх провалилась — BullMQ ещё переиграет запуск.
      events: {
        subscribeAsync: vi.fn(() => eventsThenHang([completed('failed', false, 0, 3)])),
      },
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

  it('показывает retry того же запуска и закрывается на успешной попытке (KI-040)', async () => {
    const events: RunEventDto[] = [
      // Первая попытка провалилась, но лимит не исчерпан…
      completed('failed', false, 0, 3),
      // …поэтому job-level retry публикует новую попытку того же запуска.
      { type: 'run_started', runId: RUN_ID, startedAt: '2024-01-01T00:00:05.000Z' },
      completed('completed', true, 1, 3),
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
