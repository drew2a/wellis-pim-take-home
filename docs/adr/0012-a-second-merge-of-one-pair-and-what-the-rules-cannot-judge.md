# ADR-0012: A second merge of one pair, a human's unmerge, and what the rules cannot judge

- **Status:** proposed
- **Date:** 2026-09-12
- **Deciders:** Andrei Andreev
- **Requirements:** R-A7, R-A10, R-A15, R-A16, R-A17, R-B20, R-C4 · **Amends:** ADR-0006 (what the
  importer does with a pair a human has already decided), ADR-0008 item 1 (the audit dedupe key),
  ADR-0011 item 3 (the merge path), ADR-0005 (which minors' intakes become an item)

## Context and problem statement

The review of `feature/importer-detectors` found five places where the branch's code and the
decision it implements disagree, and each of them is a decision rather than a slip: it is not
obvious from ADR-0006 or ADR-0008 what the importer owes a pair a reviewer has taken apart, nor
what an audit trail owes the same transition happening twice. All five follow from one shape that
ADR-0006 and ADR-0011 described only in one direction: a merge can be undone, and after it is
undone the same two rows are still in the export, still tier 1, and the next import run meets them
again. They are recorded together because they are one story, and because three of them
(`CLAUDE.md` §1) are graded: merge semantics, the audit trail, and the auto-fix vs. review
boundary.

## Decision drivers

- Audit is append-only and complete: every transition records actor, timestamp, from-state,
  to-state and reason, and a real transition with no row hides who let it through (R-B20,
  `CLAUDE.md` §5).
- The importer never rewrites what a human decided (R-A17, ADR-0009 item 4) — and "not the same
  person" is a decision like any field edit.
- Identity, medicine and consent never auto-resolve (`CLAUDE.md` §5); when in doubt the machine
  leaves the row alone rather than acting on it.
- A rule that could not run must not read as a rule that passed (ADR-0010, ADR-0011 item 11).
- Two consecutive runs are identical in every table but `import_runs` (R-A15, R-A16).
- Deterministic and explainable beats clever (§3B): a figure a reviewer is shown must not depend
  on the order a database returned rows in.

## Decision outcome

| # | Question | Decision |
| --- | --- | --- |
| 1 | The same pair merged, unmerged and merged again | The audit dedupe key of ADR-0008 item 1 gains a sixth component, **the occurrence**: how many times this loser has already been merged into (or released from) this survivor. The five fields it was built from — entity type, entity id, from-state, to-state, reason — are byte-identical for the second merge when the actor and the survivor rule are, so `on conflict do nothing` dropped both entries and left the second merge unaudited while `merged_into` and the alias rows were rewritten. The occurrence is **omitted, not zero-padded, for every other importer-written entry**, so the keys ADR-0008 fixed for the canonical load do not move: an intake reaches its legacy state once and has no second occurrence to distinguish. |
| 2 | A tier-1 pair a human has unmerged | The importer **leaves it alone and counts it**; it does not merge it again and raises no item. `unmergePatient` writes `merged_into` on the loser with a human actor, which is exactly what makes a field human-owned (R-A17, ADR-0009 item 4), so the existing rule already answers this once `merged_into` is read as the field it is. Re-merging would undo a reviewer's decision, and re-raising the question as an item would be residue, not a decision (`CLAUDE.md` §5): the human has already answered it. The count is a report line (`tier-1 pairs a human has already decided`), so a pair that stops merging is visible rather than silent. The same test covers a human who merged the loser somewhere else, which ADR-0011 item 5 would otherwise refuse with an exception and fail the run. |
| 3 | Which consent state an identity item shows | **All of them, keyed by type.** `consent_states` holds one row per patient **and** per declared type (ADR-0011 item 16), so collapsing them to one string per patient showed a reviewer whichever type the database happened to return last. The side-by-side payload therefore carries `consent_states` as a type-to-state object, `{}` where the patient has none. Only `data_processing` exists in this export, so no rendered value changes today; what changes is that it cannot become wrong when a second type is declared, and that this path now keys by (patient, type) as the consent detector already did. |
| 4 | An intake submitted before its patient's date of birth | Reads as **`not_evaluable`**, like a missing date, not as an error that fails the run. ADR-0011's engine refuses a negative age (`wholeYears`), and the history audit runs inside the run transaction, so one such row would abort the whole import rather than produce a review item. Two rows in this export (`INT-7259`, `INT-7257`) are saved only by the accident that their dates of birth are after `--as-of` and the mapper nulls them; a date of birth that is plausible yet later than the submission is not excluded by anything. The guard lives in the history audit, where the other unusable-date cases already live, and the engine keeps refusing a negative age — it is the caller's job to hand it an age it can judge. |
| 5 | A minor's intake whose outcome spelling we could not read | Counts as **open**, alongside `approved` and `pending`. An unseen spelling maps to `unknown` and puts the intake in `legacy_pending`, the one non-terminal legacy state, precisely because nobody can say what the legacy process decided (ADR-0009 item 8); an under-18 intake in that state is at least as open a legal question as a `pending` one, and leaving it out failed open on the single class ADR-0005 queues for legal reasons. This export has 9 unreadable outcomes and none of them belongs to a minor, so the count stays at 58 — the decision changes no row here and closes the gap. |

### Consequences

- Good: a merge that really happened always has its two audit rows, and `unmergePatient` matches
  the merge that is actually in force rather than the first one ever recorded.
- Good: a reviewer's "not the same person" survives the next import run, which is what makes the
  console's unmerge worth offering at all.
- Good: the importer can no longer abort on a date pair, and no minor's intake is dropped from the
  legal queue because of a spelling.
- Bad: item 1 makes the dedupe key of a merge entry depend on a count of earlier entries, so a
  merge now reads the audit table before it writes to it. Accepted: the read is one indexed lookup
  by entity, and the alternative — a sequence column on an append-only table — is schema for a
  case that occurs once per reviewer decision.
- Bad: item 2 means a tier-1 pair can stop being merged with no item to explain it. Accepted: the
  audit entry the human wrote is the explanation, and the report line points at the count.
- Neutral: item 3 changes a payload shape that nothing renders yet; the console is Part B.

### Confirmation

- `src/repo/merge.integration.test.ts`: merge, unmerge and merge the same pair again with the same
  actor and reason; both merges have their own audit entries, and the unmerge that follows the
  second merge restores the second merge's fields.
- `src/repo/merge.integration.test.ts`: unmerging a loser whose survivor was itself merged away
  writes consent states for the end of the chain, and none for a patient that no longer survives.
- `src/import/identity/merge-tier1.test.ts`: a pair whose `merged_into` a human owns is counted,
  not merged, and raises no item.
- `src/import/history/audit.test.ts`: an intake submitted before its patient's date of birth is
  `not_evaluable` and throws nothing; a minor whose outcome is `unknown` raises the item.
- The export-count test: the 18 unit-less weights, the 58 minors and the identity tiers are
  unchanged, so none of these decisions moved a number in this export.

## More information

- ADR-0005 (the review boundary and the minors), ADR-0006 (the merge path and the survivor rule),
  ADR-0008 (the dedupe key, membership), ADR-0009 (human-owned fields, the unseen spelling),
  ADR-0010 (the engine's inputs), ADR-0011 (merge mechanics, consent states per type).
- The review of `feature/importer-detectors`, 2026-09-12: findings 1, 2, 3, 5 and 7. Findings 4
  (unmerge recomputing for a merged-away survivor) and 6 (a non-numeric weight reaching the
  unit-less item as `NaN`) are bugs against decisions already recorded and need no ADR.
