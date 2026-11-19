ALTER TABLE "workflow_collaborators" DROP CONSTRAINT "workflow_collaborators_invited_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_collaborators" ADD CONSTRAINT "workflow_collaborators_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;