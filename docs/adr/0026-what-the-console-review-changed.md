# ADR-0026: What a reviewer may correct, and which two records a merge joins

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-C4, R-C5, R-C6, R-A7, R-A8, R-A17, R-B20 · **Relates to:** ADR-0022
  (what a merge may change), ADR-0023 (the console's conventions), ADR-0025 (a consent state a
  human established)

## Context and problem statement

The pre-merge review of `feature/review-console` (`CLAUDE.md` §3) found thirteen defects. Ten are
plain bugs and are simply fixed. Three are not: fixing them requires choosing something that was
never decided — which fields a reviewer may correct and on which row, what a screen does when a
decision cannot be carried out at all, and which two records a merge joins when the item compares
more than two. ADR-0023 is accepted and immutable, so those three are recorded here.

## Decision drivers

- A screen never offers a decision the server will refuse (`CLAUDE.md` §2: the client carries no
  business rules, and the server is the only authority).
- A stored value that differs from the raw value has a record of the change, and **nothing else
  does**: an audit entry for a change that was never written is as wrong as a change with no entry
  (`CLAUDE.md` §5).
- What a reviewer sees is what the server writes. On a merge — the highest-stakes operation in the
  console — the two must not be able to drift apart.
- YAGNI: the export holds no candidate group larger than two
  (`reports/import-report.json`, `identity.groupSizes`: `[{key: '2', rows: 70}]`), so the
  three-record case is about the new flow and not about today's queue.

## Decision outcome

### 1. `submitted_at` joins the fields the console may write, and an item is corrected on the row that owns the field

`FIELDS.intake` gains `submitted_at` (a nullable calendar date), and `writableTarget` — one
function, used by the decider, by the screen and by the current-value read — answers **which of
the rows an item names holds that column**. The patient is asked first, so `weight_kg` and
`height_cm` still correct the patient's copy as before; a field only the intake has reaches the
intake.

`intakeFlagItems` raises a `data_quality` item naming the intake **and** its patient for a
submission date it could not read, and `data_quality` routed every item with a patient to the
patient. Only the intake has `submitted_at`, so the buttons the screen offered would be answered
with a 400 naming a column the reviewer could not see, and the screen would report the field empty
whatever the intake held. A reviewer reading the raw `32/13/2024` next to the patient's other
records can often date the submission, and there is no reason the one value the item exists for
should be the one value the console cannot write.

**This export produces none of these items, and that is why nothing caught it.** All 62
`data_quality` items are about a legacy patient — `select count(*) from review_items where
type='data_quality' and intake_id is not null` is `0` — so the broken branch is one no screen in
this database reaches. The 11 date items the module header counts are patient `dob`, which route
to the patient and always worked. The fix is to a latent path, and its test is the only thing that
exercises it.

### 2. An item with no row to correct is dismiss-only, and the screen says so in one line

A consent event whose timestamp could not be read was **never stored**, and ADR-0007 does not let
a `consent_events` row be written at all. There is no row to correct and there never will be, so
`writableTarget` returns null, the decider refuses a value, and the screen renders the note field
and "Leave it empty" alone, above one line: *"No canonical event was stored for this line; the raw
line is kept in `legacy_consent_events_raw`."* A dead end a reviewer can walk into is worse than a
door that is not there.

### 3. A merge names both sides; with three or more candidates the reviewer picks the loser

`candidateGroups` is the transitive closure over a shared key, so a new-flow submission matching an
existing pair produces a group of three — which is why `Survivor.losers` is plural. The screen
assumed the group was a pair: `const loser = survivor === 0 ? 1 : 0`, and a field pick posted
`{source: 'loser'}`. Choosing the third record as survivor therefore merged the **first**, and a
value picked from the third was resolved from the first. The reviewer saw one thing and the server
wrote another.

With three or more candidates the screen now asks a second question — *which record is merged into
it* — and a value may be picked only from the two records in that merge; the others are shown as
context and named as not part of it. Changing either side clears the picks, because a pick names a
record by its position. **One merge joins two records**: a group of three needs a second decision,
and the other records are left exactly as they are.

The alternative — merging every other candidate into the survivor in one decision — was rejected
for now. It would make `{source: 'loser'}` ambiguous, and giving a field decision a patient id is a
change to the contract ADR-0022 fixed. It is the better screen if groups of three ever become
common; today there are none.

### Also decided, and smaller

- **A merge's `decidedColumns` is read off the decisions, not off the changes they produced.**
  Picking the survivor's own empty value is a decision that the field stays empty. Reading the set
  off `decided` — which holds only fields whose value changed — let ADR-0006's rule fill the field
  from the loser anyway: the column kept the survivor's null and the survivor's audit entry claimed
  it had gained the loser's value.
- **A decided or corrected number is compared and recorded in the shape the column stores it.**
  `weight_kg` is `numeric(5,1)` and reads back as `80.0`; a reviewer typing `80` was recorded as
  `80.0 → 80` and then stored as `80.0` again. `oneDecimal` now canonicalises, and the resolution
  path compares and records the **parsed** value rather than the text as typed.
- **A consent state a reviewer establishes is written on the surviving record.** `derivedConsentState`
  already read it through `survivorOf`; `establish` carried `item.patient_id`. On an item whose
  record has been merged away since, the gate was checked on the survivor and the decision written
  on the loser, where the next `recomputeConsentStates` deletes it (ADR-0008 item 2, ADR-0025).
- **The exported rows on a patient's page show a masked `bsn`.** The stored row keeps the digits
  (R-A8); the page does not. ADR-0023 item 8 makes reading the number a route that writes an audit
  entry first, and the same nine digits printed further down the same screen made that a formality.
- **A BMI is shown the way the engine's own reasons show it.** The input panel dumped the raw
  float — `35.35353535353536` — where Q2's default is "computed on unrounded BMI, displayed to one
  decimal". One decimal alone is not enough: a stored `26.9536…` rounds to `27.0`, which would have
  sat directly above the reason `rejected: BMI 26.95 below 27`. `showBmi` reuses the engine's
  `formatBmi`, widening until the value shown sits on the same side of every threshold as the exact
  one, so the panel and the reason under it cannot show one number two ways.
- **Losing a race is a 409, not a 500.** `lockOpenItem` raises `ItemClosedError`, and the
  transition route tells a state race apart from a role refusal by re-reading the intake: both are
  `IllegalTransitionError`, and only one of them is about the reviewer.

### Consequences

- Good: the screen and the server answer the same question — `writableTarget` — so what the console
  offers and what the route accepts cannot drift.
- Good: an unreadable submission date becomes correctable, and an unreadable consent timestamp
  stops pretending to be — neither of which this export happens to contain, so both are covered by
  tests rather than by the queue.
- Good: the merge screen is correct for a group of any size, and it is unchanged for a pair, which
  is every group in today's export.
- **Bad, and not built: a correction can leave a shadow evaluation stale.** `eligibility_evaluations`
  stores the inputs an intake was judged on, and `submitted_at` is one of them, through age at
  submission. Correcting it leaves a shadow row whose `inputs.ageYears` names an age that is no
  longer right. Recomputing that one row is **not a small commit** and is not in this branch: the
  history audit derives its inputs from the importer's `MappedIntake`/`MappedPatient` structures and
  not from canonical rows, so a recompute needs a second derivation; `loadRules` takes a filesystem
  path and has no version→path map, so a row cannot be re-evaluated under the `ruleset_version` it
  carries; and re-running today's rules over history on a correction is itself a decision ADR-0005
  did not take ("browsable, never applied"). **This is broader than `submitted_at`**: `weight_kg`,
  `height_cm` and `alcohol_units_week` on an intake, and `dob` on a patient, are already writable
  today and already feed the same inputs, so the staleness exists on this branch before this ADR.
  It belongs in `README.md` as a named scope cut and in an ADR of its own.
- Neutral: no migration. `submitted_at` is an existing nullable column, and the state-machine
  trigger explicitly allows editing an intake's fields other than `answers`.

### Confirmation

- A pure test asserts a `data_quality` item naming both an intake and a patient corrects
  `submitted_at` on the **intake**, and that an item on a consent event's `at` is refused.
- An integration test posts a corrected `submitted_at` through the route and asserts the intake
  holds it with one audit entry; another asserts the `at` item is refused a value and dismissed.
- An integration test asserts that deciding for the survivor on a field it does not hold leaves the
  column empty and writes **no** `email` change at all.
- An integration test asserts that resolving `weight_kg` to `80` over a stored `80.0` writes no
  audit entry, and that `81` is recorded as `80.0 → 81.0`.
- A pure test asserts the consent decision is established on the survivor, and another that a
  survivor already merged away is refused with the same message as a loser.
- Boundary tests on `showBmi` at 26.99, 26.994, 27, 30.0 and 30.04, plus one asserting it agrees
  with the reason string the same evaluation carries.
- Not covered by a test: the transition route's 409-on-race. Reaching it needs the intake to move
  between the route's read and its transaction, which no integration test can produce
  deterministically without instrumenting the repository.

## More information

- The review that produced these: 13 findings on `feature/review-console`, 3 of which needed a
  decision. `CLAUDE.md` §3 (review before merge), §4 (what the agent decides and what it asks).
- ADR-0006 (what a merge copies), ADR-0007 (consent events are never updated), ADR-0008 item 2
  (membership), ADR-0022 (a reviewer's merge), ADR-0023 items 5 and 8, ADR-0025 (an established
  consent state).
- `reports/import-report.json` → `identity.groupSizes`, for the claim that every candidate group in
  the export is a pair.
