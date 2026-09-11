CREATE TYPE "public"."bsn_check" AS ENUM('valid', 'invalid', 'absent');--> statement-breakpoint
CREATE TYPE "public"."consent_action" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."consent_state" AS ENUM('granted', 'revoked', 'no_record', 'unknown_pre_log', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."history_report" AS ENUM('none_reported', 'not_answered', 'reported');--> statement-breakpoint
CREATE TYPE "public"."intake_state" AS ENUM('legacy_approved', 'legacy_rejected', 'legacy_pending', 'legacy_expired', 'draft', 'submitted', 'auto_cleared', 'auto_flagged', 'auto_rejected', 'in_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('approved', 'rejected', 'pending', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('active', 'paused', 'churned', 'prospect', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."questionnaire_version" AS ENUM('v1', 'v2', 'v3');--> statement-breakpoint
CREATE TYPE "public"."review_item_scope" AS ENUM('row', 'vocabulary');--> statement-breakpoint
CREATE TYPE "public"."review_item_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."review_item_type" AS ENUM('data_quality', 'identity_conflict', 'orphan_intake', 'duplicate_intake', 'consent', 'clinical_history', 'vocabulary');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female', 'unknown');--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"from_state" text,
	"to_state" text,
	"reason" text NOT NULL,
	"review_item_id" uuid,
	"changes" jsonb,
	"dedupe_key" text,
	CONSTRAINT "audit_entries_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid,
	"legacy_patient_id" text,
	"type" text NOT NULL,
	"action" "consent_action" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"version" text,
	"source_line" integer,
	"import_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "consent_states" (
	"patient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"state" "consent_state" NOT NULL,
	"derived_from_event_id" uuid,
	"derivation_version" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_states_patient_id_type_pk" PRIMARY KEY("patient_id","type")
);
--> statement-breakpoint
CREATE TABLE "eligibility_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" uuid NOT NULL,
	"ruleset_version" text NOT NULL,
	"outcome" "outcome" NOT NULL,
	"reasons" jsonb NOT NULL,
	"shadow" boolean NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"import_run_id" integer
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"importer_version" text NOT NULL,
	"dry_run" boolean NOT NULL,
	"patients_sha256" text NOT NULL,
	"patients_bytes" integer NOT NULL,
	"intakes_sha256" text NOT NULL,
	"intakes_bytes" integer NOT NULL,
	"consents_sha256" text NOT NULL,
	"consents_bytes" integer NOT NULL,
	"report_path" text
);
--> statement-breakpoint
CREATE TABLE "intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intake_id" text NOT NULL,
	"legacy_patient_id" text,
	"patient_id" uuid,
	"submitted_at" date,
	"questionnaire_version_label" text,
	"questionnaire_version" "questionnaire_version",
	"weight_kg" numeric(5, 1),
	"height_cm" integer,
	"meds_current_raw" text,
	"medication_report" "history_report" NOT NULL,
	"conditions_raw" text,
	"condition_report" "history_report" NOT NULL,
	"alcohol_units_week" integer,
	"outcome" "outcome" NOT NULL,
	"outcome_raw" text,
	"reviewer_note" text,
	"state" "intake_state" NOT NULL,
	"ruleset_version" text,
	"created_by_run" integer,
	CONSTRAINT "intakes_intake_id_unique" UNIQUE("intake_id"),
	CONSTRAINT "intakes_weight_kg_positive" CHECK ("intakes"."weight_kg" > 0),
	CONSTRAINT "intakes_height_cm_positive" CHECK ("intakes"."height_cm" > 0)
);
--> statement-breakpoint
CREATE TABLE "legacy_consent_events_raw" (
	"patient_legacy_id" text NOT NULL,
	"type" text NOT NULL,
	"action" text NOT NULL,
	"at" text NOT NULL,
	"version" text NOT NULL,
	"line_no" integer PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"row_hash" text NOT NULL,
	"import_run_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_intakes_raw" (
	"intake_id" text PRIMARY KEY NOT NULL,
	"legacy_patient_id" text NOT NULL,
	"submitted_at" text NOT NULL,
	"questionnaire_version" text NOT NULL,
	"weight" text NOT NULL,
	"height" text NOT NULL,
	"meds_current" text NOT NULL,
	"conditions" text NOT NULL,
	"alcohol_units_week" text NOT NULL,
	"outcome" text NOT NULL,
	"reviewer_note" text NOT NULL,
	"line_no" integer NOT NULL,
	"source_file" text NOT NULL,
	"row_hash" text NOT NULL,
	"import_run_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_patients_raw" (
	"legacy_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"dob" text NOT NULL,
	"sex" text NOT NULL,
	"bsn" text NOT NULL,
	"phone" text NOT NULL,
	"city" text NOT NULL,
	"weight" text NOT NULL,
	"weight_unit" text NOT NULL,
	"height_cm" text NOT NULL,
	"status" text NOT NULL,
	"signup_date" text NOT NULL,
	"source" text NOT NULL,
	"line_no" integer NOT NULL,
	"source_file" text NOT NULL,
	"row_hash" text NOT NULL,
	"import_run_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "normalisation_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" integer,
	"importer_version" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" text NOT NULL,
	"to_value" text,
	"rule_code" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normalisation_records_dedupe" UNIQUE NULLS NOT DISTINCT("entity_type","entity_id","field","rule_code","from_value","to_value")
);
--> statement-breakpoint
CREATE TABLE "patient_legacy_ids" (
	"legacy_id" text PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"dob" date,
	"sex" "sex" NOT NULL,
	"bsn" text,
	"bsn_check" "bsn_check" NOT NULL,
	"phone" text,
	"city" text,
	"weight_kg" numeric(5, 1),
	"height_cm" integer,
	"status" "patient_status" NOT NULL,
	"signup_date" date,
	"source" text,
	"merged_into" uuid,
	"created_by_run" integer,
	CONSTRAINT "patients_bsn_nine_digits" CHECK ("patients"."bsn" ~ '^[0-9]{9}$'),
	CONSTRAINT "patients_bsn_check_absent_when_null" CHECK ("patients"."bsn" is not null or "patients"."bsn_check" = 'absent'),
	CONSTRAINT "patients_phone_dutch_mobile" CHECK ("patients"."phone" ~ '^\+316[0-9]{8}$'),
	CONSTRAINT "patients_weight_kg_positive" CHECK ("patients"."weight_kg" > 0),
	CONSTRAINT "patients_height_cm_positive" CHECK ("patients"."height_cm" > 0),
	CONSTRAINT "patients_merged_into_not_self" CHECK ("patients"."merged_into" <> "patients"."id")
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "review_item_type" NOT NULL,
	"scope" "review_item_scope" NOT NULL,
	"title" text NOT NULL,
	"reason" text,
	"payload" jsonb NOT NULL,
	"proposed_resolution" jsonb,
	"patient_id" uuid,
	"intake_id" uuid,
	"status" "review_item_status" DEFAULT 'open' NOT NULL,
	"field" text,
	"dedupe_key" text NOT NULL,
	"created_by_run" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution" jsonb,
	CONSTRAINT "review_items_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "review_items_resolution_note_on_close" CHECK ("review_items"."status" = 'open' or "review_items"."resolution_note" is not null),
	CONSTRAINT "review_items_resolver_on_close" CHECK ("review_items"."status" = 'open' or ("review_items"."resolved_by" is not null and "review_items"."resolved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_states" ADD CONSTRAINT "consent_states_derived_from_event_id_consent_events_id_fk" FOREIGN KEY ("derived_from_event_id") REFERENCES "public"."consent_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eligibility_evaluations" ADD CONSTRAINT "eligibility_evaluations_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_created_by_run_import_runs_id_fk" FOREIGN KEY ("created_by_run") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_consent_events_raw" ADD CONSTRAINT "legacy_consent_events_raw_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_intakes_raw" ADD CONSTRAINT "legacy_intakes_raw_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_patients_raw" ADD CONSTRAINT "legacy_patients_raw_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalisation_records" ADD CONSTRAINT "normalisation_records_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_legacy_ids" ADD CONSTRAINT "patient_legacy_ids_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_merged_into_patients_id_fk" FOREIGN KEY ("merged_into") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_by_run_import_runs_id_fk" FOREIGN KEY ("created_by_run") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "public"."intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_created_by_run_import_runs_id_fk" FOREIGN KEY ("created_by_run") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "consent_events_source_line_unique" ON "consent_events" USING btree ("source_line") WHERE "consent_events"."source_line" is not null;