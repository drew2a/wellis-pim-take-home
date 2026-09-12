# ADR-0010: Eligibility engine — precedence, reason grammar, missing inputs and term matching

- **Status:** proposed
- **Date:** 2026-09-12
- **Deciders:** Andrei Andreev
- **Requirements:** R-B5, R-B6, R-B7, R-B8, R-B9, R-B10, R-B11, R-B12 · **Resolves:** Q1
  (default B with the age carve-out), Q2 (already defaulted in ADR-0005), Q4

## Context and problem statement

ASSIGNMENT.md §3B lists six eligibility rules and one example explanation, and says nothing about
what happens when several rules match, what an explanation looks like in general, or what an
unevaluable input means. ADR-0005 fixed the thresholds, the term lists and two reason strings, but
it fixed them as *detector* outputs for the history audit; the engine that Part B submits through
is the same code and needs the rest of the grammar settled before it is written. The engine is a
graded decision (`CLAUDE.md` §1) and its reason strings are the text the console shows for legacy
and new intakes alike, so they are part of the contract, not an implementation detail.

## Decision drivers

- Deterministic and explainable beats clever (§3B, R-B5, R-B10): no short-circuit that hides a
  matched rule, no clock, no I/O, no LLM.
- Precedence must be stated and versioned, not implied by evaluation order (R-B7, R-B8).
- Every outcome carries a human-readable explanation naming the triggering values (R-B9).
- A missing value must never clear a patient silently (`CLAUDE.md` §5).
- One definition of matching, shared by the import-time history audit and the Part B form
  (ADR-0005, "Detectors (shared with Part B, run at import)").
- The engine owns the rules; a route handler or a form must not be able to change an outcome by
  choosing what to pass where.

## Considered options

1. Strict severity ordering: any reject rule wins, then any flag rule, else clear (Q1 answer A).
2. Collect all matches, then resolve, with age under 18 as an absolute reject and every other
   reject yielding to a flag (Q1 answer B with the carve-out documented in `QUESTIONS.md`).
3. A per-rule-pair precedence matrix (Q1 answer C).

## Decision outcome

Chosen option: **Option 2**, the default recorded in `QUESTIONS.md` Q1, because a GLP-1 patient
whose BMI has dropped below 27 *because of* the GLP-1 is the core customer and auto-rejecting them
is clinically wrong, while "this patient is 16" is a legal gate a reviewer cannot resolve in the
patient's favour. Wellis was asked (Q1, sent 2026-09-09) and has not answered; if they answer A or
C, precedence is configuration in the ruleset file, not a rewrite.

### The engine

`evaluate(input, rules)` in `src/eligibility/` is pure: no I/O, no database, no clock. It reads
every threshold and term list from the `rules` object and holds no literal of its own. Ruleset
loading stays at the boundary (`src/rules/load.ts`, ADR-0005).

```ts
interface EligibilityInput {
  readonly ageYears: number | null;      // whole years at the reference date
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly medications: readonly string[];
  readonly conditions: readonly string[];
  readonly conditionsOther: readonly string[];
}
```

- **`ageYears` is computed by the caller** at the reference date (`submitted_at`, Q4) with
  `ageInYears` from `src/eligibility/age.ts`; the rule itself sees a number. The reference date is
  therefore a convention of the callers, not a ruleset field: the ruleset holds `minimum_years` and
  nothing else, because a `reference` key the engine never reads could be changed without changing
  any evaluation, which is worse than not having it. A 29 February birthday
  falls out of the calendar comparison: born 2008-02-29 is 17 on 2026-02-28 and 18 on 2026-03-01.
- **All three numbers are nullable** because unusable values exist in this export: 5 patients have
  a future `dob` (canonical null) and the plausibility detector nulls 6 intake weights and 6 intake
  heights (ADR-0005).
- **`conditions` versus `conditionsOther`.** The GLP-1 and flag-condition lists only ever add a
  flag, so they are matched over everything. The weight-related list can *suppress* the band flag,
  so it is matched over `conditions` only. This is ADR-0005's rule — free text "can only add a
  flag, never clear one" — placed in the engine's type, where a route handler cannot get it wrong.
  A legacy intake passes its raw `conditions` value as `conditions` and nothing as
  `conditionsOther`; the Part B form passes the checklist as `conditions` and the "other" box as
  `conditionsOther`.
- BMI is `weightKg * 10000 / (heightCm * heightCm)`, unrounded; rounding is display only (Q2,
  ADR-0005). The multiplication is deliberate: `weightKg / (heightCm / 100) ** 2` divides by an
  inexact quotient and lands a mathematically exact 30.0 on either side of an inclusive band
  boundary depending on the height, so two patients with the same BMI get different outcomes.
  The form here is exact for every one-decimal weight at every whole-centimetre height in the
  plausibility bounds.
- The engine **throws** on a non-finite or non-positive `weightKg` or `heightCm` and on a negative
  or non-integer `ageYears` (`CLAUDE.md` §2, fail loudly). Plausibility bounds stay outside the
  engine: nulling an implausible value is the mapper's job (ADR-0005 layer 1), and the engine then
  sees null.

The result is `{ outcome, reasons, inputs, rulesetVersion }`, where `outcome` is
`auto_rejected | auto_flagged | auto_cleared | not_evaluable` and `inputs` carries the age, the
weight, the height, the unrounded BMI and the matched terms with the text that matched them, so an
evaluation explains itself without re-running.

### Missing inputs: `not_evaluable`

A missing input **can only remove the possibility of clearing; it never cancels a rule that fired
on the inputs that are present.** Age 16 with no weight is still `auto_rejected`; a GLP-1
medication with no height is still `auto_flagged`. Only when no rule matched and one of age,
weight or height was missing is the outcome `not_evaluable` — never `auto_cleared`, because the
engine cannot tell "every rule passed" from "a rule could not run" with a single cleared verdict,
and a caller that switches on `outcome` would clear a patient nobody evaluated (`CLAUDE.md` §5).
The `not evaluated` reason lines are unchanged: they are what such an evaluation explains itself
with, and no clearing line is appended.

`not_evaluable` is an engine outcome, not an intake state: **the state machine maps only the three
`auto_*` outcomes** (R-B13's `intake_state` is unchanged). It cannot reach the state machine —
the Part B form validates age, weight and height before `evaluate` runs, so a submitted intake
always has them — and where it does occur, at import over legacy rows that are missing a value, the
history audit stores it in the shadow evaluation and the import report counts it.

### Precedence, in the ruleset

`rules/v1.json` gains a `precedence` block and the Zod schema **requires** it, so a ruleset without
a precedence statement fails at load rather than falling back to a default in code:

```json
"precedence": { "absolute_rejects": ["age_below_minimum"], "flag_preempts_reject": true }
```

Every rule is evaluated; nothing short-circuits, so every matched rule contributes its reason.
Resolution:

| Matched | Outcome |
|---|---|
| an absolute reject (age under 18), whatever else matched | `auto_rejected` |
| a non-absolute reject (BMI) **and** a flag | `auto_flagged`, with the resolution line |
| reject rule(s) only | `auto_rejected` |
| flag rule(s) only | `auto_flagged` |
| none, and age, weight and height were all present | `auto_cleared` |
| none, and any of age, weight or height was missing | `not_evaluable` |

### Reason grammar

Five prefixes, and nothing else: **`rejected:`**, **`flagged:`**, **`not evaluated`** (as
`age not evaluated:` / `BMI not evaluated:`), **`note:`**, **`cleared:`**. `rejected:` and
`flagged:` state a rule that matched; a `not evaluated` line stands where a rule's reason would
have been; `note:` records something that changed nothing but explains the outcome; `cleared:` is
the final line of a cleared evaluation. Reasons appear in fixed rule order — age, BMI, GLP-1, flag
conditions — followed by the resolution or `cleared:` line, so the same input always yields the
same array.

| # | Format | Example |
|---|---|---|
| 1 | `rejected: age {n} at submission` | `rejected: age 16 at submission` |
| 2 | `age not evaluated: date of birth missing` | |
| 3 | `rejected: BMI {bmi} below {threshold}` | `rejected: BMI 24.1 below 27` |
| 4 | `flagged: BMI {bmi} with no weight-related condition` | `flagged: BMI 27.4 with no weight-related condition` |
| 5 | `note: BMI {bmi} in the {min}–{max} band, weight-related condition present ({texts})` | `note: BMI 28.3 in the 27–30 band, weight-related condition present (hoge bloeddruk)` |
| 6 | `BMI not evaluated: {weight \| height \| weight and height} missing` | `BMI not evaluated: weight missing` |
| 7 | `flagged: current GLP-1 medication ({texts})` | `flagged: current GLP-1 medication (Ozempic 0,5 mg)` |
| 8 | `flagged: self-reported history of thyroid cancer / pancreatitis ({texts})` | `flagged: self-reported history of thyroid cancer / pancreatitis (schildklierkanker (2019))` |
| 9 | `flagged: {reject reason without its prefix}, but a flag rule also matched; a human decides` | `flagged: BMI 24.1 below 27, but a flag rule also matched; a human decides` |
| 10 | `cleared: no rejecting or flagging rule matched` | |

Lines 7 and 8 are ADR-0005's wording verbatim; the history audit's items quote the same strings.
`{bmi}` is the value to one decimal, widened to more decimals only when one decimal would
contradict the comparison the line states: a BMI of 26.99 must not be explained as
`BMI 27.0 below 27`, which is what plain one-decimal rounding produces at that boundary. The
rounding is display only and never enters a comparison (Q2). `{threshold}`, `{min}`
and `{max}` are the ruleset's numbers rendered plainly (`27`, not `27.0`). `{texts}` is the
matching segments as typed, joined by `; `. Line 10 is appended whenever the outcome is
`auto_cleared`, so an evaluation whose only other line is a `not evaluated` note still explains its
outcome (R-B9). Line 9 does not replace the reject reason it resolves: line 3 stays in the array,
and line 9 says why the outcome is not `auto_rejected`.

A missing weight or height therefore never clears a patient silently: the BMI rules do not fire,
line 6 records why, and the outcome is `not_evaluable` unless another rule matched. The caller
decides what that means — a validation error in the Part B form, a recorded fact in the history
audit's shadow row.

### Term matching

One matcher, `src/eligibility/terms.ts`, used by the engine and by the history audit.

1. **Split** each value into segments on `;` and on `,` **not followed by a digit**. In this export
   a comma inside `meds_current` is always a Dutch decimal (`Ozempic 0,5 mg` ×5, `Wegovy 1,7mg` ×4)
   and never a separator, while 193 `conditions` values separate with `;`; splitting on every comma
   would make the reason read `(Ozempic 0)`. The exception keeps `metformine, ozempic` working for
   the Part B free-text box. Splitting affects only the text quoted in the reason, never whether a
   term matches.
2. **Normalise** a segment for matching: lowercase, replace every character that is neither a
   letter nor a digit with a space, collapse runs of spaces. Digits are kept, because
   `diabetes type 2` is itself a term. Dose stripping falls out of this rule and needs no dose
   grammar: `Ozempic 0,5 mg` normalises to `ozempic 0 5 mg`.
3. **Match** a term when its own tokens appear as a contiguous run of tokens in the segment — never
   a bare substring, so `hypothyreoidie` and `levothyroxine 50mcg` match nothing and `pcos` does
   not match `pcosx`.
4. **Report** the matched term together with the segment **as typed**, trimmed and otherwise
   unmodified, which is what the reason string quotes.

### Consequences

- Good: precedence, thresholds and term lists all live in the versioned ruleset; the engine is a
  pure leaf module with no literal of its own, callable from a test without a database (R-B5,
  R-B8, `CLAUDE.md` §2).
- Good: one matcher and one reason grammar for legacy and new intakes, so the console renders both
  the same way (ADR-0005).
- Bad: `auto_rejected` is rarer than a strict reading of §3B would make it, and the review queue is
  correspondingly larger. That is the point of the carve-out, and it is reversible by editing
  `precedence` in a new ruleset version.
- Bad: `flag_preempts_reject` as a single boolean cannot express Q1 answer C (a matrix per rule
  pair). Accepted under YAGNI: answer C is the least likely of the three, and it is a schema change
  in a new ruleset version, not a rewrite of the engine.
- Follow-up, **the detectors branch amends `eligibility_evaluations`** (ADR-0004, ADR-0005): today
  the table stores the verdict in the legacy `outcome` vocabulary and has no column for the inputs
  the engine saw, so a stored evaluation is not explainable from its own row. It needs an
  engine-outcome column in the engine's own vocabulary — the three `auto_*` outcomes and
  `not_evaluable` — and an `inputs` jsonb column, decided in the ADR that governs that branch.
- Neutral: `ageInYears` moves from `src/import/mapper/dates.ts` to `src/eligibility/age.ts` and the
  importer imports it from there, keeping the dependency pointing at the leaf — the importer
  already depends on the engine for the shadow evaluation.

### Confirmation

- Unit tests per rule at its boundaries (BMI 26.99 / 27.00 / 30.00 / 30.01, and both band
  boundaries over every height from 150 to 200 cm so the arithmetic is tested away from the
  one height whose denominator is exact; age 17 years 364 days
  and 18 years 0 days; a 29 February birthday), every reason string asserted verbatim, the 26.99
  case pinning that the explanation does not round itself into a contradiction.
- Unit tests for precedence: GLP-1 with BMI 24 → `auto_flagged` with both reasons and the
  resolution line; age 16 with a GLP-1 → `auto_rejected` with both reasons and no resolution line.
- One unit test per outcome for a missing input: age 16 with no weight → `auto_rejected`; a GLP-1
  with no height → `auto_flagged`; no rule matched with any of the three missing → `not_evaluable`
  and no clearing line; everything present and nothing matched → `auto_cleared`.
- Unit tests for the matcher's positive and negative cases above, a `;`-separated list, a comma
  that is a decimal and a comma that is a separator, and a dose in each notation seen in the export.
- A test asserting that a ruleset without `precedence` fails at load, before `evaluate` runs.
- A determinism test: the same input evaluated under two different system times is deep-equal.

## More information

- ASSIGNMENT.md §3B; `QUESTIONS.md` Q1, Q2, Q4; ADR-0005 (thresholds, term lists, shadow
  evaluation, the free-text safety net); ADR-0004 (`eligibility_evaluations`).
- Term frequencies quoted above are from `legacy_export/intakes.csv`: 30 distinct `meds_current`
  values, 20 distinct `conditions` values.
