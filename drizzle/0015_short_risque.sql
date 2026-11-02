CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_id_idx" ON "audit_logs" USING btree ("organization_id","created_at","id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('owner', 'admin', 'member', 'viewer'));--> statement-breakpoint
-- v1.0.0 S3 (DESIGN V100 § 3.2): существующие пользователи — единственные
-- члены своих личных организаций, созданных бэкфиллом S1, поэтому они
-- владельцы. DEFAULT 'member' остаётся безопасным дефолтом для будущих
-- участников (S5), а регистрация (`AuthService.registerAsync`) ставит 'owner'
-- явно для создателя организации.
UPDATE "users" SET "role" = 'owner';