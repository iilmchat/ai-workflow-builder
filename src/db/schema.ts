import { desc, relations, sql } from 'drizzle-orm';
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
import type {
  EdgeDto,
  GraphSnapshotDto,
  NodeDto,
} from '../engine/dto/index.js';

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
 * запуск закрывается успешно, с ошибкой или отменой пользователем. `cancelled`
 * добавлен в v1.4.0 S1: отмена — финальное состояние запуска, и SSE-клиент
 * должен узнать о ней тем же событием, что и о `completed`/`failed`.
 */
export const TERMINAL_WORKFLOW_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
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
 * organizations — арендатор (workspace/tenant), v1.0 S1, DESIGN § 3.1.
 *
 * Верхний уровень изоляции данных: пользователь и его workflow принадлежат
 * организации, а слой доступа фильтрует запросы по `organizationId` (следующие
 * срезы v1.0). `ON DELETE CASCADE` на дочерних таблицах означает, что удаление
 * арендатора удаляет и его данные — «осиротевших» строк быть не может.
 *
 * UNIQUE на `name` намеренно **не** объявлен: имена двух арендаторов могут
 * совпасть, а идемпотентность backfill'а персональных организаций держится на
 * проверке `NOT EXISTS` по имени (`src/db/migrations/backfill-organizations.ts`),
 * а не на ограничении БД. Для демо-пользователя id детерминированный
 * (`DEMO_ORG_ID` в `src/auth/auth.constants.ts`), поэтому повторный backfill не
 * плодит организации.
 */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Строка таблицы `organizations`. */
export type Organization = typeof organizations.$inferSelect;
/** Значения для INSERT в `organizations`. */
export type NewOrganization = typeof organizations.$inferInsert;

/**
 * Роли пользователя в организации (v1.0.0 S3, DESIGN V100 § 3.2; полноценные
 * роли — S5).
 *
 * `owner` — создатель личной организации (единственная роль в S3; она даёт
 * доступ к `GET /admin/audit`). `admin` зарезервирован под S5 (управление
 * командой), `member`/`viewer` — будущие роли участников. Список — единый
 * источник для CHECK-ограничения, типов и guard'а.
 */
export const USER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

/** Роль пользователя в организации (v1.0.0 S3). */
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Роли, которые можно назначить приглашением в организацию (v1.0.0 S5).
 *
 * `owner` в список не входит: владелец — создатель организации, и второй
 * владелец через инвайт не появляется (DESIGN V100 S5). Список — единый источник
 * для CHECK-ограничения `organization_invitations.role`, Zod-схемы инвайта и
 * типа `InvitableUserRole`, поэтому UI и API не могут разойтись в допустимых
 * значениях (KI-563).
 */
export const INVITABLE_USER_ROLES = ['admin', 'member', 'viewer'] as const;

/** Роль, которую можно назначить приглашением в организацию (v1.0.0 S5). */
export type InvitableUserRole = (typeof INVITABLE_USER_ROLES)[number];

/**
 * users — учётные записи (R6.1a, KI-106; v1.0 S1 — арендатор; v1.0 S3 — роль).
 *
 * Пароль хранится как `scrypt$<salt_b64>$<hash_b64>` (node:crypto, без
 * внешних зависимостей), соль уникальна на пользователя.
 *
 * `organization_id` обязателен (NOT NULL): пользователь без организации
 * невозможен. Существующим пользователям персональные организации заводит
 * backfill (`src/db/migrations/backfill-organizations.ts`) — миграция добавляет
 * колонку nullable и включает NOT NULL только после заполнения данных.
 *
 * `role` (v1.0 S3) — роль в организации. Существующие пользователи S1 стали
 * единственными членами своих личных организаций, поэтому миграция 0015
 * проставляет им `owner`; регистрация (`AuthService.registerAsync`) создаёт
 * пользователя сразу с `owner`. DEFAULT `member` — безопасный дефолт для
 * будущих участников (S5), а не для создателя организации.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('member').$type<UserRole>(),
    /**
     * Версия access-токена (v1.1.0 S5, KI-601).
     *
     * Увеличивается при принудительном отзыве сессий (сейчас — удаление
     * участника из организации). `JwtAuthGuard` сверяет `ver` из токена с этим
     * значением; несовпадение — 401, токен перестаёт действовать, не дожидаясь
     * истечения 24 ч. DEFAULT 0 — старые токены без `ver` считаются версией 0.
     */
    tokenVersion: integer('token_version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('users_organization_id_idx').on(table.organizationId),
    // RULES 1.17: роль валидируется Zod на входе API, а прямые записи в БД
    // (миграции/ручные правки) ограничивает CHECK.
    check(
      'users_role_check',
      sql`${table.role} in ('owner', 'admin', 'member', 'viewer')`,
    ),
  ],
);

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
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
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
  },
  // KI-215: ежедневная очистка ищет строки по `expires_at < now()`;
  // без индекса каждый проход — seq scan по растущей таблице.
  (table) => [index('refresh_tokens_expires_at_idx').on(table.expiresAt)],
);

/** Строка таблицы `refresh_tokens`. */
export type RefreshToken = typeof refreshTokens.$inferSelect;
/** Значения для INSERT в `refresh_tokens`. */
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

/**
 * organization_invitations — приглашения в организацию (v1.0.0 S5, KI-563).
 *
 * Отдельная таблица, а не «приглашённые пользователи» в `users`: приглашённый
 * ещё не зарегистрирован, у него нет `password_hash`, и создавать заранее
 * пользователя с нерабочим паролем нельзя. Приглашение «созревает» при
 * регистрации: `AuthService.registerAsync` находит самое старое приглашение по
 * нормализованному email, создаёт пользователя в организации пригласившего с
 * указанной ролью и удаляет строку приглашения (в той же транзакции).
 *
 * **Принадлежность организации, а не токену (KI-554).** И `organization_id`, и
 * `invited_by` — NOT NULL: приглашение без арендатора/автора невозможно.
 * Роль приглашающего проверяет `OrgOwnerGuard`, причём по строке `users`, а не
 * по `orgId` из JWT: просроченный токен не даёт пригласить в чужую организацию.
 *
 * **Уникальность.** `UNIQUE (organization_id, email)` не даёт двум приглашениям
 * одной организации указывать на один email; гонка двух одновременных инвайтов
 * разрешается `ON CONFLICT DO NOTHING` + проверкой `.returning()` (KI-400), а не
 * 500-й ошибкой. Индекс `email` обслуживает поиск приглашения при регистрации —
 * выборку по email без организации (пригласить может любая организация).
 *
 * `ON DELETE CASCADE` с обеих сторон: удаление организации убирает её
 * приглашения, удаление пригласившего — тоже (он не может быть автором
 * несуществующей строки). CHECK на роль продублирован в БД, потому что Zod
 * валидирует только вход API, а не прямые записи (RULES 1.17).
 */
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().$type<InvitableUserRole>(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Один email — одно ожидающее приглашение в организации (KI-563).
    uniqueIndex('organization_invitations_org_email_uniq').on(
      table.organizationId,
      table.email,
    ),
    // Поиск приглашения при регистрации: email известен, организация ещё нет.
    index('organization_invitations_email_idx').on(table.email),
    check(
      'organization_invitations_role_check',
      sql`${table.role} in ('admin', 'member', 'viewer')`,
    ),
  ],
);

/** Строка таблицы `organization_invitations`. */
export type OrganizationInvitation =
  typeof organizationInvitations.$inferSelect;
/** Значения для INSERT в `organization_invitations`. */
export type NewOrganizationInvitation =
  typeof organizationInvitations.$inferInsert;

/**
 * Статусы строки `email_outbox` (v1.4.0 S3, KI-623).
 *
 * `pending` — письмо создано и ждёт воркера (в том числе между повторами
 * BullMQ); `sent` — SMTP принял письмо; `failed` — попытки исчерпаны или
 * задание не удалось поставить в очередь. Терминальные статусы — `sent` и
 * `failed`: повторная отправка возможна только вручную (KI-624).
 */
export const EMAIL_OUTBOX_STATUSES = ['pending', 'sent', 'failed'] as const;

/** Статус строки `email_outbox`. */
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

/**
 * email_outbox — исходящие письма-приглашения, ожидающие отправки (v1.4.0 S3,
 * KI-623).
 *
 * Зачем отдельная таблица, если есть BullMQ: payload задания в Redis — это
 * сериализованный снимок, который живёт там до `removeOnComplete`/`removeOnFail`
 * (сутки/неделю). Email приглашённого, название организации (у личной
 * организации — email владельца) и ссылка-приглашение являются PII и
 * одноразовым секретом, поэтому в Redis остаётся только `outboxId` — uuid
 * строки этой таблицы. Сам payload хранится в БД, где уже лежат приглашения,
 * и доступен воркеру после рестарта.
 *
 * `org_name` и `invite_link` — снимок на момент постановки: письмо должно
 * уйти с теми данными, которые видел приглашающий, даже если организацию
 * переименовали или ссылку пересобрали позже. `attempts` увеличивает воркер
 * перед каждой попыткой SMTP, `status` отражает доставку.
 *
 * Индекс `(status, created_at)` обслуживает будущую очистку/повторную
 * постановку (`WHERE status = 'failed' ORDER BY created_at`), которой пока нет
 * (KI-641). CHECK на статус продублирован в БД: Zod валидирует только payload
 * задания, а прямые записи/повреждённые данные — нет (RULES 1.17).
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // `to` — зарезервированное слово в SQL? Нет, но Drizzle сам квотирует
    // имена; колонка остаётся `to`, как в контракте payload.
    to: text('to').notNull(),
    orgName: text('org_name').notNull(),
    inviteLink: text('invite_link').notNull(),
    status: text('status')
      .notNull()
      .default('pending')
      .$type<EmailOutboxStatus>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Сколько раз воркер пытался отправить письмо (0 — попыток не было).
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [
    index('email_outbox_status_created_idx').on(table.status, table.createdAt),
    check(
      'email_outbox_status_check',
      sql`${table.status} in ('pending', 'sent', 'failed')`,
    ),
  ],
);

/** Строка таблицы `email_outbox`. */
export type EmailOutboxRow = typeof emailOutbox.$inferSelect;
/** Значения для INSERT в `email_outbox`. */
export type NewEmailOutboxRow = typeof emailOutbox.$inferInsert;

/**
 * audit_logs — журнал действий пользователей (v1.0.0 S3, DESIGN V100 § 3.2).
 *
 * Пишется `AuditInterceptor` после успешных мутирующих HTTP-запросов
 * (POST/PATCH/DELETE). Таблица append-only: строки не обновляются и не
 * удаляются сервисом; удаление пользователя/организации каскадно убирает и
 * журнал арендатора (`ON DELETE CASCADE`) — политика retention ещё не
 * определена (KI-565).
 *
 * `action` — строковый код вида `workflow.create`/`run.start` (см.
 * `src/audit/audit.constants.ts`); CHECK на набор не ставим, чтобы новое действие
 * не требовало миграции. `resource_id` — id затронутого объекта, если он
 * известен; `metadata` — санитизированные детали запроса (метод, путь, params,
 * тело без секретов, статус).
 *
 * Индекс `(organization_id, created_at, id)` обслуживает keyset-пагинацию
 * `GET /admin/audit` (`ORDER BY created_at DESC, id DESC`) и org-фильтр изоляции.
 * С v1.1.0 S3 (KI-585) добавлены индексы `(organization_id, action, created_at,
 * id)` и `(organization_id, user_id, created_at, id)` — под фильтры журнала по
 * действию и автору: порядок колонок повторяет `WHERE` + `ORDER BY`, поэтому
 * фильтрованная страница не требует сортировки всего журнала в памяти.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    index('audit_logs_org_created_id_idx').on(
      table.organizationId,
      table.createdAt,
      table.id,
    ),
    index('audit_logs_org_action_created_id_idx').on(
      table.organizationId,
      table.action,
      table.createdAt,
      table.id,
    ),
    index('audit_logs_org_user_created_id_idx').on(
      table.organizationId,
      table.userId,
      table.createdAt,
      table.id,
    ),
  ],
);

/** Строка таблицы `audit_logs`. */
export type AuditLog = typeof auditLogs.$inferSelect;
/** Значения для INSERT в `audit_logs`. */
export type NewAuditLog = typeof auditLogs.$inferInsert;

/**
 * workflows — определение графа (узлы + связи), принадлежащее пользователю
 * и его организации.
 *
 * `organization_id` (v1.0 S1) — арендатор, к которому относится граф;
 * `ON DELETE CASCADE` удаляет workflow вместе с организацией, а индекс
 * `workflows_organization_id_idx` обслуживает выборку графов арендатора.
 * Колонка NOT NULL: backfill проставляет её по владельцу
 * (`workflows.user_id → users.organization_id`) до включения ограничения.
 */
export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // R6.1a: владелец — uuid пользователя. До 0004 колонка была `text` со
    // значением 'demo-user', миграция переводит её на системного пользователя.
    userId: uuid('user_id').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    nodes: jsonb('nodes').$type<NodeDto[]>().notNull().default([]),
    edges: jsonb('edges').$type<EdgeDto[]>().notNull().default([]),
    version: integer('version').notNull().default(1),
    // Задел под R6.2 (Share): публичная ссылка на граф.
    shareToken: uuid('share_token').unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('workflows_organization_id_idx').on(table.organizationId),
    // KI-214: owner-фильтр (`WHERE user_id = $1`) в списке workflow и истории
    // запусков раньше сканировал таблицу целиком. Отдельный индекс нужен
    // именно по `user_id`: `organization_id` уже покрыт выше.
    index('workflows_user_id_idx').on(table.userId),
  ],
);

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
export type WorkflowCollaboratorRole =
  (typeof WORKFLOW_COLLABORATOR_ROLES)[number];

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
    invitedAt: timestamp('invited_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    placeholders: jsonb('placeholders').$type<string[]>().notNull().default([]),
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
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('workflow_vectors_collection_idx').on(
      table.workflowId,
      table.collection,
    ),
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
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
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
  inputs: jsonb('inputs')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  outputs: jsonb('outputs').$type<Record<string, unknown>>().default({}),
  error: text('error'),
  snapshot: jsonb('snapshot').$type<GraphSnapshotDto>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /**
   * Момент отмены запуска (v1.4.0 S1, DESIGN V140 § 3.1).
   *
   * `NULL` — запуск не отменяли. Поле ставится `POST /runs/:id/cancel` и
   * служит **флагом для движка**: `ExecutionEngineService` проверяет
   * `cancelled_at IS NOT NULL` перед каждым уровнем и каждым узлом и
   * останавливает выполнение. Для `pending`-запуска отмена сразу переводит
   * `status` в `cancelled`; для `running` — только выставляет это поле, а
   * финальный статус пишет `RunsProcessor` после остановки движка.
   */
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  /**
   * Срок аренды запуска (v0.11 S1, DESIGN § 3.3.1, KI-066).
   *
   * Heartbeat продлевает аренду (`RunLeaseService.renewAsync`), а
   * `RunsProcessor` считает запуск зависшим, когда `lease_expires_at <= now()`.
   * `NULL` — строка создана до v0.11: для неё работает прежний fallback по
   * `started_at` (`RUN_STALE_THRESHOLD_MS`), поэтому backfill не нужен.
   */
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  },
  // KI-540: история запусков листается keyset-пагинацией
  // `WHERE workflow_id = $1 ORDER BY created_at DESC, id DESC`; без индекса
  // это seq scan + sort по растущей таблице.
  (table) => [
    index('workflow_runs_workflow_id_created_at_idx').on(
      table.workflowId,
      desc(table.createdAt),
      desc(table.id),
    ),
  ],
);

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

/**
 * Платформы устройств для push-токенов (v1.5.0 S3, DESIGN V150 § 3 S3).
 *
 * Единый источник значений для CHECK-ограничения `device_tokens_platform_check`
 * и Zod-схемы `POST /notifications/register`: на Android токен выдаёт RuStore
 * Push SDK (S4-B), на iOS — APNs, web-push — из браузера. Список закрытый: неизвестная платформа означает
 * ошибку клиента, а не новый режим доставки, поэтому валидируется и на границе
 * API, и в БД (RULES 1.17).
 */
export const DEVICE_TOKEN_PLATFORMS = ['android', 'ios', 'web'] as const;

/** Платформа устройства для push-токена (v1.5.0 S3). */
export type DeviceTokenPlatform = (typeof DEVICE_TOKEN_PLATFORMS)[number];

/**
 * device_tokens — push-токены устройств пользователя (v1.5.0 S3, миграция 0021).
 *
 * Токен провайдера уникален **глобально**, а не в рамках пользователя: одно и то же
 * устройство может войти другим аккаунтом, и тогда строка должна переехать к
 * новому владельцу, а не задвоиться. Поэтому `UNIQUE (token)` работает как
 * ключ UPSERT'а: `INSERT ... ON CONFLICT (token) DO UPDATE SET user_id,
 * organization_id` (см. `DeviceTokensService.upsertAsync`). Поля `platform` и
 * `created_at` при конфликте не обновляются — платформа устройства не меняется,
 * а дата первой регистрации остаётся историей.
 *
 * `organization_id` денормализован (его можно вывести из `users`), потому что
 * будущая отправка push пойдёт выборкой токенов арендатора; значение всегда
 * пишется из строки `users` (KI-554), а не из `orgId` access-токена.
 *
 * `ON DELETE CASCADE` с обеих сторон (RULES 4.26): удаление пользователя или
 * организации не оставляет «висячих» токенов, на которые некому слать push.
 * Индекс `device_tokens_user_id_idx` обслуживает выборку токенов пользователя
 * (например, отзыв при выходе), а UNIQUE-констрейнт — поиск по токену.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: text('platform').notNull().$type<DeviceTokenPlatform>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('device_tokens_user_id_idx').on(table.userId),
    // RULES 1.17: платформу валидирует Zod на входе API, а прямые записи в
    // БД ограничивает CHECK — набор значений совпадает с DEVICE_TOKEN_PLATFORMS.
    check(
      'device_tokens_platform_check',
      sql`${table.platform} in ('android', 'ios', 'web')`,
    ),
  ],
);

/** Строка таблицы `device_tokens`. */
export type DeviceToken = typeof deviceTokens.$inferSelect;
/** Значения для INSERT в `device_tokens`. */
export type NewDeviceToken = typeof deviceTokens.$inferInsert;

export const workflowsRelations = relations(workflows, ({ many }) => ({
  runs: many(workflowRuns),
}));

export const workflowRunsRelations = relations(
  workflowRuns,
  ({ one, many }) => ({
    workflow: one(workflows, {
      fields: [workflowRuns.workflowId],
      references: [workflows.id],
    }),
    nodeRuns: many(nodeRuns),
  }),
);

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
