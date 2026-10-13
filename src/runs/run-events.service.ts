import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { InjectRedis } from '../redis/redis.module.js';
import { RunEventSchema, type RunEventDto } from './dto/index.js';
import { runEventsChannel } from './runs.constants.js';

/**
 * Публикация и чтение событий прогресса запуска через Redis pub/sub.
 *
 * R2.1 — инфраструктура: публикует executor (R2.2), читает SSE-эндпоинт (R4).
 * Используется отдельный Redis-клиент (не соединение BullMQ): подписчик не
 * может выполнять обычные команды, пока подписан на канал.
 */
@Injectable()
export class RunEventsService {
  private readonly logger = new Logger(RunEventsService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Публикует событие прогресса в канал запуска.
   *
   * Событие повторно валидируется перед отправкой — защита в глубину для
   * вызовов в обход компилятора (RULES 1.17).
   *
   * @param runId - uuid запуска
   * @param event - событие прогресса
   * @returns промис без значения
   * @throws InternalServerErrorException если событие не соответствует RunEventSchema
   * @throws InternalServerErrorException если публикацию не удалось отправить в Redis
   */
  async publishAsync(runId: string, event: RunEventDto): Promise<void> {
    const parsed = RunEventSchema.safeParse(event);

    if (!parsed.success) {
      throw new InternalServerErrorException(
        `Некорректное событие запуска ${runId}: ${z.prettifyError(parsed.error)}`,
      );
    }

    try {
      await this.redis.publish(runEventsChannel(runId), JSON.stringify(parsed.data));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Не удалось опубликовать событие ${parsed.data.type} запуска ${runId}: ${message}`,
      );

      throw new InternalServerErrorException(
        `Не удалось опубликовать событие запуска ${runId}`,
      );
    }
  }

  /**
   * Подписывается на события запуска.
   *
   * Возвращает асинхронный итератор: события отдаются по мере поступления,
   * невалидное сообщение логируется и пропускается (поток не рвётся). На каждый
   * вызов создаётся отдельное соединение Redis, которое закрывается, когда
   * потребитель прерывает итерацию или срабатывает `signal` (RULES 4.19).
   *
   * @param runId - uuid запуска
   * @param signal - необязательный AbortSignal для остановки подписки
   * @returns асинхронный итератор валидированных событий запуска
   */
  async *subscribeAsync(runId: string, signal?: AbortSignal): AsyncIterable<RunEventDto> {
    const channel = runEventsChannel(runId);
    const subscriber = this.redis.duplicate();
    const pending: RunEventDto[] = [];
    let wake: (() => void) | null = null;

    /** Будит генератор, ожидающий следующее сообщение. */
    const notify = (): void => {
      const resolve = wake;

      wake = null;
      resolve?.();
    };

    const onMessage = (_channel: string, raw: string): void => {
      const event = this.parseMessage(runId, raw);

      if (!event) {
        return;
      }

      pending.push(event);
      notify();
    };

    const onAbort = (): void => notify();

    subscriber.on('message', onMessage);
    signal?.addEventListener('abort', onAbort);

    try {
      await subscriber.subscribe(channel);

      while (!signal?.aborted) {
        const next = pending.shift();

        if (next) {
          yield next;
          continue;
        }

        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      notify();
      subscriber.off('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      await subscriber.unsubscribe(channel).catch(() => undefined);
      await subscriber.quit().catch(() => undefined);
    }
  }

  /**
   * Разбирает и валидирует сообщение из канала.
   *
   * @param runId - uuid запуска (для диагностики)
   * @param raw - сырое сообщение из Redis
   * @returns валидированное событие либо `null`, если сообщение отброшено
   */
  private parseMessage(runId: string, raw: string): RunEventDto | null {
    try {
      const parsed = RunEventSchema.safeParse(JSON.parse(raw) as unknown);

      if (!parsed.success) {
        this.logger.warn(
          `Отброшено событие запуска ${runId}: ${z.prettifyError(parsed.error)}`,
        );

        return null;
      }

      return parsed.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Отброшено сообщение канала запуска ${runId}: ${message}`);

      return null;
    }
  }
}
