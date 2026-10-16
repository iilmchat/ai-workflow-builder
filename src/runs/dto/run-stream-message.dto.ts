import { z } from 'zod';
import { RUN_STATUSES } from '../../db/schema.js';
import { RunEventSchema } from './run-event.dto.js';

/**
 * Zod-схемы SSE-сообщений запуска (R4.1a).
 *
 * Контракт шире, чем у Redis pub/sub (`RunEventSchema`): поток начинается
 * сообщением `snapshot` с текущим состоянием запуска и всех его узлов. Это
 * закрывает разрыв между «запуск создан / часть узлов уже отработала» и
 * «клиент подключился», а также компенсирует переиспользованные узлы, события
 * которых повторно не публикуются (KI-046, KI-049).
 *
 * Даты в SSE-сообщениях — ISO-строки, а не `Date`: именно в таком виде их
 * получает клиент после `JSON.stringify`.
 */

/**
 * Zod-схема статуса запуска/узла.
 *
 * Значения берутся из `RUN_STATUSES` (`db/schema.ts`) — единственного источника
 * истины, чтобы список статусов не разошёлся с БД.
 */
export const RunStatusSchema = z.enum(RUN_STATUSES);

/**
 * Статусы строки `node_runs`, которые может отдать снимок (KI-288).
 *
 * Отличается от {@link RunStatusSchema} ровно на `skipped`: это статус **узла**,
 * у запуска такого значения нет. Список выведен из `RUN_STATUSES` (а не
 * продублирован), чтобы новые статусы запуска подхватывались автоматически.
 * Без `skipped` в этой схеме валидация снимка падала бы на каждом запуске с
 * пропущенным узлом, и SSE-поток закрывался бы ошибкой (RULES 1.17).
 */
export const NODE_RUN_STATUSES = [...RUN_STATUSES, 'skipped'] as const;

/** Zod-схема статуса узла запуска (включая `skipped`, KI-288). */
export const NodeRunStatusSchema = z.enum(NODE_RUN_STATUSES);

/** Статус строки `node_runs` в снимке состояния. */
export type NodeRunStatus = (typeof NODE_RUN_STATUSES)[number];

/** Zod-схема запуска внутри снимка состояния. */
export const RunSnapshotSchema = z.object({
  id: z.uuid(),
  workflowId: z.uuid(),
  status: RunStatusSchema,
  createdAt: z.iso.datetime(),
});

/** Zod-схема узла запуска внутри снимка состояния. */
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
   * Стоимость media-генерации в рублях (v0.6.0b.2.2, колонка `cost_rub`).
   *
   * Необязательное, чтобы снимок оставался совместимым с клиентами, которые
   * ещё не знают про поле (фронтенд читает его как `.optional()`).
   */
  costRub: z.string().nullable().optional(),
  durationMs: z.number().int().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

/**
 * Zod-схема снимка состояния запуска — первое сообщение SSE-потока.
 */
export const SnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  run: RunSnapshotSchema,
  nodes: z.array(NodeRunSnapshotSchema),
});

/**
 * Zod-схема любого сообщения SSE-потока: снимок либо событие прогресса.
 *
 * Используется как контракт на границе стрима: снимок валидируется перед
 * отправкой, поэтому клиент R4.2 может полагаться на эту схему (RULES 1.17).
 */
export const RunStreamMessageSchema = z.discriminatedUnion('type', [
  ...RunEventSchema.options,
  SnapshotMessageSchema,
]);

/** Запуск внутри снимка состояния. */
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

/** Узел запуска внутри снимка состояния. */
export type NodeRunSnapshot = z.infer<typeof NodeRunSnapshotSchema>;

/** Снимок состояния запуска (первое сообщение потока). */
export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;

/** Любое сообщение SSE-потока запуска. */
export type RunStreamMessage = z.infer<typeof RunStreamMessageSchema>;
