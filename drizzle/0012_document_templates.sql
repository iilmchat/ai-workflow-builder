CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"content" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_bytes_check" CHECK ("document_templates"."bytes" > 0 AND "document_templates"."bytes" <= 5242880),
	CONSTRAINT "document_templates_content_size_check" CHECK (octet_length("document_templates"."content") = "document_templates"."bytes")
);
--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_templates_workflow_created_idx" ON "document_templates" USING btree ("workflow_id","created_at");