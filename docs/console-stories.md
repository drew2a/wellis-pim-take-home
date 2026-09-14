# Part C: user stories and acceptance criteria

The scenario in [`reviewer-day.md`](reviewer-day.md) turned into stories that can be tested. One
story per thing a reviewer does; the acceptance criteria are what the tests assert.

**How to read a story.** *As a …* names who the story is written for — `ops`, `doctor`, or
`either`. Since ADR-0027 that is a description of the work, never a permission: every story is open
to any signed-in reviewer. The heading survives because it names the scenario's division of
labour (see [D-11](#d-11)). **Done when** is a list of assertions; each is either a
test or a rendered element a test can find. `R-xx` are the requirements in `REQUIREMENTS.md`,
`Q-n` the questions in `QUESTIONS.md`.

**Where the numbers come from.** Every count below is a `select count(*)` against the compose
database with `legacy_export/` imported and eleven test submissions from the new flow, taken on
2026-09-13:

```sh
psql "$DATABASE_URL" \
  -c "select type, status, created_by_run is null as new_flow, count(*) from review_items group by 1,2,3 order by 1;" \
  -c "select state, count(*) from intakes group by 1 order by 1;"
```

| review item type | open | of which raised by the new flow | intake state | rows |
|---|---|---|---|---|
| `clinical_history` | 115 | 0 | `legacy_approved` | 2068 |
| `consent` | 83 | 0 | `legacy_rejected` | 517 |
| `data_quality` | 62 | 0 | `legacy_pending` | 332 |
| `identity_conflict` | 44 | 2 | `draft` | 11 |
| `orphan_intake` | 21 | 0 | `auto_flagged` | 6 |
| `vocabulary` | 10 | 2 | `auto_cleared` | 4 |
| `duplicate_intake` | 5 | 0 | `auto_rejected` | 1 |
| **total** | **340** | **4** | **total** | **2939** |

The scenario's figures (42 identity conflicts, 8 vocabulary items) are the **import's** figures and
are right for import run 1; the live queue carries four more because the new intake flow raises
items of the same two types (ADR-0015). No acceptance criterion below hard-codes a number — each
one compares what the screen shows against the query that produces it, so the stories survive a
re-import ([D-6](#d-6)).

No intake has ever been in `in_review`, `approved` or `rejected`: edges 5–10 of ADR-0014 exist and
are tested, and this branch builds the first routes that offer them. `legacy_expired` and
`submitted` have no rows and cannot get any ([D-5](#d-5)).

---

## The queue

### S-1 · One queue, both work sources · *either*

As a reviewer I open `/console` and see every piece of outstanding work in one table, whether it
came from the import or from a patient who submitted this morning.

**Done when**
- One table holds rows of two kinds: review items and intakes (R-C2).
- Columns: type · title · patient · age · status.
- A row's **type** is the `review_items.type` for an item and the `intakes.state` for an intake,
  badged with the tone `src/ui/tones.ts` already assigns it — no second colour vocabulary.
- The **patient** cell links to the patient detail, and reads `—` for a row with no patient
  (21 orphan intakes, 10 vocabulary items).
- The row count equals the sum of the two queries for the same filters.
- Order: the intakes waiting for a person first, then the review items, each group oldest first on
  the age the story below defines — people waiting come before data to clean (ADR-0031,
  `docs/reviewer-day.md`). Nothing else is sortable (scope cut).

### S-2 · Age is the age of the work, not of the import · *either*

As a reviewer I can tell today's work from last year's.

**Done when**
- A review item's age is `review_items.created_at`.
- A **new-flow** intake's age is the `at` of its earliest audit entry — the `→ draft` entry
  (ADR-0016), which exists for 20 of the 22 drafts ever created.
- A **legacy** intake's age is `intakes.submitted_at`, *not* its `legacy import` audit entry:
  all 2917 imported entries share one transaction timestamp, so that reading would date every
  legacy intake to the day of the import ([D-14](#d-14)).
- An intake with neither renders `—` and still appears; it is never dropped by the join.
- `today` / `this week` / `older` are computed against the clinic's day in `Europe/Amsterdam`
  through `dayOf()`, never UTC (ADR-0017).

### S-3 · Filters and counts · *either*

As a reviewer I narrow the queue to the kind of work I am doing, and I can see how much of each
kind there is without clicking into it.

**Done when**
- **Type** filter: the seven `review_item_type` values and the twelve `intake_state` values, each
  with its count, taken from a `group by` and not from the page's rows ([D-5](#d-5)).
- **Status** filter: `open` / `resolved` / `dismissed`, defaulting to `open`. For intakes, status
  *is* the state, so the status filter applies to items only and the type filter carries the
  states; the screen says so rather than silently ignoring one of them.
- **Age** filter: today / this week / older, as S-2 defines them.
- The **default view** is everything waiting for a person: open items plus intakes in
  `auto_cleared`, `auto_flagged`, `auto_rejected` and `in_review` (`docs/reviewer-day.md`). No
  `draft`, `submitted`, `approved`, `rejected` or `legacy_*` intake appears until its state is
  selected.
- A filter that selects an empty set renders the table's empty line, naming what was selected —
  `draft`, `submitted` and `legacy_expired` are legitimately empty and say why.
- A test iterates `reviewItemTypeEnum.enumValues` and `intakeStateEnum.enumValues` and asserts
  every value is an offered filter whose result set matches its own `count(*)`.

---

## Ops work

### S-4 · Resolve a vocabulary item · *either*

As a reviewer I confirm or reject a rule the importer inferred, once, for every row it touched.

Ten open items, including "Confirm the date separator convention (dash = D-M-Y, slash = M-D-Y)",
"Confirm that outcome `OK` means approved", "bsn retention: keep, mask or drop".

**Done when**
- The view shows the item's title, its rule code (read back from `dedupe_key` by `ruleOf()`), the
  evidence in `payload.evidence` (the P-n / H-n reference and the counts that justified it) and
  the affected rows in `payload.rows`.
- Two actions, each requiring a note (R-C6): **confirm** (the rule stands) and **reject** (the
  rule does not) — `resolved` and `dismissed` respectively.
- Confirming a rule that has nothing to change (the convention is already applied) writes one
  audit entry against the item and changes no canonical value; the screen says that before the
  reviewer commits.
- A vocabulary item is one decision for a human, not hundreds of row decisions (`CLAUDE.md` §5),
  so it is one row in the queue however many rows it lists.

### S-5 · Apply a vocabulary item to its rows, minus the ones I exclude · *either*

As a reviewer I read 18 unit-less weights as pounds, except the three that are obviously not.

**Done when**
- Each of the 18 rows in `payload.rows` renders `legacy_id`, `raw_weight`, `height_cm` and both
  readings with both BMIs — the payload already carries exactly this
  (`as_kilograms {weight_kg, bmi}`, `as_pounds {weight_kg, bmi}`).
- Every row has a checkbox; excluded rows are not written.
- Applying writes, in one transaction: the new `weight_kg` on each included patient, **one audit
  entry per changed row** with the reviewer as actor and the note, and the item closed with
  `resolution` naming the excluded ids.
- A test applies an item with 2 of 3 rows excluded and asserts: one value changed, one audit
  entry written, two rows untouched, the item `resolved`, `resolution_note` present.
- A re-import does not undo it: the changed field is human-owned from the moment its audit entry
  names a non-`SYSTEM_ACTORS` actor (`humanOwnedFields`, R-A17). A test re-runs the importer
  after the resolution and asserts the value stands.

### S-6 · Resolve an identity conflict by merging · *either*

As a reviewer I decide that two records are one person, choose which record survives and which
value wins in each field, and the merge really happens.

44 open, 42 from the import (3 tier 2, 39 tier 3) and 2 raised by the new flow.

**Done when**
- Both records render side by side (R-C4), from `payload.rows` for a legacy item and from
  `payload.existing` + `payload.submitted` for a new-flow one — two shapes, one view, each parsed
  by a Zod schema at the boundary ([D-8](#d-8)).
- `payload.matched_keys`, `payload.contradictions` and `payload.tier` are shown; the fields in
  `differences` are highlighted.
- Each row shows its `intake_count` and its `consent_states`, from the payload.
- `bsn` is masked (`maskIdentifier`); revealing it writes an audit entry naming the reviewer
  (S-17).
- The reviewer picks the survivor and, per field, left / right / an edited value (R-C5), with a
  required note (R-C6).
- Applying, in one transaction: `patients.merged_into` set on the loser, every
  `patient_legacy_ids` row repointed, the chosen field values written to the survivor,
  `consent_states` recomputed over the membership, and audit entries on both patients carrying
  field-level provenance in `changes` (`{field, from, to, source_legacy_id}`) — plus
  `actor_reviewer_id` ([D-2](#d-2)).
- A test merges through the route and asserts each of those five, and that the losing row's legacy
  ids resolve to the survivor.
- The two rows are resolved to canonical patients through `patients.created_from_legacy_id`, the
  column that says which exported row this is, never through `patient_legacy_ids`, which a merge
  repoints (ADR-0011 item 18, [D-9](#d-9)).
- **Blocked on [D-1](#d-1):** `mergePatients` today copies only the fields the survivor does not
  hold, so a pick of the loser's value over a value the survivor has would be silently dropped.
  Merge semantics are graded (`CLAUDE.md` §1) — an ADR before the code.

### S-7 · Decide that two records are not the same person · *either*

**Done when**
- **Not the same person** dismisses the item with a required note, writes an audit entry, and
  writes no `merged_into` anywhere.
- **Leave open** is the third button and writes nothing at all.
- A dismissed pair is not re-raised by a later import (the item's `dedupe_key` is stable and the
  insert is `ON CONFLICT DO NOTHING`), and the 6 shared-BSN pairs stay a `data_quality` fact in
  the report (ADR-0006).

### S-8 · Resolve an orphan intake · *either*

21 open. Example: "intake INT-9902 references a patient that does not exist", `legacy_patient_id`
`reccXw7xuGLe0LLnN` in neither file.

**Done when**
- The view shows the intake (`payload.intake`) and the unresolved `legacy_patient_id`, and
  **no candidate patients**: an orphan intake carries no identity field, so there is nothing to
  match on, and a list under a heading like "patients that look like this one" would read as a
  shortlist (ADR-0029). The banner says so.
- **Attach to an existing patient**: search by name, email or legacy id; a required note; writes
  `intakes.patient_id`, one audit entry on the intake naming the reviewer and the note, item
  resolved.
- **Leave unresolved** dismisses with a note. An unresolved orphan is an acceptable outcome.
- No "create a patient" action exists anywhere in the view (a fabricated record is worse than a
  null reference).
- A test asserts the attached intake is returned by `intakesOf()` for the chosen patient.

### S-9 · Resolve a same-day pair · *either*

5 open. Example: "2 intakes from one patient on 2026-04-21".

**Done when**
- Both intakes render side by side with their outcome, raw outcome spelling, state and weight;
  `payload.outcomes_disagree` is shown when true.
- **Mark one as the record of note**: a required note; writes one audit entry per intake (the one
  chosen and the one not), with `from_state` and `to_state` null — nothing transitioned
  (ADR-0014 item 7) — and resolves the item.
- **Both rows stay.** A test asserts neither intake's `state` and neither `outcome` changed.

### S-10 · Work a consent item · *either*

83 open: 7 conflicts, 19 revoked while active, 57 without a record while active or paused.

**Done when**
- The view shows the patient's consent timeline — every `consent_events` row the membership
  returns, in `at` order, with action, type and version — next to the derived `consent_state` and
  the patient's commercial `status`. The log is evidence; the state is what we act on
  (`CLAUDE.md` §6).
- **Resolve** with a required note describing what was done outside the system, or **dismiss**
  with a note. Both write an audit entry and close the item; neither writes a consent event —
  a grant obtained on paper is not a click in this console.
- For the 7 `conflict` items only: **set the state** to `granted` or `revoked` with a note. The
  audit entry is the decision, carrying `consent_state:<type> conflict → granted`; the
  `consent_states` row is its cache, and an event arriving after the decision takes it back
  (ADR-0025). A state that is not `conflict` is refused: a clear revocation is acted on, not
  overridden.
- A test asserts a resolution with no note is refused by the route *and* by the database
  (`review_items_resolution_note_on_close`).
- The payload's second action, `change_the_patient_status`, is **not** offered ([D-7](#d-7)).

### S-11 · Resolve a data_quality item · *either*

62 open: 21 email, 17 bsn, 11 dob, 5 height_cm, 5 weight_kg, 3 signup_date.

**Done when**
- The view shows the raw value, the canonical value (usually null — the mapper blanked it), and
  `proposed_resolution` when the detector attached one (`{field, proposed_value, rule, evidence}`).
- Three actions, each with a required note: **accept the proposal**, **enter a value**,
  **dismiss**.
- Accepting or entering goes through the one resolution path: write the value, write the audit
  entry with actor, note and `changes`, close the item (ADR-0005 layer 3). Nothing else writes a
  canonical value after import.
- The new value appears in the patient's timeline (S-18) and survives a re-import (S-5's
  human-owned assertion).
- A `bsn` item renders the masked value from `payload.raw_masked` and never the full number until
  a reveal (S-17).

---

## Doctor work

### S-12 · Review an intake · *either*

As a doctor I open an `auto_flagged` intake and see what the patient said and what the rules made
of it. 6 `auto_flagged`, 4 `auto_cleared`, 1 `auto_rejected` today.

**Done when**
- The **submission** renders as given: the structured answers from `intakes.answers` and the free
  text as typed, unedited (R-C7).
- The **evaluation** renders from the intake's governing `eligibility_evaluations` row — the
  latest, non-shadow first on a tie, the same rule the transition function uses: `engine_outcome`,
  every line of `reasons`, the `inputs` the engine saw (age, weight, height, unrounded BMI, the
  matched terms with the text that matched them) and `ruleset_version` (R-B8, R-B9).
- This is the reviewer's screen, so the engine's own words are shown verbatim here — ADR-0020
  keeps them off the *patient's* screen, not off this one.
- An intake with no evaluation renders "no stored evaluation" rather than an empty panel, and the
  approve button is disabled with that reason (`checkTransition` throws on it).
- **Open the patient** links to S-16.

### S-13 · Claim an intake, exclusively · *either*

**Done when**
- **Claim** takes edge 5, 6, 7 or 8 to `in_review` with the reviewer as actor and a required
  reason (ADR-0014 item 2: nothing enters `in_review` but a named person).
- Any reviewer may claim — `ops` included. Claiming is triage, not a medical decision
  (ADR-0014 item 3).
- A second claim of the same intake fails: `in_review → in_review` is not an edge. The second
  reviewer sees the first reviewer's name, read from the claim's audit entry, and no claim button.
- A test claims twice and asserts the second call is refused and writes nothing.

### S-14 · Approve or reject · *either*

**Done when**
- **Approve** and **Reject** each require a note, which becomes the audit entry's `reason`
  (R-C8, R-B20).
- Both are open to any signed-in reviewer (ADR-0027). The gate that used to be here required a
  `doctor`, in a console where the reviewer picks their own name from a list — so it refused
  nobody, and it is gone rather than left implying otherwise.
- The actor comes from the session, never from the request body ([D-4](#d-4)).
- What the route still refuses is S-15, and it refuses it to everyone.

### S-15 · An under-18 intake cannot be approved by anyone · *either*

**Done when**
- `in_review → approved` on an intake whose governing evaluation matched `age_below_minimum` is
  refused, and the screen shows the refusal's own words — the same `matched` list the patient's
  explanation was built from (ADR-0014 item 3, Q1).
- **Reject** stays available for the same intake, and staying in `in_review` is a third outcome.
- A test asserts the refusal, that nothing was written, and that reject then succeeds.

### S-16 · Reopen a legacy_pending intake · *either to claim, doctor to decide*

332 rows, reachable only through the state filter.

**Done when**
- A `legacy_pending` intake offers **claim** (edge 8), after which S-14 and S-15 apply unchanged.
- `legacy_approved` (2068) and `legacy_rejected` (517) offer no transition at all: the view shows
  the legacy outcome, the shadow verdict and a line saying the legacy process decided and this
  console does not rewrite it (ADR-0014 item 7, `CLAUDE.md` §5).
- A test iterates the four `legacy_*` states and asserts exactly one of them offers a claim.
- ADR-0005 predicted a vocabulary item for the 332 as a bulk decision with a cutoff date; the
  importer raised none, and this per-intake door is the only one. Stated, not silently differing
  ([D-13](#d-13)).

### S-17 · Work a clinical_history item · *either*

115 open: 42 GLP-1 in free text, 15 flag conditions, 58 approved-or-pending minors.

**Done when**
- The view shows the legacy intake, the reason string
  ("flagged: current GLP-1 medication (rybelsus 7 mg)"), `payload.matched_terms`,
  `payload.legacy_outcome` next to `payload.shadow_outcome`, and the patient's current status and
  consent state.
- **The patient now**, on all three rules: status, consent state, and their age on the import's
  `--as-of` — the three facts that say whether the item is urgent or archival, and the ones the
  payload cannot carry because it describes an intake from 2024. Over the 58 minor approvals the
  patients are 26 active, 10 paused, 15 churned and 7 prospect, and a 17-year-old approved then may
  be an adult today.
- The reason field names what is actually done about this class: for a minor approval, that the
  patient or guardian was contacted, that participation was paused, or that the patient is an adult
  now and the record stands.
- **Resolve** or **dismiss**, each with a required note; each writes an audit entry with both
  states null (ADR-0014 item 7).
- A test asserts the legacy intake's `state` and `outcome` are unchanged after either action.

---

## Patient detail

### S-18 · The patient's record, and every record that belongs to it · *either*

**Done when**
- Header: the canonical `patients` row, `status`, `consent_state` per declared type, the legacy
  ids the record resolves (`patient_legacy_ids`) and the rows merged into it
  (`merged_into` pointing here).
- **Intakes**: every intake `intakesOf()` returns — the membership function, never a join on the
  copied `patient_id` (ADR-0008 item 2, ADR-0011 item 3) — with state, outcome and, for a legacy
  one, its shadow verdict.
- **Open items** for this patient.
- A test merges A into B, opens B, and asserts A's intakes *and* A's consent events are listed;
  opening A shows it as merged away with a link to B.

### S-19 · The audit timeline · *either*

As a reviewer I can see how this record came to look the way it does (R-C9).

**Done when**
- One timeline, newest first, from three sources: `audit_entries` for the membership's patients
  and intakes, `normalisation_records` (field, from → to, rule code, evidence), and the review
  items resolved against them (note, resolution, resolver).
- Entries sharing a timestamp are ordered by `audit_entries.seq` — a submit writes three entries
  in one transaction and `at` is the transaction's instant (ADR-0014 item 5).
- Every entry shows actor, time, from-state → to-state, reason, and `changes` when present.
- A merge entry renders its field provenance, `source_legacy_id` included.
- Nothing on this page can be edited or deleted. A test asserts the page issues no write.

### S-20 · Raw rows, read-only · *either*

**Done when**
- The exported rows behind this patient — `legacy_patients_raw`, and the raw rows of its intakes —
  render as exported, untrimmed (R-A8).
- `legacy_export/` is never read by the app; the raw tables are.

### S-21 · Masking, and a reveal that is itself audited · *either*

**Done when**
- `bsn` renders masked everywhere by default (`maskIdentifier`), on the queue, the conflict view
  and the patient detail.
- **Reveal** calls a route that writes an audit entry — actor, time, entity, reason "bsn
  revealed" — before returning the value.
- A test reveals and asserts the entry exists with `actor_reviewer_id` set.
- Masking is the default until the open vocabulary item "bsn retention: keep, mask or drop" is
  resolved.

---

## Cross-cutting

### S-22 · A session, or nothing · *either*

**Done when**
- `/login` lists the seeded reviewers (`select id, name from reviewers` — 2 today) and takes
  the shared console secret from the environment.
- A correct secret sets a signed, httpOnly, SameSite=Lax session cookie naming the reviewer id;
  a wrong one renders an error and sets nothing.
- `currentReviewer()` is the one helper every console page and every mutating route calls. The
  actor is the session's reviewer; no route reads an actor from a request body.
- Every mutating route without a session answers **401**; every console page without one redirects
  to `/login`. A test iterates the route table and asserts 401 for each.
- A session naming a reviewer who no longer exists is treated as no session.
- **Blocked on [D-4](#d-4):** ADR-0014 item 4 says "No SSO, no login, no sessions". An ADR amends
  it before the code lands.

### S-23 · Every action carries a real actor and a note · *either*

**Done when**
- One resolution path writes every item action: the value (if any), the audit entry with actor,
  `actor_reviewer_id`, note and `changes`, then the item closed with `status`, `resolved_by`,
  `resolved_at`, `resolution_note`, `resolution` (ADR-0005 layer 3).
- `resolved_by` is the reviewer's name as it was at the time, the same rule as
  `audit_entries.actor`; the stable id lives on the audit entry ([D-10](#d-10)).
- A resolution with an empty or whitespace-only note is refused by the route, by the resolution
  path, and by the database's `review_items_resolution_note_on_close` — three locks, tested.
- Nothing in the console deletes a row. A test asserts the console's SQL contains no `delete`
  against `review_items`, `audit_entries`, `intakes` or `patients`.

---

## Where the scenario, the data or an ADR disagree

Each of these is a place the scenario asks for something the code or an accepted ADR does not
currently give. None is adjusted silently.

### D-1
**Per-field picking is not what `mergePatients` does.** The scenario and R-C5 require the reviewer
to pick left / right / edit per field. `mergePatients` copies only the fields the survivor does
**not** hold (`fieldsGained` / `held` in `src/repo/merge.ts`), which is the right rule for a tier-1
merge of two identical rows and the wrong one for a human deciding between two different values:
picking the loser's `full_name` over the survivor's would be silently dropped. The item payload
already names the action `merge_with_chosen_values`, so the gap is between the payload and the
repository. **Merge semantics are graded** (`CLAUDE.md` §1) → ADR before code. *Proposed:*
`MergeRequest` gains an optional `fieldDecisions`, applied to the survivor inside the same
transaction with one `AuditChange` per field; the importer passes none and its behaviour is
unchanged, which a test asserts.

### D-2
**A merge writes no `actor_reviewer_id`.** `writeEntries` in `src/repo/merge.ts` sets `actor` only,
so a reviewer's merge would record their name and not the stable identity ADR-0014 item 4 requires.
*Proposed:* `MergeRequest` and `UnmergeRequest` gain `actorReviewerId`, null for the importer.
Not graded; recorded in the branch ADR.

### D-3
**`mergePatients` opens no transaction of its own** — the importer wraps it at run level
(`src/import/run.ts`). The console route must open one, or a failed merge leaves `merged_into` set
with the alias rows unrepointed. No ADR; a route-level `db.transaction`, asserted by a test that
fails the consent recomputation and finds nothing written.

### D-4
**The session contradicts ADR-0014 item 4**, which says "No SSO, no login, no sessions" and cites
Q8 default A. Step 2 of this branch adds a shared console secret, a signed cookie and
`currentReviewer()` — Q8's answer A *plus a door lock*, which is neither of the two answers Q8
offered. An accepted ADR is immutable, so this is a new ADR that amends item 4 and states the
honest limit: a shared secret gates the console, the reviewer still *asserts* who they are from a
list, and SSO is what a real deployment plugs in (R-S4).

### D-5
**"Every intake_state reachable through the queue filters" and the scenario's filter list
disagree.** The scenario lists seven states; the enum has twelve. `draft` (11 rows) is a patient's
unfinished form and not a reviewer's work; `submitted` exists only inside one request;
`legacy_expired` is unreachable by ADR-0014 and has 0 rows; `approved` and `rejected` are the
reviewer's own finished decisions, which a reviewer does want to find again. *Decision:* the type
filter offers **all twelve**, so the enum test is honest and no state is invisible, while the
**default view** stays the narrower set `docs/reviewer-day.md` names: the four states waiting for a
person (`auto_cleared`, `auto_flagged`, `auto_rejected`, `in_review`). The three that cannot have
rows render the empty line and say why.

### D-6
**Counts.** 42 identity conflicts and 8 vocabulary items are the import's figures and are correct
for run 1; the live queue has 44 and 10 because ADR-0015's detectors raise both types from the new
flow. No test hard-codes a count; each compares the screen against the query.

### D-7
**A consent item's payload offers an action the scenario does not.** The stored `actions` are
`record_the_state_a_human_establishes` and `change_the_patient_status`. The scenario offers
resolve / dismiss / set-the-state and says nothing about changing the patient's commercial status.
*Decision:* the second is not built. Consent is not commercial standing (`CLAUDE.md` §6: *status*
and *consent state* are different words for different things), and a status change from a consent
item would be a value change nobody asked for. Recorded in ADR-0023 item 3, not invented in code.

**Settled since, and larger than it looked:** `consent_states` is derived and recomputed on every
import and after every merge (ADR-0011 item 13), so a state set by hand would have vanished at the
next import with the item closed and nothing to show for it. **ADR-0025** is the answer: the
decision is the audit entry, the row is its cache marked `derivation_version = 'human'`, the
recomputation keeps it while the evidence it was taken over is still the latest, and an event that
orders after that supersedes it — so a patient who later consents properly needs nobody to
remember them. Zero of the seven conflict patients is on either side of a merged pair, counted and
asserted against the imported database.

### D-8
**One item type, two payload shapes.** A legacy `identity_conflict` carries `rows: [...]` keyed by
`legacy_id`; a new-flow one carries `existing: [...]` (with `patient_id` and `merged_into`) plus
`submitted`. Both are in the queue today. The conflict view parses both through Zod at the
boundary — `payload` is `jsonb` and is input from outside the type system like any other
(ADR-0003) — and fails loudly on a third shape rather than rendering an empty panel.

### D-9
**Resolving a legacy id to a patient.** The payloads name rows by `legacy_id`.
`patient_legacy_ids` is repointed by a merge, so after one merge it would resolve both rows of a
pair to the survivor and the view would show the same record twice. The stable column is
`patients.created_from_legacy_id` (ADR-0011 item 18), and it is what the conflict view uses.

### D-10
**`review_items` has no reviewer id column.** `resolved_by` is `text`. *Decision:* it holds the
reviewer's name as it was at the time — the same rule and the same reason as
`audit_entries.actor` — and the stable `actor_reviewer_id` lives on the audit entry the resolution
path writes in the same transaction. No migration.

### D-11
**The scenario's two roles are a filter, not a permission** — and since ADR-0027 they are not even
a column. This entry used to record the one exception: ADR-0014 item 3 gated `in_review → approved`
and `in_review → rejected` on `doctor`, while claiming and every review-item action were open to
both. That gate is removed. With one shared secret and the name picked from a list (ADR-0021), it
refused nobody, so every story above now says *either*.

What the scenario still describes is the work each colleague normally picks up, which the console
offers as a default filter — without a label on a person that pretends to be a permission.

### D-12
**`in_review` has no `claimed_by` column,** by decision (ADR-0014 item 1: exclusive claiming falls
out of the acyclic graph). "Claimed by Dr Vermeer" is therefore read from the claim's audit entry —
the latest entry on that intake whose `to_state` is `in_review` — not from a column.

### D-13
**ADR-0005 predicted a vocabulary item for the 332 `legacy_pending` intakes** ("three resolutions,
cutoff date"); the importer raised none — the ten vocabulary items in the database are the other
ten. The per-intake claim of S-16 is the only door, which is also what the scenario describes. No
change; stated so the ADR's prediction and the data are not silently different.

### D-14
**"Age … or the draft audit entry for an intake" does not work for a legacy intake.** All 2917
legacy intakes share one `legacy import` audit timestamp, so that reading dates every one of them
to the day of the import and the age filter becomes useless for 99 % of the queue. S-2 uses
`submitted_at` for a legacy intake and the `→ draft` entry for a new-flow one.

### D-16
**Every review-item type has a decider, so the switch is exhaustive.** The route's `default` branch
binds `never`, which means a type added to `review_item_type` without a decider fails `tsc` rather
than reaching a reviewer as a refusal nobody wrote.

### D-15
**The consent step's version caption.** ADR-0020 removed "Consent text version v3." from the
patient's consent step as machine vocabulary. The scenario asks for it back, reworded as a small
grey "Version v3 of our consent statement". That is the repo owner's call on a patient-facing
screen; it is a partial reversal of one line of an accepted ADR and is recorded in the branch ADR
with the reason: a patient signing a statement may reasonably see which statement it is, provided
it reads as a caption and not as a debug line.
