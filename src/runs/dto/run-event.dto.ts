import { z } from 'zod';
import { TERMINAL_WORKFLOW_RUN_STATUSES } from '../../db/schema.js';

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
  /**
   * Узел успешно завершён; `outputs` — то, что узел отдал дальше.
   *
   * KI-075: событие несёт метрики (`costRub` / токены / `costUsd` / `logs`) —
   * до v0.7.1 панель получала их только из snapshot после F5. Поля
   * необязательные: старые события из Redis остаются валидными.
   */
  z.object({
    type: z.literal('node_completed'),
    runId: z.uuid(),
    nodeId: z.string(),
    outputs: z.record(z.string(), z.unknown()),
    durationMs: z.number().int().nonnegative(),
    /** Стоимость media-генерации в рублях (v0.6.0b.2.2). */
    costRub: z.string().nullable().optional(),
    /** Токены на входе (LLM). */
    tokensIn: z.number().int().nonnegative().nullable().optional(),
    /** Токены на выходе (LLM). */
    tokensOut: z.number().int().nonnegative().nullable().optional(),
    /** Стоимость LLM в долларах (v0.6.0b.2.2). */
    costUsd: z.string().nullable().optional(),
    /** Логи ретраев / диагностика (KI-036, KI-043). */
    logs: z.array(z.string()).nullable().optional(),
    finishedAt: z.iso.datetime(),
  }),
  /**
   * Узел упал: `error` — текст для `node_runs.error`.
   *
   * KI-075: те же поля, что и в `node_completed`. Метрики провайдера на
   * падении неизвестны (в `node_runs` они NULL), поэтому приходят `null`,
   * а `logs` — реальные строки диагностики.
   */
  z.object({
    type: z.literal('node_failed'),
    runId: z.uuid(),
    nodeId: z.string(),
    error: z.string(),
    costRub: z.string().nullable().optional(),
    tokensIn: z.number().int().nonnegative().nullable().optional(),
    tokensOut: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.string().nullable().optional(),
    logs: z.array(z.string()).nullable().optional(),
    finishedAt: z.iso.datetime(),
  }),
  /**
   * Узел пропущен: движок его не выполнял, потому что упал (или был пропущен
   * сам) его предшественник — KI-288.
   *
   * Отдельное событие, а не `node_failed`: узел не падал, и в UI это другое
   * состояние («не запускался»), хотя в `node_runs.status` строка и лежит со
   * значением `skipped`. Метрик и выходов у такого узла нет, поэтому в событии
   * только причина.
   */
  z.object({
    type: z.literal('node_skipped'),
    runId: z.uuid(),
    nodeId: z.string(),
    nodeType: z.string(),
    /** Причина пропуска — тот же текст, что записан в `node_runs.error`. */
    reason: z.string(),
    skippedAt: z.iso.datetime(),
  }),
  /** Запуск завершён — успешно или с ошибкой (см. KI-059 о финальности). */
  z.object({
    type: z.literal('run_completed'),
    runId: z.uuid(),
    /**
     * Финальный статус запуска (KI-353).
     *
     * Список — `TERMINAL_WORKFLOW_RUN_STATUSES` из `db/schema.ts`, а не
     * локальный литерал: значения статусов объявлены в одном месте — рядом с
     * колонками `workflow_runs` / `node_runs`.
     */
    status: z.enum(TERMINAL_WORKFLOW_RUN_STATUSES),
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
    /**
     * Явный признак финала запуска (KI-060).
     *
     * `true` — ждать больше нечего, поток SSE можно закрывать. `false` — запуск
     * провалился, но BullMQ сделает ещё попытку (job пробросил исключение и
     * лимит попыток не исчерпан). Эвристика по `attemptsMade`/`attempts` не
     * годится: детерминированный провал планирования закрывает запуск `failed`
     * без проброса исключения, поэтому retry не будет (KI-037).
     */
    final: z.boolean(),
    finishedAt: z.iso.datetime(),
  }),
]);

/** Валидированное событие прогресса запуска. */
export type RunEventDto = z.infer<typeof RunEventSchema>;
