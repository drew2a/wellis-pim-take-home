# Schema

The tables of [ADR-0004](adr/0004-part-a-schema-and-idempotency.md), grouped as that ADR groups
them, with the two amendments of [ADR-0007](adr/0007-amendments-to-adr-0004-append-only-evidence-and-consent-timestamps.md):
the append-only lock is a trigger on every evidence table, and consent timestamps are instants.
Constraints live in the database (ADR-0003); the diagram below is rendered from the Drizzle
schema, so what it shows is what `npm run db:migrate` creates. Vocabulary is `CLAUDE.md` §6.

## What changes, and what never does

**Import bookkeeping** — `import_runs`. One row per run of `npm run import`, inserted when the
run starts; `finished_at` and `report_path` are filled when it ends. Every row the importer
writes elsewhere points back here. Rows are never deleted: "import run N" in a review item must
stay resolvable.

**Raw** — `legacy_patients_raw`, `legacy_intakes_raw`, `legacy_consent_events_raw`. One row per
source row or line, every column as exported, untrimmed. Written by the importer only, insert
only: a re-run that meets an existing key with the same `row_hash` does nothing, and one that
meets a different hash raises a review item and leaves the row alone. The trigger rejects UPDATE,
DELETE and TRUNCATE. Whatever happens downstream, "what did the export say" is a query here.

**Canonical** — `patients`, `patient_legacy_ids`, `intakes`, `consent_states`. What the
application acts on. The importer rewrites these from raw on every run, except fields a human has
touched (an `audit_entries` row with a human actor lists the field). Humans change them through
the API, and every such change writes an audit entry. A merge repoints `patient_legacy_ids` and
sets `merged_into` on the losing patient; nothing else moves. `consent_states` is recomputed by
one pure function from `consent_events` and never edited by hand.

**Evidence** — `consent_events`, `normalisation_records`, `audit_entries`. What happened, who
said so, and what we did to a value and why. Insert only, enforced by the same trigger as the raw
tables. A wrong row is corrected by a new row and an audit entry naming the actor and the
reason, never by editing the old one.

**Decisions** — `review_items`, `eligibility_evaluations`. Decisions we could not make safely and
handed to a human, and decisions the engine made. A review item is created once per
`dedupe_key`, so a re-run neither duplicates an open item nor re-opens a resolved one; its
`status`, `resolution` and `resolution_note` are what a reviewer changes, with an audit entry
per change. `eligibility_evaluations` gains one row per evaluation, `shadow = true` for legacy
intakes evaluated at import where nothing is applied; disagreement with a legacy outcome is a
query over it, not a queue item.

## Diagram

Cardinality: `||` exactly one parent, `|o` zero or one (nullable foreign key), `o{` zero or more
children. Column notes: `enum` for enumerated columns, `null` for nullable ones; everything else
is NOT NULL.

<!-- BEGIN GENERATED: npm run schema:diagram -->

Generated from `src/db/schema.ts` and `drizzle/` by `npm run schema:diagram`; do not edit by hand.
Append-only (UPDATE, DELETE and TRUNCATE rejected by trigger): `audit_entries`, `consent_events`, `legacy_consent_events_raw`, `legacy_intakes_raw`, `legacy_patients_raw`, `normalisation_records`.

```mermaid
erDiagram
  %% import bookkeeping
  import_runs["import_runs — import bookkeeping"] {
    integer id PK
    timestamptz started_at
    timestamptz finished_at "null"
    text importer_version
    boolean dry_run
    text patients_sha256
    integer patients_bytes
    text intakes_sha256
    integer intakes_bytes
    text consents_sha256
    integer consents_bytes
    text report_path "null"
  }
  %% raw
  legacy_patients_raw["legacy_patients_raw — raw, append-only"] {
    text legacy_id PK
    text full_name
    text email
    text dob
    text sex
    text bsn
    text phone
    text city
    text weight
    text weight_unit
    text height_cm
    text status
    text signup_date
    text source
    text source_file
    integer line_no
    text row_hash
    integer import_run_id FK
  }
  legacy_intakes_raw["legacy_intakes_raw — raw, append-only"] {
    text intake_id PK
    text legacy_patient_id
    text submitted_at
    text questionnaire_version
    text weight
    text height
    text meds_current
    text conditions
    text alcohol_units_week
    text outcome
    text reviewer_note
    text source_file
    integer line_no
    text row_hash
    integer import_run_id FK
  }
  legacy_consent_events_raw["legacy_consent_events_raw — raw, append-only"] {
    text patient_legacy_id
    text type
    text action
    text at
    text version
    text source_file
    integer line_no PK
    text row_hash
    integer import_run_id FK
  }
  %% canonical
  patients["patients — canonical"] {
    uuid id PK
    text full_name
    text email "null"
    date dob "null"
    sex sex "enum"
    text bsn "null"
    bsn_check bsn_check "enum"
    text phone "null"
    text city "null"
    numeric(5,1) weight_kg "null"
    integer height_cm "null"
    patient_status status "enum"
    date signup_date "null"
    text source "null"
    uuid merged_into FK "null"
    integer created_by_run FK "null"
  }
  patient_legacy_ids["patient_legacy_ids — canonical"] {
    text legacy_id PK
    uuid patient_id FK
  }
  intakes["intakes — canonical"] {
    uuid id PK
    text intake_id UK
    text legacy_patient_id "null"
    uuid patient_id FK "null"
    date submitted_at "null"
    text questionnaire_version_label "null"
    questionnaire_version questionnaire_version "enum, null"
    numeric(5,1) weight_kg "null"
    integer height_cm "null"
    text meds_current_raw "null"
    history_report medication_report "enum"
    text conditions_raw "null"
    history_report condition_report "enum"
    integer alcohol_units_week "null"
    outcome outcome "enum"
    text outcome_raw "null"
    text reviewer_note "null"
    intake_state state "enum"
    text ruleset_version "null"
  }
  consent_states["consent_states — canonical"] {
    uuid patient_id PK,FK
    text type PK
    consent_state state "enum"
    uuid derived_from_event_id FK "null"
    text derivation_version
    timestamptz computed_at
  }
  %% evidence
  consent_events["consent_events — evidence, append-only"] {
    uuid id PK
    uuid patient_id FK "null"
    text legacy_patient_id "null"
    text type
    consent_action action "enum"
    timestamptz at
    text version "null"
    integer source_line "null"
    integer import_run_id FK "null"
  }
  normalisation_records["normalisation_records — evidence, append-only"] {
    uuid id PK
    integer import_run_id FK "null"
    text importer_version
    text entity_type
    text entity_id
    text field
    text from_value
    text to_value "null"
    text rule_code
    jsonb evidence
    timestamptz created_at
  }
  audit_entries["audit_entries — evidence, append-only"] {
    uuid id PK
    text actor
    timestamptz at
    text entity_type
    text entity_id
    text from_state "null"
    text to_state "null"
    text reason
    uuid review_item_id FK "null"
    jsonb changes "null"
  }
  %% decisions
  review_items["review_items — decisions"] {
    uuid id PK
    review_item_type type "enum"
    review_item_scope scope "enum"
    text title
    text reason "null"
    jsonb payload
    jsonb proposed_resolution "null"
    uuid patient_id FK "null"
    uuid intake_id FK "null"
    review_item_status status "enum"
    text field "null"
    text dedupe_key UK
    integer created_by_run FK "null"
    timestamptz created_at
    text resolved_by "null"
    timestamptz resolved_at "null"
    text resolution_note "null"
    jsonb resolution "null"
  }
  eligibility_evaluations["eligibility_evaluations — decisions"] {
    uuid id PK
    uuid intake_id FK
    text ruleset_version
    outcome outcome "enum"
    jsonb reasons
    boolean shadow
    timestamptz evaluated_at
    integer import_run_id FK "null"
  }
  %% foreign keys
  import_runs ||--o{ legacy_patients_raw : import_run_id
  import_runs ||--o{ legacy_intakes_raw : import_run_id
  import_runs ||--o{ legacy_consent_events_raw : import_run_id
  patients |o--o{ patients : merged_into
  import_runs |o--o{ patients : created_by_run
  patients ||--o{ patient_legacy_ids : patient_id
  patients |o--o{ intakes : patient_id
  patients ||--o{ consent_states : patient_id
  consent_events |o--o{ consent_states : derived_from_event_id
  patients |o--o{ consent_events : patient_id
  import_runs |o--o{ consent_events : import_run_id
  import_runs |o--o{ normalisation_records : import_run_id
  review_items |o--o{ audit_entries : review_item_id
  patients |o--o{ review_items : patient_id
  intakes |o--o{ review_items : intake_id
  import_runs |o--o{ review_items : created_by_run
  intakes ||--o{ eligibility_evaluations : intake_id
  import_runs |o--o{ eligibility_evaluations : import_run_id
```

| enum | values |
| --- | --- |
| `bsn_check` | `valid`, `invalid`, `absent` |
| `consent_action` | `granted`, `revoked` |
| `consent_state` | `granted`, `revoked`, `no_record`, `unknown_pre_log`, `conflict` |
| `history_report` | `none_reported`, `not_answered`, `reported` |
| `intake_state` | `legacy_approved`, `legacy_rejected`, `legacy_pending`, `legacy_expired`, `draft`, `submitted`, `auto_cleared`, `auto_flagged`, `auto_rejected`, `in_review`, `approved`, `rejected` |
| `outcome` | `approved`, `rejected`, `pending`, `unknown` |
| `patient_status` | `active`, `paused`, `churned`, `prospect`, `unknown` |
| `questionnaire_version` | `v1`, `v2`, `v3` |
| `review_item_scope` | `row`, `vocabulary` |
| `review_item_status` | `open`, `resolved`, `dismissed` |
| `review_item_type` | `data_quality`, `identity_conflict`, `orphan_intake`, `duplicate_intake`, `consent`, `clinical_history`, `vocabulary` |
| `sex` | `male`, `female`, `unknown` |

<!-- END GENERATED -->
