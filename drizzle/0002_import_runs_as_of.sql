-- Backfilled, not defaulted: a run recorded before this column existed judged "future" against
-- the wall clock of the day it ran, so its started_at date is the as-of it actually used. The
-- DEFAULT is dropped again so that every later run must supply --as-of explicitly (ADR-0009
-- item 5); leaving it in place would let a run silently adopt a date nobody chose.
ALTER TABLE "import_runs" ADD COLUMN "as_of" date NOT NULL DEFAULT CURRENT_DATE;--> statement-breakpoint
UPDATE "import_runs" SET "as_of" = ("started_at" AT TIME ZONE 'Europe/Amsterdam')::date;--> statement-breakpoint
ALTER TABLE "import_runs" ALTER COLUMN "as_of" DROP DEFAULT;
