-- ADR-0011 item 18. patient_legacy_ids answers "whose records does this legacy id belong to now"
-- and a merge repoints it, so after one it no longer says which exported row built which
-- canonical row -- and the importer's next run, which rewrites canonical rows from raw, would
-- map a merged-away row onto its survivor and overwrite it. This column answers that question
-- and never changes. Null for a patient the new intake flow creates, which has no legacy row.
--
-- Backfilled from the alias table, which is the only place the answer exists for rows already
-- loaded: before this branch nothing merged, so every patient has exactly one alias and it is the
-- legacy row that created it. Without the backfill the next run would see every stored patient as
-- new and fail on the alias primary key.
ALTER TABLE "patients" ADD COLUMN "created_from_legacy_id" text;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_from_legacy_id_unique" UNIQUE("created_from_legacy_id");--> statement-breakpoint
UPDATE "patients" SET "created_from_legacy_id" = (
  SELECT MIN("legacy_id") FROM "patient_legacy_ids" WHERE "patient_id" = "patients"."id"
) WHERE "created_from_legacy_id" IS NULL;
