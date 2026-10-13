import { z } from 'zod';

/**
 * Zod-схема события прогресса запуска workflow (Redis pub/sub, канал `run:<runId>`).
 *
 * Дискриминированный union по полю `type`: каждое событие несёт `runId` и
 * ISO-время. Схема применяется на обеих границах — при публикации
 * (`RunEventsService.publishAsync`) и при чтении из канала
 * (`RunEventsService.subscribeAsync`), так как данные из Redis — внешние
 * (RULES 1.17).
 */
export const RunEventSchema = z.discriminatedUnion('type', [
  /** Запуск перешёл в статус `running`. */
  z.object({
    type: z.literal('run_started'),
    runId: z.uuid(),
    startedAt: z.iso.datetime(),
  }),
  /** Узел начал выполнение. */
  z.object({
    type: z.literal('node_started'),
    runId: z.uuid(),
    nodeId: z.string(),
    nodeType: z.string(),
    startedAt: z.iso.datetime(),
  }),
  /** Узел успешно завершён; `outputs` — то, что узел отдал дальше. */
  z.object({
    type: z.literal('node_completed'),
    runId: z.uuid(),
    nodeId: z.string(),
    outputs: z.record(z.string(), z.unknown()),
    durationMs: z.number().int().nonnegative(),
    finishedAt: z.iso.datetime(),
  }),
  /** Узел упал: `error` — текст для `node_runs.error`. */
  z.object({
    type: z.literal('node_failed'),
    runId: z.uuid(),
    nodeId: z.string(),
    error: z.string(),
    finishedAt: z.iso.datetime(),
  }),
  /** Запуск завершён — успешно или с ошибкой (см. KI-059 о финальности). */
  z.object({
    type: z.literal('run_completed'),
    runId: z.uuid(),
    status: z.enum(['completed', 'failed']),
    /**
     * Сколько попыток уже сделал BullMQ (0 для первой доставки задания).
     *
     * Для `failed`-запуска клиент сравнивает `attemptsMade` с `attempts`, чтобы
     * отличить «будет retry» от «попытки исчерпаны» (KI-059).
     */
    attemptsMade: z.number().int().nonnegative(),
    /**
     * Максимум попыток из `defaultJobOptions` (`attempts: 3`, KI-016);
     * `null`, если лимит не задан.
     */
    attempts: z.number().int().positive().nullable(),
    finishedAt: z.iso.datetime(),
  }),
]);

/** Валидированное событие прогресса запуска. */
export type RunEventDto = z.infer<typeof RunEventSchema>;
