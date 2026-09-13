# ADR-0015: What a submission is: the new-flow schema, the consent gate, and the detectors that run at submit

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-B1, R-B2, R-B3, R-B4, R-B5, R-B6, R-B7, R-B8, R-B9, R-B11, R-B12, R-A7,
  R-A11, R-A31, R-T4 · **Resolves:** Q7 (default A, applied to the new flow) ·
  **Amends:** ADR-0004 (`intakes.intake_id` becomes nullable, `intakes.answers`,
  `eligibility_evaluations.matched`), ADR-0009 item 3 (the convention for evidence written outside
  the importer, extended to review items), **ADR-0010** (`EligibilityInput` gains
  `glp1Declared`; the GLP-1 rule fires on the declaration as well as on a matched term — item 6)

## Context and problem statement

ADR-0014 fixes how an intake moves. This ADR fixes what actually happens in the one request that
moves it from `draft` to an `auto_*` state, and what a new intake looks like in a schema that was
designed for a legacy export (ADR-0004): where a draft's answers live before there is a patient,
which columns a new-flow intake leaves null, what the engine is fed, what is stored of its verdict,
what consent has to look like for a submission to be accepted at all, and which detectors run on
data we are receiving for the first time. `CLAUDE.md` §5 requires that new data get the same
scrutiny as legacy data — the same normalisation records, the same review items — so the answer
cannot be "the form is trusted because we wrote it".

## Decision drivers

- Raw is kept: what the patient submitted is evidence and is stored as submitted (`CLAUDE.md` §5,
  R-A8 by analogy).
- No value changes without a record, trimming and case-folding included (R-A7, `CLAUDE.md` §5).
- Identity, medicine and consent never auto-resolve (`CLAUDE.md` §5): a new submission that looks
  like an existing patient is a review item, never a merge and never a block.
- Validate once, at the boundary; inside the server, fail loudly (`CLAUDE.md` §2).
- The engine stays the only authority on the outcome and stays pure (ADR-0010).
- YAGNI: no table and no column that this branch does not write.

## Considered options

For the one question that shapes the rest — **where a draft's answers live**:

1. **A `answers` jsonb column on `intakes`**, holding the submission as entered; the canonical
   columns are filled from it at submit; no patient row exists until submit.
2. **A patient row created with the draft**, filled field by field as steps are saved.
3. **A separate `intake_drafts` table**, copied into `intakes` and `patients` at submit.

## Decision outcome

Chosen option: **Option 1**. Option 2 would put a nameless, dateless `patients` row in the
database for every abandoned draft — the fabricated record ADR-0006 refused for orphan intakes,
arriving through a different door. Option 3 is Option 1 with a second table and a copy step; the
draft and the submitted intake are the same intake in two states, and splitting them would mean
two ids for one thing. Option 1 also gives the new flow the thing Part A insisted on and Part B
otherwise lacks: **a byte-faithful record of what was actually submitted**, next to the
interpretation of it.

### 1. Schema changes

| # | change | why |
|---|---|---|
| 1 | `intakes.answers jsonb` (null for legacy rows), with `CHECK (answers is null or created_by_run is null)` | The new flow's raw layer. A legacy row's raw is its `legacy_intakes_raw` row; an imported row never has answers. |
| 2 | `intakes.intake_id` becomes **nullable**, with `CHECK (created_by_run is null or intake_id is not null)` | It is the *exported* natural key ("as exported", ADR-0004), and a new intake has none. It stays unique; the canonical uuid identifies a new intake. The check keeps every imported row keyed. |
| 3 | `eligibility_evaluations.matched jsonb not null` (`MatchedRule[]`) | The report and the console already ask the engine which rules fired rather than re-deriving it (ADR-0011 item 21); storing it makes a stored evaluation answer that question too, without re-running the engine. Added with a `'[]'` default that the migration then drops: the only existing rows are shadow rows, which every import run rewrites. |
| 4 | `reviewers` + `reviewer_role`, `audit_entries.seq`, `.ruleset_version`, `.actor_reviewer_id` | ADR-0014 items 4 and 5. |

A new-flow intake leaves these null and it means something every time:
`legacy_patient_id`, `intake_id`, `created_by_run`, `outcome_raw`, `reviewer_note`,
`alcohol_units_week` (the new form does not ask; R-B2 does not require it),
`meds_current_raw` and `conditions_raw` (the legacy free-text columns — a new intake's answers are
structured and live in `answers`; composing a free-text imitation of them would be a stored value
that differs from the raw one and would need a normalisation record to say so), and
`questionnaire_version` (the enum's `v1`/`v2`/`v3` are *legacy* questionnaire labels; the new form
is not the legacy v3). `questionnaire_version_label` carries the form's own version string, which
`answers.form_version` repeats inside the evidence.

Filled: `patient_id`, `submitted_at`, `weight_kg`, `height_cm`, `medication_report`,
`condition_report`, `outcome` (`pending` until a human decides — the medical result, never the
state, `CLAUDE.md` §6), `state`, `ruleset_version`, `answers`.

### 2. The form: five steps, and what each one asks

Multi-step (R-B1), plain (R-B4), one step per screen, server-side draft after every step.

| step | asks | validation |
|---|---|---|
| 1 identity | full name, email, date of birth | non-empty name; email syntax; a date in the past giving an age of at most **100** at submission — the same bound the importer calls impossible (ADR-0009 item 1), lifted out of `src/import/mapper/dates.ts` into one shared constant |
| 2 body metrics | height (cm), weight (kg) | the **plausibility bounds of `rules/v1.json`** — 100–230 cm, 30–300 kg — with a message naming the bound: "Enter a height in centimetres between 100 and 230." |
| 3 medications | "Are you currently using a GLP-1 medication?" yes/no — an **engine input** (item 6), not a hint — with the brand names from `glp1_terms` listed; on yes, a checklist of those brands plus a free-text "other medication" box | on yes, at least one brand or the free text must be filled |
| 4 conditions | a checklist built from `weight_related_condition_terms` and `flag_condition_terms`, plus a free-text "anything else" box | none: no condition is a valid answer |
| 5 consent | the consent text, its version, and one explicit "I agree" | see item 4 |

- **The checklist options are the ruleset's terms.** Each option's *value* is a term from
  `rules/v1.json`; its *label* is presentation only, so the Dutch and English synonyms of one
  condition appear as one option ("Hoge bloeddruk (hypertensie)") instead of two checkboxes. Two
  unit tests keep the map honest: every option value is a term in the ruleset, and every ruleset
  term in the two condition lists is covered by some option — so a term added to the ruleset
  cannot silently vanish from the form.
- **Where the bounds are refused rather than nulled.** The importer nulls an implausible legacy
  weight with `IMPLAUSIBLE_TO_NULL` because it cannot ask anyone (ADR-0009 item 2). The form can:
  out-of-bounds input is a 400 and the patient corrects it. Same bounds, same file, opposite
  remedy, because the situations differ.
- **The client validates for convenience; the server re-validates and is the only authority**
  (`CLAUDE.md` §2, R-T4). Every route parses its body, its route param and each step with Zod.

### 3. The API

| route | does |
|---|---|
| `POST /api/intakes` | creates the draft: one `intakes` row, `state` `draft`, `answers` `{}`, `outcome` `pending`, both history reports `not_answered`; edge 0 of ADR-0014. Returns the uuid. |
| `GET /api/intakes/:id` | returns the intake: state, answers, and once submitted the outcome with its explanation lines. |
| `PATCH /api/intakes/:id` | saves one step: the step's Zod schema validates it, the answers are merged, the state stays `draft`. `409` if the intake is no longer a draft. |
| `POST /api/intakes/:id/submit` | item 5 below, in one transaction. |

`404` for an unknown id, `400` for a body that fails validation or a submission that is
incomplete or unconsented, `409` for a request the state forbids. **The intake's uuid is the only
credential**: there is no patient authentication, which is a deliberate scope cut recorded in
`README.md` (R-S4), the same cut Q8 makes for reviewers.

### 4. The consent gate

Consent is an **explicit granted event carrying the version of the consent text the patient was
shown** — not a boolean, not an implied acceptance. The text and its version live in
`src/consent/text.ts`; the version is **`v3`**, the next value in the sequence the export already
uses (`v1`: 1136 events, `v2`: 1507 events in `consents.jsonl`), because it is the next consent
text this company puts in front of a patient. It is versioned independently of the ruleset
version: what the patient agreed to and which rules judged them are two different facts.

A submission whose consent block is absent, not granted, or names a different version is
**`400`, and nothing is written** — no patient, no intake update, no event, no audit entry. On
acceptance the request writes one `consent_events` row (`type` `data_processing` — the one type
the export declares, `action` `granted`, `at` the submission instant with its zone, `version` the
text version, `source_line` and `import_run_id` null) and recomputes the patient's `consent_state`
with the same pure derivation the importer uses (ADR-0005). The log is evidence; the state is
what we act on (`CLAUDE.md` §6).

### 5. What `POST …/submit` does, in one transaction

1. **Validate** the whole `answers` object with Zod and refuse an incomplete or unconsented one
   (`400`, nothing written).
2. **Create the patient**: `status` `prospect`, `sex` `unknown`, `bsn` null with `bsn_check`
   `absent`, `signup_date` today, `source` `intake_form`, `created_from_legacy_id` and
   `created_by_run` null. `weight_kg` and `height_cm` stay **null on the patient**: the new flow
   has exactly one source for them — this submission — and copying it onto the patient would
   create a second value that can drift from the intake's with no event between them (R-A36 says
   the two legitimately differ; it does not say we should manufacture the difference).
   One audit entry, actor `intake form`, both states null — something happened, nothing
   transitioned.
3. **Normalise with records.** The canonical name and email are produced by the *importer's own*
   normalisers, and every difference from what the patient typed gets a `normalisation_records`
   row — `WHITESPACE_TRIM`, `EMAIL_LOWERCASE` — with `entity_type` `patient` and `entity_id` the
   canonical uuid (ADR-0009 item 3's convention for records written outside the importer) and
   `importer_version` the mapper's version, because that column versions the mapping rules and
   these are the same rules. The blanking codes cannot fire here: Zod refused at the boundary
   what the importer had to accept.
4. **Fill the intake** from the answers and **evaluate**: `ageYears` at submission (Q4),
   `weightKg`, `heightCm`, `glp1Declared` = the yes/no answer (item 6), `medications` = the
   ticked brand terms plus the free text, `conditions` = the ticked condition terms (the
   authoritative answer, which may suppress the band flag), `conditionsOther` = the free text
   (flag terms only — it can add a flag, never clear one; ADR-0010).
5. **Store the evaluation**: one `eligibility_evaluations` row, `shadow` **false**, with
   `engine_outcome`, `reasons`, `inputs`, the new `matched`, `ruleset_version`, and
   `import_run_id` null. `intakes.ruleset_version` gets the same value (R-B8).
6. **Transition**: `draft → submitted` (actor `intake form`), then `submitted → auto_*` (actor
   `eligibility engine`, reason = the engine's explanation lines verbatim, `ruleset_version`
   set), through `transitionIntake` and nothing else (ADR-0014 item 5).
7. **Consent**: the event and the recomputed state (item 4).
8. **Detectors** (item 7).

Steps 2–8 are one transaction: a submission is one fact, and a patient without the intake that
created them, or an intake without its evaluation, would be worse than a rejected request.

### 6. The GLP-1 declaration is an engine input, not a detector

`EligibilityInput` gains **`glp1Declared: boolean`**, and the GLP-1 rule fires on
`glp1Declared || matched.length > 0`. The declaration is a structured answer to the question the
ruleset exists to ask, so it belongs where the verdict is formed — not in a detector that watches
the engine be silent. A patient who says "I am taking a GLP-1" is **never `auto_cleared`**, which
is R-B6(d) verbatim, and the reason for it is stored in the same `reasons` array as every other:

| declared | matched terms | reason line |
|---|---|---|
| no | yes | `flagged: current GLP-1 medication (ozempic)` — unchanged |
| yes | yes | the same line; the terms are the better evidence |
| yes | no | `flagged: current GLP-1 medication (declared by patient)` |
| no | no | no line, no match |

`matched` still names `glp1_medication` in all three firing cases, `EvaluatedInputs` gains
`glp1Declared` so a stored evaluation explains itself without the answers, and the engine stays
pure — it is handed one more input, not a second source of truth. **Legacy passes `false`**: the
legacy questionnaire asked no such question, and inventing a "yes" from free text is what
`matchTerms` already does honestly. No shadow evaluation changes.

This amends ADR-0010, which specified the input shape without a declaration because Part B's form
did not exist yet. ADR-0005's Part B note had it right already — "medications and conditions are
structured inputs (yes/no current GLP-1 use with brand names listed, a condition checklist) plus
an 'other' free-text field; **the engine evaluates the structured fields only**; free text goes to
the doctor unchanged, with the same matcher run over it as a safety net that can only add a flag,
never clear one" — and the engine had no way to receive the structured medication answer. This is
that note made true in the engine.

### 7. The two detectors that run at submit

**`POSSIBLE_EXISTING_PATIENT`** — a `review_items` row, type `identity_conflict`, scope `row`.
The new patient's candidate keys (ADR-0006: canonical email, `bsn`, E.164 phone, folded name +
dob — of which the form supplies email and name+dob) are looked up against existing patients. A
match raises **one item** naming the new patient and every matching row side by side, identifiers
masked as elsewhere (ADR-0009 item 9), with each match's `merged_into` so the reviewer sees where
the record now lives. It is **never a merge** — `CLAUDE.md` §5 allows tier 1 only for records
literally identical on identity *and* non-contradictory on everything else, which a fresh
submission against a legacy record is not — and it is **never a block**: the patient completes
their intake, the engine runs, the intake enters the machine. Deciding whether two people are one
person is a reviewer's job, and it is not worth making a patient wait for it.

**`NEW_GLP1_DECLARED_UNMATCHED`** — a `review_items` row, type `vocabulary`, scope
**`vocabulary`**, raised when the patient answered **yes** to current GLP-1 use and the engine
matched **no** term from `glp1_terms` in what they named. The intake is already `auto_flagged` by
item 6, so this item is not about that patient at all: it asks *the ruleset* a question — "a
patient named `Saxenda 3mg pen`; it is not in `glp1_terms`; add it to v2?" — which is a
vocabulary-level decision for a human, not one row decision per patient who names the same drug
(`CLAUDE.md` §5). Accordingly `patient_id` and `intake_id` are null, the payload carries the text
verbatim and the first intake that carried it, and the `dedupe_key` is
(`vocabulary`, `vocabulary`, `ruleset:glp1_terms`, `NEW_GLP1_DECLARED_UNMATCHED`, the folded
text), so the hundredth patient naming the same drug adds no item — the same shape ADR-0009 item 8
already gives an unseen consent spelling.

`POSSIBLE_EXISTING_PATIENT` uses the canonical uuid in its `dedupe_key` where the importer would
use a natural key: a new-flow entity has none (ADR-0009 item 3), and the "same key on every run"
argument that motivated natural keys applies to re-imports, not to a submission that happens once.

### Consequences

- Good: a new intake keeps its submission verbatim, and every difference between what was typed
  and what is stored has a normalisation record — the same standard Part A is held to.
- Good: the engine is fed structured answers and free text exactly as ADR-0010 designed, so the
  legacy shadow evaluations and the new evaluations are the same function on the same shapes.
- Good: consent is an event with a text version, so "what did this patient agree to, and when" is
  answerable for new patients in the same table and the same derivation as for legacy ones.
- Good: a possible duplicate neither blocks a patient nor merges a record; it becomes one item
  with the competing rows side by side, which is what the console already renders (R-C4).
- Bad: `intakes` now has legacy-shaped columns that are always null for new rows and a jsonb
  column that is always null for legacy rows. Accepted over two tables: they are the same entity
  in one work queue, and each null is documented above and constrained by a `CHECK`.
- Bad: the condition checklist's labels are a second place where the ruleset's vocabulary is
  written down. Mitigated by the two coverage tests, which fail if the ruleset and the form drift.
- Bad: an unauthenticated `GET /api/intakes/:id` returns a patient's own submission to anyone
  holding the uuid. Accepted and recorded as a scope cut; the uuid is a v4 capability and nothing
  enumerates it.
- Good: a patient who declares GLP-1 use is flagged whatever they call the drug, and the reason
  saying *why* is in the stored evaluation like every other — no detector, no second verdict, no
  state that disagrees with the evaluation behind it.
- Bad: `EligibilityInput` now has a field that only one of its two callers can ever set to `true`,
  and the history audit must keep passing `false` forever. Accepted: the alternative is an engine
  that cannot see an answer the form asks, and `false` is the honest value for a questionnaire
  that never asked.
- Neutral: an abandoned draft stays in the database forever as a `draft` row with partial answers
  and no patient. No expiry is built; it is a candidate for a scheduled cleanup Wellis does not
  need in week one.

### Confirmation

- Integration test: submit **without** consent → `400`, and `patients`, `intakes` (beyond the
  untouched draft), `consent_events`, `eligibility_evaluations`, `audit_entries` and
  `normalisation_records` are all unchanged.
- Integration test: submit **with** consent → exactly one intake in the `auto_*` state the engine's
  outcome maps to, one `eligibility_evaluations` row with `shadow = false` and a non-empty
  `matched`, one `consent_events` row with version `v3` and a derived `consent_states` row, and
  the audit entries for creation, `draft → submitted` and `submitted → auto_*` in `seq` order.
- Integration test: a submission whose name or email needed trimming or case-folding produces the
  matching `normalisation_records` rows with `entity_type` `patient`.
- Integration tests per plausibility bound and per identity bound: `400` with a message naming the
  bound, at and just outside 100/230 cm, 30/300 kg, and a date of birth giving an age of 101.
- Integration test: a submission whose email matches an existing patient raises exactly one
  `POSSIBLE_EXISTING_PATIENT` item **and still** creates the patient, the intake and the
  evaluation, and leaves the intake in its `auto_*` state.
- Unit tests on the engine, the four rows of item 6's table: declared with no matched term flags
  with the `(declared by patient)` reason and `glp1_medication` in `matched`; declared with a
  matched term keeps the quoting reason; not declared behaves exactly as before (the existing
  cases still pass unchanged); a declaration cannot rescue an absolute reject, and it does
  pre-empt a BMI reject the same way a matched term does (Q1).
- Integration test: a submission declaring GLP-1 use with an unlisted drug name lands in
  `auto_flagged` and raises exactly one `NEW_GLP1_DECLARED_UNMATCHED` vocabulary item; a second
  submission naming the same drug raises none, and one naming a different drug raises another.
- Unit test: the history audit passes `glp1Declared: false`, and every shadow evaluation's outcome
  is unchanged by the new input (the existing import-report figures still hold).
- Unit tests: every checklist option value is a ruleset term; every ruleset condition term is
  covered by an option.

## More information

- ASSIGNMENT.md §3B; `REQUIREMENTS.md` R-B1–R-B12; `QUESTIONS.md` Q2, Q3, Q4, Q7, Q8.
- ADR-0004 (tables), ADR-0005 (normalisation layers, consent derivation), ADR-0006 (candidate
  keys, why identity never auto-resolves), ADR-0009 (rule codes, `entity_id` conventions,
  masking), ADR-0010 (the engine's inputs and `not_evaluable`), ADR-0011 item 1 (one verdict, one
  vocabulary), ADR-0014 (the machine, the actors, the audit entry).
- `docs/profile/data-profile.md` P-29/P-30 (the consent log), P-3 (email), P-9/P-11 (plausibility).
