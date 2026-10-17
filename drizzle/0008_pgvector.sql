-- R7.4a (DESIGN v0.9 § 3.4): расширение pgvector.
-- Создаётся ДО таблиц: тип `vector(1536)` без расширения неизвестен.
-- `IF NOT EXISTS` — миграция идемпотентна на БД, где расширение уже включено
-- вручную (например, при локальной отладке).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "workflow_memory" (
	"workflow_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_memory_workflow_id_key_pk" PRIMARY KEY("workflow_id","key")
);
--> statement-breakpoint
CREATE TABLE "workflow_vectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_memory" ADD CONSTRAINT "workflow_memory_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_vectors" ADD CONSTRAINT "workflow_vectors_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_vectors_collection_idx" ON "workflow_vectors" USING btree ("workflow_id","collection");--> statement-breakpoint
-- R7.4a: HNSW-индекс для косинусного поиска (`<=>`).
-- Drizzle-схема его не описывает: `db:generate` не умеет `CREATE EXTENSION`,
-- поэтому индекс добавлен в миграцию raw-SQL (см. `src/db/schema.ts`).
-- HNSW выбран вместо IVFFlat: не требует обучения по данным (IVFFlat строится
-- по кластерам и на пустой/малой таблице даёт плохой recall), поддерживает
-- инкрементальные INSERT без переиндексации и лучше держит фильтр по
-- `workflow_id`/`collection` в паре с btree-индексом.
CREATE INDEX "workflow_vectors_embedding_idx"
  ON "workflow_vectors" USING hnsw ("embedding" vector_cosine_ops);