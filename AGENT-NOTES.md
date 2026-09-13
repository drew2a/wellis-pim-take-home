# Agent notes

How the work was directed through an AI coding agent (Claude Code), as required by
ASSIGNMENT.md §5. Kept short and updated as the work progresses; the unedited session
traces are the full record.

## Decomposition

- Docs before code: `REQUIREMENTS.md`, `QUESTIONS.md`, `CLAUDE.md` and the ADR log were
  written first so every later session starts from the same definition of "correct".
- Part A starts with a data profile (`docs/profile/data-profile.md`), then mapping rules and
  schema as `proposed` ADRs that I accept by hand, then implementation on a topic branch,
  then a review in a fresh session before the merge.

## Where the agent ran, where I took the wheel

**Let it run (2026-09-09, Part A analysis).**

- Profiling the export: a subagent wrote `scripts/profile/*.ts` and generated
  `docs/profile/data-profile.md` / `.json` (36 inventories) from a spec I gave it; I only spot-checked six
  numbers against the raw files and read the result.
- Testing the mapping hypotheses (`scripts/profile/hypotheses.ts`): the separator convention for
  dates, the weight-unit readings against the same patient's intakes, heights, vocabulary spread.
- The browsing artifact of the inventories.
- Once the per-column rhythm was set (facts, warnings, agreed line, two-question check), I let it
  finish `signup_date` and `source` alone, then six intake columns (`submitted_at`,
  `questionnaire_version`, `weight`, `height`, `alcohol_units_week`, `reviewer_note`) with one commit
  each, and asked for one summary table at the end.
- Drafting the three ADRs from the agreed lines.

**Took the wheel.** Every column that carries identity, medicine or consent: `legacy_patient_id`
(orphans), `meds_current`, `conditions`, `outcome`, the consent log, and the duplicate-patient
tiers. On those I read the facts, then wrote the decision myself; the agent recorded it.

**Stopped it.**

- It launched the profiling subagent right after presenting the plan, before I had accepted it. I
  interrupted and asked for plan, then accept, then execute.
- Before `intakes.csv` I told it not to proceed past the columns I wanted to decide myself.

## Where the agent was right and I changed course

1. **"No rules" (2026-09-09).** Mid-discussion on `dob` I said "for mapping there should not be any
   rules". The agent stopped and asked what I meant instead of rewriting three agreed lines. My
   phrasing was wrong: I meant "the importer is not a rule engine", not "drop the normalisation
   records". I retracted, and the clarification produced the vocabulary and the structure we now
   use. Mapping is plain parser code; a "rule" is a string code on a normalisation record plus
   evidence; "versioned" means the record carries the import run and importer version. "Warnings
   with a proposed autofix" are not a mechanism next to the review queue: there is one queue, a
   proposal is data on an item, applied only through the human resolution path. From that came the
   three-layer split: mapper never guesses, detectors create items, the resolution path is the only
   writer; four proposal functions, no framework.
2. **Orphan intakes (2026-09-09).** It proposed a null patient reference for the 21 orphan intakes
   instead of the placeholder patient in my Q9 default. A row with no name, birth date or email is a
   fabricated record; I changed the default.
3. **Flipping an ADR (2026-09-09).** I wrote "then flip it" for ADR-0004. It did not flip the status
   and pointed at the lifecycle rule (the human accepts, from their own terminal, no co-author
   trailer). Correct: that rule exists so the history shows who accepted what.

## Corrections

Concrete cases where the agent's output was wrong and I corrected it.

1. **Profiling language (2026-09-09).** The agent planned the data-profiling script in
   Python ("stdlib only, fast to write") even though ADR-0003 fixes the stack to
   TypeScript. Its reasoning was speed for a one-off script. I rejected it: a reviewer
   reads every script in the repo, one language keeps the toolchain single, and the
   profiling code is the seed of the importer's own parsers, so it belongs in the same
   language. The script is now `scripts/profile/profile.ts`, run with `tsx`.
2. **Process (2026-09-09).** The agent launched the profiling subagent immediately after
   presenting the plan, before I had accepted it. I stopped it and asked for
   plan → accept → execute. The agent also proposed a script or CI check to keep the ADR
   index in sync with the ADR files; I chose to drop the index instead, since a derived
   copy that can drift is not worth a safeguard this early.
3. **Per-row versus vocabulary-level (2026-09-09).** It routed the 42 legacy GLP-1 mentions into one
   list item "for a human to confirm the whole vocabulary once". A vocabulary item is for a decision
   about a rule; here the decision is per patient (approved, reports Ozempic: does a doctor look?),
   so 42 row items with the engine's reason string. The reverse correction on weight: it proposed
   about 50 row items for pounds rows that do not reconcile with intakes, which is one finding, not
   fifty decisions.
4. **`OK` is an inference, not a spelling (2026-09-09).** It folded `OK` (441 outcomes) into the
   approved vocabulary table. I made it a separate rule code with a confirmation item, like the
   date convention, so the rows can be remapped if the answer is no. Same treatment applied to the
   questionnaire label `2.0`.
5. **Over-quoting CLAUDE.md (2026-09-09).** ADR-0006 quoted "identity never auto-resolves" and dropped
   the deliberate exception "unless literally identical on identity and non-contradictory on
   everything else". I restored it as tier 1 (28 exact pairs auto-merged with provenance).
6. **Shadow mode, not a queue (2026-09-09).** Its first ADR-0005 queued every historical rule hit
   (about 400 items). The doctor who approved a 2024 intake saw its BMI; those disagreements are a
   report figure and a browsable shadow evaluation. Items only where the legacy process could not
   see the problem (GLP-1 and flag conditions in free text) or where it is legal (approved or
   pending minors).
7. **Detector it missed (2026-09-09).** It claimed the weight-divergence detector covered the five
   tiny weights; it does not, because those patients' intakes carry the same tiny values. I asked
   for a separate plausibility detector with bounds in the rules file, shared with Part B.

## Review of `feature/legacy-importer` (2026-09-09)

A fresh session ran `/code-review high` on the branch before the merge (`CLAUDE.md` §3). Ten
findings survived verification, plus six cut by the report cap; a second review session fixed,
corrected, deferred or declined each one.

- **Fixed (12):** the "future" reference date was inferred from the data through the ambiguous
  date reader and landed on 2062-11-04, a date in no file. I had it removed rather than repaired:
  every profile script now takes `--as-of YYYY-MM-DD` and prints it. Also fixed: four literal NUL
  bytes that made `common.ts` binary to git and therefore invisible to the review itself (the
  file was then reviewed on its own); code spans that swallowed the edge whitespace they existed
  to show; overlapping Dutch/English term lists that double-counted 190 rows; two definitions of
  "same day" between the intake and patient duplicate checks (4 pairs became 5); a stale path to
  the profile JSON; a prune step that would have blanked the inventory page at 41 sections; and
  hypotheses.ts carrying its own copies of thresholds and helpers. Four cut-by-cap findings were
  fixed as well: `URL.pathname` for the repo root, the duplicated helpers, an isolated-tail scan
  that a single early outlier could have collapsed, and a name-group count computed as a
  difference of two group counts (20) instead of the folded names with several spellings (41).
- **Corrected as clerical (1):** `VOCAB_OUTCOME` 1918 was a tally that forgot the 82 `pending`
  rows; the right figure is 1836. The decision is unchanged, so the count was corrected in place
  under a new sentence in the ADR lifecycle rather than by a superseding ADR. The same pass
  re-derived every number in `docs/findings.md` and ADR-0004 to ADR-0006 from the regenerated
  profile; no other count moved.
- **Deferred (1):** the detector, consent-state and identity-tier counts in ADR-0005 and
  ADR-0006 are produced by no committed script. The agent started a `mapping.ts` in the profile
  to recompute them; I stopped it. The mapper is written test-first in the importer branch, and
  one copy of the rules is the point. Acceptance criterion carried forward: **the import report
  reproduces every ADR-0005 and ADR-0006 count.** ADR-0005 now says which counts come from where.
- **Declined (2):** 13 commit subjects over 72 characters (history is not rewritten in this repo);
  ESLint and Prettier not configured (ADR-0003 places tooling in the scaffold branch, which is
  next; deferred, not dismissed).

## Importer load (2026-09-11, `feature/importer-load`)

Plan, accept, execute: the agent read ADR-0004 to ADR-0008 and proposed the build, the
`src/import/` layout (pure per-column mapper files, a review layer that turns the mapper's flags
into items, one orchestrator), one branch instead of two along the patients / intakes seam, and the
tests to write first. It listed eight decisions no accepted ADR settled; I accepted them with two
refinements (entity types for new-flow normalisation records; one exported actor set) and had them
drafted as ADR-0009, proposed, second commit after `rules/v1.json`.

What the tests found while the branch was built:

- **Impossible dobs are 5, not 6.** ADR-0005 counted "5 future, 1 above 100"; the one above 100 is
  a 1958 birth date whose signup date is in 2062. The signup is what is impossible and already has
  its own item, so the mapper keeps the dob. Recorded in ADR-0009 item 1 and in the count test.
- **The alternative dob reading must include ISO values read as Y-D-M**, as the profile does
  (P-4: 987 ambiguous values). Without it the minor/adult flip check found 2 of the 6 patients.
- **A changed source row must be mapped from the stored raw row**, not from the incoming file.
  The first version mapped from the file; the end-to-end test caught the canonical city following
  the new export while the raw row, correctly, kept the old one.

Two conventions surfaced in code and went into the proposed ADR-0009 rather than into comments: a
human transition makes `state` human-owned (otherwise a re-run returns a reopened legacy intake to
its legacy state), and an unseen outcome spelling sits in `legacy_pending` until its item is
resolved.

## Detectors and identity (2026-09-12, `feature/importer-detectors`)

Same shape: the agent read ADR-0005 to ADR-0010, proposed the build, the order, what it would
leave out, twelve decisions no accepted ADR settled and the tests it would write first. It also
said, unprompted, that the branch was too large for one review and proposed the seam — everything
that writes rows here, the import report next — which I took. Two things it caught that my list of
obligations had missed: the mapper's 18 unit-less weights had no review item either (the same debt
as the implausible values), and the counts in ADR-0005 needed checking rather than quoting.

What the tests found, in order:

- **`conflict` is "revoke before grant", not "revoke before grant *and* before signup".** ADR-0005
  describes the 7 conflicts with both properties; only six have the second. The seventh revoked the
  day after signing up. Under the narrower reading the derivation returns `granted` for a log that
  contradicts itself, which is what the state exists to prevent.
- **The second run overwrote 28 survivors with their losers' values.** After a merge repoints the
  alias, the alias no longer says which exported row built which canonical row, and the importer
  rewrites canonical rows from raw. A new column, `patients.created_from_legacy_id`, answers that
  and never moves. The double-run test found it; nothing else would have.
- **The weight-divergence detector finds nothing.** ADR-0005 predicts 3 items; all four diverging
  pairs are tiny weights that ADR-0009 item 2 — decided later — now nulls as implausible, so there
  is nothing to compare, and those patients already carry a plausibility item. I kept the detector
  (Part B needs it) and had the zero recorded with its evidence instead of adjusted away.
- **Two counts in accepted ADRs were wrong.** Same-day intake pairs need the profile's "any shared
  plausible reading" to reach ADR-0006's five, and ADR-0006's "outcomes disagreeing in 3" is 2 by
  canonical outcome and 4 by raw spelling. The second is a clerical fix under the lifecycle rule.

Where I took the wheel: the disagreement definition. The agent proposed mapping `auto_flagged` to
`pending` so the report could state one number. That conflates "the doctor never decided" with "a
doctor should look" — they are different facts about a patient. The report carries the whole matrix
instead and names two cells as hard disagreements (auto_rejected where legacy approved,
auto_cleared where legacy rejected), which is one named predicate the report and any later query
share.

## The import report (2026-09-12, `feature/import-report`)

The last piece of Part A, and the seam the detectors branch proposed: everything that writes rows
there, the report here. The agent read the ADRs, proposed building the report from queries against
the loaded database, and found three things the plan had to answer before any of it was written.

- **A report built after the run cannot describe a dry run.** The dry run's transaction is rolled
  back, so a report counted afterwards would print zeros as if they were true. The report is built
  as the last step *inside* the run's transaction instead, and the CLI — not the importer — writes
  the files. That is ADR-0013 item 1.
- **Two figures are not a count of any column**, and the agent said so instead of inventing a
  query for them: the rules that fired (`eligibility_evaluations` stores the verdict and the
  inputs, not `matched`, and ADR-0011 item 21 forbids re-deriving them from the thresholds) and
  the consent state of a row a merge took away. Both come from the code that owns them — the
  engine and the consent derivation — and each is cross-checked in the integration test from the
  other side, which is where a second implementation belongs.
- **`review_items` has no `rule` column.** The agent proposed reading the rule back out of
  `dedupe_key` with the exact inverse of the function that wrote it, rather than adding a column
  for the report's convenience. A schema change would have been a graded decision and a stop.

What the tests found, in order:

- **The 28 consent states a merge removes are not the losers' states.** `run.integration.test.ts`
  explained them as 23 `no_record` and 5 `unknown_pre_log` rows that never appeared in the log.
  They are not: the losers hold 14 `granted`, 10 `no_record` and 4 `revoked`, and because a merge
  moves no event, 18 survivors that had no record of their own gain one. The report now carries
  both state tables and the move between them, and that third table is the interesting one: for 18
  patients the consent record was on the row we were about to stop looking at.
- **ADR-0012's "9 unreadable outcomes" is zero.** Every one of the 13 raw outcome spellings is in
  the mapping table, which `export-counts.test.ts` already asserted. The decision stands as a
  guard for the next export; the count was corrected under the lifecycle's trivial-fix rule.
- **ADR-0005's 71 intakes before a first grant reproduce as 68 + 3.** The canonical comparison
  cannot see the three intakes whose submission date the mapper nulled as impossible, and those
  three belong to two patients — which is also ADR-0005's 70 patients as 68 + 2. Both readings are
  in the report with the definition each counted under, rather than one of them quietly winning.

## What I would do differently

_To be filled at the end._
