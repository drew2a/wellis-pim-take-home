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

**Ran it myself.** From the sixth branch on I stopped approving plans and let the agent proceed
from the files, so my own time went into using the thing. Three defects came out of clicking
through the running app that no test had caught, because each one was a page doing the right thing
twice or saying the wrong sentence about it: the intake form created a draft on page load and then
aborted its own request, so it never left "Starting your intake…"; a wrong console secret answered
"sign in to the console first", the redirect message, to someone already trying to sign in; and the
patient timeline printed every normalisation twice, once as prose and once as a code pill. Tests
assert that a fact reaches the screen, not that it reaches it once.

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


8. **Roles the brief never asked for (2026-09-13).** ADR-0014 gave reviewers a `doctor` / `ops`
   role and gated approve and reject on `doctor`; I accepted it, then cut it. The brief asks for
   an *actor* on every audited decision, not for an authorisation model, and a second role means
   every screen and every action has to answer "who may do this" — a question the assignment does
   not pose and a reviewer-experience decision I had not intended to take. One kind of reviewer,
   the audit still names who decided. Recorded in its own ADR, superseding ADR-0014 item 3 and
   the role paragraph of ADR-0021.

## What I would do differently

_To be filled at the end._
