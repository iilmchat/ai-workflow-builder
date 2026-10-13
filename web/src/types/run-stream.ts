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

/** Статус запуска/узла (совпадает с `RUN_STATUSES` backend). */
export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

/** Статус запуска или узла. */
export type RunStatus = z.infer<typeof RunStatusSchema>;

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
  status: RunStatusSchema,
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  logs: z.array(z.string()).nullable(),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  costUsd: z.string().nullable(),
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
    finishedAt: z.string(),
  }),
  /** Узел упал. */
  z.object({
    type: z.literal('node_failed'),
    runId: z.string(),
    nodeId: z.string(),
    error: z.string(),
    finishedAt: z.string(),
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
