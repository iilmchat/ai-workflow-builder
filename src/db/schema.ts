import { relations, sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
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
 * Финальные статусы запуска — подмножество {@link WORKFLOW_RUN_STATUSES} (KI-353).
 *
 * С этими статусами публикуется событие `run_completed` (`RunEventSchema`):
 * запуск закрывается либо успешно, либо с ошибкой. `satisfies readonly
 * RunStatus[]` — компиляторная гарантия, что список не выйдет за пределы канона
 * статусов запуска, а локальный литерал в `run-event.dto.ts` не заводится
 * (RULES 4.15).
 */
export const TERMINAL_WORKFLOW_RUN_STATUSES = [
  'completed',
  'failed',
] as const satisfies readonly RunStatus[];

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
 * Роли участников workflow (R7.6, DESIGN v0.9 § 3.6, KI-197).
 *
 * `viewer` — только чтение (аналог share-ссылки, но по id пользователя);
 * `editor` — чтение + правка графа + запуск. Удаление workflow и управление
 * участниками остаются у владельца (`workflows.user_id`), поэтому роли
 * `owner` в таблице нет — владелец определяется по самой строке workflow.
 */
export const WORKFLOW_COLLABORATOR_ROLES = ['viewer', 'editor'] as const;

/** Роль участника workflow (R7.6). */
export type WorkflowCollaboratorRole = (typeof WORKFLOW_COLLABORATOR_ROLES)[number];

/**
 * workflow_collaborators — участники workflow по id пользователя (R7.6).
 *
 * Составной первичный ключ `(workflow_id, user_id)` не даёт пригласить одного
 * пользователя дважды. Оба `ON DELETE CASCADE` — удаление workflow или
 * пользователя не оставляет висячих строк. `invited_by` намеренно без
 * каскада: пригласивший обязан существовать (в текущем продукте пользователи
 * не удаляются, а каскад удалил бы запись участника вместе с пригласившим).
 * CHECK на роль продублирован в БД, потому что Zod валидирует только вход
 * API, а не прямые записи (RULES 1.17).
 */
export const workflowCollaborators = pgTable(
  'workflow_collaborators',
  {
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<WorkflowCollaboratorRole>().notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.workflowId, table.userId] }),
    check(
      'workflow_collaborators_role_check',
      sql`${table.role} in ('viewer', 'editor')`,
    ),
  ],
);

/** Строка таблицы `workflow_collaborators`. */
export type WorkflowCollaborator = typeof workflowCollaborators.$inferSelect;
/** Значения для INSERT в `workflow_collaborators`. */
export type NewWorkflowCollaborator = typeof workflowCollaborators.$inferInsert;

/**
 * Бинарная колонка PostgreSQL (v0.11 S1, DESIGN § 3.1.1).
 *
 * Drizzle pg-core не имеет встроенного `bytea`, поэтому тип объявляется через
 * `customType`: `data` — Buffer, `driverData` — Buffer (без преобразований).
 * Используется для содержимого DOCX-шаблонов (`document_templates.content`).
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * document_templates — загруженные .docx-шаблоны узла `document_gen`
 * (v0.11 S1, DESIGN § 3.1.1).
 *
 * Область видимости — **workflow, а не пользователь**: шаблон — часть
 * определения сценария, он должен быть доступен соавторам (`viewer`/`editor`)
 * и не «протекать» между чужими workflow. Проверка на запуске тривиальна:
 * `WHERE id = $templateId AND workflow_id = $runWorkflowId`.
 *
 * `placeholders` хранится в БД, потому что список извлекается при загрузке
 * (компиляция шаблона) и нужен списку/UI без повторного разбора 5 МБ на
 * каждый `GET`. CHECK-ограничения дублируют лимиты env на уровне БД (RULES
 * 1.17): `bytes` в допустимом диапазоне и совпадает с `octet_length(content)`
 * — иначе список и рендер увидели бы противоречивые метаданные.
 */
export const documentTemplates = pgTable(
  'document_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content: bytea('content').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    placeholders: jsonb('placeholders')
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('document_templates_workflow_created_idx').on(
      table.workflowId,
      table.createdAt,
    ),
    // DESIGN § 3.1.1: верхняя граница — DOCUMENT_TEMPLATE_MAX_BYTES (5 МБ).
    check(
      'document_templates_bytes_check',
      sql`${table.bytes} > 0 AND ${table.bytes} <= 5242880`,
    ),
    // DESIGN § 3.1.1: метаданные обязаны совпадать с фактическим размером.
    check(
      'document_templates_content_size_check',
      sql`octet_length(${table.content}) = ${table.bytes}`,
    ),
  ],
);

/** Строка таблицы `document_templates`. */
export type DocumentTemplate = typeof documentTemplates.$inferSelect;
/** Значения для INSERT в `document_templates`. */
export type NewDocumentTemplate = typeof documentTemplates.$inferInsert;

/**
 * Размерность вектора эмбеддинга (R7.4a, DESIGN v0.9 § 3.4).
 *
 * Зафиксирована колонкой `vector(1536)` — это размерность
 * `text-embedding-3-small`. Модель с другой размерностью (например
 * `text-embedding-3-large` — 3072) в эту колонку не помещается: executor
 * проверяет длину и падает понятной ошибкой, а не пишет обрезанный вектор.
 */
export const VECTOR_DIMENSIONS = 1536;

/**
 * workflow_vectors — векторы workflow-коллекций (R7.4a, KI-128).
 *
 * Одна таблица обслуживает все коллекции всех workflow: `collection` — это
 * логическое имя внутри workflow (аналог namespace), `workflow_id` изолирует
 * данные владельца workflow. `ON DELETE CASCADE` обязателен: удаление
 * workflow не должно оставлять «сиротские» векторы (RULES 4.26).
 *
 * HNSW-индекс по `embedding` (`vector_cosine_ops`) в Drizzle-схеме **не**
 * объявлен: drizzle-kit не умеет генерировать `CREATE EXTENSION vector`, а
 * индекс без расширения не создаётся. Поэтому расширение и HNSW-индекс
 * создаются вручную в `drizzle/0008_pgvector.sql` (raw SQL), а btree-индекс
 * `(workflow_id, collection)` объявлен здесь и генерируется штатно.
 */
export const workflowVectors = pgTable(
  'workflow_vectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    collection: text('collection').notNull(),
    embedding: vector('embedding', { dimensions: VECTOR_DIMENSIONS }).notNull(),
    /**
     * Исходное содержимое записи. Хранится объектом `{ text }`, а не голой
     * строкой: jsonb-колонка должна оставаться расширяемой (метаданные,
     * чанки, ссылки) без миграции.
     */
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    /** Произвольные метаданные записи (фильтры, источник, теги). */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('workflow_vectors_collection_idx').on(table.workflowId, table.collection),
  ],
);

/** Строка таблицы `workflow_vectors`. */
export type WorkflowVector = typeof workflowVectors.$inferSelect;
/** Значения для INSERT в `workflow_vectors`. */
export type NewWorkflowVector = typeof workflowVectors.$inferInsert;

/**
 * workflow_memory — key-value память workflow (R7.4a, KI-128).
 *
 * Первичный ключ `(workflow_id, key)` делает запись идемпотентной: повторный
 * `memory_write` по тому же ключу обновляет значение, а не плодит строки.
 * `value` — произвольный JSON: память хранит и строки, и объекты, и массивы.
 */
export const workflowMemory = pgTable(
  'workflow_memory',
  {
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workflowId, table.key] })],
);

/** Строка таблицы `workflow_memory`. */
export type WorkflowMemory = typeof workflowMemory.$inferSelect;
/** Значения для INSERT/UPDATE в `workflow_memory`. */
export type NewWorkflowMemory = typeof workflowMemory.$inferInsert;

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
  /**
   * Срок аренды запуска (v0.11 S1, DESIGN § 3.3.1, KI-066).
   *
   * Heartbeat продлевает аренду (`RunLeaseService.renewAsync`), а
   * `RunsProcessor` считает запуск зависшим, когда `lease_expires_at <= now()`.
   * `NULL` — строка создана до v0.11: для неё работает прежний fallback по
   * `started_at` (`RUN_STALE_THRESHOLD_MS`), поэтому backfill не нужен.
   */
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
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
    /**
     * Кэш-токены чтения (R7.7, KI-055/KI-150).
     *
     * Сколько входных токенов провайдер отдал из своего промпт-кэша
     * (`cache_read_input_tokens` Anthropic, `cached_tokens` OpenAI,
     * `prompt_cache_hit_tokens` DeepSeek). Такие токены стоят дешевле
     * обычных входных, поэтому стоимость считается отдельно
     * (`calculateCostUsd`). `NULL` — провайдер кэш не применял или не отдал
     * метрику; `0` не пишется, чтобы «кэша не было» не выглядело как факт.
     */
    cacheReadTokens: integer('cache_read_tokens'),
    /**
     * Кэш-токены записи (R7.7). Есть только у Anthropic
     * (`cache_creation_input_tokens`): такие токены стоят **дороже** обычных
     * входных (1.25×), поэтому их нельзя сваливать в `tokens_in`.
     */
    cacheCreationTokens: integer('cache_creation_tokens'),
    /**
     * Стабильная ссылка на сохранённый media-результат (R7.8, KI-362).
     *
     * Ссылки провайдеров (CreativeLab) живут 48 часов, поэтому после успешной
     * генерации файл скачивается к нам (`LocalMediaStorage` или S3) и
     * записывается своя ссылка. `outputs.resultUrls`/`outputs.mediaUrl`
     * остаются как есть — для совместимости и как fallback.
     */
    storedUrl: text('stored_url'),
    /**
     * Когда `stored_url` перестанет быть доступной (R7.8, KI-362).
     *
     * TTL локального хранилища (`MEDIA_STORAGE_LOCAL_TTL_DAYS`) или S3
     * (`S3_TTL_DAYS`). `NULL` — срок не задан (хранилище без TTL). UI по этому
     * полю показывает плейсхолдер «ссылка истекла».
     */
    storedExpiresAt: timestamp('stored_expires_at', { withTimezone: true }),
    /**
     * Ключ объекта в хранилище (KI-451, v0.10 S5).
     *
     * До этой колонки ключ S3 восстанавливался из `stored_url` парсингом
     * path-style URL (`<endpoint>/<bucket>/<key>`). Для virtual-hosted style
     * (`<bucket>.endpoint/<key>`), endpoint'а с префиксом пути или внешнего
     * URL-rewrite такой разбор не работает, и просроченный presigned URL
     * остаётся нерабочим (KI-443). Здесь ключ хранится явно: переподпись и
     * удаление файла идут по нему, а не по ссылке.
     *
     * `NULL` — запись сделана до v0.10 либо бэкенд не сохранял файл
     * (`MEDIA_STORAGE_BACKEND=none`); для документов ключ заполняется
     * `saveGeneratedAsync`.
     */
    storageKey: text('storage_key'),
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
