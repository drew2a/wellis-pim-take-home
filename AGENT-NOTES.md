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


8. **Roles the brief never asked for (2026-09-13).** ADR-0014 gave reviewers a `doctor` / `ops`
   role and gated approve and reject on `doctor`; I accepted it, then cut it. The brief asks for
   an *actor* on every audited decision, not for an authorisation model, and a second role means
   every screen and every action has to answer "who may do this" — a question the assignment does
   not pose and a reviewer-experience decision I had not intended to take. One kind of reviewer,
   the audit still names who decided. Recorded in its own ADR, superseding ADR-0014 item 3 and
   the role paragraph of ADR-0021.

## The review console (2026-09-13, `feature/review-console`)

Part C's screens, and the first branch where the pre-merge review (`CLAUDE.md` §3) found something
in every layer rather than in the one I was watching.

**The review.** `/code-review high` in a fresh session returned 13 findings; all 13 were fixed on
the branch, none declined. Three of them needed a decision nobody had taken, so they are ADR-0026
rather than a commit message: which row a `data_quality` item corrects (the item names an intake
*and* its patient, and only the intake has `submitted_at`), what a screen does when a decision
cannot be carried out at all (a consent event whose timestamp could not be read was never stored,
so the item is dismiss-only and now says so), and which two records a merge joins when the item
compares three (`candidateGroups` is a transitive closure; the screen assumed a pair and merged the
wrong record).

Two of the thirteen are worth naming because they are the kind a test suite does not catch:

- **An audit entry for a change that never happened.** A merge read its set of decided columns off
  the changes the decisions produced, and a decision that changes nothing produces none — so
  choosing the survivor's own empty value let the old rule fill the field from the loser anyway,
  and the survivor's entry claimed a value the column did not hold. `CLAUDE.md` §5 says a changed
  value needs a record; this was the mirror image, and the ADR now says so in as many words.
- **A defect in a branch this export never reaches.** The `submitted_at` fix is real, but I checked
  the database before believing the agent's framing of it: `select count(*) from review_items where
  type='data_quality' and intake_id is not null` is 0. All 62 are about a patient. The agent had
  written "the 11 unreadable submission dates" in the ADR and three comments, taking the figure
  from a module header where it means patient `dob`. It corrected all four when the query came back
  — but I had to run the query.

**Removing the reviewer role (ADR-0027).** The example of the whole branch. `reviewers.role` was
`doctor` | `ops`, and ADR-0014 item 3 gated approving and rejecting on `doctor`: it reads like the
one real permission in the product. It never was one, and the repository already said so — ADR-0021
records that the console has one shared secret and the reviewer picks their own name from a list,
so anyone who reaches the login page can be Dr Vermeer. The gate refused nobody while costing an
enum, a column, two fields on the state machine, a branch in `checkTransition`, a field on the
session, a shape in `REVIEWERS`, a conditional on the intake screen and half the meaning of 403.

What made it safe to remove is that the safety was never in it: edge 9 also carries
`refusesAbsoluteReject`, Q1's absolute age reject, which is a property of the intake's stored
evaluation and therefore refuses *every* reviewer. A minor could not be approved by a doctor
either. That guard stays, and after this it is the only thing 403 can mean.

I told the agent to remove it; it drafted ADR-0027 as `proposed`, added the "Amended by" pointer to
ADR-0014 rather than editing an accepted ADR, and stopped there until the decision was on the
record. Worth keeping as the pattern: **the agent is good at noticing that a control is real, and
will not tell you that one is theatre unless you ask.** It had built the gate, tested it, documented
it in two ADRs and a scenario file, and none of that work contained the question "does this refuse
anybody?"

## What I would do differently

_To be filled at the end._
