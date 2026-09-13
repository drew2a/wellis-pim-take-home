CREATE TYPE "public"."reviewer_role" AS ENUM('doctor', 'ops');--> statement-breakpoint
CREATE TABLE "reviewers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" "reviewer_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "intakes" ALTER COLUMN "intake_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "audit_entries_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "actor_reviewer_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD COLUMN "ruleset_version" text;--> statement-breakpoint
-- ADR-0015 item 1: the column is NOT NULL going forward, but rows written before this migration
-- cannot be backfilled without re-running the engine. They are all shadow rows, which every import
-- run rewrites, so they get '[]' once and the default is dropped immediately: a later insert must
-- supply the value. A database seeded before this migration has to be re-imported before the age
-- carve-out of ADR-0014 item 3 means anything.
ALTER TABLE "eligibility_evaluations" ADD COLUMN "matched" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ALTER COLUMN "matched" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "intakes" ADD COLUMN "answers" jsonb;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_reviewer_id_reviewers_id_fk" FOREIGN KEY ("actor_reviewer_id") REFERENCES "public"."reviewers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_actor_reviewer_id_idx" ON "audit_entries" USING btree ("actor_reviewer_id");--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_seq_unique" UNIQUE("seq");--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_legacy_rows_keep_their_intake_id" CHECK ("intakes"."created_by_run" is null or "intakes"."intake_id" is not null);--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_answers_only_for_new_flow" CHECK ("intakes"."answers" is null or "intakes"."created_by_run" is null);