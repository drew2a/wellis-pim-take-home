-- ADR-0011 item 1: an evaluation must explain itself from its own row, so it stores the verdict
-- in the engine's own vocabulary and the inputs the rules saw. NOT NULL without a backfill is
-- safe here and nowhere else in this schema: nothing has ever written eligibility_evaluations,
-- so the table is empty in every environment (the history audit on this branch is its first
-- writer). The partial index is item 2: a shadow row is derived from (intake, ruleset) and is
-- recomputed on every run, which needs a conflict target, while Part B's rows record what a
-- patient was told at submission and each of those is a new fact.
CREATE TYPE "public"."engine_outcome" AS ENUM('auto_rejected', 'auto_flagged', 'auto_cleared', 'not_evaluable');--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD COLUMN "engine_outcome" "engine_outcome" NOT NULL;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD COLUMN "inputs" jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "eligibility_evaluations_shadow_unique" ON "eligibility_evaluations" USING btree ("intake_id","ruleset_version") WHERE "eligibility_evaluations"."shadow";