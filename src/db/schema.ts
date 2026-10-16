import { relations } from 'drizzle-orm';
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EdgeDto, GraphSnapshotDto, NodeDto } from '../engine/dto/index.js';

/**
 * Значения колонки `workflow_runs.status` (KI-336).
 *
 * У **запуска** статуса `skipped` не существует: пропуск — свойство узла
 * (узел не выполнялся, потому что упал его предшественник), а запуск при этом
 * завершается `failed` либо `completed`. Поэтому список статусов запуска и
 * список статусов узла разведены: см. {@link NODE_RUN_STATUSES}.
 */
export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

/** Статус строки `workflow_runs` (KI-336). */
export type RunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

/**
 * Значения колонки `node_runs.status` (KI-288, KI-336).
 *
 * Статусы запуска плюс `skipped` — узел не запускался, потому что его
 * предшественник упал или уже был пропущен. Колонка `node_runs.status` объявлена
 * как `text` без CHECK-ограничения, поэтому новое значение не требует миграции:
 * достаточно типа колонки (`$type<NodeRunStatus>()`), чтобы движку не нужен был
 * `as RunStatus` при записи пропуска (KI-336).
 */
export const NODE_RUN_STATUSES = [...WORKFLOW_RUN_STATUSES, 'skipped'] as const;

/** Статус строки `node_runs` (KI-336). */
export type NodeRunStatus = (typeof NODE_RUN_STATUSES)[number];

/**
 * Прежнее имя списка статусов запуска (KI-336).
 *
 * Оставлено для совместимости: `src/runs/dto/run-stream-message.dto.ts` выводит
 * из него схему статуса запуска и добавляет `skipped` только для узла. После
 * перевода этого DTO на {@link NODE_RUN_STATUSES} псевдоним можно удалить.
 *
 * @deprecated используйте {@link WORKFLOW_RUN_STATUSES}
 */
export const RUN_STATUSES = WORKFLOW_RUN_STATUSES;

/**
 * users — учётные записи (R6.1a, KI-106).
 *
 * Пароль хранится как `scrypt$<salt_b64>$<hash_b64>` (node:crypto, без
 * внешних зависимостей), соль уникальна на пользователя.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Строка таблицы `users`. */
export type User = typeof users.$inferSelect;
/** Значения для INSERT в `users`. */
export type NewUser = typeof users.$inferInsert;

/**
 * refresh_tokens — opaque refresh-токены (R6.1b, KI-201/KI-206).
 *
 * В БД хранится только sha256-хэш: дамп таблицы не даёт возможности войти.
 * Ротация не удаляет строку, а помечает `revokedAt` — так видно историю
 * использования токена (и повторное использование отозванного ловится).
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Строка таблицы `refresh_tokens`. */
export type RefreshToken = typeof refreshTokens.$inferSelect;
/** Значения для INSERT в `refresh_tokens`. */
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

/**
 * workflows — определение графа (узлы + связи), принадлежащее пользователю.
 */
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  // R6.1a: владелец — uuid пользователя. До 0004 колонка была `text` со
  // значением 'demo-user', миграция переводит её на системного пользователя.
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  nodes: jsonb('nodes').$type<NodeDto[]>().notNull().default([]),
  edges: jsonb('edges').$type<EdgeDto[]>().notNull().default([]),
  version: integer('version').notNull().default(1),
  // Задел под R6.2 (Share): публичная ссылка на граф.
  shareToken: uuid('share_token').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * workflow_runs — один запуск workflow. snapshot хранит копию nodes+edges
 * на момент запуска, чтобы история не зависела от последующих правок графа.
 */
export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending').$type<RunStatus>(),
  inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
  outputs: jsonb('outputs').$type<Record<string, unknown>>().default({}),
  error: text('error'),
  snapshot: jsonb('snapshot').$type<GraphSnapshotDto>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

/**
 * node_runs — выполнение отдельного узла внутри запуска workflow.
 * nodeId ссылается на id узла внутри snapshot, а не на отдельную таблицу.
 */
export const nodeRuns = pgTable(
  'node_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    // KI-336: у узла статус шире, чем у запуска — есть `skipped` (KI-288).
    status: text('status').notNull().default('pending').$type<NodeRunStatus>(),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().default({}),
    outputs: jsonb('outputs').$type<Record<string, unknown>>().default({}),
    error: text('error'),
    logs: jsonb('logs').$type<string[]>().default([]),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    /**
     * Стоимость media-генерации в рублях (RUB). У LLM-узлов — NULL:
     * media-провайдеры (CreativeLab) тарифицируют в рублях, и сводить их с
     * USD в одной колонке нельзя (RULES 4.23 — валюты не смешиваются).
     */
    costRub: numeric('cost_rub', { precision: 10, scale: 6 }),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    // KI-031: ключ идемпотентности для UPSERT при повторном прогоне графа —
    // на один запуск узел имеет ровно одну строку истории.
    uniqueIndex('node_runs_run_id_node_id_uniq').on(table.runId, table.nodeId),
  ],
);

export const workflowsRelations = relations(workflows, ({ many }) => ({
  runs: many(workflowRuns),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [workflowRuns.workflowId],
    references: [workflows.id],
  }),
  nodeRuns: many(nodeRuns),
}));

export const nodeRunsRelations = relations(nodeRuns, ({ one }) => ({
  run: one(workflowRuns, {
    fields: [nodeRuns.runId],
    references: [workflowRuns.id],
  }),
}));

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type NodeRun = typeof nodeRuns.$inferSelect;
export type NewNodeRun = typeof nodeRuns.$inferInsert;
