# ADR-0008: Amendments to ADR-0004, 0006 and 0007: re-runs under immutability, patient membership, provenance

- **Status:** proposed
- **Date:** 2026-09-11
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A15, R-A16, R-A17, R-B20, R-B21, R-C4 · **Amends:** ADR-0004
  (idempotency keys, provenance wording, review-item and patient constraints), ADR-0006 (what "a
  patient's records" means after a merge), ADR-0007 (the alias-table join; the second URL)

## Context and problem statement

The review of `feature/schema` found six places where ADR-0007's append-only trigger, the keys of
ADR-0004 and the merge path of ADR-0006 contradict each other or leave a promise without a
mechanism: two evidence tables cannot be re-run idempotently, a merged patient's new-flow consent
events become unreachable by the documented join, a corrected normalisation record cannot be
inserted, the provenance column ADR-0004 promises on every importer row does not exist on three
tables, `MIGRATION_URL` looks like the second connection string ADR-0007 argued against, and
three cross-column invariants are enforced nowhere. Accepted ADRs are immutable, so each is
amended here, in one place, because all six stem from the same tension: what is evidence is
immutable, and the importer must still be able to run twice.

## Decision drivers

- Two consecutive runs yield identical row counts in every table but `import_runs` (R-A15, R-A16).
- Evidence is never rewritten (R-A7, R-B21, ADR-0007); a correction is a new row.
- No query may lose a merged patient's records (R-C4, ADR-0006).
- Constraints live in the database, not only in code (ADR-0003).
- KISS: one role, one secret, one connection string per purpose.

## Decision outcome

| # | Replaces | With | Because |
| --- | --- | --- | --- |
| 1 | ADR-0004, Idempotency: identical counts on a second run, with no key on `consent_events` or `audit_entries` to make that true under ADR-0007's trigger | `consent_events`: partial unique index on `source_line` where not null. `audit_entries`: nullable `dedupe_key` with a unique index; importer-written entries set it deterministically from `(entity_type, entity_id, from_state, to_state, reason)`, human entries leave it null. Both loads are `INSERT ... ON CONFLICT DO NOTHING`. | The trigger forbids delete-and-rewrite, so a re-run needs a conflict target. Legacy events carry a line number and new-flow events are never re-imported. Each human audit entry is a new event and must never collide. |
| 2 | ADR-0004 and ADR-0007: intakes and consent events are joined through `patient_legacy_ids`, "the only correct" join | A patient's records are the records of that patient and of every patient merged into it, transitively through `merged_into`. One repository function (or a recursive view) is the only way to answer "this patient's intakes / consent events / evaluations"; no query joins on the copied `patient_id` alone. `patient_legacy_ids` stays the `legacy_id` → patient resolution used at load and repointed on merge; it is not the membership mechanism. | New-flow rows have no legacy id, and `consent_events.patient_id` can never be repointed, so the alias join loses a merged new-flow patient's revocation. This states what ADR-0006 and ADR-0007 left implicit. |
| 3 | ADR-0004: `normalisation_records` unique on `(entity_type, entity_id, field, rule_code, from_value)` | Unique on `(entity_type, entity_id, field, rule_code, from_value, to_value)`, `NULLS NOT DISTINCT`. | A different `to_value` from a later importer version is a different fact about a different run; both rows stand, the canonical table holds the current value, and the human-owned-field rule of ADR-0004 still raises an item instead of rewriting. `NULLS NOT DISTINCT` keeps a rule that blanks a value (`to_value` null) deduplicated too. |
| 4 | ADR-0004, `import_runs`: "Every other row created by the importer carries `import_run_id`" | Raw, evidence and decision rows carry the run that wrote them (`import_run_id`; `review_items` keeps ADR-0004's `created_by_run` name because the item outlives the run that raised it). Canonical rows carry `created_by_run`, nullable for the new flow; `intakes` gains the column. Derived rows (`consent_states`) carry `computed_at` and `derivation_version`. `patient_legacy_ids` is a mapping and carries neither. | Canonical rows are rewritten from raw on every run, so "which run wrote this" means "which run created it"; a derived row is explained by its derivation, not by a run; a mapping has no provenance of its own. |
| 5 | ADR-0007, role split rejected partly for needing "a second connection string"; ADR-0003 and the README speak of one pooled connection string | `MIGRATION_URL` is the same role and the same secret through the Supabase session pooler instead of the transaction pooler, read by drizzle-kit only, because the transaction pooler does not support session-level features. It is not a second role, so ADR-0007's objection does not apply. The importer reads `DATABASE_URL`; the operator points it at whichever pooler fits. | drizzle-kit migrates in a session; the app runs in transactions. Nothing else changes. |
| 6 | ADR-0004: `resolution_note` required on resolve; `merged_into` a nullable self-reference; `bsn` and `bsn_check` independent columns | Three `CHECK` constraints: `status in ('resolved', 'dismissed')` implies `resolved_by` and `resolved_at` not null; `merged_into <> id`; `bsn is null` implies `bsn_check = 'absent'`. | A closed decision without actor and time is an audit gap (R-B20); a self-merge loops survivor resolution forever; a "valid" check on an absent number is a contradiction the database can refuse. |

### Consequences

- The importer branch loads `consent_events` and `audit_entries` with `ON CONFLICT DO NOTHING`
  and builds `audit_entries.dedupe_key` from the five fields above; the R-A16 double-run test
  covers both tables.
- The repository branch delivers the membership function (or view) of item 2 before any reader of
  intakes, consent events or evaluations, and `consent_states` is recomputed over the union it
  returns; ADR-0006's "intakes and consent events follow through the alias" is read as "follow
  through membership".
- A later importer version that changes a rule inserts a new `normalisation_records` row per
  affected value; the report counts rows per `(rule_code, importer_version)`, not per entity.
- `intakes.created_by_run` is filled by the importer and null for the new flow.
- `README.md` and `.env.example` describe `MIGRATION_URL` in item 5's terms and no longer claim
  the importer reads it.
- Bad: item 2 puts a rule in code that the database cannot enforce; accepted, because a recursive
  constraint is not expressible as a `CHECK`, and the function is one place to test.

### Confirmation

- `src/db/constraints.integration.test.ts`: a second `consent_events` row with the same
  `source_line` is rejected, two rows with null `source_line` are accepted; a second
  `audit_entries` row with the same `dedupe_key` is rejected, two rows with null `dedupe_key` are
  accepted; a `normalisation_records` row differing only in `to_value` is accepted, one identical
  in all six columns is rejected, also when `to_value` is null; each of the three `CHECK`s rejects
  its violation and accepts its complement.
- `src/db/schema.ts`: `intakes.created_by_run` references `import_runs`; `patient_legacy_ids` has
  no run column.
- Importer branch: the R-A16 double-run test asserts identical counts for `consent_events` and
  `audit_entries`.
- Repository branch: a unit test merges A into B and asserts B's membership returns A's
  intakes and consent events, including a new-flow event with no legacy id.

## More information

- ADR-0004 (tables, idempotency), ADR-0006 (merge path), ADR-0007 (append-only trigger,
  `MIGRATION_URL` context), ADR-0003 (constraints in the database).
- The review that raised the six items ran with `/code-review high feature/schema` on 2026-09-11;
  the declined findings are listed in the merge commit of `feature/schema`.
