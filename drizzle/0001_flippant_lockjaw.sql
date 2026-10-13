ALTER TABLE "workflow_runs" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "workflow_runs" SET "created_at" = "started_at" WHERE "started_at" IS NOT NULL;
