CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- v1.0 S1: колонка добавляется NULLABLE намеренно. В существующей БД уже есть
-- данные (локально 69 users / 160 workflows), поэтому `ADD COLUMN ... NOT NULL`
-- без DEFAULT упал бы. Заполнение и включение NOT NULL делает backfill-скрипт
-- src/db/migrations/backfill-organizations.ts (шаг 7) — он же запускается из
-- migrate.ts в той же транзакции сразу после применения миграций.
ALTER TABLE "users" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
-- См. комментарий выше: NOT NULL для workflows включается после backfill.
ALTER TABLE "workflows" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_organization_id_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workflows_organization_id_idx" ON "workflows" USING btree ("organization_id");