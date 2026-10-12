import { relations } from 'drizzle-orm';
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** Значения колонки workflow_runs.status / node_runs.status. */
export const RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * workflows — определение графа (узлы + связи), принадлежащее пользователю.
 */
export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  nodes: jsonb('nodes').notNull().default([]),
  edges: jsonb('edges').notNull().default([]),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
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
  inputs: jsonb('inputs').notNull().default({}),
  outputs: jsonb('outputs').default({}),
  error: text('error'),
  snapshot: jsonb('snapshot').notNull(),
  startedAt: timestamp('started_at').defaultNow(),
  finishedAt: timestamp('finished_at'),
});

/**
 * node_runs — выполнение отдельного узла внутри запуска workflow.
 * nodeId ссылается на id узла внутри snapshot, а не на отдельную таблицу.
 */
export const nodeRuns = pgTable('node_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => workflowRuns.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  nodeType: text('node_type').notNull(),
  status: text('status').notNull().default('pending').$type<RunStatus>(),
  inputs: jsonb('inputs').default({}),
  outputs: jsonb('outputs').default({}),
  error: text('error'),
  logs: jsonb('logs').default([]),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
});

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
