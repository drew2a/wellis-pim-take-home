# ADR-0006: Identity: duplicate patients, orphan intakes and duplicate intakes

- **Status:** accepted
- **Date:** 2026-09-09
- **Deciders:** Andrei Andreev
- **Requirements:** R-A4, R-A5, R-A10, R-A11, R-A12, R-A31, R-C4, R-C5, R-C6 · **Resolves:** Q6
  (default A + C), Q9 (amended: no placeholder patient)

## Context and problem statement

Ops says people signed up twice with different emails. The export confirms it and shows how: name
variants (`Luuk-L Dijkstra`, `Braam Nair`), `x` and digit suffixes on the email local part, the
same birth date written in two formats. It also shows the opposite: 6 of 30 shared BSNs belong to
clearly different people. Twenty-one intakes reference patients that exist nowhere. Five patients
submitted two intakes on the same day with contradicting outcomes. Identity never auto-resolves unless
the records are literally identical on identity and non-contradictory on everything else
(`CLAUDE.md` §5); this ADR fixes what that means row by row.

## Decision drivers

- No merge without a record of which row supplied which field; no merge without a human unless the
  rows are literally identical on identity and non-contradictory elsewhere (R-A31, `CLAUDE.md` §5).
- Every legacy id keeps resolving after a merge (findings, `legacy_id`).
- A name alone is never identity (618 folded names cover 1470 rows).
- A fabricated record is worse than a null reference (findings, `legacy_patient_id`).
- A conflict is one review item showing competing versions side by side (R-C4, R-C5, R-C6).

## Considered options

1. Three tiers on exact keys: auto-merge only literally identical records, review candidates,
   mark conflicts; alias table makes every merge reversible. Orphans keep a null patient reference.
2. Auto-merge groups where several keys agree (54 of 70 groups), review the rest.
3. Fuzzy matching with a similarity score and a threshold.

## Decision outcome

Chosen option: **Option 1**. Option 2 would merge medical records on a heuristic; the file itself
shows shared BSNs and shared phones that are not one person, so "several keys agree" is strong
evidence, not proof. That argument does not apply to tier 1, where everything matches. Option 3 adds a tunable that nobody can explain in the follow-up (§3B:
deterministic beats clever) and the export's variants are caught by exact keys anyway.

### Duplicate-patient candidates: three tiers

`CLAUDE.md` §5 in full: identity never auto-resolves *unless the records are literally identical on
identity and non-contradictory on everything else*. That exception is deliberate and is tier 1.

- Candidate keys, all exact after the normalisation of ADR-0005: canonical email (placeholders and
  unresolved internal-space addresses excluded), `bsn`, E.164 phone, folded `full_name` + `dob`
  read with the separator convention. Folded name alone is **not** a key. Rows are grouped by
  union of the four keys: **70 groups, all pairs, 140 rows** in this export. Each group is then
  classified:

| tier | definition | importer action | this export |
|---|---|---|---|
| 1 exact | folded name, dob and canonical email all present and identical, **and** every other field about the person (sex, bsn, phone, city, `weight_kg`, `height_cm`, status class) equal after normalisation or empty on one side | **auto-merge** with a merge record | 28 |
| 2 candidate | keys match but identity is not fully identical (for example the same phone and dob with a different email) | review item `identity_conflict`, as designed below | 3 |
| 3 conflict | a shared key with contradicting facts: different dob, different name on one bsn or phone, or active on one row and churned on the other | review item `identity_conflict` **marked conflict**, never latest-wins | 39 (name differs 25, dob differs 14) |

  **Row provenance fields, not compared for contradiction:** `source`, `signup_date`. They describe
  the row (which funnel created it, when), not the person; two rows from two funnels on two dates is
  exactly the "signed up twice" that EXPORT-NOTES.md describes. Nothing is lost: both raw rows keep
  their values, and the survivor's audit entry records the losing row's values in `changes`. Under
  this reading the counts are tier 1 = 28, tier 2 = 3, tier 3 = 39; 25 of the 28 tier-1 pairs
  differ in `source`, all 28 share their signup date, and none differs on any person field. The
  list is the one place to edit if the reading changes.

- **Tier-1 merge by the importer.** Survivor rule, deterministic: the row with intakes; if both or
  neither, the later signup; if equal, the lower `legacy_id`. The losing row stays with
  `merged_into` = survivor; its legacy id is repointed in `patient_legacy_ids`; intakes and consent
  events follow through the alias; `consent_state` is recomputed from the union of events; one audit
  entry per affected entity with actor `importer`, `reason` naming the survivor rule and
  `changes` as field-level provenance (`{field, from, to, source_legacy_id}`, one entry per field
  the survivor did not already hold). Reversible through the same unmerge path as a human merge.
  Idempotent: a re-run finds the alias already repointed and does nothing.
- **Tiers 2 and 3.** One `review_items` row per group, payload = every field of every row side by
  side plus which keys matched and, for tier 3, which facts contradict, plus each row's intake count
  and consent state. No proposed resolution. The reviewer picks the surviving row and, per field,
  the winning value (or edits it), with a required note (R-C5, R-C6); applying the decision runs the
  same merge path with a human actor. The 6 BSN pairs with different names and birth dates are
  tier 3; the reviewer's action there is "not the same person", recorded as a dismissal with a
  note, and the shared BSN stays a `data_quality` fact in the report.

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

- Good: the importer merges only literally identical records (28 pairs), with provenance per field,
  and nothing is dropped or fabricated; every legacy reference resolves; every merge, human or
  importer, is reversible.
- Good: 42 review items (3 candidates, 39 conflicts) and 21 orphans are a day's work for a
  reviewer, not a backlog; each has a distinct decision.
- Bad: some conflicts are false candidates (a shared household phone). Accepted: dismissing one
  costs a note; merging it automatically would cost a patient's record.
- Bad: tier 1 depends on which fields count as "about the person"; `source` and `signup_date` are
  declared row provenance by decision here. Accepted, and stated as one list so it can be changed.
- Bad: a merge touches four tables. Accepted; it is one transaction in one repository function
  with one audit trail.
- Neutral: the look-alike search for orphans is context, not a rule; it is not versioned in
  `rules/v1.json`.

### Confirmation

- Import report: 28 tier-1 merges by the importer, 3 candidates, 39 conflicts, 21 orphan intakes,
  5 duplicate-intake pairs.
- Unit test: the tier classifier on the three tier-1 examples (`Sem de Boer`, `Annelies Rossi`,
  `Teun Kowalski`), on a tier-3 name variant (`Luuk-L Dijkstra`) and on a shared-bsn pair with
  different names.
- Integration test: merge two rows via the repository, assert both legacy ids resolve to the
  survivor, intakes and consent events follow, `consent_state` recomputed, audit entries present;
  unmerge restores the original resolution.
- Integration test: an orphan intake loads with `patient_id` null and one open review item; a
  second run creates no second item.

## More information

- `docs/findings.md`: `full_name`, `email`, `bsn`, `phone`, `legacy_patient_id`; `docs/profile/data-profile.md`
  P-34; `docs/profile/data-hypotheses.md` H-5.
- ADR-0004 (alias table, review items, audit), ADR-0005 (the normalisations the keys rely on).
