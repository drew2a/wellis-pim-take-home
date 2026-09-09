# ADR-0006: Identity: duplicate patients, orphan intakes and duplicate intakes

- **Status:** proposed
- **Date:** 2026-09-09
- **Deciders:** Andrei Andreev (pending)
- **Requirements:** R-A4, R-A5, R-A10, R-A11, R-A12, R-A31, R-C4, R-C5, R-C6 · **Resolves:** Q6
  (default A + C), Q9 (amended: no placeholder patient)

## Context and problem statement

Ops says people signed up twice with different emails. The export confirms it and shows how: name
variants (`Luuk-L Dijkstra`, `Braam Nair`), `x` and digit suffixes on the email local part, the
same birth date written in two formats. It also shows the opposite: 6 of 30 shared BSNs belong to
clearly different people. Twenty-one intakes reference patients that exist nowhere. Five patients
submitted two intakes on the same day with contradicting outcomes. Identity, medicine and consent
never auto-resolve (`CLAUDE.md` §5); this ADR fixes what the importer does instead.

## Decision drivers

- No merge without a human and a record of which row supplied which field (R-A31, `CLAUDE.md` §5).
- Every legacy id keeps resolving after a merge (findings, `legacy_id`).
- A name alone is never identity (618 folded names cover 1470 rows).
- A fabricated record is worse than a null reference (findings, `legacy_patient_id`).
- A conflict is one review item showing competing versions side by side (R-C4, R-C5, R-C6).

## Considered options

1. Never auto-merge; detect candidates on exact keys; one conflict item per candidate group; alias
   table makes a human merge reversible. Orphans keep a null patient reference.
2. Auto-merge groups where several keys agree (54 of 70 groups), review the rest.
3. Fuzzy matching with a similarity score and a threshold.

## Decision outcome

Chosen option: **Option 1**. Option 2 would merge medical records on a heuristic; the file itself
shows shared BSNs and shared phones that are not one person, so "several keys agree" is strong
evidence, not proof. Option 3 adds a tunable that nobody can explain in the follow-up (§3B:
deterministic beats clever) and the export's variants are caught by exact keys anyway.

### Duplicate-patient candidates

- Candidate keys, all exact after the normalisation of ADR-0005: canonical email (placeholders and
  unresolved internal-space addresses excluded), `bsn`, E.164 phone, folded `full_name` + `dob`
  read with the separator convention. Folded name alone is **not** a key.
- Rows are grouped by union of the four keys. In this export: **70 groups, all pairs, 140 rows**;
  54 groups are supported by at least two different keys, 16 by one.
- Each group is one `review_items` row: type `identity_conflict`, scope `row`, payload = every
  field of every row side by side plus which keys matched, plus each row's intake count and
  consent state. No proposed resolution.
- The reviewer picks the surviving row and, per field, the winning value (or edits it), with a
  required note (R-C5, R-C6). Applying the decision: the losing patient row stays, gets
  `merged_into` = survivor; its legacy ids are repointed in `patient_legacy_ids`; intakes and
  consent events resolve to the survivor through the alias table without being rewritten;
  `consent_state` is recomputed for the survivor from the union of events; one audit entry per
  affected entity records actor, from, to, reason and the field choices in `changes`. Unmerge is
  the inverse and is possible because nothing was deleted.
- The 6 BSN pairs with different names and birth dates are the same item type; the reviewer's
  action there is "not the same person", recorded as a dismissal with a note, and the shared BSN
  stays a `data_quality` fact in the report.

### Orphan intakes

- 21 intakes reference a `legacy_patient_id` that is in neither `patients.csv` nor the consent
  log, is not a case variant of any id, and cannot be repaired from the export.
- Stored in full with `patient_id` null and the raw `legacy_patient_id` kept. **No placeholder
  patient**: a patient row with no name, no date of birth and no email is a fabricated record; a
  null reference plus a review item says what we know (Q9 amended in `QUESTIONS.md`).
- One `review_items` row per orphan, type `orphan_intake`, payload = the intake and, as context
  only, look-alike patients (same height, weight within 10 %, signup at most a year earlier: none
  for 7, one for 3, several for 11). Two actions: **attach to an existing patient** (note required;
  even a single look-alike is a guess) or **leave unresolved**. "Create a patient from the intake"
  is not offered: the intake carries no identity fields. An unresolved orphan is an acceptable
  outcome; the report counts them.

### Duplicate intakes

- 5 (patient, submission day) pairs, 3 with consecutive `intake_id`s, weights 1 to 3 kg apart,
  outcomes disagreeing in 3. Both intakes are stored with their legacy outcome and state; neither
  is the outcome of record until a reviewer decides.
- One `review_items` row per pair, type `duplicate_intake`, both intakes side by side, no proposed
  resolution. Listed under quarantined and under unexpected findings.

### Consequences

- Good: nothing is merged, dropped or fabricated by the importer; every legacy reference resolves;
  every human merge is reversible.
- Good: 70 conflicts and 21 orphans are a day's work for a reviewer, not a backlog; each has a
  distinct decision.
- Bad: 16 single-key groups will include some false candidates (a shared household phone). Accepted:
  dismissing a false candidate costs a note; merging a true one automatically would cost a
  patient's record.
- Bad: a merge touches four tables. Accepted; it is one transaction in one repository function
  with one audit trail.
- Neutral: the look-alike search for orphans is context, not a rule; it is not versioned in
  `rules/v1.json`.

### Confirmation

- Import report: 70 identity conflicts, 21 orphan intakes, 5 duplicate-intake pairs; 0 patients
  merged by the importer.
- Integration test: merge two rows via the repository, assert both legacy ids resolve to the
  survivor, intakes and consent events follow, `consent_state` recomputed, audit entries present;
  unmerge restores the original resolution.
- Integration test: an orphan intake loads with `patient_id` null and one open review item; a
  second run creates no second item.

## More information

- `docs/findings.md`: `full_name`, `email`, `bsn`, `phone`, `legacy_patient_id`; `docs/data-profile.md`
  P-34; `docs/data-hypotheses.md` H-5.
- ADR-0004 (alias table, review items, audit), ADR-0005 (the normalisations the keys rely on).
