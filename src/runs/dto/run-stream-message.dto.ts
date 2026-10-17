import { z } from 'zod';
import { NODE_RUN_STATUSES, WORKFLOW_RUN_STATUSES } from '../../db/schema.js';
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
 * Zod-схема статуса **запуска**.
 *
 * Значения берутся из `WORKFLOW_RUN_STATUSES` (`db/schema.ts`) — единственного
 * источника истины, чтобы список статусов не разошёлся с БД. KI-336 развёл
 * статусы запуска и узла, поэтому здесь именно список запуска (статус узла —
 * {@link NodeRunStatusSchema}).
 */
export const RunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);

/**
 * Zod-схема статуса узла запуска, включая `skipped` (KI-288, KI-353).
 *
 * Канон списка — `NODE_RUN_STATUSES` (`db/schema.ts`): он **импортируется**, а не
 * выводится здесь заново из `WORKFLOW_RUN_STATUSES`, поэтому новый статус
 * запуска подхватывается автоматически (KI-353).
 *
 * Отличается от {@link RunStatusSchema} ровно на `skipped`: это статус **узла**,
 * у запуска такого значения нет. Без `skipped` в этой схеме валидация снимка
 * падала бы на каждом запуске с пропущенным узлом, и SSE-поток закрывался бы
 * ошибкой (RULES 1.17).
 */
export const NodeRunStatusSchema = z.enum(NODE_RUN_STATUSES);

/** Zod-схема запуска внутри снимка состояния. */
export const RunSnapshotSchema = z.object({
  id: z.uuid(),
  workflowId: z.uuid(),
  status: RunStatusSchema,
  createdAt: z.iso.datetime(),
  /**
   * Текст ошибки запуска — колонка `workflow_runs.error` (KI-347).
   *
   * Без него клиент после F5 видел только `status: 'failed'` и показывал
   * «причина недоступна», хотя причина уже записана в БД. Значение
   * обязательное (`null` — ошибки не было): снимок всегда собирает backend,
   * так что «поля нет» — это расхождение контракта, а не совместимость
   * (RULES 1.17).
   */
  error: z.string().nullable(),
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
  /**
   * Кэш-токены чтения (R7.7, KI-055): колонка `cache_read_tokens`.
   *
   * Необязательное — как `costRub`: старые снимки остаются совместимыми.
   */
  cacheReadTokens: z.number().int().nullable().optional(),
  /** Кэш-токены записи (R7.7, KI-150): колонка `cache_creation_tokens`. */
  cacheCreationTokens: z.number().int().nullable().optional(),
  /**
   * Экономия на чтении из кэша, USD (R7.7).
   *
   * Пересчитывается при сборке снимка по прайсу модели узла (в БД не
   * хранится). `null` — посчитать нельзя (модель вне прайса/цены кэша нет).
   */
  cacheSavingsUsd: z.number().nullable().optional(),
  /** Своя ссылка на media-результат (R7.8, KI-362). */
  storedUrl: z.string().nullable().optional(),
  /** Когда `storedUrl` перестанет быть доступной (R7.8). */
  storedExpiresAt: z.iso.datetime().nullable().optional(),
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
