# ADR-0004: Part A target schema, raw retention and idempotency

- **Status:** accepted
- **Date:** 2026-09-09
- **Deciders:** Andrei Andreev
- **Requirements:** R-A2, R-A5, R-A6, R-A7, R-A8, R-A12, R-A14, R-A15, R-A16, R-A17, R-B20, R-B21,
  R-C2, R-C4, R-C9 · **Resolves:** Q5 (default B), Q9 (amended, see `docs/findings.md`)

## Context and problem statement

The importer must load three legacy files into a schema of our own (R-A2) without losing a byte
(R-A8), record every automatic change (R-A7), park what it cannot decide (R-A11, R-A12), be
idempotent (R-A15) and never undo a human decision on re-run (R-A17, Q5). The column-by-column
analysis in `docs/findings.md` fixed *what* each field becomes; this ADR fixes *where* it lives and
how re-runs behave. Vocabulary is `CLAUDE.md` §6.

## Decision drivers

- Raw is kept, byte-faithful, before anything is interpreted (R-A8, `CLAUDE.md` §5).
- Every stored value that differs from raw has a normalisation record naming its rule (R-A7).
- A review item is a decision a human can act on; identical items from one rule collapse to one
  vocabulary-level item (`docs/findings.md`, the two-question check on every Agreed line).
- One legacy id resolves to exactly one patient forever, also after a merge (findings,
  `legacy_id`).
- Human decisions are immutable to the importer (Q5 B); a contradicting re-import raises a new item.
- Audit is append-only (R-B21); a legacy outcome has an actor ("legacy import") like any other.
- Constraints live in the database, not only in code (ADR-0003).

## Considered options

1. Raw tables per source file + canonical tables + separate `normalisation_records`,
   `review_items`, `audit_entries`, with an alias table for legacy ids.
2. Canonical tables only, with a JSONB `raw` column per row and change history inside it.
3. Event-sourced store: every import fact as an event, canonical tables as projections.

## Decision outcome

Chosen option: **Option 1**, because it keeps the raw copy queryable and diffable per source row,
makes the normalisation record a first-class table a reviewer can filter, and puts uniqueness,
foreign keys and enums where the database enforces them. Option 2 hides the raw copy inside the
row it explains and makes "what changed" a JSON walk; option 3 is more machinery than a seven-day
import needs (YAGNI).

### Tables

**Import bookkeeping**

- `import_runs` — id, `started_at`, `finished_at`, `importer_version`, `dry_run`, per-file sha256
  and byte size, report path. Every other row created by the importer carries `import_run_id`.

**Raw layer (byte-faithful)** — one table per source file, one row per source row or line, every
source column as `text` exactly as exported, untrimmed (so `active ` and `approved ` survive), plus
`source_file`, `line_no`, `row_hash`, `import_run_id`.

- `legacy_patients_raw`, unique on `legacy_id`.
- `legacy_intakes_raw`, unique on `intake_id`.
- `legacy_consent_events_raw`, unique on `line_no` (the file has no id; duplicate lines are
  impossible by construction of the key and are reported if a later export differs).

**Canonical layer**

- `patients` — `id` (uuid), `full_name`, `email` (canonical: trimmed, lowercased; null for
  placeholders and for the 10 internal-space addresses until resolved), `dob` (`date`, null when
  impossible), `sex` (enum `male | female | unknown`), `bsn` (`text`, `CHECK (bsn ~ '^[0-9]{9}$')`),
  `bsn_check` (enum `valid | invalid | absent`), `phone` (`text`, `CHECK (phone ~ '^\+316[0-9]{8}$')`),
  `city`, `weight_kg` (`numeric(5,1)`, null when unit unknown or implausible), `height_cm`
  (`integer`, null when implausible), `status` (enum `active | paused | churned | prospect | unknown`),
  `signup_date` (`date`), `source` (`text`), `merged_into` (nullable self-reference; a merged row
  stays and points at the survivor), `created_by_run`.
- `patient_legacy_ids` — `legacy_id` (primary key) → `patient_id`. Every legacy id resolves to
  exactly one patient; a merge repoints the losing id here and nowhere else. Intakes and consent
  events are joined through this table, never through a copied `patient_id` alone.
- `intakes` — `id`, `intake_id` (unique, text), `legacy_patient_id` (text, as exported),
  `patient_id` (nullable FK; null for the 21 orphans), `submitted_at` (`date`),
  `questionnaire_version_label` (text as exported), `questionnaire_version` (enum
  `v1 | v2 | v3`, null for empty; `2.0` maps to `v2` with rule `VERSION_LABEL_ASSUMED_V2`, ADR-0005), `weight_kg`, `height_cm`, `meds_current_raw`,
  `medication_report` (enum `none_reported | not_answered | reported`), `conditions_raw`,
  `condition_report` (same enum), `alcohol_units_week` (`integer`, null), `outcome` (enum
  `approved | rejected | pending | unknown`), `outcome_raw`, `reviewer_note`, `state` (enum shared
  with Part B: `legacy_approved | legacy_rejected | legacy_pending | legacy_expired | draft |
  submitted | auto_cleared | auto_flagged | auto_rejected | in_review | approved | rejected`),
  `ruleset_version` (null for legacy). Legacy states are reachable through the console's status
  filter and are not in the work queue (findings, `outcome`).
- `consent_events` — `id`, `patient_id` (FK via alias at load), `legacy_patient_id`, `type`,
  `action` (enum `granted | revoked`), `at` (**type open, see below**), `version`, `source_line`,
  `import_run_id`. Never updated.
- `eligibility_evaluations` — `id`, `intake_id`, `ruleset_version`, `outcome` (the engine's verdict),
  `reasons` (jsonb list of reason strings), `shadow` (boolean: true for legacy intakes evaluated at
  import, nothing applied), `evaluated_at`, `import_run_id` (nullable). Part B writes the same table
  with `shadow = false`. Legacy disagreements are a query over it, not queue items (ADR-0005).
- `consent_states` — `patient_id`, `type`, `state` (enum
  `granted | revoked | no_record | unknown_pre_log | conflict`), `derived_from_event_id`,
  `derivation_version`, `computed_at`. Recomputed by one pure function on import and on every new
  event (ADR-0005).

**Records and decisions**

- `normalisation_records` — `id`, `import_run_id`, `importer_version`, `entity_type`, `entity_id`,
  `field`, `from_value` (text, raw), `to_value` (text), `rule_code` (text, e.g.
  `DATE_ORDER_FROM_SEPARATOR`), `evidence` (jsonb: the P-n / H-n reference and counts), `created_at`.
  Unique on `(entity_type, entity_id, field, rule_code, from_value)` so a re-run cannot duplicate a
  record.
- `review_items` — `id`, `type` (enum `data_quality | identity_conflict | orphan_intake |
  duplicate_intake | consent | clinical_history | vocabulary`), `scope` (enum `row | vocabulary`),
  `title`, `reason` (the engine's reason string where one exists), `payload` (jsonb: competing
  versions side by side, or the row list of a vocabulary item), `proposed_resolution` (jsonb,
  nullable), `patient_id`, `intake_id` (nullable refs), `status` (enum `open | resolved | dismissed`),
  `field` (nullable; the canonical field the item is about), `dedupe_key` (unique, built from type,
  entity, **field**, rule and raw value: two ambiguous fields on one entity are two items by
  construction, and a re-run that would raise the same item finds it and does nothing, whether it
  is open or resolved, R-A17), `created_by_run`, `created_at`, `resolved_by`, `resolved_at`,
  `resolution_note` (required on resolve), `resolution` (jsonb: what was chosen or edited).
- `audit_entries` — append-only: `id`, `actor` (human identity or named process, e.g. `legacy
  import`, `importer`), `at`, `entity_type`, `entity_id`, `from_state`, `to_state`, `reason`,
  `review_item_id` (nullable), `changes` (jsonb list of `{field, from, to, source_legacy_id}`: for human decisions that change a
  value, and for the importer's tier-1 merges of ADR-0006, where it is the field-level provenance
  naming which row supplied each field and the survivor rule in `reason`). `UPDATE` and `DELETE` are revoked from the application role.

### Idempotency and re-runs

- Natural keys: `legacy_id`, `intake_id`, consent `line_no`. Loading a raw row whose key exists
  and whose `row_hash` is identical is a no-op. A different hash for an existing key means the
  source changed: the raw row is **not** overwritten; a `review_items` row of type `data_quality`,
  scope `row`, "source row changed since import run N" is raised with both versions in the payload.
- Canonical rows are rewritten from raw on every run **except** fields a human has touched: a
  field is human-owned when an `audit_entries` row with a human actor lists it in `changes` for that
  entity. The importer never writes such a field; if the raw value would now map differently, it
  raises a new review item referencing the old one.
- `review_items.dedupe_key` is deterministic from (type, entity, field, rule, raw value), so a
  re-run neither duplicates open items nor re-opens resolved ones.
- Two consecutive runs on the same export yield identical row counts in every table except
  `import_runs` (the R-A16 test).

### Open question carried into implementation

- **`consent_events.at` column type.** Legacy timestamps have no zone and the hour histogram says
  local Dutch time (findings, consents). New-flow events will carry a real zone, and one column
  holds one kind of time. Options: `timestamptz` with legacy values converted via
  `Europe/Amsterdam` and a per-row `TIMESTAMP_ZONE_ASSUMED` normalisation record, or `timestamp`
  without zone for all. Decided when the table is designed; recorded as an amendment to this ADR.

### Consequences

- Good: raw and canonical are separate tables, so "what did the export say" is a join, not a
  reconstruction; every count in the import report is a `COUNT(*)`.
- Good: the alias table makes merges reversible and keeps every legacy reference resolvable.
- Good: `dedupe_key` and the human-owned-field rule make R-A15 and R-A17 properties of the schema.
- Bad: three raw tables plus canonical tables plus three record tables is more surface than a
  single JSONB column; accepted, because each table answers one question a reviewer asks.
- Bad: the human-owned-field rule is a query against `audit_entries` on every re-run; accepted at
  this data volume, and it keeps provenance in one place instead of a shadow column per field.
- Neutral: plausibility bounds are enforced by the rules file (ADR-0005), not by `CHECK`
  constraints, so Part B can version them without a migration; the database only checks `> 0`.

### Confirmation

- Integration test: import twice, assert identical counts per table (R-A16).
- Integration test: resolve a review item as a human, re-import, assert the field is unchanged and
  no duplicate item exists (R-A17).
- `SELECT count(*) FROM legacy_patients_raw` = 2466, `legacy_intakes_raw` = 2917,
  `legacy_consent_events_raw` = 2643, and every raw row round-trips byte-for-byte to the source
  line.
- Attempting `UPDATE audit_entries` as the application role fails.

## More information

- `docs/findings.md` (every Agreed line), `docs/profile/data-profile.md`, `docs/profile/data-hypotheses.md`.
- ADR-0005 (rules and detectors), ADR-0006 (identity).
