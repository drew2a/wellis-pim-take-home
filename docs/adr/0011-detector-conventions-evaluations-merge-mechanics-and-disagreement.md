# ADR-0011: Detector conventions: evaluation rows, merge mechanics, consent gaps, disagreement

- **Status:** proposed
- **Date:** 2026-09-12
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A10, R-A11, R-A12, R-A15, R-A16, R-A17, R-A18 to R-A23, R-B11, R-B12,
  R-B20, R-C4, R-C5 · **Amends:** ADR-0004 (`eligibility_evaluations` columns), ADR-0005 (detector
  item types; the consent state of a patient with no usable signup date), ADR-0006 (what a merge
  moves and what it leaves where it is)

## Context and problem statement

The detectors branch (`feature/importer-detectors`) implements the detector table of ADR-0005, the
three identity tiers of ADR-0006, the membership function ADR-0008 item 2 owes and the shadow
evaluation ADR-0005 requires for every legacy intake. ADR-0010 already named one thing this branch
must decide: `eligibility_evaluations` stores its verdict in the legacy outcome vocabulary and has
no column for the inputs the engine saw, so a stored evaluation is not explainable from its own
row. Twelve more surfaced while the branch was planned, and each of them would otherwise be settled
differently by the console, the report and Part B: what a merge moves and what it must not move,
what "the ruleset disagrees with history" counts, what a patient's consent state is when the file
gives no date to place them against the log's start, and which item type each detector raises. Each
is small; together they are this branch's contract with the two that follow, so they are recorded
once, here.

## Decision drivers

- An evaluation explains itself from its own row, without re-running the engine (ADR-0010, R-B9).
- A merge is reversible and loses nothing (R-A31, ADR-0006); evidence is never rewritten, so
  anything a merge cannot move must be reachable another way (ADR-0007, ADR-0008 item 2).
- Two consecutive runs are identical in every table but `import_runs` (R-A15, R-A16) — in values as
  well as in counts, or the second run has silently changed patient data.
- A report figure is a query result with a stated definition, not a judgement (`CLAUDE.md` §5, R-A22).
- One convention per question, stated before a second branch invents another (KISS).
- A nulled value is not a resolved value: every blanking the mapper did gets its decision here
  (ADR-0009 item 2).

## Decision outcome

| # | Question | Decision |
| --- | --- | --- |
| 1 | `eligibility_evaluations` is not explainable from its own row (ADR-0010 follow-up) | Migration 0003: **drop `outcome`**, add `engine_outcome` (new enum `engine_outcome`: `auto_cleared`, `auto_flagged`, `auto_rejected`, `not_evaluable`) and `inputs` (jsonb, the `EvaluatedInputs` of ADR-0010: age, weight, height, unrounded BMI, matched terms with the text that matched them), both not null. The legacy-vocabulary column **goes** rather than staying for the comparison of item 11: it holds the engine's verdict translated into a vocabulary that has no image for `not_evaluable` except `unknown`, which already means "a spelling we have not seen" (ADR-0009 item 8); the comparison it existed for is a join against `intakes.outcome`, which is already stored, and a translated second copy of a verdict is a synonym the vocabulary forbids (`CLAUDE.md` §6) and a value that can drift from the one it copies. Nothing reads or writes the table today, so the column is dropped, not deprecated. |
| 2 | Are shadow evaluations evidence or derived? | **Derived.** A shadow row is a function of (intake, ruleset) and holds no decision, so it is recomputed like `consent_states`, not frozen like `audit_entries`: partial unique index on `(intake_id, ruleset_version) where shadow`, and the history audit upserts on it. A later run under the same ruleset version after an engine fix therefore converges instead of accumulating a second verdict for one intake. Part B's rows (`shadow = false`) record what the engine told a patient at submission and the importer never writes or touches them. |
| 3 | What a merge moves | A merge changes exactly two things: `patients.merged_into` on the loser, and every `patient_legacy_ids` row pointing at the loser now points at the survivor. **Rows that reference a patient by id keep the patient they were loaded against** — `intakes.patient_id` and `consent_events.patient_id` are not repointed — and "this patient's records" is answered only by the membership function of ADR-0008 item 2. `consent_events` cannot be updated at all (ADR-0007), so any convention that moved intakes would leave the two tables disagreeing and would lose the loser's consent events on unmerge. Unmerge is then the exact inverse of merge: clear `merged_into`, repoint the alias rows back, write the audit entries. |
| 4 | The importer and an already-merged patient | `loadIntakes` **fills `patient_id` when it is null and never rewrites it**. Today it repoints an intake whenever the alias disagrees with the stored value; after a merge the alias returns the survivor, so the second run would move rows the first run placed and the two runs would differ in values while agreeing in counts. Filling a null is kept: a legacy patient that appears in a later export resolves its own orphans, which is a fact, not a guess (the orphan's review item stays open until a human closes it, ADR-0006). |
| 5 | A merge that would create a cycle | Refused with an exception, in the repository function, before anything is written: merging a survivor into one of its own members would loop membership resolution forever. The database's `merged_into <> id` (ADR-0008 item 6) catches the length-one case only; a longer cycle is not expressible as a `CHECK`, which is the same limitation ADR-0008 accepted for membership itself. |
| 6 | Consent state when the signup date is null | The 3 patients whose whole record is dated 2062 have `signup_date` null (ADR-0009 item 1), so they cannot be placed either side of the 2023 cut-over that separates `no_record` from `unknown_pre_log`. They get **`unknown_pre_log`**, whose meaning is read as **the log's coverage is unknowable for this patient** — which is exactly true here, and is why the state is not named after a date. They raise the same row item as any other patient without a record and an active or paused status. A consent event whose `patient_legacy_id` matches no patient gets no state at all and is a count in the report. The signup date is used **only** for this split; see item 15. |
| 7 | Tier-1 "status class" (ADR-0006) | The canonical `patient_status` value, with `unknown` treated as empty, so an unmapped spelling neither blocks a merge nor forces one. ADR-0006's tier-3 example ("active on one row and churned on the other") is then a contradiction on this field like any other. |
| 8 | Where name folding lives | Once in `src/import/identity/`, with its own unit tests. `scripts/profile/` keeps its own implementation untouched: it is the frozen record of the profiling session, and two independent implementations agreeing on 70 candidate groups is evidence, where one implementation quoted twice would be a tautology. |
| 9 | Fields a tier-1 survivor gains from the loser | ADR-0006 requires them copied with per-field provenance in `changes`. Whether a later run may blank such a field again — the survivor's own raw row is empty, and canonical rows are rewritten from raw — is decided **after counting**: ADR-0006 records that none of the 28 pairs differs on a person field, so the expected number of gained fields is zero and the question does not arise in this export. The count is produced by the branch and recorded here; a non-zero count reopens the decision before the code chooses (`CLAUDE.md` §4, verify before asserting). |
| 10 | Plausibility items (the ADR-0009 item 2 debt) | One `data_quality` item per **(patient, field)**, which is what `dedupe_key` already makes it (ADR-0004: two ambiguous fields on one entity are two items), covering that patient's own value and its intakes' values for that field, with the decimal-shift proposal when exactly one of ×10 and ×100 lands inside the bounds and none otherwise. An **orphan intake** has no patient to hang the item on and gets a per-intake item of the same type. ADR-0005's "10 items" assumes the five weight patients and the five height patients are disjoint and that every implausible intake value belongs to a patient who has one too; both are asserted by the export-count test, and a disagreement is reported, not tuned away. |
| 11 | What "the ruleset disagrees with history" counts | The report carries the **full matrix**: the four engine outcomes by the legacy outcomes, as a count per cell. **Two cells are hard disagreements**, defined by one named predicate that the report and every later query use: `auto_rejected` where the legacy outcome was `approved`, and `auto_cleared` where it was `rejected`. `auto_flagged` is **never** a disagreement — it means a human should look, and a human did. `not_evaluable` is its own row in the matrix and is never compared: the engine could not run, so it contradicts nothing. `pending` is not the image of `auto_flagged`: it means the doctor never decided, not that one should look. Alongside the matrix the report keeps the per-rule hit counts of ADR-0005 (BMI below 27, BMI in band without a weight-related condition, age under 18), which need no comparison to be true. |
| 12 | Detector item types not fixed by ADR-0005 | Weight divergence beyond the tolerance: `data_quality`, scope `row`, field `weight_kg`. The lbs non-reconciliation, the 18 unit-less weights read as pounds and the 69 future-dated consent events: `vocabulary`, scope `vocabulary`. The 18 unit-less weights are ADR-0005's item and are raised **on this branch**: the mapper flags them (`WEIGHT_UNIT_MISSING_TO_NULL`) and nothing consumed the flag, so those weights were nulled with no decision attached, the same gap ADR-0009 item 2 recorded for the implausible values. |
| 13 | `consent_states` and merged patients | Rows are written for surviving patients only, derived over the union of events that membership returns; a merge deletes the loser's rows. The table is derived, so deleting is not a loss (ADR-0007's line: what is evidence is immutable, what is derived is not). The derivation is proved against ADR-0005's counts over the 2466 legacy rows in a unit test and reported over the surviving patients after the merges, with both figures in the report. |
| 15 | What `conflict` means exactly | **The first event of that type is a revocation**, whatever its date: a revocation that precedes every grant revokes something that was never granted, and the log contradicts itself. ADR-0005 describes these rows as "revoke before grant *and before signup*", but that is a description of six of the seven, not the rule: `recrji0nd3KzVGPAJ` revoked the day after signing up and was granted eight days later, and the accepted count of 7 is reproduced only by the reading above. Adding the signup clause gives 6 conflicts and 2092 `granted`; leaving it out gives ADR-0005's 7 and 2091, with `revoked` at 269 either way. The narrower reading would also act on a self-contradicting log (`granted`, because the last event is a grant), which is what the state exists to prevent. |
| 16 | A patient with no event of a declared type | Gets a state for that type all the same, from the same rule as a patient with no events at all (`no_record` or `unknown_pre_log`). The derivation is handed the declared types, so the caller — not the pure function — decides which they are; the importer passes the vocabulary of ADR-0009 item 8, today `data_processing` alone, and a type seen only in the log still gets its own state and is never folded into another. Without this a patient with no record would have no `consent_states` row at all and would drop out of every count. |
| 17 | The signup date of a membership | The **earliest** date the membership holds, and **none at all** when any member's date is unusable. The cut-over of item 6 asks when this person could first have appeared in the log, which is the earliest date any of their rows carries; a member we cannot date leaves that unknowable rather than answered by the others. Every one of ADR-0006's 28 tier-1 pairs shares its signup date, so this changes no row in this export — it states which row wins when they ever differ. |
| 14 | What the import report is a statement about | **The export, not the run.** The JSON carries `--as-of`, the importer version and the ruleset version — inputs every number depends on — and the per-file names, sizes and sha256. It carries **no run id and no wall-clock**, so two runs over one export render byte-identical files and a diff of the committed report is a change in the data or the rules, never in the clock. The run keeps the link through `import_runs.report_path`. |

### Consequences

- Good: an evaluation row carries its own verdict, its own reasons and the inputs the rules saw, so
  the console renders it without the engine and a disagreement figure is a join with a definition.
- Good: a merge writes two things and can be undone by writing them back; nothing about it depends
  on a table that cannot be updated, which is what made the alias join of ADR-0004 unsafe.
- Good: every value the mapper nulled now has an item (items 10 and 12), closing the debt
  ADR-0009 item 2 accepted "for the duration of one branch".
- Bad: item 3 means `intakes.patient_id` and `consent_events.patient_id` do **not** answer "whose
  intake is this" after a merge, and only the membership function does. Accepted, and it is why
  ADR-0008 made membership the rule; the risk is a future query that joins the column directly,
  which review has to catch.
- Bad: item 11's matrix is larger than the single number ADR-0005's Confirmation asked for.
  Accepted: one number needs a mapping between two vocabularies that do not correspond, and the
  matrix states the whole truth and lets a reader disagree with the two cells we call hard.
- Neutral: item 1 drops a column no code writes; migration 0003 is therefore a plain DDL change,
  not a data migration.
- Neutral: item 9 records a count, not a rule. If the count is not zero the decision returns here
  before the code chooses, and this ADR gains an amendment like any other.

### Confirmation

- `src/db/constraints.integration.test.ts`: a second shadow evaluation for one
  `(intake_id, ruleset_version)` is rejected; two non-shadow rows for the same pair are accepted.
- Integration test (ADR-0008's): merge A into B, B's membership returns A's intakes and consent
  events including a new-flow event with no legacy id; unmerge restores the original resolution and
  every one of A's records is reachable from A again.
- Integration test: after a merge, a second import changes no `patient_id` on any intake or consent
  event and no count in any table but `import_runs`.
- Unit test: the merge repository refuses a merge whose target is already a member of the source.
- Unit tests for the consent derivation, including a patient with no events and no signup date,
  and the three shapes of item 15 (revocation first before signup, after signup, and with no
  signup date at all).
- The export-count test reproduces ADR-0005's consent states over the 2466 legacy rows:
  `granted` 2091, `revoked` 269, `conflict` 7, and 99 patients with no record.
- The export-count test asserts the detector, consent-state and identity-tier counts of ADR-0005
  and ADR-0006 against the database — the item deferred from the `feature/legacy-importer` review.
- The report renders byte-identically on two consecutive runs, and every number in it equals the
  corresponding `SELECT count(*)`.
- The count of item 9 is written into this ADR before the branch is reviewed.

## More information

- ADR-0004 (`eligibility_evaluations`, review items, audit), ADR-0005 (detectors, shadow
  evaluation, consent state), ADR-0006 (identity tiers, the merge path), ADR-0007 (what is
  immutable), ADR-0008 (membership, idempotency keys), ADR-0009 (the blanking rules whose items
  this branch owes), ADR-0010 (the engine, its outcomes and its inputs).
- `docs/findings.md`: weight and weight_unit, height_cm, consents, legacy_patient_id.
