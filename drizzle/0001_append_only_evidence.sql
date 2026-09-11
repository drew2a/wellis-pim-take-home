-- ADR-0007: what is evidence is immutable in the database; what is derived or decided is not.
-- One function, attached to every table ADR-0004 says is never updated. Statement-level BEFORE
-- triggers fire even when no row matches, so any attempt is rejected, not only a successful one.
-- A trigger rather than revoked privileges (ADR-0004 as written) because the Supabase pooler
-- gives one role per connection string; the trigger holds for every role in every environment.
CREATE FUNCTION reject_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is evidence and append-only; % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_entries_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER consent_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "consent_events"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER normalisation_records_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "normalisation_records"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER legacy_patients_raw_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "legacy_patients_raw"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER legacy_intakes_raw_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "legacy_intakes_raw"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
--> statement-breakpoint
CREATE TRIGGER legacy_consent_events_raw_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "legacy_consent_events_raw"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();
