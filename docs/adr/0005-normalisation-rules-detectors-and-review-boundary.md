# ADR-0005: Normalisation rules, detectors and the auto-fix / review boundary

- **Status:** accepted
- **Date:** 2026-09-09
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A9, R-A10, R-A11, R-A12, R-A13, R-A20, R-A21, R-A22, R-A23, R-A25 to
  R-A30, R-A32 to R-A36, R-B11, R-B12 · **Resolves:** Q3 (partly: list seeded, confirmation
  requested), Q7 (amended: states `no_record` and `unknown_pre_log`)

## Context and problem statement

The brief grades the line between "safely auto-fixable" and "ambiguous" and wants it stated as a
rule set, not left in code (R-A13). `docs/findings.md` reached an agreed line per column after
profiling the whole export. This ADR collects those lines into the rule set the importer
implements and the import report cites. The importer is **not a rule engine**: mapping is plain
deterministic parser code; a "rule" is a string code on a normalisation record plus evidence, and
"versioned" means the record carries the import run and importer version.

## Decision drivers

- Auto-fix only what is deterministic or inferred *and tested against the whole export*, with the
  test result stored (R-A9, `CLAUDE.md` §5).
- Every stored value that differs from raw gets a record naming its rule (R-A7); trimming counts.
- One rule producing many identical items is one vocabulary-level item; row-level items only where
  the consequence differs per row (`CLAUDE.md` §5).
- Detectors written for Part B also run over history and produce review items; they never rewrite
  historical outcomes.
- Deterministic and explainable beats clever (§3B): no fuzzy matching, no LLM.

## Considered options

1. Rules as a table of per-column parser code with string rule codes, term lists and bounds in a
   versioned JSON file (`rules/v1.json`), detectors as pure functions shared with Part B.
2. A generic rule engine with rule objects, conditions and actions, configured at runtime.
3. Auto-fix nothing: load raw, send every deviation to review.

## Decision outcome

Chosen option: **Option 1**, structured as three layers kept apart in code (mapper, detectors,
resolution path; see below). Option 2 was explicitly rejected by the repo owner ("the importer is
not a rule engine"); option 3 fails R-A9 and would produce thousands of identical items.

### Mapping specification per column

`rec.` = normalisation record with the given rule code. Counts are from this export
(`docs/findings.md`).

| column | canonical | auto-fix (rec.) | review items |
|---|---|---|---|
| patients.legacy_id | text, unique, opaque | none | none |
| patients.full_name | text as typed | `WHITESPACE_TRIM` 72 | none |
| patients.email | trimmed, lowercased | `WHITESPACE_TRIM` 30, `EMAIL_LOWERCASE` 28 | row: 11 placeholders (null, no fix); row: 10 internal space (null, **proposed fix** remove space) |
| patients.dob | date | `DATE_ORDER_FROM_SEPARATOR` 638 (ISO = Y-M-D, dash = D-M-Y, slash = M-D-Y) | vocabulary: confirm the convention (H-1 evidence); row: 5 impossible dates (null, ADR-0009 item 1); row: 6 where the alternative reading flips minor/adult at an intake |
| patients.sex | enum | `VOCAB_SEX` 1976 | vocabulary per unseen value |
| patients.bsn | text, `bsn_check` | none | row: 17 elfproef failures; vocabulary: bsn retention (keep / mask / drop), console masks by default |
| patients.phone | E.164 | `PHONE_E164_NL_MOBILE` 1259 | row per unmatched future form (proposed fix when obvious) |
| patients.city | text | none | none |
| patients.weight + unit | `weight_kg` | `WEIGHT_LBS_TO_KG` 55 (factor 0.45359237) | vocabulary: 18 unit-less rows as pounds (payload both readings and both BMIs per row, operator may exclude rows); vocabulary: lbs rows do not reconcile with intakes (49 of 68 vs 4 of 2688) |
| patients.height_cm | integer | none | via plausibility detector |
| patients.status | enum | `VOCAB_STATUS` 1917 | vocabulary per unseen value |
| patients.signup_date | date | `DATE_ORDER_FROM_SEPARATOR` 647 | row: 3 patients whose whole record is in 2062 (all their dates listed) |
| patients.source | text | none | none |
| intakes.intake_id | text, unique | none | none |
| intakes.legacy_patient_id | text; `patient_id` via alias | none | see ADR-0006 (21 orphans, 5 same-day pairs) |
| intakes.submitted_at | date | `DATE_ORDER_FROM_SEPARATOR` 413 | none new (2062 rows inside their patient's item) |
| intakes.questionnaire_version | label text + enum | `VERSION_LABEL_ASSUMED_V2` 394 (`2.0` → `v2`, an inference with its own code, like `OK`) | vocabulary: confirm `2.0` = `v2`; if no, the records identify the rows to remap |
| intakes.weight | `weight_kg`, kilograms by documented assumption | none | via plausibility detector |
| intakes.height | integer | none | via plausibility detector |
| intakes.meds_current | raw text + `medication_report` | `VOCAB_NONE_MEDICATION` 815 | vocabulary: whole term vocabulary classified (GLP-1 / none / unrecognised) |
| intakes.conditions | raw text + `condition_report` | `VOCAB_NONE_CONDITION` 348 | vocabulary: whole vocabulary classified (flag / weight-related / other / none / unrecognised) |
| intakes.alcohol_units_week | integer | `NON_NUMERIC_TO_NULL` 272 (`n.v.t.`) | vocabulary: `n.v.t.` zero or not answered |
| intakes.outcome | enum + legacy state | `VOCAB_OUTCOME` 1836; `OUTCOME_OK_ASSUMED_APPROVED` 441 | vocabulary: confirm `OK` = approved; vocabulary: 332 `legacy_pending` (three resolutions, cutoff date) |
| intakes.reviewer_note | text | none | vocabulary: 73 "twijfel, toch akkoord" on a rejecting outcome (payload lists rows) |
| consents.* | events as exported | none | see consent state below |

Every rule code appears in the import report under "rules applied" with its row count and the
evidence it rests on (P-n, H-n). The three meaning-level assignments in `VOCAB_STATUS`
(`cancelled` → churned, `on hold` → paused, `new`/`lead` → prospect) and the kilogram assumption
for intake weight are listed there as assumptions.

### Three layers, kept apart in code

1. **Mapper.** Converts raw to canonical and never guesses. Every change has a normalisation
   record; if a value needs a guess, the mapper stores null and moves on. It knows nothing about
   review items.
2. **Detectors.** Read canonical data and create review items. A detector **may attach a proposal
   to its item as data**: `{field, proposed_value, rule, evidence}`, nothing more. A detector never
   writes a canonical value.
3. **Resolution path.** The only way a canonical value changes after import, and it is the same
   path whether the reviewer accepts a proposal or types a value: write the value, write the field
   history (audit entry with actor, note, `changes`), close the item. Proposals are applied by a
   human through this path, never by the importer.

The intake form (Part B) does not use proposals; it shares only the detectors' parameters
(plausibility bounds, term lists) as validation.

There is **no proposal framework**. This export needs four kinds of proposal, and they are four
functions next to the detectors that produce them:

| proposal | produced by | proposed value |
|---|---|---|
| remove the space before `@` | email syntax detector | the address without internal whitespace (10 rows) |
| read a unit-less weight as pounds | weight-unit detector (vocabulary item, per-row payload) | `weight_kg` = raw × 0.45359237, with both BMIs shown (18 rows) |
| decimal shift into the plausible range | plausibility detector | the single ×10 or ×100 value that lands inside the bounds (`15` → 150, `7.8` → 78); none when zero or two shifts land |
| re-format a phone in an unseen form | phone form detector | E.164 when the digits read unambiguously (`0031 6...`), else none (0 rows in this export) |

Other properties of review items:

- One queue, one table (ADR-0004). "Warning" and "proposed autofix" are not separate mechanisms.
- A vocabulary-level item's payload lists the affected rows; the operator may exclude rows before
  applying (used for the 18 unit-less weights and the 332 pending intakes with a cutoff date).
- An unseen raw value in any closed vocabulary (`sex`, `status`, `outcome`, `weight_unit`, consent
  `type`/`action`) maps to `unknown` and raises **one** vocabulary item per new value.

### Shadow evaluation and the history audit

Every Part B rule runs over every legacy intake at import, but **queueing every hit is wrong**: the
doctor who approved a 2024 intake saw its BMI, so a BMI disagreement is a fact about the rules, not
an open question about the patient (Q9 default, shadow mode).

- Every legacy intake gets a row in `eligibility_evaluations`, the same table Part B writes:
  `ruleset_version`, the outcome the engine would give, the reason strings, `shadow = true`,
  evaluated at import. Nothing is applied to the intake; its legacy state stays.
- The patient detail view shows the shadow verdict next to the legacy outcome. The console has a
  filterable list of legacy intakes whose shadow verdict disagrees with the legacy outcome: a list
  to browse, no status to close, not queue items.
- The import report figure "ruleset v1 disagrees with N historical outcomes", per rule, is a count
  over that table. On this export: BMI below 27 on 191 legacy intakes, BMI 27 to 30 without a
  weight-related condition on 283 (of 520 in the band), age under 18 on 70.
- Row-level review items from the history audit exist only where the legacy process **could not
  see the problem** or where it is **a legal one**, and they are derived from the stored
  evaluations, so history is evaluated once:

| history-audit item | reason string | over this export |
|---|---|---|
| GLP-1 medication in free text | "flagged: current GLP-1 medication (<matched text>)" | 42 intakes (approved 28, rejected 7, pending 7) |
| flag condition in free text | "flagged: self-reported history of thyroid cancer / pancreatitis (<matched text>)" | 15 intakes (approved 10, rejected 3, pending 2) |
| age under 18 at submission **with an approved or pending outcome** | "rejected: age N at submission" | 58 intakes (approved 48, pending 10); the 12 rejected minors are a report figure |

  If Wellis later asks to reopen a class (for example the BMI band), items are generated from the
  stored evaluations without re-running the rules.

### Detectors (shared with Part B, run at import)

Defined once, read their parameters from `rules/v1.json`, and never change a legacy outcome or a
canonical value (they are layer 2 above).

| detector | parameters (rules file) | over this export |
|---|---|---|
| plausibility | `weight_kg` ∈ [30, 300], `height_cm` ∈ [100, 230] | 10 per-patient `data_quality` items (5 tiny weights, 5 heights), covering 5 + 5 patient values and 6 + 6 intake values; canonical null, raw kept, decimal-shift proposal |
| signup-vs-intake weight divergence | tolerance 0.9 to 1.1, derived from `kg` rows (2684 of 2688 within it) | row items for `kg` rows only: 3 patients; `lbs` non-reconciliation is one vocabulary item |
| age under 18 at submission | 18 years, age at `submitted_at` | shadow evaluation; items only for approved or pending (58) |
| BMI below 27; BMI 27 to 30 without weight-related condition | 27.0 and 30.0 inclusive, unrounded (Q2 default); weight-related term list | shadow evaluation only (191; 283) |
| GLP-1 medication | term list (brands + INNs, NL + EN), word-boundary match after lowercasing and dose stripping, never bare substring | 42 `clinical_history` items |
| flag conditions | `schildklierkanker`, `schildkliercarcinoom`, `thyroid cancer`, `medullary thyroid`, `pancreatitis`, `alvleesklierontsteking`; value split on `;` first | 15 `clinical_history` items |

`rules/v1.json` holds: plausibility bounds, the divergence tolerance, the age threshold, the BMI
thresholds and boundary semantics (Q2 default: 27.0 ≤ BMI ≤ 30.0 flags, unrounded), the GLP-1 term
list (seeded from the 12 spellings seen plus victoza, zepbound, trulicity, dulaglutide, exenatide,
byetta, bydureon, lixisenatide), the flag-condition list, and the weight-related condition list
(seeded from the 7 values seen: `hoge bloeddruk`, `hypertensie`, `slaapapneu`, `diabetes type 2`,
`prediabetes`, `hoog cholesterol`, `pcos`; to be confirmed by Wellis, Q3). **The rules file is
authored before the detectors**, because the history audit runs as an import step and reads it.

Part B (recorded here because it shapes the form): medications and conditions are structured
inputs (yes/no current GLP-1 use with brand names listed, a condition checklist) plus an "other"
free-text field; the engine evaluates the structured fields only; free text goes to the doctor
unchanged, with the same matcher run over it as a safety net that can only add a flag, never clear
one.

### Consent state

- Events are stored as exported; `at` is local Dutch time without zone (hour histogram 07:00 to
  22:59, nothing at night), the assumption recorded under rules applied.
- `consent_state` per patient and type is derived by one pure function from the events in `at`
  order; tie-break: a grant and a revocation with the same timestamp resolve to `revoked`. States:
  `granted` (2091), `revoked` (269, the 66 future-dated revocations included: revocation is the
  safe direction), `conflict` (7: revoke before grant and before signup; treated as not granted
  until resolved), `no_record` (patients with no event and signup 2023 or later), `unknown_pre_log`
  (no event, signup 2022).
- "Future" is relative to the import run timestamp: from 2026-09-08, 69 events (66 revoked, 3
  granted) are future-dated; **one** vocabulary item lists them, state unchanged.
- Row items of type `consent`: 7 conflicts (reviewer sets the state, note required); 19 revoked
  with active status; 73 without a record with active or paused status (55 `no_record`, 18
  `unknown_pre_log`); none for churned or prospect (26). They go to the review queue, filtered by
  type.
- Part B requirement: the same function recomputes `consent_state` on every new consent event;
  the new intake flow writes a `granted` event at submit with the current consent-text version and
  an intake cannot be submitted without it.
- Report findings: 71 intakes before the patient's first grant, 83 after a revocation, 131
  patients out of file order, `v1` stragglers after the `v2` cut-over, pre-2023 completeness
  unknowable.

### Consequences

- Good: the boundary is a table (R-A13). Its mapping-table counts come from the profile (P-n, H-n:
  `npm run profile -- --as-of 2026-09-08`, `npm run profile:hypotheses -- --as-of 2026-09-08`); the
  detector, consent-state and identity-tier counts are a one-off computation recorded in
  `docs/findings.md` and are reproduced by the import report, which the Confirmation section
  requires to list every rule code with these counts.
- Good: detectors are one definition for import, history and Part B; the console shows legacy and
  new cases in the same shape.
- Bad: the history audit creates 115 row items on day one (42 GLP-1, 15 flag conditions, 58
  approved-or-pending minors). Accepted: each is a distinct patient with a question the legacy
  process could not see or a legal one. BMI disagreements (191 below 27, 283 in the band without a
  condition) are shadow evaluations only: browsable, counted in the report, never queued.
- Bad: two term lists are seeded by an engineer, not a clinician. Mitigated by the vocabulary
  items that ask a human to confirm the whole classified vocabulary once, and by Q3.
- Neutral: the separator convention and `OK` = approved are inferences with their own rule codes
  and confirmation items; if a human says no, the records identify exactly which rows to remap.

### Confirmation

- Unit tests per rule code with boundary cases (`26.99`, `27.00`, `30.00`, `30.01`; `15` → 150 but
  `45` → none; `03-02-1960` and `02/03/1960` → the same date).
- Unit tests for the consent derivation: out-of-order events, equal timestamps, revoke-first pairs,
  no events with signup before and after 2023-01-01.
- Import report "rules applied" lists every code above with the row counts in this table, and
  "ruleset v1 disagrees with N historical outcomes" per rule is `SELECT count(*)` over
  `eligibility_evaluations` where `shadow` and the verdict differs from the legacy outcome.
- Integration test: after import every legacy intake has exactly one shadow evaluation and no
  legacy intake state changed.
- A test asserts that every raw value in `docs/profile/data-profile.json` for the closed vocabularies is
  covered by the mapping tables.

## More information

- `docs/findings.md` for the reasoning behind every line; `docs/profile/data-profile.md` (P-n),
  `docs/profile/data-hypotheses.md` (H-n).
- ADR-0004 (tables), ADR-0006 (identity).
