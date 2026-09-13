# ADR-0023: Console conventions: one resolution path, and nine small decisions

- **Status:** proposed
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-C2, R-C3, R-C4, R-C6, R-C9, R-A17, R-B20, R-S4 · **Relates to:** ADR-0005
  (the resolution path), ADR-0014 (the states), ADR-0020 (what a patient is shown)

## Context and problem statement

`CLAUDE.md` §4 makes small decisions the agent's to take and records them in the branch's ADR,
where the repo owner sees them when accepting it. Building the console raised nine, each too small
for an ADR of its own and each the sort of thing a second screen would otherwise answer
differently. They are collected here with the one convention that governs all of them: **there is
exactly one writer of a canonical value after import**, the resolution path of ADR-0005 layer 3 —
write the value, write the audit entry with actor, note and `changes`, close the item — and it
lives in `src/repo/resolve.ts`. The merge is the one deliberate exception, for the reason ADR-0022
gives.

None of these changes a rule; each fixes which of two readings the console uses.

## Decision outcome

| # | Question | Decision |
| --- | --- | --- |
| 1 | Which intake states the queue's type filter offers | **All twelve.** `docs/reviewer-day.md` lists seven, which is the right *default view*; the filter itself offers every `intake_state` so that no state is invisible and the test iterating the enum is honest. `draft` (a patient's unfinished form), `submitted` (transient inside one request) and `legacy_expired` (unreachable, ADR-0014) render the table's empty line saying why, rather than being absent from the list. `approved` and `rejected` are offered because a reviewer wants to find the decisions they took. |
| 2 | How old a queue row is | A review item: `review_items.created_at`. A **new-flow** intake: the `at` of its `→ draft` audit entry (ADR-0016). A **legacy** intake: `intakes.submitted_at`, *not* its audit entry — all 2917 imported entries share one transaction timestamp, so that reading would date every legacy intake to the day of the import and make the age filter useless for 99 % of the queue. A row with neither renders `—` and is still listed. Today / this week / older are the clinic's days in `Europe/Amsterdam` (ADR-0017), never UTC. |
| 3 | The second action on a `consent` item | **Not built.** The importer wrote `["record_the_state_a_human_establishes", "change_the_patient_status"]` into the payload; the console offers the first (for the 7 `conflict` items) plus resolve and dismiss, and not the second. Consent is not commercial standing (`CLAUDE.md` §6: *consent state* and *status* are different words for different things), and a `patients.status` change driven from a consent item would be a value change nobody asked for. The payload keeps both; the console offering one is the decision. |
| 4 | One item type, two payload shapes | A legacy `identity_conflict` carries `rows: [...]` keyed by `legacy_id`; one raised by the new flow carries `existing: [...]` plus `submitted` (ADR-0015). Both are in the queue. One view reads both, each through its own **Zod schema at the boundary**: `payload` is `jsonb` and is input from outside the type system like an HTTP body (ADR-0003). A third shape fails loudly rather than rendering an empty panel. |
| 5 | Resolving a payload's `legacy_id` to a canonical patient | Through **`patients.created_from_legacy_id`** (ADR-0011 item 18), never through `patient_legacy_ids`: a merge repoints the alias, so after one merge the alias would resolve both rows of a pair to the survivor and the conflict view would show one record twice. The alias answers "whose records are these now"; this column answers "which exported row is this", which is what a side-by-side view asks. |
| 6 | Who resolved an item | `review_items.resolved_by` holds the reviewer's **name as it was at the time** — the same rule and the same reason as `audit_entries.actor` (ADR-0014 item 4): the row is a record of a decision and must still say who took it after the person is renamed or removed. The stable `actor_reviewer_id` lives on the audit entry the resolution path writes in the same transaction. **No migration**, and no second identity column. |
| 7 | Who has claimed an intake | Read from the **claim's audit entry** — the latest entry on that intake whose `to_state` is `in_review` — not from a column. ADR-0014 item 1 declined a `claimed_by` column because exclusive claiming falls out of the acyclic graph; a column now would be a second copy of a fact the audit already holds, and the two could disagree. |
| 8 | Revealing a masked `bsn` | A reveal is a **route that writes before it reads**: one audit entry (actor, `actor_reviewer_id`, entity, reason `bsn revealed`) and then the value. A read that writes an audit entry is unusual and is deliberate — until the open vocabulary item "bsn retention: keep, mask or drop" is answered, the defensible position is that the number is available and every look at it is on the record. Masking (`maskIdentifier`) is the default everywhere: queue, conflict view, patient detail. |
| 9 | The consent step's version caption | Restored as a small grey caption reading **"Version v3 of our consent statement"**. ADR-0020 removed "Consent text version v3." as machine vocabulary aimed at the wrong audience, and that reasoning holds for the *wording*, not for the fact: a patient signing a statement may reasonably see which statement they signed, and the consent event stores that same version. A repo-owner decision on a patient-facing screen, recorded here as a partial reversal of one line of ADR-0020 rather than made silently. |

### Also settled, and not a decision

ADR-0005 predicted a vocabulary item for the 332 `legacy_pending` intakes ("three resolutions,
cutoff date"). The importer raised none — the ten vocabulary items in the database are the other
ten — and the per-intake claim of ADR-0014 edge 8 is the only door. Nothing changes; it is written
down so the ADR's prediction and the data are not quietly different.

### Consequences

- Good: nine questions a second screen would have answered differently are answered once, in a
  place the repo owner reads when accepting the branch.
- Good: one writer of canonical values after import means one place to test that a value change
  carries its actor, its note and its `changes` (R-A7, R-B20).
- Bad: item 8 makes a read a write, so a reviewer opening the same conflict twice writes two
  entries. Accepted: that is the point of an access record, and the alternative is a number nobody
  can account for having seen.
- Bad: item 1 offers three filters that can never have rows in this database. Accepted: an empty
  result that says why is more honest than a missing option, and it keeps the enum test total.
- Neutral: none of these needs a migration.

### Confirmation

- A test iterates `intakeStateEnum.enumValues` and `reviewItemTypeEnum.enumValues` and asserts each
  is an offered filter whose count matches its own `select count(*)`.
- A test asserts a legacy intake's queue age equals its `submitted_at` and a new-flow intake's
  equals its `→ draft` entry, and that an intake with neither is still listed.
- A test renders both `identity_conflict` payload shapes and asserts a third is refused.
- A test asserts the conflict view resolves its rows through `created_from_legacy_id` by merging a
  pair first and then re-opening an item that names both legacy ids.
- Integration test: revealing a `bsn` writes exactly one audit entry with `actor_reviewer_id` set,
  and the value is not in the response of any other route.
- Integration test: an item resolved by a reviewer has `resolved_by` equal to that reviewer's name
  and an audit entry carrying their id.
- `npm run lint` still passes with no `className` outside `src/ui/` (ADR-0018).

## More information

- `docs/reviewer-day.md` (the scenario these serve), `docs/console-stories.md` (the stories, and
  D-5, D-7, D-8, D-9, D-10, D-12, D-13, D-14, D-15 which are items 1–9 here).
- ADR-0005 (the resolution path), ADR-0011 items 3 and 18, ADR-0014 items 1 and 4, ADR-0015
  (the new flow's items), ADR-0016 (when a draft begins), ADR-0017 (the clinic's day),
  ADR-0020 (what a patient is shown), ADR-0021 (where the actor comes from), ADR-0022 (the merge).
