CREATE TABLE "workflow_collaborators" (
	"workflow_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invited_by" uuid NOT NULL,
	CONSTRAINT "workflow_collaborators_workflow_id_user_id_pk" PRIMARY KEY("workflow_id","user_id"),
	CONSTRAINT "workflow_collaborators_role_check" CHECK ("workflow_collaborators"."role" in ('viewer', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "workflow_collaborators" ADD CONSTRAINT "workflow_collaborators_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_collaborators" ADD CONSTRAINT "workflow_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_collaborators" ADD CONSTRAINT "workflow_collaborators_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;