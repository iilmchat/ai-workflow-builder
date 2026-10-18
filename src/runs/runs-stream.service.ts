import type { MessageEvent } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Observable, type Subscriber } from 'rxjs';
import { DRIZZLE, type Database } from '../db/db.module.js';
import { nodeRuns, type NodeRun } from '../db/schema.js';
import type { GraphSnapshotDto } from '../engine/dto/index.js';
import { calculateCacheSavingsUsd } from '../llm/model-pricing.js';
import {
  MEDIA_STORAGE,
  type IMediaStorage,
} from '../media/media-storage.service.js';
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
   * @param mediaStorage - хранилище media-результатов: переподписывает
   *   просроченный `stored_url` в снимке (KI-443)
   */
  constructor(
    private readonly runsService: RunsService,
    private readonly runEvents: RunEventsService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(MEDIA_STORAGE) private readonly mediaStorage: IMediaStorage,
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
    await this.runsService.getRunRowAsync(runId, userId);
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
    // KI-347: строка целиком, а не `RunResponse`: снимок отдаёт `error`, и
    // читать его повторным запросом к БД незачем (RULES 4.17).
    const run = await this.runsService.getRunRowAsync(runId, userId);

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
        // KI-347: причина падения запуска — панель результата показывает её
        // после F5 вместо «причина недоступна».
        error: run.error,
      },
      // Ссылки переподписываются параллельно: независимые подписи не должны
      // выполняться в цикле (RULES 4.17).
      nodes: await Promise.all(
        rows.map((row) => this.toNodeSnapshotAsync(row, run.snapshot)),
      ),
    };
  }

  /**
   * Приводит строку `node_runs` к узлу снимка (даты — ISO, `cost_usd` — строка,
   * как её отдаёт колонка `numeric`).
   *
   * **R7.7 (KI-055):** `cacheSavingsUsd` в БД не хранится — он пересчитывается
   * здесь по модели узла из снимка графа и `cacheReadTokens` (тарифы живут
   * только в `model-pricing.ts`). Без модели (узел удалён/тип без модели)
   * экономия — `null`, токены при этом всё равно отдаются.
   *
   * **KI-443:** просроченный `stored_url` приватного S3 — presigned GET,
   * который живёт час. Если `stored_expires_at` уже прошёл, ссылка
   * переподписывается здесь, на чтении: UI получает рабочую ссылку и новый
   * `storedExpiresAt` (иначе `resolveMediaSource` показал бы плейсхолдер
   * «ссылка истекла» даже при свежем URL). В БД ссылка не обновляется:
   * снимок — это проекция, а подпись стоит дёшево и не требует записи.
   *
   * @param row - строка таблицы `node_runs`
   * @param snapshot - снимок графа запуска (нужен `data.model` узла)
   * @returns узел снимка состояния
   */
  private async toNodeSnapshotAsync(
    row: NodeRun,
    snapshot: GraphSnapshotDto,
  ): Promise<NodeRunSnapshot> {
    const model = snapshot.nodes.find((node) => node.id === row.nodeId)?.data.model;
    const stored = await this.resolveStoredUrlAsync(row);

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
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheSavingsUsd:
        typeof model === 'string'
          ? calculateCacheSavingsUsd(model, row.cacheReadTokens)
          : null,
      storedUrl: stored.storedUrl,
      storedExpiresAt: stored.storedExpiresAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  /**
   * Отдаёт актуальные ссылку и срок её жизни для media-узла (KI-443).
   *
   * Свежая ссылка возвращается как есть. Просроченную просит переподписать
   * хранилище: local вернёт `null` (относительный URL не истекает), S3 —
   * новый presigned GET и новый срок. Любая ошибка хранилища не должна
   * ломать снимок: остаётся исходная пара, UI покажет плейсхолдер.
   *
   * @param row - строка `node_runs`
   * @returns ссылка и срок (исходные, если обновление не удалось/не нужно)
   */
  private async resolveStoredUrlAsync(
    row: NodeRun,
  ): Promise<{ storedUrl: string | null; storedExpiresAt: Date | null }> {
    if (
      row.storedUrl === null ||
      row.storedExpiresAt === null ||
      row.storedExpiresAt.getTime() > Date.now()
    ) {
      return { storedUrl: row.storedUrl, storedExpiresAt: row.storedExpiresAt };
    }

    try {
      const refreshed = await this.mediaStorage.refreshStoredUrlAsync(
        row.storedUrl,
      );

      if (refreshed !== null) {
        return refreshed;
      }
    } catch (error: unknown) {
      // RULES 4.18: внешняя граница (S3) не должна ронять SSE-снимок.
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Не удалось переподписать stored_url узла ${row.nodeId}: ${message}`,
      );
    }

    return { storedUrl: row.storedUrl, storedExpiresAt: row.storedExpiresAt };
  }
}
