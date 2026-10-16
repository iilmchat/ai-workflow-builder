import { z } from 'zod';

/**
 * Zod-схемы SSE-сообщений запуска — зеркало backend
 * `src/runs/dto/run-stream-message.dto.ts` (R4.1).
 *
 * Данные приходят из внешнего источника (SSE-поток), поэтому валидируются на
 * границе (RULES 1.17): битое сообщение не должно ломать подписку. Синхронизация
 * с backend ручная — при изменении backend-схемы это зеркало нужно править
 * следом (в R4.3+ общие типы стоит вынести в shared-пакет).
 */

/** Статус запуска (совпадает с `RUN_STATUSES` backend). */
export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

/** Статус запуска. */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Статусы строки `node_runs`: статусы запуска плюс `skipped` (KI-288).
 *
 * Пропуск — статус **узла**, а не запуска: узел не выполнялся, потому что упал
 * (или был пропущен сам) его предшественник. Значения выведены из
 * {@link RunStatusSchema}, чтобы список не разъехался с ним при добавлении
 * нового статуса запуска. Зеркало backend `NODE_RUN_STATUSES`
 * (`src/runs/dto/run-stream-message.dto.ts`).
 */
export const NODE_RUN_STATUSES = [...RunStatusSchema.options, 'skipped'] as const;

/** Zod-схема статуса узла запуска (включая `skipped`, KI-288). */
export const NodeRunStatusSchema = z.enum(NODE_RUN_STATUSES);

/** Статус узла запуска. */
export type NodeRunStatus = z.infer<typeof NodeRunStatusSchema>;

/** Запуск внутри snapshot-сообщения. */
export const RunSnapshotSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: RunStatusSchema,
  createdAt: z.string(),
});

/** Снимок состояния узла запуска. */
export const NodeRunSnapshotSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  // KI-288: узел может быть в статусе `skipped` — см. NodeRunStatusSchema.
  status: NodeRunStatusSchema,
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  logs: z.array(z.string()).nullable(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  costUsd: z.string().nullable(),
  /**
   * Стоимость media-генерации в рублях (v0.6.0b.2.2, колонка `node_runs.cost_rub`).
   *
   * Поле необязательное: backend пока не передаёт `cost_rub` в снимок
   * (см. KI-114), поэтому старые и текущие ответы приходят без него. Когда
   * backend начнёт отдавать поле, оно подхватится без правок фронтенда.
   */
  costRub: z.string().nullable().optional(),
  durationMs: z.number().int().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

/** Сообщение-снимок: приходит первым в потоке (KI-049). */
export const SnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  run: RunSnapshotSchema,
  nodes: z.array(NodeRunSnapshotSchema),
});

/** События прогресса запуска (совпадают с backend `RunEventSchema`). */
export const RunEventSchema = z.discriminatedUnion('type', [
  /** Запуск перешёл в статус `running`. */
  z.object({
    type: z.literal('run_started'),
    runId: z.string(),
    startedAt: z.string(),
  }),
  /** Узел начал выполнение. */
  z.object({
    type: z.literal('node_started'),
    runId: z.string(),
    nodeId: z.string(),
    nodeType: z.string(),
    startedAt: z.string(),
  }),
  /** Узел успешно завершён. */
  z.object({
    type: z.literal('node_completed'),
    runId: z.string(),
    nodeId: z.string(),
    outputs: z.record(z.string(), z.unknown()),
    durationMs: z.number().int(),
    // KI-149 (KI-075): метрики приходят и в событии (backend v0.7.1). Без этих
    // полей Zod их отбрасывает (strip), и панель видит стоимость только из
    // snapshot после F5. Поля необязательные — старые события валидны.
    costRub: z.string().nullable().optional(),
    tokensIn: z.number().int().nonnegative().nullable().optional(),
    tokensOut: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.string().nullable().optional(),
    logs: z.array(z.string()).nullable().optional(),
    finishedAt: z.string(),
  }),
  /** Узел упал. */
  z.object({
    type: z.literal('node_failed'),
    runId: z.string(),
    nodeId: z.string(),
    error: z.string(),
    costRub: z.string().nullable().optional(),
    tokensIn: z.number().int().nonnegative().nullable().optional(),
    tokensOut: z.number().int().nonnegative().nullable().optional(),
    costUsd: z.string().nullable().optional(),
    logs: z.array(z.string()).nullable().optional(),
    finishedAt: z.string(),
  }),
  /**
   * Узел пропущен: движок его не выполнял, потому что упал (или был пропущен
   * сам) его предшественник — KI-288. Зеркало backend `node_skipped`
   * (`src/runs/dto/run-event.dto.ts`).
   *
   * Отдельное событие, а не `node_failed`: узел не падал, и в UI это другое
   * состояние («не запускался»). Выходов и метрик у такого узла нет.
   */
  z.object({
    type: z.literal('node_skipped'),
    runId: z.string(),
    nodeId: z.string(),
    nodeType: z.string(),
    /** Причина пропуска — тот же текст, что записан в `node_runs.error`. */
    reason: z.string(),
    /** ISO-время пропуска на backend (поле `skippedAt`). */
    skippedAt: z.string(),
  }),
  /** Запуск завершён — успешно или с ошибкой. */
  z.object({
    type: z.literal('run_completed'),
    runId: z.string(),
    status: z.enum(['completed', 'failed']),
    /** Сколько попыток уже завершил BullMQ (KI-059). */
    attemptsMade: z.number().int(),
    /** Лимит попыток job'а (`null` — неизвестен). */
    attempts: z.number().int().nullable(),
    /** KI-060: `true` — финал, поток можно закрывать (retry не будет). */
    final: z.boolean(),
    finishedAt: z.string(),
  }),
]);

/** Любое сообщение SSE-потока запуска: снимок либо событие прогресса. */
export const RunStreamMessageSchema = z.discriminatedUnion('type', [
  ...RunEventSchema.options,
  SnapshotMessageSchema,
]);

/** Событие прогресса запуска. */
export type RunEventMessage = z.infer<typeof RunEventSchema>;
/** Снимок состояния запуска (первое сообщение потока). */
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
/** Снимок узла запуска. */
export type NodeRunSnapshot = z.infer<typeof NodeRunSnapshotSchema>;
/** Любое сообщение SSE-потока запуска. */
export type RunStreamMessage = z.infer<typeof RunStreamMessageSchema>;
