# ADR-0022: What a reviewer's merge may change

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A17, R-A31, R-C4, R-C5, R-C6, R-B20 · **Amends:** ADR-0006 (the
  reviewer's half of the merge path), ADR-0011 item 3 (what a merge writes) and item 9 (the
  question left open because the count was zero)

## Context and problem statement

ADR-0006 gave the reviewer of an `identity_conflict` this action: "the reviewer picks the surviving
row and, per field, the winning value (or edits it), with a required note; applying the decision
runs the same merge path with a human actor". R-C5 requires both halves — pick *and* edit. The
importer's tier-1 merges were built on that same path, and the path implements the tier-1 rule:
`fieldsGained` in `src/repo/merge.ts` copies a field from the loser **only where the survivor does
not hold one**, because two tier-1 rows are identical on every person field by definition
(ADR-0011 item 9 counted it: zero fields gained over all 28 pairs).

A human is deciding the opposite case. All 44 open items are tier 2 or tier 3 — the rows
*contradict*: 25 differ on name, 14 on date of birth. A reviewer who looks at "Bram Nair" and
"Braam Nair" and picks the loser's spelling is picking a value the survivor already holds a
different version of, and today that pick has nowhere to go: `mergePatients` would keep the
survivor's. The review items themselves already name the action they expect —
`payload.actions` is `["merge_with_chosen_values", "not_the_same_person"]` — so the gap is between
what the importer wrote into the queue and what the repository can do.

Merge semantics are graded (`CLAUDE.md` §1), and the console must not invent a second merge next to
the one that exists.

## Decision drivers

- No merge without a record of which row supplied which field (R-A31, `CLAUDE.md` §5).
- No value changes without a normalisation or audit record; a reviewer's edit is a value change
  like any other (R-A7, `CLAUDE.md` §5).
- One merge path for the importer and for a human (ADR-0006), so there is one place the four
  writes happen and one shape of audit trail.
- The importer must never rewrite a decision a human took (R-A17, ADR-0009 item 4).
- The importer's behaviour must not change: two runs identical in values as well as counts
  (R-A15, R-A16).

## Considered options

1. **`mergePatients` takes the reviewer's field decisions** and applies them as part of the merge.
2. **Two writes at the route**: merge first, then push the picked values through the resolution
   path of ADR-0005, both inside one transaction.
3. **No per-field pick.** The reviewer chooses only the survivor; the survivor keeps everything it
   holds.

## Decision outcome

Chosen option: **Option 1**.

Option 3 fails R-C5 outright and makes the choice of survivor carry a decision it cannot express: a
reviewer who wants the other row's date of birth would have to merge the other way round and
inherit everything else with it. Option 2 splits one decision into two audit events, so "which row
supplied which field" becomes a join of a merge entry and a resolution entry — exactly the
provenance ADR-0006 required in one place — and it leaves the survivor holding, between the two
writes, values nobody chose.

### 1. `MergeRequest` gains `fieldDecisions`

```ts
type FieldSource = 'survivor' | 'loser' | 'edited';
interface FieldDecision { readonly value: string | null; readonly source: FieldSource; }
readonly fieldDecisions?: Readonly<Partial<Record<PersonField, FieldDecision>>>;
```

- Only the ten `PERSON_FIELDS` of ADR-0006 may be decided. `source` and `signup_date` are row
  provenance and stay the survivor's, unchanged from ADR-0006; a key outside the ten **throws**
  rather than being ignored (`CLAUDE.md` §2).
- **Precedence:** a decided field wins. An undecided field keeps ADR-0006's rule exactly — the
  survivor keeps what it holds and gains what it lacks. The importer passes no decisions, so its
  merges are byte-identical to today's, which a test asserts against the 28 tier-1 pairs.
- **`source` is recorded, not inferred.** `'loser'` and `'edited'` can produce the same string, and
  the audit has to say whether a reviewer chose a value that was in the data or typed one that was
  not.

### 2. What the audit entry says

One `AuditChange` per field whose decided value differs from the survivor's current value:
`{field, from: <survivor's value>, to: <chosen value>, source_legacy_id: <the loser's legacy id>}`,
with `source_legacy_id` set only when `source` is `'loser'` — an edited value came from the
reviewer, not from a row, and claiming otherwise would be a false provenance record. A decision
equal to the value already there writes no change, because nothing changed.

These changes join the merge's existing entry on the survivor (`merged_from`, plus the fields
gained), so one entry still answers "which row supplied which field", and the reviewer's note is
its `reason` (R-C6).

### 3. The answer ADR-0011 item 9 deferred

Item 9 left open whether a later import may blank a field the merge copied, "because the count is
zero" — no tier-1 survivor gained anything. A reviewer's pick makes the count non-zero and makes
the stored value differ from the survivor's own raw row, so the question is now live. It needs no
new mechanism: the change is written by a **human actor**, which is exactly what makes a field
human-owned (`humanOwnedFields`, ADR-0004, R-A17). The importer already refuses to rewrite such a
field and raises an item instead. Stated here so the protection is a decision and not a
coincidence, and asserted by a test that re-runs the importer after a console merge.

### 4. Two mechanical corrections on the same path

- **`actorReviewerId`.** `MergeRequest` and `UnmergeRequest` gain it, null for the importer, and
  `writeEntries` puts it on both entries. Without it a reviewer's merge records a name and not the
  stable identity ADR-0014 item 4 requires of a human actor.
- **The transaction belongs to the function.** `mergePatients` writes four things and
  `recomputeConsentStates` writes a fifth; today it relies on its only caller, `src/import/run.ts`,
  to wrap it. It opens its own `db.transaction` instead — drizzle nests that as a savepoint when
  the caller already has one, so the importer is unaffected — because a guarantee that lives in the
  caller is a guarantee the next caller forgets.

### 5. What is still refused

Unchanged from ADR-0006 and ADR-0011 item 3: a merge still moves no row that references a patient
by id, still refuses a loser that is already merged and a survivor that is itself merged away, and
`unmergePatient` stays the exact inverse. Per-field decisions add values to the survivor; they do
not add a table to the merge. The **unmerge UI** is a scope cut (R-S4): the repository function
exists and is tested, and nothing in the console calls it.

### Consequences

- Good: R-C5 is satisfied on the one path that already writes the four things a merge writes, and
  the provenance of a merged record stays one audit entry.
- Good: a reviewer's chosen value is protected from the next import by a rule the repo already
  has, not by a new one.
- Good: the importer's merges are provably unchanged — same call, no decisions, same rows.
- Bad: `mergePatients` now has two modes, and the tier-1 rule is no longer the only rule in it.
  Mitigated: the second mode is a map that is empty for every importer call, and the precedence is
  one sentence.
- Bad: a reviewer can now write a value that appears in no raw row (`source: 'edited'`). That is
  what R-C5 asks for; the mitigation is that it is recorded as edited, carries the note, and is
  visible in the patient's timeline.
- Neutral: no migration. `changes` is already `jsonb` and already carries `{field, from, to,
  source_legacy_id}`.

### Confirmation

- Unit test: a `fieldDecisions` key outside `PERSON_FIELDS` throws.
- Integration test: merge with a decision picking the loser's `full_name` over a value the survivor
  holds — the survivor's `full_name` changes, and the audit entry carries
  `{field: 'full_name', from, to, source_legacy_id}`.
- Integration test: an edited value writes a change with no `source_legacy_id`.
- Integration test: a decision equal to the survivor's value writes no change.
- Integration test: the importer's tier-1 merges with no decisions produce the same rows and the
  same audit entries as before (the existing `merge-tier1.integration.test.ts` passes unchanged).
- Integration test: after a console merge that changed `full_name`, a second import run does not
  rewrite it and raises an item instead (R-A17).
- Integration test: a merge whose consent recomputation fails leaves `merged_into`,
  `patient_legacy_ids` and `patients` untouched.
- Integration test: both merge entries carry `actor_reviewer_id` for a reviewer and none for the
  importer.

## More information

- ADR-0006 (the tiers, the survivor rule, the reviewer's action), ADR-0011 item 3 (what a merge
  moves) and item 9 (the deferred question), ADR-0008 item 2 (membership), ADR-0014 item 4 (the
  actor model), ADR-0005 (the resolution path this deliberately does *not* use for a merge).
- `docs/console-stories.md` S-6 and D-1, D-2, D-3.
