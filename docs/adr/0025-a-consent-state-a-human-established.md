# ADR-0025: A consent state a human established

- **Status:** accepted
- **Date:** 2026-09-13
- **Deciders:** Andrei Andreev
- **Requirements:** R-A20, R-A21, R-A22, R-C6, R-B20 · **Amends:** ADR-0005 (consent state:
  "7 conflicts (reviewer sets the state, note required)") and ADR-0011 item 13 (`consent_states` is
  derived and recomputed)

## Context and problem statement

`docs/reviewer-day.md` gives the console this action: "For the 7 conflicts: **set the state**
(granted / revoked) with a note." ADR-0005 says the same. Both were written before ADR-0011 item 13
settled what `consent_states` is:

> Rows are written for surviving patients only, derived over the union of events that membership
> returns; a merge deletes the loser's rows. The table is derived, so deleting is not a loss.

`recomputeConsentStates` therefore **deletes and rewrites** every row it covers, and it runs on
every import and after every merge. A state a reviewer set would survive until the next of those
and then vanish, with no error and no trace on the screen — which is the worst of the three
possible behaviours, because the item would be closed and the state would be back to `conflict`.

The seven rows this is about are real: the first event of that type is a revocation, so the log
contradicts itself (ADR-0011 item 15). Nobody can derive what is true from a log that says a
consent was withdrawn before it was given. A person has to find out, and the finding out happens
outside this system — a phone call, a paper form, a file note.

## Decision drivers

- **The log is evidence; the state is what we act on** (`CLAUDE.md` §6). A reviewer's finding is
  not an event the patient performed, and must never be written into `consent_events` as though it
  were: that would fabricate evidence of a patient's action (`CLAUDE.md` §5).
- A derived row is not evidence and may be recomputed (ADR-0007, ADR-0011 item 13) — but a human
  decision *is* evidence, wherever it is stored.
- The importer never rewrites a field a human has decided (R-A17, `humanOwnedFields`). The same
  rule should hold one table over.
- Consent governs whether we may process a person's data. A state that silently reverts is a
  safety problem, not a tidiness problem.

## Considered options

1. **A human-established state is kept by the recomputation**, marked as such on the row.
2. **No set-state.** The reviewer resolves the item with a note saying what was established; the
   derived state stays `conflict` and the console shows the note beside it.
3. **Write a consent event** carrying the reviewer's finding.
4. **Set the state and let it be recomputed away**, which is what the scenario asks for taken
   literally against today's code.

## Decision outcome

Chosen option: **Option 1**.

Option 3 is refused outright: an event is what the patient did, and a row that says `granted` at a
timestamp is indistinguishable from one the log supplied. Option 4 is the bug this ADR exists to
prevent. Option 2 is honest and safe — and it leaves the console unable to answer the one question
the item asks, so every downstream reader still sees `conflict` and still cannot act.

### 1. What is written

`consent_states` already carries `derivation_version`, which today is the pure function's version.
A state a reviewer establishes is written with **`derivation_version = 'human'`** and
`derived_from_event_id` null — it is derived from no event, which is precisely true — alongside:

- one **audit entry** against the patient, with the reviewer as actor, the note as reason, the item
  as `review_item_id`, and `changes` = `[{field: 'consent_state:<type>', from: <derived>, to:
  <established>}]`; and
- the item closed through the resolution path with that answer in `resolution`.

The audit entry is where the decision lives. The `consent_states` row is a cache of it, which is
why losing the row would be recoverable and why the entry is written first.

### 2. What the recomputation does with it, and when it stops

**A human establishes a state over the events that existed when they decided.** The row therefore
records which those were: `derived_from_event_id` is the **last event in the derivation's own
order** at the moment of the decision (`byTimeThenRevokedLast`, the same total order the pure
function uses, so the two cannot disagree about which event is last).

`recomputeConsentStates` then applies one rule per row:

| the last event for that patient and type is… | what happens |
|---|---|
| still the one the decision was taken over | the human row is **kept**; the derivation's answer is discarded |
| a different one — an event orders after it | the human row is **superseded**: the derivation's answer is written, and the decision stays in the audit entry |

So a patient who later grants consent properly has that grant read as new evidence, and their state
returns to `granted` without anyone doing anything. A future-dated revocation that was already in
the log when the reviewer decided is not new evidence — it was in front of them — and the decision
stands, which is the revocation-first case this exists for.

Three consequences are accepted and named:

- **Superseded is not silent.** The patient's page shows the superseded decision beside the event
  that superseded it, so the history reads as what happened rather than as a state that changed by
  itself. No review item is raised: nothing is wrong, the evidence simply moved on.
- **An event that arrives with an earlier timestamp does not supersede a decision**, because it
  does not order after the event the decision was taken over. The log is append-only and this
  export backfills nothing; a decision is superseded by evidence that postdates what it was taken
  over, which is the thing the reviewer could not have seen.
- The pure derivation in `src/consent/derive.ts` is untouched and stays pure — it gains one
  exported helper, `latestEvent`, which is the ordering it already uses. The human state is applied
  by `recomputeConsentStates`, which already reads the database.

### 2a. Merges, counted rather than assumed

A merge recomputes the survivor's states and deletes the loser's rows (ADR-0011 item 13), so a
human-established state on either side of a pair is a case worth checking before writing code for
it. Settled the way ADR-0011 item 9 was settled — **by counting first**:

```sh
psql "$DATABASE_URL" -c "select count(*) from consent_states cs where cs.state = 'conflict'
   and (exists (select 1 from patients p where p.merged_into = cs.patient_id)
        or cs.patient_id in (select merged_into from patients where merged_into is not null))"
```

Over this export the count is **zero**. None of the seven conflict patients
(`recAeApEtGG3IDTEk`, `recCrLpb3IgX4T1sI`, `recDrQ5x0Luft849M`, `recenANRwekdIbTiB`,
`receXkNIPBKcCURlA`, `recrji0nd3KzVGPAJ`, `recSs73t0Grgp7ZJC`) is a member or a survivor of any of
the 28 tier-1 pairs, in either direction, and none of them draws a consent event from a merged-away
row. **The merge path is therefore left exactly as it is.**

What would happen if the count were not zero is written down rather than guessed at: the survivor's
recomputation would re-derive over the union of both memberships' events, and a human row on the
loser would be deleted with the loser's other rows. The decision would survive in the audit entry
and the state would not. A future export with a non-zero count reopens this, and the decision
returns here before the code chooses — as ADR-0011 item 9 says for its own count.

### 3. What it is not for

Only the `conflict` state may be established by hand, and only on a `consent` review item. The
other 76 consent items — 19 revoked while active, 57 with no record while active or paused — are
resolved with a note describing what was done outside the system, and their derived state stands:
a revocation that is unambiguous is not something a reviewer overrides, it is something the
business acts on. The console offers no way to turn a clear `revoked` into a `granted`.

### Consequences

- Good: the seven rows nobody can derive get an answer that survives the next import, and the
  answer names a person, a time and a reason.
- Good: no evidence is fabricated. `consent_events` stays exactly what the log said.
- Good: no migration. `derivation_version` already exists and is already written per row.
- Bad: `recomputeConsentStates` stops being a pure rewrite, and a reader has to know that one value
  of `derivation_version` is load-bearing. Accepted: it is one condition, in one function, tested.
- Good: a human state does respond to later events, because a later event is new evidence. Nothing
  has to be remembered or re-opened for a patient who consents properly afterwards.
- Bad: the rule turns on the identity of one event, so a reader has to know that
  `derived_from_event_id` means something different on a human row (the last event seen) from what
  it means on a derived one (the event the state follows from — for a `conflict`, the first). Both
  are documented on the column and asserted by tests.
- Neutral: the import report's consent-state counts now include human-established rows. They are
  counted separately so the report still says what the rules derived.

### Confirmation

- Integration test: a reviewer establishes `granted` on a `conflict`; a full
  `recomputeConsentStates` afterwards leaves the row untouched, and every other row is rewritten.
- Integration test: an event that orders after the one the decision was taken over supersedes it —
  the next recomputation writes the derived state, and the decision is still in `audit_entries`.
- Integration test: an event that orders *before* it does not supersede the decision.
- The merge count above is zero, and a test asserts it over the imported database so the claim
  fails the build rather than going stale.
- Integration test: the audit entry carries the actor, the reviewer id, the note, the item and the
  `consent_state:<type>` change; the item closes with the established state in `resolution`.
- Integration test: establishing a state on an item whose derived state is not `conflict` is
  refused, and writes nothing.
- Unit test: the pure derivation is unchanged — the export-count test over the 2466 legacy rows
  still reproduces `granted` 2091, `revoked` 269, `conflict` 7.

## More information

- ADR-0005 (consent state, the seven conflicts), ADR-0007 (what is evidence), ADR-0011 items 13,
  15 and 16, ADR-0023 (one resolution path), `CLAUDE.md` §5 and §6.
- `docs/reviewer-day.md`, Ops action 5; `docs/console-stories.md` S-10.
