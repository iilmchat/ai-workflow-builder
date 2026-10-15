import type { MessageEvent } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Observable, type Subscriber } from 'rxjs';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns, type NodeRun } from '../db/schema.js';
import {
  RunStreamMessageSchema,
  type NodeRunSnapshot,
  type RunEventDto,
  type SnapshotMessage,
} from './dto/index.js';
import { RunEventsService } from './run-events.service.js';
import { RunsService } from './runs.service.js';

/** Период keep-alive комментариев, мс: защита от таймаута простаивающего SSE. */
const SSE_KEEP_ALIVE_MS = 15_000;

/**
 * Поток событий прогресса запуска для SSE-эндпоинта (R4.1a).
 *
 * Сервис отвечает за три вещи:
 * 1. снимок состояния (`snapshot`) — первое сообщение потока (KI-049);
 * 2. трансляцию событий из Redis pub/sub (`RunEventsService.subscribeAsync`);
 * 3. завершение потока: `run_completed` с `final: true` (KI-060), отключение
 *    клиента (`AbortSignal` от `@SseSignal()`) или ошибка. Промежуточный провал
 *    запуска поток не закрывает — запуск может быть переигран job-level retry
 *    (KI-040).
 *
 * Подписка на Redis стартует **до** чтения снимка: иначе события, опубликованные
 * за время запроса к БД, потерялись бы.
 */
@Injectable()
export class RunsStreamService {
  private readonly logger = new Logger(RunsStreamService.name);

  /**
   * @param runsService - чтение запуска (даёт NotFoundException для 404)
   * @param runEvents - подписка на события запуска
   * @param db - соединение Drizzle (чтение `node_runs` для снимка)
   */
  constructor(
    private readonly runsService: RunsService,
    private readonly runEvents: RunEventsService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /**
   * Проверяет, что запуск существует.
   *
   * Вызывается до открытия SSE-потока: клиент получает обычный 404 JSON, а не
   * пустой `text/event-stream` (заголовки SSE коммитятся только на первом
   * сообщении, поэтому исключение успевает стать HTTP-ошибкой).
   *
   * @param runId - uuid запуска
   * @param userId - владелец из access-токена (KI-202): чужой запуск → 404
   * @returns промис без значения
   * @throws NotFoundException если запуск не найден или чужой
   */
  async assertRunExistsAsync(runId: string, userId?: string): Promise<void> {
    await this.runsService.getRunAsync(runId, userId);
  }

  /**
   * Создаёт поток SSE-сообщений запуска.
   *
   * Поток отдаёт `snapshot` первым сообщением, затем события прогресса.
   * Завершается он только на `run_completed` со статусом `completed`: провал
   * запуска не финален, потому что job-level retry (KI-040) переигрывает граф и
   * публикует новую попытку того же `runId` — клиент должен её увидеть. Если
   * попытки исчерпаны, соединение остаётся открытым до отключения клиента
   * (закрывать его по таймауту нельзя: неизвестно, будет ли ещё попытка).
   * Пока клиент подключён, раз в {@link SSE_KEEP_ALIVE_MS} отправляется
   * комментарий-keep-alive, чтобы прокси не разрывал простаивающее соединение
   * (LLM-узлы могут думать десятки секунд без событий).
   *
   * @param runId - uuid запуска
   * @param signal - `AbortSignal` запроса: аборится при отключении клиента
   *   (`@SseSignal()`), закрывая подписку на Redis (RULES 4.19)
   * @param userId - владелец из access-токена (KI-202), пробрасывается в снимок
   * @returns Observable SSE-сообщений (`data` — JSON `RunStreamMessage`)
   */
  streamAsync(
    runId: string,
    signal: AbortSignal,
    userId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const keepAlive = setInterval(() => {
        if (!subscriber.closed) {
          // `comment` рендерится как `: keep-alive` — клиент его игнорирует.
          subscriber.next({ comment: 'keep-alive' });
        }
      }, SSE_KEEP_ALIVE_MS);

      // Не держим процесс живым из-за таймера (важно для тестов и shutdown).
      keepAlive.unref();

      void this.consumeAsync(runId, signal, subscriber, userId).finally(() => {
        clearInterval(keepAlive);
      });

      return () => {
        clearInterval(keepAlive);
      };
    });
  }

  /**
   * Транслирует снимок и события запуска в подписчика Observable.
   *
   * @param runId - uuid запуска
   * @param signal - сигнал отключения клиента
   * @param subscriber - подписчик SSE-потока
   * @param userId - владелец из access-токена (KI-202)
   * @returns промис без значения (завершается вместе с потоком)
   */
  private async consumeAsync(
    runId: string,
    signal: AbortSignal,
    subscriber: Subscriber<MessageEvent>,
    userId?: string,
  ): Promise<void> {
    const iterator = this.runEvents
      .subscribeAsync(runId, signal)
      [Symbol.asyncIterator]();
    // Асинхронный генератор начинает работу только на первом `next()`,
    // поэтому подписка на Redis стартует здесь — до чтения снимка.
    const firstEvent = iterator.next();

    try {
      const snapshot = RunStreamMessageSchema.parse(
        await this.buildSnapshotAsync(runId, userId),
      );

      if (!signal.aborted) {
        subscriber.next({ data: snapshot });

        let next: IteratorResult<RunEventDto> = await firstEvent;

        while (!next.done && !signal.aborted) {
          subscriber.next({ data: next.value });

          // KI-060: поток закрывается по явному признаку финальности `final`,
          // который выставляет процессор (он знает, будет ли ещё попытка).
          if (next.value.type === 'run_completed' && next.value.final) {
            break;
          }

          next = await iterator.next();
        }
      }

      subscriber.complete();
    } catch (error: unknown) {
      // Отключение клиента — не ошибка: сигнал гасит поток штатно.
      if (!signal.aborted && !subscriber.closed) {
        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(`SSE-поток запуска ${runId} прерван: ${message}`);
        // Стек не гасим: ошибку обрабатывает подписчик Nest/RxJS (RULES 1.7).
        subscriber.error(error);
      }
    } finally {
      await iterator.return?.();
    }
  }

  /**
   * Собирает снимок состояния запуска: строка `workflow_runs` + все `node_runs`.
   *
   * @param runId - uuid запуска
   * @param userId - владелец из access-токена (KI-202)
   * @returns снимок состояния (первое сообщение потока)
   * @throws NotFoundException если запуск не найден или чужой
   */
  private async buildSnapshotAsync(
    runId: string,
    userId?: string,
  ): Promise<SnapshotMessage> {
    const run = await this.runsService.getRunAsync(runId, userId);

    // Порядок по `nodeId` детерминирован (в отличие от nullable `started_at`);
    // UI сортирует узлы так, как ему нужно.
    const rows = await this.db
      .select()
      .from(nodeRuns)
      .where(eq(nodeRuns.runId, runId))
      .orderBy(nodeRuns.nodeId);

    return {
      type: 'snapshot',
      run: {
        id: run.id,
        workflowId: run.workflowId,
        status: run.status,
        createdAt: run.createdAt.toISOString(),
      },
      nodes: rows.map((row) => this.toNodeSnapshot(row)),
    };
  }

  /**
   * Приводит строку `node_runs` к узлу снимка (даты — ISO, `cost_usd` — строка,
   * как её отдаёт колонка `numeric`).
   *
   * @param row - строка таблицы `node_runs`
   * @returns узел снимка состояния
   */
  private toNodeSnapshot(row: NodeRun): NodeRunSnapshot {
    return {
      nodeId: row.nodeId,
      nodeType: row.nodeType,
      status: row.status,
      inputs: row.inputs ?? {},
      outputs: row.outputs ?? null,
      error: row.error,
      logs: row.logs ?? null,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costUsd: row.costUsd,
      costRub: row.costRub ?? null,
      durationMs: row.durationMs,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
