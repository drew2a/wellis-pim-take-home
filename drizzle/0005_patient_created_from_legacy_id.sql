-- ADR-0011 item 18. patient_legacy_ids answers "whose records does this legacy id belong to now"
-- and a merge repoints it, so after one it no longer says which exported row built which
-- canonical row -- and the importer's next run, which rewrites canonical rows from raw, would
-- map a merged-away row onto its survivor and overwrite it. This column answers that question
-- and never changes. Null for a patient the new intake flow creates, which has no legacy row.
--
-- No backfill: a database that already holds patients was loaded by an importer that did not
-- merge, so every alias still points at the row it created. The next run fills the column.
ALTER TABLE "patients" ADD COLUMN "created_from_legacy_id" text;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_created_from_legacy_id_unique" UNIQUE("created_from_legacy_id");