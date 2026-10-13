import { InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from '../redis/redis.module.js';
import { RunEventsService } from './run-events.service.js';
import type { RunEventDto } from './dto/index.js';

/** Стабильный uuid запуска для тестовых событий. */
const RUN_ID = '11111111-1111-4111-8111-111111111111';
/** Валидная ISO-дата события. */
const ISO_NOW = '2026-10-13T10:00:00.000Z';

/** Валидное событие `node_started` для проверок доставки. */
const nodeStartedEvent: RunEventDto = {
  type: 'node_started',
  runId: RUN_ID,
  nodeId: 'n1',
  nodeType: 'llm',
  startedAt: ISO_NOW,
};

/**
 * Создаёт заглушку Redis-клиента с поддержкой pub/sub.
 *
 * `emit` вызывает обработчик, зарегистрированный сервисом через `on('message')`,
 * — так тест проверяет реальную логику разбора сообщений без живого Redis.
 */
function createFakeRedis() {
  const handlers = new Map<string, (channel: string, raw: string) => void>();

  const subscriber = {
    on: vi.fn((event: string, handler: (channel: string, raw: string) => void) => {
      handlers.set(event, handler);
    }),
    off: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(() => Promise.resolve()),
    quit: vi.fn(() => Promise.resolve()),
  };

  const publish = vi.fn((_channel: string, _payload: string) => Promise.resolve(1));

  return {
    publish,
    subscriber,
    redis: { publish, duplicate: vi.fn(() => subscriber) },
    emit: (channel: string, raw: string): void => handlers.get('message')?.(channel, raw),
  };
}

describe('RunEventsService', () => {
  let service: RunEventsService;
  let fake: ReturnType<typeof createFakeRedis>;

  beforeEach(async () => {
    fake = createFakeRedis();

    const moduleRef = await Test.createTestingModule({
      providers: [
        RunEventsService,
        { provide: REDIS_TOKEN, useValue: fake.redis as unknown as Redis },
      ],
    }).compile();

    service = moduleRef.get(RunEventsService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('publishAsync', () => {
    it('публикует событие в канал run:<runId> как JSON', async () => {
      await service.publishAsync(RUN_ID, nodeStartedEvent);

      expect(fake.publish).toHaveBeenCalledTimes(1);

      const [channel, payload] = fake.publish.mock.calls[0];

      expect(channel).toBe(`run:${RUN_ID}`);
      expect(JSON.parse(payload)).toEqual(nodeStartedEvent);
    });

    it('отклоняет событие, не соответствующее схеме, и не пишет в Redis', async () => {
      const broken = { type: 'node_started', runId: 'not-a-uuid' } as unknown as RunEventDto;

      await expect(service.publishAsync(RUN_ID, broken)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(fake.publish).not.toHaveBeenCalled();
    });
  });

  describe('subscribeAsync', () => {
    it('отдаёт валидные события и пропускает мусор из канала', async () => {
      const controller = new AbortController();
      const iterator = service
        .subscribeAsync(RUN_ID, controller.signal)
        [Symbol.asyncIterator]();
      const first = iterator.next();

      // Даём генератору дойти до await subscriber.subscribe().
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fake.subscriber.subscribe).toHaveBeenCalledWith(`run:${RUN_ID}`);

      fake.emit(`run:${RUN_ID}`, '{ это не JSON');
      fake.emit(`run:${RUN_ID}`, JSON.stringify({ type: 'unknown_event', runId: RUN_ID }));
      fake.emit(`run:${RUN_ID}`, JSON.stringify(nodeStartedEvent));

      await expect(first).resolves.toEqual({ value: nodeStartedEvent, done: false });

      controller.abort();

      await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
      expect(fake.subscriber.quit).toHaveBeenCalled();
    });
  });
});
