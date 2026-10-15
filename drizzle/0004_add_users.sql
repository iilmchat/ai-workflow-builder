CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);--> statement-breakpoint
-- R6.1a (KI-106): системный пользователь для dev/CI (AUTH_DISABLED=true).
-- id детерминированный: совпадает с DEMO_USER_ID в src/auth/auth.constants.ts.
INSERT INTO "users" ("id", "email", "password_hash")
VALUES (
	'00000000-0000-0000-0000-000000000001',
	'system@workflow-builder.local',
	'scrypt$disabled$disabled'
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- Задел под R6.2 (Share): публичная ссылка на граф.
ALTER TABLE "workflows" ADD COLUMN "share_token" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_share_token_unique" UNIQUE("share_token");--> statement-breakpoint
-- R6.1a: до этой миграции user_id был text и содержал произвольные строки
-- ('demo-user' и значения из смоуков). Это не uuid, поэтому сначала переводим
-- их на системного пользователя и только затем меняем тип колонки.
UPDATE "workflows"
SET "user_id" = '00000000-0000-0000-0000-000000000001'
WHERE "user_id" IS NULL
   OR "user_id" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "user_id" SET DATA TYPE uuid USING "user_id"::uuid;--> statement-breakpoint
ALTER TABLE "workflows" ALTER COLUMN "user_id" SET NOT NULL;
