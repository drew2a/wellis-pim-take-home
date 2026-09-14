# ADR-0029: An orphan intake has no identity to match on

- **Status:** proposed
- **Date:** 2026-09-14
- **Deciders:** Andrei Andreev
- **Requirements:** R-A10, R-C5, R-C6 · **Relates to:** Q9 (orphan intakes) ·
  **Supersedes:** the look-alike paragraph of [ADR-0006](0006-identity-duplicates-and-orphans.md)
  (§ Orphan intakes, and the "Neutral" consequence about the look-alike search). The rest of
  ADR-0006 — no placeholder patient, two actions, an unresolved orphan is an acceptable outcome —
  stands unchanged.

## Context and problem statement

ADR-0006 gives each of the 21 orphan intakes a review item whose payload carries **look-alike
patients**: same height, weight within 10 %, signup at most a year before the intake. It is
labelled context, not a proposal, and the console renders it under the heading *"Patients that
look like this one"*.

The criterion discriminates almost nothing, because the programme selects for exactly those
values. This is a weight-care population: heights and weights cluster by construction, so a
band that would be narrow in the general public is the middle of this distribution.

Measured over the whole export with a throwaway driver around `lookAlikes()` as it stood at
`50ada8e` — the last commit before this change deletes it, so the measurement is reproducible from
`git show 50ada8e:src/import/review/cross-file.ts` and not from the working tree:

- 14 of the 21 orphans have at least one look-alike; the distribution is
  0 → 7 orphans, 1 → 3, 2 → 1, 3 → 3, 4 → 3, 5 → 1, 6 → 1, 7 → 1, 8 → 1.
- Intake `INT-9917` lists four people born **1962, 1973, 1986 and 2005**, all 180 cm,
  111–120 kg. They have nothing else in common.
- Intake `INT-9899` lists **eight**, all 162 cm, 76.9–88.9 kg.
- The crowding is a property of the cohort, not of the orphans: the most populated
  height/10-kg buckets among the 2466 patients hold 23, 20, 18, 18 and 17 people.

An orphan intake carries **no identity field at all** — no name, no date of birth, no email.
That is precisely why ADR-0006 refuses to build a placeholder patient from one. The same fact
applies to matching: build is not a weaker identity signal, it is **not one**. A list rendered
under a heading that says these patients look like this one reads as a shortlist of candidates,
and the consequence of acting on it is attaching a stranger's medical record to a living patient.
The banner's caveat ("context, not a proposal") asks the reviewer to distrust what the screen
put in front of them; the screen wins.

## Decision drivers

- **`CLAUDE.md` §5: identity never auto-resolves, and a guess needs evidence.** A criterion that
  matches four unrelated people is not evidence of identity; showing it while writing that it is
  not a proposal is a contradiction the reviewer has to resolve under time pressure.
- **The cost is asymmetric.** An unresolved orphan is an acceptable outcome, already stated in
  ADR-0006 and counted in the report. A wrong attachment writes medical history onto the wrong
  person and is discovered, if at all, much later.
- **Deterministic and explainable beats clever** (brief §3B). "Nothing here identifies a person"
  is both, and it is true.

## Decision outcome

**Remove the look-alike block entirely** — from the orphan review item's payload at import and
from the item screen. Nothing replaces it.

What stays, unchanged: the intake shown in full, **attach to an existing patient** by search over
name, email and legacy id with a required note, and **leave unresolved**. There is still no
"create a patient" action.

The banner stops apologising for the list and states the situation instead: *the intake carries
nothing that identifies a person, so there is nothing to match on; attach it if you know who it
is.* That sentence is the honest form of the same warning, and it does not need a list under it
to make its point.

The alternative — keep computing it, stop displaying it — was rejected: a field nobody reads is
a field that comes back, and the payload is what a later screen or report would reach for.

### What changes

- `lookAlikes()` and its `LookAlike` type are deleted from `src/import/review/cross-file.ts`,
  with the `daysBetween` helper that existed only for it. `orphanItems()` loses its `Export`
  parameter; it needed the patient list for nothing else.
- The payload keeps `intake_id`, `legacy_patient_id`, `intake`, `actions`; `look_alikes` and the
  `note` line about a single look-alike being a guess are gone. The `dedupe_key` is untouched, so
  the 21 items are the same 21 items across a re-run.
- Payloads already in the database keep their `look_alikes` key until the next import overwrites
  them. It is inert: nothing reads it after this change, and the screen renders `payload` through
  an explicit list of keys.
- The console drops the *"Patients that look like this one"* card and its `lookAlikes()` payload
  reader; `ITEM_COPY.orphan_intake.banner` carries the new sentence.
- No migration: the payload is `jsonb` and no column changes.

### Consequences

- Good: the one screen in the console that could hand a reviewer a stranger's record no longer
  suggests one. Attaching is now exclusively a search the reviewer initiates from something they
  know.
- Good: one fewer unversioned heuristic. ADR-0006 noted the look-alike search was not in
  `rules/v1.json`; deleting it removes the anomaly rather than regularising it.
- Bad: the 3 orphans with exactly one look-alike lose a hint that was occasionally right. Accepted
  — the reviewer could not tell those three from the one with eight, and ADR-0006 already refused
  to act on them.
- Neutral: no number in the import report moves. The report never counted or mentioned
  look-alikes; it counts 21 orphan intakes, which is unchanged.

### Confirmation

- `grep -ri "look.alike\|look_alikes" src drizzle` returns nothing.
- `review.test.ts` still asserts 21 orphan items with the two actions; the two tests that asserted
  the look-alike distribution and the matching criterion are deleted with the code they tested.
- The import report diffs to zero against the run before this change.

## More information

- [ADR-0006](0006-identity-duplicates-and-orphans.md) — orphans, no placeholder patient, the two
  actions. Only its look-alike paragraph is superseded here.
- `docs/findings.md` § `intakes.legacy_patient_id` — the profiling record, whose **Agreed**
  (2026-09-09) entry proposed the look-alike context. Kept as written; this ADR is the later
  decision.
- `docs/console-stories.md` S-8 and `docs/reviewer-day.md` step 3 — updated to match.
